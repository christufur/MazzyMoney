import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authenticateToken } from '../middleware/auth';

const accountsRouter = Router();

accountsRouter.use(authenticateToken);

/**
 * GET /api/accounts
 * All of the user's active accounts from the database (Plaid and manual).
 * No Plaid calls: W2.3 owns syncing.
 */
accountsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    const [accounts, items] = await Promise.all([
      prisma.account.findMany({
        where: { userId, isActive: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.plaidItem.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' },
        select: { institutionName: true },
      }),
    ]);

    const totalBalance = accounts.reduce((sum, acc) => sum + acc.currentBalance, 0);
    const totalAvailable = accounts.reduce((sum, acc) => sum + (acc.availableBalance ?? 0), 0);

    res.json({
      accounts: accounts.map(formatAccountForFrontend),
      // Kept for the current frontend (it reads `institution.name`) until W2.5 rebuilds the page.
      institution: items[0] ? { name: items[0].institutionName } : null,
      connected: items.length > 0,
      summary: {
        totalAccounts: accounts.length,
        totalBalance,
        totalAvailable,
      },
    });
  } catch (error: any) {
    console.error('Error fetching accounts:', error);
    res.status(500).json({ error: 'Failed to fetch accounts' });
  }
});

// Helper function to format account for frontend (matching Plaid format)
function formatAccountForFrontend(account: any) {
  return {
    account_id: account.plaidAccountId ?? account.id,
    name: account.name,
    official_name: account.officialName,
    balances: {
      current: account.currentBalance,
      available: account.availableBalance,
      limit: account.creditLimit,
    },
    type: account.type,
    subtype: account.subtype,
    mask: account.mask,
  };
}

export { accountsRouter };
