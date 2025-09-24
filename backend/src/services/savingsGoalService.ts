import { prisma } from '../lib/prisma';

export class SavingsGoalService {
  /**
   * Create a new savings goal
   */
  static async createGoal(userId: string, goalData: {
    name: string;
    description?: string;
    targetAmount: number;
    targetDate: Date;
    category?: string;
  }) {
    const goal = await prisma.savingsGoal.create({
      data: {
        userId,
        ...goalData
      }
    });

    return goal;
  }

  /**
   * Get all savings goals for a user
   */
  static async getGoals(userId: string) {
    const goals = await prisma.savingsGoal.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    });

    return goals.map(goal => ({
      ...goal,
      progressPercentage: (goal.currentAmount / goal.targetAmount) * 100,
      remainingAmount: goal.targetAmount - goal.currentAmount,
      daysRemaining: Math.ceil((goal.targetDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)),
      isOverdue: goal.targetDate < new Date() && !goal.isCompleted
    }));
  }

  /**
   * Update a savings goal
   */
  static async updateGoal(goalId: string, userId: string, updateData: {
    name?: string;
    description?: string;
    targetAmount?: number;
    targetDate?: Date;
    category?: string;
    isActive?: boolean;
  }) {
    const goal = await prisma.savingsGoal.findFirst({
      where: { id: goalId, userId }
    });

    if (!goal) {
      throw new Error('Goal not found');
    }

    const updatedGoal = await prisma.savingsGoal.update({
      where: { id: goalId },
      data: updateData
    });

    return updatedGoal;
  }

  /**
   * Add money to a savings goal
   */
  static async addToGoal(goalId: string, userId: string, amount: number) {
    const goal = await prisma.savingsGoal.findFirst({
      where: { id: goalId, userId }
    });

    if (!goal) {
      throw new Error('Goal not found');
    }

    const newAmount = goal.currentAmount + amount;
    const isCompleted = newAmount >= goal.targetAmount;

    const updatedGoal = await prisma.savingsGoal.update({
      where: { id: goalId },
      data: {
        currentAmount: newAmount,
        isCompleted: isCompleted || goal.isCompleted
      }
    });

    return updatedGoal;
  }

  /**
   * Remove money from a savings goal
   */
  static async removeFromGoal(goalId: string, userId: string, amount: number) {
    const goal = await prisma.savingsGoal.findFirst({
      where: { id: goalId, userId }
    });

    if (!goal) {
      throw new Error('Goal not found');
    }

    const newAmount = Math.max(0, goal.currentAmount - amount);
    const isCompleted = newAmount >= goal.targetAmount;

    const updatedGoal = await prisma.savingsGoal.update({
      where: { id: goalId },
      data: {
        currentAmount: newAmount,
        isCompleted: isCompleted && newAmount > 0
      }
    });

    return updatedGoal;
  }

  /**
   * Delete a savings goal
   */
  static async deleteGoal(goalId: string, userId: string) {
    const goal = await prisma.savingsGoal.findFirst({
      where: { id: goalId, userId }
    });

    if (!goal) {
      throw new Error('Goal not found');
    }

    await prisma.savingsGoal.delete({
      where: { id: goalId }
    });

    return { success: true };
  }

  /**
   * Get savings goal analytics
   */
  static async getGoalAnalytics(userId: string) {
    const goals = await prisma.savingsGoal.findMany({
      where: { userId }
    });

    const totalTargetAmount = goals.reduce((sum, goal) => sum + goal.targetAmount, 0);
    const totalCurrentAmount = goals.reduce((sum, goal) => sum + goal.currentAmount, 0);
    const completedGoals = goals.filter(goal => goal.isCompleted).length;
    const activeGoals = goals.filter(goal => goal.isActive && !goal.isCompleted).length;
    const overdueGoals = goals.filter(goal => 
      goal.targetDate < new Date() && !goal.isCompleted
    ).length;

    const averageProgress = goals.length > 0 
      ? goals.reduce((sum, goal) => sum + (goal.currentAmount / goal.targetAmount), 0) / goals.length * 100
      : 0;

    return {
      totalGoals: goals.length,
      completedGoals,
      activeGoals,
      overdueGoals,
      totalTargetAmount,
      totalCurrentAmount,
      totalRemaining: totalTargetAmount - totalCurrentAmount,
      averageProgress: Math.round(averageProgress * 100) / 100,
      overallProgress: totalTargetAmount > 0 ? (totalCurrentAmount / totalTargetAmount) * 100 : 0
    };
  }

  /**
   * Get goal progress over time
   */
  static async getGoalProgressHistory(goalId: string, userId: string) {
    const goal = await prisma.savingsGoal.findFirst({
      where: { id: goalId, userId }
    });

    if (!goal) {
      throw new Error('Goal not found');
    }

    const daysSinceStart = Math.ceil((new Date().getTime() - goal.createdAt.getTime()) / (1000 * 60 * 60 * 24));
    const totalDays = Math.ceil((goal.targetDate.getTime() - goal.createdAt.getTime()) / (1000 * 60 * 60 * 24));
    
    return {
      goalId,
      currentAmount: goal.currentAmount,
      targetAmount: goal.targetAmount,
      progressPercentage: (goal.currentAmount / goal.targetAmount) * 100,
      daysSinceStart,
      totalDays,
      expectedProgress: totalDays > 0 ? (daysSinceStart / totalDays) * 100 : 0,
      isOnTrack: goal.currentAmount >= (daysSinceStart / totalDays) * goal.targetAmount
    };
  }

  /**
   * Auto-update goals based on income transactions
   */
  static async autoUpdateGoalsFromIncome(userId: string) {
    // Get recent income transactions
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const incomeTransactions = await prisma.transaction.findMany({
      where: {
        userId,
        amount: { lt: 0 }, // Income is negative in our system
        date: { gte: thirtyDaysAgo },
        primaryCategory: 'Income'
      },
      select: { amount: true }
    });

    const totalIncome = incomeTransactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);
    
    // Get active goals that have auto-contribution enabled
    const activeGoals = await prisma.savingsGoal.findMany({
      where: {
        userId,
        isActive: true,
        isCompleted: false
      }
    });

    return {
      totalIncome,
      activeGoals: activeGoals.length,
      potentialContribution: totalIncome * 0.1 // Suggest 10% of income
    };
  }
}
