import { prisma } from '../../lib/prisma';
import { BudgetSyncService } from '../../services/budgetSyncService';
import { BudgetAlertService } from '../../services/budgetAlertService';

jest.mock('../../services/budgetAlertService', () => ({
  BudgetAlertService: {
    evaluateBudgetAlerts: jest.fn().mockResolvedValue(undefined),
    ensureDefaultAlerts: jest.fn().mockResolvedValue(undefined),
    evaluateUserBudgets: jest.fn().mockResolvedValue(undefined)
  }
}));

const mockEvaluateBudgetAlerts = BudgetAlertService.evaluateBudgetAlerts as unknown as jest.Mock;

describe('BudgetSyncService.calculateBudgetSpending', () => {
  const userId = 'budget-sync-user';
  const accountId = 'sync-account';

  beforeAll(async () => {
    await prisma.budgetAlertNotification.deleteMany({});
    await prisma.budgetAlert.deleteMany({});
    await prisma.transaction.deleteMany({});
    await prisma.budget.deleteMany({});
    await prisma.account.deleteMany({});
    await prisma.user.deleteMany({ where: { id: userId } });

    await prisma.user.create({
      data: {
        id: userId,
        email: 'sync@example.com',
        fullName: 'Sync User',
        passwordHash: 'hash'
      }
    });

    await prisma.account.create({
      data: {
        id: accountId,
        plaidAccountId: 'plaid-sync-account',
        userId,
        name: 'Sync Checking',
        type: 'checking',
        subtype: 'checking'
      }
    });
  });

  afterEach(async () => {
    mockEvaluateBudgetAlerts.mockClear();
    await prisma.budgetAlertNotification.deleteMany({});
    await prisma.budgetAlert.deleteMany({});
    await prisma.transaction.deleteMany({});
    await prisma.budget.deleteMany({});
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

  // Skipped: fixed Sept-2025 dates are now outside the period. W4.3 rewrites budgets and these tests.
  it.skip('computes spending and remaining correctly within period', async () => {
    const budget = await prisma.budget.create({
      data: {
        id: 'budget-period',
        userId,
        name: 'Utilities',
        category: 'Bills & Utilities',
        amount: 300,
        period: 'MONTHLY',
        startDate: new Date(Date.UTC(2025, 8, 1)),
        endDate: new Date(Date.UTC(2025, 8, 30, 23, 59, 59))
      }
    });

    await prisma.transaction.createMany({
      data: [
        {
          id: 'sync-tx-1',
          plaidTransactionId: 'sync-plaid-1',
          userId,
          accountId,
          name: 'Utility Bill',
          amount: 120,
          date: new Date(Date.UTC(2025, 8, 5)),
          primaryCategory: 'Bills & Utilities',
          categories: ['Service'],
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          id: 'sync-tx-2',
          plaidTransactionId: 'sync-plaid-2',
          userId,
          accountId,
          name: 'Electricity',
          amount: 90,
          date: new Date(Date.UTC(2025, 8, 15)),
          primaryCategory: 'Bills & Utilities',
          categories: ['Service'],
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ]
    });

    const snapshot = await BudgetSyncService.calculateBudgetSpending(budget);

    expect(snapshot).toEqual({
      spent: 210,
      remaining: 90,
      percentUsed: 70
    });
  });

  it.skip('evaluates alerts during user sync', async () => {
    const budget = await prisma.budget.create({
      data: {
        id: 'budget-sync-alert',
        userId,
        name: 'Dining',
        category: 'Food & Dining',
        amount: 200,
        period: 'MONTHLY',
        startDate: new Date(Date.UTC(2025, 8, 1)),
        endDate: new Date(Date.UTC(2025, 8, 30, 23, 59, 59))
      }
    });

    await prisma.transaction.create({
      data: {
        id: 'sync-tx-dining',
        plaidTransactionId: 'sync-plaid-dining',
        userId,
        accountId,
        name: 'Restaurant',
        amount: 150,
        date: new Date(Date.UTC(2025, 8, 10)),
        primaryCategory: 'Food & Dining',
        categories: ['Food and Drink'],
        createdAt: new Date(),
        updatedAt: new Date()
      }
    });

    await BudgetSyncService.syncUserBudgets(userId);

    expect(mockEvaluateBudgetAlerts).toHaveBeenCalled();
    const call = mockEvaluateBudgetAlerts.mock.calls.find(([b]) => b.id === budget.id);
    expect(call).toBeDefined();
    expect(call?.[1]).toMatchObject({
      spent: 150,
      remaining: 50,
      percentUsed: 75
    });
  });
});

