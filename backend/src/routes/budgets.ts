import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authenticateToken } from '../middleware/auth';
import { Budget } from '../../prisma/generated/prisma';
import {
  BudgetSyncService,
  addMonths,
  isMonthKey,
  monthStart
} from '../services/budgetSyncService';
import { BudgetAlertService } from '../services/budgetAlertService';
import { cents } from '../services/analyticsService';
import { CATEGORIES } from '../services/categories';
import budgetAlertRouter from './budgetAlerts';

const router = Router();
router.use(authenticateToken);
router.use('/:budgetId/alerts', budgetAlertRouter);

const KNOWN_CATEGORIES: readonly string[] = CATEGORIES;

const isValidCategory = (category: unknown): category is string =>
  typeof category === 'string' && KNOWN_CATEGORIES.includes(category);

/** A number from a JSON body or a form string; `NaN` when it is not one. */
const toAmount = (value: unknown): number =>
  typeof value === 'string' ? parseFloat(value) : typeof value === 'number' ? value : NaN;

/** The budget fields the page uses, plus one month's numbers and the chart history. */
const serializeBudget = async (
  budget: Budget & { budgetAlerts?: unknown[] },
  month: string
) => {
  const [snapshot, history] = await Promise.all([
    BudgetSyncService.budgetForMonth(budget, month),
    BudgetSyncService.history(budget, month)
  ]);

  return {
    id: budget.id,
    name: budget.name,
    category: budget.category,
    amount: budget.amount,
    rollover: budget.rollover,
    startDate: budget.startDate,
    isActive: budget.isActive,
    createdAt: budget.createdAt,
    updatedAt: budget.updatedAt,
    budgetAlerts: budget.budgetAlerts,
    ...snapshot,
    history
  };
};

// GET /api/budgets/suggestions - What the last 3 full months say to budget.
// Registered before /:id so a suggestion request is never read as a budget id.
router.get('/suggestions', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { months, suggestions } = await BudgetSyncService.suggestBudgets(userId);

    res.json({ months, suggestions });
  } catch (error: any) {
    console.error('Error fetching budget suggestions:', error);
    res.status(500).json({ error: 'Failed to fetch budget suggestions' });
  }
});

// GET /api/budgets?month=YYYY-MM - Budgets with spending, rollover and history
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const requested = req.query.month ?? BudgetSyncService.currentMonth();

    if (!isMonthKey(requested)) {
      return res.status(400).json({ error: 'month must be in YYYY-MM format' });
    }

    const month = requested;

    // A budget is active from its start month onward. `startDate` is the first day
    // of that month at UTC midnight; the comparison keeps legacy mid-month rows.
    const budgets = await prisma.budget.findMany({
      where: {
        userId,
        isActive: true,
        startDate: { lt: monthStart(addMonths(month, 1)) }
      },
      orderBy: { createdAt: 'desc' },
      include: { budgetAlerts: true }
    });

    const rows = await Promise.all(
      budgets.map((budget) => serializeBudget(budget, month))
    );

    const totals = rows.reduce(
      (sum, row) => ({
        budgeted: sum.budgeted + row.budgeted,
        spent: sum.spent + row.spent,
        available: sum.available + row.available,
        remaining: sum.remaining + row.remaining
      }),
      { budgeted: 0, spent: 0, available: 0, remaining: 0 }
    );

    res.json({
      month,
      budgets: rows,
      totals: {
        budgeted: cents(totals.budgeted),
        spent: cents(totals.spent),
        available: cents(totals.available),
        remaining: cents(totals.remaining)
      }
    });
  } catch (error: any) {
    console.error('Error fetching budgets:', error);
    res.status(500).json({ error: 'Failed to fetch budgets' });
  }
});

// POST /api/budgets - Create a monthly budget active from its start month
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { name, category, amount, rollover, startMonth } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }

    if (!isValidCategory(category)) {
      return res.status(400).json({ error: 'Invalid category' });
    }

    const parsedAmount = toAmount(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ error: 'Amount must be greater than 0' });
    }

    const month = startMonth ?? BudgetSyncService.currentMonth();
    if (!isMonthKey(month)) {
      return res.status(400).json({ error: 'startMonth must be in YYYY-MM format' });
    }

    // One active budget per category: budgets repeat, so two would double count.
    const existing = await prisma.budget.findFirst({
      where: { userId, category, isActive: true }
    });

    if (existing) {
      return res.status(409).json({ error: `You already have a budget for ${category}` });
    }

    const budget = await prisma.budget.create({
      data: {
        userId,
        name: name.trim(),
        category,
        amount: parsedAmount,
        rollover: Boolean(rollover),
        period: 'MONTHLY',
        startDate: monthStart(month),
        endDate: null
      }
    });

    await BudgetAlertService.ensureDefaultAlerts(budget);

    const created = await prisma.budget.findFirstOrThrow({
      where: { id: budget.id },
      include: { budgetAlerts: true }
    });

    res.status(201).json({
      budget: await serializeBudget(created, BudgetSyncService.currentMonth())
    });
  } catch (error: any) {
    console.error('Error creating budget:', error);
    res.status(500).json({ error: 'Failed to create budget' });
  }
});

// PUT /api/budgets/:id - Update name, category, amount or rollover
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;
    const { name, category, amount, rollover } = req.body;

    const budget = await prisma.budget.findFirst({
      where: { id, userId }
    });

    if (!budget) {
      return res.status(404).json({ error: 'Budget not found' });
    }

    if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
      return res.status(400).json({ error: 'Name is required' });
    }

    if (category !== undefined && !isValidCategory(category)) {
      return res.status(400).json({ error: 'Invalid category' });
    }

    let parsedAmount: number | undefined;
    if (amount !== undefined) {
      parsedAmount = toAmount(amount);
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        return res.status(400).json({ error: 'Amount must be greater than 0' });
      }
    }

    const nextCategory = category ?? budget.category;
    if (nextCategory !== budget.category) {
      const duplicate = await prisma.budget.findFirst({
        where: { userId, category: nextCategory, isActive: true, id: { not: budget.id } }
      });

      if (duplicate) {
        return res.status(409).json({ error: `You already have a budget for ${nextCategory}` });
      }
    }

    const updatedBudget = await prisma.budget.update({
      where: { id },
      data: {
        name: name !== undefined ? name.trim() : budget.name,
        category: nextCategory,
        amount: parsedAmount ?? budget.amount,
        rollover: rollover !== undefined ? Boolean(rollover) : budget.rollover
      },
      include: { budgetAlerts: true }
    });

    const current = BudgetSyncService.currentMonth();
    const snapshot = await BudgetSyncService.budgetForMonth(updatedBudget, current);

    await BudgetAlertService.evaluateBudgetAlerts(updatedBudget, snapshot);

    res.json({ budget: await serializeBudget(updatedBudget, current) });
  } catch (error: any) {
    console.error('Error updating budget:', error);
    res.status(500).json({ error: 'Failed to update budget' });
  }
});

// DELETE /api/budgets/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;

    const budget = await prisma.budget.findFirst({
      where: { id, userId }
    });

    if (!budget) {
      return res.status(404).json({ error: 'Budget not found' });
    }

    await prisma.budget.delete({
      where: { id }
    });

    res.json({ message: 'Budget deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting budget:', error);
    res.status(500).json({ error: 'Failed to delete budget' });
  }
});

// GET /api/budgets/categories
router.get('/categories', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const categories = await BudgetSyncService.getAvailableCategories(userId);

    res.json({ categories });
  } catch (error: any) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

export default router;
