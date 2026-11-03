// src/services/budgetSyncService.ts
//
// A budget is "category + monthly amount + rollover", active from the first day of
// its start month and forever after. `Budget.period` and `Budget.endDate` are
// leftovers from the old one-shot model and are no longer read (M2).
import { prisma } from '../lib/prisma';
import { Budget } from '../../prisma/generated/prisma';
import { BudgetAlertService } from './budgetAlertService';
import { COUNTED, cents } from './analyticsService';

/** How far back rollover is computed. Older months start from zero. */
const MAX_ROLLOVER_MONTHS = 36;
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** True for a `YYYY-MM` month key. */
export function isMonthKey(value: unknown): value is string {
  return typeof value === 'string' && MONTH_PATTERN.test(value);
}

/** `YYYY-MM` for a date, read in UTC (transaction dates are stored as UTC midnight). */
export function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** First day of a `YYYY-MM` month at UTC midnight. */
export function monthStart(month: string): Date {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(Date.UTC(year, monthNumber - 1, 1));
}

/** `[start, endExclusive)` as UTC dates for a `YYYY-MM` month. */
export function monthRange(month: string): { start: Date; endExclusive: Date } {
  return { start: monthStart(month), endExclusive: monthStart(addMonths(month, 1)) };
}

/** Shift a `YYYY-MM` key by whole months. */
export function addMonths(month: string, delta: number): string {
  const [year, monthNumber] = month.split('-').map(Number);
  return monthKey(new Date(Date.UTC(year, monthNumber - 1 + delta, 1)));
}

export interface BudgetMonthSnapshot {
  month: string;
  budgeted: number;
  spent: number;
  rolloverIn: number;
  available: number;
  remaining: number;
  percentUsed: number;
}

export interface BudgetHistoryPoint {
  month: string;
  budgeted: number;
  spent: number;
}

const ZERO_SNAPSHOT = (month: string): BudgetMonthSnapshot => ({
  month,
  budgeted: 0,
  spent: 0,
  rolloverIn: 0,
  available: 0,
  remaining: 0,
  percentUsed: 0
});

export class BudgetSyncService {
  /** The current month in UTC, as `YYYY-MM`. */
  static currentMonth(): string {
    return monthKey(new Date());
  }

  /** The month a budget starts in, from its `startDate`. */
  static startMonth(budget: Budget): string {
    return monthKey(budget.startDate);
  }

  /**
   * Keep the budget alerts up to date after a sync. Alerts only ever look at the
   * current month: an old month can never fire a notification.
   */
  static async syncUserBudgets(userId: string): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true }
    });

    const budgets = await prisma.budget.findMany({
      where: { userId, isActive: true }
    });

    const month = this.currentMonth();

    const results = await Promise.allSettled(
      budgets.map(async (budget) => {
        const snapshot = await this.budgetForMonth(budget, month);
        await BudgetAlertService.evaluateBudgetAlerts(budget, snapshot, {
          userEmail: user?.email
        });
        return snapshot;
      })
    );

    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.error(`Failed to sync budget ${budgets[index].id}:`, result.reason);
      }
    });
  }

  /**
   * Net spending for a budget's category in one month, floored at 0.
   *
   * Expenses are positive and refunds negative in the same category, so the net
   * sum is what the month actually cost. Transfers and hidden rows never count (H6).
   */
  static async spentInMonth(budget: Budget, month: string): Promise<number> {
    const { start, endExclusive } = monthRange(month);

    const result = await prisma.transaction.aggregate({
      where: {
        userId: budget.userId,
        ...COUNTED,
        primaryCategory: budget.category,
        date: { gte: start, lt: endExclusive }
      },
      _sum: { amount: true }
    });

    return cents(Math.max(0, result._sum.amount || 0));
  }

  /**
   * Everything the page shows for one budget in one month.
   *
   * `rolloverIn` is the previous month's `remaining` (positive or negative) when
   * the budget rolls over, and 0 in the start month. Months before the start
   * month are all zeros: the budget did not exist yet.
   */
  static async budgetForMonth(budget: Budget, month: string): Promise<BudgetMonthSnapshot> {
    const start = this.startMonth(budget);
    if (month < start) {
      return ZERO_SNAPSHOT(month);
    }

    // Walk from the start month forward. A very old budget only carries 36 months
    // of history; anything earlier contributes 0.
    const capped = addMonths(month, -MAX_ROLLOVER_MONTHS);
    const from = capped > start ? capped : start;
    const spending = await this.spendingByMonth(budget, from, month);
    const budgeted = cents(budget.amount);

    let carry = 0;
    let cursor = from;
    let snapshot = ZERO_SNAPSHOT(from);

    while (true) {
      const spent = cents(Math.max(0, spending.get(cursor) ?? 0));
      const rolloverIn = budget.rollover && cursor !== from ? cents(carry) : 0;
      const available = cents(budgeted + rolloverIn);
      const remaining = cents(available - spent);
      const percentUsed =
        available > 0 ? cents((spent / available) * 100) : spent > 0 ? 100 : 0;

      snapshot = { month: cursor, budgeted, spent, rolloverIn, available, remaining, percentUsed };

      if (cursor === month) {
        break;
      }
      carry = remaining;
      cursor = addMonths(cursor, 1);
    }

    return snapshot;
  }

  /**
   * The last `months` months ending at `month`, for the per-budget bar chart.
   * Months before the budget started are zeroed out.
   */
  static async history(
    budget: Budget,
    month: string = this.currentMonth(),
    months = 6
  ): Promise<BudgetHistoryPoint[]> {
    const first = addMonths(month, -(months - 1));
    const start = this.startMonth(budget);
    // Nothing to read at all when every month in the window is before the start.
    const spending =
      month < start
        ? new Map<string, number>()
        : await this.spendingByMonth(budget, first < start ? start : first, month);
    const budgeted = cents(budget.amount);

    const points: BudgetHistoryPoint[] = [];
    for (let offset = months - 1; offset >= 0; offset--) {
      const key = addMonths(month, -offset);
      if (key < start) {
        points.push({ month: key, budgeted: 0, spent: 0 });
        continue;
      }
      points.push({
        month: key,
        budgeted,
        spent: cents(Math.max(0, spending.get(key) ?? 0))
      });
    }

    return points;
  }

  /**
   * Current-month snapshot for a budget, kept for callers that only need the
   * `{ spent, remaining, percentUsed }` shape.
   */
  static async calculateBudgetSpending(budget: Budget): Promise<{
    spent: number;
    remaining: number;
    percentUsed: number;
  }> {
    const snapshot = await this.budgetForMonth(budget, this.currentMonth());
    const { spent, remaining, percentUsed } = snapshot;
    return { spent, remaining, percentUsed };
  }

  /**
   * Get budget categories from user's transaction history
   */
  static async getAvailableCategories(userId: string): Promise<string[]> {
    const categories = await prisma.transaction.groupBy({
      by: ['primaryCategory'],
      where: {
        userId,
        ...COUNTED,
        primaryCategory: { not: null },
        amount: { gt: 0 } // Only expenses have meaningful categories for budgeting
      },
      _count: {
        id: true
      },
      having: {
        id: {
          _count: {
            gte: 5 // Only include categories with at least 5 transactions
          }
        }
      },
      orderBy: {
        _count: {
          id: 'desc'
        }
      }
    });

    return categories
      .map(c => c.primaryCategory)
      .filter((cat): cat is string => cat !== null);
  }

  /**
   * Net spending per `YYYY-MM` for the category, from `from` through `through`
   * inclusive, in one query.
   */
  private static async spendingByMonth(
    budget: Budget,
    from: string,
    through: string
  ): Promise<Map<string, number>> {
    const { start } = monthRange(from);
    const { endExclusive } = monthRange(through);

    const rows = await prisma.transaction.findMany({
      where: {
        userId: budget.userId,
        ...COUNTED,
        primaryCategory: budget.category,
        date: { gte: start, lt: endExclusive }
      },
      select: { amount: true, date: true }
    });

    const byMonth = new Map<string, number>();
    for (const row of rows) {
      const key = monthKey(row.date);
      byMonth.set(key, (byMonth.get(key) ?? 0) + row.amount);
    }
    return byMonth;
  }
}
