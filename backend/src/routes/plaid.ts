import { Router, Request, Response } from 'express';
import { Configuration, PlaidApi, Products, PlaidEnvironments, CountryCode } from 'plaid';
import { prisma } from '../lib/prisma';
import { authenticateToken } from '../middleware/auth';
import { TransactionSyncService } from '../services/transactionSyncService';

const router = Router();

// Plaid client setup
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

// Protect all routes with authentication
router.use(authenticateToken);

// Create link token
router.post('/create_link_token', async (req: Request, res: Response) => {
  try {
    console.log('Creating link token for user:', req.user!.id);
    
    const response = await plaidClient.linkTokenCreate({
      user: {
        client_user_id: req.user!.id,
      },
      client_name: 'My Money App',
      products: [Products.Transactions, Products.Auth],
      country_codes: [CountryCode.Us],
      language: 'en',
    });
    
    console.log('Link token created successfully');
    res.json(response.data);
  } catch (error: any) {
    console.error('Error creating link token:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Failed to create link token',
      details: error.response?.data || error.message
    });
  }
});

// Exchange public token and store access token
router.post('/exchange_public_token', async (req: Request, res: Response) => {
  const { public_token } = req.body;
  
  console.log('Exchanging public token for user:', req.user!.id);
  
  if (!public_token) {
    return res.status(400).json({ error: 'public_token is required' });
  }

  try {
    // Exchange token
    const response = await plaidClient.itemPublicTokenExchange({
      public_token: public_token,
    });
    const { access_token, item_id } = response.data;
    console.log('Token exchanged successfully, item_id:', item_id);

    // Get institution info
    const itemResponse = await plaidClient.itemGet({
      access_token: access_token,
    });
    
    const institutionResponse = await plaidClient.institutionsGetById({
      institution_id: itemResponse.data.item.institution_id!,
      country_codes: [CountryCode.Us],
    });

    console.log('Institution info retrieved:', institutionResponse.data.institution.name);

    // Update user with new Plaid connection
    const updatedUser = await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        plaidAccessToken: access_token,
        plaidItemId: item_id,
        plaidInstitutionId: itemResponse.data.item.institution_id!,
        plaidInstitutionName: institutionResponse.data.institution.name,
        syncStatus: 'NEVER_SYNCED', // Reset sync status
      },
    });

    console.log('User updated with Plaid connection');

    // Trigger initial sync in the background
    console.log('Starting initial sync...');
    TransactionSyncService.syncUserTransactions(req.user!.id)
      .then(result => {
        console.log('Initial sync completed:', result);
      })
      .catch(error => {
        console.error('Initial sync failed:', error);
      });

    res.json({ 
      success: true, 
      item_id,
      institution_name: institutionResponse.data.institution.name,
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        fullName: updatedUser.fullName,
        plaidItemId: updatedUser.plaidItemId,
        plaidInstitutionName: updatedUser.plaidInstitutionName,
        // Don't send access token to frontend
        plaidAccessToken: updatedUser.plaidAccessToken ? 'CONNECTED' : null
      }
    });
  } catch (error: any) {
    console.error('Error exchanging public token:', error);
    res.status(500).json({ 
      error: 'Failed to exchange public token',
      details: error.response?.data || error.message
    });
  }
});

// Get account information (for backward compatibility)
router.get('/accounts', async (req: Request, res: Response) => {
  try {
    console.log('Getting Plaid accounts for user:', req.user!.id);
    
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { 
        id: true, 
        plaidAccessToken: true, 
        plaidItemId: true,
        plaidInstitutionName: true
      }
    });

    if (!user || !user.plaidAccessToken) {
      return res.json({ 
        accounts: [],
        institution: null,
        connected: false
      });
    }

    // Get fresh account data from Plaid
    const accountsResponse = await plaidClient.accountsGet({
      access_token: user.plaidAccessToken,
    });

    // Update our cached account data
    for (const plaidAccount of accountsResponse.data.accounts) {
      await prisma.account.upsert({
        where: { plaidAccountId: plaidAccount.account_id },
        update: {
          currentBalance: plaidAccount.balances.current || 0,
          availableBalance: plaidAccount.balances.available,
          creditLimit: plaidAccount.balances.limit,
          lastUpdatedAt: new Date()
        },
        create: {
          plaidAccountId: plaidAccount.account_id,
          userId: user.id,
          name: plaidAccount.name,
          officialName: plaidAccount.official_name,
          type: plaidAccount.type,
          subtype: plaidAccount.subtype || 'unknown',
          mask: plaidAccount.mask,
          currentBalance: plaidAccount.balances.current || 0,
          availableBalance: plaidAccount.balances.available,
          creditLimit: plaidAccount.balances.limit
        }
      });
    }

    res.json({
      accounts: accountsResponse.data.accounts,
      institution: {
        name: user.plaidInstitutionName || 'Connected Bank',
        item_id: user.plaidItemId,
        connected_at: new Date().toISOString()
      },
      connected: true
    });
  } catch (error: any) {
    console.error('Error fetching Plaid accounts:', error);
    res.status(500).json({ 
      error: 'Failed to fetch accounts',
      details: error.response?.data || error.message
    });
  }
});

// Get transactions (legacy endpoint for backward compatibility)
router.get('/transactions', async (req: Request, res: Response) => {
  try {
    console.log('Getting Plaid transactions for user:', req.user!.id);
    
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { 
        id: true, 
        plaidAccessToken: true, 
        plaidItemId: true 
      }
    });

    if (!user || !user.plaidAccessToken) {
      return res.status(404).json({ 
        error: 'No bank account connected. Please connect your bank first.' 
      });
    }

    const startDate = '2023-01-01';
    const endDate = new Date().toISOString().slice(0, 10);

    const response = await plaidClient.transactionsGet({
      access_token: user.plaidAccessToken,
      start_date: startDate,
      end_date: endDate,
      options: {
        count: 250,
        offset: 0,
      },
    });

    res.json(response.data);
  } catch (error: any) {
    console.error('Error fetching transactions:', error);
    
    if (error.error_code === 'INVALID_ACCESS_TOKEN') {
      // Update user status
      await prisma.user.update({
        where: { id: req.user!.id },
        data: { syncStatus: 'TOKEN_EXPIRED' }
      });
      
      return res.status(401).json({ 
        error: 'Connection expired. Please reconnect your bank account.',
        reconnect_required: true
      });
    }
    
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// Disconnect bank account
router.delete('/disconnect', async (req: Request, res: Response) => {
  try {
    console.log('Disconnecting bank for user:', req.user!.id);
    
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { 
        id: true, 
        plaidAccessToken: true, 
        plaidItemId: true 
      }
    });

    if (!user || !user.plaidAccessToken) {
      return res.status(404).json({ 
        error: 'No bank account connected.' 
      });
    }

    // Remove item from Plaid (this will revoke the access token)
    try {
      await plaidClient.itemRemove({
        access_token: user.plaidAccessToken,
      });
      console.log('Item removed from Plaid successfully');
    } catch (plaidError: any) {
      console.warn('Error removing item from Plaid:', plaidError.message);
      // Continue with database cleanup even if Plaid removal fails
    }

    // Remove all user's accounts and transactions
    await prisma.transaction.deleteMany({
      where: { userId: req.user!.id }
    });
    
    await prisma.account.deleteMany({
      where: { userId: req.user!.id }
    });

    // Remove Plaid credentials from user
    const updatedUser = await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        plaidAccessToken: null,
        plaidItemId: null,
        plaidInstitutionId: null,
        plaidInstitutionName: null,
        lastSyncAt: null,
        syncStatus: 'NEVER_SYNCED',
      },
    });

    console.log('User Plaid connection removed successfully');

    res.json({ 
      success: true, 
      message: 'Bank account disconnected successfully',
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        fullName: updatedUser.fullName,
        plaidItemId: null,
        plaidAccessToken: null
      }
    });
  } catch (error: any) {
    console.error('Error disconnecting bank account:', error);
    res.status(500).json({ error: 'Failed to disconnect bank account' });
  }
});

// Refresh/Update connection (for when access token expires)
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    console.log('Refreshing connection for user:', req.user!.id);
    
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { 
        id: true, 
        plaidAccessToken: true, 
        plaidItemId: true 
      }
    });

    if (!user || !user.plaidAccessToken) {
      return res.status(404).json({ 
        error: 'No bank account connected.' 
      });
    }

    // Test the connection
    const accountsResponse = await plaidClient.accountsGet({
      access_token: user.plaidAccessToken,
    });

    // Update sync status
    await prisma.user.update({
      where: { id: req.user!.id },
      data: { syncStatus: 'SYNCED' }
    });

    res.json({ 
      success: true, 
      message: 'Connection is healthy',
      accounts_count: accountsResponse.data.accounts.length
    });
  } catch (error: any) {
    console.error('Error refreshing connection:', error);
    
    // If token is invalid, user needs to reconnect
    if (error.error_code === 'INVALID_ACCESS_TOKEN') {
      await prisma.user.update({
        where: { id: req.user!.id },
        data: { syncStatus: 'TOKEN_EXPIRED' }
      });
      
      return res.status(401).json({ 
        error: 'Connection expired. Please reconnect your bank account.',
        reconnect_required: true
      });
    }
    
    res.status(500).json({ error: 'Failed to refresh connection' });
  }
});

export default router;