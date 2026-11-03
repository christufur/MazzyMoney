import { describe, it, expect, beforeAll, afterEach, afterAll, mock, type Mock } from 'bun:test';
import { prisma } from '../../lib/prisma';
import { BudgetAlertService } from '../../services/budgetAlertService';
import { BudgetSyncService, monthKey } from '../../services/budgetSyncService';
import { EmailService } from '../../services/emailService';

mock.module('../../services/emailService', () => ({
  EmailService: {
    sendBudgetAlertEmail: mock().mockResolvedValue(true),
    isConfigured: mock().mockReturnValue(true)
  }
}));

const mockSendEmail = EmailService.sendBudgetAlertEmail as unknown as Mock<any>;

// Dates are relative to today, so this file never goes stale.
const stamp = Date.now();
const now = new Date();
const userId = `alerts-test-user-${stamp}`;
const userEmail = `alerts-${stamp}@example.com`;
const accountId = `alerts-test-account-${stamp}`;

const thisMonth = monthKey(now);
const monthOffset = (offset: number) =>
  monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1)));
const startOfMonth = (offset: number) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
const dayIn = (offset: number, day = 10) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, day, 12));

let counter = 0;

async function addSpending(amount: number, options: { monthOffset?: number } = {}) {
  const index = counter++;
  await prisma.transaction.create({
    data: {
      id: `alerts-tx-${stamp}-${index}`,
      plaidTransactionId: `alerts-plaid-${stamp}-${index}`,
      userId,
      accountId,
      name: `Purchase ${index}`,
      amount,
      date: dayIn(options.monthOffset ?? 0),
      primaryCategory: 'Groceries',
      categories: []
    }
  });
}

const makeBudget = (overrides: Record<string, unknown> = {}) =>
  prisma.budget.create({
    data: {
      userId,
      name: 'Groceries',
      category: 'Groceries',
      amount: 500,
      period: 'MONTHLY',
      startDate: startOfMonth(0),
      endDate: null,
      rollover: false,
      ...overrides
    }
  });

/** The snapshot the routes pass in, straight from the shared calculator. */
const snapshotFor = (budget: any, month: string) =>
  BudgetSyncService.budgetForMonth(budget, month);

describe('BudgetAlertService', () => {
  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });

    await prisma.user.create({
      data: { id: userId, email: userEmail, fullName: 'Alert Tester', passwordHash: 'hash' }
    });

    await prisma.account.create({
      data: {
        id: accountId,
        plaidAccountId: `alerts-plaid-account-${stamp}`,
        userId,
        name: 'Alert Checking',
        type: 'checking',
        subtype: 'checking'
      }
    });
  });

  afterEach(async () => {
    mockSendEmail.mockClear();
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

  it('creates the default alerts for a new budget', async () => {
    const budget = await makeBudget();

    await BudgetAlertService.ensureDefaultAlerts(budget);
    // A second call must not duplicate them.
    await BudgetAlertService.ensureDefaultAlerts(budget);

    const alerts = await prisma.budgetAlert.findMany({ where: { budgetId: budget.id } });
    expect(alerts).toHaveLength(2);
    expect(alerts.map(alert => alert.alertType).sort()).toEqual([
      'BUDGET_APPROACHING',
      'BUDGET_EXCEEDED'
    ]);
  });

  it('notifies once when a budget crosses its thresholds', async () => {
    const budget = await makeBudget();

    // 460 of 500 is 92%: over the 80% and under the 100% alert.
    await addSpending(460);

    await BudgetAlertService.evaluateBudgetAlerts(budget, await snapshotFor(budget, thisMonth));

    const alerts = await prisma.budgetAlert.findMany({ where: { budgetId: budget.id } });
    const approaching = alerts.find(alert => alert.alertType === 'BUDGET_APPROACHING');
    const exceeded = alerts.find(alert => alert.alertType === 'BUDGET_EXCEEDED');

    const notifications = await prisma.budgetAlertNotification.findMany({
      where: { userId, alertId: approaching!.id }
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ currentPercent: 92, spent: 460, budgetAmount: 500 });
    expect(mockSendEmail).toHaveBeenCalledTimes(1);

    const exceededNotifications = await prisma.budgetAlertNotification.findMany({
      where: { userId, alertId: exceeded!.id }
    });
    expect(exceededNotifications).toHaveLength(0);
  });

  it('does not send the same alert twice in one month', async () => {
    const budget = await makeBudget();
    await BudgetAlertService.ensureDefaultAlerts(budget);
    await prisma.budgetAlert.updateMany({
      where: { budgetId: budget.id },
      data: { thresholdPercent: 50 }
    });

    // 250 of 500 is 50%, so both alerts fire once.
    await addSpending(250);

    await BudgetAlertService.evaluateUserBudgets(userId);
    expect(mockSendEmail).toHaveBeenCalledTimes(2);
    mockSendEmail.mockClear();

    await BudgetAlertService.evaluateUserBudgets(userId);

    expect(mockSendEmail).not.toHaveBeenCalled();
    const notifications = await prisma.budgetAlertNotification.findMany({ where: { userId } });
    expect(notifications).toHaveLength(2);
  });

  it('sends again in a new month after notifying last month', async () => {
    const budget = await makeBudget();
    await BudgetAlertService.ensureDefaultAlerts(budget);
    await prisma.budgetAlert.updateMany({
      where: { budgetId: budget.id },
      data: { thresholdPercent: 50 }
    });

    await addSpending(300);
    await BudgetAlertService.evaluateUserBudgets(userId);

    const firstRun = await prisma.budgetAlertNotification.findMany({ where: { userId } });
    expect(firstRun).toHaveLength(2);

    // The alerts went out last month; this month's spending must still notify.
    await prisma.budgetAlertNotification.updateMany({
      where: { userId },
      data: { sentAt: dayIn(-1, 5) }
    });
    mockSendEmail.mockClear();

    await BudgetAlertService.evaluateUserBudgets(userId);

    expect(mockSendEmail).toHaveBeenCalledTimes(2);

    const thisMonthNotifications = await prisma.budgetAlertNotification.findMany({
      where: { userId, sentAt: { gte: startOfMonth(0) } }
    });
    expect(thisMonthNotifications).toHaveLength(2);
    expect(thisMonthNotifications[0].spent).toBe(300);
  });

  it('keeps last month notifications so the next month can still fire', async () => {
    const budget = await makeBudget({ startDate: startOfMonth(-1) });
    await BudgetAlertService.ensureDefaultAlerts(budget);

    const alert = await prisma.budgetAlert.findFirst({
      where: { budgetId: budget.id, alertType: 'BUDGET_APPROACHING' }
    });

    // A notification from last month for the same alert.
    await prisma.budgetAlertNotification.create({
      data: {
        alertId: alert!.id,
        userId,
        budgetName: budget.name,
        category: budget.category,
        thresholdPercent: alert!.thresholdPercent,
        currentPercent: 90,
        spent: 450,
        budgetAmount: 500,
        sentAt: dayIn(-1, 15)
      }
    });

    // This month is only at 20%, so nothing fires yet.
    await addSpending(100);
    await BudgetAlertService.evaluateUserBudgets(userId);
    expect(mockSendEmail).not.toHaveBeenCalled();

    // Add spending past the threshold: this month's first alert goes out.
    await addSpending(350);
    await BudgetAlertService.evaluateUserBudgets(userId);

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const thisMonthNotifications = await prisma.budgetAlertNotification.findMany({
      where: { userId, alertId: alert!.id, sentAt: { gte: startOfMonth(0) } }
    });
    expect(thisMonthNotifications).toHaveLength(1);
  });

  it('skips disabled alerts', async () => {
    const budget = await makeBudget();
    await BudgetAlertService.ensureDefaultAlerts(budget);

    const approaching = await prisma.budgetAlert.findFirst({
      where: { budgetId: budget.id, alertType: 'BUDGET_APPROACHING' }
    });

    await prisma.budgetAlert.update({
      where: { id: approaching!.id },
      data: { thresholdPercent: 10, isEnabled: false }
    });

    await addSpending(100);
    await BudgetAlertService.evaluateUserBudgets(userId);

    const notifications = await prisma.budgetAlertNotification.findMany({
      where: { alertId: approaching!.id }
    });
    expect(notifications).toHaveLength(0);
  });

  it('skips budgets that have not started yet', async () => {
    await makeBudget({ name: 'Future', category: 'Travel', startDate: startOfMonth(1) });

    await addSpending(400);
    await BudgetAlertService.evaluateUserBudgets(userId);

    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('uses available money including rollover for the percentage', async () => {
    const budget = await makeBudget({ rollover: true, startDate: startOfMonth(-1) });

    // Last month: 100 of 500 spent, so 400 rolls over.
    await addSpending(100, { monthOffset: -1 });
    // This month: 450 spent against 500 + 400 = 900 available, so 50%.
    await addSpending(450, { monthOffset: 0 });

    await BudgetAlertService.evaluateUserBudgets(userId);

    // 50% is under both default thresholds (80% and 100%).
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(await prisma.budgetAlertNotification.count({ where: { userId } })).toBe(0);
  });

  it('fires when rollover money runs out', async () => {
    const budget = await makeBudget({ rollover: true, startDate: startOfMonth(-1) });

    // Last month overspent by 100: this month has 400 available.
    await addSpending(600, { monthOffset: -1 });
    // 360 of 400 is 90%: over the 80% alert.
    await addSpending(360, { monthOffset: 0 });

    await BudgetAlertService.evaluateUserBudgets(userId);

    const notifications = await prisma.budgetAlertNotification.findMany({ where: { userId } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      currentPercent: 90,
      spent: 360,
      budgetAmount: 400
    });
  });
});
