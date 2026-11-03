import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, mock } from 'bun:test';

process.env.NODE_ENV = 'test';

// The test database is shared with other agents, so every row this file makes carries `stamp`
// and cleanup only ever targets ids it created. No real network calls: lib/plaid is faked.
const stamp = Date.now();
const USER_ID = `sync-user-${stamp}`;
const OTHER_USER_ID = `sync-other-${stamp}`;
const CHECKING_ID = `sync-checking-${stamp}`;
const SAVINGS_ID = `sync-savings-${stamp}`;
const ITEM_ID = `sync-item-${stamp}`;
const OTHER_ITEM_ID = `sync-other-item-${stamp}`;

type FakeCall = { page: number; cursor?: string };

type FakePage = {
  data: { added: any[]; modified: any[]; removed: any[]; next_cursor: string; has_more: boolean };
};

const transactionsSync = mock(async (_args: any): Promise<FakePage> => ({ data: emptyPage('') }));
const accountsGet = mock(
  async (_args: any): Promise<{ data: { accounts: any[] } }> => ({
    data: { accounts: [checkingAccount(), savingsAccount()] },
  })
);

mock.module('../../lib/plaid', () => ({
  plaidClient: {
    transactionsSync,
    accountsGet,
  },
  ITEM_LIMIT: 10,
  plaidErrorCode: (err: any) => err?.response?.data?.error_code,
}));

// Bun hoists mock.module above the imports, so the service below already uses the fake.
import { prisma } from '../../lib/prisma';
import { TransactionSyncService } from '../../services/transactionSyncService';

function emptyPage(nextCursor: string, hasMore = false) {
  return {
    added: [],
    modified: [],
    removed: [],
    next_cursor: nextCursor,
    has_more: hasMore,
  };
}

function checkingAccount() {
  return {
    account_id: CHECKING_ID,
    name: 'Everyday Checking',
    official_name: 'Everyday Checking Account',
    type: 'depository',
    subtype: 'checking',
    mask: '1111',
    balances: { current: 1200.5, available: 1100.25, limit: null },
  };
}

function savingsAccount() {
  return {
    account_id: SAVINGS_ID,
    name: 'Savings',
    official_name: null,
    type: 'depository',
    subtype: 'savings',
    mask: '2222',
    balances: { current: 5000, available: 5000, limit: null },
  };
}

function plaidTransaction(overrides: Record<string, any> = {}) {
  return {
    transaction_id: `plaid-tx-${stamp}-1`,
    account_id: CHECKING_ID,
    amount: 12.34,
    date: '2026-10-30',
    authorized_date: '2026-10-29',
    name: 'BLUE BOTTLE COFFEE',
    merchant_name: 'Blue Bottle Coffee',
    pending: false,
    pending_transaction_id: null,
    category: ['Food and Drink', 'Coffee'],
    personal_finance_category: {
      primary: 'FOOD_AND_DRINK',
      detailed: 'FOOD_AND_DRINK_COFFEE',
    },
    location: { city: 'Denver', region: 'CO', country: 'US' },
    ...overrides,
  };
}

/** One call per page. `pages` are returned in order; the last one is repeated. */
function queuedPages(pages: Array<{ added?: any[]; modified?: any[]; removed?: any[]; next: string; has_more?: boolean }>) {
  const calls: FakeCall[] = [];
  let index = 0;

  transactionsSync.mockImplementation(async (args: any): Promise<FakePage> => {
    calls.push({ page: index + 1, cursor: args.cursor });
    const page = pages[Math.min(index, pages.length - 1)];
    index++;

    return {
      data: {
        added: page.added ?? [],
        modified: page.modified ?? [],
        removed: page.removed ?? [],
        next_cursor: page.next,
        has_more: page.has_more ?? false,
      },
    };
  });

  return calls;
}

const cleanup = async () => {
  const userIds = [USER_ID, OTHER_USER_ID];
  await prisma.transaction.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.balanceSnapshot.deleteMany({ where: { account: { userId: { in: userIds } } } });
  await prisma.rule.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.account.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.plaidItem.deleteMany({ where: { userId: { in: userIds } } });
};

const createItem = (overrides: Record<string, any> = {}) =>
  prisma.plaidItem.create({
    data: {
      id: ITEM_ID,
      userId: USER_ID,
      accessToken: `access-${ITEM_ID}`,
      itemId: `plaid-item-id-${ITEM_ID}`,
      institutionId: `ins-${ITEM_ID}`,
      institutionName: 'Test Bank',
      status: 'ACTIVE',
      ...overrides,
    },
  });

const accountIdOf = async (plaidAccountId: string) => {
  const account = await prisma.account.findUnique({ where: { plaidAccountId } });
  return account!.id;
};

/** Accounts normally appear on the first sync; tests that pre-seed rows need them earlier. */
const seedAccounts = async () => {
  await prisma.account.create({
    data: {
      plaidAccountId: CHECKING_ID,
      plaidItemId: ITEM_ID,
      userId: USER_ID,
      name: 'Everyday Checking',
      type: 'depository',
      subtype: 'checking',
      mask: '1111',
      currentBalance: 1200.5,
    },
  });
  await prisma.account.create({
    data: {
      plaidAccountId: SAVINGS_ID,
      plaidItemId: ITEM_ID,
      userId: USER_ID,
      name: 'Savings',
      type: 'depository',
      subtype: 'savings',
      mask: '2222',
      currentBalance: 5000,
    },
  });
};

describe('TransactionSyncService', () => {
  beforeAll(async () => {
    await cleanup();
    await prisma.user.deleteMany({ where: { id: { in: [USER_ID, OTHER_USER_ID] } } });
    await prisma.user.create({
      data: { id: USER_ID, email: `sync-${stamp}@example.com`, fullName: 'Sync User', passwordHash: 'hash' },
    });
    await prisma.user.create({
      data: {
        id: OTHER_USER_ID,
        email: `sync-other-${stamp}@example.com`,
        fullName: 'Other User',
        passwordHash: 'hash',
      },
    });
  });

  beforeEach(async () => {
    await cleanup();
    transactionsSync.mockReset();
    transactionsSync.mockImplementation(async (_args: any) => ({ data: emptyPage('') }));
    accountsGet.mockReset();
    accountsGet.mockImplementation(async (_args: any) => ({
      data: { accounts: [checkingAccount(), savingsAccount()] },
    }));
    await createItem();
  });

  afterEach(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.user.deleteMany({ where: { id: { in: [USER_ID, OTHER_USER_ID] } } });
    await prisma.$disconnect();
  });

  it('pulls every page, saves the rows and the cursor, and snapshots each balance', async () => {
    const calls = queuedPages([
      {
        added: [
          plaidTransaction({ transaction_id: `sync-a-${stamp}`, amount: 12.345 }),
          plaidTransaction({ transaction_id: `sync-b-${stamp}`, account_id: SAVINGS_ID, amount: -5 }),
        ],
        next: 'cursor-1',
        has_more: true,
      },
      {
        added: [plaidTransaction({ transaction_id: `sync-c-${stamp}`, amount: 99.999 })],
        next: 'cursor-2',
      },
    ]);

    const result = await TransactionSyncService.syncItem(ITEM_ID);

    expect(result).toEqual({ success: true, added: 3, modified: 0, removed: 0 });

    // Two pages: the second starts from the first cursor, the first from the saved (empty) one.
    expect(calls).toHaveLength(2);
    expect(calls[0].cursor).toBeUndefined();
    expect(calls[1].cursor).toBe('cursor-1');
    expect(transactionsSync.mock.calls[0][0].count).toBe(500);

    const saved = await prisma.transaction.findMany({ where: { userId: USER_ID }, orderBy: { plaidTransactionId: 'asc' } });
    expect(saved).toHaveLength(3);
    expect(saved[0]).toMatchObject({
      name: 'BLUE BOTTLE COFFEE',
      merchantName: 'Blue Bottle Coffee',
      pfcPrimary: 'FOOD_AND_DRINK',
      pfcDetailed: 'FOOD_AND_DRINK_COFFEE',
      detailedCategory: 'FOOD_AND_DRINK_COFFEE',
      categories: ['Food and Drink', 'Coffee'],
      city: 'Denver',
      region: 'CO',
      country: 'US',
      pending: false,
      categorySource: 'PLAID',
    });
    // Amounts are rounded to cents, dates are stored as UTC midnight.
    expect(saved[0].amount).toBe(12.35);
    expect(saved[1].amount).toBe(-5);
    expect(saved[2].amount).toBe(100);
    expect(saved[0].date.toISOString()).toBe('2026-10-30T00:00:00.000Z');
    expect(saved[0].authorizedDate!.toISOString()).toBe('2026-10-29T00:00:00.000Z');

    const item = await prisma.plaidItem.findUnique({ where: { id: ITEM_ID } });
    expect(item!.cursor).toBe('cursor-2');
    expect(item!.status).toBe('ACTIVE');
    expect(item!.lastSyncAt).not.toBeNull();
    expect(item!.lastError).toBeNull();

    // One snapshot per account, for today (UTC).
    const snapshots = await prisma.balanceSnapshot.findMany({
      where: { accountId: { in: [await accountIdOf(CHECKING_ID), await accountIdOf(SAVINGS_ID)] } },
    });
    expect(snapshots).toHaveLength(2);
    const { householdDay } = await import('../../services/notifyService');
    const expectedDate = householdDay();
    expect(snapshots[0].date.toISOString()).toBe(expectedDate.toISOString());
    expect(snapshots.map((s) => s.balance).sort()).toEqual([1200.5, 5000]);
  });

  it('marks a TRANSFER_IN as a transfer in the Transfer category', async () => {
    queuedPages([
      {
        added: [
          plaidTransaction({
            transaction_id: `sync-transfer-${stamp}`,
            amount: 800,
            name: 'Transfer from savings',
            merchant_name: 'Transfer',
            personal_finance_category: { primary: 'TRANSFER_IN', detailed: 'TRANSFER_IN_ACCOUNT_TRANSFER' },
          }),
        ],
        next: 'cursor-transfer',
      },
    ]);

    await TransactionSyncService.syncItem(ITEM_ID);

    const saved = await prisma.transaction.findUnique({
      where: { plaidTransactionId: `sync-transfer-${stamp}` },
    });
    expect(saved!.isTransfer).toBe(true);
    expect(saved!.primaryCategory).toBe('Transfer');
    expect(saved!.categorySource).toBe('PLAID');
  });

  it('adds history older than 14 days as already reviewed, recent rows as needing review', async () => {
    const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
    queuedPages([
      {
        added: [
          plaidTransaction({ transaction_id: `sync-old-${stamp}`, date: daysAgo(60) }),
          plaidTransaction({ transaction_id: `sync-new-${stamp}`, date: daysAgo(2) }),
        ],
        next: 'cursor-review-window',
      },
    ]);

    await TransactionSyncService.syncItem(ITEM_ID);

    const old = await prisma.transaction.findUnique({ where: { plaidTransactionId: `sync-old-${stamp}` } });
    const recent = await prisma.transaction.findUnique({ where: { plaidTransactionId: `sync-new-${stamp}` } });
    expect(old!.reviewed).toBe(true);
    expect(recent!.reviewed).toBe(false);
  });

  it('applies a user rule and records the RULE category source', async () => {
    await prisma.rule.create({
      data: {
        userId: USER_ID,
        priority: 5,
        matchMerchant: 'blue bottle',
        setCategory: 'Groceries',
        setMerchant: 'Blue Bottle Coffee',
      },
    });

    queuedPages([
      { added: [plaidTransaction({ transaction_id: `sync-rule-${stamp}` })], next: 'cursor-rule' },
    ]);

    await TransactionSyncService.syncItem(ITEM_ID);

    const saved = await prisma.transaction.findUnique({
      where: { plaidTransactionId: `sync-rule-${stamp}` },
    });
    expect(saved!.primaryCategory).toBe('Groceries');
    expect(saved!.categorySource).toBe('RULE');
  });

  it('replaces the pending row with the posted row and keeps notes, review, and the USER category', async () => {
    await seedAccounts();
    const accountId = await accountIdOf(CHECKING_ID);
    const pendingId = `sync-pending-${stamp}`;
    const postedId = `sync-posted-${stamp}`;

    await prisma.transaction.create({
      data: {
        plaidTransactionId: pendingId,
        userId: USER_ID,
        accountId,
        name: 'PENDING COFFEE',
        amount: 12.34,
        date: new Date('2026-10-29'),
        pending: true,
        categories: [],
        primaryCategory: 'Groceries',
        categorySource: 'USER',
        notes: 'keep me',
        reviewed: true,
      },
    });

    queuedPages([
      {
        added: [
          plaidTransaction({
            transaction_id: postedId,
            amount: 12.4,
            pending: false,
            pending_transaction_id: pendingId,
          }),
        ],
        next: 'cursor-posted',
      },
    ]);

    await TransactionSyncService.syncItem(ITEM_ID);

    const rows = await prisma.transaction.findMany({
      where: { plaidTransactionId: { in: [pendingId, postedId] } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].plaidTransactionId).toBe(postedId);
    expect(rows[0].notes).toBe('keep me');
    expect(rows[0].reviewed).toBe(true);
    expect(rows[0].primaryCategory).toBe('Groceries');
    expect(rows[0].categorySource).toBe('USER');
    expect(rows[0].pending).toBe(false);
    expect(rows[0].amount).toBe(12.4);
  });

  it('updates a modified USER row without touching its category, and re-categorises a PLAID row', async () => {
    await seedAccounts();
    const accountId = await accountIdOf(CHECKING_ID);
    const userTxId = `sync-mod-user-${stamp}`;
    const plaidTxId = `sync-mod-plaid-${stamp}`;

    await prisma.transaction.create({
      data: {
        plaidTransactionId: userTxId,
        userId: USER_ID,
        accountId,
        name: 'OLD NAME',
        amount: 10,
        date: new Date('2026-10-01'),
        categories: [],
        primaryCategory: 'Shopping',
        categorySource: 'USER',
        notes: 'mine',
        reviewed: true,
      },
    });

    await prisma.transaction.create({
      data: {
        plaidTransactionId: plaidTxId,
        userId: USER_ID,
        accountId,
        name: 'OTHER',
        amount: 5,
        date: new Date('2026-10-01'),
        categories: [],
        primaryCategory: 'Other',
        categorySource: 'PLAID',
      },
    });

    queuedPages([
      {
        modified: [
          plaidTransaction({
            transaction_id: userTxId,
            amount: 22.5,
            name: 'NEW NAME',
            personal_finance_category: { primary: 'TRAVEL', detailed: 'TRAVEL_FLIGHTS' },
          }),
          plaidTransaction({
            transaction_id: plaidTxId,
            amount: 7.77,
            name: 'RENAMED',
            personal_finance_category: { primary: 'TRAVEL', detailed: 'TRAVEL_FLIGHTS' },
          }),
        ],
        next: 'cursor-modified',
      },
    ]);

    const result = await TransactionSyncService.syncItem(ITEM_ID);
    expect(result).toEqual({ success: true, added: 0, modified: 2, removed: 0 });

    const userRow = await prisma.transaction.findUnique({ where: { plaidTransactionId: userTxId } });
    expect(userRow!.amount).toBe(22.5);
    expect(userRow!.name).toBe('NEW NAME');
    expect(userRow!.primaryCategory).toBe('Shopping');
    expect(userRow!.categorySource).toBe('USER');
    expect(userRow!.notes).toBe('mine');
    expect(userRow!.reviewed).toBe(true);

    const plaidRow = await prisma.transaction.findUnique({ where: { plaidTransactionId: plaidTxId } });
    expect(plaidRow!.amount).toBe(7.77);
    expect(plaidRow!.primaryCategory).toBe('Travel');
    expect(plaidRow!.categorySource).toBe('PLAID');
  });

  it('deletes removed transactions', async () => {
    await seedAccounts();
    const accountId = await accountIdOf(CHECKING_ID);
    const goneId = `sync-gone-${stamp}`;

    await prisma.transaction.create({
      data: {
        plaidTransactionId: goneId,
        userId: USER_ID,
        accountId,
        name: 'GONE',
        amount: 3,
        date: new Date('2026-10-02'),
        categories: [],
      },
    });

    queuedPages([{ removed: [{ transaction_id: goneId }], next: 'cursor-removed' }]);

    const result = await TransactionSyncService.syncItem(ITEM_ID);
    expect(result).toEqual({ success: true, added: 0, modified: 0, removed: 1 });
    expect(await prisma.transaction.findUnique({ where: { plaidTransactionId: goneId } })).toBeNull();
  });

  it('sets LOGIN_REQUIRED and keeps the cursor when the bank needs a new login', async () => {
    await prisma.plaidItem.update({ where: { id: ITEM_ID }, data: { cursor: 'saved-cursor' } });

    transactionsSync.mockImplementation(async () => {
      throw { response: { data: { error_code: 'ITEM_LOGIN_REQUIRED' } } };
    });

    const result = await TransactionSyncService.syncItem(ITEM_ID);

    expect(result).toEqual({ success: false, error: 'ITEM_LOGIN_REQUIRED' });

    const item = await prisma.plaidItem.findUnique({ where: { id: ITEM_ID } });
    expect(item!.status).toBe('LOGIN_REQUIRED');
    expect(item!.cursor).toBe('saved-cursor');
    expect(item!.lastError).toBe('ITEM_LOGIN_REQUIRED');
  });

  it('sets ERROR for any other Plaid error without saving the cursor', async () => {
    await prisma.plaidItem.update({ where: { id: ITEM_ID }, data: { cursor: 'saved-cursor' } });

    transactionsSync.mockImplementation(async () => {
      throw { response: { data: { error_code: 'INSTITUTION_DOWN' } } };
    });

    const result = await TransactionSyncService.syncItem(ITEM_ID);

    expect(result).toEqual({ success: false, error: 'INSTITUTION_DOWN' });
    const item = await prisma.plaidItem.findUnique({ where: { id: ITEM_ID } });
    expect(item!.status).toBe('ERROR');
    expect(item!.cursor).toBe('saved-cursor');
    expect(item!.lastError).toBe('INSTITUTION_DOWN');
  });

  it('never writes the access token into lastError', async () => {
    const item = await prisma.plaidItem.findUnique({ where: { id: ITEM_ID } });

    transactionsSync.mockImplementation(async () => {
      throw new Error(`request failed for token ${item!.accessToken}`);
    });

    await TransactionSyncService.syncItem(ITEM_ID);

    const saved = await prisma.plaidItem.findUnique({ where: { id: ITEM_ID } });
    expect(saved!.status).toBe('ERROR');
    expect(saved!.lastError).not.toContain(item!.accessToken);
  });

  it('skips an item that is already syncing', async () => {
    await prisma.plaidItem.update({ where: { id: ITEM_ID }, data: { status: 'SYNCING' } });

    const result = await TransactionSyncService.syncItem(ITEM_ID);

    expect(result).toEqual({ skipped: true });
    expect(transactionsSync).not.toHaveBeenCalled();
  });

  it('restarts the pull once when Plaid changes data during pagination', async () => {
    const calls: string[] = [];
    let call = 0;

    transactionsSync.mockImplementation(async (args: any): Promise<FakePage> => {
      calls.push(args.cursor ?? 'start');
      call++;

      if (call === 1) {
        return {
          data: {
            added: [plaidTransaction({ transaction_id: `sync-mut-1-${stamp}` })],
            modified: [],
            removed: [],
            next_cursor: 'cursor-a',
            has_more: true,
          },
        };
      }

      if (call === 2) {
        throw { response: { data: { error_code: 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' } } };
      }

      return {
        data: {
          added: [plaidTransaction({ transaction_id: `sync-mut-2-${stamp}` })],
          modified: [],
          removed: [],
          next_cursor: 'cursor-final',
          has_more: false,
        },
      };
    });

    const result = await TransactionSyncService.syncItem(ITEM_ID);

    expect(result).toEqual({ success: true, added: 1, modified: 0, removed: 0 });
    // First attempt from the saved cursor, then a fresh run from the same cursor.
    expect(calls).toEqual(['start', 'cursor-a', 'start']);
    expect(await prisma.transaction.count({ where: { userId: USER_ID } })).toBe(1);

    const item = await prisma.plaidItem.findUnique({ where: { id: ITEM_ID } });
    expect(item!.cursor).toBe('cursor-final');
  });

  it('resetStuckSyncs turns SYNCING back into ACTIVE', async () => {
    await prisma.plaidItem.update({ where: { id: ITEM_ID }, data: { status: 'SYNCING' } });

    const count = await TransactionSyncService.resetStuckSyncs();

    expect(count).toBeGreaterThanOrEqual(1);
    const item = await prisma.plaidItem.findUnique({ where: { id: ITEM_ID } });
    expect(item!.status).toBe('ACTIVE');
  });

  it('getSyncStatus reports TOKEN_EXPIRED when an item needs a new login', async () => {
    await seedAccounts();
    await prisma.plaidItem.update({
      where: { id: ITEM_ID },
      data: { status: 'LOGIN_REQUIRED', lastSyncAt: new Date('2026-10-01T12:00:00Z'), lastError: 'ITEM_LOGIN_REQUIRED' },
    });
    await prisma.transaction.create({
      data: {
        plaidTransactionId: `sync-status-${stamp}`,
        userId: USER_ID,
        accountId: await accountIdOf(CHECKING_ID),
        name: 'Anything',
        amount: 1,
        date: new Date('2026-10-01'),
        categories: [],
      },
    });

    const status = await TransactionSyncService.getSyncStatus(USER_ID);

    expect(status.connected).toBe(true);
    expect(status.status).toBe('TOKEN_EXPIRED');
    expect(status.lastSyncAt).toEqual(new Date('2026-10-01T12:00:00Z'));
    expect(status.transactionCount).toBe(1);
    expect(status.items).toEqual([
      {
        id: ITEM_ID,
        institutionName: 'Test Bank',
        status: 'LOGIN_REQUIRED',
        lastSyncAt: new Date('2026-10-01T12:00:00Z'),
        lastError: 'ITEM_LOGIN_REQUIRED',
      },
    ]);
  });

  it('getSyncStatus is disconnected and NEVER_SYNCED for a user without items', async () => {
    const status = await TransactionSyncService.getSyncStatus(OTHER_USER_ID);

    expect(status).toEqual({
      connected: false,
      status: 'NEVER_SYNCED',
      lastSyncAt: null,
      transactionCount: 0,
      items: [],
    });
  });

  it('getSyncStatus prefers SYNCING over a stale error on another item', async () => {
    const errorItem = await prisma.plaidItem.create({
      data: {
        id: OTHER_ITEM_ID,
        userId: USER_ID,
        accessToken: `access-${OTHER_ITEM_ID}`,
        itemId: `plaid-item-id-${OTHER_ITEM_ID}`,
        institutionId: `ins-${OTHER_ITEM_ID}`,
        institutionName: 'Second Bank',
        status: 'SYNCING',
        lastSyncAt: new Date('2026-10-02T00:00:00Z'),
      },
    });

    await prisma.plaidItem.update({
      where: { id: ITEM_ID },
      data: { status: 'ERROR', lastError: 'INSTITUTION_DOWN', lastSyncAt: new Date('2026-10-01T00:00:00Z') },
    });

    const status = await TransactionSyncService.getSyncStatus(USER_ID);

    expect(status.status).toBe('SYNCING');
    // The latest sync across all items, not the first item's.
    expect(status.lastSyncAt).toEqual(errorItem.lastSyncAt!);
  });

  it('fullResync clears the cursor and syncs the user items', async () => {
    const calls = queuedPages([
      { added: [plaidTransaction({ transaction_id: `sync-full-${stamp}` })], next: 'cursor-full' },
    ]);

    await prisma.plaidItem.update({ where: { id: ITEM_ID }, data: { cursor: 'old-cursor' } });

    const result = await TransactionSyncService.fullResync(USER_ID);

    expect(calls[0].cursor).toBeUndefined();
    expect(result.items).toHaveLength(1);
    expect(result.items[0].result).toEqual({ success: true, added: 1, modified: 0, removed: 0 });

    // Running it again keeps one row (the upsert is idempotent).
    await TransactionSyncService.fullResync(USER_ID);
    expect(await prisma.transaction.count({ where: { userId: USER_ID } })).toBe(1);
  });

  it("syncUser only touches the user's own items and skips a login-required one", async () => {
    const otherItemId = `sync-other-item-${stamp}`;
    await prisma.plaidItem.create({
      data: {
        id: otherItemId,
        userId: USER_ID,
        accessToken: `access-${otherItemId}`,
        itemId: `plaid-item-id-${otherItemId}`,
        institutionId: `ins-${otherItemId}`,
        institutionName: 'Logged Out Bank',
        status: 'LOGIN_REQUIRED',
      },
    });

    accountsGet.mockImplementation(async (args: any) => {
      if (args.access_token === `access-${otherItemId}`) {
        throw new Error('must not sync a LOGIN_REQUIRED item');
      }
      return { data: { accounts: [checkingAccount(), savingsAccount()] } };
    });

    const result = await TransactionSyncService.syncUser(USER_ID);

    expect(result.items.map((entry) => entry.itemId)).toEqual([ITEM_ID]);
    expect(accountsGet).toHaveBeenCalledTimes(1);
  });

  it('does not touch another user\'s account when the Plaid account id collides', async () => {
    // Another user somehow owns a row with the same plaid account id.
    const foreignItem = await prisma.plaidItem.create({
      data: {
        userId: OTHER_USER_ID,
        accessToken: `access-foreign`,
        itemId: `plaid-item-id-foreign-${stamp}`,
        institutionId: `ins-foreign-${stamp}`,
        institutionName: 'Foreign Bank',
        status: 'ACTIVE',
      },
    });
    const foreignAccount = await prisma.account.create({
      data: {
        plaidAccountId: CHECKING_ID,
        plaidItemId: foreignItem.id,
        userId: OTHER_USER_ID,
        name: 'Not yours',
        type: 'depository',
        subtype: 'checking',
        currentBalance: 1,
      },
    });

    await TransactionSyncService.syncItem(ITEM_ID);

    const untouched = await prisma.account.findUnique({ where: { id: foreignAccount.id } });
    expect(untouched!.userId).toBe(OTHER_USER_ID);
    expect(untouched!.name).toBe('Not yours');
  });
});
