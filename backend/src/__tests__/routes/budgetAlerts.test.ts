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

const TEST_USER_ID = 'budget-route-user';
const TEST_BUDGET_ID = 'budget-route-id';

const ensureUser = async () => {
  await prisma.user.upsert({
    where: { id: TEST_USER_ID },
    update: {},
    create: {
      id: TEST_USER_ID,
      email: 'route@example.com',
      fullName: 'Route Tester',
      passwordHash: 'hash'
    }
  });
};

const authHeader = () => {
  const token = jwt.sign({ userId: TEST_USER_ID }, process.env.JWT_SECRET!);
  return `Bearer ${token}`;
};

describe('Budget Alerts Routes', () => {
  beforeAll(async () => {
    await prisma.budgetAlertNotification.deleteMany({});
    await prisma.budgetAlert.deleteMany({});
    await prisma.transaction.deleteMany({});
    await prisma.account.deleteMany({});
    await prisma.budget.deleteMany({});
    await prisma.user.deleteMany({ where: { id: TEST_USER_ID } });
    await ensureUser();
  });

  afterEach(async () => {
    await prisma.budgetAlertNotification.deleteMany({ where: { userId: TEST_USER_ID } });
    await prisma.budgetAlert.deleteMany({ where: { budgetId: TEST_BUDGET_ID } });
    await prisma.transaction.deleteMany({ where: { userId: TEST_USER_ID } });
    await prisma.account.deleteMany({ where: { userId: TEST_USER_ID } });
    await prisma.budget.deleteMany({ where: { userId: TEST_USER_ID } });
    await ensureUser();
  });

  beforeEach(async () => {
    await ensureUser();
    await prisma.budget.deleteMany({ where: { id: TEST_BUDGET_ID } });
    await prisma.budget.create({
      data: {
        id: TEST_BUDGET_ID,
        userId: TEST_USER_ID,
        name: 'Dining',
        category: 'Food & Dining',
        amount: 400,
        period: 'MONTHLY',
        startDate: new Date(Date.UTC(2025, 8, 1)),
        endDate: new Date(Date.UTC(2025, 8, 30, 23, 59, 59))
      }
    });
  });

  afterAll(async () => {
    await prisma.budgetAlertNotification.deleteMany({});
    await prisma.budgetAlert.deleteMany({});
    await prisma.transaction.deleteMany({});
    await prisma.account.deleteMany({});
    await prisma.budget.deleteMany({});
    await prisma.user.deleteMany({ where: { id: TEST_USER_ID } });
    await prisma.$disconnect();
  });

  it('lists alerts for a budget', async () => {
    await prisma.budgetAlert.create({
      data: {
        id: 'route-alert-1',
        userId: TEST_USER_ID,
        budgetId: TEST_BUDGET_ID,
        alertType: 'BUDGET_APPROACHING',
        thresholdPercent: 75
      }
    });

    const response = await request(app)
      .get(`/api/budgets/${TEST_BUDGET_ID}/alerts`)
      .set('Authorization', authHeader());

    expect(response.status).toBe(200);
    expect(response.body.alerts).toHaveLength(1);
    expect(response.body.alerts[0]).toMatchObject({
      alertType: 'BUDGET_APPROACHING',
      thresholdPercent: 75
    });
  });

  it('creates a new alert for a budget', async () => {
    const response = await request(app)
      .post(`/api/budgets/${TEST_BUDGET_ID}/alerts`)
      .set('Authorization', authHeader())
      .send({
        thresholdPercent: 60,
        alertType: 'SPENDING_THRESHOLD',
        emailEnabled: false
      });

    expect(response.status).toBe(201);
    expect(response.body.alert).toMatchObject({
      thresholdPercent: 60,
      alertType: 'SPENDING_THRESHOLD',
      emailEnabled: false
    });
  });

  it('updates an existing alert', async () => {
    const alert = await prisma.budgetAlert.create({
      data: {
        id: 'route-alert-update',
        userId: TEST_USER_ID,
        budgetId: TEST_BUDGET_ID,
        alertType: 'BUDGET_EXCEEDED',
        thresholdPercent: 100,
        emailEnabled: true
      }
    });

    const response = await request(app)
      .put(`/api/budgets/${TEST_BUDGET_ID}/alerts/${alert.id}`)
      .set('Authorization', authHeader())
      .send({
        thresholdPercent: 110,
        emailEnabled: false
      });

    expect(response.status).toBe(200);
    expect(response.body.alert.thresholdPercent).toBe(110);
    expect(response.body.alert.emailEnabled).toBe(false);
  });

  it('deletes an alert', async () => {
    const alert = await prisma.budgetAlert.create({
      data: {
        id: 'route-alert-delete',
        userId: TEST_USER_ID,
        budgetId: TEST_BUDGET_ID,
        alertType: 'BUDGET_APPROACHING',
        thresholdPercent: 80
      }
    });

    const response = await request(app)
      .delete(`/api/budgets/${TEST_BUDGET_ID}/alerts/${alert.id}`)
      .set('Authorization', authHeader());

    expect(response.status).toBe(200);
    const deleted = await prisma.budgetAlert.findUnique({ where: { id: alert.id } });
    expect(deleted).toBeNull();
  });
});

