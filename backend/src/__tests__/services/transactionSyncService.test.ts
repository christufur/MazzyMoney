import { prisma } from '../../lib/prisma';
import { TransactionSyncService } from '../../services/transactionSyncService';

jest.mock('../../services/budgetSyncService', () => ({
  BudgetSyncService: {
    syncUserBudgets: jest.fn().mockResolvedValue(undefined)
  }
}));

jest.mock('../../services/smartCategorizationService', () => ({
  SmartCategorizationService: {
    initializePatterns: jest.fn().mockResolvedValue(undefined),
    categorizeTransaction: jest.fn().mockResolvedValue({ category: 'Food & Dining', confidence: 0.9 }),
    learnFromCorrection: jest.fn()
  }
}));

describe('TransactionSyncService', () => {
  const userId = 'tx-sync-user';

  beforeAll(async () => {
    await prisma.transaction.deleteMany({});
    await prisma.account.deleteMany({});
    await prisma.user.deleteMany({ where: { id: userId } });

    await prisma.user.create({
      data: {
        id: userId,
        email: 'sync@example.com',
        fullName: 'Sync User',
        passwordHash: 'hash',
        plaidAccessToken: 'test-token',
        plaidItemId: 'item-1'
      }
    });

    await prisma.account.create({
      data: {
        id: 'tx-sync-account',
        plaidAccountId: 'account-1',
        userId,
        name: 'Checking',
        type: 'checking',
        subtype: 'checking'
      }
    });
  });

  afterAll(async () => {
    await prisma.transaction.deleteMany({});
    await prisma.account.deleteMany({});
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('returns failure when user has no plaid connection', async () => {
    const user = await prisma.user.create({
      data: {
        id: 'no-plaid-user',
        email: 'noplaid-' + Date.now() + '@example.com',
        fullName: 'No Plaid',
        passwordHash: 'hash'
      }
    });

    const result = await TransactionSyncService.syncUserTransactions(user.id);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();

    await prisma.user.delete({ where: { id: user.id } });
  });
});