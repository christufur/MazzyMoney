// Transaction dates are stored as UTC midnight, so every bucketing below must run
// against a non-UTC server timezone to prove the UTC getters are used.
process.env.TZ = 'America/Denver';

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { prisma } from '../../lib/prisma';
import { AnalyticsService } from '../../services/analyticsService';

const runId = Date.now();
const userId = `analytics-test-user-${runId}`;
const accountId = `analytics-test-account-${runId}`;

let transactionSeq = 0;

async function createTransaction(data: {
  amount: number;
  date: Date;
  primaryCategory: string | null;
}) {
  transactionSeq += 1;
  return prisma.transaction.create({
    data: {
      id: `analytics-test-tx-${runId}-${transactionSeq}`,
      plaidTransactionId: `analytics-test-plaid-${runId}-${transactionSeq}`,
      userId,
      accountId,
      name: `Transaction ${transactionSeq}`,
      merchantName: 'Test Merchant',
      amount: data.amount,
      date: data.date,
      primaryCategory: data.primaryCategory,
      categories: []
    }
  });
}

async function cleanup() {
  // Only this run's rows: other agents share the test database.
  await prisma.transaction.deleteMany({ where: { userId } });
  await prisma.account.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
}

/** UTC midnight of the current UTC day, never in the future. */
function todayUtcMidnight(now: Date) {
  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return midnight < now ? midnight : now;
}

beforeAll(async () => {
  await cleanup();

  await prisma.user.create({
    data: {
      id: userId,
      email: `analytics-test-${runId}@example.com`,
      fullName: 'Analytics Test User',
      passwordHash: 'hash'
    }
  });

  await prisma.account.create({
    data: {
      id: accountId,
      plaidAccountId: `analytics-test-plaid-account-${runId}`,
      userId,
      name: 'Analytics Checking',
      type: 'checking',
      subtype: 'checking'
    }
  });
});

beforeEach(async () => {
  await prisma.transaction.deleteMany({ where: { userId } });
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('AnalyticsService transaction date bucketing', () => {
  it('runs in a non-UTC timezone so local getters would shift the date', () => {
    // 2025-09-01T00:00:00Z is still Aug 31 in America/Denver (UTC-6).
    const utcMidnight = new Date(Date.UTC(2025, 8, 1));
    expect(utcMidnight.getDate()).toBe(31);
    expect(utcMidnight.getUTCDate()).toBe(1);
  });

  it('counts a 2025-09-01 (UTC) transaction as Monday in getSpendingByDayOfWeek', async () => {
    await createTransaction({
      amount: 42,
      date: new Date(Date.UTC(2025, 8, 1)),
      primaryCategory: 'Groceries'
    });

    const days = await AnalyticsService.getSpendingByDayOfWeek(userId);
    const monday = days.find(day => day.day === 'Monday');
    const sunday = days.find(day => day.day === 'Sunday');

    expect(monday).toMatchObject({ totalSpent: 42, transactionCount: 1 });
    expect(sunday).toMatchObject({ totalSpent: 0, transactionCount: 0 });
  });

  it('counts a 2025-09-01 (UTC) transaction in September of getMonthlySummary', async () => {
    await createTransaction({
      amount: 42,
      date: new Date(Date.UTC(2025, 8, 1)),
      primaryCategory: 'Groceries'
    });

    const summary = await AnalyticsService.getMonthlySummary(userId, 2025);
    const september = summary.find(month => month.month === 9);
    const august = summary.find(month => month.month === 8);

    expect(september).toMatchObject({ month: 9, expenses: 42, topCategory: 'Groceries' });
    expect(august).toMatchObject({ month: 8, expenses: 0 });
  });

  it('getSpendingInsights compares the current month so far with the same days last month', async () => {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth();
    const day = now.getUTCDate();
    const lastDayOfPreviousMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

    // Same day-of-month as today, capped at the last day of the previous month.
    const previousMonthDate = new Date(
      Date.UTC(year, month - 1, Math.min(day, lastDayOfPreviousMonth))
    );

    await createTransaction({
      amount: 100,
      date: todayUtcMidnight(now),
      primaryCategory: 'Food & Dining'
    });
    await createTransaction({
      amount: 10,
      date: previousMonthDate,
      primaryCategory: 'Food & Dining'
    });

    const insights = await AnalyticsService.getSpendingInsights(userId);
    const dining = insights.find(insight => insight.category === 'Food & Dining');

    expect(dining).toBeDefined();
    expect(dining).toMatchObject({
      category: 'Food & Dining',
      change: 90,
      percentChange: 900,
      type: 'increase',
      severity: 'high'
    });
    expect(Object.keys(dining!).sort()).toEqual(
      ['category', 'change', 'percentChange', 'severity', 'type'].sort()
    );
  });

  it('getSpendingInsights reports a new category with no last-month spending as an increase', async () => {
    await createTransaction({
      amount: 25,
      date: todayUtcMidnight(new Date()),
      primaryCategory: 'Subscriptions'
    });

    const insights = await AnalyticsService.getSpendingInsights(userId);
    const subscriptions = insights.find(insight => insight.category === 'Subscriptions');

    expect(subscriptions).toMatchObject({
      category: 'Subscriptions',
      change: 25,
      percentChange: 100,
      type: 'increase',
      severity: 'high'
    });
  });

  it('getSpendingInsights ignores categories that did not change by more than 20%', async () => {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth();
    const day = now.getUTCDate();
    const lastDayOfPreviousMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const previousMonthDate = new Date(
      Date.UTC(year, month - 1, Math.min(day, lastDayOfPreviousMonth))
    );

    await createTransaction({
      amount: 100,
      date: todayUtcMidnight(now),
      primaryCategory: 'Utilities'
    });
    await createTransaction({
      amount: 100,
      date: previousMonthDate,
      primaryCategory: 'Utilities'
    });

    const insights = await AnalyticsService.getSpendingInsights(userId);

    expect(insights.find(insight => insight.category === 'Utilities')).toBeUndefined();
  });
});
