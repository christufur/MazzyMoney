import { prisma } from '../lib/prisma';

export class SmartCategorizationService {
  private static merchantPatterns: Map<string, string> = new Map();
  private static keywordPatterns: Map<string, string> = new Map();

  /**
   * Initialize smart categorization with existing transaction patterns
   */
  static async initializePatterns() {
    console.log('Initializing smart categorization patterns...');
    
    // Load merchant patterns from existing transactions
    const merchantData = await prisma.transaction.findMany({
      where: { 
        primaryCategory: { not: null },
        merchantName: { not: null }
      },
      select: { 
        merchantName: true, 
        primaryCategory: true,
        name: true
      }
    });

    // Build merchant patterns
    merchantData.forEach(transaction => {
      if (transaction.merchantName && transaction.primaryCategory) {
        const merchant = transaction.merchantName.toLowerCase().trim();
        this.merchantPatterns.set(merchant, transaction.primaryCategory);
        
        // Also add partial matches for common patterns
        const words = merchant.split(/\s+/);
        words.forEach(word => {
          if (word.length > 3 && transaction.primaryCategory) { // Only meaningful words
            this.keywordPatterns.set(word, transaction.primaryCategory);
          }
        });
      }
    });

    // Add common merchant patterns
    this.addCommonPatterns();
    
    console.log(`Loaded ${this.merchantPatterns.size} merchant patterns and ${this.keywordPatterns.size} keyword patterns`);
  }

  /**
   * Add common merchant patterns for better categorization
   */
  private static addCommonPatterns() {
    const commonPatterns = {
      // Food & Dining
      'mcdonalds': 'Food & Dining',
      'starbucks': 'Food & Dining',
      'subway': 'Food & Dining',
      'pizza': 'Food & Dining',
      'restaurant': 'Food & Dining',
      'cafe': 'Food & Dining',
      'coffee': 'Food & Dining',
      'dining': 'Food & Dining',
      'food': 'Food & Dining',
      'grocery': 'Food & Dining',
      'supermarket': 'Food & Dining',
      'walmart': 'Shopping',
      'target': 'Shopping',
      'amazon': 'Shopping',
      
      // Transportation
      'uber': 'Transportation',
      'lyft': 'Transportation',
      'gas': 'Transportation',
      'shell': 'Transportation',
      'exxon': 'Transportation',
      'chevron': 'Transportation',
      'parking': 'Transportation',
      'toll': 'Transportation',
      'metro': 'Transportation',
      'bus': 'Transportation',
      'taxi': 'Transportation',
      
      // Entertainment
      'netflix': 'Entertainment',
      'spotify': 'Entertainment',
      'hulu': 'Entertainment',
      'disney': 'Entertainment',
      'movie': 'Entertainment',
      'theater': 'Entertainment',
      'cinema': 'Entertainment',
      'gym': 'Entertainment',
      'fitness': 'Entertainment',
      
      // Bills & Utilities
      'electric': 'Bills & Utilities',
      'gas company': 'Bills & Utilities',
      'water': 'Bills & Utilities',
      'internet': 'Bills & Utilities',
      'cable': 'Bills & Utilities',
      'phone': 'Bills & Utilities',
      'verizon': 'Bills & Utilities',
      'att': 'Bills & Utilities',
      'tmobile': 'Bills & Utilities',
      'comcast': 'Bills & Utilities',
      
      // Healthcare
      'pharmacy': 'Healthcare',
      'cvs': 'Healthcare',
      'walgreens': 'Healthcare',
      'doctor': 'Healthcare',
      'hospital': 'Healthcare',
      'medical': 'Healthcare',
      'dental': 'Healthcare',
      'vision': 'Healthcare',
      
      // Financial
      'bank': 'Financial',
      'credit': 'Financial',
      'loan': 'Financial',
      'investment': 'Financial',
      'insurance': 'Financial',
      'atm': 'Financial',
      'fee': 'Financial',
      
      // Travel
      'hotel': 'Travel',
      'airline': 'Travel',
      'airport': 'Travel',
      'flight': 'Travel',
      'booking': 'Travel',
      'expedia': 'Travel',
      'airbnb': 'Travel'
    };

    Object.entries(commonPatterns).forEach(([pattern, category]) => {
      this.keywordPatterns.set(pattern, category);
    });
  }

  /**
   * Categorize a transaction using smart patterns
   */
  static async categorizeTransaction(
    transactionName: string, 
    merchantName?: string, 
    plaidCategories?: string[]
  ): Promise<{ category: string; confidence: number; method: string }> {
    
    const searchText = `${transactionName} ${merchantName || ''}`.toLowerCase();
    
    // Method 1: Exact merchant match (highest confidence)
    if (merchantName) {
      const exactMatch = this.merchantPatterns.get(merchantName.toLowerCase().trim());
      if (exactMatch) {
        return { category: exactMatch, confidence: 0.95, method: 'exact_merchant' };
      }
    }

    // Method 2: Keyword pattern matching
    let bestMatch = { category: 'Other', confidence: 0, method: 'keyword' };
    
    for (const [pattern, category] of this.keywordPatterns) {
      if (searchText.includes(pattern)) {
        const confidence = this.calculateConfidence(pattern, searchText);
        if (confidence > bestMatch.confidence) {
          bestMatch = { category, confidence, method: 'keyword' };
        }
      }
    }

    // Method 3: Plaid category fallback
    if (bestMatch.confidence < 0.7 && plaidCategories && plaidCategories.length > 0) {
      const plaidCategory = this.mapPlaidCategory(plaidCategories);
      return { category: plaidCategory, confidence: 0.6, method: 'plaid_fallback' };
    }

    // Method 4: Amount-based heuristics
    if (bestMatch.confidence < 0.5) {
      const amountBased = this.getAmountBasedCategory(transactionName, searchText);
      if (amountBased) {
        return { category: amountBased, confidence: 0.4, method: 'amount_heuristic' };
      }
    }

    return bestMatch;
  }

  /**
   * Calculate confidence score based on pattern match quality
   */
  private static calculateConfidence(pattern: string, searchText: string): number {
    const patternLength = pattern.length;
    const textLength = searchText.length;
    
    // Longer patterns get higher confidence
    let confidence = Math.min(patternLength / 10, 0.9);
    
    // Exact word matches get bonus
    const words = searchText.split(/\s+/);
    const exactWordMatch = words.some(word => word === pattern);
    if (exactWordMatch) {
      confidence += 0.2;
    }
    
    // Multiple occurrences increase confidence
    const occurrences = (searchText.match(new RegExp(pattern, 'g')) || []).length;
    confidence += Math.min(occurrences * 0.1, 0.3);
    
    return Math.min(confidence, 1.0);
  }

  /**
   * Map Plaid categories to our display categories
   */
  private static mapPlaidCategory(plaidCategories: string[]): string {
    const [primary, secondary] = plaidCategories;
    
    const plaidMap: Record<string, string> = {
      'Food and Drink': 'Food & Dining',
      'Transportation': 'Transportation',
      'Shops': 'Shopping',
      'Recreation': 'Entertainment',
      'Service': 'Bills & Utilities',
      'Healthcare': 'Healthcare',
      'Travel': 'Travel',
      'Payment': 'Financial',
      'Deposit': 'Income'
    };

    return plaidMap[primary] || 'Other';
  }

  /**
   * Get category based on amount and transaction patterns
   */
  private static getAmountBasedCategory(transactionName: string, searchText: string): string | null {
    // Small amounts might be coffee, snacks
    if (searchText.includes('coffee') || searchText.includes('cafe')) {
      return 'Food & Dining';
    }
    
    // Round amounts might be subscriptions
    if (searchText.includes('subscription') || searchText.includes('monthly')) {
      return 'Bills & Utilities';
    }
    
    // Large amounts might be rent, mortgage
    if (searchText.includes('rent') || searchText.includes('apartment')) {
      return 'Housing';
    }
    
    return null;
  }

  /**
   * Learn from user corrections
   */
  static async learnFromCorrection(
    transactionId: string, 
    originalCategory: string, 
    correctedCategory: string
  ) {
    try {
      const transaction = await prisma.transaction.findUnique({
        where: { id: transactionId },
        select: { merchantName: true, name: true }
      });

      if (transaction && transaction.merchantName) {
        // Add the corrected pattern
        this.merchantPatterns.set(
          transaction.merchantName.toLowerCase().trim(), 
          correctedCategory
        );
        
        // Also learn from transaction name keywords
        const words = transaction.name.toLowerCase().split(/\s+/);
        words.forEach(word => {
          if (word.length > 3) {
            this.keywordPatterns.set(word, correctedCategory);
          }
        });

        console.log(`Learned pattern: ${transaction.merchantName} -> ${correctedCategory}`);
      }
    } catch (error) {
      console.error('Error learning from correction:', error);
    }
  }

  /**
   * Get categorization suggestions for a transaction
   */
  static async getSuggestions(
    transactionName: string, 
    merchantName?: string
  ): Promise<Array<{ category: string; confidence: number; reason: string }>> {
    
    const suggestions: Array<{ category: string; confidence: number; reason: string }> = [];
    const searchText = `${transactionName} ${merchantName || ''}`.toLowerCase();

    // Get all possible matches
    for (const [pattern, category] of this.keywordPatterns) {
      if (searchText.includes(pattern)) {
        const confidence = this.calculateConfidence(pattern, searchText);
        suggestions.push({
          category,
          confidence,
          reason: `Matches pattern: "${pattern}"`
        });
      }
    }

    // Sort by confidence and return top 3
    return suggestions
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 3);
  }
}
