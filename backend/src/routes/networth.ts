import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authenticateToken } from '../middleware/auth';
import { householdDay } from '../services/notifyService';

/**
 * Net worth history (W4.5).
 *
 * Sign rule: balances are stored as POSITIVE numbers. For a credit card or a loan
 * (`isLiability = true`) that number is what is owed, so it counts NEGATIVE here.
 * Assets count positive.
 *
 * Everything is computed in memory from one snapshot query for the user's active
 * accounts. Each day carries the last known snapshot forward, and an account with
 * no snapshot yet on a day is simply left out of that day.
 */
const netWorthRouter = Router();

netWorthRouter.use(authenticateToken);

/** Day windows for the fixed ranges. `all` starts at the earliest snapshot instead. */
const RANGE_DAYS = {
  '1m': 30,
  '3m': 90,
  '6m': 180,
  '1y': 365,
} as const;

type FixedRange = keyof typeof RANGE_DAYS;
type NetWorthRange = FixedRange | 'all';

const DEFAULT_RANGE: NetWorthRange = '6m';

/** Longer ranges are sampled once a week so the payload stays small. */
const WEEKLY_AFTER_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;

interface NetWorthPoint {
  date: string;
  assets: number;
  liabilities: number;
  netWorth: number;
}

interface AccountForNetWorth {
  id: string;
  name: string;
  type: string;
  isManual: boolean;
  isLiability: boolean;
  currentBalance: number;
}

interface SnapshotRow {
  accountId: string;
  date: Date;
  balance: number;
}

interface SnapshotSeries {
  account: AccountForNetWorth;
  rows: Array<{ date: string; balance: number }>;
  /** Index of the last row that is on or before the day being computed. */
  index: number;
}

/**
 * GET /api/networth?range=1m|3m|6m|1y|all (default 6m)
 * Returns the current totals, the change over the range, the daily (or weekly)
 * history, and the account list with each balance.
 */
netWorthRouter.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const range = resolveRange(req.query.range);
    // The household's day, not UTC's: at 23:30 in Denver it is still today, and a
    // snapshot written tonight must show up as today rather than as tomorrow's.
    const today = householdDay();

    const accounts = await prisma.account.findMany({
      where: { userId, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        type: true,
        isManual: true,
        isLiability: true,
        currentBalance: true,
      },
    });

    const current = currentTotals(accounts);

    // One query for every snapshot of these accounts, oldest first.
    const snapshots: SnapshotRow[] =
      accounts.length === 0
        ? []
        : await prisma.balanceSnapshot.findMany({
            where: {
              accountId: { in: accounts.map((account) => account.id) },
              date: { lte: today },
            },
            orderBy: { date: 'asc' },
            select: { accountId: true, date: true, balance: true },
          });

    // History from before the first snapshot is worked back from the transactions.
    // shortcut: reads every settled row for these accounts; fine for a household, add a date floor if it grows past ~100k rows.
    const transactions =
      snapshots.length === 0
        ? []
        : await prisma.transaction.findMany({
            where: {
              accountId: { in: accounts.map((account) => account.id) },
              pending: false,
              date: { lte: today },
            },
            select: { accountId: true, date: true, amount: true },
          });
    const estimated = estimateEarlierBalances(accounts, snapshots, transactions);
    const points = buildPoints(
      accounts,
      [...estimated.rows, ...snapshots].sort((a, b) => a.date.getTime() - b.date.getTime()),
      range,
      today
    );

    res.json({
      current,
      change: buildChange(current.netWorth, points),
      points,
      estimatedBefore: estimated.until,
      accounts: accounts.map((account) => ({
        id: account.id,
        name: account.name,
        type: account.type,
        isManual: account.isManual,
        isLiability: account.isLiability,
        // The stored (positive) balance. The client negates liabilities for display.
        balance: roundCents(account.currentBalance),
      })),
    });
  } catch (error: any) {
    console.error('Error fetching net worth:', error);
    res.status(500).json({ error: 'Failed to fetch net worth' });
  }
});

// --- Calculation ---------------------------------------------------------

function currentTotals(accounts: AccountForNetWorth[]) {
  let assets = 0;
  let liabilities = 0;

  for (const account of accounts) {
    if (account.isLiability) {
      liabilities += Math.abs(account.currentBalance);
    } else {
      assets += account.currentBalance;
    }
  }

  const roundedAssets = roundCents(assets);
  const roundedLiabilities = roundCents(liabilities);

  return {
    assets: roundedAssets,
    liabilities: roundedLiabilities,
    netWorth: roundCents(roundedAssets - roundedLiabilities),
  };
}

/**
 * One point per day (one per week for ranges longer than 6 months, always
 * including today). Empty when the user has no snapshot at all: the chart starts
 * after the first sync.
 */
function buildPoints(
  accounts: AccountForNetWorth[],
  snapshots: SnapshotRow[],
  range: NetWorthRange,
  today: Date
): NetWorthPoint[] {
  if (snapshots.length === 0) {
    return [];
  }

  const start =
    range === 'all'
      ? // snapshots are sorted oldest first, so the first row is the earliest one
        startOfUtcDay(snapshots[0].date)
      : addDays(today, -RANGE_DAYS[range]);

  const firstDay = start.getTime() > today.getTime() ? today : start;
  const spanDays = Math.max(0, Math.round((today.getTime() - firstDay.getTime()) / DAY_MS));
  const stepDays = spanDays > WEEKLY_AFTER_DAYS ? 7 : 1;

  const days: Date[] = [];
  for (let offset = 0; offset <= spanDays; offset += stepDays) {
    days.push(addDays(firstDay, offset));
  }
  // A weekly range may end short of today; the chart should always reach it.
  const lastDay = days[days.length - 1];
  if (!lastDay || formatDateOnly(lastDay) !== formatDateOnly(today)) {
    days.push(today);
  }

  const series = accounts.map<SnapshotSeries>((account) => ({
    account,
    rows: [],
    index: -1,
  }));
  const byAccountId = new Map(series.map((entry) => [entry.account.id, entry]));

  for (const snapshot of snapshots) {
    const entry = byAccountId.get(snapshot.accountId);
    if (!entry) continue;
    entry.rows.push({ date: formatDateOnly(snapshot.date), balance: snapshot.balance });
  }

  return days.map((day) => {
    const dayKey = formatDateOnly(day);
    let assets = 0;
    let liabilities = 0;

    for (const entry of series) {
      // Carry the last known value forward: advance to the newest row on or before this day.
      while (
        entry.index + 1 < entry.rows.length &&
        entry.rows[entry.index + 1].date <= dayKey
      ) {
        entry.index += 1;
      }

      // No snapshot yet on this day: the account is left out of the day.
      if (entry.index < 0) continue;

      const value = entry.rows[entry.index].balance;
      if (entry.account.isLiability) {
        liabilities += Math.abs(value);
      } else {
        assets += value;
      }
    }

    const roundedAssets = roundCents(assets);
    const roundedLiabilities = roundCents(liabilities);

    return {
      date: dayKey,
      assets: roundedAssets,
      liabilities: roundedLiabilities,
      netWorth: roundCents(roundedAssets - roundedLiabilities),
    };
  });
}

/**
 * Balances for the days before each account's first snapshot, worked back from its
 * transactions (Plaid amounts are positive for money out): an asset was higher by what
 * left it since, a liability owed less by what was charged since. One row per day that
 * had a transaction, plus the day before the first one. An account with no transactions
 * keeps its first snapshot back to the earliest estimated day, so adding a manual
 * account does not draw a jump. `until` is the first real snapshot day, or null.
 */
export function estimateEarlierBalances(
  accounts: Array<{ id: string; isLiability: boolean }>,
  snapshots: SnapshotRow[],
  transactions: Array<{ accountId: string; date: Date; amount: number }>
): { rows: SnapshotRow[]; until: string | null } {
  const first = new Map<string, SnapshotRow>();
  for (const snapshot of snapshots) {
    const seen = first.get(snapshot.accountId);
    if (!seen || snapshot.date < seen.date) first.set(snapshot.accountId, snapshot);
  }

  const rows: SnapshotRow[] = [];
  const held: SnapshotRow[] = [];

  for (const account of accounts) {
    const anchor = first.get(account.id);
    if (!anchor) continue;
    const anchorDay = formatDateOnly(anchor.date);

    // Net money out per day, for days up to and including the anchor day.
    const outByDay = new Map<string, number>();
    for (const tx of transactions) {
      if (tx.accountId !== account.id) continue;
      const day = formatDateOnly(tx.date);
      if (day > anchorDay) continue;
      outByDay.set(day, (outByDay.get(day) ?? 0) + tx.amount);
    }

    const days = [...outByDay.keys()].sort().reverse();
    if (days.length === 0) {
      held.push(anchor);
      continue;
    }

    // Walk back from the anchor: the balance at the end of a day excludes what came after it.
    const sign = account.isLiability ? -1 : 1;
    let balance = anchor.balance;
    for (const day of days) {
      if (day < anchorDay) rows.push({ accountId: account.id, date: new Date(`${day}T00:00:00Z`), balance: roundCents(balance) });
      balance += sign * (outByDay.get(day) ?? 0);
    }
    const before = addDays(new Date(`${days[days.length - 1]}T00:00:00Z`), -1);
    rows.push({ accountId: account.id, date: before, balance: roundCents(balance) });
  }

  if (rows.length === 0) return { rows, until: null };

  const start = rows.reduce((min, row) => (row.date < min ? row.date : min), rows[0].date);
  for (const anchor of held) {
    if (anchor.date > start) rows.push({ accountId: anchor.accountId, date: start, balance: anchor.balance });
  }

  const until = [...first.values()].reduce((min, row) => (row.date < min ? row.date : min), [...first.values()][0].date);
  return { rows, until: formatDateOnly(until) };
}

/** Change against the first point of the range. Percent is null when that value is 0. */
function buildChange(currentNetWorth: number, points: NetWorthPoint[]) {
  if (points.length === 0) {
    return { amount: 0, percent: null };
  }

  const first = points[0].netWorth;
  const amount = roundCents(currentNetWorth - first);

  if (first === 0) {
    return { amount, percent: null };
  }

  // Divide by the size of the first value so an improvement is positive even when
  // the net worth started out negative.
  return { amount, percent: roundCents((amount / Math.abs(first)) * 100) };
}

// --- Helpers -------------------------------------------------------------

/** Unknown or repeated values fall back to 6m instead of failing the dashboard. */
function resolveRange(value: unknown): NetWorthRange {
  if (typeof value === 'string' && (value === 'all' || value in RANGE_DAYS)) {
    return value as NetWorthRange;
  }
  return DEFAULT_RANGE;
}

function roundCents(amount: number): number {
  return Math.round(amount * 100) / 100;
}

function startOfUtcDay(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function addDays(day: Date, days: number): Date {
  return new Date(day.getTime() + days * DAY_MS);
}

function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export { netWorthRouter };
