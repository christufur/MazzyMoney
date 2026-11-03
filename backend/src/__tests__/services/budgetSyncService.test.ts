import { describe, it, expect, beforeAll, afterEach, afterAll, mock, type Mock } from 'bun:test';
import { prisma } from '../../lib/prisma';
import {
  BudgetSyncService,
  isMonthKey,
  monthKey,
  monthRange
} from '../../services/budgetSyncService';
import { BudgetAlertService } from '../../services/budgetAlertService';

mock.module('../../services/budgetAlertService', () => ({
  BudgetAlertService: {
    evaluateBudgetAlerts: mock().mockResolvedValue(undefined),
    ensureDefaultAlerts: mock().mockResolvedValue(undefined),
    evaluateUserBudgets: mock().mockResolvedValue(undefined)
  }
}));

const mockEvaluateBudgetAlerts = BudgetAlertService.evaluateBudgetAlerts as unknown as Mock<any>;

// Every date is built relative to today so the tests never go stale.
const stamp = Date.now();
const now = new Date();
const userId = `budget-sync-user-${stamp}`;
const accountId = `budget-sync-account-${stamp}`;
const email = `budget-sync-${stamp}@example.com`;

const thisMonth = monthKey(now);
const monthOffset = (offset: number) =>
  monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1)));
const startOfMonth = (offset: number) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
/** Noon UTC on a day of a month relative to this one, safely inside the month. */
const dayIn = (offset: number, day = 10) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, day, 12));

let transactionCount = 0;

async function addTransaction(options: {
  monthOffset: number;
  amount: number;
  category?: string;
  isTransfer?: boolean;
  hidden?: boolean;
  day?: number;
}) {
  const index = transactionCount++;
  await prisma.transaction.create({
    data: {
      id: `budget-sync-tx-${stamp}-${index}`,
      plaidTransactionId: `budget-sync-plaid-${stamp}-${index}`,
      userId,
      accountId,
      name: `Transaction ${index}`,
      amount: options.amount,
      date: dayIn(options.monthOffset, options.day ?? 10),
      primaryCategory: options.category ?? 'Groceries',
      categories: [],
      isTransfer: options.isTransfer ?? false,
      hidden: options.hidden ?? false
    }
  });
}

const makeBudget = (overrides: Record<string, unknown> = {}) =>
  prisma.budget.create({
    data: {
      userId,
      name: 'Groceries',
      category: 'Groceries',
      amount: 300,
      period: 'MONTHLY',
      startDate: startOfMonth(-2),
      endDate: null,
      rollover: false,
      ...overrides
    }
  });

describe('budget month helpers', () => {
  it('builds a UTC [start, endExclusive) range for a month', () => {
    const { start, endExclusive } = monthRange('2026-01');

    expect(start.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(endExclusive.toISOString()).toBe('2026-02-01T00:00:00.000Z');
  });

  it('rejects anything that is not YYYY-MM', () => {
    expect(isMonthKey('2026-11')).toBe(true);
    expect(isMonthKey('2026-13')).toBe(false);
    expect(isMonthKey('2026-1')).toBe(false);
    expect(isMonthKey('November')).toBe(false);
    expect(isMonthKey(undefined)).toBe(false);
  });
});

describe('BudgetSyncService month snapshots', () => {
  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });

    await prisma.user.create({
      data: { id: userId, email, fullName: 'Budget Sync User', passwordHash: 'hash' }
    });

    await prisma.account.create({
      data: {
        id: accountId,
        plaidAccountId: `budget-sync-plaid-account-${stamp}`,
        userId,
        name: 'Budget Checking',
        type: 'checking',
        subtype: 'checking'
      }
    });
  });

  afterEach(async () => {
    mockEvaluateBudgetAlerts.mockClear();
    await prisma.budgetAlertNotification.deleteMany({ where: { userId } });
    await prisma.budgetAlert.deleteMany({ where: { userId } });
    await prisma.transaction.deleteMany({ where: { userId } });
    await prisma.budget.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await prisma.budgetAlertNotification.deleteMany({ where: { userId } });
    await prisma.budgetAlert.deleteMany({ where: { userId } });
    await prisma.transaction.deleteMany({ where: { userId } });
    await prisma.budget.deleteMany({ where: { userId } });
    await prisma.account.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('counts only the requested month and only counted rows', async () => {
    const budget = await makeBudget();

    await addTransaction({ monthOffset: 0, amount: 40 });
    // Other months never count.
    await addTransaction({ monthOffset: -1, amount: 25 });
    await addTransaction({ monthOffset: 1, amount: 15 });
    // Transfers and hidden rows are not spending (H6).
    await addTransaction({ monthOffset: 0, amount: 500, isTransfer: true });
    await addTransaction({ monthOffset: 0, amount: 60, hidden: true });
    // A different category never counts.
    await addTransaction({ monthOffset: 0, amount: 70, category: 'Food & Dining' });

    expect(await BudgetSyncService.spentInMonth(budget, thisMonth)).toBe(40);

    const snapshot = await BudgetSyncService.budgetForMonth(budget, thisMonth);
    expect(snapshot).toMatchObject({
      month: thisMonth,
      budgeted: 300,
      spent: 40,
      rolloverIn: 0,
      available: 300,
      remaining: 260
    });
    expect(snapshot.percentUsed).toBeCloseTo(13.33, 2);
  });

  it('lets a refund in the same category lower the month spending', async () => {
    const budget = await makeBudget();

    await addTransaction({ monthOffset: 0, amount: 100 });
    await addTransaction({ monthOffset: 0, amount: -35, day: 20 });

    const snapshot = await BudgetSyncService.budgetForMonth(budget, thisMonth);

    expect(snapshot.spent).toBe(65);
    expect(snapshot.remaining).toBe(235);
  });

  it('floors a month that is all refunds at zero spent', async () => {
    const budget = await makeBudget();

    await addTransaction({ monthOffset: 0, amount: -35 });

    const snapshot = await BudgetSyncService.budgetForMonth(budget, thisMonth);

    expect(snapshot.spent).toBe(0);
    expect(snapshot.remaining).toBe(300);
  });

  it('carries 50 dollars of unspent money into the next month', async () => {
    const budget = await makeBudget({ rollover: true, startDate: startOfMonth(-1) });

    // Last month: 250 of the 300 budget spent, 50 left over.
    await addTransaction({ monthOffset: -1, amount: 250 });
    // This month: 100 spent.
    await addTransaction({ monthOffset: 0, amount: 100 });

    const previous = await BudgetSyncService.budgetForMonth(budget, monthOffset(-1));
    expect(previous).toMatchObject({ budgeted: 300, spent: 250, rolloverIn: 0, remaining: 50 });

    const current = await BudgetSyncService.budgetForMonth(budget, thisMonth);
    expect(current).toMatchObject({
      month: thisMonth,
      budgeted: 300,
      spent: 100,
      rolloverIn: 50,
      available: 350,
      remaining: 250
    });
    expect(current.percentUsed).toBeCloseTo(28.57, 2);
  });

  it('carries a 30 dollar overspend into the next month as a negative rollover', async () => {
    const budget = await makeBudget({ rollover: true, startDate: startOfMonth(-1) });

    // Last month: 330 spent against a 300 budget.
    await addTransaction({ monthOffset: -1, amount: 330 });
    // This month: 20 spent.
    await addTransaction({ monthOffset: 0, amount: 20 });

    const previous = await BudgetSyncService.budgetForMonth(budget, monthOffset(-1));
    expect(previous).toMatchObject({ spent: 330, rolloverIn: 0, remaining: -30 });

    const current = await BudgetSyncService.budgetForMonth(budget, thisMonth);
    expect(current).toMatchObject({
      budgeted: 300,
      spent: 20,
      rolloverIn: -30,
      available: 270,
      remaining: 250
    });
  });

  it('does not roll money over when rollover is off', async () => {
    const budget = await makeBudget({ rollover: false, startDate: startOfMonth(-1) });

    await addTransaction({ monthOffset: -1, amount: 100 });
    await addTransaction({ monthOffset: 0, amount: 100 });

    const current = await BudgetSyncService.budgetForMonth(budget, thisMonth);

    expect(current).toMatchObject({ spent: 100, rolloverIn: 0, available: 300, remaining: 200 });
  });

  it('never rolls into the start month, even with rollover on', async () => {
    const budget = await makeBudget({ rollover: true, startDate: startOfMonth(0) });

    // Spending in the category from before this budget existed must not roll in.
    await addTransaction({ monthOffset: -1, amount: 10 });
    await addTransaction({ monthOffset: 0, amount: 100 });

    const current = await BudgetSyncService.budgetForMonth(budget, thisMonth);

    expect(current).toMatchObject({ rolloverIn: 0, budgeted: 300, spent: 100, remaining: 200 });
  });

  it('returns zeros for months before the budget started', async () => {
    const budget = await makeBudget({ rollover: true, startDate: startOfMonth(-1) });

    await addTransaction({ monthOffset: -3, amount: 80 });

    const before = await BudgetSyncService.budgetForMonth(budget, monthOffset(-3));

    expect(before).toEqual({
      month: monthOffset(-3),
      budgeted: 0,
      spent: 0,
      rolloverIn: 0,
      available: 0,
      remaining: 0,
      percentUsed: 0
    });
  });

  it('reports 100% when spending exists and nothing is available', async () => {
    const budget = await makeBudget({ amount: 0, startDate: startOfMonth(0) });

    await addTransaction({ monthOffset: 0, amount: 10 });

    const snapshot = await BudgetSyncService.budgetForMonth(budget, thisMonth);

    expect(snapshot).toMatchObject({ budgeted: 0, available: 0, remaining: -10, percentUsed: 100 });
  });

  it('keeps working in a month after the creation month', async () => {
    // The old bug: a budget created two months ago reported "spent 0" forever.
    const budget = await makeBudget({ startDate: startOfMonth(-2) });

    await addTransaction({ monthOffset: 0, amount: 42 });

    const snapshot = await BudgetSyncService.budgetForMonth(budget, thisMonth);

    expect(snapshot.budgeted).toBe(300);
    expect(snapshot.spent).toBe(42);
    expect(snapshot.remaining).toBe(258);
  });

  it('builds six months of history for the chart, zeroed before the start', async () => {
    const budget = await makeBudget({ startDate: startOfMonth(-2) });

    await addTransaction({ monthOffset: -2, amount: 10 });
    await addTransaction({ monthOffset: 0, amount: 20 });

    const history = await BudgetSyncService.history(budget, thisMonth);

    expect(history).toHaveLength(6);
    expect(history.map(point => point.month)).toEqual(
      Array.from({ length: 6 }, (_, index) => monthOffset(index - 5))
    );
    expect(history[0]).toEqual({ month: monthOffset(-5), budgeted: 0, spent: 0 });
    expect(history[1]).toEqual({ month: monthOffset(-4), budgeted: 0, spent: 0 });
    expect(history[2]).toEqual({ month: monthOffset(-3), budgeted: 0, spent: 0 });
    expect(history[3]).toEqual({ month: monthOffset(-2), budgeted: 300, spent: 10 });
    expect(history[4]).toMatchObject({ month: monthOffset(-1), budgeted: 300, spent: 0 });
    expect(history[5]).toMatchObject({ month: thisMonth, budgeted: 300, spent: 20 });
  });

  it('has no history before a budget that started this month', async () => {
    const budget = await makeBudget({ startDate: startOfMonth(0) });

    await addTransaction({ monthOffset: 0, amount: 75 });

    const history = await BudgetSyncService.history(budget, thisMonth);

    expect(history).toHaveLength(6);
    expect(history.slice(0, 5).every(point => point.budgeted === 0 && point.spent === 0)).toBe(true);
    expect(history[5]).toMatchObject({ month: thisMonth, budgeted: 300, spent: 75 });
  });

  it('syncs alerts for the current month only', async () => {
    const budget = await makeBudget({ startDate: startOfMonth(-1) });

    await addTransaction({ monthOffset: -1, amount: 150 });
    await addTransaction({ monthOffset: 0, amount: 50 });

    await BudgetSyncService.syncUserBudgets(userId);

    const call = mockEvaluateBudgetAlerts.mock.calls.find(([b]: any[]) => b.id === budget.id);
    expect(call).toBeDefined();
    expect(call?.[1]).toMatchObject({
      month: thisMonth,
      budgeted: 300,
      spent: 50,
      rolloverIn: 0,
      available: 300,
      remaining: 250
    });
  });
});
