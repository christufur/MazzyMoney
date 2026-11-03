import type { NetWorthPoint } from '../services/api';

/**
 * Leading points at exactly $0 are days before real balances existed (an empty account's old
 * snapshot). Charting them draws a fake flat history and turns the whole balance into "growth".
 */
export function realHistory(points: NetWorthPoint[]): NetWorthPoint[] {
  const first = points.findIndex((p) => p.netWorth !== 0 || p.assets !== 0 || p.liabilities !== 0);
  return first === -1 ? [] : points.slice(first);
}

/** Change across the real history; null when there is not yet more than one day to compare. */
export function historyChange(points: NetWorthPoint[]): { amount: number; percent: number | null } | null {
  if (points.length < 2) return null;
  const first = points[0].netWorth;
  const amount = Math.round((points[points.length - 1].netWorth - first) * 100) / 100;
  return { amount, percent: first !== 0 ? (amount / Math.abs(first)) * 100 : null };
}
