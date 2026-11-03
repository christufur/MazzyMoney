import { describe, it, expect, beforeAll, afterEach, afterAll, mock } from 'bun:test';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

// Any Plaid call fails the test instead of hitting the network.
const anyPlaidCall = mock(async () => {
  throw new Error('budgets route must not call Plaid');
});

mock.module('../../lib/plaid', () => ({
  plaidClient: {
    linkTokenCreate: anyPlaidCall,
    itemPublicTokenExchange: anyPlaidCall,
    itemGet: anyPlaidCall,
    institutionsGetById: anyPlaidCall,
    accountsGet: anyPlaidCall,
    itemRemove: anyPlaidCall,
    transactionsSync: anyPlaidCall,
    transactionsGet: anyPlaidCall,
  },
  ITEM_LIMIT: 10,
  plaidErrorCode: (err: any) => err?.response?.data?.error_code,
}));

mock.module('../../services/emailService', () => ({
  EmailService: {
    sendBudgetAlertEmail: mock().mockResolvedValue(true),
    isConfigured: mock().mockReturnValue(true)
  }
}));

// Bun hoists mock.module above the imports, so the app below already uses the fakes.
import { app } from '../../index';
import { prisma } from '../../lib/prisma';
import { monthKey } from '../../services/budgetSyncService';

const stamp = Date.now();
const USER_ID = `budgets-route-user-${stamp}`;
const OTHER_USER_ID = `budgets-route-other-${stamp}`;
const ACCOUNT_ID = `budgets-route-account-${stamp}`;

const authHeader = () => `Bearer ${jwt.sign({ userId: USER_ID }, process.env.JWT_SECRET!)}`;

// Dates relative to today, so nothing here goes stale.
const now = new Date();
const thisMonth = monthKey(now);
const monthOffset = (offset: number) =>
  monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1)));
const startOfMonth = (offset: number) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
const dayIn = (offset: number, day = 10) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, day, 12));

let counter = 0;

async function addSpending(options: {
  amount: number;
  category?: string;
  monthOffset?: number;
  userId?: string;
}) {
  const index = counter++;
  await prisma.transaction.create({
    data: {
      id: `budgets-route-tx-${stamp}-${index}`,
      plaidTransactionId: `budgets-route-plaid-${stamp}-${index}`,
      userId: options.userId ?? USER_ID,
      accountId: ACCOUNT_ID,
      name: `Transaction ${index}`,
      amount: options.amount,
      date: dayIn(options.monthOffset ?? 0),
      primaryCategory: options.category ?? 'Groceries',
      categories: []
    }
  });
}

async function cleanup() {
  await prisma.budgetAlertNotification.deleteMany({
    where: { userId: { in: [USER_ID, OTHER_USER_ID] } }
  });
  await prisma.budgetAlert.deleteMany({
    where: { userId: { in: [USER_ID, OTHER_USER_ID] } }
  });
  await prisma.budget.deleteMany({
    where: { userId: { in: [USER_ID, OTHER_USER_ID] } }
  });
  await prisma.transaction.deleteMany({
    where: { userId: { in: [USER_ID, OTHER_USER_ID] } }
  });
  await prisma.account.deleteMany({
    where: { userId: { in: [USER_ID, OTHER_USER_ID] } }
  });
}

async function ensureUsers() {
  for (const [id, email] of [
    [USER_ID, `budgets-route-${stamp}@example.com`],
    [OTHER_USER_ID, `budgets-route-other-${stamp}@example.com`]
  ]) {
    await prisma.user.upsert({
      where: { id },
      update: {},
      create: { id, email, fullName: 'Budgets Route User', passwordHash: 'hash' }
    });
  }

  await prisma.account.upsert({
    where: { id: ACCOUNT_ID },
    update: {},
    create: {
      id: ACCOUNT_ID,
      plaidAccountId: `budgets-route-plaid-account-${stamp}`,
      userId: USER_ID,
      name: 'Budget Checking',
      type: 'checking',
      subtype: 'checking'
    }
  });
}

describe('Budgets API', () => {
  beforeAll(async () => {
    await cleanup();
    await prisma.user.deleteMany({ where: { id: { in: [USER_ID, OTHER_USER_ID] } } });
    await ensureUsers();
  });

  afterEach(async () => {
    await cleanup();
    await ensureUsers();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.user.deleteMany({ where: { id: { in: [USER_ID, OTHER_USER_ID] } } });
    await prisma.$disconnect();
  });

  it('requires authentication', async () => {
    const response = await request(app).get('/api/budgets');
    expect(response.status).toBe(401);
  });

  it('returns the current month with no budgets for a new user', async () => {
    const response = await request(app)
      .get('/api/budgets')
      .set('Authorization', authHeader());

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      month: thisMonth,
      budgets: [],
      totals: { budgeted: 0, spent: 0, available: 0, remaining: 0 }
    });
  });

  it('returns a budget with its month snapshot, history and alerts', async () => {
    const budget = await prisma.budget.create({
      data: {
        userId: USER_ID,
        name: 'Groceries',
        category: 'Groceries',
        amount: 400,
        period: 'MONTHLY',
        startDate: startOfMonth(-1),
        rollover: true
      }
    });

    await prisma.budgetAlert.create({
      data: {
        userId: USER_ID,
        budgetId: budget.id,
        alertType: 'BUDGET_APPROACHING',
        thresholdPercent: 75
      }
    });

    // Last month 300 of 400 spent, so 100 rolls into this month.
    await addSpending({ amount: 300, monthOffset: -1 });
    await addSpending({ amount: 200, monthOffset: 0 });

    const response = await request(app)
      .get(`/api/budgets?month=${thisMonth}`)
      .set('Authorization', authHeader());

    expect(response.status).toBe(200);
    expect(response.body.month).toBe(thisMonth);
    expect(response.body.budgets).toHaveLength(1);

    const row = response.body.budgets[0];
    expect(row).toMatchObject({
      id: budget.id,
      name: 'Groceries',
      category: 'Groceries',
      amount: 400,
      rollover: true,
      isActive: true,
      month: thisMonth,
      budgeted: 400,
      spent: 200,
      rolloverIn: 100,
      available: 500,
      remaining: 300
    });
    expect(row.percentUsed).toBeCloseTo(40, 2);
    expect(row.budgetAlerts).toHaveLength(1);
    expect(row.history).toHaveLength(6);
    expect(row.history[5]).toMatchObject({ month: thisMonth, budgeted: 400, spent: 200 });

    expect(response.body.totals).toEqual({
      budgeted: 400,
      spent: 200,
      available: 500,
      remaining: 300
    });
  });

  it('keeps working in a month after the creation month', async () => {
    // The old bug: a budget created months ago showed "spent 0" forever.
    await prisma.budget.create({
      data: {
        userId: USER_ID,
        name: 'Dining',
        category: 'Food & Dining',
        amount: 250,
        period: 'MONTHLY',
        startDate: startOfMonth(-2)
      }
    });

    await addSpending({ amount: 120, category: 'Food & Dining', monthOffset: 0 });

    const response = await request(app)
      .get('/api/budgets')
      .set('Authorization', authHeader());

    expect(response.status).toBe(200);
    expect(response.body.budgets[0]).toMatchObject({
      month: thisMonth,
      budgeted: 250,
      spent: 120,
      remaining: 130
    });
  });

  it('leaves out budgets that start after the requested month', async () => {
    await prisma.budget.create({
      data: {
        userId: USER_ID,
        name: 'Future',
        category: 'Travel',
        amount: 100,
        period: 'MONTHLY',
        startDate: startOfMonth(1)
      }
    });

    const thisMonthResponse = await request(app)
      .get(`/api/budgets?month=${thisMonth}`)
      .set('Authorization', authHeader());
    expect(thisMonthResponse.body.budgets).toHaveLength(0);

    const nextMonthResponse = await request(app)
      .get(`/api/budgets?month=${monthOffset(1)}`)
      .set('Authorization', authHeader());
    expect(nextMonthResponse.body.budgets).toHaveLength(1);
    expect(nextMonthResponse.body.budgets[0].month).toBe(monthOffset(1));
  });

  it('rejects a month that is not YYYY-MM', async () => {
    const response = await request(app)
      .get('/api/budgets?month=2026-13')
      .set('Authorization', authHeader());

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('month must be in YYYY-MM format');
  });

  it('creates a monthly budget that starts this month by default', async () => {
    const response = await request(app)
      .post('/api/budgets')
      .set('Authorization', authHeader())
      .send({ name: 'Groceries', category: 'Groceries', amount: 350, rollover: true });

    expect(response.status).toBe(201);
    expect(response.body.budget).toMatchObject({
      name: 'Groceries',
      category: 'Groceries',
      amount: 350,
      rollover: true,
      month: thisMonth,
      budgeted: 350,
      spent: 0,
      rolloverIn: 0,
      available: 350,
      remaining: 350
    });
    expect(response.body.budget.id).toBeTruthy();
    expect(response.body.budget.history).toHaveLength(6);
    // The default alerts come back with the new budget.
    expect(response.body.budget.budgetAlerts).toHaveLength(2);

    const stored = await prisma.budget.findUnique({ where: { id: response.body.budget.id } });
    expect(stored!.period).toBe('MONTHLY');
    expect(stored!.endDate).toBeNull();
    expect(stored!.startDate.toISOString()).toBe(startOfMonth(0).toISOString());
  });

  it('creates a budget that starts in an earlier month', async () => {
    const response = await request(app)
      .post('/api/budgets')
      .set('Authorization', authHeader())
      .send({
        name: 'Groceries',
        category: 'Groceries',
        amount: 300,
        startMonth: monthOffset(-2)
      });

    expect(response.status).toBe(201);

    const stored = await prisma.budget.findUnique({ where: { id: response.body.budget.id } });
    expect(stored!.startDate.toISOString()).toBe(startOfMonth(-2).toISOString());
  });

  it('rejects a category that is not in the list', async () => {
    const response = await request(app)
      .post('/api/budgets')
      .set('Authorization', authHeader())
      .send({ name: 'Crypto', category: 'Crypto', amount: 100 });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Invalid category');
  });

  it('rejects a zero or negative amount', async () => {
    const zero = await request(app)
      .post('/api/budgets')
      .set('Authorization', authHeader())
      .send({ name: 'Groceries', category: 'Groceries', amount: 0 });
    expect(zero.status).toBe(400);
    expect(zero.body.error).toBe('Amount must be greater than 0');

    const negative = await request(app)
      .post('/api/budgets')
      .set('Authorization', authHeader())
      .send({ name: 'Groceries', category: 'Groceries', amount: -5 });
    expect(negative.status).toBe(400);
    expect(negative.body.error).toBe('Amount must be greater than 0');
  });

  it('rejects a second active budget for the same category with 409', async () => {
    const first = await request(app)
      .post('/api/budgets')
      .set('Authorization', authHeader())
      .send({ name: 'Groceries', category: 'Groceries', amount: 300 });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/budgets')
      .set('Authorization', authHeader())
      .send({ name: 'Groceries again', category: 'Groceries', amount: 200 });

    expect(second.status).toBe(409);
    expect(second.body.error).toBe('You already have a budget for Groceries');
  });

  it('updates a budget and returns the new month snapshot', async () => {
    const budget = await prisma.budget.create({
      data: {
        userId: USER_ID,
        name: 'Travel',
        category: 'Travel',
        amount: 500,
        period: 'MONTHLY',
        startDate: startOfMonth(0)
      }
    });

    await addSpending({ amount: 100, category: 'Travel' });

    const response = await request(app)
      .put(`/api/budgets/${budget.id}`)
      .set('Authorization', authHeader())
      .send({ amount: 200, name: 'Trips', rollover: true });

    expect(response.status).toBe(200);
    expect(response.body.budget).toMatchObject({
      id: budget.id,
      name: 'Trips',
      amount: 200,
      rollover: true,
      spent: 100,
      available: 200,
      remaining: 100
    });
    expect(response.body.budget.budgetAlerts).toBeDefined();
    expect(response.body.budget.history).toHaveLength(6);
  });

  it('rejects an update that duplicates another category', async () => {
    await prisma.budget.create({
      data: {
        userId: USER_ID,
        name: 'Groceries',
        category: 'Groceries',
        amount: 300,
        startDate: startOfMonth(0)
      }
    });

    const travel = await prisma.budget.create({
      data: {
        userId: USER_ID,
        name: 'Travel',
        category: 'Travel',
        amount: 200,
        startDate: startOfMonth(0)
      }
    });

    const response = await request(app)
      .put(`/api/budgets/${travel.id}`)
      .set('Authorization', authHeader())
      .send({ category: 'Groceries' });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('You already have a budget for Groceries');
  });

  it('rejects an invalid category on update', async () => {
    const budget = await prisma.budget.create({
      data: {
        userId: USER_ID,
        name: 'Travel',
        category: 'Travel',
        amount: 200,
        startDate: startOfMonth(0)
      }
    });

    const response = await request(app)
      .put(`/api/budgets/${budget.id}`)
      .set('Authorization', authHeader())
      .send({ category: 'Crypto' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Invalid category');
  });

  it('deletes a budget', async () => {
    const budget = await prisma.budget.create({
      data: {
        userId: USER_ID,
        name: 'Travel',
        category: 'Travel',
        amount: 200,
        startDate: startOfMonth(0)
      }
    });

    const response = await request(app)
      .delete(`/api/budgets/${budget.id}`)
      .set('Authorization', authHeader());

    expect(response.status).toBe(200);
    expect(await prisma.budget.findUnique({ where: { id: budget.id } })).toBeNull();
  });

  it('never touches another user\'s budgets', async () => {
    const other = await prisma.budget.create({
      data: {
        userId: OTHER_USER_ID,
        name: 'Not mine',
        category: 'Groceries',
        amount: 900,
        startDate: startOfMonth(0)
      }
    });

    const list = await request(app)
      .get('/api/budgets')
      .set('Authorization', authHeader());
    expect(list.body.budgets).toHaveLength(0);

    const update = await request(app)
      .put(`/api/budgets/${other.id}`)
      .set('Authorization', authHeader())
      .send({ amount: 1 });
    expect(update.status).toBe(404);

    const remove = await request(app)
      .delete(`/api/budgets/${other.id}`)
      .set('Authorization', authHeader());
    expect(remove.status).toBe(404);

    expect(await prisma.budget.findUnique({ where: { id: other.id } })).not.toBeNull();
  });

  it('still serves GET /api/budgets/categories', async () => {
    for (let index = 0; index < 5; index++) {
      await addSpending({ amount: 10, category: 'Groceries' });
    }

    const response = await request(app)
      .get('/api/budgets/categories')
      .set('Authorization', authHeader());

    expect(response.status).toBe(200);
    expect(response.body.categories).toContain('Groceries');
  });
});
