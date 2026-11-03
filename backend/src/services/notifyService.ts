// Push notifications through a self-hosted ntfy server (plan E2).
//
// One topic per user (`User.ntfyTopic`), server address from `NTFY_URL`. Every push is
// written to `NotificationLog` *before* it is sent, and the unique
// (userId, kind, key) row is what makes "once per event" true across sync replays,
// restarted processes and cron runs. Nothing here throws into its caller: a dead ntfy
// server must never fail a bank sync or a budget check.
//
// The household clock lives here too (`APP_TIMEZONE`, default America/Denver). The day
// a push belongs to and the day a balance snapshot belongs to are the same calendar day
// the household actually lives in, which UTC alone cannot answer (on Nov 2 in the
// evening, UTC is already Nov 3).

import { prisma } from '../lib/prisma';
import { COUNTED, cents } from './analyticsService';

export interface NotificationInput {
  kind: string;
  /** Identifies the event, so the same event is never pushed twice. */
  key: string;
  title: string;
  message: string;
  tags?: string | string[];
  /** ntfy priority: 1 min, 3 default, 4 high, 5 urgent. */
  priority?: number;
  /** A path inside the app (`/connections`); `APP_URL` turns it into a link. */
  click?: string;
}

export type NotifyReason =
  | 'not-configured'
  | 'no-topic'
  | 'duplicate'
  | 'send-failed'
  | 'error';

export interface NotifyResult {
  sent: boolean;
  reason?: NotifyReason;
}

const DEFAULT_TIMEZONE = 'America/Denver';
const REQUEST_TIMEOUT_MS = 10_000;

const amountFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
const exactFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});
/** `APP_TIMEZONE`, or the household's default when the server does not set it. */
export function appTimeZone(): string {
  const configured = process.env.APP_TIMEZONE?.trim();
  return configured || DEFAULT_TIMEZONE;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function dayFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/**
 * The household's calendar day as a UTC-midnight `Date`.
 *
 * Transaction dates are UTC midnight and `@db.Date` columns drop the time, so every
 * "today" the app stores or compares is this value. At 23:30 in Denver it is still that
 * day even though UTC has already rolled over to the next one.
 */
export function householdDay(date: Date = new Date()): Date {
  const parts = dayFormatter(appTimeZone()).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);

  return new Date(Date.UTC(value('year'), value('month') - 1, value('day')));
}

/** True when the server has an ntfy address to post to. */
export const isNtfyConfigured = (): boolean => Boolean(process.env.NTFY_URL?.trim());

/** The base URL without a trailing slash, or null when the server is not configured. */
function ntfyBaseUrl(): string | null {
  const url = process.env.NTFY_URL?.trim();
  return url ? url.replace(/\/+$/, '') : null;
}

/** `APP_URL` + a path, or the value untouched when it is already an absolute URL. */
function clickUrl(path: string | undefined): string | null {
  if (!path) {
    return null;
  }
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  const base = process.env.APP_URL?.trim().replace(/\/+$/, '');
  if (!base) {
    return null;
  }

  return `${base}${path.startsWith('/') ? '' : '/'}${path}`;
}

/** ntfy reads these headers and nothing else from the request. */
function headersFor(input: NotificationInput): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'text/plain; charset=utf-8',
    Title: input.title,
  };

  const tags = Array.isArray(input.tags) ? input.tags.join(',') : input.tags;
  if (tags) {
    headers.Tags = tags;
  }
  if (input.priority !== undefined) {
    headers.Priority = String(input.priority);
  }

  const click = clickUrl(input.click);
  if (click) {
    headers.Click = click;
  }

  return headers;
}

// --- Weekly recap helpers ------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

const addDays = (day: Date, days: number) => new Date(day.getTime() + days * DAY_MS);

const monthKey = (date: Date) =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

/** ISO week of a UTC-midnight date, e.g. `2026-W45`. */
export function isoWeekKey(date: Date): string {
  const thursday = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  // Monday = 1 ... Sunday = 7, then step to the Thursday that decides the week's year.
  const dayNumber = thursday.getUTCDay() || 7;
  thursday.setUTCDate(thursday.getUTCDate() + 4 - dayNumber);

  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((thursday.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);

  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** "Shopping" · "Shopping and Dining" · "Shopping, Dining and 2 more". */
function listOf(values: string[]): string {
  if (values.length <= 1) {
    return values[0] ?? '';
  }
  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }
  return `${values.slice(0, 2).join(', ')} and ${values.length - 2} more`;
}

export class NotifyService {
  /**
   * Push one notification to the user's phone. Never throws; `sent` says what happened.
   */
  static async notify(userId: string, input: NotificationInput): Promise<NotifyResult> {
    try {
      const base = ntfyBaseUrl();
      if (!base) {
        return { sent: false, reason: 'not-configured' };
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { ntfyTopic: true },
      });

      const topic = user?.ntfyTopic?.trim();
      if (!topic) {
        return { sent: false, reason: 'no-topic' };
      }

      // Claim the event before sending. A replay, a second cron run or a retried sync
      // then finds the row and stays quiet instead of pushing the same thing twice.
      try {
        await prisma.notificationLog.create({
          data: { userId, kind: input.kind, key: input.key },
        });
      } catch (error: any) {
        if (error?.code === 'P2002') {
          return { sent: false, reason: 'duplicate' };
        }
        throw error;
      }

      const sent = await this.post(base, topic, input);
      return sent ? { sent: true } : { sent: false, reason: 'send-failed' };
    } catch (error) {
      console.error(`Notification "${input.kind}" for user ${userId} failed:`, error);
      return { sent: false, reason: 'error' };
    }
  }

  /**
   * The Settings page's "Send a test": the same path as a real push, without the
   * dedupe row, because a test is allowed to run as often as the user taps it.
   */
  static async sendTest(userId: string): Promise<NotifyResult> {
    try {
      const base = ntfyBaseUrl();
      if (!base) {
        return { sent: false, reason: 'not-configured' };
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { ntfyTopic: true },
      });

      const topic = user?.ntfyTopic?.trim();
      if (!topic) {
        return { sent: false, reason: 'no-topic' };
      }

      const sent = await this.post(base, topic, {
        kind: 'test',
        key: 'test',
        title: 'Mazzy Money',
        message: 'Test push from your Mazzy Money server. If you can read this, notifications are on.',
        tags: ['white_check_mark'],
        priority: 3,
        click: '/settings',
      });

      return sent ? { sent: true } : { sent: false, reason: 'send-failed' };
    } catch (error) {
      console.error(`Test notification for user ${userId} failed:`, error);
      return { sent: false, reason: 'error' };
    }
  }

  /**
   * The Sunday 17:00 recap: what the week cost, what the month has saved so far, what
   * waits for review, and which budgets are over. One push per user per ISO week.
   */
  static async sendWeeklyRecaps(now: Date = new Date()): Promise<number> {
    const day = householdDay(now);
    const weekStart = addDays(day, -6);
    const weekEnd = addDays(day, 1);
    const monthStart = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 1));
    const month = monthKey(day);

    const users = await prisma.user.findMany({
      where: { notifyWeekly: true, ntfyTopic: { not: null } },
      select: { id: true },
    });

    let sent = 0;

    for (const user of users) {
      try {
        const message = await this.buildRecap(user.id, {
          weekStart,
          weekEnd,
          monthStart,
          monthEnd,
          month,
        });

        const result = await this.notify(user.id, {
          kind: 'weekly',
          key: isoWeekKey(day),
          title: 'This week',
          message,
          tags: ['book'],
          priority: 3,
          click: '/overview',
        });

        if (result.sent) {
          sent++;
        }
      } catch (error) {
        // One broken recap must not stop the rest of the household's.
        console.error(`Weekly recap failed for user ${user.id}:`, error);
      }
    }

    return sent;
  }

  private static async buildRecap(
    userId: string,
    range: {
      weekStart: Date;
      weekEnd: Date;
      monthStart: Date;
      monthEnd: Date;
      month: string;
    }
  ): Promise<string> {
    // `budgetSyncService` imports this module's consumer chain, so it is loaded here to
    // keep the import graph one-way.
    const { BudgetSyncService } = await import('./budgetSyncService');

    const [weekSpending, monthIncome, monthExpenses, toReview, budgets] = await Promise.all([
      prisma.transaction.aggregate({
        where: {
          userId,
          ...COUNTED,
          amount: { gt: 0 },
          date: { gte: range.weekStart, lt: range.weekEnd },
        },
        _sum: { amount: true },
      }),
      prisma.transaction.aggregate({
        where: {
          userId,
          ...COUNTED,
          amount: { lt: 0 },
          date: { gte: range.monthStart, lt: range.monthEnd },
        },
        _sum: { amount: true },
      }),
      prisma.transaction.aggregate({
        where: {
          userId,
          ...COUNTED,
          amount: { gt: 0 },
          date: { gte: range.monthStart, lt: range.monthEnd },
        },
        _sum: { amount: true },
      }),
      prisma.transaction.count({ where: { userId, reviewed: false, hidden: false } }),
      prisma.budget.findMany({ where: { userId, isActive: true } }),
    ]);

    const spent = cents(weekSpending._sum.amount ?? 0);
    const saved = cents(Math.abs(monthIncome._sum.amount ?? 0) - (monthExpenses._sum.amount ?? 0));

    const overBudget: string[] = [];
    for (const budget of budgets) {
      const snapshot = await BudgetSyncService.budgetForMonth(budget, range.month);
      if (snapshot.spent > snapshot.available) {
        overBudget.push(budget.category);
      }
    }

    const sentences: string[] = [];

    if (saved >= 0) {
      sentences.push(
        `This week: spent ${amountFormatter.format(spent)}, saved ${amountFormatter.format(saved)} this month so far.`
      );
    } else {
      sentences.push(
        `This week: spent ${amountFormatter.format(spent)}. This month is ${amountFormatter.format(-saved)} over what came in.`
      );
    }

    sentences.push(
      toReview === 0
        ? 'Nothing to review.'
        : `${toReview} to review.`
    );

    sentences.push(
      overBudget.length === 0
        ? 'Every budget is on track.'
        : `Over budget: ${listOf(overBudget)}.`
    );

    return sentences.join(' ');
  }

  private static async post(
    base: string,
    topic: string,
    input: NotificationInput
  ): Promise<boolean> {
    try {
      const response = await fetch(`${base}/${encodeURIComponent(topic)}`, {
        method: 'POST',
        headers: headersFor(input),
        body: input.message,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        console.error(`ntfy answered ${response.status} for topic ${topic}`);
        return false;
      }

      return true;
    } catch (error) {
      console.error(`Could not reach ntfy at ${base}:`, error);
      return false;
    }
  }
}

/** Cents formatter for the budget pushes, kept next to the other money strings. */
export const notificationMoney = (amount: number): string => exactFormatter.format(amount);

/** The same amount without the cents, for a push title where space is short. */
export const notificationMoneyWhole = (amount: number): string => amountFormatter.format(amount);
