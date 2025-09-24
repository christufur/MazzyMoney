import { prisma } from '../../lib/prisma';
import { TransactionSyncService } from '../../services/transactionSyncService';

describe('TransactionSyncService', () => {
    beforeEach(async () => {
        await prisma.transaction.deleteMany({});
    });
});

test('should sync transactions for user', async () => {
    const res = await TransactionSyncService.syncUserTransactions('test@example.com');
    expect(res).toBeDefined();
});

afterAll(async () => {
    await prisma.$disconnect();
});