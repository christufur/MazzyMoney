// src/services/budgetSyncService.ts
import { prisma } from '../lib/prisma';
import { Budget, BudgetPeriod } from '../../prisma/generated/prisma';

export class BudgetSyncService {
  /**
   * Calculate and update spending for all active user budgets
   */
  static async syncUserBudgets(userId: string): Promise<void> {
    console.log(`Syncing budgets for user: ${userId}`);
    
    const budgets = await prisma.budget.findMany({
      where: { userId, isActive: true }
    });

    const results = await Promise.allSettled(
      budgets.map(budget => this.calculateBudgetSpending(budget))
    );

    // Log any failures
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.error(`Failed to sync budget ${budgets[index].id}:`, result.reason);
      }
    });
  }

  /**
   * Calculate current spending for a budget based on its date range
   */
  static async calculateBudgetSpending(budget: Budget): Promise<{
    spent: number;
    remaining: number;
    percentUsed: number;
  }> {
    const now = new Date();
    const effectiveEndDate = budget.endDate || now;
    
    // Only calculate if we're within the budget period
    if (now < budget.startDate || now > effectiveEndDate) {
      return {
        spent: 0,
        remaining: budget.amount,
        percentUsed: 0
      };
    }

    // Get spending for this category in the budget period
    const categorySpending = await prisma.transaction.aggregate({
      where: {
        userId: budget.userId,
        primaryCategory: budget.category,
        amount: { gt: 0 }, // Only expenses
        date: {
          gte: budget.startDate,
          lte: effectiveEndDate
        }
      },
      _sum: {
        amount: true
      }
    });

    const spent = categorySpending._sum.amount || 0;
    const remaining = budget.amount - spent;
    const percentUsed = budget.amount > 0 ? (spent / budget.amount) * 100 : 0;

    return {
      spent,
      remaining,
      percentUsed
    };
  }

  /**
   * Create date range for a budget period starting from a given date
   */
  static createBudgetPeriod(period: BudgetPeriod, startDate: Date = new Date()): { startDate: Date, endDate: Date } {
    const start = new Date(startDate);
    const end = new Date(startDate);

    switch (period) {
      case 'WEEKLY':
        end.setDate(start.getDate() + 6);
        end.setHours(23, 59, 59, 999);
        break;
        
      case 'MONTHLY':
        end.setMonth(start.getMonth() + 1);
        end.setDate(0); // Last day of the month
        end.setHours(23, 59, 59, 999);
        break;
        
      case 'QUARTERLY':
        end.setMonth(start.getMonth() + 3);
        end.setDate(0); // Last day of the quarter month
        end.setHours(23, 59, 59, 999);
        break;
        
      case 'YEARLY':
        end.setFullYear(start.getFullYear() + 1);
        end.setMonth(0, 0); // Last day of the year
        end.setHours(23, 59, 59, 999);
        break;
    }

    return { startDate: start, endDate: end };
  }

  /**
   * Get budget categories from user's transaction history
   */
  static async getAvailableCategories(userId: string): Promise<string[]> {
    const categories = await prisma.transaction.groupBy({
      by: ['primaryCategory'],
      where: {
        userId,
        primaryCategory: { not: null },
        amount: { gt: 0 } // Only expenses have meaningful categories for budgeting
      },
      _count: {
        id: true
      },
      having: {
        id: {
          _count: {
            gte: 5 // Only include categories with at least 5 transactions
          }
        }
      },
      orderBy: {
        _count: {
          id: 'desc'
        }
      }
    });

    return categories
      .map(c => c.primaryCategory)
      .filter((cat): cat is string => cat !== null);
  }
}