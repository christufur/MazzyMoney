import { prisma } from '../lib/prisma';

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
      ...data
    }));
  }

  /**
   * Get spending insights and anomalies
   */
  static async getSpendingInsights(userId: string) {
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    
    const thisMonth = new Date();
    thisMonth.setMonth(thisMonth.getMonth());

    const [lastMonthData, thisMonthData] = await Promise.all([
      this.getSpendingByCategory(userId, lastMonth),
      this.getSpendingByCategory(userId, thisMonth)
    ]);

    const insights = [];
    
    // Compare spending by category
    for (const [category, thisMonthAmount] of Object.entries(thisMonthData)) {
      const lastMonthAmount = lastMonthData[category] || 0;
      const change = thisMonthAmount - lastMonthAmount;
      const percentChange = lastMonthAmount > 0 ? (change / lastMonthAmount) * 100 : 0;
      
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
        categories: Array.from(merchant.categories),
        averageSpent: merchant.totalSpent / merchant.transactionCount
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
      const dayName = dayNames[transaction.date.getDay()];
      dayData[dayName as keyof typeof dayData].total += transaction.amount;
      dayData[dayName as keyof typeof dayData].count += 1;
    });

    return Object.entries(dayData).map(([day, data]) => ({
      day,
      totalSpent: data.total,
      transactionCount: data.count,
      averageSpent: data.count > 0 ? data.total / data.count : 0
    }));
  }

  /**
   * Get monthly spending summary
   */
  static async getMonthlySummary(userId: string, year: number) {
    const startDate = new Date(year, 0, 1);
    const endDate = new Date(year + 1, 0, 1);

    const transactions = await prisma.transaction.findMany({
      where: {
        userId,
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
      const month = transaction.date.getMonth();
      const monthData = monthlyData.get(month)!;
      const category = transaction.primaryCategory || 'Other';
      
      if (transaction.amount < 0) {
        monthData.income += Math.abs(transaction.amount);
      } else {
        monthData.expenses += transaction.amount;
        monthData.categories.set(category, (monthData.categories.get(category) || 0) + transaction.amount);
      }
    });

    return Array.from(monthlyData.values()).map(month => ({
      ...month,
      netIncome: month.income - month.expenses,
      topCategory: Array.from(month.categories.entries())
        .sort(([,a], [,b]) => (b as number) - (a as number))[0]?.[0] || 'Other'
    }));
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
      predictedAmount: Math.round(average * 100) / 100,
      confidence: Math.min(months / 6, 1) // Confidence based on data availability
    }));

    return {
      forecast: forecast.sort((a, b) => b.predictedAmount - a.predictedAmount),
      totalPredicted: forecast.reduce((sum, item) => sum + item.predictedAmount, 0),
      dataQuality: Math.min(months / 6, 1)
    };
  }

  private static async getSpendingByCategory(userId: string, startDate: Date) {
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + 1);

    const transactions = await prisma.transaction.findMany({
      where: {
        userId,
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

    return categorySpending;
  }
}
