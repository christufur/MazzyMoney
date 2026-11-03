import { prisma } from '../lib/prisma';
import type { RecurringSeries } from '../../prisma/generated/prisma';

/**
 * Recurring charge detection.
 *
 * Our own detection, from the cached transactions only: Plaid's recurring endpoint
 * is never called (cost rule: PROJECT_OVERVIEW.md 6.5). We find series ourselves:
 * same merchant key, at least three charges, a steady gap near a standard interval,
 * and a steady amount.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** How much history the detector looks at. A yearly bill needs more than a year. */
export const LOOKBACK_DAYS = 400;

/**
 * Standard intervals and how far one gap may be from it. The windows never overlap,
 * so at most one interval matches a group.
 */
const INTERVALS: ReadonlyArray<{ intervalDays: number; tolerance: number }> = [
  { intervalDays: 7, tolerance: 1 },
  { intervalDays: 14, tolerance: 2 },
  { intervalDays: 30, tolerance: 4 },
  { intervalDays: 91, tolerance: 7 },
  { intervalDays: 365, tolerance: 15 },
];

/** Share of gaps and amounts that must fit for a group to count as a series. */
const CONSISTENCY_RATIO = 2 / 3;

/** Amounts may differ from the median by this much. */
const AMOUNT_TOLERANCE = 0.15;

export interface RecurringTransactionInput {
  amount: number;
  date: Date;
  name: string;
  merchantName?: string | null;
  merchantDisplay?: string | null;
}

export interface DetectedSeries {
  merchantKey: string;
  displayName: string;
  averageAmount: number;
  intervalDays: number;
  lastDate: Date;
  nextDate: Date;
}

/** The raw merchant text, cleaned of a rule-set name: display name, else bank name, else the description. */
export function merchantLabel(t: RecurringTransactionInput): string {
  return (t.merchantDisplay ?? t.merchantName ?? t.name ?? '').trim();
}

/**
 * Groups the same bill together across the noise a bank adds: case, trailing store
 * numbers ("NETFLIX.COM 8443", "Netflix.com 1234"), and `#`/`*` prefixes ("SQ *BLUE BOTTLE").
 */
export function merchantKey(t: RecurringTransactionInput): string {
  return merchantLabel(t)
    .toLowerCase()
    .replace(/[0-9]/g, ' ')
    .replace(/[#*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/** Whole days since epoch for a UTC calendar date; dates are stored as UTC midnight. */
function utcDayNumber(date: Date): number {
  return Math.round(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / MS_PER_DAY
  );
}

function utcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Next occurrence after `date`. Monthly bills keep the day of the month and are clamped
 * to the shorter month ("Jan 31" -> "Feb 28"); every other interval is a plain day count.
 */
function addIntervalUtc(date: Date, intervalDays: number): Date {
  if (intervalDays === 30) {
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth();
    const day = date.getUTCDate();
    // Day 0 of the month after next is the last day of next month.
    const lastDayOfNextMonth = new Date(Date.UTC(year, month + 2, 0)).getUTCDate();
    return new Date(Date.UTC(year, month + 1, Math.min(day, lastDayOfNextMonth)));
  }

  return new Date(utcMidnight(date).getTime() + intervalDays * MS_PER_DAY);
}

/**
 * Finds the series in a list of expense transactions.
 *
 * Pure: no database and no clock. `transactions` should already be expenses only
 * (amount > 0, not a transfer, not hidden, not pending).
 */
export function detectSeries(transactions: RecurringTransactionInput[], now: Date = new Date()): DetectedSeries[] {
  const groups = new Map<string, RecurringTransactionInput[]>();

  for (const transaction of transactions) {
    const key = merchantKey(transaction);
    // A description made only of digits or punctuation tells us nothing about the merchant.
    if (!key) continue;

    const group = groups.get(key);
    if (group) {
      group.push(transaction);
    } else {
      groups.set(key, [transaction]);
    }
  }

  const detected: DetectedSeries[] = [];

  for (const [key, group] of groups) {
    // Oldest first, so the last row is the most recent charge.
    const sorted = [...group].sort((a, b) => utcDayNumber(a.date) - utcDayNumber(b.date));

    if (sorted.length < 3) continue;

    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      gaps.push(utcDayNumber(sorted[i].date) - utcDayNumber(sorted[i - 1].date));
    }

    const medianGap = median(gaps);
    const match = INTERVALS.find(({ intervalDays, tolerance }) => {
      if (Math.abs(medianGap - intervalDays) > tolerance) return false;

      const withinTolerance = gaps.filter(
        (gap) => Math.abs(gap - intervalDays) <= tolerance
      ).length;
      return withinTolerance / gaps.length >= CONSISTENCY_RATIO;
    });

    if (!match) continue;

    const amounts = sorted.map((transaction) => transaction.amount);
    const medianAmount = median(amounts);
    const steadyAmounts = amounts.filter(
      (amount) => Math.abs(amount - medianAmount) <= Math.abs(medianAmount) * AMOUNT_TOLERANCE + 1e-6
    ).length;

    if (steadyAmounts / amounts.length < CONSISTENCY_RATIO) continue;

    const lastDate = utcMidnight(sorted[sorted.length - 1].date);

    // Two whole cycles with no charge means the subscription was cancelled; it no longer repeats.
    if (utcDayNumber(now) - utcDayNumber(lastDate) > 2 * match.intervalDays + match.tolerance) continue;

    detected.push({
      merchantKey: key,
      displayName: merchantLabel(sorted[sorted.length - 1]),
      averageAmount: roundCents(medianAmount),
      intervalDays: match.intervalDays,
      lastDate,
      nextDate: addIntervalUtc(lastDate, match.intervalDays),
    });
  }

  // Stable order for the page: soonest bill first.
  return detected.sort(
    (a, b) => a.nextDate.getTime() - b.nextDate.getTime() || a.merchantKey.localeCompare(b.merchantKey)
  );
}

/** What a series costs in an average month (30.4375 days), rounded to cents. */
export function monthlyEquivalent(series: {
  averageAmount: number;
  intervalDays: number;
}): number {
  if (!series.intervalDays) return 0;
  return roundCents((series.averageAmount * 30.4375) / series.intervalDays);
}

export class RecurringService {
  /** Detects the user's series again and stores the result. */
  static async refreshForUser(userId: string): Promise<RecurringSeries[]> {
    const since = new Date(Date.now() - LOOKBACK_DAYS * MS_PER_DAY);

    const transactions = await prisma.transaction.findMany({
      where: {
        userId,
        amount: { gt: 0 }, // money out
        isTransfer: false,
        hidden: false,
        pending: false,
        date: { gte: since },
      },
      select: {
        amount: true,
        date: true,
        name: true,
        merchantName: true,
        merchantDisplay: true,
      },
    });

    const detected = detectSeries(transactions);
    const detectedKeys = new Set(detected.map((series) => series.merchantKey));

    const saved: RecurringSeries[] = [];
    for (const series of detected) {
      const savedSeries = await prisma.recurringSeries.upsert({
        where: { userId_merchantKey: { userId, merchantKey: series.merchantKey } },
        // `status` is deliberately absent: a user's IGNORED stays IGNORED.
        update: {
          displayName: series.displayName,
          averageAmount: series.averageAmount,
          intervalDays: series.intervalDays,
          lastDate: series.lastDate,
          nextDate: series.nextDate,
        },
        create: {
          userId,
          merchantKey: series.merchantKey,
          displayName: series.displayName,
          averageAmount: series.averageAmount,
          intervalDays: series.intervalDays,
          lastDate: series.lastDate,
          nextDate: series.nextDate,
        },
      });
      saved.push(savedSeries);
    }

    // A series the detector no longer finds disappears once its next charge is a full cycle overdue.
    const now = Date.now();
    const existing = await prisma.recurringSeries.findMany({
      where: { userId },
      select: { id: true, merchantKey: true, status: true, intervalDays: true, nextDate: true },
    });

    const stale = existing.filter((row) => {
      if (row.status !== 'ACTIVE') return false;
      if (detectedKeys.has(row.merchantKey)) return false;
      return row.nextDate.getTime() < now - row.intervalDays * MS_PER_DAY;
    });

    if (stale.length > 0) {
      await prisma.recurringSeries.deleteMany({
        where: { userId, status: 'ACTIVE', id: { in: stale.map((row) => row.id) } },
      });
    }

    return saved;
  }

  /** Nightly job: every user, one after another. */
  static async refreshAll(): Promise<void> {
    const users = await prisma.user.findMany({ select: { id: true } });

    for (const user of users) {
      try {
        await RecurringService.refreshForUser(user.id);
      } catch (error) {
        console.error(`Recurring refresh failed for user ${user.id}:`, error);
      }
    }
  }
}
