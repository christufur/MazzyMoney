import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'bun:test';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

import { app } from '../../index';
import { prisma } from '../../lib/prisma';

// W4.2: the rules API. Validation, CRUD and ownership, the dry-run preview, applying a rule to
// rows that already exist (with the user's own category winning), and the from-transaction shortcut.
const stamp = Date.now();
const USER_ID = `rules-user-${stamp}`;
const OTHER_USER_ID = `rules-other-${stamp}`;
const ACCOUNT_ID = `rules-account-${stamp}`;
const OTHER_ACCOUNT_ID = `rules-other-account-${stamp}`;
const SAVINGS_ID = `rules-savings-${stamp}`;

const authHeader = (userId: string = USER_ID) =>
  `Bearer ${jwt.sign({ userId }, process.env.JWT_SECRET!)}`;

const tx = (slug: string, overrides: Record<string, any> = {}) => ({
  id: `rule-tx-${slug}-${stamp}`,
  plaidTransactionId: `rule-plaid-${slug}-${stamp}`,
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
      tx('blue-bottle-1', {
        name: 'SQ *BLUE BOTTLE COFFEE',
        merchantName: 'SQ *BLUE BOTTLE COFFEE',
        amount: 6.5,
        date: new Date('2026-06-10T12:00:00Z'),
        primaryCategory: 'Other',
      }),
      tx('blue-bottle-2', {
        name: 'SQ *BLUE BOTTLE COFFEE',
        merchantName: 'SQ *BLUE BOTTLE COFFEE',
        amount: 4.75,
        date: new Date('2026-06-12T12:00:00Z'),
        primaryCategory: 'Other',
      }),
      // The user chose this category by hand, so a rule must not replace it.
      tx('blue-bottle-user', {
        name: 'SQ *BLUE BOTTLE COFFEE',
        merchantName: 'SQ *BLUE BOTTLE COFFEE',
        amount: 5,
        date: new Date('2026-06-14T12:00:00Z'),
        primaryCategory: 'Entertainment',
        categorySource: 'USER',
      }),
      tx('netflix', {
        name: 'Netflix',
        merchantName: 'Netflix',
        amount: 19.99,
        date: new Date('2026-06-05T12:00:00Z'),
        primaryCategory: 'Entertainment',
      }),
      tx('transfer-out', {
        name: 'Online transfer to savings',
        merchantName: 'Transfer',
        amount: 500,
        date: new Date('2026-06-01T12:00:00Z'),
        accountId: SAVINGS_ID,
        primaryCategory: 'Other',
      }),
      // A row on another user's account with the same merchant text must stay out of every match.
      tx('other-blue-bottle', {
        userId: OTHER_USER_ID,
        accountId: OTHER_ACCOUNT_ID,
        name: 'SQ *BLUE BOTTLE COFFEE',
        merchantName: 'SQ *BLUE BOTTLE COFFEE',
        amount: 7,
        primaryCategory: 'Other',
      }),
    ],
  });
};

async function cleanup() {
  // Only this run's rows: other agents share the test database.
  await prisma.rule.deleteMany({ where: { userId: { in: [USER_ID, OTHER_USER_ID] } } });
  await prisma.transaction.deleteMany({ where: { userId: { in: [USER_ID, OTHER_USER_ID] } } });
  await prisma.account.deleteMany({ where: { userId: { in: [USER_ID, OTHER_USER_ID] } } });
  await prisma.user.deleteMany({ where: { id: { in: [USER_ID, OTHER_USER_ID] } } });
}

beforeAll(async () => {
  await cleanup();
  await prisma.user.createMany({
    data: [
      { id: USER_ID, email: `rules-${stamp}@example.com`, fullName: 'Rules User', passwordHash: 'hash' },
      { id: OTHER_USER_ID, email: `rules-other-${stamp}@example.com`, fullName: 'Rules Other', passwordHash: 'hash' },
    ],
  });
  await prisma.account.createMany({
    data: [
      { id: ACCOUNT_ID, userId: USER_ID, plaidAccountId: `rules-plaid-${stamp}`, name: 'Everyday Checking', type: 'depository', subtype: 'checking' },
      { id: SAVINGS_ID, userId: USER_ID, plaidAccountId: `rules-savings-plaid-${stamp}`, name: 'Savings', type: 'depository', subtype: 'savings' },
      { id: OTHER_ACCOUNT_ID, userId: OTHER_USER_ID, plaidAccountId: `rules-other-plaid-${stamp}`, name: 'Other Checking', type: 'depository', subtype: 'checking' },
    ],
  });
});

beforeEach(async () => {
  await prisma.rule.deleteMany({ where: { userId: { in: [USER_ID, OTHER_USER_ID] } } });
  await prisma.transaction.deleteMany({ where: { userId: { in: [USER_ID, OTHER_USER_ID] } } });
  await seed();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

const post = (path: string, body: unknown, userId = USER_ID) =>
  request(app).post(`/api/rules${path}`).set('Authorization', authHeader(userId)).send(body as any);

const put = (path: string, body: unknown, userId = USER_ID) =>
  request(app).put(`/api/rules${path}`).set('Authorization', authHeader(userId)).send(body as any);

const del = (path: string, userId = USER_ID) =>
  request(app).delete(`/api/rules${path}`).set('Authorization', authHeader(userId));

const list = (userId = USER_ID) =>
  request(app).get('/api/rules').set('Authorization', authHeader(userId));

const rowById = (slug: string) => prisma.transaction.findUnique({ where: { id: `rule-tx-${slug}-${stamp}` } });

describe('POST /api/rules validation', () => {
  it('requires authentication', async () => {
    const response = await request(app).get('/api/rules');
    expect(response.status).toBe(401);
  });

  it('rejects a rule with no condition', async () => {
    const response = await post('/', { setCategory: 'Groceries' });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('at least one condition');
  });

  it('rejects a rule with no action', async () => {
    const response = await post('/', { matchMerchant: 'Netflix' });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('at least one action');
  });

  it('rejects a category that is not on the list', async () => {
    const response = await post('/', { matchMerchant: 'Netflix', setCategory: 'Not A Category' });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('setCategory');
    expect(await prisma.rule.count({ where: { userId: USER_ID } })).toBe(0);
  });

  it('rejects a minimum amount above the maximum', async () => {
    const response = await post('/', {
      matchAmountMin: 50,
      matchAmountMax: 10,
      setCategory: 'Shopping',
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('matchAmountMin');
  });

  it('rejects a negative or non-finite amount', async () => {
    const negative = await post('/', { matchAmountMin: -1, setCategory: 'Shopping' });
    expect(negative.status).toBe(400);

    const junk = await post('/', { matchAmountMax: 'abc', setCategory: 'Shopping' });
    expect(junk.status).toBe(400);
  });

  it("rejects another user's account id", async () => {
    const response = await post('/', {
      matchAccountId: OTHER_ACCOUNT_ID,
      setCategory: 'Groceries',
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('matchAccountId');
    expect(await prisma.rule.count({ where: { userId: USER_ID } })).toBe(0);
  });

  it('rejects a priority outside 0-1000, a long merchant, and a non-boolean flag', async () => {
    const badPriority = await post('/', {
      matchMerchant: 'Netflix',
      setCategory: 'Entertainment',
      priority: 1001,
    });
    expect(badPriority.status).toBe(400);

    const longMatch = await post('/', {
      matchMerchant: 'x'.repeat(101),
      setCategory: 'Entertainment',
    });
    expect(longMatch.status).toBe(400);

    const longRename = await post('/', {
      matchMerchant: 'Netflix',
      setMerchant: 'y'.repeat(81),
    });
    expect(longRename.status).toBe(400);

    const badFlag = await post('/', { matchMerchant: 'Netflix', setHidden: 'yes' });
    expect(badFlag.status).toBe(400);
  });

  it('accepts a valid rule and defaults the priority to 0', async () => {
    const response = await post('/', { matchMerchant: '  Netflix  ', setCategory: 'Entertainment' });

    expect(response.status).toBe(201);
    expect(response.body.rule).toMatchObject({
      priority: 0,
      matchMerchant: 'Netflix',
      setCategory: 'Entertainment',
      setMerchant: null,
      setTransfer: null,
      setHidden: null,
      userId: USER_ID,
    });
    expect(response.body.rule.id).toBeString();
  });

  it('validates the same way on update', async () => {
    const created = await post('/', { matchMerchant: 'Netflix', setCategory: 'Entertainment' });
    const id = created.body.rule.id;

    const noCondition = await put(`/${id}`, { setCategory: 'Groceries' });
    expect(noCondition.status).toBe(400);

    const badCategory = await put(`/${id}`, { matchMerchant: 'Netflix', setCategory: 'Nope' });
    expect(badCategory.status).toBe(400);

    const stillThere = await prisma.rule.findUnique({ where: { id } });
    expect(stillThere?.setCategory).toBe('Entertainment');
  });
});

describe('GET /api/rules', () => {
  it('orders by priority then createdAt and counts the rows each rule matches', async () => {
    const low = await post('/', { matchMerchant: 'Netflix', setCategory: 'Entertainment', priority: 1 });
    const high = await post('/', {
      matchMerchant: 'BLUE BOTTLE',
      setCategory: 'Food & Dining',
      priority: 50,
    });

    expect(low.status).toBe(201);
    expect(high.status).toBe(201);

    const response = await list();

    expect(response.status).toBe(200);
    expect(response.body.rules.map((rule: any) => rule.id)).toEqual([
      high.body.rule.id,
      low.body.rule.id,
    ]);
    // Three rows carry the merchant text; the other user's row never counts.
    expect(response.body.rules[0].matchCount).toBe(3);
    expect(response.body.rules[1].matchCount).toBe(1);
  });

  it('ignores another user\'s rules', async () => {
    await post('/', { matchMerchant: 'Netflix', setCategory: 'Entertainment' }, OTHER_USER_ID);

    const response = await list();
    expect(response.body.rules).toEqual([]);
  });
});

describe('PUT and DELETE /api/rules/:id', () => {
  it('updates the user\'s own rule', async () => {
    const created = await post('/', { matchMerchant: 'Netflix', setCategory: 'Entertainment' });

    const response = await put(`/${created.body.rule.id}`, {
      matchMerchant: 'Netflix',
      setCategory: 'Bills & Utilities',
      priority: 7,
      setHidden: true,
    });

    expect(response.status).toBe(200);
    expect(response.body.rule).toMatchObject({
      setCategory: 'Bills & Utilities',
      priority: 7,
      setHidden: true,
    });
  });

  it('deletes the user\'s own rule', async () => {
    const created = await post('/', { matchMerchant: 'Netflix', setCategory: 'Entertainment' });

    const response = await del(`/${created.body.rule.id}`);

    expect(response.status).toBe(200);
    expect(await prisma.rule.count({ where: { userId: USER_ID } })).toBe(0);
  });

  it('answers 404 for another user\'s rule', async () => {
    const theirs = await post('/', { matchMerchant: 'Netflix', setCategory: 'Entertainment' }, OTHER_USER_ID);
    const id = theirs.body.rule.id;

    expect((await put(`/${id}`, { matchMerchant: 'Netflix', setCategory: 'Groceries' })).status).toBe(404);
    expect((await del(`/${id}`)).status).toBe(404);
    expect((await post(`/${id}/apply`, {})).status).toBe(404);

    const untouched = await prisma.rule.findUnique({ where: { id } });
    expect(untouched?.setCategory).toBe('Entertainment');
  });
});

describe('POST /api/rules/preview', () => {
  it('counts the matches and samples them without writing anything', async () => {
    const response = await post('/preview', { matchMerchant: 'blue bottle', setCategory: 'Food & Dining' });

    expect(response.status).toBe(200);
    expect(response.body.matchCount).toBe(3);
    expect(response.body.sample).toHaveLength(3);
    expect(response.body.sample[0]).toMatchObject({
      name: 'SQ *BLUE BOTTLE COFFEE',
      merchantName: 'SQ *BLUE BOTTLE COFFEE',
      amount: 5,
      primaryCategory: 'Entertainment',
    });
    expect(response.body.sample[0].id).toBeString();
    expect(response.body.sample[0].date).toBeString();

    // Nothing was written: no rule and no row changed.
    expect(await prisma.rule.count({ where: { userId: USER_ID } })).toBe(0);
    expect((await rowById('blue-bottle-1'))?.primaryCategory).toBe('Other');
  });

  it('caps the sample at ten while counting every match', async () => {
    await prisma.transaction.createMany({
      data: Array.from({ length: 12 }, (_, index) =>
        tx(`bulk-${index}`, {
          name: 'Bulk Merchant',
          merchantName: 'Bulk Merchant',
          amount: 1 + index,
          date: new Date(`2026-05-${String(index + 1).padStart(2, '0')}T12:00:00Z`),
        })
      ),
    });

    const response = await post('/preview', { matchMerchant: 'bulk merchant', setCategory: 'Shopping' });

    expect(response.status).toBe(200);
    expect(response.body.matchCount).toBe(12);
    expect(response.body.sample).toHaveLength(10);
  });

  it('validates the draft like create does', async () => {
    const response = await post('/preview', { matchMerchant: 'Netflix' });
    expect(response.status).toBe(400);
    expect(response.body.error).toContain('at least one action');
  });
});

describe('POST /api/rules/:id/apply', () => {
  it('updates matching rows and marks the category as the rule\'s', async () => {
    const created = await post('/', {
      matchMerchant: 'BLUE BOTTLE',
      setCategory: 'Food & Dining',
      setMerchant: 'Blue Bottle Coffee',
    });

    const response = await post(`/${created.body.rule.id}/apply`, {});

    expect(response.status).toBe(200);
    // All three rows get the rename; the USER row keeps its category, so it is counted as skipped.
    expect(response.body).toEqual({ updated: 3, skippedUserCategory: 1 });

    for (const slug of ['blue-bottle-1', 'blue-bottle-2']) {
      const row = await rowById(slug);
      expect(row).toMatchObject({
        primaryCategory: 'Food & Dining',
        categorySource: 'RULE',
        merchantDisplay: 'Blue Bottle Coffee',
      });
    }

    const userRow = await rowById('blue-bottle-user');
    expect(userRow).toMatchObject({
      primaryCategory: 'Entertainment',
      categorySource: 'USER',
      merchantDisplay: 'Blue Bottle Coffee',
    });
  });

  it('leaves a USER category alone but still applies the other actions', async () => {
    const created = await post('/', {
      matchMerchant: 'BLUE BOTTLE',
      setCategory: 'Food & Dining',
      setHidden: true,
    });

    const response = await post(`/${created.body.rule.id}/apply`, {});
    expect(response.status).toBe(200);

    const userRow = await rowById('blue-bottle-user');
    expect(userRow).toMatchObject({
      primaryCategory: 'Entertainment',
      categorySource: 'USER',
      hidden: true,
    });
  });

  it('marks a row as a transfer and gives it the Transfer category', async () => {
    const created = await post('/', {
      matchMerchant: 'Online transfer',
      setTransfer: true,
    });

    const response = await post(`/${created.body.rule.id}/apply`, {});
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ updated: 1, skippedUserCategory: 0 });

    const row = await rowById('transfer-out');
    expect(row).toMatchObject({
      isTransfer: true,
      primaryCategory: 'Transfer',
      // No category action, so the rule does not claim the category.
      categorySource: 'PLAID',
    });
  });

  it('never touches another user\'s rows', async () => {
    const created = await post('/', { matchMerchant: 'BLUE BOTTLE', setCategory: 'Food & Dining' });

    await post(`/${created.body.rule.id}/apply`, {});

    const theirs = await prisma.transaction.findMany({ where: { userId: OTHER_USER_ID } });
    expect(theirs).toHaveLength(1);
    expect(theirs[0].primaryCategory).toBe('Other');
  });

  it('reports zero for a rule that matches nothing', async () => {
    const created = await post('/', { matchMerchant: 'Nobody', setCategory: 'Shopping' });

    const response = await post(`/${created.body.rule.id}/apply`, {});
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ updated: 0, skippedUserCategory: 0 });
  });

  it('matches a merchant with an asterisk without treating it as a pattern', async () => {
    const created = await post('/', { matchMerchant: 'SQ *BLUE BOTTLE', setCategory: 'Food & Dining' });
    const response = await post(`/${created.body.rule.id}/apply`, {});

    expect(response.status).toBe(200);
    expect(response.body.updated).toBe(2);
    expect((await rowById('blue-bottle-1'))?.primaryCategory).toBe('Food & Dining');

    // The asterisk is literal: "SQ XBLUE BOTTLE" is not a match.
    await prisma.transaction.create({
      data: tx('star-lookalike', {
        name: 'SQ XBLUE BOTTLE COFFEE',
        merchantName: 'SQ XBLUE BOTTLE COFFEE',
        primaryCategory: 'Other',
      }),
    });

    const preview = await post('/preview', {
      matchMerchant: 'SQ *BLUE BOTTLE',
      setCategory: 'Food & Dining',
    });
    // Three rows hold the literal text (including the USER row); the lookalike stays out.
    expect(preview.body.matchCount).toBe(3);
  });
});

describe('POST /api/rules/from-transaction', () => {
  it('builds a rule from the transaction merchant and reports the count without applying it', async () => {
    const response = await post('/from-transaction', {
      transactionId: `rule-tx-blue-bottle-1-${stamp}`,
      setCategory: 'Food & Dining',
    });

    expect(response.status).toBe(201);
    expect(response.body.rule).toMatchObject({
      matchMerchant: 'SQ *BLUE BOTTLE COFFEE',
      setCategory: 'Food & Dining',
      priority: 0,
    });
    expect(response.body.matchCount).toBe(3);

    // Nothing was applied: the rows keep their categories until /apply is called.
    expect((await rowById('blue-bottle-1'))?.primaryCategory).toBe('Other');
    expect((await rowById('blue-bottle-1'))?.categorySource).toBe('PLAID');
  });

  it('falls back to the bank description when there is no merchant name', async () => {
    await prisma.transaction.create({
      data: tx('no-merchant', { name: 'CITY PARKING GARAGE', merchantName: null }),
    });

    const response = await post('/from-transaction', {
      transactionId: `rule-tx-no-merchant-${stamp}`,
      setCategory: 'Transportation',
    });

    expect(response.status).toBe(201);
    expect(response.body.rule.matchMerchant).toBe('CITY PARKING GARAGE');
  });

  it('rejects a missing transaction, another user\'s transaction, and a bad category', async () => {
    const missing = await post('/from-transaction', { transactionId: 'nope', setCategory: 'Groceries' });
    expect(missing.status).toBe(404);

    const theirs = await post('/from-transaction', {
      transactionId: `rule-tx-other-blue-bottle-${stamp}`,
      setCategory: 'Groceries',
    });
    expect(theirs.status).toBe(404);

    const badCategory = await post('/from-transaction', {
      transactionId: `rule-tx-blue-bottle-1-${stamp}`,
      setCategory: 'Not A Category',
    });
    expect(badCategory.status).toBe(400);

    expect(await prisma.rule.count({ where: { userId: USER_ID } })).toBe(0);
  });
});
