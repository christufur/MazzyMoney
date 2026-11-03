import { prisma } from '../lib/prisma';

/**
 * A transaction that counts toward income, expense, and budget totals.
 *
 * Plaid amounts are positive for money out and negative for money in. Transfers
 * between the user's own accounts and credit-card payments are flagged by the
 * sync, and a user can hide a transaction; neither may count as income or an
 * expense anywhere (H6). Spread this into every `where` that feeds a total.
 */
export const COUNTED = { isTransfer: false, hidden: false } as const;

/** Round a money amount to cents at the point it is returned, never on stored values. */
export const cents = (n: number) => Math.round(n * 100) / 100;

export class AnalyticsService {
  /**
   * Get spending trends over time
   */
  static async getSpendingTrends(userId: string, months: number = 12) {
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);

    const transactions = await prisma.transaction.findMany({
      where: {
        userId,
        ...COUNTED,
        date: { gte: startDate },
        amount: { gt: 0 } // Only expenses
      },
      select: {
        amount: true,
        date: true,
        primaryCategory: true,
        merchantName: true
      }
    });

    // Group by month and category
    const monthlyData = new Map<string, Record<string, number>>();
    transactions.forEach(transaction => {
      const month = transaction.date.toISOString().substring(0, 7);
      if (!monthlyData.has(month)) {
        monthlyData.set(month, {});
      }
      const monthData = monthlyData.get(month)!;
      const category = transaction.primaryCategory || 'Other';
      monthData[category] = (monthData[category] || 0) + transaction.amount;
    });

    return Array.from(monthlyData.entries()).map(([month, data]) => ({
      month,
      ...Object.fromEntries(
        Object.entries(data).map(([category, amount]) => [category, cents(amount)])
      )
    }));
  }

  /**
   * Get spending insights and anomalies
   *
   * Compares the current calendar month so far (UTC day 1 up to now) with the
   * same day range of the previous month (UTC day 1 up to the same day of the
   * month, capped at the last day of that month).
   */
  static async getSpendingInsights(userId: string) {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth();
    const day = now.getUTCDate();

    const thisMonthStart = new Date(Date.UTC(year, month, 1));
    const previousMonthStart = new Date(Date.UTC(year, month - 1, 1));
    const lastDayOfPreviousMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    // Exclusive end: the day after the capped day-of-month.
    const previousMonthEnd = new Date(
      Date.UTC(year, month - 1, Math.min(day, lastDayOfPreviousMonth) + 1)
    );

    const [lastMonthData, thisMonthData] = await Promise.all([
      this.getSpendingByCategoryInRange(userId, previousMonthStart, previousMonthEnd),
      this.getSpendingByCategoryInRange(userId, thisMonthStart, now)
    ]);

    const insights = [];
    
    // Compare spending by category
    for (const [category, thisMonthAmount] of Object.entries(thisMonthData)) {
      const lastMonthAmount = lastMonthData[category] || 0;
      const change = cents(thisMonthAmount - lastMonthAmount);
      // Spending with no baseline last month counts as a 100% increase.
      const percentChange =
        lastMonthAmount > 0
          ? Math.round((change / lastMonthAmount) * 10000) / 100
          : thisMonthAmount > 0
            ? 100
            : 0;
      
      if (Math.abs(percentChange) > 20) { // Significant change
        insights.push({
          category,
          change,
          percentChange,
          type: change > 0 ? 'increase' : 'decrease',
          severity: Math.abs(percentChange) > 50 ? 'high' : 'medium'
        });
      }
    }

    return insights;
  }

  /**
   * Get top merchants analysis
   */
  static async getTopMerchants(userId: string, limit: number = 10) {
    const transactions = await prisma.transaction.findMany({
      where: {
        userId,
        ...COUNTED,
        amount: { gt: 0 },
        merchantName: { not: null }
      },
      select: {
        merchantName: true,
        amount: true,
        primaryCategory: true,
        date: true
      }
    });

    const merchantData = new Map();
    transactions.forEach(transaction => {
      const merchant = transaction.merchantName!;
      if (!merchantData.has(merchant)) {
        merchantData.set(merchant, {
          name: merchant,
          totalSpent: 0,
          transactionCount: 0,
          categories: new Set(),
          lastTransaction: transaction.date
        });
      }
      const data = merchantData.get(merchant);
      data.totalSpent += transaction.amount;
      data.transactionCount += 1;
      data.categories.add(transaction.primaryCategory || 'Other');
      if (transaction.date > data.lastTransaction) {
        data.lastTransaction = transaction.date;
      }
    });

    return Array.from(merchantData.values())
      .map(merchant => ({
        ...merchant,
        totalSpent: cents(merchant.totalSpent),
        categories: Array.from(merchant.categories),
        averageSpent: cents(merchant.totalSpent / merchant.transactionCount)
      }))
      .sort((a, b) => b.totalSpent - a.totalSpent)
      .slice(0, limit);
  }

  /**
   * Get spending patterns by day of week
   */
  static async getSpendingByDayOfWeek(userId: string) {
    const transactions = await prisma.transaction.findMany({
      where: {
        userId,
        ...COUNTED,
        amount: { gt: 0 }
      },
      select: {
        amount: true,
        date: true,
        primaryCategory: true
      }
    });

    const dayData = {
      Monday: { total: 0, count: 0 },
      Tuesday: { total: 0, count: 0 },
      Wednesday: { total: 0, count: 0 },
      Thursday: { total: 0, count: 0 },
      Friday: { total: 0, count: 0 },
      Saturday: { total: 0, count: 0 },
      Sunday: { total: 0, count: 0 }
    };

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    transactions.forEach(transaction => {
      const dayName = dayNames[transaction.date.getUTCDay()];
      dayData[dayName as keyof typeof dayData].total += transaction.amount;
      dayData[dayName as keyof typeof dayData].count += 1;
    });

    return Object.entries(dayData).map(([day, data]) => ({
      day,
      totalSpent: cents(data.total),
      transactionCount: data.count,
      averageSpent: data.count > 0 ? cents(data.total / data.count) : 0
    }));
  }

  /**
   * Get monthly spending summary
   */
  static async getMonthlySummary(userId: string, year: number) {
    const startDate = new Date(Date.UTC(year, 0, 1));
    const endDate = new Date(Date.UTC(year + 1, 0, 1));

    const transactions = await prisma.transaction.findMany({
      where: {
        userId,
        ...COUNTED,
        date: { gte: startDate, lt: endDate }
      },
      select: {
        amount: true,
        date: true,
        primaryCategory: true
      }
    });

    const monthlyData = new Map<number, {
      month: number;
      income: number;
      expenses: number;
      categories: Map<string, number>;
    }>();
    for (let month = 0; month < 12; month++) {
      monthlyData.set(month, {
        month: month + 1,
        income: 0,
        expenses: 0,
        categories: new Map<string, number>()
      });
    }

    transactions.forEach(transaction => {
      const month = transaction.date.getUTCMonth();
      const monthData = monthlyData.get(month)!;
      const category = transaction.primaryCategory || 'Other';
      
      if (transaction.amount < 0) {
        monthData.income += Math.abs(transaction.amount);
      } else {
        monthData.expenses += transaction.amount;
        monthData.categories.set(category, (monthData.categories.get(category) || 0) + transaction.amount);
      }
    });

    return Array.from(monthlyData.values()).map(month => {
      const income = cents(month.income);
      const expenses = cents(month.expenses);
      return {
        ...month,
        income,
        expenses,
        netIncome: cents(income - expenses),
        topCategory: Array.from(month.categories.entries())
          .sort(([,a], [,b]) => (b as number) - (a as number))[0]?.[0] || 'Other'
      };
    });
  }

  /**
   * Get spending forecast based on historical data
   */
  static async getSpendingForecast(userId: string) {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const transactions = await prisma.transaction.findMany({
      where: {
        userId,
        ...COUNTED,
        date: { gte: sixMonthsAgo },
        amount: { gt: 0 }
      },
      select: {
        amount: true,
        date: true,
        primaryCategory: true
      }
    });

    // Calculate average monthly spending by category
    const categoryAverages = new Map();
    const monthlyTotals = new Map();

    transactions.forEach(transaction => {
      const month = transaction.date.toISOString().substring(0, 7);
      const category = transaction.primaryCategory || 'Other';
      
      if (!monthlyTotals.has(month)) {
        monthlyTotals.set(month, new Map());
      }
      const monthData = monthlyTotals.get(month);
      monthData.set(category, (monthData.get(category) || 0) + transaction.amount);
    });

    // Calculate averages
    const months = Array.from(monthlyTotals.keys()).length;
    for (const [month, categories] of monthlyTotals) {
      for (const [category, amount] of categories) {
        categoryAverages.set(category, (categoryAverages.get(category) || 0) + amount / months);
      }
    }

    // Generate forecast for next month
    const forecast = Array.from(categoryAverages.entries()).map(([category, average]) => ({
      category,
      predictedAmount: cents(average),
      confidence: Math.min(months / 6, 1) // Confidence based on data availability
    }));

    return {
      forecast: forecast.sort((a, b) => b.predictedAmount - a.predictedAmount),
      totalPredicted: cents(forecast.reduce((sum, item) => sum + item.predictedAmount, 0)),
      dataQuality: Math.min(months / 6, 1)
    };
  }

  private static async getSpendingByCategoryInRange(userId: string, startDate: Date, endDate: Date) {
    const transactions = await prisma.transaction.findMany({
      where: {
        userId,
        ...COUNTED,
        date: { gte: startDate, lt: endDate },
        amount: { gt: 0 }
      },
      select: {
        amount: true,
        primaryCategory: true
      }
    });

    const categorySpending: Record<string, number> = {};
    transactions.forEach(transaction => {
      const category = transaction.primaryCategory || 'Other';
      categorySpending[category] = (categorySpending[category] || 0) + transaction.amount;
    });

    for (const category of Object.keys(categorySpending)) {
      categorySpending[category] = cents(categorySpending[category]);
    }

    return categorySpending;
  }
}
