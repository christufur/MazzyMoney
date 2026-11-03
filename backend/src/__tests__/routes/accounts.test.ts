import { describe, it, expect, beforeAll, afterEach, afterAll, mock } from 'bun:test';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

// This route must not talk to Plaid at all. Any call fails the test instead of hitting the network.
const anyPlaidCall = mock(async () => {
  throw new Error('accounts route must not call Plaid');
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

const stamp = Date.now();
const USER_ID = `accounts-route-user-${stamp}`;
const OTHER_USER_ID = `accounts-route-other-${stamp}`;

const authHeader = () => `Bearer ${jwt.sign({ userId: USER_ID }, process.env.JWT_SECRET!)}`;

const createUser = (id: string, email: string) =>
  prisma.user.create({
    data: { id, email, fullName: 'Accounts Test User', passwordHash: 'hash' },
  });

const cleanup = async () => {
  await prisma.account.deleteMany({
    where: { userId: { in: [USER_ID, OTHER_USER_ID] } },
  });
  await prisma.plaidItem.deleteMany({
    where: { userId: { in: [USER_ID, OTHER_USER_ID] } },
  });
  await prisma.user.deleteMany({ where: { id: { in: [USER_ID, OTHER_USER_ID] } } });
};

describe('GET /api/accounts', () => {
  beforeAll(async () => {
    await cleanup();
    await createUser(USER_ID, `accounts-route-${stamp}@example.com`);
    await createUser(OTHER_USER_ID, `accounts-route-other-${stamp}@example.com`);
  });

  afterEach(async () => {
    await prisma.account.deleteMany({
      where: { userId: { in: [USER_ID, OTHER_USER_ID] } },
    });
    await prisma.plaidItem.deleteMany({
      where: { userId: { in: [USER_ID, OTHER_USER_ID] } },
    });
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('returns an empty, disconnected payload for a new user', async () => {
    const response = await request(app)
      .get('/api/accounts')
      .set('Authorization', authHeader());

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      accounts: [],
      institution: null,
      connected: false,
      summary: { totalAccounts: 0, totalBalance: 0, totalAvailable: 0 },
    });  });

  it('returns Plaid and manual accounts ordered by createdAt with a summary', async () => {
    const item = await prisma.plaidItem.create({
      data: {
        userId: USER_ID,
        accessToken: `access-accounts-${stamp}`,
        itemId: `plaid-item-accounts-${stamp}`,
        institutionId: `ins-accounts-${stamp}`,
        institutionName: 'Accounts Bank',
        status: 'ACTIVE',
      },
    });

    await prisma.account.create({
      data: {
        plaidAccountId: `acc-plaid-${stamp}`,
        plaidItemId: item.id,
        userId: USER_ID,
        name: 'Everyday Checking',
        officialName: 'Everyday Checking Account',
        type: 'depository',
        subtype: 'checking',
        mask: '1111',
        currentBalance: 1000,
        availableBalance: 900,
        createdAt: new Date('2025-01-01T00:00:00Z'),
      },
    });

    await prisma.account.create({
      data: {
        userId: USER_ID,
        name: '401(k)',
        type: 'investment',
        subtype: 'retirement',
        currentBalance: 5000,
        isManual: true,
        createdAt: new Date('2025-02-01T00:00:00Z'),
      },
    });

    // Inactive accounts are left out.
    await prisma.account.create({
      data: {
        userId: USER_ID,
        name: 'Old closed account',
        type: 'depository',
        subtype: 'checking',
        currentBalance: 25,
        isActive: false,
        createdAt: new Date('2025-03-01T00:00:00Z'),
      },
    });

    // Another user's account must never show up.
    await prisma.account.create({
      data: {
        userId: OTHER_USER_ID,
        name: 'Not mine',
        type: 'depository',
        subtype: 'checking',
        currentBalance: 777,
      },
    });

    const response = await request(app)
      .get('/api/accounts')
      .set('Authorization', authHeader());

    expect(response.status).toBe(200);
    expect(response.body.connected).toBe(true);
    expect(response.body.institution).toEqual({ name: 'Accounts Bank' });
    expect(response.body.accounts).toHaveLength(2);
    expect(response.body.accounts[0]).toEqual({
      account_id: `acc-plaid-${stamp}`,
      name: 'Everyday Checking',
      official_name: 'Everyday Checking Account',
      balances: { current: 1000, available: 900, limit: null },
      type: 'depository',
      subtype: 'checking',
      mask: '1111',
    });
    // Manual accounts fall back to the database id for account_id.
    const manual = response.body.accounts[1];
    expect(manual).toMatchObject({
      name: '401(k)',
      balances: { current: 5000, available: null, limit: null },
      type: 'investment',
      subtype: 'retirement',
      mask: null,
    });
    expect(manual.account_id).toBeTruthy();
    expect(manual.account_id).not.toBe(`acc-plaid-${stamp}`);

    expect(response.body.summary).toEqual({
      totalAccounts: 2,
      totalBalance: 6000,
      totalAvailable: 900,
    });
  });

  it('is connected when the user has an item, and lists accounts with no Plaid calls', async () => {
    await prisma.plaidItem.create({
      data: {
        userId: USER_ID,
        accessToken: `access-empty-${stamp}`,
        itemId: `plaid-item-empty-${stamp}`,
        institutionId: `ins-empty-${stamp}`,
        institutionName: 'Empty Bank',
        status: 'LOGIN_REQUIRED',
        lastError: 'ITEM_LOGIN_REQUIRED',
      },
    });

    const response = await request(app)
      .get('/api/accounts')
      .set('Authorization', authHeader());

    expect(response.status).toBe(200);
    expect(response.body.connected).toBe(true);
    expect(response.body.accounts).toEqual([]);
    expect(response.body.institution).toEqual({ name: 'Empty Bank' });
    expect(anyPlaidCall).not.toHaveBeenCalled();
  });

  it('removes the legacy manual sync endpoint', async () => {
    const response = await request(app)
      .post('/api/accounts/sync')
      .set('Authorization', authHeader());

    expect(response.status).toBe(404);
  });

  it('requires authentication', async () => {
    const response = await request(app).get('/api/accounts');
    expect(response.status).toBe(401);
  });
});
