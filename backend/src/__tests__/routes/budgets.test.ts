import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

import { app } from '../../index';
import { prisma } from '../../lib/prisma';

jest.mock('../../services/emailService', () => ({
  EmailService: {
    sendBudgetAlertEmail: jest.fn().mockResolvedValue(true),
    isConfigured: jest.fn().mockReturnValue(true)
  }
}));

const TEST_USER_ID = 'budgets-route-user';

const authHeader = () => `Bearer ${jwt.sign({ userId: TEST_USER_ID }, process.env.JWT_SECRET!)}`;

const ensureUserAndAccount = async () => {  const user = await prisma.user.findUnique({ where: { id: TEST_USER_ID } });
  if (!user) {
    await prisma.user.create({
      data: {
        id: TEST_USER_ID,
        email: 'budget@example.com',
        fullName: 'Budget User',
        passwordHash: 'hash'
      }
    });
  }

  await prisma.account.upsert({
    where: { id: 'budget-account' },
    update: {},
    create: {
      id: 'budget-account',
      plaidAccountId: 'budget-plaid',
      userId: TEST_USER_ID,
      name: 'Checking',
      type: 'checking',
      subtype: 'checking'
    }
  });
};

describe('Budgets API', () => {
  beforeAll(async () => {
    await prisma.budgetAlertNotification.deleteMany({});
    await prisma.budgetAlert.deleteMany({});
    await prisma.transaction.deleteMany({});
    await prisma.account.deleteMany({});
    await prisma.budget.deleteMany({});
    await prisma.user.deleteMany({ where: { id: TEST_USER_ID } });
    await ensureUserAndAccount();
  });

  afterEach(async () => {
    await prisma.budgetAlertNotification.deleteMany({ where: { userId: TEST_USER_ID } });
    await prisma.budgetAlert.deleteMany({ where: { userId: TEST_USER_ID } });
    await prisma.budget.deleteMany({ where: { userId: TEST_USER_ID } });
    await ensureUserAndAccount();
  });

  afterAll(async () => {
    await prisma.transaction.deleteMany({ where: { userId: TEST_USER_ID } });
    await prisma.account.deleteMany({ where: { userId: TEST_USER_ID } });
    await prisma.user.deleteMany({ where: { id: TEST_USER_ID } });
    await prisma.$disconnect();
  });

  it('fetches budgets including alerts and spending snapshot', async () => {
    const budget = await prisma.budget.create({
      data: {
        id: 'route-budget-1',
        userId: TEST_USER_ID,
        name: 'Groceries',
        category: 'Food & Dining',
        amount: 300,
        period: 'MONTHLY',
        startDate: new Date('2025-09-01T00:00:00Z'),
        endDate: new Date('2025-09-30T23:59:59Z')
      }
    });

    await prisma.budgetAlert.create({
      data: {
        id: 'route-budget-alert',
        userId: TEST_USER_ID,
        budgetId: budget.id,
        alertType: 'BUDGET_APPROACHING',
        thresholdPercent: 75
      }
    });

    const response = await request(app)
      .get('/api/budgets')
      .set('Authorization', authHeader());

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.budgets)).toBe(true);
    expect(response.body.budgets[0]).toMatchObject({
      id: budget.id,
      budgetAlerts: expect.any(Array)
    });
  });

  it('creates budgets and returns calculated spending with alerts', async () => {
    const response = await request(app)
      .post('/api/budgets')
      .set('Authorization', authHeader())
      .send({
        name: 'Entertainment',
        category: 'Entertainment',
        amount: 150,
        period: 'MONTHLY'
      });

    expect(response.status).toBe(201);
    expect(response.body.budget).toMatchObject({
      name: 'Entertainment',
      budgetAlerts: expect.any(Array)
    });
  });

  it('updates budgets and re-evaluates alerts', async () => {
    const budget = await prisma.budget.create({
      data: {
        id: 'route-budget-update',
        userId: TEST_USER_ID,
        name: 'Travel',
        category: 'Travel',
        amount: 500,
        period: 'MONTHLY',
        startDate: new Date('2025-09-01'),
        endDate: new Date('2025-09-30')
      }
    });

    const response = await request(app)
      .put(`/api/budgets/${budget.id}`)
      .set('Authorization', authHeader())
      .send({ amount: 600 });

    expect(response.status).toBe(200);
    expect(response.body.budget.amount).toBe(600);
    expect(response.body.budget.budgetAlerts).toBeDefined();
  });
});

