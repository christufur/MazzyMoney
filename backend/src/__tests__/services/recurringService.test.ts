import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, mock } from 'bun:test';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

// Recurring detection is our own; no Plaid endpoint (recurring or otherwise) may be called.
const anyPlaidCall = mock(async () => {
  throw new Error('recurring route must not call Plaid');
});

mock.module('../../lib/plaid', () => ({
  plaidClient: {
    linkTokenCreate: anyPlaidCall,
    itemPublicTokenExchange: anyPlaidCall,
    itemGet: anyPlaidCall,
    institutionsGetById: anyPlaidCall,
    accountsGet: anyPlaidCall,
    itemRemove: anyPlaidCall,
    transactionsSync: anyPlaidCall,
    transactionsGet: anyPlaidCall,
  },
  ITEM_LIMIT: 10,
  plaidErrorCode: (err: any) => err?.response?.data?.error_code,
}));

import {
  detectSeries,
  merchantKey,
  monthlyEquivalent,
  RecurringService,
} from '../../services/recurringService';
import { app } from '../../index';
import { prisma } from '../../lib/prisma';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAY = (year: number, monthIndex: number, day: number) => new Date(Date.UTC(year, monthIndex, day));

const expense = (date: Date, amount: number, label = 'Netflix') => ({
  date,
  amount,
  name: label,
  merchantName: null,
  merchantDisplay: null,
});

const describeSeries = (series: ReturnType<typeof detectSeries>) =>
  series.map((row) => ({
    merchantKey: row.merchantKey,
    displayName: row.displayName,
    averageAmount: row.averageAmount,
    intervalDays: row.intervalDays,
    lastDate: row.lastDate.toISOString(),
    nextDate: row.nextDate.toISOString(),
  }));

describe('merchantKey', () => {
  it('treats a store number on the same merchant as one key', () => {
    expect(merchantKey({ date: DAY(2025, 0, 1), amount: 1, name: 'x', merchantDisplay: 'NETFLIX.COM 8443' }))
      .toBe('netflix.com');
    expect(merchantKey({ date: DAY(2025, 0, 1), amount: 1, name: 'x', merchantDisplay: 'Netflix.com 1234' }))
      .toBe('netflix.com');
  });

  it('drops # and * style punctuation', () => {
    expect(merchantKey({ date: DAY(2025, 0, 1), amount: 1, name: 'x', merchantName: 'SQ *BLUE BOTTLE #22' }))
      .toBe('sq blue bottle');
  });

  it('prefers merchantDisplay, then merchantName, then name', () => {
    expect(merchantKey({ date: DAY(2025, 0, 1), amount: 1, name: 'RAW', merchantName: 'NAME', merchantDisplay: 'Display' }))
      .toBe('display');
    expect(merchantKey({ date: DAY(2025, 0, 1), amount: 1, name: 'RAW', merchantName: 'NAME' }))
      .toBe('name');
    expect(merchantKey({ date: DAY(2025, 0, 1), amount: 1, name: 'RAW' }))
      .toBe('raw');
  });
});

// Fixed-date fixtures: evaluate as of the latest charge, so the "cancelled" rule does not depend on today.
const detectAtLastCharge = (rows: Parameters<typeof detectSeries>[0]) =>
  detectSeries(rows, new Date(Math.max(...rows.map((row) => row.date.getTime()))));

describe('detectSeries', () => {
  it('drops a series whose last charge is more than two cycles old (cancelled)', () => {
    const rows = [
      expense(DAY(2025, 0, 15), 15.49),
      expense(DAY(2025, 1, 15), 15.49),
      expense(DAY(2025, 2, 15), 15.49),
    ];
    expect(detectSeries(rows, DAY(2025, 3, 20))).toHaveLength(1);
    expect(detectSeries(rows, DAY(2025, 5, 1))).toHaveLength(0);
  });

  it('finds a monthly subscription and its next date', () => {
    const series = detectAtLastCharge([
      expense(DAY(2025, 0, 15), 15.49),
      expense(DAY(2025, 1, 15), 15.49),
      expense(DAY(2025, 2, 15), 15.49),
      expense(DAY(2025, 3, 15), 15.49),
    ]);

    expect(series).toHaveLength(1);
    expect(describeSeries(series)[0]).toEqual({
      merchantKey: 'netflix',
      displayName: 'Netflix',
      averageAmount: 15.49,
      intervalDays: 30,
      lastDate: '2025-04-15T00:00:00.000Z',
      nextDate: '2025-05-15T00:00:00.000Z',
    });
  });

  it('uses the median amount, so one odd charge does not move it', () => {
    const series = detectAtLastCharge([
      expense(DAY(2025, 0, 5), 20),
      expense(DAY(2025, 1, 5), 20),
      expense(DAY(2025, 2, 5), 20),
      expense(DAY(2025, 3, 5), 22),
    ]);

    expect(series[0].averageAmount).toBe(20);
  });

  it('finds a weekly series', () => {
    const series = detectAtLastCharge([
      expense(DAY(2025, 2, 3), 25, 'Planet Fitness'),
      expense(DAY(2025, 2, 10), 25, 'Planet Fitness'),
      expense(DAY(2025, 2, 17), 25, 'Planet Fitness'),
      expense(DAY(2025, 2, 24), 25, 'Planet Fitness'),
    ]);

    expect(series).toHaveLength(1);
    expect(series[0]).toMatchObject({ intervalDays: 7, averageAmount: 25 });
    expect(series[0].nextDate.toISOString()).toBe('2025-03-31T00:00:00.000Z');
  });

  it('finds a yearly series across three years', () => {
    const series = detectAtLastCharge([
      expense(DAY(2022, 5, 1), 120, 'Car Registration'),
      expense(DAY(2023, 5, 1), 120, 'Car Registration'),
      expense(DAY(2024, 5, 1), 120, 'Car Registration'),
    ]);

    expect(series).toHaveLength(1);
    expect(series[0]).toMatchObject({ intervalDays: 365, averageAmount: 120 });
    // 2024 is a leap year, so the last gap is 366 days and the next date is 365 days after 2024-06-01.
    expect(series[0].nextDate.toISOString()).toBe('2025-06-01T00:00:00.000Z');
  });

  it('clamps a monthly bill to the last day of a short month', () => {
    const series = detectAtLastCharge([
      expense(DAY(2024, 10, 30), 9.99, 'iCloud'),
      expense(DAY(2024, 11, 31), 9.99, 'iCloud'),
      expense(DAY(2025, 0, 31), 9.99, 'iCloud'),
    ]);

    expect(series).toHaveLength(1);
    expect(series[0]).toMatchObject({ intervalDays: 30 });
    // 2025-01-31 + one month is February, which has 28 days in 2025.
    expect(series[0].nextDate.toISOString()).toBe('2025-02-28T00:00:00.000Z');
  });

  it('ignores only two occurrences', () => {
    const series = detectAtLastCharge([
      expense(DAY(2025, 0, 15), 15.49),
      expense(DAY(2025, 1, 15), 15.49),
    ]);

    expect(series).toEqual([]);
  });

  it('ignores irregular gaps', () => {
    const series = detectAtLastCharge([
      expense(DAY(2025, 0, 3), 15.49),
      expense(DAY(2025, 0, 6), 15.49),
      expense(DAY(2025, 0, 27), 15.49),
      expense(DAY(2025, 2, 6), 15.49),
      expense(DAY(2025, 2, 18), 15.49),
    ]);

    expect(series).toEqual([]);
  });

  it('ignores amounts that swing by more than 15%', () => {
    const series = detectAtLastCharge([
      expense(DAY(2025, 0, 15), 10),
      expense(DAY(2025, 1, 15), 18),
      expense(DAY(2025, 2, 15), 10),
      expense(DAY(2025, 3, 15), 18),
    ]);

    expect(series).toEqual([]);
  });

  it('keeps groups apart and lists the soonest bill first', () => {
    const series = detectAtLastCharge([
      expense(DAY(2025, 0, 20), 15.49, 'Netflix.com 1234'),
      expense(DAY(2025, 1, 20), 15.49, 'NETFLIX.COM 8443'),
      expense(DAY(2025, 2, 20), 15.49, 'Netflix.com 5555'),
      expense(DAY(2025, 0, 5), 25, 'Gym'),
      expense(DAY(2025, 1, 5), 25, 'Gym'),
      expense(DAY(2025, 2, 5), 25, 'Gym'),
    ]);

    expect(series).toHaveLength(2);
    expect(series.map((row) => row.merchantKey)).toEqual(['gym', 'netflix.com']);
    // The most recent raw name is the display name.
    expect(series[1].displayName).toBe('Netflix.com 5555');
  });
});

describe('monthlyEquivalent', () => {
  it('spreads an interval over an average month', () => {
    expect(monthlyEquivalent({ averageAmount: 100, intervalDays: 30 })).toBe(101.46);
    expect(monthlyEquivalent({ averageAmount: 7, intervalDays: 7 })).toBe(30.44);
    expect(monthlyEquivalent({ averageAmount: 1200, intervalDays: 365 })).toBe(100.07);
  });
});

const stamp = Date.now();
const USER_ID = `recurring-test-user-${stamp}`;
const OTHER_USER_ID = `recurring-test-other-${stamp}`;
const ACCOUNT_ID = `recurring-test-account-${stamp}`;

let transactionSeq = 0;

/** UTC midnight on the 15th, `monthsAgo` months back, so the series sits inside the 400-day window. */
function monthsAgo(months: number) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 15));
}

async function createTransaction(
  userId: string,
  data: {
    name: string;
    amount: number;
    date: Date;
    isTransfer?: boolean;
    hidden?: boolean;
    pending?: boolean;
  }
) {
  transactionSeq += 1;
  return prisma.transaction.create({
    data: {
      plaidTransactionId: `recurring-test-plaid-${stamp}-${transactionSeq}`,
      userId,
      accountId: ACCOUNT_ID,
      name: data.name,
      amount: data.amount,
      date: data.date,
      isTransfer: data.isTransfer ?? false,
      hidden: data.hidden ?? false,
      pending: data.pending ?? false,
      categories: [],
    },
  });
}

async function cleanup() {
  // Only this run's rows: other agents share the test database.
  await prisma.transaction.deleteMany({ where: { userId: { in: [USER_ID, OTHER_USER_ID] } } });
  await prisma.recurringSeries.deleteMany({ where: { userId: { in: [USER_ID, OTHER_USER_ID] } } });
  await prisma.account.deleteMany({ where: { userId: { in: [USER_ID, OTHER_USER_ID] } } });
  await prisma.user.deleteMany({ where: { id: { in: [USER_ID, OTHER_USER_ID] } } });
}

beforeAll(async () => {
  await cleanup();

  await prisma.user.create({
    data: { id: USER_ID, email: `recurring-test-${stamp}@example.com`, fullName: 'Recurring Test User', passwordHash: 'hash' },
  });
  await prisma.user.create({
    data: { id: OTHER_USER_ID, email: `recurring-test-other-${stamp}@example.com`, fullName: 'Other User', passwordHash: 'hash' },
  });
  await prisma.account.create({
    data: {
      id: ACCOUNT_ID,
      plaidAccountId: `recurring-test-plaid-account-${stamp}`,
      userId: USER_ID,
      name: 'Recurring Checking',
      type: 'checking',
      subtype: 'checking',
    },
  });
});

beforeEach(async () => {
  await prisma.transaction.deleteMany({ where: { userId: { in: [USER_ID, OTHER_USER_ID] } } });
  await prisma.recurringSeries.deleteMany({ where: { userId: { in: [USER_ID, OTHER_USER_ID] } } });
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('RecurringService.refreshForUser', () => {
  it('stores a detected series and keeps a user IGNORED choice', async () => {
    for (const months of [3, 2, 1]) {
      await createTransaction(USER_ID, { name: 'NETFLIX.COM 8443', amount: 15.49, date: monthsAgo(months) });
    }

    await prisma.recurringSeries.create({
      data: {
        userId: USER_ID,
        merchantKey: 'netflix.com',
        displayName: 'Netflix',
        averageAmount: 1,
        intervalDays: 30,
        lastDate: monthsAgo(4),
        nextDate: monthsAgo(3),
        status: 'IGNORED',
      },
    });

    await RecurringService.refreshForUser(USER_ID);

    const rows = await prisma.recurringSeries.findMany({ where: { userId: USER_ID } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ merchantKey: 'netflix.com', status: 'IGNORED', averageAmount: 15.49 });
    expect(rows[0].displayName).toBe('NETFLIX.COM 8443');
  });

  it('leaves out transfers, hidden charges, pending charges, and income', async () => {
    // Five monthly charges, but only two of them may count: not enough for a series.
    const months = [4, 3, 2, 1, 0];
    await createTransaction(USER_ID, { name: 'Gym Membership', amount: 25, date: monthsAgo(months[0]) });
    await createTransaction(USER_ID, { name: 'Gym Membership', amount: 25, date: monthsAgo(months[1]), isTransfer: true });
    await createTransaction(USER_ID, { name: 'Gym Membership', amount: 25, date: monthsAgo(months[2]), hidden: true });
    await createTransaction(USER_ID, { name: 'Gym Membership', amount: 25, date: monthsAgo(months[3]), pending: true });
    await createTransaction(USER_ID, { name: 'Gym Membership', amount: -25, date: monthsAgo(months[4]) });

    await RecurringService.refreshForUser(USER_ID);

    expect(await prisma.recurringSeries.findMany({ where: { userId: USER_ID } })).toEqual([]);
  });

  it('deletes a cancelled series once two intervals have passed', async () => {
    const longAgo = new Date(Date.now() - 200 * MS_PER_DAY);
    const soon = new Date(Date.now() + 10 * MS_PER_DAY);

    const stale = await prisma.recurringSeries.create({
      data: {
        userId: USER_ID,
        merchantKey: 'old gym',
        displayName: 'Old Gym',
        averageAmount: 40,
        intervalDays: 30,
        lastDate: longAgo,
        nextDate: longAgo,
        status: 'ACTIVE',
      },
    });
    const recent = await prisma.recurringSeries.create({
      data: {
        userId: USER_ID,
        merchantKey: 'new gym',
        displayName: 'New Gym',
        averageAmount: 45,
        intervalDays: 30,
        lastDate: longAgo,
        nextDate: soon,
        status: 'ACTIVE',
      },
    });
    const ignored = await prisma.recurringSeries.create({
      data: {
        userId: USER_ID,
        merchantKey: 'ignored yearly',
        displayName: 'Ignored Yearly',
        averageAmount: 99,
        intervalDays: 365,
        lastDate: longAgo,
        nextDate: longAgo,
        status: 'IGNORED',
      },
    });

    await RecurringService.refreshForUser(USER_ID);

    const ids = (await prisma.recurringSeries.findMany({ where: { userId: USER_ID } })).map((row) => row.id);
    expect(ids).not.toContain(stale.id);
    expect(ids).toContain(recent.id);
    // Only ACTIVE rows are cleaned up; an ignored row is the user's own decision.
    expect(ids).toContain(ignored.id);
  });
});

const authHeader = (userId: string) => `Bearer ${jwt.sign({ userId }, process.env.JWT_SECRET!)}`;

describe('GET /api/recurring', () => {
  it('returns the series, the monthly total in cents, and the next 30 days', async () => {
    const now = new Date();
    const inTenDays = new Date(Date.now() + 10 * MS_PER_DAY);
    const inFortyDays = new Date(Date.now() + 40 * MS_PER_DAY);

    await prisma.recurringSeries.createMany({
      data: [
        {
          userId: USER_ID,
          merchantKey: 'netflix',
          displayName: 'Netflix',
          averageAmount: 100,
          intervalDays: 30,
          lastDate: now,
          nextDate: inTenDays,
          status: 'ACTIVE',
        },
        {
          userId: USER_ID,
          merchantKey: 'gym',
          displayName: 'Gym',
          averageAmount: 7,
          intervalDays: 7,
          lastDate: now,
          nextDate: inFortyDays,
          status: 'ACTIVE',
        },
        {
          userId: USER_ID,
          merchantKey: 'ignored bill',
          displayName: 'Ignored Bill',
          averageAmount: 1000,
          intervalDays: 365,
          lastDate: now,
          nextDate: inTenDays,
          status: 'IGNORED',
        },
      ],
    });

    const response = await request(app)
      .get('/api/recurring')
      .set('Authorization', authHeader(USER_ID));

    expect(response.status).toBe(200);
    expect(response.body.series).toHaveLength(3);

    // 100 * 30.4375 / 30 = 101.46, plus 7 * 30.4375 / 7 = 30.44. The ignored yearly bill is not included.
    expect(response.body.monthlyTotal).toBe(10146 + 3044);

    expect(response.body.upcoming).toHaveLength(1);
    expect(response.body.upcoming[0]).toMatchObject({
      merchantKey: 'netflix',
      displayName: 'Netflix',
      averageAmount: 100,
      intervalDays: 30,
      monthlyEquivalent: 101.46,
      status: 'ACTIVE',
    });
  });

  it('requires authentication', async () => {
    const response = await request(app).get('/api/recurring');
    expect(response.status).toBe(401);
  });
});

describe('PATCH /api/recurring/:id', () => {
  it('ignores a series, then restores it', async () => {
    const row = await prisma.recurringSeries.create({
      data: {
        userId: USER_ID,
        merchantKey: 'spotify',
        displayName: 'Spotify',
        averageAmount: 10.99,
        intervalDays: 30,
        lastDate: new Date(),
        nextDate: new Date(Date.now() + 5 * MS_PER_DAY),
        status: 'ACTIVE',
      },
    });

    const ignored = await request(app)
      .patch(`/api/recurring/${row.id}`)
      .set('Authorization', authHeader(USER_ID))
      .send({ status: 'IGNORED' });

    expect(ignored.status).toBe(200);
    expect(ignored.body.series).toMatchObject({ id: row.id, status: 'IGNORED', monthlyEquivalent: 11.15 });
    expect((await prisma.recurringSeries.findUnique({ where: { id: row.id } }))?.status).toBe('IGNORED');

    const restored = await request(app)
      .patch(`/api/recurring/${row.id}`)
      .set('Authorization', authHeader(USER_ID))
      .send({ status: 'ACTIVE' });

    expect(restored.status).toBe(200);
    expect(restored.body.series.status).toBe('ACTIVE');
  });

  it('returns 404 for another user\'s series', async () => {
    const row = await prisma.recurringSeries.create({
      data: {
        userId: OTHER_USER_ID,
        merchantKey: 'other spotify',
        displayName: 'Spotify',
        averageAmount: 10.99,
        intervalDays: 30,
        lastDate: new Date(),
        nextDate: new Date(),
        status: 'ACTIVE',
      },
    });

    const response = await request(app)
      .patch(`/api/recurring/${row.id}`)
      .set('Authorization', authHeader(USER_ID))
      .send({ status: 'IGNORED' });

    expect(response.status).toBe(404);
    expect((await prisma.recurringSeries.findUnique({ where: { id: row.id } }))?.status).toBe('ACTIVE');
  });

  it('rejects a status it does not know', async () => {
    const row = await prisma.recurringSeries.create({
      data: {
        userId: USER_ID,
        merchantKey: 'bad status',
        displayName: 'Bad Status',
        averageAmount: 1,
        intervalDays: 30,
        lastDate: new Date(),
        nextDate: new Date(),
        status: 'ACTIVE',
      },
    });

    const response = await request(app)
      .patch(`/api/recurring/${row.id}`)
      .set('Authorization', authHeader(USER_ID))
      .send({ status: 'DELETED' });

    expect(response.status).toBe(400);
  });
});

describe('POST /api/recurring/refresh', () => {
  it('detects the series from stored transactions and returns the page payload', async () => {
    // Exact 30-day gaps ending today, so the next date is exactly 30 days out: inside the window.
    for (const days of [60, 30, 0]) {
      await createTransaction(USER_ID, {
        name: 'Netflix.com 1234',
        amount: 15.49,
        date: new Date(Date.now() - days * MS_PER_DAY),
      });
    }

    const response = await request(app)
      .post('/api/recurring/refresh')
      .set('Authorization', authHeader(USER_ID));

    expect(response.status).toBe(200);
    expect(response.body.series).toHaveLength(1);
    expect(response.body.series[0]).toMatchObject({
      merchantKey: 'netflix.com',
      displayName: 'Netflix.com 1234',
      averageAmount: 15.49,
      intervalDays: 30,
      status: 'ACTIVE',
    });
    expect(response.body.monthlyTotal).toBe(1572);
    // The next charge is 30 days after the last one, so it lands inside the 30-day window.
    expect(response.body.upcoming).toHaveLength(1);
    expect(anyPlaidCall).not.toHaveBeenCalled();
  });
});

afterEach(() => {
  mock.clearAllMocks();
});
