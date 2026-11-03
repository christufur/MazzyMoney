import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'bun:test';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

import { app } from '../../index';
import { prisma } from '../../lib/prisma';

// E3: CSV import into a manual account. The owner's Apple Card and Affirm are invisible to Plaid,
// so the monthly Apple Card CSV (or any file with a column mapping) is written in as transactions:
// money out positive, payments kept as transfers, duplicates skipped by importHash.

const stamp = Date.now();
const USER_ID = `import-user-${stamp}`;
const OTHER_USER_ID = `import-other-${stamp}`;

const APPLE_HEADER =
  'Transaction Date,Clearing Date,Description,Merchant,Category,Type,Amount (USD)';

const authHeader = (userId: string = USER_ID) =>
  `Bearer ${jwt.sign({ userId }, process.env.JWT_SECRET!)}`;

/** A date `days` ago at UTC midnight, as both MM/DD/YYYY (Apple) and YYYY-MM-DD. */
const daysAgo = (days: number) => {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return new Date(today.getTime() - days * 24 * 60 * 60 * 1000);
};

const appleDate = (days: number) => {
  const date = daysAgo(days);
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${month}/${day}/${date.getUTCFullYear()}`;
};

const isoDate = (days: number) => daysAgo(days).toISOString().slice(0, 10);

const createUser = (id: string, email: string) =>
  prisma.user.create({
    data: { id, email, fullName: 'Import Test User', passwordHash: 'hash' },
  });

const createAccount = (userId: string, overrides: Record<string, any> = {}) =>
  prisma.account.create({
    data: {
      userId,
      name: 'Apple Card',
      type: 'other',
      subtype: 'other',
      currentBalance: 0,
      isManual: true,
      isLiability: true,
      ...overrides,
    },
  });

/** One Apple Card line: purchase, payment, refund, and a description with a comma and a quote. */
const appleCsv = (extraRows: string[] = []) =>
  [
    APPLE_HEADER,
    `${appleDate(20)},${appleDate(21)},"WHOLE FOODS MKT, SEATTLE WA",Whole Foods,Grocery,Purchase,84.20`,
    `${appleDate(2)},${appleDate(1)},BLUE BOTTLE COFFEE,Blue Bottle,Restaurants,Purchase,6.50`,
    `${appleDate(5)},${appleDate(4)},APPLE CARD PAYMENT,Apple,Other,Payment,-84.20`,
    `${appleDate(10)},${appleDate(9)},"REFUND ""SEATTLE"" STORE",Refund Store,Shopping,Refund,-12.99`,
    ...extraRows,
  ].join('\r\n');

const importCsv = (accountId: string, body: Record<string, any>, userId: string = USER_ID) =>
  request(app)
    .post(`/api/accounts/manual/${accountId}/import`)
    .set('Authorization', authHeader(userId))
    .send(body);

const rowsFor = (accountId: string) =>
  prisma.transaction.findMany({ where: { accountId }, orderBy: { date: 'asc' } });

const cleanup = async () => {
  await prisma.transaction.deleteMany({ where: { userId: { in: [USER_ID, OTHER_USER_ID] } } });
  await prisma.account.deleteMany({ where: { userId: { in: [USER_ID, OTHER_USER_ID] } } });
  await prisma.rule.deleteMany({ where: { userId: { in: [USER_ID, OTHER_USER_ID] } } });
  await prisma.plaidItem.deleteMany({ where: { userId: { in: [USER_ID, OTHER_USER_ID] } } });
  await prisma.user.deleteMany({ where: { id: { in: [USER_ID, OTHER_USER_ID] } } });
};

let accountId: string;

beforeAll(async () => {
  await cleanup();
  await createUser(USER_ID, `import-${stamp}@example.com`);
  await createUser(OTHER_USER_ID, `import-other-${stamp}@example.com`);
});

// Rows and accounts only: the two users outlive every test.
beforeEach(async () => {
  await prisma.transaction.deleteMany({ where: { userId: { in: [USER_ID, OTHER_USER_ID] } } });
  await prisma.account.deleteMany({ where: { userId: { in: [USER_ID, OTHER_USER_ID] } } });
  const account = await createAccount(USER_ID);
  accountId = account.id;
});

afterEach(async () => {
  await prisma.rule.deleteMany({ where: { userId: USER_ID } });
  await prisma.transaction.deleteMany({ where: { userId: { in: [USER_ID, OTHER_USER_ID] } } });
  await prisma.account.deleteMany({ where: { userId: { in: [USER_ID, OTHER_USER_ID] } } });
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('POST /api/accounts/manual/:id/import (apple-card)', () => {
  it('imports purchases, a payment, and a refund with the right signs and categories', async () => {
    const response = await importCsv(accountId, { csv: appleCsv(), format: 'apple-card' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      imported: 4,
      skipped: 0,
      payments: 1,
      firstDate: isoDate(20),
      lastDate: isoDate(2),
      errors: [],
    });
    expect(response.body.note).toContain('balance');

    const rows = await rowsFor(accountId);
    expect(rows).toHaveLength(4);

    const groceries = rows.find((row) => row.name.startsWith('WHOLE FOODS'))!;
    // A quoted description keeps its comma.
    expect(groceries.name).toBe('WHOLE FOODS MKT, SEATTLE WA');
    expect(groceries.merchantName).toBe('Whole Foods');
    expect(groceries.amount).toBe(84.2);
    expect(groceries.primaryCategory).toBe('Groceries');
    expect(groceries.date.toISOString()).toBe(daysAgo(20).toISOString());
    // 20 days old: it arrives reviewed, like a Plaid row outside the review window.
    expect(groceries.reviewed).toBe(true);
    expect(groceries.pending).toBe(false);
    expect(groceries.isTransfer).toBe(false);
    expect(groceries.plaidTransactionId).toBeNull();
    expect(groceries.importHash).toMatch(/^[0-9a-f]{64}$/);
    expect(groceries.categorySource).toBe('PLAID');

    const coffee = rows.find((row) => row.name === 'BLUE BOTTLE COFFEE')!;
    expect(coffee.amount).toBe(6.5);
    expect(coffee.primaryCategory).toBe('Food & Dining');
    expect(coffee.reviewed).toBe(false);

    // A payoff from checking: money in, a transfer, so it stays out of spending totals.
    const payment = rows.find((row) => row.name === 'APPLE CARD PAYMENT')!;
    expect(payment.amount).toBe(-84.2);
    expect(payment.isTransfer).toBe(true);
    expect(payment.primaryCategory).toBe('Transfer');

    // A refund is money back on a normal category, not a transfer.
    const refund = rows.find((row) => row.name.startsWith('REFUND'))!;
    expect(refund.name).toBe('REFUND "SEATTLE" STORE');
    expect(refund.amount).toBe(-12.99);
    expect(refund.primaryCategory).toBe('Shopping');
    expect(refund.isTransfer).toBe(false);
  });

  it('accepts the optional trailing Purchased By column', async () => {
    const csv = [
      `${APPLE_HEADER},Purchased By`,
      `${appleDate(3)},${appleDate(2)},TRADER JOES,Trader Joes,Grocery,Purchase,42.10,Chelsea`,
    ].join('\n');

    const response = await importCsv(accountId, { csv, format: 'apple-card' });

    expect(response.status).toBe(200);
    expect(response.body.imported).toBe(1);

    const [row] = await rowsFor(accountId);
    expect(row.amount).toBe(42.1);
    expect(row.primaryCategory).toBe('Groceries');
  });

  it('lets a user rule win over the category written in the file', async () => {
    await prisma.rule.create({
      data: {
        userId: USER_ID,
        priority: 10,
        matchMerchant: 'blue bottle',
        setCategory: 'Entertainment',
        setMerchant: 'Blue Bottle Coffee',
      },
    });

    const response = await importCsv(accountId, { csv: appleCsv(), format: 'apple-card' });
    expect(response.status).toBe(200);

    const coffee = (await rowsFor(accountId)).find((row) => row.name === 'BLUE BOTTLE COFFEE')!;
    expect(coffee.primaryCategory).toBe('Entertainment');
    expect(coffee.categorySource).toBe('RULE');
    expect(coffee.merchantDisplay).toBe('Blue Bottle Coffee');

    const groceries = (await rowsFor(accountId)).find((row) => row.name.startsWith('WHOLE FOODS'))!;
    expect(groceries.categorySource).toBe('PLAID');
  });

  it('skips every row on a second import of the same file', async () => {
    const csv = appleCsv();

    const first = await importCsv(accountId, { csv, format: 'apple-card' });
    expect(first.status).toBe(200);
    expect(first.body.imported).toBe(4);

    const second = await importCsv(accountId, { csv, format: 'apple-card' });
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ imported: 0, skipped: 4, payments: 0 });
    expect(second.body.firstDate).toBeNull();
    expect(second.body.lastDate).toBeNull();

    expect(await prisma.transaction.count({ where: { accountId } })).toBe(4);
  });

  it('keeps two identical purchases in one file, and still dedupes a re-import of it', async () => {
    const csv = appleCsv().split('\r\n');
    const twoCoffees = [...csv, csv[2]].join('\r\n');

    const first = await importCsv(accountId, { csv: twoCoffees, format: 'apple-card' });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ imported: 5, skipped: 0 });

    const again = await importCsv(accountId, { csv: twoCoffees, format: 'apple-card' });
    expect(again.body).toMatchObject({ imported: 0, skipped: 5 });
  });

  it('previews without writing on a dry run', async () => {
    const response = await importCsv(accountId, {
      csv: appleCsv(),
      format: 'apple-card',
      dryRun: true,
    });

    expect(response.status).toBe(200);
    expect(response.body.dryRun).toBe(true);
    expect(response.body.total).toBe(4);
    expect(response.body.duplicates).toBe(0);
    expect(response.body.errors).toEqual([]);
    expect(response.body.preview).toHaveLength(4);
    expect(response.body.preview[1]).toMatchObject({
      date: isoDate(2),
      description: 'BLUE BOTTLE COFFEE',
      merchant: 'Blue Bottle',
      amount: 6.5,
      category: 'Food & Dining',
      isTransfer: false,
    });
    expect(response.body.preview[2]).toMatchObject({ amount: -84.2, isTransfer: true });

    expect(await prisma.transaction.count({ where: { accountId } })).toBe(0);
  });

  it('keeps a newline inside a quoted field as part of the description', async () => {
    const csv = [
      APPLE_HEADER,
      `${appleDate(3)},${appleDate(2)},"MULTI LINE, ""SHOP""",Multi Line,Shopping,Purchase,7.77`,
    ].join('\r\n');

    const response = await importCsv(accountId, { csv, format: 'apple-card' });

    expect(response.status).toBe(200);
    const [row] = await rowsFor(accountId);
    expect(row.name).toBe('MULTI LINE, "SHOP"');
    expect(row.amount).toBe(7.77);
  });

  it('imports more rows than one 500-row batch and reports every one', async () => {
    const rows = Array.from(
      { length: 501 },
      (_, index) =>
        `${appleDate(3)},${appleDate(2)},SHOP ${index},Shop ${index},Shopping,Purchase,${(index + 1) % 90}.25`
    );

    const response = await importCsv(accountId, {
      csv: [APPLE_HEADER, ...rows].join('\n'),
      format: 'apple-card',
    });

    expect(response.status).toBe(200);
    expect(response.body.imported).toBe(501);
    expect(response.body.skipped).toBe(0);
    expect(await prisma.transaction.count({ where: { accountId } })).toBe(501);
  });

  it('previews only the first five rows of a longer file', async () => {
    const rows = Array.from({ length: 8 }, (_, index) =>
      `${appleDate(3)},${appleDate(2)},SHOP ${index},Shop ${index},Shopping,Purchase,${index + 1}.00`
    );

    const response = await importCsv(accountId, {
      csv: [APPLE_HEADER, ...rows].join('\n'),
      format: 'apple-card',
      dryRun: true,
    });

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(8);
    expect(response.body.preview).toHaveLength(5);
  });

  it('reports bad rows and imports the good ones', async () => {
    const csv = [
      APPLE_HEADER,
      `${appleDate(3)},${appleDate(2)},GOOD ROW,Good Row,Grocery,Purchase,10.00`,
      '13/45/2026,,BAD DATE,Bad Date,Grocery,Purchase,4.00',
      `${appleDate(3)},${appleDate(2)},BAD AMOUNT,Bad Amount,Grocery,Purchase,four dollars`,
    ].join('\n');

    const response = await importCsv(accountId, { csv, format: 'apple-card' });

    expect(response.status).toBe(200);
    expect(response.body.imported).toBe(1);
    expect(response.body.errors).toHaveLength(2);
    expect(response.body.errors[0]).toMatchObject({ row: 3 });
    expect(response.body.errors[0].message).toContain('13/45/2026');
    expect(response.body.errors[1]).toMatchObject({ row: 4 });
    expect(response.body.errors[1].message).toContain('four dollars');

    expect(await prisma.transaction.count({ where: { accountId } })).toBe(1);
  });

  it('answers 400 when every row is invalid', async () => {
    const csv = [
      APPLE_HEADER,
      ',,NO DATE,,Other,Purchase,4.00',
      `${appleDate(3)},,NO AMOUNT,,Other,Purchase,`,
    ].join('\n');

    const response = await importCsv(accountId, { csv, format: 'apple-card' });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('all 2 data rows');
    expect(response.body.errors).toHaveLength(2);
    expect(await prisma.transaction.count({ where: { accountId } })).toBe(0);
  });

  it('answers 400 for a file that is not an Apple Card export', async () => {
    const response = await importCsv(accountId, {
      csv: 'Date,Payee,Amount\n2026-10-01,Coffee,4.50',
      format: 'apple-card',
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Apple Card CSV');
  });

  it('answers 400 for a missing csv, a bad format, or an empty file', async () => {
    const missing = await importCsv(accountId, { format: 'apple-card' });
    expect(missing.status).toBe(400);

    const blank = await importCsv(accountId, { csv: '   ', format: 'apple-card' });
    expect(blank.status).toBe(400);

    const badFormat = await importCsv(accountId, { csv: appleCsv(), format: 'mint' });
    expect(badFormat.status).toBe(400);
    expect(badFormat.body.error).toContain("'apple-card' or 'generic'");

    const headerOnly = await importCsv(accountId, { csv: `${APPLE_HEADER}\n`, format: 'apple-card' });
    expect(headerOnly.status).toBe(400);
    expect(headerOnly.body.error).toContain('no data rows');
  });

  it('answers 400 for a CSV over 5 MB', async () => {
    const csv = `${APPLE_HEADER}\n${'x'.repeat(5 * 1024 * 1024 + 1)}`;

    const response = await importCsv(accountId, { csv, format: 'apple-card' });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('too large');
    expect(await prisma.transaction.count({ where: { accountId } })).toBe(0);
  });

  it('answers 400 for a body over the 6 MB JSON limit', async () => {
    const response = await importCsv(accountId, {
      csv: 'x'.repeat(6 * 1024 * 1024 + 1024),
      format: 'apple-card',
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Request body is too large');
  });

  it('answers 400 in JSON for a body that is not JSON', async () => {
    const response = await request(app)
      .post(`/api/accounts/manual/${accountId}/import`)
      .set('Authorization', authHeader())
      .set('Content-Type', 'application/json')
      .send('{ not json');

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Body must be JSON');
  });

  it('answers 400 for more than 5,000 data rows', async () => {
    const rows = Array.from(
      { length: 5001 },
      (_, index) => `${appleDate(3)},${appleDate(2)},SHOP ${index},Shop,Shopping,Purchase,1.00`
    );

    const response = await importCsv(accountId, {
      csv: [APPLE_HEADER, ...rows].join('\n'),
      format: 'apple-card',
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('5,001 data rows');
    expect(await prisma.transaction.count({ where: { accountId } })).toBe(0);
  });
});

describe('POST /api/accounts/manual/:id/import (generic)', () => {
  it('maps columns and flips the sign with negateAmount', async () => {
    const csv = [
      'Posted,Payee,Value,Memo',
      `${isoDate(5)},Coffee Shop,-4.50,morning`,
      `${appleDate(4)},Book Store,-19.99,`,
      `${isoDate(3)},Refund From Book Store,19.99,`,
    ].join('\r\n');

    const response = await importCsv(accountId, {
      csv,
      format: 'generic',
      mapping: { date: 'Posted', description: 'Payee', amount: 'Value', negateAmount: true },
    });

    expect(response.status).toBe(200);
    expect(response.body.imported).toBe(3);
    expect(response.body.payments).toBe(0);
    expect(response.body.firstDate).toBe(isoDate(5));
    expect(response.body.lastDate).toBe(isoDate(3));

    // The file puts charges negative, so negating turns them into money out (positive).
    const rows = await rowsFor(accountId);
    expect(rows.map((row) => row.amount)).toEqual([4.5, 19.99, -19.99]);
    expect(rows[0].name).toBe('Coffee Shop');
    expect(rows[1].name).toBe('Book Store');
    expect(rows[1].date.toISOString()).toBe(daysAgo(4).toISOString());
    expect(rows[1].plaidTransactionId).toBeNull();
  });

  it('keeps the file sign when the mapping does not negate', async () => {
    const csv = ['Date,Description,Amount', `${isoDate(6)},Lunch,12.34`].join('\n');

    const response = await importCsv(accountId, {
      csv,
      format: 'generic',
      mapping: { date: 'Date', description: 'Description', amount: 'Amount' },
    });

    expect(response.status).toBe(200);
    const [row] = await rowsFor(accountId);
    expect(row.amount).toBe(12.34);
    expect(row.primaryCategory).toBe('Other');
  });

  it('uses the mapped category and merchant columns', async () => {
    const csv = [
      'Date,Description,Amount,Merchant,Category',
      `${isoDate(7)},SQ *TARTINE,5.25,Tartine,Bakery`,
    ].join('\n');

    const response = await importCsv(accountId, {
      csv,
      format: 'generic',
      mapping: {
        date: 'Date',
        description: 'Description',
        amount: 'Amount',
        merchant: 'Merchant',
        category: 'Category',
      },
    });

    expect(response.status).toBe(200);
    const [row] = await rowsFor(accountId);
    // Unknown file categories fall back to the categorizer, which answers "Other" without a PFC.
    expect(row.primaryCategory).toBe('Other');
    expect(row.merchantName).toBe('Tartine');
  });

  it('answers 400 when the mapping is missing or names a column that is not there', async () => {
    const csv = ['Date,Description,Amount', `${isoDate(2)},Lunch,9`].join('\n');

    const missing = await importCsv(accountId, { csv, format: 'generic' });
    expect(missing.status).toBe(400);
    expect(missing.body.error).toContain('mapping is required');

    const partial = await importCsv(accountId, {
      csv,
      format: 'generic',
      mapping: { date: 'Date', description: 'Description' },
    });
    expect(partial.status).toBe(400);
    expect(partial.body.error).toContain('mapping.amount');

    const notThere = await importCsv(accountId, {
      csv,
      format: 'generic',
      mapping: { date: 'Date', description: 'Payee', amount: 'Amount' },
    });
    expect(notThere.status).toBe(400);
    expect(notThere.body.error).toContain('"Payee"');
    expect(await prisma.transaction.count({ where: { accountId } })).toBe(0);
  });

  it('accepts a BOM and CRLF line endings', async () => {
    const csv = `\ufeffDate,Description,Amount\r\n${isoDate(3)},Croissant,4.25\r\n`;

    const response = await importCsv(accountId, {
      csv,
      format: 'generic',
      mapping: { date: 'Date', description: 'Description', amount: 'Amount' },
    });

    expect(response.status).toBe(200);
    expect(response.body.imported).toBe(1);
  });
});

describe('POST /api/accounts/manual/:id/import and ownership', () => {
  it("answers 404 for another user's manual account", async () => {
    const other = await createAccount(OTHER_USER_ID);

    const response = await importCsv(other.id, { csv: appleCsv(), format: 'apple-card' });

    expect(response.status).toBe(404);
    expect(await prisma.transaction.count({ where: { accountId: other.id } })).toBe(0);
  });

  it('answers 404 for a Plaid account, which is not imported into', async () => {
    const item = await prisma.plaidItem.create({
      data: {
        userId: USER_ID,
        accessToken: `access-import-${stamp}`,
        itemId: `plaid-import-${stamp}`,
        institutionId: `ins-import-${stamp}`,
        institutionName: 'Import Test Bank',
        status: 'ACTIVE',
      },
    });

    const plaidAccount = await createAccount(USER_ID, {
      name: 'Plaid Checking',
      type: 'depository',
      subtype: 'checking',
      isManual: false,
      plaidAccountId: `acc-import-${stamp}`,
      plaidItemId: item.id,
    });

    const response = await importCsv(plaidAccount.id, { csv: appleCsv(), format: 'apple-card' });

    expect(response.status).toBe(404);
    expect(await prisma.transaction.count({ where: { accountId: plaidAccount.id } })).toBe(0);
  });

  it('answers 404 for an account that does not exist', async () => {
    const response = await importCsv(`missing-${stamp}`, { csv: appleCsv(), format: 'apple-card' });
    expect(response.status).toBe(404);
  });

  it('requires authentication', async () => {
    const response = await request(app)
      .post(`/api/accounts/manual/${accountId}/import`)
      .send({ csv: appleCsv(), format: 'apple-card' });

    expect(response.status).toBe(401);
  });

  it('leaves the account balance alone', async () => {
    const account = await createAccount(USER_ID, { currentBalance: 412.5 });
    await importCsv(account.id, { csv: appleCsv(), format: 'apple-card' });

    const saved = await prisma.account.findUnique({ where: { id: account.id } });
    expect(saved!.currentBalance).toBe(412.5);
    expect(await prisma.balanceSnapshot.count({ where: { accountId: account.id } })).toBe(0);
  });
});
