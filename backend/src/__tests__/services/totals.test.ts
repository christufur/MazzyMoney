import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'bun:test';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

import { app } from '../../index';
import { prisma } from '../../lib/prisma';
import { generateToken } from '../../services/jwtService';
import { AnalyticsService } from '../../services/analyticsService';
import { BudgetSyncService } from '../../services/budgetSyncService';

// H6: transfers between your own accounts, credit-card payments, and hidden rows
// must never count as income, expenses, or budget spending. The transactions list
// still shows them.
const runId = Date.now();
const userId = `totals-test-user-${runId}`;
const accountId = `totals-test-account-${runId}`;
const budgetId = `totals-test-budget-${runId}`;
const email = `totals-test-${runId}@example.com`;

const now = new Date();
const year = now.getUTCFullYear();
const monthIndex = now.getUTCMonth();
const monthStart = new Date(Date.UTC(year, monthIndex, 1));
const monthEnd = new Date(Date.UTC(year, monthIndex + 1, 0, 23, 59, 59, 999));
const month = monthIndex + 1;

const token = () => generateToken(userId);
const auth = () => `Bearer ${token()}`;

const baseTransaction = {
  userId,
  accountId,
  date: monthStart,
  categories: [] as string[]
};

async function cleanup() {
  // Only this run's rows: other agents share the test database.
  await prisma.budget.deleteMany({ where: { userId } });
  await prisma.transaction.deleteMany({ where: { userId } });
  await prisma.account.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
}

beforeAll(async () => {
  await cleanup();

  await prisma.user.create({
    data: {
      id: userId,
      email,
      fullName: 'Totals Test User',
      passwordHash: 'hash'
    }
  });

  await prisma.account.create({
    data: {
      id: accountId,
      plaidAccountId: `totals-test-plaid-account-${runId}`,
      userId,
      name: 'Totals Checking',
      type: 'checking',
      subtype: 'checking'
    }
  });
});

beforeEach(async () => {
  await prisma.budget.deleteMany({ where: { userId } });
  await prisma.transaction.deleteMany({ where: { userId } });

  // Positive amounts are money out, negative amounts are money in (Plaid).
  await prisma.transaction.createMany({
    data: [
      {
        ...baseTransaction,
        id: `totals-salary-${runId}`,
        plaidTransactionId: `totals-plaid-salary-${runId}`,
        name: 'Acme Payroll',
        merchantName: 'Acme',
        amount: -2000,
        primaryCategory: 'Income'
      },
      {
        ...baseTransaction,
        id: `totals-groceries-${runId}`,
        plaidTransactionId: `totals-plaid-groceries-${runId}`,
        name: 'Whole Foods',
        merchantName: 'Whole Foods',
        amount: 100,
        primaryCategory: 'Groceries'
      },
      {
        ...baseTransaction,
        id: `totals-transfer-${runId}`,
        plaidTransactionId: `totals-plaid-transfer-${runId}`,
        name: 'Transfer to savings',
        merchantName: 'Transfer',
        amount: 500,
        primaryCategory: 'Transfer',
        isTransfer: true
      },
      {
        ...baseTransaction,
        id: `totals-card-payment-${runId}`,
        plaidTransactionId: `totals-plaid-card-payment-${runId}`,
        name: 'Credit card payment',
        merchantName: 'Card Payment',
        amount: 300,
        primaryCategory: 'Transfer',
        isTransfer: true
      },
      {
        ...baseTransaction,
        id: `totals-hidden-${runId}`,
        plaidTransactionId: `totals-plaid-hidden-${runId}`,
        name: 'Hidden groceries',
        merchantName: 'Whole Foods',
        amount: 40,
        primaryCategory: 'Groceries',
        hidden: true
      }
    ]
  });
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('Totals without transfers and hidden rows', () => {
  it('GET /api/transactions sums only counted rows but still lists all of them', async () => {
    // W2.6 hides hidden rows in the list by default; includeHidden brings them back,
    // which is what "the list is for looking at" means here.
    const response = await request(app)
      .get('/api/transactions?includeHidden=true')
      .set('Authorization', auth());

    expect(response.status).toBe(200);

    // The list is for looking at: transfers and hidden rows stay visible with includeHidden.
    expect(response.body.transactions).toHaveLength(5);
    expect(response.body.pagination.totalCount).toBe(5);

    expect(response.body.summary).toMatchObject({
      totalTransactions: 2,
      income: 2000,
      incomeCount: 1,
      expenses: 100,
      expenseCount: 1,
      netAmount: 1900
    });
    // Salary -2000 plus groceries +100.
    expect(response.body.summary.totalAmount).toBe(-1900);
  });

  it('GET /api/transactions keeps an amount range filter in the income and expense sums', async () => {
    // Only the 100 groceries row falls in the range. The old code replaced the amount
    // condition, so it summed the hidden and transfer rows too (expenses 940) and
    // reported the out-of-range salary as income.
    const response = await request(app)
      .get('/api/transactions?amountMin=50&amountMax=150')
      .set('Authorization', auth());

    expect(response.status).toBe(200);
    expect(response.body.summary).toMatchObject({
      income: 0,
      expenses: 100
    });
  });

  it('GET /api/transactions/categories leaves out transfers and hidden rows', async () => {
    const response = await request(app)
      .get('/api/transactions/categories')
      .set('Authorization', auth());

    expect(response.status).toBe(200);

    const categories = response.body as Array<{ category: string; amount: number }>;
    const names = categories.map(entry => entry.category);

    expect(names).not.toContain('Transfer');
    expect(categories.find(entry => entry.category === 'Groceries')).toMatchObject({
      amount: 100,
      transactionCount: 1
    });
    expect(categories.reduce((sum, entry) => sum + entry.amount, 0)).toBe(100);
  });

  it('GET /api/transactions/monthly-trends leaves out transfers and hidden rows', async () => {
    const response = await request(app)
      .get('/api/transactions/monthly-trends?months=1')
      .set('Authorization', auth());

    expect(response.status).toBe(200);

    const trends = response.body as Array<{
      expenses: number;
      income: number;
      transactionCount: number;
    }>;
    const currentMonth = trends[trends.length - 1];

    expect(currentMonth).toMatchObject({
      income: 2000,
      expenses: 100,
      transactionCount: 2
    });
  });

  it('AnalyticsService.getMonthlySummary reports the current month without transfers', async () => {
    const summary = await AnalyticsService.getMonthlySummary(userId, year);
    const current = summary.find(entry => entry.month === month);

    expect(current).toMatchObject({
      month,
      income: 2000,
      expenses: 100,
      netIncome: 1900
    });
  });

  it('AnalyticsService leaves transfers and hidden rows out of every spending total', async () => {
    const trends = await AnalyticsService.getSpendingTrends(userId, 1);
    const monthKey = monthStart.toISOString().substring(0, 7);
    const thisMonth = trends.find(entry => entry.month === monthKey);

    expect(thisMonth).toMatchObject({ Groceries: 100 });
    expect(thisMonth).not.toHaveProperty('Transfer');

    const merchants = await AnalyticsService.getTopMerchants(userId);
    expect(merchants.map(merchant => merchant.name)).not.toContain('Transfer');
    expect(merchants.find(merchant => merchant.name === 'Whole Foods')).toMatchObject({
      totalSpent: 100,
      transactionCount: 1
    });

    const days = await AnalyticsService.getSpendingByDayOfWeek(userId);
    expect(days.reduce((sum, day) => sum + day.totalSpent, 0)).toBe(100);

    const forecast = await AnalyticsService.getSpendingForecast(userId);
    expect(forecast.totalPredicted).toBe(100);
  });

  it('a budget counts only counted spending in its category', async () => {
    const budget = await prisma.budget.create({
      data: {
        id: budgetId,
        userId,
        name: 'Groceries',
        category: 'Groceries',
        amount: 200,
        period: 'MONTHLY',
        startDate: monthStart,
        endDate: monthEnd
      }
    });

    const spending = await BudgetSyncService.calculateBudgetSpending(budget);

    // 100 groceries; the hidden 40 and the transfers are not spending.
    expect(spending).toEqual({
      spent: 100,
      remaining: 100,
      percentUsed: 50
    });
  });

  it('budget categories come from counted expenses only', async () => {
    await prisma.transaction.createMany({
      data: [
        ...Array.from({ length: 4 }, (_, index) => ({
          ...baseTransaction,
          id: `totals-cat-${runId}-${index}`,
          plaidTransactionId: `totals-plaid-cat-${runId}-${index}`,
          name: `Groceries ${index}`,
          amount: 10,
          primaryCategory: 'Groceries'
        })),
        ...Array.from({ length: 5 }, (_, index) => ({
          ...baseTransaction,
          id: `totals-cat-transfer-${runId}-${index}`,
          plaidTransactionId: `totals-plaid-cat-transfer-${runId}-${index}`,
          name: `Transfer ${index}`,
          amount: 10,
          primaryCategory: 'Transfer Only',
          isTransfer: true
        }))
      ]
    });

    const categories = await BudgetSyncService.getAvailableCategories(userId);

    // Groceries has 5 counted rows; the transfer category also has 5 but none of them count.
    expect(categories).toContain('Groceries');
    expect(categories).not.toContain('Transfer Only');
  });
});
