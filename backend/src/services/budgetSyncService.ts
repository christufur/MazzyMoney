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

/** One category the last few months say is worth a budget. */
export interface BudgetSuggestion {
  category: string;
  /** Net spending averaged over the months read, in dollars. */
  average: number;
  /** `average` rounded up to the next $10, the amount to offer. */
  suggested: number;
  /** How many of those months had any spending at all. */
  monthsWithSpending: number;
}

export interface BudgetSuggestionResult {
  /** The full calendar months read, oldest first, as `YYYY-MM`. */
  months: string[];
  suggestions: BudgetSuggestion[];
}

/** How many full calendar months a suggestion looks at. */
const SUGGESTION_MONTHS = 3;
/** Below this average a category is too small to be worth a budget. */
const SUGGESTION_MIN_AVERAGE = 20;
/** Suggested amounts are rounded up to a multiple of this many dollars. */
const SUGGESTION_STEP = 10;
/** Neither of these is spending a household plans a budget for. */
const NEVER_SUGGESTED: ReadonlySet<string> = new Set(['Transfer', 'Income']);

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
   * What the last few full months say to budget.
   *
   * Only full calendar months count, so a half-finished current month never drags
   * an average down. Spending is net of refunds within the month and floored at
   * zero, like a budget's own month. Categories that already have an active budget,
   * the Transfer and Income categories, and anything averaging under $20 are left
   * out. Suggestions are sorted by average, largest first.
   */
  static async suggestBudgets(userId: string): Promise<BudgetSuggestionResult> {
    // The last N months before this one: this month is still being spent.
    const months = Array.from({ length: SUGGESTION_MONTHS }, (_, index) =>
      addMonths(this.currentMonth(), -(SUGGESTION_MONTHS - index))
    );

    const [budgets, transactions] = await Promise.all([
      prisma.budget.findMany({
        where: { userId, isActive: true },
        select: { category: true }
      }),
      prisma.transaction.findMany({
        where: {
          userId,
          ...COUNTED,
          primaryCategory: { not: null },
          date: { gte: monthRange(months[0]).start, lt: monthRange(months[months.length - 1]).endExclusive }
        },
        select: { amount: true, date: true, primaryCategory: true }
      })
    ]);

    const budgeted = new Set(budgets.map(budget => budget.category));

    // Net per category per month, then floored at 0 the way a budget month is.
    const byCategory = new Map<string, Map<string, number>>();
    for (const row of transactions) {
      const category = row.primaryCategory;
      if (!category || budgeted.has(category) || NEVER_SUGGESTED.has(category)) continue;

      const perMonth = byCategory.get(category) ?? new Map<string, number>();
      const key = monthKey(row.date);
      perMonth.set(key, (perMonth.get(key) ?? 0) + row.amount);
      byCategory.set(category, perMonth);
    }

    const suggestions: BudgetSuggestion[] = [];
    for (const [category, perMonth] of byCategory) {
      let total = 0;
      let monthsWithSpending = 0;
      for (const month of months) {
        const net = Math.max(0, perMonth.get(month) ?? 0);
        total += net;
        if (net > 0) monthsWithSpending += 1;
      }

      const average = cents(total / months.length);
      if (average < SUGGESTION_MIN_AVERAGE) continue;

      suggestions.push({
        category,
        average,
        suggested: Math.ceil(average / SUGGESTION_STEP) * SUGGESTION_STEP,
        monthsWithSpending
      });
    }

    suggestions.sort((a, b) => b.average - a.average);

    return { months, suggestions };
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
