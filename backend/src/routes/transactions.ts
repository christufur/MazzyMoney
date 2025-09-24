import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authenticateToken } from '../middleware/auth';
import { TransactionSyncService } from '../services/transactionSyncService';
import { SmartCategorizationService } from '../services/smartCategorizationService';

const router = Router();
router.use(authenticateToken);

/**
 * GET /api/transactions
 * Get cached transactions with filtering and pagination
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const {
      page = '1',
      limit = '50',
      category,
      accountId,
      search,
      dateFrom,
      dateTo,
      amountMin,
      amountMax,
      type // 'income', 'expense', or 'all'
    } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    // Build where clause
    const where: any = { userId };

    if (category) {
      where.primaryCategory = category;
    }

    if (accountId) {
      where.accountId = accountId;
    }

    if (search) {
      where.name = {
        contains: search as string,
        mode: 'insensitive'
      };
    }

    if (dateFrom || dateTo) {
      where.date = {};
      if (dateFrom) where.date.gte = new Date(dateFrom as string);
      if (dateTo) where.date.lte = new Date(dateTo as string);
    }

    if (amountMin || amountMax) {
      where.amount = {};
      if (amountMin) where.amount.gte = parseFloat(amountMin as string);
      if (amountMax) where.amount.lte = parseFloat(amountMax as string);
    }

    if (type === 'income') {
      where.amount = { ...where.amount, lt: 0 };
    } else if (type === 'expense') {
      where.amount = { ...where.amount, gt: 0 };
    }

    // Get transactions with account info
    const [transactions, totalCount] = await Promise.all([
      prisma.transaction.findMany({
        where,
        include: {
          account: {
            select: {
              id: true,
              name: true,
              type: true,
              subtype: true,
              mask: true
            }
          }
        },
        orderBy: { date: 'desc' },
        skip,
        take: limitNum
      }),
      prisma.transaction.count({ where })
    ]);

    // Calculate summary stats for the filtered results
    const summaryStats = await prisma.transaction.aggregate({
      where,
      _sum: {
        amount: true
      },
      _count: {
        id: true
      }
    });

    const totalAmount = summaryStats._sum.amount || 0;
    const income = await prisma.transaction.aggregate({
      where: { ...where, amount: { lt: 0 } },
      _sum: { amount: true },
      _count: { id: true }
    });

    const expenses = await prisma.transaction.aggregate({
      where: { ...where, amount: { gt: 0 } },
      _sum: { amount: true },
      _count: { id: true }
    });

    res.json({
      transactions,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(totalCount / limitNum),
        totalCount,
        hasNext: skip + limitNum < totalCount,
        hasPrev: pageNum > 1
      },
      summary: {
        totalTransactions: summaryStats._count.id || 0,
        totalAmount,
        income: Math.abs(income._sum.amount || 0),
        incomeCount: income._count.id,
        expenses: expenses._sum.amount || 0,
        expenseCount: expenses._count.id,
        netAmount: Math.abs(income._sum.amount || 0) - (expenses._sum.amount || 0)
      }
    });

  } catch (error: any) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

/**
 * GET /api/transactions/categories
 * Get spending by category (cached)
 */
router.get('/categories', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { dateFrom, dateTo } = req.query;

    const where: any = {
      userId,
      amount: { gt: 0 }, // Only expenses
      primaryCategory: { not: null }
    };

    if (dateFrom || dateTo) {
      where.date = {};
      if (dateFrom) where.date.gte = new Date(dateFrom as string);
      if (dateTo) where.date.lte = new Date(dateTo as string);
    }

    const categorySpending = await prisma.transaction.groupBy({
      by: ['primaryCategory'],
      where,
      _sum: {
        amount: true
      },
      _count: {
        id: true
      },
      orderBy: {
        _sum: {
          amount: 'desc'
        }
      }
    });

    const result = categorySpending.map(item => ({
      category: item.primaryCategory,
      amount: item._sum.amount || 0,
      transactionCount: item._count.id
    }));

    res.json(result);

  } catch (error: any) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

/**
 * GET /api/transactions/monthly-trends
 * Get monthly income vs expenses trends
 */
router.get('/monthly-trends', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { months = '12' } = req.query;

    const monthsBack = parseInt(months as string);
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - monthsBack);

    // Get monthly aggregated data using raw SQL for better performance
    const monthlyData = await prisma.$queryRaw`
      SELECT 
        DATE_TRUNC('month', date) as month,
        SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as expenses,
        SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) as income,
        COUNT(*) as transaction_count
      FROM transactions 
      WHERE "userId" = ${userId} AND date >= ${startDate}
      GROUP BY DATE_TRUNC('month', date)
      ORDER BY month ASC
    `;

    const formattedData = (monthlyData as any[]).map(item => ({
      month: new Date(item.month).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
      expenses: parseFloat(item.expenses) || 0,
      income: parseFloat(item.income) || 0,
      transactionCount: parseInt(item.transaction_count),
      netAmount: (parseFloat(item.income) || 0) - (parseFloat(item.expenses) || 0)
    }));

    res.json(formattedData);

  } catch (error: any) {
    console.error('Error fetching monthly trends:', error);
    res.status(500).json({ error: 'Failed to fetch monthly trends' });
  }
});

/**
 * POST /api/transactions/sync
 * Trigger manual sync
 */
router.post('/sync', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { force = false } = req.body;

    // Check if sync is already in progress
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { syncStatus: true }
    });

    if (user?.syncStatus === 'SYNCING') {
      return res.status(409).json({
        error: 'Sync already in progress',
        status: 'SYNCING'
      });
    }

    // Start sync (run in background)
    const syncPromise = force
      ? TransactionSyncService.fullResync(userId)
      : TransactionSyncService.syncUserTransactions(userId);

    // Don't await - let it run in background
    syncPromise.catch(error => {
      console.error(`Background sync failed for user ${userId}:`, error);
    });

    res.json({
      message: 'Sync started',
      status: 'SYNCING'
    });

  } catch (error: any) {
    console.error('Error starting sync:', error);
    res.status(500).json({ error: 'Failed to start sync' });
  }
});

/**
 * GET /api/transactions/sync-status
 * Get current sync status
 */
router.get('/sync-status', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const status = await TransactionSyncService.getSyncStatus(userId);
    res.json(status);
  } catch (error: any) {
    console.error('Error fetching sync status:', error);
    res.status(500).json({ error: 'Failed to fetch sync status' });
  }
});

/**
 * GET /api/transactions/categories/debug
 * Debug endpoint to see all Plaid categories in your data
 */
router.get('/categories/debug', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    console.log(`Debug: Analyzing categories for user ${userId}`);

    const transactions = await prisma.transaction.findMany({
      where: { userId },
      select: {
        id: true,
        categories: true,
        primaryCategory: true,
        detailedCategory: true,
        name: true,
        amount: true,
        merchantName: true
      },
      orderBy: { amount: 'desc' }
    });

    console.log(`Found ${transactions.length} transactions to analyze`);

    // Analyze categories
    const categoryAnalysis: Record<string, {
      count: number,
      totalAmount: number,
      examples: Array<{ name: string, merchant: string, amount: number }>
    }> = {};

    transactions.forEach(transaction => {
      if (transaction.categories && transaction.categories.length > 0) {
        const categoryKey = transaction.categories.join(' > ');

        if (!categoryAnalysis[categoryKey]) {
          categoryAnalysis[categoryKey] = { count: 0, totalAmount: 0, examples: [] };
        }

        categoryAnalysis[categoryKey].count++;
        categoryAnalysis[categoryKey].totalAmount += Math.abs(transaction.amount);

        // Keep top 3 examples by amount
        if (categoryAnalysis[categoryKey].examples.length < 3) {
          categoryAnalysis[categoryKey].examples.push({
            name: transaction.name,
            merchant: transaction.merchantName || 'N/A',
            amount: transaction.amount
          });
        }
      }
    });

    // Sort by total amount (most expensive categories first)
    const sortedCategories = Object.entries(categoryAnalysis)
      .sort(([, a], [, b]) => b.totalAmount - a.totalAmount)
      .map(([category, data]) => ({
        category,
        ...data,
        avgAmount: data.totalAmount / data.count,
        percentage: (data.totalAmount / transactions.reduce((sum, t) => sum + Math.abs(t.amount), 0)) * 100
      }));

    // Also show primary categories breakdown
    const primaryCategoryBreakdown: Record<string, number> = {};
    transactions.forEach(t => {
      if (t.primaryCategory) {
        primaryCategoryBreakdown[t.primaryCategory] = (primaryCategoryBreakdown[t.primaryCategory] || 0) + Math.abs(t.amount);
      }
    });

    const sortedPrimary = Object.entries(primaryCategoryBreakdown)
      .sort(([, a], [, b]) => b - a)
      .map(([category, amount]) => ({ category, amount }));

    res.json({
      summary: {
        totalTransactions: transactions.length,
        uniqueFullCategories: sortedCategories.length,
        uniquePrimaryCategories: sortedPrimary.length,
        totalAmount: transactions.reduce((sum, t) => sum + Math.abs(t.amount), 0)
      },
      fullCategories: sortedCategories,
      primaryCategories: sortedPrimary,
      sampleTransactions: transactions.slice(0, 10).map(t => ({
        name: t.name,
        merchant: t.merchantName,
        amount: t.amount,
        categories: t.categories,
        primary: t.primaryCategory,
        detailed: t.detailedCategory
      }))
    });

  } catch (error: any) {
    console.error('Error analyzing categories:', error);
    res.status(500).json({ error: 'Failed to analyze categories' });
  }
});

/**
 * GET /api/transactions/categories/mapping
 * Show how categories would be mapped to display categories
 */
router.get('/categories/mapping', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    const transactions = await prisma.transaction.findMany({
      where: { userId },
      select: {
        categories: true,
        name: true,
        amount: true
      }
    });

    // Helper function to get display category (same as in your Reports page)
    const getDisplayCategory = (categories: string[]): string => {
      if (!categories || categories.length === 0) return 'Other';

      const [primary, secondary] = categories;

      // Your mapping logic here (same as Reports page)
      const categoryMap: Record<string, string> = {
        'Deposit': 'Income',
        'Payroll': 'Income',
        'Food and Drink': 'Food & Dining',
        'Transportation': 'Transportation',
        'Shops': 'Shopping',
        'General Merchandise': 'Shopping',
        'Recreation': 'Entertainment',
        'Entertainment': 'Entertainment',
        'Healthcare': 'Healthcare',
        'Medical': 'Healthcare',
        'Bank Fees': 'Financial',
        'Interest': 'Financial',
        'Tax': 'Financial',
        'Insurance': 'Insurance',
        'Travel': 'Travel & Lifestyle',
        'Personal Care': 'Personal Care',
        'Government and Non-Profit': 'Government & Taxes'
      };

      if (primary === 'Payment') {
        if (secondary === 'Rent') return 'Housing';
        if (secondary === 'Mortgage') return 'Mortgage';
        if (secondary === 'Credit Card') return 'Financial';
        return 'Financial';
      }

      if (primary === 'Service') {
        if (secondary === 'Utilities') return 'Bills & Utilities';
        if (secondary === 'Telecommunication Services') return 'Bills & Utilities';
        return 'Other';
      }

      if (primary === 'Transfer') {
        if (secondary === 'Payroll') return 'Income';
        if (secondary === 'Deposit') return 'Income';
        return 'Financial';
      }

      return categoryMap[primary] || primary || 'Other';
    };

    // Apply mapping and analyze
    const mappedCategories: Record<string, number> = {};
    const mapping: Array<{
      plaidCategory: string,
      displayCategory: string,
      examples: string[],
      amount: number
    }> = [];

    const categoryGroups: Record<string, {
      displayCategory: string,
      amount: number,
      examples: string[]
    }> = {};

    transactions.forEach(transaction => {
      const plaidCategory = transaction.categories?.join(' > ') || 'Other';
      const displayCategory = getDisplayCategory(transaction.categories || []);

      if (!categoryGroups[plaidCategory]) {
        categoryGroups[plaidCategory] = {
          displayCategory,
          amount: 0,
          examples: []
        };
      }

      categoryGroups[plaidCategory].amount += Math.abs(transaction.amount);
      if (categoryGroups[plaidCategory].examples.length < 3) {
        categoryGroups[plaidCategory].examples.push(transaction.name);
      }

      mappedCategories[displayCategory] = (mappedCategories[displayCategory] || 0) + Math.abs(transaction.amount);
    });

    // Convert to array and sort
    const mappingResult = Object.entries(categoryGroups)
      .sort(([, a], [, b]) => b.amount - a.amount)
      .map(([plaidCategory, data]) => ({
        plaidCategory,
        displayCategory: data.displayCategory,
        examples: data.examples,
        amount: data.amount
      }));

    const finalCategories = Object.entries(mappedCategories)
      .sort(([, a], [, b]) => b - a)
      .map(([category, amount]) => ({ category, amount }));

    res.json({
      mapping: mappingResult,
      finalCategories,
      summary: {
        originalCategories: Object.keys(categoryGroups).length,
        finalCategories: finalCategories.length
      }
    });

  } catch (error: any) {
    console.error('Error mapping categories:', error);
    res.status(500).json({ error: 'Failed to map categories' });
  }
});

/**
* GET /api/transactions/debug/categories
* Debug endpoint to analyze current categorization
*/
router.get('/debug/categories', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    console.log(`Debug: Analyzing categories for user ${userId}`);

    const transactions = await prisma.transaction.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        merchantName: true,
        amount: true,
        categories: true,      // Full Plaid categories
        primaryCategory: true, // Our enhanced category
        detailedCategory: true,
        date: true
      },
      orderBy: { date: 'desc' },
      take: 100 // Just the most recent 100
    });

    console.log(`Found ${transactions.length} transactions to analyze`);

    // Analyze Plaid categories
    const plaidCategoryAnalysis: Record<string, {
      count: number,
      totalAmount: number,
      examples: Array<{ name: string, merchant: string, amount: number }>
    }> = {};

    // Analyze our enhanced categories
    const enhancedCategoryAnalysis: Record<string, number> = {};

    transactions.forEach(transaction => {
      // Plaid category analysis
      if (transaction.categories && transaction.categories.length > 0) {
        const categoryKey = transaction.categories.join(' > ');

        if (!plaidCategoryAnalysis[categoryKey]) {
          plaidCategoryAnalysis[categoryKey] = { count: 0, totalAmount: 0, examples: [] };
        }

        plaidCategoryAnalysis[categoryKey].count++;
        plaidCategoryAnalysis[categoryKey].totalAmount += Math.abs(transaction.amount);

        if (plaidCategoryAnalysis[categoryKey].examples.length < 3) {
          plaidCategoryAnalysis[categoryKey].examples.push({
            name: transaction.name,
            merchant: transaction.merchantName || 'N/A',
            amount: transaction.amount
          });
        }
      }

      if (transaction.primaryCategory) {
        enhancedCategoryAnalysis[transaction.primaryCategory] =
          (enhancedCategoryAnalysis[transaction.primaryCategory] || 0) + 1;
      }
    });

    // Sort by count
    const sortedPlaidCategories = Object.entries(plaidCategoryAnalysis)
      .sort(([, a], [, b]) => b.count - a.count)
      .map(([category, data]) => ({
        plaidCategory: category,
        count: data.count,
        totalAmount: data.totalAmount,
        examples: data.examples
      }));

    const sortedEnhancedCategories = Object.entries(enhancedCategoryAnalysis)
      .sort(([, a], [, b]) => b - a)
      .map(([category, count]) => ({ category, count }));

    // Find problematic transactions (those still categorized as "Other")
    const problematicTransactions = transactions
      .filter(t => !t.primaryCategory || t.primaryCategory === 'Other')
      .slice(0, 10)
      .map(t => ({
        name: t.name,
        merchant: t.merchantName,
        amount: t.amount,
        plaidCategories: t.categories,
        currentCategory: t.primaryCategory
      }));

    res.json({
      summary: {
        totalTransactions: transactions.length,
        plaidCategoriesFound: sortedPlaidCategories.length,
        enhancedCategoriesFound: sortedEnhancedCategories.length,
        otherCount: enhancedCategoryAnalysis['Other'] || 0,
        uncategorizedCount: transactions.filter(t => !t.primaryCategory).length
      },
      plaidCategories: sortedPlaidCategories,
      enhancedCategories: sortedEnhancedCategories,
      problematicTransactions,
      sampleTransactions: transactions.slice(0, 5).map(t => ({
        name: t.name,
        merchant: t.merchantName,
        amount: t.amount,
        plaidCategories: t.categories,
        enhancedCategory: t.primaryCategory,
        detailedCategory: t.detailedCategory
      }))
    });

  } catch (error: any) {
    console.error('Error analyzing categories:', error);
    res.status(500).json({ error: 'Failed to analyze categories' });
  }
});


/**
 * POST /api/transactions/debug/enhanced-recategorize
 * Re-categorize with enhanced patterns for your bank format
 */
router.post('/debug/enhanced-recategorize', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    console.log(`Enhanced re-categorizing transactions for user ${userId}`);

    // Get all transactions for this user
    const transactions = await prisma.transaction.findMany({
      where: { userId }
    });

    console.log(`Found ${transactions.length} transactions to re-categorize`);

    let updatedCount = 0;
    const categoryStats: Record<string, number> = {};

    const categorizeTransactionEnhanced = (
      plaidCategories: string[],
      merchantName: string,
      transactionName: string,
      amount: number
    ): string => {
      const searchText = `${merchantName || ''} ${transactionName || ''}`.toLowerCase();
      
      // Handle income
      if (amount < 0) {
        if (plaidCategories.includes('Payroll') || 
            plaidCategories.includes('Deposit') ||
            /payroll|salary|direct dep|income|wage|deposit|transfer.*in/i.test(searchText)) {
          return 'Income';
        }
      }
      
      const enhancedPatterns = [
        // Coffee & Food - specific to what I see in your data
        { pattern: /starbucks/i, category: 'Food & Dining' },
        { pattern: /dutch bros/i, category: 'Food & Dining' },
        { pattern: /coffee|dunkin|caribou/i, category: 'Food & Dining' },
        { pattern: /mcdonald|burger|taco bell|subway|chipotle|pizza/i, category: 'Food & Dining' },
        { pattern: /restaurant|cafe|bistro|grill|dining/i, category: 'Food & Dining' },
        { pattern: /grocery|supermarket|walmart.*grocery|food.*market/i, category: 'Food & Dining' },
        
        // Gas Stations & Transportation - including your MAVERIK
        { pattern: /maverik/i, category: 'Transportation' },
        { pattern: /shell|exxon|chevron|bp|mobil|phillips|conoco|gas.*station|fuel/i, category: 'Transportation' },
        { pattern: /uber|lyft|taxi|rideshare/i, category: 'Transportation' },
        { pattern: /parking/i, category: 'Transportation' },
        
        // Shopping & Retail - including your specific stores
        { pattern: /victoria.*secret/i, category: 'Shopping' },
        { pattern: /nike|nikePOS/i, category: 'Shopping' },
        { pattern: /luckybrand|lucky.*brand/i, category: 'Shopping' },
        { pattern: /dickies/i, category: 'Shopping' },
        { pattern: /box.*lunch/i, category: 'Shopping' },
        { pattern: /amazon|ebay|walmart|target|costco/i, category: 'Shopping' },
        { pattern: /clothing|apparel|fashion/i, category: 'Shopping' },
        { pattern: /adidas|under armour|puma/i, category: 'Shopping' },
        
        // Entertainment & Subscriptions
        { pattern: /spotify/i, category: 'Entertainment' },
        { pattern: /netflix|hulu|disney|apple.*music|youtube/i, category: 'Entertainment' },
        { pattern: /movie|theater|cinema|amc|regal/i, category: 'Entertainment' },
        
        // Bills & Utilities
        { pattern: /electric|power|pge|con.*edison|duke.*energy/i, category: 'Bills & Utilities' },
        { pattern: /gas.*company|natural.*gas|nicor/i, category: 'Bills & Utilities' },
        { pattern: /comcast|verizon|att|spectrum|xfinity|internet|wifi|cable/i, category: 'Bills & Utilities' },
        { pattern: /tmobile|sprint|phone|mobile|cell/i, category: 'Bills & Utilities' },
        { pattern: /water|sewer|waste.*management/i, category: 'Bills & Utilities' },
        
        // Housing & Home
        { pattern: /mortgage|home.*loan/i, category: 'Mortgage' },
        { pattern: /rent|apartment|property.*mgmt|leasing/i, category: 'Housing' },
        { pattern: /home.*depot|lowes|hardware|ace.*hardware/i, category: 'Home Improvement' },
        
        // Healthcare
        { pattern: /pharmacy|cvs|walgreens|rite.*aid|doctor|medical|hospital|dental/i, category: 'Healthcare' },
        
        // Financial
        { pattern: /bank.*fee|overdraft|atm.*fee|service.*charge/i, category: 'Financial' },
        { pattern: /loan.*payment|credit.*card|interest/i, category: 'Financial' },
        { pattern: /insurance/i, category: 'Insurance' },
        
        // Government & Fees - including your parking fee
        { pattern: /parking.*id.*ser|dmv|government|tax|irs|city.*of|county.*of/i, category: 'Government' },
        
        // Cash & ATM
        { pattern: /atm|cash.*withdrawal|cash.*advance/i, category: 'Cash & ATM' },
        
        // Personal Care
        { pattern: /gym|fitness|planet.*fitness|24.*hour|spa|salon/i, category: 'Personal Care' },
        
        // Travel
        { pattern: /hotel|motel|airline|flight|travel|uber.*trip/i, category: 'Travel' },
      ];
      
      // Try enhanced pattern matching
      for (const { pattern, category } of enhancedPatterns) {
        if (pattern.test(searchText)) {
          return category;
        }
      }
      
      // Handle withdrawal transactions generically
      if (/withdrawal/i.test(searchText)) {
        // Extract merchant name after "withdrawal /"
        const withdrawalMatch = searchText.match(/withdrawal\s*\/\s*([^\/]+)/);
        if (withdrawalMatch) {
          const merchantPart = withdrawalMatch[1].trim();
          
          // Try patterns on just the merchant part
          for (const { pattern, category } of enhancedPatterns) {
            if (pattern.test(merchantPart)) {
              return category;
            }
          }
        }
        
        return 'Cash & ATM'; // Generic withdrawal
      }
      
      // Fallback to Other
      return 'Other';
    };

    // Update each transaction
    for (const transaction of transactions) {
      const newCategory = categorizeTransactionEnhanced(
        transaction.categories as string[],
        transaction.merchantName || '',
        transaction.name || '',
        transaction.amount
      );

      if (newCategory !== transaction.primaryCategory) {
        await prisma.transaction.update({
          where: { id: transaction.id },
          data: { primaryCategory: newCategory }
        });
        updatedCount++;
      }

      categoryStats[newCategory] = (categoryStats[newCategory] || 0) + 1;
    }

    console.log(`Enhanced re-categorization complete: ${updatedCount} transactions updated`);

    res.json({
      success: true,
      totalTransactions: transactions.length,
      updatedTransactions: updatedCount,
      categoryBreakdown: Object.entries(categoryStats)
        .sort(([,a], [,b]) => b - a)
        .map(([category, count]) => ({ 
          category, 
          count, 
          percentage: ((count / transactions.length) * 100).toFixed(1)
        }))
    });

  } catch (error: any) {
    console.error('Error in enhanced re-categorization:', error);
    res.status(500).json({ error: 'Failed to re-categorize transactions' });
  }
});

/**
 * GET /api/transactions/debug/categories
 * Debug endpoint to analyze current categorization
 */
router.get('/debug/categories', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    console.log(`Debug: Analyzing categories for user ${userId}`);

    const transactions = await prisma.transaction.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        merchantName: true,
        amount: true,
        categories: true,
        primaryCategory: true,
        detailedCategory: true,
        date: true
      },
      orderBy: { date: 'desc' },
      take: 100
    });

    console.log(`Found ${transactions.length} transactions to analyze`);

    // Analyze categories
    const plaidCategoryAnalysis: Record<string, {
      count: number,
      totalAmount: number,
      examples: Array<{name: string, merchant: string, amount: number}>
    }> = {};

    const enhancedCategoryAnalysis: Record<string, number> = {};

    transactions.forEach(transaction => {
      if (transaction.categories && transaction.categories.length > 0) {
        const categoryKey = transaction.categories.join(' > ');
        
        if (!plaidCategoryAnalysis[categoryKey]) {
          plaidCategoryAnalysis[categoryKey] = { count: 0, totalAmount: 0, examples: [] };
        }
        
        plaidCategoryAnalysis[categoryKey].count++;
        plaidCategoryAnalysis[categoryKey].totalAmount += Math.abs(transaction.amount);
        
        if (plaidCategoryAnalysis[categoryKey].examples.length < 3) {
          plaidCategoryAnalysis[categoryKey].examples.push({
            name: transaction.name,
            merchant: transaction.merchantName || 'N/A',
            amount: transaction.amount
          });
        }
      }

      if (transaction.primaryCategory) {
        enhancedCategoryAnalysis[transaction.primaryCategory] = 
          (enhancedCategoryAnalysis[transaction.primaryCategory] || 0) + 1;
      }
    });

    const sortedPlaidCategories = Object.entries(plaidCategoryAnalysis)
      .sort(([,a], [,b]) => b.count - a.count)
      .map(([category, data]) => ({
        plaidCategory: category,
        count: data.count,
        totalAmount: data.totalAmount,
        examples: data.examples
      }));

    const sortedEnhancedCategories = Object.entries(enhancedCategoryAnalysis)
      .sort(([,a], [,b]) => b - a)
      .map(([category, count]) => ({ category, count }));

    const problematicTransactions = transactions
      .filter(t => !t.primaryCategory || t.primaryCategory === 'Other')
      .slice(0, 10)
      .map(t => ({
        name: t.name,
        merchant: t.merchantName,
        amount: t.amount,
        plaidCategories: t.categories,
        currentCategory: t.primaryCategory
      }));

    res.json({
      summary: {
        totalTransactions: transactions.length,
        plaidCategoriesFound: sortedPlaidCategories.length,
        enhancedCategoriesFound: sortedEnhancedCategories.length,
        otherCount: enhancedCategoryAnalysis['Other'] || 0,
        uncategorizedCount: transactions.filter(t => !t.primaryCategory).length
      },
      plaidCategories: sortedPlaidCategories,
      enhancedCategories: sortedEnhancedCategories,
      problematicTransactions,
      sampleTransactions: transactions.slice(0, 5).map(t => ({
        name: t.name,
        merchant: t.merchantName,
        amount: t.amount,
        plaidCategories: t.categories,
        enhancedCategory: t.primaryCategory,
        detailedCategory: t.detailedCategory
      }))
    });

  } catch (error: any) {
    console.error('Error analyzing categories:', error);
    res.status(500).json({ error: 'Failed to analyze categories' });
  }
});

/**
 * PUT /api/transactions/:id/category
 * Update transaction category and learn from correction
 */
router.put('/:id/category', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { category } = req.body;
    const userId = req.user!.id;

    if (!category) {
      return res.status(400).json({ error: 'Category is required' });
    }

    // Verify transaction belongs to user
    const transaction = await prisma.transaction.findFirst({
      where: { id, userId }
    });

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // Update transaction category
    const updatedTransaction = await prisma.transaction.update({
      where: { id },
      data: { primaryCategory: category }
    });

    // Learn from this correction
    await SmartCategorizationService.learnFromCorrection(
      id, 
      transaction.primaryCategory || 'Other', 
      category
    );

    res.json({ 
      success: true,
      transaction: {
        id: updatedTransaction.id,
        primaryCategory: updatedTransaction.primaryCategory
      }
    });
  } catch (error: any) {
    console.error('Error updating transaction category:', error);
    res.status(500).json({ error: 'Failed to update transaction category' });
  }
});

/**
 * GET /api/transactions/:id/suggestions
 * Get categorization suggestions for a transaction
 */
router.get('/:id/suggestions', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    // Verify transaction belongs to user
    const transaction = await prisma.transaction.findFirst({
      where: { id, userId },
      select: { name: true, merchantName: true }
    });

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // Get smart categorization suggestions
    const suggestions = await SmartCategorizationService.getSuggestions(
      transaction.name,
      transaction.merchantName || undefined
    );

    res.json({ suggestions });
  } catch (error: any) {
    console.error('Error getting categorization suggestions:', error);
    res.status(500).json({ error: 'Failed to get suggestions' });
  }
});

/**
 * PUT /api/transactions/:id/notes
 * Update transaction notes
 */
router.put('/:id/notes', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    const userId = req.user!.id;

    // Verify transaction belongs to user
    const transaction = await prisma.transaction.findFirst({
      where: { id, userId }
    });

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // Update transaction notes
    const updatedTransaction = await prisma.transaction.update({
      where: { id },
      data: { notes: notes || null }
    });

    res.json({ 
      success: true,
      transaction: {
        id: updatedTransaction.id,
        notes: updatedTransaction.notes
      }
    });
  } catch (error: any) {
    console.error('Error updating transaction notes:', error);
    res.status(500).json({ error: 'Failed to update transaction notes' });
  }
});

/**
 * POST /api/transactions/debug/recategorize
 * Enhanced re-categorization for your specific bank format
 */
router.post('/debug/recategorize', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    console.log(`Enhanced re-categorizing transactions for user ${userId}`);

    const transactions = await prisma.transaction.findMany({
      where: { userId }
    });

    console.log(`Found ${transactions.length} transactions to re-categorize`);

    let updatedCount = 0;
    const categoryStats: Record<string, number> = {};

    const categorizeTransactionEnhanced = (
      plaidCategories: string[],
      merchantName: string,
      transactionName: string,
      amount: number
    ): string => {
      const searchText = `${merchantName || ''} ${transactionName || ''}`.toLowerCase();
      
      // Handle income
      if (amount < 0) {
        if (plaidCategories.includes('Payroll') || 
            plaidCategories.includes('Deposit') ||
            /payroll|salary|direct dep|income|wage|deposit|transfer.*in/i.test(searchText)) {
          return 'Income';
        }
      }
      
      const enhancedPatterns = [
        // Coffee & Food
        { pattern: /starbucks/i, category: 'Food & Dining' },
        { pattern: /dutch bros/i, category: 'Food & Dining' },
        { pattern: /coffee|dunkin|caribou/i, category: 'Food & Dining' },
        { pattern: /mcdonald|burger|taco bell|subway|chipotle|pizza/i, category: 'Food & Dining' },
        { pattern: /restaurant|cafe|bistro|grill|dining/i, category: 'Food & Dining' },
        { pattern: /grocery|supermarket|walmart.*grocery|food.*market/i, category: 'Food & Dining' },
        
        // Gas Stations & Transportation
        { pattern: /maverik/i, category: 'Transportation' },
        { pattern: /shell|exxon|chevron|bp|mobil|phillips|conoco|gas.*station|fuel/i, category: 'Transportation' },
        { pattern: /uber|lyft|taxi|rideshare/i, category: 'Transportation' },
        { pattern: /parking/i, category: 'Transportation' },
        
        // Shopping & Retail
        { pattern: /victoria.*secret/i, category: 'Shopping' },
        { pattern: /nike|nikePOS/i, category: 'Shopping' },
        { pattern: /luckybrand|lucky.*brand/i, category: 'Shopping' },
        { pattern: /dickies/i, category: 'Shopping' },
        { pattern: /box.*lunch/i, category: 'Shopping' },
        { pattern: /amazon|ebay|walmart|target|costco/i, category: 'Shopping' },
        { pattern: /clothing|apparel|fashion/i, category: 'Shopping' },
        { pattern: /adidas|under armour|puma/i, category: 'Shopping' },
        
        // Entertainment & Subscriptions
        { pattern: /spotify/i, category: 'Entertainment' },
        { pattern: /netflix|hulu|disney|apple.*music|youtube/i, category: 'Entertainment' },
        { pattern: /movie|theater|cinema|amc|regal/i, category: 'Entertainment' },
        
        // Bills & Utilities
        { pattern: /electric|power|pge|con.*edison|duke.*energy/i, category: 'Bills & Utilities' },
        { pattern: /gas.*company|natural.*gas|nicor/i, category: 'Bills & Utilities' },
        { pattern: /comcast|verizon|att|spectrum|xfinity|internet|wifi|cable/i, category: 'Bills & Utilities' },
        { pattern: /tmobile|sprint|phone|mobile|cell/i, category: 'Bills & Utilities' },
        { pattern: /water|sewer|waste.*management/i, category: 'Bills & Utilities' },
        
        // Housing & Home
        { pattern: /mortgage|home.*loan/i, category: 'Mortgage' },
        { pattern: /rent|apartment|property.*mgmt|leasing/i, category: 'Housing' },
        { pattern: /home.*depot|lowes|hardware|ace.*hardware/i, category: 'Home Improvement' },
        
        // Healthcare
        { pattern: /pharmacy|cvs|walgreens|rite.*aid|doctor|medical|hospital|dental/i, category: 'Healthcare' },
        
        // Financial
        { pattern: /bank.*fee|overdraft|atm.*fee|service.*charge/i, category: 'Financial' },
        { pattern: /loan.*payment|credit.*card|interest/i, category: 'Financial' },
        { pattern: /insurance/i, category: 'Insurance' },
        
        // Government & Fees
        { pattern: /parking.*id.*ser|dmv|government|tax|irs|city.*of|county.*of/i, category: 'Government' },
        
        // Cash & ATM
        { pattern: /atm|cash.*withdrawal|cash.*advance/i, category: 'Cash & ATM' },
        
        // Personal Care
        { pattern: /gym|fitness|planet.*fitness|24.*hour|spa|salon/i, category: 'Personal Care' },
      ];
      
      // Try enhanced pattern matching
      for (const { pattern, category } of enhancedPatterns) {
        if (pattern.test(searchText)) {
          return category;
        }
      }
      
      // Handle withdrawal transactions specifically
      if (/withdrawal/i.test(searchText)) {
        const withdrawalMatch = searchText.match(/withdrawal\s*\/\s*([^\/\s]+)/);
        if (withdrawalMatch) {
          const merchantPart = withdrawalMatch[1].trim();
          
          // Try patterns on just the merchant part
          for (const { pattern, category } of enhancedPatterns) {
            if (pattern.test(merchantPart)) {
              return category;
            }
          }
        }
        return 'Cash & ATM';
      }
      
      return 'Other';
    };

    // Update each transaction
    for (const transaction of transactions) {
      const newCategory = categorizeTransactionEnhanced(
        transaction.categories as string[],
        transaction.merchantName || '',
        transaction.name || '',
        transaction.amount
      );

      if (newCategory !== transaction.primaryCategory) {
        await prisma.transaction.update({
          where: { id: transaction.id },
          data: { primaryCategory: newCategory }
        });
        updatedCount++;
      }

      categoryStats[newCategory] = (categoryStats[newCategory] || 0) + 1;
    }

    console.log(`Enhanced re-categorization complete: ${updatedCount} transactions updated`);

    res.json({
      success: true,
      totalTransactions: transactions.length,
      updatedTransactions: updatedCount,
      categoryBreakdown: Object.entries(categoryStats)
        .sort(([,a], [,b]) => b - a)
        .map(([category, count]) => ({ 
          category, 
          count, 
          percentage: ((count / transactions.length) * 100).toFixed(1)
        }))
    });

  } catch (error: any) {
    console.error('Error in enhanced re-categorization:', error);
    res.status(500).json({ error: 'Failed to re-categorize transactions' });
  }
});

export default router;
