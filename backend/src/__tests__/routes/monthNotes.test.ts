import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

const anyPlaidCall = mock(async () => {
  throw new Error('the month-notes route must not call Plaid');
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

import { app } from '../../index';
import { prisma } from '../../lib/prisma';

const stamp = Date.now();
const USER_ID = `month-note-user-${stamp}`;
const OTHER_USER_ID = `month-note-other-${stamp}`;

const auth = (userId = USER_ID) => `Bearer ${jwt.sign({ userId }, process.env.JWT_SECRET!)}`;
const get = (month: string, userId = USER_ID) =>
  request(app).get(`/api/month-notes/${month}`).set('Authorization', auth(userId));
const put = (month: string, body: Record<string, unknown>, userId = USER_ID) =>
  request(app).put(`/api/month-notes/${month}`).set('Authorization', auth(userId)).send(body);

const cleanup = () => prisma.user.deleteMany({ where: { id: { in: [USER_ID, OTHER_USER_ID] } } });

describe('Month notes routes', () => {
  beforeEach(async () => {
    await cleanup();
    for (const id of [USER_ID, OTHER_USER_ID]) {
      await prisma.user.create({
        data: { id, email: `${id}@example.com`, fullName: 'Month Tester', passwordHash: 'hash' },
      });
    }
  });

  afterAll(cleanup);

  it('reads an untouched month as open with no note', async () => {
    const res = await get('2026-10');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ month: '2026-10', note: null, savingsTarget: null, closedAt: null });
  });

  it('saves a note, closes the month, and keeps the first close date', async () => {
    const first = await put('2026-10', { note: '  Car repair month.  ', closed: true });
    expect(first.status).toBe(200);
    expect(first.body.note).toBe('Car repair month.');
    expect(first.body.closedAt).toBeTruthy();

    const again = await put('2026-10', { note: 'Car repair month. Fine.', closed: true });
    expect(again.body.closedAt).toBe(first.body.closedAt);
    expect(again.body.note).toBe('Car repair month. Fine.');

    const reopened = await put('2026-10', { closed: false });
    expect(reopened.body.closedAt).toBeNull();
    expect(reopened.body.note).toBe('Car repair month. Fine.');
  });

  it('stores a savings target on its own month and leaves other fields alone', async () => {
    await put('2026-11', { note: 'keep me' });
    const res = await put('2026-11', { savingsTarget: 500.555 });
    expect(res.body).toMatchObject({ note: 'keep me', savingsTarget: 500.56, closedAt: null });

    const cleared = await put('2026-11', { savingsTarget: null });
    expect(cleared.body.savingsTarget).toBeNull();
  });

  it('keeps each user to their own months', async () => {
    await put('2026-10', { note: 'mine' });
    const other = await get('2026-10', OTHER_USER_ID);
    expect(other.body.note).toBeNull();
  });

  it('rejects bad input', async () => {
    expect((await get('2026-13')).status).toBe(400);
    expect((await put('october', { note: 'x' })).status).toBe(400);
    expect((await put('2026-10', { savingsTarget: -1 })).status).toBe(400);
    expect((await put('2026-10', { savingsTarget: '500' })).status).toBe(400);
    expect((await put('2026-10', { closed: 'yes' })).status).toBe(400);
    expect((await put('2026-10', { note: 'x'.repeat(2001) })).status).toBe(400);
  });

  it('requires a login', async () => {
    expect((await request(app).get('/api/month-notes/2026-10')).status).toBe(401);
  });
});
