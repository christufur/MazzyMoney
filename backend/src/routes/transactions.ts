import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authenticateToken } from '../middleware/auth';
import { TransactionSyncService } from '../services/transactionSyncService';

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
      month: new Date(item.month).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
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
 * Body: { force?: boolean }
 * Starts a background sync and returns at once; the client polls /sync-status.
 */
router.post('/sync', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const force = Boolean(req.body?.force);

    // One run per user at a time: a second click must not start a parallel pull.
    const syncing = await prisma.plaidItem.count({
      where: { userId, status: 'SYNCING' }
    });

    if (syncing > 0) {
      return res.status(409).json({
        error: 'Sync already in progress',
        status: 'SYNCING'
      });
    }

    const syncPromise = force
      ? TransactionSyncService.fullResync(userId)
      : TransactionSyncService.syncUser(userId);

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

    // Update transaction category. Correcting a category makes the user the owner of it,
    // so later syncs never overwrite it (H8).
    const updatedTransaction = await prisma.transaction.update({
      where: { id },
      data: { primaryCategory: category, categorySource: 'USER' }
    });

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


export default router;
