import { reflectOnMonth, type ReflectionInput } from './reflection';

const base: ReflectionInput = {
  isCurrentMonth: true, monthLabel: 'November', nextMonthLabel: 'December',
  income: 4820, spent: 3104, lastMonthSaved: 1316, overLines: [], hasBudgets: true,
};

describe('reflectOnMonth', () => {
  it('states savings and the change against last month, then the plan', () => {
    expect(reflectOnMonth(base)).toBe(
      'You have saved $1,716 so far this month, $400 more than at this point last month. Every budget line is on plan.'
    );
  });

  it('names the largest overspend and its rollover, calmly', () => {
    const text = reflectOnMonth({
      ...base,
      lastMonthSaved: null,
      overLines: [
        { category: 'Shopping', over: 28, rollover: true },
        { category: 'Food & Dining', over: 12, rollover: false },
      ],
    });
    expect(text).toBe('You have saved $1,716 so far this month. Shopping is $28 over and rolls into December. Food & Dining is over too.');
  });

  it('reports spending ahead of income without blame', () => {
    expect(reflectOnMonth({ ...base, income: 1000, spent: 1500, overLines: [], hasBudgets: false })).toBe(
      'Spending is $500 ahead of income so far this month.'
    );
  });

  it('uses past tense for a finished month', () => {
    expect(
      reflectOnMonth({ ...base, isCurrentMonth: false, monthLabel: 'October', lastMonthSaved: null, overLines: [{ category: 'Travel', over: 90, rollover: false }] })
    ).toBe('You saved $1,716 in October. Travel went $90 over.');
  });

  it('measures the month against its savings target', () => {
    const plain = { ...base, lastMonthSaved: null, hasBudgets: false };
    expect(reflectOnMonth({ ...plain, income: 3000, spent: 2000, savingsTarget: 800 })).toContain('That meets your $800 target.');
    expect(reflectOnMonth({ ...plain, income: 3000, spent: 2700, savingsTarget: 800 })).toContain('$500 to go to your $800 target.');
    expect(reflectOnMonth({ ...plain, isCurrentMonth: false, income: 3000, spent: 2700, savingsTarget: 800 })).toContain('The target was $800.');
    expect(reflectOnMonth({ ...plain, income: 3000, spent: 2700, savingsTarget: null })).not.toContain('target');
  });

  it('handles an empty month', () => {
    expect(reflectOnMonth({ ...base, income: 0, spent: 0 })).toBe('Nothing recorded for this month yet.');
  });
});
