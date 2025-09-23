// Updated src/services/transactionSyncService.ts
import { Configuration, PlaidApi, PlaidEnvironments, CountryCode } from 'plaid';
import { prisma } from '../lib/prisma';
import { BudgetSyncService } from './budgetSyncService';

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

interface SyncResult {
  success: boolean;
  newTransactions: number;
  updatedTransactions: number;
  newAccounts: number;
  error?: string;
}

// Enhanced categorization service
class EnhancedCategoryService {
  
  // Map Plaid's primary categories to cleaner display categories
  private static categoryMapping: Record<string, string> = {
    // Income
    'Deposit': 'Income',
    'Payroll': 'Income',
    'Transfer': 'Income', // We'll handle this more specifically below
    
    // Housing & Utilities
    'Payment': 'Housing', // We'll be more specific based on secondary category
    'Service': 'Bills & Utilities',
    
    // Food & Dining
    'Food and Drink': 'Food & Dining',
    
    // Transportation
    'Transportation': 'Transportation',
    
    // Shopping
    'Shops': 'Shopping',
    'General Merchandise': 'Shopping',
    
    // Entertainment
    'Recreation': 'Entertainment',
    'Entertainment': 'Entertainment',
    
    // Healthcare
    'Healthcare': 'Healthcare',
    'Medical': 'Healthcare',
    
    // Financial
    'Bank Fees': 'Financial',
    'Interest': 'Financial',
    'Tax': 'Financial',
    
    // Insurance
    'Insurance': 'Insurance',
    
    // Travel
    'Travel': 'Travel',
    
    // Personal Care
    'Personal Care': 'Personal Care',
    
    // Government
    'Government and Non-Profit': 'Government',
    
    // Other
    'Other': 'Other'
  };

  // Merchant-based patterns for better categorization
  private static merchantPatterns: Array<{pattern: RegExp, category: string}> = [
    // Housing & Mortgage
    { pattern: /mortgage|home loan|wells fargo home|chase mortgage/i, category: 'Mortgage' },
    { pattern: /rent|apartment|property mgmt|leasing/i, category: 'Housing' },
    { pattern: /home depot|lowes|hardware|ace hardware/i, category: 'Home Improvement' },
    
    // Utilities - be very specific
    { pattern: /electric|power|pge|con edison|duke energy/i, category: 'Bills & Utilities' },
    { pattern: /gas company|natural gas|nicor gas/i, category: 'Bills & Utilities' },
    { pattern: /water|sewer|waste management/i, category: 'Bills & Utilities' },
    { pattern: /comcast|verizon|att|spectrum|xfinity|internet|wifi/i, category: 'Bills & Utilities' },
    { pattern: /tmobile|sprint|phone|mobile|cell/i, category: 'Bills & Utilities' },
    
    // Food & Dining
    { pattern: /starbucks|coffee|dunkin|caribou/i, category: 'Food & Dining' },
    { pattern: /mcdonalds|burger king|taco bell|subway|chipotle|pizza/i, category: 'Food & Dining' },
    { pattern: /whole foods|trader joe|safeway|kroger|walmart|target.*grocery|supermarket/i, category: 'Food & Dining' },
    { pattern: /restaurant|dining|bistro|cafe|grill/i, category: 'Food & Dining' },
    
    // Transportation
    { pattern: /shell|exxon|chevron|bp|mobil|gas station/i, category: 'Transportation' },
    { pattern: /uber|lyft|taxi|rideshare/i, category: 'Transportation' },
    { pattern: /parking|meter|garage/i, category: 'Transportation' },
    
    // Shopping
    { pattern: /amazon|ebay|walmart|target|costco/i, category: 'Shopping' },
    { pattern: /nike|adidas|clothing|apparel|fashion/i, category: 'Shopping' },
    
    // Entertainment
    { pattern: /netflix|spotify|hulu|disney|apple music/i, category: 'Entertainment' },
    { pattern: /movie|theater|cinema|amc|regal/i, category: 'Entertainment' },
    
    // Healthcare
    { pattern: /pharmacy|cvs|walgreens|rite aid|doctor|medical|hospital/i, category: 'Healthcare' },
    
    // Financial
    { pattern: /loan payment|credit card|bank fee|interest/i, category: 'Financial' },
    { pattern: /insurance/i, category: 'Insurance' },
    
    // Cash & ATM
    { pattern: /atm|cash withdrawal/i, category: 'Cash & ATM' }
  ];

  /**
   * Enhanced categorization using Plaid categories + merchant patterns
   */
  static categorizeTransaction(
    plaidCategories: string[],
    merchantName: string,
    transactionName: string,
    amount: number
  ): string {
    const searchText = `${merchantName || ''} ${transactionName || ''}`.toLowerCase();
    
    // Handle income transactions first
    if (amount < 0) { // Negative amounts are income in Plaid
      if (plaidCategories.includes('Payroll') || 
          plaidCategories.includes('Deposit') ||
          /payroll|salary|direct dep|income|wage/i.test(searchText)) {
        return 'Income';
      }
    }
    
    // Try merchant-based pattern matching first (most accurate)
    for (const { pattern, category } of this.merchantPatterns) {
      if (pattern.test(searchText)) {
        return category;
      }
    }
    
    // Handle Plaid's specific category combinations
    if (plaidCategories.length >= 2) {
      const [primary, secondary] = plaidCategories;
      
      // Payment category needs special handling
      if (primary === 'Payment') {
        if (secondary === 'Rent') return 'Housing';
        if (secondary === 'Mortgage') return 'Mortgage';
        if (secondary === 'Credit Card') return 'Financial';
        if (secondary === 'Loan') return 'Loan Repayment';
        return 'Financial';
      }
      
      // Service category
      if (primary === 'Service') {
        if (secondary === 'Utilities') return 'Bills & Utilities';
        if (secondary === 'Telecommunication Services') return 'Bills & Utilities';
        if (secondary === 'Cable') return 'Bills & Utilities';
        return 'Bills & Utilities';
      }
      
      // Transfer category
      if (primary === 'Transfer') {
        if (secondary === 'Payroll') return 'Income';
        if (secondary === 'Deposit') return 'Income';
        return 'Financial';
      }
    }
    
    // Use primary category mapping
    const primary = plaidCategories[0];
    if (primary && this.categoryMapping[primary]) {
      return this.categoryMapping[primary];
    }
    
    // Final fallback
    return primary || 'Other';
  }
}

export class TransactionSyncService {
  
  /**
   * Sync transactions for a specific user
   */
  static async syncUserTransactions(userId: string): Promise<SyncResult> {
    try {
      console.log(`Starting sync for user ${userId}`);
      
      // Update sync status
      await prisma.user.update({
        where: { id: userId },
        data: { syncStatus: 'SYNCING' }
      });
  
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { 
          plaidAccessToken: true, 
          plaidItemId: true,
          lastSyncAt: true
        }
      });
  
      if (!user?.plaidAccessToken) {
        throw new Error('User has no Plaid connection');
      }
  
      // Sync accounts first
      const accountsResult = await this.syncAccounts(userId, user.plaidAccessToken);
      
      // Then sync transactions with enhanced categorization
      const transactionsResult = await this.syncTransactions(userId, user.plaidAccessToken, user.lastSyncAt);
  
      // Budget sync
      console.log(`Syncing budgets for user ${userId}`);
      try {
        await BudgetSyncService.syncUserBudgets(userId);
        console.log(`Budget sync completed for user ${userId}`);
      } catch (budgetError) {
        console.error(`Budget sync failed for user ${userId}:`, budgetError);
      }
  
      // Update user's last sync time and status
      await prisma.user.update({
        where: { id: userId },
        data: { 
          lastSyncAt: new Date(),
          syncStatus: 'SYNCED'
        }
      });
  
      console.log(`Sync completed for user ${userId}: ${transactionsResult.newTransactions} new, ${transactionsResult.updatedTransactions} updated`);
  
      return {
        success: true,
        newTransactions: transactionsResult.newTransactions,
        updatedTransactions: transactionsResult.updatedTransactions,
        newAccounts: accountsResult.newAccounts
      };
  
    } catch (error: any) {
      console.error(`Sync failed for user ${userId}:`, error);
      
      // Update error status
      const syncStatus = error.message.includes('INVALID_ACCESS_TOKEN') ? 'TOKEN_EXPIRED' : 'ERROR';
      await prisma.user.update({
        where: { id: userId },
        data: { syncStatus }
      });
  
      return {
        success: false,
        newTransactions: 0,
        updatedTransactions: 0,
        newAccounts: 0,
        error: error.message
      };
    }
  }

  /**
   * Sync accounts for a user
   */
  private static async syncAccounts(userId: string, accessToken: string) {
    console.log(`Syncing accounts for user ${userId}`);
    
    try {
      const accountsResponse = await plaidClient.accountsGet({
        access_token: accessToken,
      });

      console.log(`Found ${accountsResponse.data.accounts.length} accounts from Plaid`);

      let newAccounts = 0;
      let updatedAccounts = 0;

      for (const plaidAccount of accountsResponse.data.accounts) {
        console.log(`Processing account: ${plaidAccount.name} (${plaidAccount.account_id})`);
        
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
          console.log(`✅ Updated account: ${plaidAccount.name}`);
        } else {
          const newAccount = await prisma.account.create({
            data: {
              plaidAccountId: plaidAccount.account_id,
              userId,
              ...accountData
            }
          });
          newAccounts++;
          console.log(`✅ Created new account: ${plaidAccount.name} (ID: ${newAccount.id})`);
        }
      }

      console.log(`Account sync completed: ${newAccounts} new, ${updatedAccounts} updated`);
      return { newAccounts, updatedAccounts };

    } catch (error) {
      console.error('Error syncing accounts:', error);
      throw error;
    }
  }

  /**
   * Enhanced sync transactions with proper categorization
   */
  private static async syncTransactions(userId: string, accessToken: string, lastSyncAt?: Date | null) {
    // Determine date range
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = lastSyncAt 
      ? new Date(lastSyncAt.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      : new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    console.log(`Fetching transactions from ${startDate} to ${endDate}`);

    const transactionsResponse = await plaidClient.transactionsGet({
      access_token: accessToken,
      start_date: startDate,
      end_date: endDate,
      options: {
        count: 500,
        offset: 0,
      },
    });

    console.log(`Received ${transactionsResponse.data.transactions.length} transactions from Plaid`);

    // Log some sample categories for debugging
    if (transactionsResponse.data.transactions.length > 0) {
      console.log('=== SAMPLE PLAID CATEGORIES ===');
      transactionsResponse.data.transactions.slice(0, 5).forEach(t => {
        console.log(`${t.name}: ${JSON.stringify(t.category)} -> merchant: ${t.merchant_name}`);
      });
      console.log('===============================');
    }

    // Get all user's accounts for mapping
    const userAccounts = await prisma.account.findMany({
      where: { userId },
      select: { id: true, plaidAccountId: true }
    });
    
    const accountMap = new Map(
      userAccounts.map(acc => [acc.plaidAccountId, acc.id])
    );

    let newTransactions = 0;
    let updatedTransactions = 0;
    let categorizationStats: Record<string, number> = {};

    for (const plaidTransaction of transactionsResponse.data.transactions) {
      const accountId = accountMap.get(plaidTransaction.account_id);
      if (!accountId) {
        console.warn(`Account not found for transaction: ${plaidTransaction.transaction_id}`);
        continue;
      }

      // Enhanced categorization
      const enhancedCategory = EnhancedCategoryService.categorizeTransaction(
        plaidTransaction.category || [],
        plaidTransaction.merchant_name || '',
        plaidTransaction.name || '',
        plaidTransaction.amount
      );

      // Track categorization for debugging
      categorizationStats[enhancedCategory] = (categorizationStats[enhancedCategory] || 0) + 1;

      const existingTransaction = await prisma.transaction.findUnique({
        where: { plaidTransactionId: plaidTransaction.transaction_id }
      });

      const transactionData = {
        plaidTransactionId: plaidTransaction.transaction_id,
        userId,
        accountId,
        name: plaidTransaction.name,
        merchantName: plaidTransaction.merchant_name,
        amount: plaidTransaction.amount,
        date: new Date(plaidTransaction.date),
        authorizedDate: plaidTransaction.authorized_date ? new Date(plaidTransaction.authorized_date) : null,
        
        // Store ALL category information
        primaryCategory: enhancedCategory, // Our enhanced category for reports/budgets
        detailedCategory: plaidTransaction.category?.[1] || null, // Plaid's secondary category
        categories: plaidTransaction.category || [], // Full Plaid category hierarchy
        
        pending: plaidTransaction.pending,
        city: plaidTransaction.location?.city || null,
        region: plaidTransaction.location?.region || null,
        country: plaidTransaction.location?.country || null,
      };

      if (existingTransaction) {
        await prisma.transaction.update({
          where: { id: existingTransaction.id },
          data: transactionData
        });
        updatedTransactions++;
      } else {
        await prisma.transaction.create({
          data: transactionData
        });
        newTransactions++;
      }
    }

    // Log categorization results
    console.log('=== CATEGORIZATION RESULTS ===');
    Object.entries(categorizationStats)
      .sort(([,a], [,b]) => b - a)
      .forEach(([category, count]) => {
        console.log(`${category}: ${count} transactions`);
      });
    console.log('==============================');

    return { newTransactions, updatedTransactions };
  }

  /**
   * Get sync status for a user
   */
  static async getSyncStatus(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        syncStatus: true,
        lastSyncAt: true,
        plaidItemId: true
      }
    });

    if (!user?.plaidItemId) {
      return { connected: false, status: 'NEVER_SYNCED' };
    }

    const transactionCount = await prisma.transaction.count({
      where: { userId }
    });

    return {
      connected: true,
      status: user.syncStatus,
      lastSyncAt: user.lastSyncAt,
      transactionCount
    };
  }

  /**
   * Force a full resync
   */
  static async fullResync(userId: string): Promise<SyncResult> {
    console.log(`Starting full resync for user ${userId}`);
    
    // Clear last sync date to force full fetch
    await prisma.user.update({
      where: { id: userId },
      data: { lastSyncAt: null }
    });
  
    const result = await this.syncUserTransactions(userId);
    
    if (result.success) {
      console.log(`Full resync completed for user ${userId} including budget sync`);
    }
    
    return result;
  }
}