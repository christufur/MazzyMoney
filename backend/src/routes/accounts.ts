import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authenticateToken } from '../middleware/auth';
import { Configuration, PlaidApi, PlaidEnvironments, CountryCode } from 'plaid';

const accountsRouter = Router();

// Plaid client setup (for manual sync)
const configuration = new Configuration({
  basePath: PlaidEnvironments[process.env.PLAID_ENV as keyof typeof PlaidEnvironments || 'sandbox'],
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET,
    },
  },
});
const plaidClient = new PlaidApi(configuration);

accountsRouter.use(authenticateToken);

/**
 * GET /api/accounts
 * Get cached account information with fallback to Plaid
 */
accountsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    console.log(`Getting accounts for user: ${userId}`);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        plaidItemId: true,
        plaidInstitutionName: true,
        plaidAccessToken: true,
        lastSyncAt: true,
        syncStatus: true
      }
    });

    if (!user?.plaidItemId) {
      console.log('User has no Plaid connection');
      return res.json({
        accounts: [],
        institution: null,
        connected: false,
        syncStatus: 'NEVER_SYNCED'
      });
    }

    // Get accounts from database
    const cachedAccounts = await prisma.account.findMany({
      where: { userId, isActive: true },
      orderBy: { createdAt: 'asc' }
    });

    console.log(`Found ${cachedAccounts.length} cached accounts`);

    // If no cached accounts but user is connected, sync from Plaid
    if (cachedAccounts.length === 0 && user.plaidAccessToken) {
      console.log('No cached accounts found, syncing from Plaid...');
      
      try {
        await syncAccountsFromPlaid(userId, user.plaidAccessToken);
        
        // Get the newly synced accounts
        const newlySyncedAccounts = await prisma.account.findMany({
          where: { userId, isActive: true },
          orderBy: { createdAt: 'asc' }
        });

        console.log(`Synced ${newlySyncedAccounts.length} accounts from Plaid`);
        
        return res.json({
          accounts: newlySyncedAccounts.map(formatAccountForFrontend),
          institution: {
            name: user.plaidInstitutionName || 'Connected Bank',
            item_id: user.plaidItemId,
            connected_at: user.lastSyncAt
          },
          connected: true,
          syncStatus: user.syncStatus,
          summary: calculateAccountSummary(newlySyncedAccounts)
        });

      } catch (syncError: any) {
        console.error('Failed to sync accounts from Plaid:', syncError);
        
        // Return error but still show connection status
        return res.json({
          accounts: [],
          institution: {
            name: user.plaidInstitutionName || 'Connected Bank',
            item_id: user.plaidItemId,
            connected_at: user.lastSyncAt
          },
          connected: true,
          syncStatus: 'ERROR',
          error: 'Failed to sync accounts. Please try refreshing.'
        });
      }
    }

    // Return cached accounts
    const totalBalance = cachedAccounts.reduce((sum, acc) => sum + acc.currentBalance, 0);
    const totalAvailable = cachedAccounts.reduce((sum, acc) => sum + (acc.availableBalance || 0), 0);

    res.json({
      accounts: cachedAccounts.map(formatAccountForFrontend),
      institution: {
        name: user.plaidInstitutionName || 'Connected Bank',
        item_id: user.plaidItemId,
        connected_at: user.lastSyncAt
      },
      connected: true,
      syncStatus: user.syncStatus,
      summary: {
        totalAccounts: cachedAccounts.length,
        totalBalance,
        totalAvailable
      }
    });

  } catch (error: any) {
    console.error('Error fetching accounts:', error);
    res.status(500).json({ error: 'Failed to fetch accounts' });
  }
});

/**
 * POST /api/accounts/sync
 * Manual account sync from Plaid
 */
accountsRouter.post('/sync', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    console.log(`Manual account sync requested for user: ${userId}`);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        plaidAccessToken: true,
        plaidItemId: true
      }
    });

    if (!user?.plaidAccessToken) {
      return res.status(400).json({ 
        error: 'No bank account connected' 
      });
    }

    const result = await syncAccountsFromPlaid(userId, user.plaidAccessToken);
    
    res.json({
      success: true,
      message: `Synced ${result.newAccounts} new and updated ${result.updatedAccounts} accounts`,
      ...result
    });

  } catch (error: any) {
    console.error('Manual account sync failed:', error);
    res.status(500).json({ 
      error: 'Failed to sync accounts',
      details: error.message
    });
  }
});

// Helper function to sync accounts from Plaid
async function syncAccountsFromPlaid(userId: string, accessToken: string) {
  const accountsResponse = await plaidClient.accountsGet({
    access_token: accessToken,
  });

  let newAccounts = 0;
  let updatedAccounts = 0;

  for (const plaidAccount of accountsResponse.data.accounts) {
    const existingAccount = await prisma.account.findUnique({
      where: { plaidAccountId: plaidAccount.account_id }
    });

    const accountData = {
      name: plaidAccount.name,
      officialName: plaidAccount.official_name || null,
      type: plaidAccount.type,
      subtype: plaidAccount.subtype || 'unknown',
      mask: plaidAccount.mask || null,
      currentBalance: plaidAccount.balances.current || 0,
      availableBalance: plaidAccount.balances.available || null,
      creditLimit: plaidAccount.balances.limit || null,
      lastUpdatedAt: new Date()
    };

    if (existingAccount) {
      await prisma.account.update({
        where: { id: existingAccount.id },
        data: accountData
      });
      updatedAccounts++;
    } else {
      await prisma.account.create({
        data: {
          plaidAccountId: plaidAccount.account_id,
          userId,
          ...accountData
        }
      });
      newAccounts++;
    }
  }

  return { newAccounts, updatedAccounts };
}

// Helper function to format account for frontend (matching Plaid format)
function formatAccountForFrontend(account: any) {
  return {
    account_id: account.plaidAccountId,
    name: account.name,
    official_name: account.officialName,
    balances: {
      current: account.currentBalance,
      available: account.availableBalance,
      limit: account.creditLimit
    },
    type: account.type,
    subtype: account.subtype,
    mask: account.mask
  };
}

// Helper function to calculate account summary
function calculateAccountSummary(accounts: any[]) {
  return {
    totalAccounts: accounts.length,
    totalBalance: accounts.reduce((sum, acc) => sum + acc.currentBalance, 0),
    totalAvailable: accounts.reduce((sum, acc) => sum + (acc.availableBalance || 0), 0)
  };
}

export { accountsRouter };