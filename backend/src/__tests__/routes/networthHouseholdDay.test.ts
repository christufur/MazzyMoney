import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, mock } from 'bun:test';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

// The "history starts Nov 3, not Nov 2" review fix (E2): the route reads the day in the
// household's time zone, not in UTC. Plaid is never involved.
const anyPlaidCall = mock(async () => {
  throw new Error('the net worth route must not call Plaid');
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
const USER_ID = `networth-day-user-${stamp}`;
const DAY_MS = 24 * 60 * 60 * 1000;

const authHeader = () => `Bearer ${jwt.sign({ userId: USER_ID }, process.env.JWT_SECRET!)}`;

const netWorthRequest = () =>
  request(app).get('/api/networth?range=1m').set('Authorization', authHeader());

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

const cleanup = async () => {
  await prisma.balanceSnapshot.deleteMany({ where: { account: { userId: USER_ID } } });
  await prisma.account.deleteMany({ where: { userId: USER_ID } });
  await prisma.user.deleteMany({ where: { id: USER_ID } });
};

describe('GET /api/networth uses the household day', () => {
  beforeAll(async () => {
    await cleanup();
    await prisma.user.create({
      data: {
        id: USER_ID,
        email: `networth-day-${stamp}@example.com`,
        fullName: 'Day Tester',
        passwordHash: 'hash',
      },
    });
  });

  beforeEach(async () => {
    await prisma.balanceSnapshot.deleteMany({ where: { account: { userId: USER_ID } } });
    await prisma.account.deleteMany({ where: { userId: USER_ID } });
  });

  afterEach(async () => {
    await prisma.balanceSnapshot.deleteMany({ where: { account: { userId: USER_ID } } });
    await prisma.account.deleteMany({ where: { userId: USER_ID } });
    delete process.env.APP_TIMEZONE;
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('ends the chart on the household day, not on the UTC day', async () => {
    // Tokyo is ahead of UTC, so in the small hours of the UTC morning the household is
    // already on the next day. The last point must be that day.
    process.env.APP_TIMEZONE = 'Asia/Tokyo';

    const account = await prisma.account.create({
      data: { userId: USER_ID, name: 'Checking', type: 'depository', subtype: 'checking', currentBalance: 100 },
    });
    await prisma.balanceSnapshot.create({
      data: { accountId: account.id, date: householdDay(), balance: 100 },
    });

    const response = await netWorthRequest();

    expect(response.status).toBe(200);
    const points = response.body.points as Array<{ date: string }>;
    expect(points[points.length - 1].date).toBe(isoDate(householdDay()));
  });

  it('carries the last snapshot forward to the household day', async () => {
    const account = await prisma.account.create({
      data: { userId: USER_ID, name: 'Checking', type: 'depository', subtype: 'checking', currentBalance: 120 },
    });
    const yesterday = new Date(householdDay().getTime() - DAY_MS);
    await prisma.balanceSnapshot.create({
      data: { accountId: account.id, date: yesterday, balance: 120 },
    });

    const response = await netWorthRequest();

    expect(response.status).toBe(200);
    const points = response.body.points as Array<{ date: string; netWorth: number }>;
    const last = points[points.length - 1];
    // The day being computed is today's snapshot date even though the row is from yesterday.
    expect(last.date).toBe(isoDate(householdDay()));
    expect(last.netWorth).toBe(120);
  });
});
