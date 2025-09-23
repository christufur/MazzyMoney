import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authenticateToken } from '../middleware/auth';
import { BudgetSyncService } from '../services/budgetSyncService';

const router = Router();
router.use(authenticateToken);

// GET /api/budgets - Get all budgets with current spending
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    
    const budgets = await prisma.budget.findMany({
      where: { userId, isActive: true },
      orderBy: { createdAt: 'desc' }
    });

    // Calculate current spending for each budget
    const budgetsWithSpending = await Promise.all(
      budgets.map(async (budget) => {
        const spending = await BudgetSyncService.calculateBudgetSpending(budget);
        return {
          ...budget,
          ...spending
        };
      })
    );

    res.json({ budgets: budgetsWithSpending });
  } catch (error: any) {
    console.error('Error fetching budgets:', error);
    res.status(500).json({ error: 'Failed to fetch budgets' });
  }
});

// POST /api/budgets - Create new budget
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { name, category, amount, period, startDate } = req.body;

    // Validation
    if (!name || !category || !amount || !period) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (amount <= 0) {
      return res.status(400).json({ error: 'Amount must be greater than 0' });
    }

    // Create budget period dates
    const budgetStartDate = startDate ? new Date(startDate) : new Date();
    const { endDate } = BudgetSyncService.createBudgetPeriod(period, budgetStartDate);

    // Check for overlapping budgets in the same category
    const overlapping = await prisma.budget.findFirst({
      where: {
        userId,
        category,
        isActive: true,
        OR: [
          {
            AND: [
              { startDate: { lte: budgetStartDate } },
              { endDate: { gte: budgetStartDate } }
            ]
          },
          {
            AND: [
              { startDate: { lte: endDate } },
              { endDate: { gte: endDate } }
            ]
          }
        ]
      }
    });

    if (overlapping) {
      return res.status(409).json({ 
        error: `You already have an overlapping budget for ${category}` 
      });
    }

    // Create budget
    const budget = await prisma.budget.create({
      data: {
        userId,
        name,
        category,
        amount: parseFloat(amount),
        period,
        startDate: budgetStartDate,
        endDate
      }
    });

    // Calculate initial spending
    const spending = await BudgetSyncService.calculateBudgetSpending(budget);

    res.status(201).json({ 
      budget: {
        ...budget,
        ...spending
      }
    });
  } catch (error: any) {
    console.error('Error creating budget:', error);
    res.status(500).json({ error: 'Failed to create budget' });
  }
});

// PUT /api/budgets/:id - Update budget
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;
    const { name, category, amount, period, startDate, endDate } = req.body;

    const budget = await prisma.budget.findFirst({
      where: { id, userId }
    });

    if (!budget) {
      return res.status(404).json({ error: 'Budget not found' });
    }

    // Calculate new dates if period or start date changed
    let newStartDate = budget.startDate;
    let newEndDate = budget.endDate;

    if (startDate || period) {
      newStartDate = startDate ? new Date(startDate) : budget.startDate;
      if (period && period !== budget.period) {
        const { endDate: calculatedEndDate } = BudgetSyncService.createBudgetPeriod(period, newStartDate);
        newEndDate = calculatedEndDate;
      }
    }

    // Update budget
    const updatedBudget = await prisma.budget.update({
      where: { id },
      data: {
        name: name || budget.name,
        category: category || budget.category,
        amount: amount ? parseFloat(amount) : budget.amount,
        period: period || budget.period,
        startDate: newStartDate,
        endDate: endDate ? new Date(endDate) : newEndDate,
        updatedAt: new Date()
      }
    });

    // Recalculate spending
    const spending = await BudgetSyncService.calculateBudgetSpending(updatedBudget);

    res.json({ 
      budget: {
        ...updatedBudget,
        ...spending
      }
    });
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