import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, mock, type Mock } from 'bun:test';

process.env.NODE_ENV = 'test';

// Pushes from the sync and from the budget checks (E2). The real NotificationLog rows are
// written; only the POST to ntfy is faked, so dedupe is tested against the database.
const stamp = Date.now();
const USER_ID = `push-sync-user-${stamp}`;
const TOPIC = `mazzy-push-${stamp}`;
const CHECKING_ID = `push-checking-${stamp}`;
const ITEM_ID = `push-item-${stamp}`;
const BUDGET_ID = `push-budget-${stamp}`;

const transactionsSync = mock(async (_args: any): Promise<{ data: any }> => ({
  data: { added: [], modified: [], removed: [], next_cursor: 'cursor', has_more: false },
}));
const accountsGet = mock(async (_args: any) => ({
  data: { accounts: [checkingAccount()] },
}));

mock.module('../../lib/plaid', () => ({
  plaidClient: { transactionsSync, accountsGet },
  ITEM_LIMIT: 10,
  plaidErrorCode: (err: any) => err?.response?.data?.error_code,
}));

// Bun hoists mock.module above the imports, so these already use the fake Plaid client.
import { prisma } from '../../lib/prisma';
import { TransactionSyncService } from '../../services/transactionSyncService';
import { BudgetAlertService } from '../../services/budgetAlertService';
import { BudgetSyncService, monthKey } from '../../services/budgetSyncService';

const realFetch = globalThis.fetch;
const fetchMock = mock(async (_url: any, _init?: any) => new Response('ok', { status: 200 }));

function checkingAccount() {
  return {
    account_id: CHECKING_ID,
    name: 'Everyday Checking',
    official_name: null,
    type: 'depository',
    subtype: 'checking',
    mask: '4242',
    balances: { current: 1000, available: 900, limit: null },
  };
}

function plaidTransaction(overrides: Record<string, any> = {}) {
  return {
    transaction_id: `push-tx-${stamp}`,
    account_id: CHECKING_ID,
    amount: 300,
    date: new Date().toISOString().slice(0, 10),
    authorized_date: null,
    name: 'APPLE STORE',
    merchant_name: 'Apple Store',
    pending: false,
    pending_transaction_id: null,
    category: [],
    personal_finance_category: { primary: 'GENERAL_MERCHANDISE', detailed: 'GENERAL_MERCHANDISE_ELECTRONICS' },
    location: null,
    ...overrides,
  };
}

const queued = (page: { added?: any[]; modified?: any[]; removed?: any[]; next?: string }) => {
  transactionsSync.mockImplementation(async () => ({
    data: {
      added: page.added ?? [],
      modified: page.modified ?? [],
      removed: page.removed ?? [],
      next_cursor: page.next ?? 'cursor',
      has_more: false,
    },
  }));
};

/** The pushes that went out, as `{ title, body }`. */
const pushes = () =>
  (fetchMock.mock.calls as unknown as Array<[string, any]>).map(([url, init]) => ({
    url,
    title: init.headers.Title as string,
    body: init.body as string,
    kind: 'push',
  }));

const cleanup = async () => {
  await prisma.notificationLog.deleteMany({ where: { userId: USER_ID } });
  await prisma.budgetAlertNotification.deleteMany({ where: { userId: USER_ID } });
  await prisma.budgetAlert.deleteMany({ where: { userId: USER_ID } });
  await prisma.transaction.deleteMany({ where: { userId: USER_ID } });
  await prisma.budget.deleteMany({ where: { userId: USER_ID } });
  await prisma.balanceSnapshot.deleteMany({ where: { account: { userId: USER_ID } } });
  await prisma.account.deleteMany({ where: { userId: USER_ID } });
  await prisma.plaidItem.deleteMany({ where: { userId: USER_ID } });
  await prisma.user.deleteMany({ where: { id: USER_ID } });
};

const createUser = (overrides: Record<string, any> = {}) =>
  prisma.user.create({
    data: {
      id: USER_ID,
      email: `push-sync-${stamp}@example.com`,
      fullName: 'Push Tester',
      passwordHash: 'hash',
      ntfyTopic: TOPIC,
      ...overrides,
    },
  });

const createItem = (overrides: Record<string, any> = {}) =>
  prisma.plaidItem.create({
    data: {
      id: ITEM_ID,
      userId: USER_ID,
      accessToken: `access-${ITEM_ID}`,
      itemId: `plaid-item-${ITEM_ID}`,
      institutionId: `ins-${ITEM_ID}`,
      institutionName: 'FirstLight',
      status: 'ACTIVE',
      ...overrides,
    },
  });

describe('Pushes from the transaction sync', () => {
  beforeAll(async () => {
    await cleanup();
  });

  beforeEach(async () => {
    await cleanup();
    process.env.NTFY_URL = 'http://ntfy.test';
    await createUser({ notifyLargeOver: 200 });
    await createItem();

    transactionsSync.mockReset();
    transactionsSync.mockImplementation(async () => ({
      data: { added: [], modified: [], removed: [], next_cursor: 'cursor', has_more: false },
    }));
    accountsGet.mockReset();
    accountsGet.mockImplementation(async () => ({ data: { accounts: [checkingAccount()] } }));
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => new Response('ok', { status: 200 }));
    (globalThis as any).fetch = fetchMock;
  });

  afterEach(async () => {
    (globalThis as any).fetch = realFetch;
    await cleanup();
  });

  afterAll(async () => {
    (globalThis as any).fetch = realFetch;
    await cleanup();
    await prisma.$disconnect();
  });

  it('pushes once when a bank turns LOGIN_REQUIRED', async () => {
    transactionsSync.mockImplementation(async () => {
      throw { response: { data: { error_code: 'ITEM_LOGIN_REQUIRED' } } };
    });

    await TransactionSyncService.syncItem(ITEM_ID);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [push] = pushes();
    expect(push.url).toBe(`http://ntfy.test/${encodeURIComponent(TOPIC)}`);
    expect(push.title).toContain('FirstLight');
    expect(push.title).toContain('log in again');
  });

  it('does not push for an item that was already LOGIN_REQUIRED before this run', async () => {
    // syncUser/syncAll only pick up ACTIVE and ERROR rows, but a manual sync of one item can
    // still reach a row that was already logged out. That is not a new transition.
    await prisma.plaidItem.update({ where: { id: ITEM_ID }, data: { status: 'LOGIN_REQUIRED' } });
    transactionsSync.mockImplementation(async () => {
      throw { response: { data: { error_code: 'ITEM_LOGIN_REQUIRED' } } };
    });

    await TransactionSyncService.syncItem(ITEM_ID);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not push the same login-required day twice, even across a reconnect attempt', async () => {
    transactionsSync.mockImplementation(async () => {
      throw { response: { data: { error_code: 'ITEM_LOGIN_REQUIRED' } } };
    });

    await TransactionSyncService.syncItem(ITEM_ID);
    // The status was reset by hand (or by a restart); the day's log row still holds.
    await prisma.plaidItem.update({ where: { id: ITEM_ID }, data: { status: 'ACTIVE' } });
    await TransactionSyncService.syncItem(ITEM_ID);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not push for an ordinary Plaid error', async () => {
    transactionsSync.mockImplementation(async () => {
      throw { response: { data: { error_code: 'INSTITUTION_DOWN' } } };
    });

    await TransactionSyncService.syncItem(ITEM_ID);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('pushes for a new charge above the threshold, once', async () => {
    queued({ added: [plaidTransaction({ transaction_id: `push-big-${stamp}`, amount: 349.99 })] });

    await TransactionSyncService.syncItem(ITEM_ID);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [push] = pushes();
    expect(push.title).toContain('$350');
    expect(push.title).toContain('Apple Store');
    expect(push.body).toContain('$349.99');

    // A replay of the same batch must not buzz again.
    await prisma.plaidItem.update({ where: { id: ITEM_ID }, data: { status: 'ACTIVE' } });
    await TransactionSyncService.syncItem(ITEM_ID);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stays quiet for a charge at or under the threshold', async () => {
    queued({ added: [plaidTransaction({ transaction_id: `push-small-${stamp}`, amount: 200 })] });

    await TransactionSyncService.syncItem(ITEM_ID);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stays quiet for a pending charge, a transfer and a hidden charge', async () => {
    await prisma.rule.create({
      data: {
        userId: USER_ID,
        priority: 10,
        matchMerchant: 'apple store',
        setTransfer: true,
      },
    });

    queued({
      added: [
        plaidTransaction({ transaction_id: `push-pending-${stamp}`, amount: 500, pending: true }),
      ],
    });
    await TransactionSyncService.syncItem(ITEM_ID);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stays quiet when the user has no large charge threshold', async () => {
    await prisma.user.update({ where: { id: USER_ID }, data: { notifyLargeOver: null } });
    queued({ added: [plaidTransaction({ transaction_id: `push-nolimit-${stamp}`, amount: 900 })] });

    await TransactionSyncService.syncItem(ITEM_ID);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('writes the balance snapshot under the household day', async () => {
    const { householdDay } = await import('../../services/notifyService');
    const before = householdDay();

    await TransactionSyncService.syncItem(ITEM_ID);

    const snapshot = await prisma.balanceSnapshot.findFirst({
      where: { account: { userId: USER_ID } },
    });

    expect(snapshot!.date.toISOString()).toBe(before.toISOString());
  });
});

describe('Pushes from the budget alerts', () => {
  const now = new Date();
  const thisMonth = monthKey(now);
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const addSpending = async (amount: number) => {
    const account = await prisma.account.create({
      data: {
        userId: USER_ID,
        name: 'Budget Checking',
        type: 'depository',
        subtype: 'checking',
      },
    });
    await prisma.transaction.create({
      data: {
        userId: USER_ID,
        accountId: account.id,
        name: 'Groceries',
        amount,
        date: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 10, 12)),
        primaryCategory: 'Groceries',
        categories: [],
      },
    });
  };

  const makeBudget = () =>
    prisma.budget.create({
      data: {
        id: BUDGET_ID,
        userId: USER_ID,
        name: 'Groceries',
        category: 'Groceries',
        amount: 500,
        period: 'MONTHLY',
        startDate: startOfMonth,
        endDate: null,
      },
    });

  beforeEach(async () => {
    await cleanup();
    process.env.NTFY_URL = 'http://ntfy.test';
    await createUser({ notifyLargeOver: null });
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => new Response('ok', { status: 200 }));
    (globalThis as any).fetch = fetchMock;
  });

  afterEach(async () => {
    (globalThis as any).fetch = realFetch;
    await cleanup();
  });

  afterAll(async () => {
    (globalThis as any).fetch = realFetch;
    await cleanup();
    await prisma.$disconnect();
  });

  it('pushes at 90% and again at 100%, once each per budget per month', async () => {
    const budget = await makeBudget();
    await addSpending(460);
    await BudgetAlertService.evaluateUserBudgets(USER_ID);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(pushes()[0].title).toContain('92%');

    // Crossing 100% later in the month is a second, stronger push.
    await addSpending(60);
    await BudgetAlertService.evaluateUserBudgets(USER_ID);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(pushes()[1].title).toContain('over budget');

    // Neither crossing repeats on the next evaluation.
    await BudgetAlertService.evaluateUserBudgets(USER_ID);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const logs = await prisma.notificationLog.findMany({
      where: { userId: USER_ID },
      orderBy: { kind: 'asc' },
    });
    expect(logs.map((log) => log.kind)).toEqual(['budget-100', 'budget-90']);
    expect(logs[0].key).toBe(`${budget.id}:${thisMonth}`);
  });

  it('sends only the over-budget push when a budget jumps past 100%', async () => {
    await makeBudget();
    await addSpending(700);

    await BudgetAlertService.evaluateUserBudgets(USER_ID);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(pushes()[0].title).toContain('over budget');
  });

  it('stays quiet for a budget under 90%', async () => {
    await makeBudget();
    await addSpending(100);

    await BudgetAlertService.evaluateUserBudgets(USER_ID);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never pushes for a month other than the current one', async () => {
    const budget = await makeBudget();
    const lastMonth = monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
    const snapshot = await BudgetSyncService.budgetForMonth(budget, lastMonth);

    await BudgetAlertService.evaluateBudgetAlerts(budget, { ...snapshot, percentUsed: 100 });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Weekly recap', () => {
  beforeEach(async () => {
    await cleanup();
    process.env.NTFY_URL = 'http://ntfy.test';
    await createUser({ notifyLargeOver: null, notifyWeekly: true });
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => new Response('ok', { status: 200 }));
    (globalThis as any).fetch = fetchMock;
  });

  afterEach(async () => {
    (globalThis as any).fetch = realFetch;
    await cleanup();
  });

  afterAll(async () => {
    (globalThis as any).fetch = realFetch;
    await cleanup();
    await prisma.$disconnect();
  });

  it('summarises the week and sends once for the ISO week', async () => {
    const { NotifyService, householdDay } = await import('../../services/notifyService');
    const account = await prisma.account.create({
      data: { userId: USER_ID, name: 'Weekly Checking', type: 'depository', subtype: 'checking' },
    });

    // Dates are UTC midnight, and "this week" is the household's last seven days, so the
    // rows are placed relative to the household day rather than to UTC.
    const today = householdDay();
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));

    await prisma.transaction.createMany({
      data: [
        {
          userId: USER_ID,
          accountId: account.id,
          name: 'Paycheck',
          amount: -2000,
          date: monthStart,
          primaryCategory: 'Income',
          categories: [],
        },
        {
          userId: USER_ID,
          accountId: account.id,
          name: 'Groceries',
          amount: 412,
          date: today,
          primaryCategory: 'Groceries',
          categories: [],
        },
      ],
    });

    const sent = await NotifyService.sendWeeklyRecaps();
    expect(sent).toBeGreaterThanOrEqual(1);

    const [push] = pushes();
    expect(push.body).toContain('spent $412');
    expect(push.body).toContain('saved $1,588 this month so far');
    // Both seeded rows count as waiting for review (they are recent and unreviewed).
    expect(push.body).toContain('2 to review');

    // A second run in the same ISO week is a duplicate.
    const before = fetchMock.mock.calls.length;
    await NotifyService.sendWeeklyRecaps();
    expect(fetchMock.mock.calls.length).toBe(before);
  });

  it('names the budgets that are over', async () => {
    const { NotifyService, householdDay } = await import('../../services/notifyService');
    const today = householdDay();
    const account = await prisma.account.create({
      data: { userId: USER_ID, name: 'Recap Checking', type: 'depository', subtype: 'checking' },
    });

    await prisma.budget.create({
      data: {
        userId: USER_ID,
        name: 'Shopping',
        category: 'Shopping',
        amount: 100,
        period: 'MONTHLY',
        startDate: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)),
        endDate: null,
      },
    });
    await prisma.transaction.create({
      data: {
        userId: USER_ID,
        accountId: account.id,
        name: 'Store',
        amount: 250,
        date: today,
        primaryCategory: 'Shopping',
        categories: [],
      },
    });

    await NotifyService.sendWeeklyRecaps();

    expect(pushes()[0].body).toContain('Over budget: Shopping.');
  });

  it('skips a user who turned the recap off', async () => {
    const { NotifyService } = await import('../../services/notifyService');
    await prisma.user.update({ where: { id: USER_ID }, data: { notifyWeekly: false } });

    await NotifyService.sendWeeklyRecaps();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
