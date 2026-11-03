import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

// Manual accounts never touch Plaid. Any call fails the test instead of hitting the network.
const anyPlaidCall = mock(async () => {
  throw new Error('manual accounts route must not call Plaid');
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
const USER_ID = `manual-accounts-user-${stamp}`;
const OTHER_USER_ID = `manual-accounts-other-${stamp}`;

const authHeader = (userId: string = USER_ID) =>
  `Bearer ${jwt.sign({ userId }, process.env.JWT_SECRET!)}`;

const todayUtc = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};

const dayBefore = (days: number) => {
  const today = todayUtc();
  return new Date(today.getTime() - days * 24 * 60 * 60 * 1000);
};

const dateOnly = (date: Date) => date.toISOString().slice(0, 10);

const createUser = (id: string, email: string) =>
  prisma.user.create({
    data: { id, email, fullName: 'Manual Accounts Test User', passwordHash: 'hash' },
  });

/** A manual account made directly, for the routes that need an existing id. */
const createAccount = (userId: string, overrides: Record<string, any> = {}) =>
  prisma.account.create({
    data: {
      userId,
      name: '401(k)',
      type: 'retirement',
      subtype: 'retirement',
      currentBalance: 1000,
      isManual: true,
      ...overrides,
    },
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

beforeAll(async () => {
  await cleanup();
  await createUser(USER_ID, `manual-accounts-${stamp}@example.com`);
  await createUser(OTHER_USER_ID, `manual-accounts-other-${stamp}@example.com`);
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('POST /api/accounts/manual', () => {
  it('creates a manual account with cents rounded and a snapshot for today', async () => {
    const response = await request(app)
      .post('/api/accounts/manual')
      .set('Authorization', authHeader())
      .send({ name: '  Vanguard 401(k)  ', kind: 'retirement', balance: 12345.678 });

    expect(response.status).toBe(201);
    expect(response.body.account).toMatchObject({
      name: 'Vanguard 401(k)',
      type: 'retirement',
      subtype: 'retirement',
      balances: { current: 12345.68 },
      isManual: true,
      isLiability: false,
    });
    expect(response.body.account.account_id).toBe(response.body.account.id);
    expect(response.body.account.id).toBeTruthy();

    const saved = await prisma.account.findUnique({ where: { id: response.body.account.id } });
    expect(saved!.plaidAccountId).toBeNull();
    expect(saved!.plaidItemId).toBeNull();
    expect(saved!.isManual).toBe(true);

    const snapshots = await prisma.balanceSnapshot.findMany({
      where: { accountId: response.body.account.id },
    });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].date.toISOString()).toBe(todayUtc().toISOString());
    expect(snapshots[0].balance).toBe(12345.68);

    await prisma.account.deleteMany({ where: { id: response.body.account.id } });
  });

  it('marks a loan as a liability by default, and lets the user override it', async () => {
    const loan = await request(app)
      .post('/api/accounts/manual')
      .set('Authorization', authHeader())
      .send({ name: 'Car loan', kind: 'loan', balance: 18000 });

    expect(loan.status).toBe(201);
    expect(loan.body.account.isLiability).toBe(true);

    const oddLoan = await request(app)
      .post('/api/accounts/manual')
      .set('Authorization', authHeader())
      .send({ name: 'Not really a loan', kind: 'loan', balance: 100, isLiability: false });

    expect(oddLoan.status).toBe(201);
    expect(oddLoan.body.account.isLiability).toBe(false);

    const asset = await request(app)
      .post('/api/accounts/manual')
      .set('Authorization', authHeader())
      .send({ name: 'House', kind: 'property', balance: 450000 });

    expect(asset.status).toBe(201);
    expect(asset.body.account.isLiability).toBe(false);

    await prisma.account.deleteMany({
      where: {
        id: { in: [loan.body.account.id, oddLoan.body.account.id, asset.body.account.id] },
      },
    });
  });

  it('rejects a bad name, balance, or kind with 400', async () => {
    const cases = [
      { name: '', kind: 'cash', balance: 10 },
      { name: '   ', kind: 'cash', balance: 10 },
      { name: 'x'.repeat(81), kind: 'cash', balance: 10 },
      { name: 'Cash', kind: 'cash', balance: 'lots' },
      { name: 'Cash', kind: 'cash', balance: null },
      { name: 'Cash', kind: 'checking', balance: 10 },
      { name: 'Cash', kind: undefined, balance: 10 },
      { name: 'Cash', kind: 'cash', balance: 10, isLiability: 'yes' },
    ];

    for (const body of cases) {
      const response = await request(app)
        .post('/api/accounts/manual')
        .set('Authorization', authHeader())
        .send(body as any);

      expect(response.status).toBe(400);
      expect(response.body.account).toBeUndefined();
    }
  });

  it('requires authentication', async () => {
    const response = await request(app)
      .post('/api/accounts/manual')
      .send({ name: 'Cash', kind: 'cash', balance: 10 });

    expect(response.status).toBe(401);
  });
});

describe('PUT /api/accounts/manual/:id', () => {
  it('renames the account and changes its kind and liability flag', async () => {
    const account = await createAccount(USER_ID);

    const response = await request(app)
      .put(`/api/accounts/manual/${account.id}`)
      .set('Authorization', authHeader())
      .send({ name: 'Old 401(k)', kind: 'investment', isLiability: true });

    expect(response.status).toBe(200);
    expect(response.body.account).toMatchObject({
      name: 'Old 401(k)',
      type: 'investment',
      subtype: 'investment',
      isLiability: true,
      isManual: true,
    });

    await prisma.account.delete({ where: { id: account.id } });
  });

  it('rejects an invalid kind or name with 400', async () => {
    const account = await createAccount(USER_ID);

    const badKind = await request(app)
      .put(`/api/accounts/manual/${account.id}`)
      .set('Authorization', authHeader())
      .send({ kind: 'checking' });
    expect(badKind.status).toBe(400);

    const badName = await request(app)
      .put(`/api/accounts/manual/${account.id}`)
      .set('Authorization', authHeader())
      .send({ name: '' });
    expect(badName.status).toBe(400);

    await prisma.account.delete({ where: { id: account.id } });
  });
});

describe('POST /api/accounts/manual/:id/balance', () => {
  it('updates the current balance and upserts today\'s snapshot', async () => {
    const account = await createAccount(USER_ID, { currentBalance: 1000 });

    const response = await request(app)
      .post(`/api/accounts/manual/${account.id}/balance`)
      .set('Authorization', authHeader())
      .send({ balance: 1500.444 });

    expect(response.status).toBe(200);
    expect(response.body.account.balances.current).toBe(1500.44);

    const saved = await prisma.account.findUnique({ where: { id: account.id } });
    expect(saved!.currentBalance).toBe(1500.44);

    const snapshots = await prisma.balanceSnapshot.findMany({ where: { accountId: account.id } });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].date.toISOString()).toBe(todayUtc().toISOString());
    expect(snapshots[0].balance).toBe(1500.44);

    // A second update on the same day replaces the snapshot instead of adding one.
    await request(app)
      .post(`/api/accounts/manual/${account.id}/balance`)
      .set('Authorization', authHeader())
      .send({ balance: 1600 });

    const afterSecond = await prisma.balanceSnapshot.findMany({ where: { accountId: account.id } });
    expect(afterSecond).toHaveLength(1);
    expect(afterSecond[0].balance).toBe(1600);

    await prisma.account.delete({ where: { id: account.id } });
  });

  it('back-fills a past snapshot without changing the current balance', async () => {
    const account = await createAccount(USER_ID, { currentBalance: 5000 });
    const pastDate = dayBefore(30);

    const response = await request(app)
      .post(`/api/accounts/manual/${account.id}/balance`)
      .set('Authorization', authHeader())
      .send({ balance: 4200, date: dateOnly(pastDate) });

    expect(response.status).toBe(200);
    expect(response.body.account.balances.current).toBe(5000);

    const saved = await prisma.account.findUnique({ where: { id: account.id } });
    expect(saved!.currentBalance).toBe(5000);

    const snapshots = await prisma.balanceSnapshot.findMany({
      where: { accountId: account.id },
      orderBy: { date: 'asc' },
    });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].date.toISOString()).toBe(pastDate.toISOString());
    expect(snapshots[0].balance).toBe(4200);

    await prisma.account.delete({ where: { id: account.id } });
  });

  it('rejects a future date, a malformed date, and a bad balance with 400', async () => {
    const account = await createAccount(USER_ID);

    const future = await request(app)
      .post(`/api/accounts/manual/${account.id}/balance`)
      .set('Authorization', authHeader())
      .send({ balance: 100, date: dateOnly(dayBefore(-1)) });
    expect(future.status).toBe(400);

    const malformed = await request(app)
      .post(`/api/accounts/manual/${account.id}/balance`)
      .set('Authorization', authHeader())
      .send({ balance: 100, date: '2026-02-30' });
    expect(malformed.status).toBe(400);

    const badBalance = await request(app)
      .post(`/api/accounts/manual/${account.id}/balance`)
      .set('Authorization', authHeader())
      .send({ balance: 'lots' });
    expect(badBalance.status).toBe(400);

    const saved = await prisma.account.findUnique({ where: { id: account.id } });
    expect(saved!.currentBalance).toBe(1000);
    expect(await prisma.balanceSnapshot.count({ where: { accountId: account.id } })).toBe(0);

    await prisma.account.delete({ where: { id: account.id } });
  });
});

describe('GET /api/accounts/manual/:id/history', () => {
  it('returns the snapshots oldest first', async () => {
    const account = await createAccount(USER_ID);
    const earlier = dayBefore(60);
    const later = dayBefore(30);

    await prisma.balanceSnapshot.createMany({
      data: [
        { accountId: account.id, date: later, balance: 3000 },
        { accountId: account.id, date: earlier, balance: 2000 },
      ],
    });

    const response = await request(app)
      .get(`/api/accounts/manual/${account.id}/history`)
      .set('Authorization', authHeader());

    expect(response.status).toBe(200);
    expect(response.body.snapshots).toEqual([
      { date: dateOnly(earlier), balance: 2000 },
      { date: dateOnly(later), balance: 3000 },
    ]);

    await prisma.account.delete({ where: { id: account.id } });
  });
});

describe('DELETE /api/accounts/manual/:id', () => {
  it('deletes the account and its snapshots', async () => {
    const account = await createAccount(USER_ID);
    await prisma.balanceSnapshot.create({
      data: { accountId: account.id, date: todayUtc(), balance: 1000 },
    });

    const response = await request(app)
      .delete(`/api/accounts/manual/${account.id}`)
      .set('Authorization', authHeader());

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
    expect(await prisma.account.findUnique({ where: { id: account.id } })).toBeNull();
    expect(await prisma.balanceSnapshot.count({ where: { accountId: account.id } })).toBe(0);
  });
});

describe('manual account routes and ownership', () => {
  it("returns 404 for another user's manual account", async () => {
    const other = await createAccount(OTHER_USER_ID);

    const update = await request(app)
      .put(`/api/accounts/manual/${other.id}`)
      .set('Authorization', authHeader())
      .send({ name: 'Hijacked' });
    expect(update.status).toBe(404);

    const balance = await request(app)
      .post(`/api/accounts/manual/${other.id}/balance`)
      .set('Authorization', authHeader())
      .send({ balance: 1 });
    expect(balance.status).toBe(404);

    const history = await request(app)
      .get(`/api/accounts/manual/${other.id}/history`)
      .set('Authorization', authHeader());
    expect(history.status).toBe(404);

    const remove = await request(app)
      .delete(`/api/accounts/manual/${other.id}`)
      .set('Authorization', authHeader());
    expect(remove.status).toBe(404);

    // The other user's account is untouched.
    const saved = await prisma.account.findUnique({ where: { id: other.id } });
    expect(saved).not.toBeNull();
    expect(saved!.name).toBe('401(k)');
    expect(saved!.currentBalance).toBe(1000);

    await prisma.account.delete({ where: { id: other.id } });
  });

  it('returns 404 for a Plaid account, which is never editable here', async () => {
    const item = await prisma.plaidItem.create({
      data: {
        userId: USER_ID,
        accessToken: `access-manual-${stamp}`,
        itemId: `plaid-item-manual-${stamp}`,
        institutionId: `ins-manual-${stamp}`,
        institutionName: 'Manual Accounts Bank',
        status: 'ACTIVE',
      },
    });

    const plaidAccount = await prisma.account.create({
      data: {
        plaidAccountId: `acc-plaid-manual-${stamp}`,
        plaidItemId: item.id,
        userId: USER_ID,
        name: 'Plaid Checking',
        type: 'depository',
        subtype: 'checking',
        currentBalance: 250,
        isManual: false,
      },
    });

    const update = await request(app)
      .put(`/api/accounts/manual/${plaidAccount.id}`)
      .set('Authorization', authHeader())
      .send({ name: 'Renamed' });
    expect(update.status).toBe(404);

    const balance = await request(app)
      .post(`/api/accounts/manual/${plaidAccount.id}/balance`)
      .set('Authorization', authHeader())
      .send({ balance: 999 });
    expect(balance.status).toBe(404);

    const history = await request(app)
      .get(`/api/accounts/manual/${plaidAccount.id}/history`)
      .set('Authorization', authHeader());
    expect(history.status).toBe(404);

    const remove = await request(app)
      .delete(`/api/accounts/manual/${plaidAccount.id}`)
      .set('Authorization', authHeader());
    expect(remove.status).toBe(404);

    const saved = await prisma.account.findUnique({ where: { id: plaidAccount.id } });
    expect(saved!.name).toBe('Plaid Checking');
    expect(saved!.currentBalance).toBe(250);

    await prisma.account.delete({ where: { id: plaidAccount.id } });
    await prisma.plaidItem.delete({ where: { id: item.id } });
    expect(anyPlaidCall).not.toHaveBeenCalled();
  });

  it('requires authentication on every manual route', async () => {
    const account = await createAccount(USER_ID);

    const calls = [
      request(app).put(`/api/accounts/manual/${account.id}`).send({ name: 'x' }),
      request(app).post(`/api/accounts/manual/${account.id}/balance`).send({ balance: 1 }),
      request(app).get(`/api/accounts/manual/${account.id}/history`),
      request(app).delete(`/api/accounts/manual/${account.id}`),
    ];

    for (const call of calls) {
      expect((await call).status).toBe(401);
    }

    await prisma.account.delete({ where: { id: account.id } });
  });
});

describe('GET /api/accounts with manual accounts', () => {
  it('includes the database id and the manual and liability flags', async () => {
    const manual = await request(app)
      .post('/api/accounts/manual')
      .set('Authorization', authHeader())
      .send({ name: 'Mortgage', kind: 'loan', balance: 320000 });

    const response = await request(app)
      .get('/api/accounts')
      .set('Authorization', authHeader());

    expect(response.status).toBe(200);
    const listed = response.body.accounts.find((a: any) => a.id === manual.body.account.id);
    expect(listed).toMatchObject({
      id: manual.body.account.id,
      account_id: manual.body.account.id,
      name: 'Mortgage',
      type: 'loan',
      subtype: 'loan',
      isManual: true,
      isLiability: true,
    });

    await prisma.account.delete({ where: { id: manual.body.account.id } });
  });
});
