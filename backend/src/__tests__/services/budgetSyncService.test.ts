import { prisma } from '../../lib/prisma';
import { BudgetSyncService } from '../../services/budgetSyncService';

describe('BudgetSyncService', () => {
    beforeEach(async () => {
        await prisma.budget.deleteMany({});
    });
});

test('should sync budgets for user', async () => {
    const res = await BudgetSyncService.syncUserBudgets('test@example.com');
    expect(res).toBeDefined();
});

afterAll(async () => {
    await prisma.$disconnect();
});