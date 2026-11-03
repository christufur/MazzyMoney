import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, mock } from 'bun:test';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

import { app } from '../../index';
import { prisma } from '../../lib/prisma';

mock.module('../../services/emailService', () => ({
  EmailService: {
    sendBudgetAlertEmail: mock().mockResolvedValue(true),
    isConfigured: mock().mockReturnValue(true)
  }
}));

const stamp = Date.now();
const TEST_USER_ID = `budget-alerts-route-user-${stamp}`;
const OTHER_USER_ID = `budget-alerts-route-other-${stamp}`;
const TEST_BUDGET_ID = `budget-alerts-route-budget-${stamp}`;

// A budget is monthly and repeats, so its start month is the only date it keeps.
const now = new Date();
const startOfMonth = () => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

const ensureUsers = async () => {
  for (const [id, email] of [
    [TEST_USER_ID, `budget-alerts-route-${stamp}@example.com`],
    [OTHER_USER_ID, `budget-alerts-route-other-${stamp}@example.com`]
  ]) {
    await prisma.user.upsert({
      where: { id },
      update: {},
      create: { id, email, fullName: 'Route Tester', passwordHash: 'hash' }
    });
  }
};

const authHeader = () =>
  `Bearer ${jwt.sign({ userId: TEST_USER_ID }, process.env.JWT_SECRET!)}`;

const cleanup = async () => {
  await prisma.budgetAlertNotification.deleteMany({
    where: { userId: { in: [TEST_USER_ID, OTHER_USER_ID] } }
  });
  await prisma.budgetAlert.deleteMany({
    where: { userId: { in: [TEST_USER_ID, OTHER_USER_ID] } }
  });
  await prisma.budget.deleteMany({
    where: { userId: { in: [TEST_USER_ID, OTHER_USER_ID] } }
  });
};

describe('Budget Alerts Routes', () => {
  beforeAll(async () => {
    await cleanup();
    await prisma.user.deleteMany({ where: { id: { in: [TEST_USER_ID, OTHER_USER_ID] } } });
    await ensureUsers();
  });

  beforeEach(async () => {
    await cleanup();
    await ensureUsers();
    await prisma.budget.create({
      data: {
        id: TEST_BUDGET_ID,
        userId: TEST_USER_ID,
        name: 'Dining',
        category: 'Food & Dining',
        amount: 400,
        period: 'MONTHLY',
        startDate: startOfMonth(),
        endDate: null,
        rollover: true
      }
    });
  });

  afterEach(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.user.deleteMany({ where: { id: { in: [TEST_USER_ID, OTHER_USER_ID] } } });
    await prisma.$disconnect();
  });

  it('lists alerts for a budget', async () => {
    await prisma.budgetAlert.create({
      data: {
        id: `budget-alerts-route-alert-1-${stamp}`,
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

  it('rejects a duplicate alert type for the same budget', async () => {
    await prisma.budgetAlert.create({
      data: {
        userId: TEST_USER_ID,
        budgetId: TEST_BUDGET_ID,
        alertType: 'SPENDING_THRESHOLD',
        thresholdPercent: 60
      }
    });

    const response = await request(app)
      .post(`/api/budgets/${TEST_BUDGET_ID}/alerts`)
      .set('Authorization', authHeader())
      .send({ thresholdPercent: 70, alertType: 'SPENDING_THRESHOLD' });

    expect(response.status).toBe(409);
  });

  it('updates an existing alert', async () => {
    const alert = await prisma.budgetAlert.create({
      data: {
        id: `budget-alerts-route-alert-update-${stamp}`,
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
      .send({ thresholdPercent: 110, emailEnabled: false });

    expect(response.status).toBe(200);
    expect(response.body.alert.thresholdPercent).toBe(110);
    expect(response.body.alert.emailEnabled).toBe(false);
  });

  it('deletes an alert', async () => {
    const alert = await prisma.budgetAlert.create({
      data: {
        id: `budget-alerts-route-alert-delete-${stamp}`,
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
    expect(await prisma.budgetAlert.findUnique({ where: { id: alert.id } })).toBeNull();
  });

  it('does not expose alerts on another user\'s budget', async () => {
    const otherBudget = await prisma.budget.create({
      data: {
        userId: OTHER_USER_ID,
        name: 'Not mine',
        category: 'Groceries',
        amount: 100,
        startDate: startOfMonth()
      }
    });

    await prisma.budgetAlert.create({
      data: {
        userId: OTHER_USER_ID,
        budgetId: otherBudget.id,
        alertType: 'BUDGET_APPROACHING',
        thresholdPercent: 80
      }
    });

    const list = await request(app)
      .get(`/api/budgets/${otherBudget.id}/alerts`)
      .set('Authorization', authHeader());
    expect(list.body.alerts).toHaveLength(0);

    const create = await request(app)
      .post(`/api/budgets/${otherBudget.id}/alerts`)
      .set('Authorization', authHeader())
      .send({ thresholdPercent: 90, alertType: 'BUDGET_EXCEEDED' });
    expect(create.status).toBe(404);
  });
});
