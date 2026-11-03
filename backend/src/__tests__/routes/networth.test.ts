import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, mock } from 'bun:test';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

// The net worth route reads only the database. Any Plaid call fails the test.
const anyPlaidCall = mock(async () => {
  throw new Error('networth route must not call Plaid');
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

// Bun hoists mock.module above the imports, so the app below already uses the fake.
import { app } from '../../index';
import { prisma } from '../../lib/prisma';
import { householdDay } from '../../services/notifyService';

const stamp = Date.now();
const USER_ID = `networth-route-user-${stamp}`;
const OTHER_USER_ID = `networth-route-other-${stamp}`;

const authHeader = () => `Bearer ${jwt.sign({ userId: USER_ID }, process.env.JWT_SECRET!)}`;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The household's today at 00:00 UTC, the date part `BalanceSnapshot` and the route use. */
const utcToday = () => householdDay();
const utcDaysAgo = (days: number) => new Date(utcToday().getTime() - days * DAY_MS);

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

const createUser = (id: string, email: string) =>
  prisma.user.create({
    data: { id, email, fullName: 'Net Worth Test User', passwordHash: 'hash' },
  });

interface AccountInput {
  name: string;
  type?: string;
  currentBalance: number;
  isLiability?: boolean;
  isManual?: boolean;
  isActive?: boolean;
  userId?: string;
}

const createAccount = (input: AccountInput) =>
  prisma.account.create({
    data: {
      userId: input.userId ?? USER_ID,
      name: input.name,
      type: input.type ?? 'depository',
      subtype: input.type ?? 'checking',
      currentBalance: input.currentBalance,
      isLiability: input.isLiability ?? false,
      isManual: input.isManual ?? false,
      isActive: input.isActive ?? true,
    },
  });

const addSnapshot = (accountId: string, daysAgo: number, balance: number) =>
  prisma.balanceSnapshot.create({
    data: { accountId, date: utcDaysAgo(daysAgo), balance },
  });

const netWorthRequest = (query = '') =>
  request(app)
    .get(`/api/networth${query}`)
    .set('Authorization', authHeader());

/** The point for a given day, so the test does not depend on the index. */
const pointFor = (points: Array<{ date: string }>, date: Date) =>
  points.find((point) => point.date === isoDate(date));

const cleanup = async () => {
  const users = [USER_ID, OTHER_USER_ID];
  await prisma.balanceSnapshot.deleteMany({ where: { account: { userId: { in: users } } } });
  await prisma.account.deleteMany({ where: { userId: { in: users } } });
  await prisma.plaidItem.deleteMany({ where: { userId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
};

describe('GET /api/networth', () => {
  beforeAll(async () => {
    await cleanup();
    await createUser(USER_ID, `networth-route-${stamp}@example.com`);
    await createUser(OTHER_USER_ID, `networth-route-other-${stamp}@example.com`);
  });

  beforeEach(async () => {
    // Only this test's accounts, so each case starts from a clean history.
    await prisma.balanceSnapshot.deleteMany({
      where: { account: { userId: { in: [USER_ID, OTHER_USER_ID] } } },
    });
    await prisma.account.deleteMany({
      where: { userId: { in: [USER_ID, OTHER_USER_ID] } },
    });
  });

  afterEach(async () => {
    await prisma.balanceSnapshot.deleteMany({
      where: { account: { userId: { in: [USER_ID, OTHER_USER_ID] } } },
    });
    await prisma.account.deleteMany({
      where: { userId: { in: [USER_ID, OTHER_USER_ID] } },
    });
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('carries snapshots forward and subtracts a credit card balance', async () => {
    // Checking: 1000 until 20 days ago, then 1500. Savings: 500, updated 10 days ago.
    const checking = await createAccount({ name: 'Everyday Checking', currentBalance: 1500 });
    const savings = await createAccount({
      name: 'Emergency Savings',
      type: 'savings',
      currentBalance: 2500,
    });
    // Balances are stored positive; a card is what is owed.
    const card = await createAccount({
      name: 'Travel Card',
      type: 'credit',
      currentBalance: 400,
      isLiability: true,
    });

    await addSnapshot(checking.id, 40, 1000);
    await addSnapshot(checking.id, 20, 1500);
    await addSnapshot(savings.id, 10, 2000);
    await addSnapshot(savings.id, 0, 2500);
    await addSnapshot(card.id, 30, 250);
    await addSnapshot(card.id, 0, 400);

    const response = await netWorthRequest('?range=6m');

    expect(response.status).toBe(200);
    expect(response.body.current).toEqual({ assets: 4000, liabilities: 400, netWorth: 3600 });

    const points: Array<{ date: string; assets: number; liabilities: number; netWorth: number }> =
      response.body.points;
    expect(points.length).toBeGreaterThan(100);
    // Every day up to today, oldest first.
    expect(points[points.length - 1].date).toBe(isoDate(utcToday()));

    // 35 days ago: only checking's older snapshot is known; savings and card are left out.
    expect(pointFor(points, utcDaysAgo(35))).toMatchObject({
      assets: 1000,
      liabilities: 0,
      netWorth: 1000,
    });

    // 25 days ago: the card snapshot (30 days) and checking's older value carry forward.
    expect(pointFor(points, utcDaysAgo(25))).toMatchObject({
      assets: 1000,
      liabilities: 250,
      netWorth: 750,
    });

    // 15 days ago: checking is 1500, the card still 250, savings has no snapshot yet.
    expect(pointFor(points, utcDaysAgo(15))).toMatchObject({
      assets: 1500,
      liabilities: 250,
      netWorth: 1250,
    });

    // 5 days ago: savings is carried forward from its 10-day snapshot.
    expect(pointFor(points, utcDaysAgo(5))).toMatchObject({
      assets: 3500,
      liabilities: 250,
      netWorth: 3250,
    });

    // Today: the newest snapshot for each account.
    expect(points[points.length - 1]).toMatchObject({
      assets: 4000,
      liabilities: 400,
      netWorth: 3600,
    });

    expect(response.body.accounts).toHaveLength(3);
    expect(response.body.accounts).toContainEqual({
      id: checking.id,
      name: 'Everyday Checking',
      type: 'depository',
      isManual: false,
      isLiability: false,
      balance: 1500,
    });
    expect(response.body.accounts).toContainEqual({
      id: savings.id,
      name: 'Emergency Savings',
      type: 'savings',
      isManual: false,
      isLiability: false,
      balance: 2500,
    });
    // The card's stored balance stays positive; it only counts negative in the totals.
    expect(response.body.accounts).toContainEqual({
      id: card.id,
      name: 'Travel Card',
      type: 'credit',
      isManual: false,
      isLiability: true,
      balance: 400,
    });
    expect(anyPlaidCall).not.toHaveBeenCalled();
  });

  it('starts a back-filled manual account from its snapshot date', async () => {
    const checking = await createAccount({ name: 'Checking', currentBalance: 1000 });
    await addSnapshot(checking.id, 40, 1000);

    const house = await createAccount({
      name: 'House',
      type: 'property',
      currentBalance: 450000,
      isManual: true,
    });

    // The user back-fills the value for a past date; the current balance is unchanged by that.
    await addSnapshot(house.id, 20, 400000);

    const response = await netWorthRequest('?range=3m');

    expect(response.status).toBe(200);
    const points = response.body.points as Array<{
      date: string;
      assets: number;
      netWorth: number;
    }>;

    // Before the back-filled date the house does not exist yet.
    expect(pointFor(points, utcDaysAgo(25))).toMatchObject({ assets: 1000, netWorth: 1000 });
    // From its date onward it carries forward.
    expect(pointFor(points, utcDaysAgo(20))).toMatchObject({ assets: 401000 });
    expect(pointFor(points, utcDaysAgo(1))).toMatchObject({ assets: 401000 });
    // `current` still uses the account's stored current balance.
    expect(response.body.current).toEqual({
      assets: 451000,
      liabilities: 0,
      netWorth: 451000,
    });
    // The range starts before the first snapshot, so the first point is 0 and percent has no meaning.
    expect(response.body.change).toEqual({ amount: 451000, percent: null });
  });

  it('returns about a month of daily points for range=1m, ending today', async () => {
    const checking = await createAccount({ name: 'Checking', currentBalance: 1200 });
    await addSnapshot(checking.id, 200, 1000);
    await addSnapshot(checking.id, 0, 1200);

    const response = await netWorthRequest('?range=1m');

    expect(response.status).toBe(200);
    const points = response.body.points as Array<{ date: string; netWorth: number }>;
    expect(points.length).toBe(31);
    expect(points[0].date).toBe(isoDate(utcDaysAgo(30)));
    expect(points[points.length - 1].date).toBe(isoDate(utcToday()));
    // The 200-day-old snapshot is carried all the way forward.
    expect(points[0].netWorth).toBe(1000);
    expect(points[points.length - 1].netWorth).toBe(1200);
    expect(response.body.change).toEqual({ amount: 200, percent: 20 });
  });

  it('samples a range longer than 6 months once a week, always including today', async () => {
    const checking = await createAccount({ name: 'Checking', currentBalance: 1200 });
    await addSnapshot(checking.id, 400, 800);
    await addSnapshot(checking.id, 1, 1200);

    const response = await netWorthRequest('?range=1y');

    expect(response.status).toBe(200);
    const points = response.body.points as Array<{ date: string }>;
    // 365 days sampled every 7 days (53 samples), plus today to close the chart.
    expect(points).toHaveLength(54);
    expect(points[0].date).toBe(isoDate(utcDaysAgo(365)));
    expect(points[points.length - 1].date).toBe(isoDate(utcToday()));
    expect(points[1].date).toBe(isoDate(utcDaysAgo(358)));
  });

  it('starts range=all at the earliest snapshot', async () => {
    const checking = await createAccount({ name: 'Checking', currentBalance: 1200 });
    await addSnapshot(checking.id, 300, 900);
    await addSnapshot(checking.id, 100, 1000);
    await addSnapshot(checking.id, 0, 1200);

    const response = await netWorthRequest('?range=all');

    expect(response.status).toBe(200);
    const points = response.body.points as Array<{ date: string; netWorth: number }>;
    expect(points[0].date).toBe(isoDate(utcDaysAgo(300)));
    expect(points[0].netWorth).toBe(900);
    expect(points[points.length - 1].date).toBe(isoDate(utcToday()));
    // 300 days sampled weekly.
    expect(points).toHaveLength(44);
  });

  it('works earlier days back from transactions before the first snapshot', async () => {
    const checking = await createAccount({ name: 'Checking', currentBalance: 1000 });
    const card = await createAccount({ name: 'Card', type: 'credit', currentBalance: 300, isLiability: true });
    const retirement = await createAccount({ name: '401(k)', type: 'retirement', isManual: true, currentBalance: 5000 });
    await addSnapshot(checking.id, 0, 1000);
    await addSnapshot(card.id, 0, 300);
    await addSnapshot(retirement.id, 0, 5000);

    const tx = (accountId: string, daysAgo: number, amount: number) =>
      prisma.transaction.create({
        data: { userId: USER_ID, accountId, name: 'x', amount, date: utcDaysAgo(daysAgo) },
      });
    await tx(checking.id, 10, -2000); // paycheck in
    await tx(checking.id, 5, 400); // rent out
    await tx(card.id, 3, 300); // a charge on the card
    await tx(checking.id, 0, 600); // spent today, already in today's snapshot

    const response = await netWorthRequest('?range=1m');
    expect(response.status).toBe(200);
    expect(response.body.estimatedBefore).toBe(isoDate(utcToday()));

    const points = response.body.points as Array<{ date: string; assets: number; liabilities: number }>;
    // Before the paycheck: 1000 + 600 + 400 − 2000 = 0 in checking, nothing owed, 401(k) held at 5000.
    expect(pointFor(points, utcDaysAgo(11))).toMatchObject({ assets: 5000, liabilities: 0 });
    expect(pointFor(points, utcDaysAgo(10))).toMatchObject({ assets: 7000, liabilities: 0 });
    expect(pointFor(points, utcDaysAgo(5))).toMatchObject({ assets: 6600, liabilities: 0 });
    expect(pointFor(points, utcDaysAgo(3))).toMatchObject({ assets: 6600, liabilities: 300 });
    expect(pointFor(points, utcDaysAgo(1))).toMatchObject({ assets: 6600, liabilities: 300 });
    expect(pointFor(points, utcToday())).toMatchObject({ assets: 6000, liabilities: 300 });
    // Before anything was known the day is left out (zero), as before.
    expect(pointFor(points, utcDaysAgo(12))).toMatchObject({ assets: 0, liabilities: 0 });
  });

  it('leaves out another user and inactive accounts', async () => {
    const mine = await createAccount({ name: 'My Checking', currentBalance: 500 });
    await addSnapshot(mine.id, 0, 500);

    await createAccount({ name: 'Closed', currentBalance: 9999, isActive: false });

    const other = await createAccount({
      name: 'Their Checking',
      currentBalance: 8888,
      userId: OTHER_USER_ID,
    });
    await addSnapshot(other.id, 0, 8888);

    const response = await netWorthRequest('?range=1m');

    expect(response.status).toBe(200);
    expect(response.body.current).toEqual({ assets: 500, liabilities: 0, netWorth: 500 });
    expect(response.body.accounts.map((account: { name: string }) => account.name)).toEqual([
      'My Checking',
    ]);
    for (const point of response.body.points) {
      // Neither the closed account nor the other user's 8888 ever lands in a point.
      expect(point.assets === 0 || point.assets === 500).toBe(true);
      expect(point.netWorth).toBe(point.assets);
    }
    const points = response.body.points as Array<{ date: string; assets: number }>;
    expect(points[points.length - 1].assets).toBe(500);
  });

  it('returns zeros and no points for a user with no snapshots', async () => {
    const response = await netWorthRequest();

    expect(response.status).toBe(200);
    expect(response.body.current).toEqual({ assets: 0, liabilities: 0, netWorth: 0 });
    expect(response.body.change).toEqual({ amount: 0, percent: null });
    expect(response.body.points).toEqual([]);
    expect(response.body.accounts).toEqual([]);
  });

  it('returns zeros with the accounts still listed when nothing has synced yet', async () => {
    const checking = await createAccount({ name: 'Fresh Checking', currentBalance: 0 });

    const response = await netWorthRequest('?range=1m');

    expect(response.status).toBe(200);
    expect(response.body.current).toEqual({ assets: 0, liabilities: 0, netWorth: 0 });
    // No snapshot means no history: the frontend shows the "after your first sync" hint.
    expect(response.body.points).toEqual([]);
    expect(response.body.accounts).toEqual([
      {
        id: checking.id,
        name: 'Fresh Checking',
        type: 'depository',
        isManual: false,
        isLiability: false,
        balance: 0,
      },
    ]);
  });

  it('rounds every money value to cents', async () => {
    const checking = await createAccount({ name: 'Checking', currentBalance: 100.006 });
    await addSnapshot(checking.id, 1, 99.994);
    await addSnapshot(checking.id, 0, 100.006);

    const response = await netWorthRequest('?range=1m');

    expect(response.status).toBe(200);
    expect(response.body.current).toEqual({ assets: 100.01, liabilities: 0, netWorth: 100.01 });
    expect(response.body.accounts[0].balance).toBe(100.01);
    const points = response.body.points as Array<{ netWorth: number }>;
    expect(points[points.length - 2].netWorth).toBe(99.99);
  });

  it('reports a null percent when the range starts at zero', async () => {
    const checking = await createAccount({ name: 'Checking', currentBalance: 250 });
    await addSnapshot(checking.id, 0, 250);

    const response = await netWorthRequest('?range=1m');

    expect(response.status).toBe(200);
    // The account has no snapshot on the first day of the range, so the first point is 0.
    const first = response.body.points[0];
    expect(first.netWorth).toBe(0);
    expect(response.body.change).toEqual({ amount: 250, percent: null });
  });

  it('falls back to 6m for an unknown range', async () => {
    const checking = await createAccount({ name: 'Checking', currentBalance: 100 });
    await addSnapshot(checking.id, 200, 100);

    const unknown = await netWorthRequest('?range=forever');
    const fallback = await netWorthRequest('?range=6m');

    expect(unknown.status).toBe(200);
    expect(unknown.body.points).toEqual(fallback.body.points);
    expect(unknown.body.points).toHaveLength(181);
  });

  it('requires authentication', async () => {
    const response = await request(app).get('/api/networth');
    expect(response.status).toBe(401);
  });
});
