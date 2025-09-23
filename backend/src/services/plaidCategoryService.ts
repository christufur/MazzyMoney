import { prisma } from '../lib/prisma';
export class PlaidCategoryService {
  
    /**
     * Map Plaid's detailed categories to clean display names
     * This preserves Plaid's accuracy while giving you clean names for display
     */
    static getDisplayCategory(plaidCategories: string[]): string {
      if (!plaidCategories || plaidCategories.length === 0) {
        return 'Other';
      }
  
      const [primary, secondary, tertiary] = plaidCategories;
  
      // Map Plaid's primary categories to your display categories
      const categoryMap: Record<string, string> = {
        // Income (negative amounts in Plaid)
        'Deposit': 'Income',
        'Payroll': 'Income',
        
        // Housing & Real Estate
        'Payment': secondary === 'Rent' ? 'Housing' : 
                   secondary === 'Mortgage' ? 'Mortgage' :
                   secondary === 'Credit Card' ? 'Financial' : 'Financial',
        
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
        
        // Bills & Utilities
        'Service': secondary === 'Utilities' ? 'Bills & Utilities' :
                   secondary === 'Telecommunication Services' ? 'Bills & Utilities' :
                   secondary === 'Cable' ? 'Bills & Utilities' :
                   secondary === 'Internet' ? 'Bills & Utilities' :
                   secondary === 'Utilities' ? 'Bills & Utilities' : 'Other',
        
        // Healthcare
        'Healthcare': 'Healthcare',
        'Medical': 'Healthcare',
        
        // Financial Services
        'Bank Fees': 'Financial',
        'Interest': 'Financial',
        'Tax': 'Financial',
        
        // Transfer (often internal movements)
        'Transfer': secondary === 'Payroll' ? 'Income' :
                    secondary === 'Deposit' ? 'Income' :
                    secondary === 'Third Party' ? 'Financial' : 'Financial',
        
        // Insurance
        'Insurance': 'Insurance',
        
        // Travel
        'Travel': 'Travel & Lifestyle',
        
        // Personal Care
        'Personal Care': 'Personal Care',
        
        // Government
        'Government and Non-Profit': 'Government & Taxes'
      };
  
      // First try the mapping
      if (categoryMap[primary]) {
        return categoryMap[primary];
      }
  
      // For unmapped categories, use secondary if it's more descriptive
      if (secondary && secondary !== primary) {
        // Clean up secondary category names
        const secondaryMap: Record<string, string> = {
          'Gas Stations': 'Transportation',
          'Parking': 'Transportation',
          'Public Transportation': 'Transportation',
          'Ride Share': 'Transportation',
          'Taxis': 'Transportation',
          
          'Groceries': 'Food & Dining',
          'Restaurants': 'Food & Dining',
          'Fast Food': 'Food & Dining',
          'Coffee': 'Food & Dining',
          'Bars': 'Food & Dining',
          
          'Utilities': 'Bills & Utilities',
          'Telecommunication Services': 'Bills & Utilities',
          'Cable': 'Bills & Utilities',
          'Internet': 'Bills & Utilities',
          'Mobile Phone': 'Bills & Utilities',
          
          'Rent': 'Housing',
          'Mortgage': 'Mortgage',
          'Home Improvement': 'Home Improvement',
          
          'Credit Card': 'Financial',
          'Student Loan': 'Loan Repayment',
          'Personal Loan': 'Loan Repayment',
          'Auto Loan': 'Loan Repayment',
          
          'Life Insurance': 'Insurance',
          'Auto Insurance': 'Insurance',
          'Health Insurance': 'Insurance',
          'Home Insurance': 'Insurance',
          
          'Clothing and Accessories': 'Shopping',
          'Electronics': 'Shopping',
          'General Merchandise': 'Shopping',
          'Online Marketplaces': 'Shopping',
          
          'Gym and Fitness': 'Personal Care',
          'Hair and Beauty': 'Personal Care',
          
          'Movies and DVDs': 'Entertainment',
          'Music and Audio': 'Entertainment',
          'TV and Movies': 'Entertainment',
          'Video Games': 'Entertainment',
          
          'Hotels': 'Travel & Lifestyle',
          'Airlines and Aviation Services': 'Travel & Lifestyle',
          
          'Pharmacy': 'Healthcare',
          'Dentist': 'Healthcare',
          'Doctor': 'Healthcare',
          'Hospital': 'Healthcare',
          
          'ATM': 'Cash & ATM',
          'Check': 'Cash & ATM'
        };
  
        if (secondaryMap[secondary]) {
          return secondaryMap[secondary];
        }
      }
  
      // Fallback to cleaned primary category
      return primary || 'Other';
    }
  
    /**
     * Get category color for visualization
     */
    static getCategoryColor(category: string): string {
      const colorMap: Record<string, string> = {
        'Income': '#10b981', // Green
        'Mortgage': '#f59e0b', // Amber
        'Housing': '#f97316', // Orange  
        'Home Improvement': '#eab308', // Yellow
        'Bills & Utilities': '#6366f1', // Indigo
        'Food & Dining': '#ef4444', // Red
        'Transportation': '#8b5cf6', // Violet
        'Financial': '#ec4899', // Pink
        'Loan Repayment': '#ec4899', // Pink
        'Insurance': '#06b6d4', // Cyan
        'Shopping': '#06b6d4', // Cyan
        'Entertainment': '#10b981', // Emerald
        'Healthcare': '#f97316', // Orange
        'Travel & Lifestyle': '#8b5cf6', // Violet
        'Personal Care': '#14b8a6', // Teal
        'Cash & ATM': '#6b7280', // Gray
        'Government & Taxes': '#7c3aed', // Purple
        'Other': '#9ca3af' // Gray
      };
      
      return colorMap[category] || '#9ca3af';
    }
  
    /**
     * Get category icon
     */
    static getCategoryIcon(category: string): string {
      const iconMap: Record<string, string> = {
        'Income': '💰',
        'Mortgage': '🏠',
        'Housing': '🏠', 
        'Home Improvement': '🔨',
        'Bills & Utilities': '⚡',
        'Food & Dining': '🍽️',
        'Transportation': '🚗',
        'Financial': '💳',
        'Loan Repayment': '💳',
        'Insurance': '🛡️',
        'Shopping': '🛍️',
        'Entertainment': '🎬',
        'Healthcare': '⚕️',
        'Travel & Lifestyle': '✈️',
        'Personal Care': '💅',
        'Cash & ATM': '💵',
        'Government & Taxes': '🏛️',
        'Other': '📋'
      };
      
      return iconMap[category] || '📋';
    }
  
    /**
     * Process transaction with Plaid categories
     */
    static processTransaction(transaction: any) {
      const displayCategory = this.getDisplayCategory(transaction.categories || []);
      
      return {
        ...transaction,
        displayCategory,
        categoryColor: this.getCategoryColor(displayCategory),
        categoryIcon: this.getCategoryIcon(displayCategory)
      };
    }
  
    /**
     * Debug: Show all unique Plaid categories in your data
     * Use this to see what categories Plaid is giving you
     */
    static analyzeCategories(transactions: any[]) {
      const categorySet = new Set<string>();
      const categoryDetails: Record<string, number> = {};
  
      transactions.forEach(transaction => {
        if (transaction.categories && transaction.categories.length > 0) {
          const categoryKey = transaction.categories.join(' > ');
          categorySet.add(categoryKey);
          categoryDetails[categoryKey] = (categoryDetails[categoryKey] || 0) + 1;
        }
      });
  
      console.log('=== PLAID CATEGORY ANALYSIS ===');
      Object.entries(categoryDetails)
        .sort(([,a], [,b]) => b - a)
        .forEach(([category, count]) => {
          console.log(`${count}x: ${category}`);
        });
  
      return categoryDetails;
    }
  
  /**
   * Check for user-defined category overrides
   */
  private static async getUserOverride(
    userId: string,
    merchantName: string,
    transactionName: string
  ): Promise<string | null> {
    const rules = await prisma.userCategoryRule.findMany({
      where: { userId },
      orderBy: { priority: 'desc' }
    });

    const searchText = `${merchantName || ''} ${transactionName || ''}`.toLowerCase();

    for (const rule of rules) {
      if (rule.isRegex) {
        try {
          const regex = new RegExp(rule.merchant, 'i');
          if (regex.test(searchText)) {
            return rule.category;
          }
        } catch (err) {
          console.warn(`Invalid regex rule for user ${userId}:`, rule.merchant);
        }
      } else {
        if (rule.merchant && searchText.includes(rule.merchant.toLowerCase())) {
          return rule.category;
        }
      }
    }

    return null;
  }

  /**
   * Main categorization with user overrides first
   */
  static async categorizeTransaction(
    userId: string,
    plaidCategory: string | null,
    merchantName: string,
    transactionName: string
  ): Promise<string> {
    const userOverride = await this.getUserOverride(
      userId,
      merchantName,
      transactionName
    );
    if (userOverride) return userOverride;

    const searchText = `${merchantName || ''} ${transactionName || ''}`.toLowerCase();
    const patterns: Array<{ pattern: RegExp; category: string }> = [
      { pattern: /mortgage|home loan|wells fargo home|chase mortgage/i, category: 'Mortgage' },
      { pattern: /rent|apartment|property/i, category: 'Housing' },
      { pattern: /home depot|lowes|hardware|renovation/i, category: 'Home Improvement' },
      { pattern: /electric|power|energy|pge|con edison/i, category: 'Bills & Utilities' },
      { pattern: /internet|wifi|comcast|verizon|att|spectrum/i, category: 'Bills & Utilities' },
      { pattern: /phone|mobile|cell|tmobile|sprint/i, category: 'Bills & Utilities' },
      { pattern: /starbucks|coffee|dunkin/i, category: 'Food & Dining' },
      { pattern: /mcdonalds|burger|pizza|taco|subway|chipotle/i, category: 'Food & Dining' },
      { pattern: /grocery|supermarket|whole foods|trader joe|safeway|kroger/i, category: 'Food & Dining' },
      { pattern: /bar|pub|brewery|wine/i, category: 'Food & Dining' },
      { pattern: /gas station|shell|exxon|chevron|bp|mobil/i, category: 'Transportation' },
      { pattern: /uber|lyft|taxi|rideshare/i, category: 'Transportation' },
      { pattern: /parking|meter|garage/i, category: 'Transportation' },
      { pattern: /amazon|ebay|walmart|target|costco|shopping/i, category: 'Shopping' },
      { pattern: /clothing|apparel|fashion/i, category: 'Shopping' },
      { pattern: /netflix|spotify|hulu|disney/i, category: 'Entertainment' },
      { pattern: /movie|theater|cinema/i, category: 'Entertainment' },
      { pattern: /loan|credit card|bank fee|interest/i, category: 'Financial' },
      { pattern: /insurance/i, category: 'Insurance' },
      { pattern: /atm|cash|withdrawal/i, category: 'Cash & ATM' }
    ];

    for (const { pattern, category } of patterns) {
      if (pattern.test(searchText)) return category;
    }

    if (plaidCategory) {
      const mapped = this.getDisplayCategory([plaidCategory]);
      if (mapped) return mapped;
    }

    if (/^(deposit|payroll|salary|direct dep)/i.test(transactionName || '')) {
      return 'Income';
    }

    if (/transfer|payment to|check/i.test(transactionName || '')) {
      return 'Financial';
    }

    return plaidCategory || 'Other';
  }
}