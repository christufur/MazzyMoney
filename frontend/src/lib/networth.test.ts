import { historyChange, realHistory } from './networth';

const p = (date: string, netWorth: number) => ({ date, assets: Math.max(netWorth, 0), liabilities: 0, netWorth });

describe('net worth history', () => {
  it('drops leading $0 days and measures change from the first real day', () => {
    const points = realHistory([p('2026-05-07', 0), p('2026-06-01', 0), p('2026-11-01', 10000), p('2026-11-03', 10964.34)]);
    expect(points[0].date).toBe('2026-11-01');
    expect(historyChange(points)).toEqual({ amount: 964.34, percent: 9.6434 });
  });

  it('has no change with a single day of history', () => {
    expect(historyChange(realHistory([p('2026-05-07', 0), p('2026-11-03', 10964.34)]))).toBeNull();
  });

  it('keeps a real zero in the middle of the history', () => {
    expect(realHistory([p('a', 5), p('b', 0), p('c', 7)])).toHaveLength(3);
  });
});
