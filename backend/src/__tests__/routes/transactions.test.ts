import { prisma } from '../../lib/prisma';

describe('Transactions Routes', () => {
  it('placeholder', async () => {
    const count = await prisma.transaction.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });
});