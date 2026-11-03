export const CATEGORIES = [
  'Income',
  'Housing',
  'Bills & Utilities',
  'Food & Dining',
  'Groceries',
  'Transportation',
  'Shopping',
  'Entertainment',
  'Healthcare',
  'Personal Care',
  'Travel',
  'Education',
  'Insurance',
  'Loan Payments',
  'Fees & Charges',
  'Taxes',
  'Gifts & Donations',
  'Pets',
  'Childcare',
  'Cash & ATM',
  'Transfer',
  'Other'
] as const;

export type Category = typeof CATEGORIES[number];

/** Every Plaid `personal_finance_category.primary` value (16 of them). */
export const PFC_PRIMARY_MAP: Record<string, Category> = {
  INCOME: 'Income',
  TRANSFER_IN: 'Transfer',
  TRANSFER_OUT: 'Transfer',
  LOAN_PAYMENTS: 'Loan Payments',
  BANK_FEES: 'Fees & Charges',
  ENTERTAINMENT: 'Entertainment',
  FOOD_AND_DRINK: 'Food & Dining',
  GENERAL_MERCHANDISE: 'Shopping',
  HOME_IMPROVEMENT: 'Housing',
  MEDICAL: 'Healthcare',
  PERSONAL_CARE: 'Personal Care',
  GENERAL_SERVICES: 'Other',
  GOVERNMENT_AND_NON_PROFIT: 'Other',
  TRANSPORTATION: 'Transportation',
  TRAVEL: 'Travel',
  RENT_AND_UTILITIES: 'Bills & Utilities'
};

/** Detailed values that need a different category than their primary. */
export const PFC_DETAILED_MAP: Partial<Record<string, Category>> = {
  FOOD_AND_DRINK_GROCERIES: 'Groceries',
  RENT_AND_UTILITIES_RENT: 'Housing',
  GENERAL_SERVICES_INSURANCE: 'Insurance',
  GENERAL_SERVICES_EDUCATION: 'Education',
  GENERAL_SERVICES_CHILDCARE: 'Childcare',
  GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT: 'Taxes',
  GOVERNMENT_AND_NON_PROFIT_DONATIONS: 'Gifts & Donations',
  GENERAL_MERCHANDISE_PET_SUPPLIES: 'Pets',
  TRANSFER_OUT_WITHDRAWAL: 'Cash & ATM',
  LOAN_PAYMENTS_MORTGAGE_PAYMENT: 'Housing'
};
