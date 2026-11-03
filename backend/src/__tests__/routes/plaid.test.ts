import { describe, it, expect, beforeAll, afterEach, afterAll, mock } from 'bun:test';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

const ITEM_LIMIT = 10;

// Unique per run: the test database is shared with other agents, and plaidAccountId/itemId are unique.
const stamp = Date.now();
const CHECKING_ACCOUNT_ID = `acc-checking-${stamp}`;
const CREDIT_ACCOUNT_ID = `acc-credit-${stamp}`;
const NEW_PLAID_ITEM_ID = `plaid-item-new-${stamp}`;

const linkTokenCreate = mock(async (_args: any) => ({ data: { link_token: 'link-sandbox-token' } }));
const itemPublicTokenExchange = mock(async (_args: any) => ({
  data: { access_token: `access-new-${stamp}`, item_id: NEW_PLAID_ITEM_ID },
}));
const itemGet = mock(async (_args: any) => ({ data: { item: { institution_id: 'ins_test' } } }));
const institutionsGetById = mock(async (_args: any) => ({
  data: { institution: { name: 'Test Bank' } },
}));
const itemRemove = mock(async (_args: any) => ({ data: { removed: true } }));

const accountsGet = mock(async (_args: any) => ({
  data: {
    accounts: [
      {
        account_id: CHECKING_ACCOUNT_ID,
        name: 'Everyday Checking',
        official_name: 'Everyday Checking Account',
        type: 'depository',
        subtype: 'checking',
        mask: '1111',
        balances: { current: 1200.5, available: 1100.25, limit: null },
      },
      {
        account_id: CREDIT_ACCOUNT_ID,
        name: 'Travel Card',
        official_name: null,
        type: 'credit',
        subtype: 'credit card',
        mask: '2222',
        balances: { current: 250, available: 750, limit: 1000 },
      },
    ],
  },
}));

// The exchange route starts the first transaction sync in the background (W2.3), so this fake
// must answer it: one empty page means "nothing new" and the Item settles back to ACTIVE.
const transactionsSync = mock(async (_args: any) => ({
  data: { added: [], modified: [], removed: [], next_cursor: '', has_more: false },
}));

// No real network calls: every test uses this fake through lib/plaid.
mock.module('../../lib/plaid', () => ({
  plaidClient: {
    linkTokenCreate,
    itemPublicTokenExchange,
    itemGet,
    institutionsGetById,
    accountsGet,
    itemRemove,
    transactionsSync,
  },
  ITEM_LIMIT,
  plaidErrorCode: (err: any) => err?.response?.data?.error_code,
}));

// Bun hoists mock.module above the imports, so the app below already uses the fake.
import { app } from '../../index';
import { prisma } from '../../lib/prisma';

const USER_ID = `plaid-route-user-${stamp}`;
const OTHER_USER_ID = `plaid-route-other-${stamp}`;

const authHeader = (userId = USER_ID) =>
  `Bearer ${jwt.sign({ userId }, process.env.JWT_SECRET!)}`;

const createUser = (id: string, email: string) =>
  prisma.user.create({
    data: { id, email, fullName: 'Plaid Test User', passwordHash: 'hash' },
  });

const createItem = (data: { userId?: string; institutionId: string; suffix: string }) =>
  prisma.plaidItem.create({
    data: {
      userId: data.userId ?? USER_ID,
      accessToken: `access-${data.suffix}`,
      itemId: `plaid-item-${data.suffix}-${stamp}`,
      institutionId: data.institutionId,
      institutionName: `Bank ${data.suffix}`,
      status: 'ACTIVE',
    },
  });

const deleteMyItems = () =>
  prisma.plaidItem.deleteMany({
    where: { userId: { in: [USER_ID, OTHER_USER_ID] } },
  });

/** The exchange starts the first sync in the background; wait for the mocks to finish. */
const waitForSyncToSettle = async (itemId: string) => {
  for (let attempt = 0; attempt < 250; attempt++) {
    const item = await prisma.plaidItem.findUnique({ where: { id: itemId } });
    if (item && item.status !== 'SYNCING') return item;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Plaid item ${itemId} stayed in SYNCING`);
};

describe('Plaid connections API', () => {
  beforeAll(async () => {
    await prisma.plaidItem.deleteMany({
      where: { userId: { in: [USER_ID, OTHER_USER_ID] } },
    });
    await prisma.user.deleteMany({ where: { id: { in: [USER_ID, OTHER_USER_ID] } } });
    await createUser(USER_ID, `plaid-route-${stamp}@example.com`);
    await createUser(OTHER_USER_ID, `plaid-route-other-${stamp}@example.com`);
  });

  afterEach(async () => {
    await prisma.account.deleteMany({
      where: { userId: { in: [USER_ID, OTHER_USER_ID] } },
    });
    await deleteMyItems();
    linkTokenCreate.mockClear();
    itemPublicTokenExchange.mockClear();
    itemGet.mockClear();
    institutionsGetById.mockClear();
    accountsGet.mockClear();
    itemRemove.mockClear();
  });

  afterAll(async () => {
    await prisma.account.deleteMany({
      where: { userId: { in: [USER_ID, OTHER_USER_ID] } },
    });
    await deleteMyItems();
    await prisma.user.deleteMany({ where: { id: { in: [USER_ID, OTHER_USER_ID] } } });
    await prisma.$disconnect();
  });

  it('creates a transactions-only link token for a new connection', async () => {
    // The 10-Item limit is server-wide, so another agent's rows can fill this shared DB.
    if ((await prisma.plaidItem.count()) >= ITEM_LIMIT) {
      console.warn('Skipping new-connection link token check: the test DB is already at ITEM_LIMIT');
      return;
    }

    const response = await request(app)
      .post('/api/plaid/link-token')
      .set('Authorization', authHeader())
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.link_token).toBe('link-sandbox-token');

    const args = linkTokenCreate.mock.calls[0][0] as any;
    expect(args.products).toEqual(['transactions']);
    expect(args.client_name).toBe('Mazzy Money');
    expect(args.access_token).toBeUndefined();
    expect(args.user.client_user_id).toBe(USER_ID);
  });

  it('returns 409 ITEM_LIMIT when the server already has 10 items', async () => {
    const existing = await prisma.plaidItem.count();
    const missing = Math.max(0, ITEM_LIMIT - existing);

    for (let i = 0; i < missing; i++) {
      await createItem({ institutionId: `ins-filler-${stamp}-${i}`, suffix: `filler-${i}` });
    }

    expect(await prisma.plaidItem.count()).toBeGreaterThanOrEqual(ITEM_LIMIT);

    const response = await request(app)
      .post('/api/plaid/link-token')
      .set('Authorization', authHeader())
      .send({});

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('ITEM_LIMIT');
    expect(linkTokenCreate).not.toHaveBeenCalled();
  });

  it('uses update mode with the access token and no products', async () => {
    const item = await createItem({ institutionId: `ins-update-${stamp}`, suffix: 'update' });

    const response = await request(app)
      .post('/api/plaid/link-token')
      .set('Authorization', authHeader())
      .send({ itemId: item.id });

    expect(response.status).toBe(200);
    expect(response.body.link_token).toBe('link-sandbox-token');

    const args = linkTokenCreate.mock.calls[0][0] as any;
    expect(args.access_token).toBe(item.accessToken);
    expect(args.products).toBeUndefined();
  });

  it("returns 404 for another user's item in update mode", async () => {
    const item = await createItem({
      userId: OTHER_USER_ID,
      institutionId: `ins-other-${stamp}`,
      suffix: 'other',
    });

    const response = await request(app)
      .post('/api/plaid/link-token')
      .set('Authorization', authHeader())
      .send({ itemId: item.id });

    expect(response.status).toBe(404);
    expect(linkTokenCreate).not.toHaveBeenCalled();
  });

  it('requires a public token to exchange', async () => {
    const response = await request(app)
      .post('/api/plaid/exchange')
      .set('Authorization', authHeader())
      .send({});

    expect(response.status).toBe(400);
    expect(itemPublicTokenExchange).not.toHaveBeenCalled();
  });

  it('exchanges a public token into one item and its accounts', async () => {
    const response = await request(app)
      .post('/api/plaid/exchange')
      .set('Authorization', authHeader())
      .send({ public_token: 'public-sandbox-token' });

    expect(response.status).toBe(200);
    expect(response.body.item).toEqual({
      id: expect.any(String),
      institutionName: 'Test Bank',
      status: 'ACTIVE',
    });
    expect(response.body.item.accessToken).toBeUndefined();

    // The item starts ACTIVE, so wait for the background sync to begin before waiting for it to end.
    for (let attempt = 0; attempt < 250 && accountsGet.mock.calls.length < 2; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const item = await waitForSyncToSettle(response.body.item.id);
    expect(item.accessToken).toBe(`access-new-${stamp}`);
    expect(item.itemId).toBe(NEW_PLAID_ITEM_ID);
    expect(item.institutionId).toBe('ins_test');
    expect(item.status).toBe('ACTIVE');

    const accounts = await prisma.account.findMany({
      where: { userId: USER_ID },
      orderBy: { plaidAccountId: 'asc' },
    });
    expect(accounts).toHaveLength(2);
    expect(accounts[0]).toMatchObject({
      plaidAccountId: CHECKING_ACCOUNT_ID,
      plaidItemId: item!.id,
      name: 'Everyday Checking',
      currentBalance: 1200.5,
      isLiability: false,
      isActive: true,
    });
    expect(accounts[1]).toMatchObject({
      plaidAccountId: CREDIT_ACCOUNT_ID,
      plaidItemId: item!.id,
      currentBalance: 250,
      creditLimit: 1000,
      isLiability: true,
    });
    // The exchange calls accountsGet itself, and the first sync calls it once more (W2.3).
    expect(accountsGet).toHaveBeenCalledTimes(2);
  });

  it('rejects a second item for the same institution and removes it at Plaid', async () => {
    await createItem({ institutionId: 'ins_dup', suffix: 'dup-existing' });
    itemGet.mockImplementationOnce(async (_args: any) => ({
      data: { item: { institution_id: 'ins_dup' } },
    }));

    const response = await request(app)
      .post('/api/plaid/exchange')
      .set('Authorization', authHeader())
      .send({ public_token: 'public-duplicate' });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('DUPLICATE_INSTITUTION');
    expect(itemRemove).toHaveBeenCalledWith({ access_token: `access-new-${stamp}` });

    const items = await prisma.plaidItem.findMany({
      where: { userId: USER_ID, institutionId: 'ins_dup' },
    });
    expect(items).toHaveLength(1);
  });

  it('removes the new item at Plaid when the exchange fails before it is saved', async () => {
    institutionsGetById.mockImplementationOnce(async () => {
      throw new Error('institution lookup failed');
    });

    const response = await request(app)
      .post('/api/plaid/exchange')
      .set('Authorization', authHeader())
      .send({ public_token: 'public-fails' });

    expect(response.status).toBe(500);
    expect(itemRemove).toHaveBeenCalledWith({ access_token: `access-new-${stamp}` });
    expect(await prisma.plaidItem.count({ where: { itemId: NEW_PLAID_ITEM_ID } })).toBe(0);
  });

  it('lists items with accounts, usage, and never the access token', async () => {
    const item = await createItem({ institutionId: `ins-list-${stamp}`, suffix: 'list' });
    await prisma.account.create({
      data: {
        plaidAccountId: `acc-list-${stamp}`,
        userId: USER_ID,
        plaidItemId: item.id,
        name: 'Savings',
        type: 'depository',
        subtype: 'savings',
        mask: '3333',
        currentBalance: 42,
      },
    });

    const response = await request(app)
      .get('/api/plaid/items')
      .set('Authorization', authHeader());

    expect(response.status).toBe(200);
    expect(response.body.limit).toBe(ITEM_LIMIT);
    expect(response.body.used).toBe(await prisma.plaidItem.count());
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0]).toMatchObject({
      id: item.id,
      institutionName: 'Bank list',
      status: 'ACTIVE',
      lastSyncAt: null,
      lastError: null,
      accounts: [
        { id: expect.any(String), name: 'Savings', mask: '3333', type: 'depository', subtype: 'savings' },
      ],
    });
    expect(JSON.stringify(response.body)).not.toContain(item.accessToken);
  });

  it("does not list another user's items", async () => {
    await createItem({
      userId: OTHER_USER_ID,
      institutionId: `ins-hidden-${stamp}`,
      suffix: 'hidden',
    });

    const response = await request(app)
      .get('/api/plaid/items')
      .set('Authorization', authHeader());

    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(0);
  });

  it('deletes an item and its accounts after removing it at Plaid', async () => {
    const item = await createItem({ institutionId: `ins-delete-${stamp}`, suffix: 'delete' });
    await prisma.account.create({
      data: {
        plaidAccountId: `acc-delete-${stamp}`,
        userId: USER_ID,
        plaidItemId: item.id,
        name: 'Checking',
        type: 'depository',
        subtype: 'checking',
        currentBalance: 10,
      },
    });

    const response = await request(app)
      .delete(`/api/plaid/items/${item.id}`)
      .set('Authorization', authHeader());

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
    expect(itemRemove).toHaveBeenCalledWith({ access_token: item.accessToken });
    expect(await prisma.plaidItem.findUnique({ where: { id: item.id } })).toBeNull();
    expect(await prisma.account.count({ where: { userId: USER_ID } })).toBe(0);
  });

  it('still deletes the row when Plaid says ITEM_NOT_FOUND', async () => {
    const item = await createItem({ institutionId: `ins-gone-${stamp}`, suffix: 'gone' });
    itemRemove.mockImplementationOnce(async () => {
      throw { response: { data: { error_code: 'ITEM_NOT_FOUND' } } };
    });

    const response = await request(app)
      .delete(`/api/plaid/items/${item.id}`)
      .set('Authorization', authHeader());

    expect(response.status).toBe(200);
    expect(await prisma.plaidItem.findUnique({ where: { id: item.id } })).toBeNull();
  });

  it('keeps the row when Plaid fails to remove the item', async () => {
    const item = await createItem({ institutionId: `ins-fail-${stamp}`, suffix: 'fail' });
    itemRemove.mockImplementationOnce(async () => {
      throw { response: { data: { error_code: 'INVALID_ACCESS_TOKEN' } } };
    });

    const response = await request(app)
      .delete(`/api/plaid/items/${item.id}`)
      .set('Authorization', authHeader());

    expect(response.status).toBe(502);
    expect(await prisma.plaidItem.findUnique({ where: { id: item.id } })).not.toBeNull();
  });

  it("returns 404 when deleting another user's item", async () => {
    const item = await createItem({
      userId: OTHER_USER_ID,
      institutionId: `ins-foreign-${stamp}`,
      suffix: 'foreign',
    });

    const response = await request(app)
      .delete(`/api/plaid/items/${item.id}`)
      .set('Authorization', authHeader());

    expect(response.status).toBe(404);
    expect(itemRemove).not.toHaveBeenCalled();
    expect(await prisma.plaidItem.findUnique({ where: { id: item.id } })).not.toBeNull();
  });

  it('requires authentication', async () => {
    const response = await request(app).get('/api/plaid/items');
    expect(response.status).toBe(401);
  });
});
