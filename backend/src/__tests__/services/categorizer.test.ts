import { describe, it, expect } from 'bun:test';
import { categorize, ruleMatches, type RuleLike } from '../../services/categorizer';
import { CATEGORIES, PFC_DETAILED_MAP, PFC_PRIMARY_MAP } from '../../services/categories';

function rule(overrides: Partial<RuleLike> = {}): RuleLike {
  return {
    id: overrides.id ?? 'rule-1',
    priority: overrides.priority ?? 0,
    ...overrides
  };
}

const coffee = {
  name: 'SQ *BLUE BOTTLE',
  merchantName: 'SQ *BLUE BOTTLE',
  amount: 6.5,
  accountId: 'acct-checking',
  pfcPrimary: 'FOOD_AND_DRINK',
  pfcDetailed: 'FOOD_AND_DRINK_COFFEE'
};

describe('categorize: rules', () => {
  it('uses the highest-priority matching rule', () => {
    const result = categorize(coffee, [
      rule({ id: 'low', priority: 1, matchMerchant: 'blue bottle', setCategory: 'Shopping' }),
      rule({ id: 'high', priority: 10, matchMerchant: 'blue bottle', setCategory: 'Food & Dining' })
    ]);

    expect(result.category).toBe('Food & Dining');
    expect(result.source).toBe('RULE');
    expect(result.ruleId).toBe('high');
  });

  it('keeps input order for equal priorities', () => {
    const result = categorize(coffee, [
      rule({ id: 'first', priority: 5, matchMerchant: 'blue bottle', setCategory: 'Groceries' }),
      rule({ id: 'second', priority: 5, matchMerchant: 'blue', setCategory: 'Shopping' })
    ]);

    expect(result.ruleId).toBe('first');
    expect(result.category).toBe('Groceries');
  });

  it('matches a merchant name containing an asterisk without throwing', () => {
    const starred = { ...coffee, merchantName: null, name: 'SQ *BLUE BOTTLE' };

    const result = categorize(starred, [
      rule({ matchMerchant: 'sq *blue', setCategory: 'Groceries' })
    ]);

    expect(result.category).toBe('Groceries');
    expect(result.source).toBe('RULE');
    expect(() => ruleMatches(rule({ matchMerchant: 'sq *blue' }), starred)).not.toThrow();
  });

  it('compares amount bounds against the absolute amount, inclusive', () => {
    const rentLike = {
      name: 'ACH DEBIT',
      merchantName: 'Landlord',
      amount: -1500,
      accountId: 'acct-checking'
    };

    expect(
      categorize(rentLike, [rule({ matchAmountMin: 1500, matchAmountMax: 1500, setCategory: 'Housing' })])
        .category
    ).toBe('Housing');
    expect(
      categorize(rentLike, [rule({ matchAmountMin: 1500.01, setCategory: 'Housing' })]).category
    ).toBe('Other');
    expect(
      categorize(rentLike, [rule({ matchAmountMax: 1499.99, setCategory: 'Housing' })]).category
    ).toBe('Other');
  });

  it('requires every set condition to match', () => {
    const rules = [rule({ matchMerchant: 'blue bottle', matchAccountId: 'acct-credit', setCategory: 'Shopping' })];

    expect(ruleMatches(rules[0], coffee)).toBe(false);
    expect(ruleMatches(rules[0], { ...coffee, accountId: 'acct-credit' })).toBe(true);
  });

  it('never matches a rule with no conditions', () => {
    const result = categorize(coffee, [rule({ setCategory: 'Shopping' })]);

    expect(ruleMatches(rule(), coffee)).toBe(false);
    expect(result.category).toBe('Food & Dining');
    expect(result.source).toBe('PLAID');
    expect(result.ruleId).toBe(null);
  });

  it('keeps the PFC category when a rule only sets a merchant', () => {
    const result = categorize(coffee, [
      rule({ matchMerchant: 'blue bottle', setMerchant: 'Blue Bottle Coffee', setHidden: true })
    ]);

    expect(result.category).toBe('Food & Dining');
    expect(result.source).toBe('PLAID');
    expect(result.merchantDisplay).toBe('Blue Bottle Coffee');
    expect(result.hidden).toBe(true);
  });

  it('defaults hidden to false and merchantDisplay to null without a rule', () => {
    const result = categorize(coffee, []);

    expect(result.hidden).toBe(false);
    expect(result.merchantDisplay).toBe(null);
    expect(result.isTransfer).toBe(false);
  });
});

describe('categorize: Plaid categories', () => {
  it('maps the groceries detailed value to Groceries', () => {
    const result = categorize(
      { ...coffee, pfcPrimary: 'FOOD_AND_DRINK', pfcDetailed: 'FOOD_AND_DRINK_GROCERIES' },
      []
    );

    expect(result.category).toBe('Groceries');
    expect(result.source).toBe('PLAID');
  });

  it('falls back to the primary value when the detailed value is unmapped', () => {
    const result = categorize(
      { ...coffee, pfcPrimary: 'FOOD_AND_DRINK', pfcDetailed: 'FOOD_AND_DRINK_FAST_FOOD' },
      []
    );

    expect(result.category).toBe('Food & Dining');
  });

  it('returns Other for an unknown PFC', () => {
    expect(categorize({ ...coffee, pfcPrimary: null, pfcDetailed: null }, []).category).toBe('Other');

    const unknown = categorize(
      { ...coffee, pfcPrimary: 'SOMETHING_NEW', pfcDetailed: 'SOMETHING_NEW_DETAIL' },
      []
    );
    expect(unknown.category).toBe('Other');
    expect(unknown.source).toBe('PLAID');
  });
});

describe('categorize: transfers', () => {
  it('marks TRANSFER_IN as a transfer in the Transfer category', () => {
    const result = categorize(
      { name: 'Online transfer', amount: -500, accountId: 'acct-savings', pfcPrimary: 'TRANSFER_IN' },
      []
    );

    expect(result.isTransfer).toBe(true);
    expect(result.category).toBe('Transfer');
  });

  it('marks a credit card payment detailed value as a transfer', () => {
    const result = categorize(
      {
        name: 'Card payment',
        amount: 250,
        accountId: 'acct-checking',
        pfcPrimary: 'LOAN_PAYMENTS',
        pfcDetailed: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT'
      },
      []
    );

    expect(result.isTransfer).toBe(true);
    expect(result.category).toBe('Transfer');
  });

  it('treats an ATM withdrawal as Cash & ATM spending, not a transfer', () => {
    const result = categorize(
      {
        name: 'ATM withdrawal',
        amount: 100,
        accountId: 'acct-checking',
        pfcPrimary: 'TRANSFER_OUT',
        pfcDetailed: 'TRANSFER_OUT_WITHDRAWAL'
      },
      []
    );

    expect(result.isTransfer).toBe(false);
    expect(result.category).toBe('Cash & ATM');
  });

  it('lets a rule override transfer detection', () => {
    const transferIn = {
      name: 'Transfer from savings',
      amount: -500,
      accountId: 'acct-checking',
      pfcPrimary: 'TRANSFER_IN'
    };

    const forcedSpending = categorize(transferIn, [rule({ matchMerchant: 'savings', setTransfer: false })]);
    expect(forcedSpending.isTransfer).toBe(false);
    expect(forcedSpending.category).toBe('Transfer');

    const forcedTransfer = categorize(
      { ...coffee, merchantName: 'Venmo' },
      [rule({ matchMerchant: 'venmo', setTransfer: true })]
    );
    expect(forcedTransfer.isTransfer).toBe(true);
    expect(forcedTransfer.category).toBe('Transfer');
  });
});

describe('category maps', () => {
  it('keeps every PFC primary value inside CATEGORIES', () => {
    for (const category of Object.values(PFC_PRIMARY_MAP)) {
      expect(CATEGORIES).toContain(category);
    }
  });

  it('covers all 16 Plaid primary values', () => {
    expect(Object.keys(PFC_PRIMARY_MAP).sort()).toEqual(
      [
        'BANK_FEES',
        'ENTERTAINMENT',
        'FOOD_AND_DRINK',
        'GENERAL_MERCHANDISE',
        'GENERAL_SERVICES',
        'GOVERNMENT_AND_NON_PROFIT',
        'HOME_IMPROVEMENT',
        'INCOME',
        'LOAN_PAYMENTS',
        'MEDICAL',
        'PERSONAL_CARE',
        'RENT_AND_UTILITIES',
        'TRANSFER_IN',
        'TRANSFER_OUT',
        'TRANSPORTATION',
        'TRAVEL'
      ].sort()
    );
  });

  it('keeps every PFC detailed value inside CATEGORIES', () => {
    const mapped = Object.values(PFC_DETAILED_MAP).filter(
      (category): category is NonNullable<typeof category> => category !== undefined
    );

    expect(mapped.length).toBeGreaterThanOrEqual(10);
    for (const category of mapped) {
      expect(CATEGORIES).toContain(category);
    }
  });
});
