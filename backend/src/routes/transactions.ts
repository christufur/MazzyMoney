import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authenticateToken } from '../middleware/auth';
import { TransactionSyncService } from '../services/transactionSyncService';
import { CATEGORIES } from '../services/categories';
import { COUNTED, cents } from '../services/analyticsService';

const router = Router();
router.use(authenticateToken);

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const MAX_BULK_IDS = 500;
const NOTES_MAX_LENGTH = 500;

/** A positive integer query value, or the fallback when it is missing or junk. */
const positiveInt = (value: unknown, fallback: number): number => {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

const isCategory = (value: unknown): value is string =>
  typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value);

/**
 * GET /api/transactions
 * Get cached transactions with filtering and pagination.
 *
 * Hidden rows are left out unless `includeHidden=true`; transfers are shown by
 * default (`transfers=exclude|only` changes that). The list is for browsing, so
 * the money totals in `summary` still never count transfers or hidden rows.
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const {
      page = '1',
      limit = String(DEFAULT_PAGE_SIZE),
      category,
      accountId,
      search,
      dateFrom,
      dateTo,
      amountMin,
      amountMax,
      type, // 'income', 'expense', or 'all'
      reviewed,
      includeHidden,
      transfers,
    } = req.query;

    const pageNum = positiveInt(page, 1);
    const limitNum = Math.min(positiveInt(limit, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
    const skip = (pageNum - 1) * limitNum;

    // Build where clause
    const where: any = { userId };

    if (reviewed === 'true') where.reviewed = true;
    else if (reviewed === 'false') where.reviewed = false;

    if (includeHidden !== 'true') where.hidden = false;

    if (transfers === 'exclude') where.isTransfer = false;
    else if (transfers === 'only') where.isTransfer = true;

    if (category) {
      where.primaryCategory = category as string;
    }

    if (accountId) {
      where.accountId = accountId as string;
    }

    if (search && String(search).trim()) {
      const term = String(search).trim();
      where.OR = [
        { name: { contains: term, mode: 'insensitive' } },
        { merchantName: { contains: term, mode: 'insensitive' } },
        { merchantDisplay: { contains: term, mode: 'insensitive' } },
        { notes: { contains: term, mode: 'insensitive' } },
      ];
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
              mask: true,
            },
          },
        },
        orderBy: { date: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.transaction.count({ where }),
    ]);

    // Calculate summary stats for the filtered results.
    // The summary is money totals, so transfers and hidden rows never count (H6); the
    // transaction list above still returns them. The amount type filter is combined with
    // AND so it does not replace an amountMin/amountMax range.
    const summaryStats = await prisma.transaction.aggregate({
      where: { AND: [where, COUNTED] },
      _sum: {
        amount: true,
      },
      _count: {
        id: true,
      },
    });

    const totalAmount = cents(summaryStats._sum.amount || 0);
    const income = await prisma.transaction.aggregate({
      where: { AND: [where, COUNTED, { amount: { lt: 0 } }] },
      _sum: { amount: true },
      _count: { id: true },
    });

    const expenses = await prisma.transaction.aggregate({
      where: { AND: [where, COUNTED, { amount: { gt: 0 } }] },
      _sum: { amount: true },
      _count: { id: true },
    });

    const incomeTotal = cents(Math.abs(income._sum.amount || 0));
    const expenseTotal = cents(expenses._sum.amount || 0);

    res.json({
      transactions,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(totalCount / limitNum),
        totalCount,
        hasNext: skip + limitNum < totalCount,
        hasPrev: pageNum > 1,
      },
      summary: {
        totalTransactions: summaryStats._count.id || 0,
        totalAmount,
        income: incomeTotal,
        incomeCount: income._count.id,
        expenses: expenseTotal,
        expenseCount: expenses._count.id,
        netAmount: cents(incomeTotal - expenseTotal),
      },
    });
  } catch (error: any) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

/**
 * GET /api/transactions/review-count
 * How many rows the review queue still has (not reviewed, not hidden).
 */
router.get('/review-count', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const count = await prisma.transaction.count({
      where: { userId, reviewed: false, hidden: false },
    });

    res.json({ count });
  } catch (error: any) {
    console.error('Error counting transactions to review:', error);
    res.status(500).json({ error: 'Failed to count transactions to review' });
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
      ...COUNTED,
      amount: { gt: 0 }, // Only expenses
      primaryCategory: { not: null },
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
        amount: true,
      },
      _count: {
        id: true,
      },
      orderBy: {
        _sum: {
          amount: 'desc',
        },
      },
    });

    const result = categorySpending.map(item => ({
      category: item.primaryCategory,
      amount: cents(item._sum.amount || 0),
      transactionCount: item._count.id,
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

    // Get monthly aggregated data using raw SQL for better performance.
    // Transfers and hidden rows are excluded here so they never look like income or expenses.
    const monthlyData = await prisma.$queryRaw`
      SELECT 
        DATE_TRUNC('month', date) as month,
        SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as expenses,
        SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) as income,
        COUNT(*) as transaction_count
      FROM transactions 
      WHERE "userId" = ${userId} AND date >= ${startDate}
        AND "isTransfer" = false AND "hidden" = false
      GROUP BY DATE_TRUNC('month', date)
      ORDER BY month ASC
    `;

    const formattedData = (monthlyData as any[]).map(item => ({
      month: new Date(item.month).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
      expenses: cents(parseFloat(item.expenses) || 0),
      income: cents(parseFloat(item.income) || 0),
      transactionCount: parseInt(item.transaction_count),
      netAmount: cents((parseFloat(item.income) || 0) - (parseFloat(item.expenses) || 0)),
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
      where: { userId, status: 'SYNCING' },
    });

    if (syncing > 0) {
      return res.status(409).json({
        error: 'Sync already in progress',
        status: 'SYNCING',
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
      status: 'SYNCING',
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
 * PUT /api/transactions/bulk
 * Body: { ids: string[], category?, reviewed?, hidden?, isTransfer? }
 *
 * All ids must belong to the user, otherwise nothing changes. A category change
 * marks the category as the user's own so a later sync never overwrites it (H8).
 * Registered before PUT /:id so "bulk" is not read as an id.
 */
router.put('/bulk', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { ids, category, reviewed, hidden, isTransfer } = req.body ?? {};

    if (
      !Array.isArray(ids) ||
      ids.length === 0 ||
      ids.length > MAX_BULK_IDS ||
      ids.some(id => typeof id !== 'string' || id.trim() === '')
    ) {
      return res.status(400).json({
        error: `ids must be an array of 1 to ${MAX_BULK_IDS} transaction ids`,
      });
    }

    const uniqueIds = Array.from(new Set(ids as string[]));
    const data: any = {};

    if (category !== undefined) {
      if (!isCategory(category)) {
        return res.status(400).json({ error: 'Unknown category' });
      }
      data.primaryCategory = category;
      data.categorySource = 'USER';
    }

    const flags: Array<[string, unknown]> = [
      ['reviewed', reviewed],
      ['hidden', hidden],
      ['isTransfer', isTransfer],
    ];

    for (const [field, value] of flags) {
      if (value === undefined) continue;
      if (!isBoolean(value)) {
        return res.status(400).json({ error: `${field} must be true or false` });
      }
      data[field] = value;
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    const owned = await prisma.transaction.count({
      where: { userId, id: { in: uniqueIds } },
    });

    if (owned !== uniqueIds.length) {
      return res.status(403).json({
        error: 'One or more transactions do not belong to you',
      });
    }

    const result = await prisma.transaction.updateMany({
      where: { userId, id: { in: uniqueIds } },
      data,
    });

    res.json({ updated: result.count });
  } catch (error: any) {
    console.error('Error bulk updating transactions:', error);
    res.status(500).json({ error: 'Failed to update transactions' });
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

    if (!isCategory(category)) {
      return res.status(400).json({ error: 'Unknown category' });
    }

    // Verify transaction belongs to user
    const transaction = await prisma.transaction.findFirst({
      where: { id, userId },
    });

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // Update transaction category. Correcting a category makes the user the owner of it,
    // so later syncs never overwrite it (H8).
    const updatedTransaction = await prisma.transaction.update({
      where: { id },
      data: { primaryCategory: category, categorySource: 'USER' },
    });

    res.json({
      success: true,
      transaction: {
        id: updatedTransaction.id,
        primaryCategory: updatedTransaction.primaryCategory,
      },
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

    if (notes !== undefined && notes !== null && typeof notes !== 'string') {
      return res.status(400).json({ error: 'Notes must be text' });
    }

    if (typeof notes === 'string' && notes.length > NOTES_MAX_LENGTH) {
      return res.status(400).json({
        error: `Notes must be ${NOTES_MAX_LENGTH} characters or fewer`,
      });
    }

    // Verify transaction belongs to user
    const transaction = await prisma.transaction.findFirst({
      where: { id, userId },
    });

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // Update transaction notes
    const updatedTransaction = await prisma.transaction.update({
      where: { id },
      data: { notes: notes || null },
    });

    res.json({
      success: true,
      transaction: {
        id: updatedTransaction.id,
        notes: updatedTransaction.notes,
      },
    });
  } catch (error: any) {
    console.error('Error updating transaction notes:', error);
    res.status(500).json({ error: 'Failed to update transaction notes' });
  }
});

/**
 * PUT /api/transactions/:id
 * Body: { reviewed?, hidden?, isTransfer? }
 * The row-level review/hide/transfer switches (W4.1).
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const { reviewed, hidden, isTransfer } = req.body ?? {};

    const data: any = {};
    const flags: Array<[string, unknown]> = [
      ['reviewed', reviewed],
      ['hidden', hidden],
      ['isTransfer', isTransfer],
    ];

    for (const [field, value] of flags) {
      if (value === undefined) continue;
      if (!isBoolean(value)) {
        return res.status(400).json({ error: `${field} must be true or false` });
      }
      data[field] = value;
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    const transaction = await prisma.transaction.findFirst({
      where: { id, userId },
    });

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const updatedTransaction = await prisma.transaction.update({
      where: { id },
      data,
    });

    res.json({
      success: true,
      transaction: {
        id: updatedTransaction.id,
        reviewed: updatedTransaction.reviewed,
        hidden: updatedTransaction.hidden,
        isTransfer: updatedTransaction.isTransfer,
      },
    });
  } catch (error: any) {
    console.error('Error updating transaction:', error);
    res.status(500).json({ error: 'Failed to update transaction' });
  }
});

export default router;
