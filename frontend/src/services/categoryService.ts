export class CategoryService {
  
    // Map Plaid categories to cleaner, more specific categories
    private static categoryMapping: Record<string, string> = {
      // Housing & Utilities
      'Rent': 'Housing',
      'Mortgage': 'Mortgage', 
      'Home Improvement': 'Home Improvement',
      'Utilities': 'Bills & Utilities',
      'Internet': 'Bills & Utilities',
      'Phone': 'Bills & Utilities',
      'Cable': 'Bills & Utilities',
      'Electric': 'Bills & Utilities',
      'Gas': 'Bills & Utilities',
      'Water': 'Bills & Utilities',
      'Trash': 'Bills & Utilities',
      'Security': 'Bills & Utilities',
      
      // Food & Dining
      'Food and Drink': 'Food & Dining',
      'Restaurants': 'Food & Dining',
      'Fast Food': 'Food & Dining',
      'Coffee': 'Food & Dining',
      'Bars': 'Food & Dining',
      'Groceries': 'Food & Dining',
      
      // Transportation
      'Transportation': 'Transportation',
      'Gas Stations': 'Transportation',
      'Parking': 'Transportation',
      'Public Transportation': 'Transportation',
      'Ride Share': 'Transportation',
      'Auto Payment': 'Transportation',
      
      // Financial & Loans
      'Credit Card Payment': 'Financial',
      'Loan Payment': 'Loan Repayment',
      'Student Loan': 'Loan Repayment',
      'Personal Loan': 'Loan Repayment',
      'Bank Fees': 'Financial',
      'Interest': 'Financial',
      
      // Insurance
      'Insurance': 'Insurance',
      'Life Insurance': 'Insurance',
      'Health Insurance': 'Insurance',
      'Home Insurance': 'Insurance',
      'Auto Insurance': 'Insurance',
      
      // Shopping & Entertainment
      'Shops': 'Shopping',
      'Online Shopping': 'Shopping',
      'Clothing': 'Shopping',
      'Entertainment': 'Entertainment',
      'Movies': 'Entertainment',
      'Music': 'Entertainment',
      'Gaming': 'Entertainment',
      
      // Healthcare
      'Healthcare': 'Healthcare',
      'Pharmacy': 'Healthcare',
      'Doctor': 'Healthcare',
      'Dental': 'Healthcare',
      'Medical': 'Healthcare',
      
      // Travel
      'Travel': 'Travel & Lifestyle',
      'Hotels': 'Travel & Lifestyle',
      'Airlines': 'Travel & Lifestyle',
      'Vacation': 'Travel & Lifestyle',
      
      // Personal Care
      'Personal Care': 'Personal Care',
      'Hair': 'Personal Care',
      'Gym': 'Personal Care',
      'Beauty': 'Personal Care',
      
      // Cash & ATM
      'ATM': 'Cash & ATM',
      'Cash Withdrawal': 'Cash & ATM',
      'Check': 'Cash & ATM',
      
      // Miscellaneous
      'Other': 'Other',
      'Miscellaneous': 'Other',
      'General': 'Other'
    };
  
    // Merchant-based categorization for better accuracy
    private static merchantPatterns: Array<{pattern: RegExp, category: string}> = [
      // Housing & Mortgage
      { pattern: /mortgage|home loan|wells fargo home|chase mortgage/i, category: 'Mortgage' },
      { pattern: /rent|apartment|property/i, category: 'Housing' },
      { pattern: /home depot|lowes|hardware|renovation/i, category: 'Home Improvement' },
      
      // Utilities
      { pattern: /electric|power|energy|pge|con edison/i, category: 'Bills & Utilities' },
      { pattern: /gas company|natural gas|nicor/i, category: 'Bills & Utilities' },
      { pattern: /water|sewer|waste management/i, category: 'Bills & Utilities' },
      { pattern: /internet|wifi|comcast|verizon|att|spectrum/i, category: 'Bills & Utilities' },
      { pattern: /phone|mobile|cell|tmobile|sprint/i, category: 'Bills & Utilities' },
      
      // Food & Dining  
      { pattern: /starbucks|coffee|dunkin/i, category: 'Food & Dining' },
      { pattern: /mcdonalds|burger|pizza|taco|subway|chipotle/i, category: 'Food & Dining' },
      { pattern: /restaurant|dining|food|cafe/i, category: 'Food & Dining' },
      { pattern: /grocery|supermarket|whole foods|trader joe|safeway|kroger/i, category: 'Food & Dining' },
      { pattern: /bar|pub|brewery|wine/i, category: 'Food & Dining' },
      
      // Transportation
      { pattern: /gas station|shell|exxon|chevron|bp|mobil/i, category: 'Transportation' },
      { pattern: /uber|lyft|taxi|rideshare/i, category: 'Transportation' },
      { pattern: /parking|meter|garage/i, category: 'Transportation' },
      { pattern: /auto|car payment|vehicle/i, category: 'Transportation' },
      
      // Shopping
      { pattern: /amazon|ebay|walmart|target|costco|shopping/i, category: 'Shopping' },
      { pattern: /clothing|apparel|fashion|nike|adidas/i, category: 'Shopping' },
      
      // Entertainment
      { pattern: /netflix|spotify|hulu|disney|entertainment/i, category: 'Entertainment' },
      { pattern: /movie|theater|cinema/i, category: 'Entertainment' },
      { pattern: /gym|fitness|yoga|sports/i, category: 'Personal Care' },
      
      // Financial
      { pattern: /loan|credit card|bank fee|interest/i, category: 'Financial' },
      { pattern: /insurance/i, category: 'Insurance' },
      
      // Cash & ATM
      { pattern: /atm|cash|withdrawal/i, category: 'Cash & ATM' }
    ];
  
    /**
     * Enhanced categorization using Plaid categories + merchant names
     */
    static categorizeTransaction(
      plaidCategory: string | null,
      merchantName: string,
      transactionName: string
    ): string {
      const searchText = `${merchantName || ''} ${transactionName || ''}`.toLowerCase();
      
      // First, try merchant-based pattern matching (more accurate)
      for (const { pattern, category } of this.merchantPatterns) {
        if (pattern.test(searchText)) {
          return category;
        }
      }
      
      // Then try Plaid category mapping
      if (plaidCategory && this.categoryMapping[plaidCategory]) {
        return this.categoryMapping[plaidCategory];
      }
      
      // Special cases for common transaction patterns
      if (/^(deposit|payroll|salary|direct dep)/i.test(transactionName)) {
        return 'Income'; // This should be handled as income, not expense
      }
      
      if (/^(transfer|payment to|check)/i.test(transactionName)) {
        return 'Financial';
      }
      
      // Default fallback
      return plaidCategory || 'Other';
    }
  
    /**
     * Get category color for consistent visualization
     */
    static getCategoryColor(category: string): string {
      const colorMap: Record<string, string> = {
        'Mortgage': '#f59e0b', // Yellow/Orange
        'Housing': '#f97316', // Orange  
        'Home Improvement': '#eab308', // Yellow
        'Bills & Utilities': '#6366f1', // Indigo
        'Food & Dining': '#ef4444', // Red
        'Transportation': '#8b5cf6', // Purple
        'Financial': '#ec4899', // Pink
        'Loan Repayment': '#ec4899', // Pink
        'Insurance': '#ec4899', // Pink
        'Shopping': '#06b6d4', // Cyan
        'Entertainment': '#10b981', // Green
        'Healthcare': '#f97316', // Orange
        'Travel & Lifestyle': '#8b5cf6', // Purple
        'Personal Care': '#06b6d4', // Cyan
        'Cash & ATM': '#6b7280', // Gray
        'Savings': '#10b981', // Green
        'Other': '#9ca3af' // Light Gray
      };
      
      return colorMap[category] || '#9ca3af';
    }
  
    /**
     * Get category icon for display
     */
    static getCategoryIcon(category: string): string {
      const iconMap: Record<string, string> = {
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
        'Savings': '💰',
        'Other': '📋'
      };
      
      return iconMap[category] || '📋';
    }
  
    /**
     * Process transaction and return enhanced categorization
     */
    static processTransaction(transaction: any) {
      const enhancedCategory = this.categorizeTransaction(
        transaction.primaryCategory,
        transaction.merchantName || '',
        transaction.name || ''
      );
  
      return {
        ...transaction,
        enhancedCategory,
        categoryColor: this.getCategoryColor(enhancedCategory),
        categoryIcon: this.getCategoryIcon(enhancedCategory)
      };
    }
  }