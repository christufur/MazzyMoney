import { prisma } from '../../lib/prisma';
import { BudgetAlertService } from '../../services/budgetAlertService';
import { EmailService } from '../../services/emailService';

jest.mock('../../services/emailService', () => ({
  EmailService: {
    sendBudgetAlertEmail: jest.fn().mockResolvedValue(true),
    isConfigured: jest.fn().mockReturnValue(true)
  }
}));

const mockSendEmail = EmailService.sendBudgetAlertEmail as unknown as jest.Mock;

describe('BudgetAlertService', () => {
  const userId = 'test-user';
  const userEmail = 'alerts@example.com';
  const accountId = 'alert-account';
  const budgetData = {
    name: 'Groceries',
    category: 'Food & Dining',
    amount: 500,
    period: 'MONTHLY' as const,
    startDate: new Date('2025-09-01T00:00:00Z'),
    endDate: new Date('2025-09-30T23:59:59Z'),
    isActive: true
  };

  beforeAll(async () => {
    await prisma.budgetAlertNotification.deleteMany({});
    await prisma.budgetAlert.deleteMany({});
    await prisma.transaction.deleteMany({});
    await prisma.budget.deleteMany({});
    await prisma.account.deleteMany({});
    await prisma.user.deleteMany({ where: { email: userEmail } });

    await prisma.user.create({
      data: {
        id: userId,
        email: userEmail,
        fullName: 'Alert Tester',
        passwordHash: 'hash'
      }
    });

    await prisma.account.upsert({
      where: { id: accountId },
      update: {},
      create: {
        id: accountId,
        plaidAccountId: 'alert-plaid',
        userId,
        name: 'Checking',
        type: 'checking',
        subtype: 'checking'
      }
    });
  });

  afterEach(async () => {
    mockSendEmail.mockClear();
    await prisma.budgetAlertNotification.deleteMany({});
    await prisma.budgetAlert.deleteMany({});
    await prisma.transaction.deleteMany({});
    await prisma.budget.deleteMany({});
    await prisma.account.deleteMany({});
  });

  afterAll(async () => {
    await prisma.budgetAlertNotification.deleteMany({});
    await prisma.budgetAlert.deleteMany({});
    await prisma.transaction.deleteMany({});
    await prisma.budget.deleteMany({});
    await prisma.account.deleteMany({});
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('creates default alerts and sends notification when threshold exceeded', async () => {
    const budget = await prisma.budget.create({
      data: {
        id: 'budget-default-alerts',
        userId,
        ...budgetData
      }
    });

    const persistedBudget = await prisma.budget.findUnique({ where: { id: budget.id } });

    await BudgetAlertService.ensureDefaultAlerts(persistedBudget!);

    await prisma.transaction.create({
      data: {
        id: 'tx-1',
        plaidTransactionId: 'plaid-tx-1',
        userId,
        accountId,
        name: 'Whole Foods',
        amount: 460,
        date: new Date('2025-09-10'),
        primaryCategory: 'Food & Dining',
        categories: ['Food and Drink'],
        createdAt: new Date(),
        updatedAt: new Date()
      }
    });

    const reloadedBudget = await prisma.budget.findUnique({ where: { id: budget.id } });

    await BudgetAlertService.evaluateBudgetAlerts(reloadedBudget!, {
      spent: 460,
      remaining: 40,
      percentUsed: 92
    });

    const alerts = await prisma.budgetAlert.findMany({ where: { budgetId: budget.id } });
    expect(alerts).toHaveLength(2);
    expect(alerts.map(a => a.alertType).sort()).toEqual([
      'BUDGET_APPROACHING',
      'BUDGET_EXCEEDED'
    ]);

    const notification = await prisma.budgetAlertNotification.findFirst({
      where: {
        budgetName: budget.name,
        alertId: alerts.find(a => a.alertType === 'BUDGET_APPROACHING')?.id
      }
    });

    expect(notification).not.toBeNull();
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  it('does not resend notification within budget period', async () => {
    const budget = await prisma.budget.create({
      data: {
        id: 'budget-no-duplicate',
        userId,
        ...budgetData
      }
    });

    const persistedBudget = await prisma.budget.findUnique({ where: { id: budget.id } });

    await BudgetAlertService.ensureDefaultAlerts(persistedBudget!);
    await prisma.budgetAlert.updateMany({
      where: { budgetId: budget.id },
      data: { thresholdPercent: 50 }
    });

    await prisma.account.upsert({
      where: { id: `${accountId}-dup` },
      update: {},
      create: {
        id: `${accountId}-dup`,
        plaidAccountId: 'alert-plaid-dup',
        userId,
        name: 'Checking Dup',
        type: 'checking',
        subtype: 'checking'
      }
    });

    await prisma.transaction.create({
      data: {
        id: 'tx-dup-1',
        plaidTransactionId: 'plaid-dup-1',
        userId,
        accountId: `${accountId}-dup`,
        name: 'Trader Joes',
        amount: 250,
        date: new Date('2025-09-05'),
        primaryCategory: 'Food & Dining',
        categories: ['Food and Drink'],
        createdAt: new Date(),
        updatedAt: new Date()
      }
    });

    await BudgetAlertService.evaluateUserBudgets(userId);
    mockSendEmail.mockClear();

    await BudgetAlertService.evaluateUserBudgets(userId);

    expect(mockSendEmail).not.toHaveBeenCalled();
    const notifications = await prisma.budgetAlertNotification.findMany({
      where: { alert: { budgetId: budget.id } }
    });
    expect(notifications).toHaveLength(2);
  });

  it('skips emails when alert disabled', async () => {
    const budget = await prisma.budget.create({
      data: {
        id: 'budget-disabled-alert',
        userId,
        ...budgetData
      }
    });

    const persistedBudget = await prisma.budget.findUnique({ where: { id: budget.id } });

    await BudgetAlertService.ensureDefaultAlerts(persistedBudget!);
    const approachingAlert = await prisma.budgetAlert.findFirst({
      where: { budgetId: budget.id, alertType: 'BUDGET_APPROACHING' }
    });

    expect(approachingAlert).not.toBeNull();

    await prisma.budgetAlert.update({
      where: { id: approachingAlert!.id },
      data: {
        thresholdPercent: 10,
        isEnabled: false
      }
    });

    await prisma.account.upsert({
      where: { id: `${accountId}-disabled` },
      update: {},
      create: {
        id: `${accountId}-disabled`,
        plaidAccountId: 'alert-plaid-disabled',
        userId,
        name: 'Checking Disabled',
        type: 'checking',
        subtype: 'checking'
      }
    });

    await prisma.transaction.create({
      data: {
        id: 'tx-disabled',
        plaidTransactionId: 'plaid-disabled',
        userId,
        accountId: `${accountId}-disabled`,
        name: 'Coffee',
        amount: 100,
        date: new Date('2025-09-02'),
        primaryCategory: 'Food & Dining',
        categories: ['Food and Drink'],
        createdAt: new Date(),
        updatedAt: new Date()
      }
    });

    await BudgetAlertService.evaluateUserBudgets(userId);

    expect(mockSendEmail).not.toHaveBeenCalled();
    const notifications = await prisma.budgetAlertNotification.findMany({
      where: { alertId: approachingAlert!.id }
    });
    expect(notifications).toHaveLength(0);
  });
});

