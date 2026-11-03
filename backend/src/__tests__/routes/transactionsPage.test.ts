import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'bun:test';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

import { app } from '../../index';
import { prisma } from '../../lib/prisma';
import { CATEGORIES } from '../../services/categories';

// W2.6 + W4.1: the Transactions page and its review queue read this route, so the
// filters, the row flags, the bulk edit, and the ownership rule are all pinned here.
const stamp = Date.now();
const USER_ID = `tx-page-user-${stamp}`;
const OTHER_USER_ID = `tx-page-other-${stamp}`;
const ACCOUNT_ID = `tx-page-account-${stamp}`;
const OTHER_ACCOUNT_ID = `tx-page-other-account-${stamp}`;

const authHeader = (userId: string = USER_ID) =>
  `Bearer ${jwt.sign({ userId }, process.env.JWT_SECRET!)}`;

const tx = (slug: string, overrides: Record<string, any> = {}) => ({
  id: `tx-page-${slug}-${stamp}`,
  plaidTransactionId: `tx-page-plaid-${slug}-${stamp}`,
  userId: USER_ID,
  accountId: ACCOUNT_ID,
  name: `Row ${slug}`,
  amount: 20,
  date: new Date('2026-06-15T12:00:00Z'),
  categories: [] as string[],
  ...overrides,
});

const seed = async () => {
  await prisma.transaction.createMany({
    data: [
      tx('groceries', { name: 'Whole Foods Market', merchantName: 'Whole Foods', amount: 100, primaryCategory: 'Groceries' }),
      tx('salary', { name: 'Acme Payroll', merchantName: 'Acme', amount: -2000, primaryCategory: 'Income' }),
      tx('hidden', { name: 'Hidden row', amount: 40, primaryCategory: 'Groceries', hidden: true }),
      tx('transfer', { name: 'To savings', amount: 500, primaryCategory: 'Transfer', isTransfer: true }),
      tx('reviewed', { name: 'Already checked', amount: 10, primaryCategory: 'Shopping', reviewed: true }),
      // Only the notes mention this word: search has to look at notes too.
      tx('noted', { name: 'Corner Shop', merchantName: 'Corner Shop', amount: 12, primaryCategory: 'Shopping', notes: 'split with jordan later' }),
      // A second user's row must never appear in this user's list or bulk edit.
      tx('other', {
        userId: OTHER_USER_ID,
        accountId: OTHER_ACCOUNT_ID,
        name: 'Not mine',
        amount: 999,
        primaryCategory: 'Travel',
      }),
    ],
  });
};

beforeAll(async () => {
  await cleanup();
  await prisma.user.createMany({
    data: [
      { id: USER_ID, email: `tx-page-${stamp}@example.com`, fullName: 'Tx Page User', passwordHash: 'hash' },
      { id: OTHER_USER_ID, email: `tx-page-other-${stamp}@example.com`, fullName: 'Tx Page Other', passwordHash: 'hash' },
    ],
  });
  await prisma.account.createMany({
    data: [
      { id: ACCOUNT_ID, userId: USER_ID, plaidAccountId: `tx-page-plaid-${stamp}`, name: 'Everyday Checking', type: 'depository', subtype: 'checking', mask: '4321' },
      { id: OTHER_ACCOUNT_ID, userId: OTHER_USER_ID, plaidAccountId: `tx-page-other-plaid-${stamp}`, name: 'Other Checking', type: 'depository', subtype: 'checking' },
    ],
  });
});

async function cleanup() {
  // Only this run's rows: other agents share the test database.
  await prisma.transaction.deleteMany({ where: { userId: { in: [USER_ID, OTHER_USER_ID] } } });
  await prisma.account.deleteMany({ where: { userId: { in: [USER_ID, OTHER_USER_ID] } } });
  await prisma.user.deleteMany({ where: { id: { in: [USER_ID, OTHER_USER_ID] } } });
}

beforeEach(async () => {
  await prisma.transaction.deleteMany({ where: { userId: { in: [USER_ID, OTHER_USER_ID] } } });
  await seed();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

const get = (query = '', userId = USER_ID) =>
  request(app).get(`/api/transactions${query}`).set('Authorization', authHeader(userId));

const nameOf = (body: any) => body.transactions.map((entry: any) => entry.name).sort();

describe('GET /api/categories', () => {
  it('returns the single category list for a signed-in user', async () => {
    const response = await request(app)
      .get('/api/categories')
      .set('Authorization', authHeader());

    expect(response.status).toBe(200);
    expect(response.body.categories).toEqual([...CATEGORIES]);
  });

  it('requires authentication', async () => {
    const response = await request(app).get('/api/categories');
    expect(response.status).toBe(401);
  });
});

describe('GET /api/transactions filters', () => {
  it('leaves hidden rows out by default and shows them with includeHidden=true', async () => {
    const visible = await get();
    expect(visible.status).toBe(200);
    expect(nameOf(visible.body)).toEqual([
      'Acme Payroll',
      'Already checked',
      'Corner Shop',
      'To savings',
      'Whole Foods Market',
    ]);
    expect(visible.body.pagination.totalCount).toBe(5);

    const all = await get('?includeHidden=true');
    expect(nameOf(all.body)).toContain('Hidden row');
    expect(all.body.pagination.totalCount).toBe(6);
  });

  it('shows transfers by default and can exclude or isolate them', async () => {
    // The default list is for browsing, so a transfer is still on it.
    expect(nameOf((await get()).body)).toContain('To savings');

    const excluded = await get('?transfers=exclude');
    expect(nameOf(excluded.body)).not.toContain('To savings');

    const only = await get('?transfers=only');
    expect(nameOf(only.body)).toEqual(['To savings']);
  });

  it('filters the review queue with reviewed=false and the reviewed rows with reviewed=true', async () => {
    const needsReview = await get('?reviewed=false');
    expect(needsReview.status).toBe(200);
    expect(nameOf(needsReview.body)).not.toContain('Already checked');
    // Hidden rows are still out: they are not part of the queue.
    expect(nameOf(needsReview.body)).not.toContain('Hidden row');
    expect(needsReview.body.pagination.totalCount).toBe(4);

    const reviewed = await get('?reviewed=true');
    expect(nameOf(reviewed.body)).toEqual(['Already checked']);
  });

  it('searches name, merchant, display name, and notes', async () => {
    const byNote = await get('?search=jordan');
    expect(nameOf(byNote.body)).toEqual(['Corner Shop']);

    const byMerchant = await get('?search=whole');
    expect(nameOf(byMerchant.body)).toEqual(['Whole Foods Market']);

    const byName = await get('?search=payroll');
    expect(nameOf(byName.body)).toEqual(['Acme Payroll']);

    const byDisplay = await get('?search=corner');
    expect(nameOf(byDisplay.body)).toEqual(['Corner Shop']);
  });

  it('filters by category and returns the row flags and account summary', async () => {
    const response = await get('?category=Groceries');

    expect(response.status).toBe(200);
    expect(nameOf(response.body)).toEqual(['Whole Foods Market']);
    expect(response.body.transactions[0]).toMatchObject({
      reviewed: false,
      hidden: false,
      isTransfer: false,
      categorySource: 'PLAID',
      merchantDisplay: null,
      notes: null,
      account: { id: ACCOUNT_ID, name: 'Everyday Checking', mask: '4321', type: 'depository', subtype: 'checking' },
    });
  });

  it('caps limit at 200 and treats a bad page or limit as the default', async () => {
    const capped = await get('?limit=1000');
    expect(capped.status).toBe(200);
    // 6 rows here, so the cap itself is checked against pagination instead of row count.
    expect(capped.body.pagination.currentPage).toBe(1);

    const created = await prisma.transaction.createMany({
      data: Array.from({ length: 205 }, (_, index) =>
        tx(`bulk-${index}`, { name: `Bulk ${index}`, date: new Date('2026-05-01T00:00:00Z') })
      ),
    });
    expect(created.count).toBe(205);

    const overCap = await get('?limit=1000');
    expect(overCap.body.transactions).toHaveLength(200);

    const badPage = await get('?page=0&limit=-5');
    expect(badPage.body.pagination.currentPage).toBe(1);
    expect(badPage.body.transactions).toHaveLength(50);
  });

  it('does not show another user a row', async () => {
    const response = await get('', OTHER_USER_ID);
    expect(nameOf(response.body)).toEqual(['Not mine']);
  });
});

describe('GET /api/transactions/review-count', () => {
  it('counts the rows that still need a review', async () => {
    const response = await request(app)
      .get('/api/transactions/review-count')
      .set('Authorization', authHeader());

    expect(response.status).toBe(200);
    // Five visible rows in total, one already reviewed; the hidden row never counts.
    expect(response.body).toEqual({ count: 4 });
  });
});

describe('PUT /api/transactions/bulk', () => {
  it('updates every listed row and makes a category the user\'s own', async () => {
    const ids = [`tx-page-groceries-${stamp}`, `tx-page-noted-${stamp}`];

    const response = await request(app)
      .put('/api/transactions/bulk')
      .set('Authorization', authHeader())
      .send({ ids, category: 'Food & Dining', reviewed: true });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ updated: 2 });

    const rows = await prisma.transaction.findMany({ where: { id: { in: ids } } });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.primaryCategory).toBe('Food & Dining');
      expect(row.categorySource).toBe('USER');
      expect(row.reviewed).toBe(true);
    }
  });

  it('can hide rows and mark them as transfers', async () => {
    const id = `tx-page-salary-${stamp}`;

    const response = await request(app)
      .put('/api/transactions/bulk')
      .set('Authorization', authHeader())
      .send({ ids: [id], hidden: true, isTransfer: true });

    expect(response.status).toBe(200);

    const row = await prisma.transaction.findUnique({ where: { id } });
    expect(row).toMatchObject({ hidden: true, isTransfer: true, primaryCategory: 'Income' });
    // Only a category change takes ownership of the category.
    expect(row?.categorySource).toBe('PLAID');

    // A hidden row leaves the default list.
    expect(nameOf((await get()).body)).not.toContain('Acme Payroll');
  });

  it('rejects another user\'s id with 403 and changes nothing', async () => {
    const mine = `tx-page-groceries-${stamp}`;
    const theirs = `tx-page-other-${stamp}`;

    const response = await request(app)
      .put('/api/transactions/bulk')
      .set('Authorization', authHeader())
      .send({ ids: [mine, theirs], category: 'Travel' });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'One or more transactions do not belong to you' });

    const rows = await prisma.transaction.findMany({ where: { id: { in: [mine, theirs] } } });
    expect(rows.find(row => row.id === mine)?.primaryCategory).toBe('Groceries');
    expect(rows.find(row => row.id === theirs)?.primaryCategory).toBe('Travel');
  });

  it('rejects a category that is not on the list with 400', async () => {
    const response = await request(app)
      .put('/api/transactions/bulk')
      .set('Authorization', authHeader())
      .send({ ids: [`tx-page-groceries-${stamp}`], category: 'Not A Category' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Unknown category' });

    const row = await prisma.transaction.findUnique({ where: { id: `tx-page-groceries-${stamp}` } });
    expect(row?.primaryCategory).toBe('Groceries');
  });

  it('needs ids and at least one field besides them', async () => {
    const noIds = await request(app)
      .put('/api/transactions/bulk')
      .set('Authorization', authHeader())
      .send({ category: 'Groceries' });
    expect(noIds.status).toBe(400);

    const noFields = await request(app)
      .put('/api/transactions/bulk')
      .set('Authorization', authHeader())
      .send({ ids: [`tx-page-groceries-${stamp}`] });
    expect(noFields.status).toBe(400);

    const tooMany = await request(app)
      .put('/api/transactions/bulk')
      .set('Authorization', authHeader())
      .send({ ids: Array.from({ length: 501 }, (_, index) => `bulk-${index}`), reviewed: true });
    expect(tooMany.status).toBe(400);
  });
});

describe('POST /api/transactions/clean-names', () => {
  const post = (userId: string = USER_ID) =>
    request(app).post('/api/transactions/clean-names').set('Authorization', authHeader(userId));

  it('fills a readable name only on the rows that have neither a merchant nor a display name', async () => {
    await prisma.transaction.createMany({
      data: [
        // Eligible: Plaid sent no merchant name and no rule renamed it.
        tx('raw-memo', {
          name: 'Withdrawal / DAVES HOT CHICKEN 1225 EL PASO TX Date 10/31/26 000000063049441404',
          merchantName: null,
          merchantDisplay: null,
        }),
        tx('raw-ach', {
          name: 'Deposit NTESS, LLC / TYPE: PAYROLL ID: A850097942 CO: NTESS, LLC',
          merchantName: null,
          merchantDisplay: null,
        }),
        // Plaid gave a merchant name: that is the name, not the memo.
        tx('named', { name: 'BLUE BOTTLE 1234', merchantName: 'Blue Bottle Coffee', primaryCategory: 'Food & Dining' }),
        // A rule renamed it, and the household may have edited it: never overwrite.
        tx('renamed', { name: 'Withdrawal / MAVERIK #752', merchantName: null, merchantDisplay: 'Maverik gas' }),
      ],
    });

    const response = await post();

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ updated: 2 });

    const rows = await prisma.transaction.findMany({
      where: { userId: USER_ID, plaidTransactionId: { contains: 'raw-' } },
    });
    expect(rows.map((row) => row.merchantDisplay).sort()).toEqual(['Daves Hot Chicken', 'NTESS']);

    const named = await prisma.transaction.findUnique({
      where: { id: `tx-page-named-${stamp}` },
    });
    expect(named!.merchantDisplay).toBeNull();
    expect(named!.merchantName).toBe('Blue Bottle Coffee');

    const renamed = await prisma.transaction.findUnique({
      where: { id: `tx-page-renamed-${stamp}` },
    });
    expect(renamed!.merchantDisplay).toBe('Maverik gas');
  });

  it('changes nothing on a second run', async () => {
    await prisma.transaction.createMany({
      data: [
        tx('idempotent', {
          name: 'POS PURCHASE STARBUCKS 4412',
          merchantName: null,
          merchantDisplay: null,
        }),
      ],
    });

    expect((await post()).body).toEqual({ updated: 1 });
    expect((await post()).body).toEqual({ updated: 0 });
  });

  it("never touches another user's rows", async () => {
    await prisma.transaction.createMany({
      data: [
        tx('mine-memo', {
          name: 'Withdrawal / APPLE CASH SENT MONEY 1INFINITELOOP CA Date 10/31/26 0000000630',
          merchantName: null,
          merchantDisplay: null,
        }),
        tx('theirs-memo', {
          userId: OTHER_USER_ID,
          accountId: OTHER_ACCOUNT_ID,
          name: 'Withdrawal / APPLE CASH SENT MONEY 1INFINITELOOP CA Date 10/31/26 0000000630',
          merchantName: null,
          merchantDisplay: null,
        }),
      ],
    });

    const response = await post();
    expect(response.body).toEqual({ updated: 1 });

    const theirs = await prisma.transaction.findUnique({
      where: { id: `tx-page-theirs-memo-${stamp}` },
    });
    expect(theirs!.merchantDisplay).toBeNull();
  });

  it('requires authentication', async () => {
    const response = await request(app).post('/api/transactions/clean-names');
    expect(response.status).toBe(401);
  });
});

describe('PUT /api/transactions/:id', () => {
  it('marks one row reviewed', async () => {
    const id = `tx-page-groceries-${stamp}`;

    const response = await request(app)
      .put(`/api/transactions/${id}`)
      .set('Authorization', authHeader())
      .send({ reviewed: true });

    expect(response.status).toBe(200);
    expect(response.body.transaction).toMatchObject({ id, reviewed: true });
    expect((await get('/review-count')).body).toEqual({ count: 3 });
  });

  it('does not update another user\'s row', async () => {
    const response = await request(app)
      .put(`/api/transactions/tx-page-other-${stamp}`)
      .set('Authorization', authHeader())
      .send({ reviewed: true });

    expect(response.status).toBe(404);
  });

  it('keeps the notes route at 500 characters and the category route validated', async () => {
    const id = `tx-page-groceries-${stamp}`;

    const tooLong = await request(app)
      .put(`/api/transactions/${id}/notes`)
      .set('Authorization', authHeader())
      .send({ notes: 'x'.repeat(501) });
    expect(tooLong.status).toBe(400);

    const okNotes = await request(app)
      .put(`/api/transactions/${id}/notes`)
      .set('Authorization', authHeader())
      .send({ notes: 'x'.repeat(500) });
    expect(okNotes.status).toBe(200);

    const badCategory = await request(app)
      .put(`/api/transactions/${id}/category`)
      .set('Authorization', authHeader())
      .send({ category: 'Not A Category' });
    expect(badCategory.status).toBe(400);

    const goodCategory = await request(app)
      .put(`/api/transactions/${id}/category`)
      .set('Authorization', authHeader())
      .send({ category: 'Pets' });
    expect(goodCategory.status).toBe(200);
    expect(goodCategory.body.transaction).toMatchObject({ id, primaryCategory: 'Pets' });

    const row = await prisma.transaction.findUnique({ where: { id } });
    expect(row?.categorySource).toBe('USER');
  });
});
