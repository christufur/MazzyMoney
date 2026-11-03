import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, mock } from 'bun:test';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

// The route reads and writes the users table. Plaid is never involved.
const anyPlaidCall = mock(async () => {
  throw new Error('the settings route must not call Plaid');
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
const USER_ID = `settings-user-${stamp}`;
const OTHER_USER_ID = `settings-other-${stamp}`;
const TOPIC = `mazzy-settings-${stamp}`;

const realFetch = globalThis.fetch;
const fetchMock = mock(async (_url: any, _init?: any) => new Response('ok', { status: 200 }));

const authHeader = (userId = USER_ID) =>
  `Bearer ${jwt.sign({ userId }, process.env.JWT_SECRET!)}`;

const getSettings = () =>
  request(app).get('/api/settings/notifications').set('Authorization', authHeader());

const putSettings = (body: Record<string, unknown>, userId = USER_ID) =>
  request(app)
    .put('/api/settings/notifications')
    .set('Authorization', authHeader(userId))
    .send(body);

const testPush = () =>
  request(app).post('/api/settings/notifications/test').set('Authorization', authHeader());

const cleanup = async () => {
  await prisma.notificationLog.deleteMany({ where: { userId: { in: [USER_ID, OTHER_USER_ID] } } });
  await prisma.user.deleteMany({ where: { id: { in: [USER_ID, OTHER_USER_ID] } } });
};

const createUsers = async () => {
  await prisma.user.create({
    data: {
      id: USER_ID,
      email: `settings-${stamp}@example.com`,
      fullName: 'Settings Tester',
      passwordHash: 'hash',
    },
  });
  await prisma.user.create({
    data: {
      id: OTHER_USER_ID,
      email: `settings-other-${stamp}@example.com`,
      fullName: 'Other Tester',
      passwordHash: 'hash',
    },
  });
};

describe('Notification settings routes', () => {
  beforeAll(async () => {
    await cleanup();
  });

  beforeEach(async () => {
    await cleanup();
    await createUsers();
    process.env.NTFY_URL = 'http://ntfy.test';
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

  it('requires a login', async () => {
    expect((await request(app).get('/api/settings/notifications')).status).toBe(401);
    expect((await request(app).put('/api/settings/notifications').send({})).status).toBe(401);
    expect((await request(app).post('/api/settings/notifications/test')).status).toBe(401);
  });

  it('returns the defaults for a user who never opened the page', async () => {
    const response = await getSettings();

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ntfyTopic: null,
      notifyLargeOver: null,
      notifyWeekly: true,
      serverConfigured: true,
    });
  });

  it('reports serverConfigured false when NTFY_URL is unset', async () => {
    delete process.env.NTFY_URL;

    const response = await getSettings();

    expect(response.status).toBe(200);
    expect(response.body.serverConfigured).toBe(false);
  });

  it('saves a topic, an amount and the weekly switch', async () => {
    const response = await putSettings({
      ntfyTopic: TOPIC,
      notifyLargeOver: 250.456,
      notifyWeekly: false,
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ntfyTopic: TOPIC,
      // Money is rounded to cents on write, like every other amount in the app.
      notifyLargeOver: 250.46,
      notifyWeekly: false,
    });

    const saved = await prisma.user.findUnique({ where: { id: USER_ID } });
    expect(saved!.ntfyTopic).toBe(TOPIC);
    expect(saved!.notifyWeekly).toBe(false);

    // A second GET reads the same values back.
    expect((await getSettings()).body).toMatchObject({ ntfyTopic: TOPIC, notifyWeekly: false });
  });

  it('only changes the fields that were sent', async () => {
    await putSettings({ ntfyTopic: TOPIC, notifyLargeOver: 100, notifyWeekly: false });

    const response = await putSettings({ notifyWeekly: true });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ntfyTopic: TOPIC,
      notifyLargeOver: 100,
      notifyWeekly: true,
    });
  });

  it('clears the topic and the amount with null', async () => {
    await putSettings({ ntfyTopic: TOPIC, notifyLargeOver: 100 });

    const response = await putSettings({ ntfyTopic: null, notifyLargeOver: null });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ntfyTopic: null, notifyLargeOver: null });
  });

  it('rejects a topic with spaces or punctuation', async () => {
    for (const topic of ['has space', 'semi;colon', 'emoji😀', 'a'.repeat(65)]) {
      const response = await putSettings({ ntfyTopic: topic });
      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Topic');
    }

    expect((await getSettings()).body.ntfyTopic).toBeNull();
  });

  it('accepts letters, numbers, dash and underscore', async () => {
    const response = await putSettings({ ntfyTopic: 'Mazzy_Household-2026' });

    expect(response.status).toBe(200);
    expect(response.body.ntfyTopic).toBe('Mazzy_Household-2026');
  });

  it('trims a pasted topic', async () => {
    const response = await putSettings({ ntfyTopic: `  ${TOPIC}\n` });

    expect(response.body.ntfyTopic).toBe(TOPIC);
  });

  it('rejects a negative amount and a non-number', async () => {
    expect((await putSettings({ notifyLargeOver: -1 })).status).toBe(400);
    expect((await putSettings({ notifyLargeOver: 'lots' })).status).toBe(400);
  });

  it('accepts zero as a real threshold', async () => {
    const response = await putSettings({ notifyLargeOver: 0 });

    expect(response.status).toBe(200);
    expect(response.body.notifyLargeOver).toBe(0);
  });

  it('rejects a non-boolean weekly switch', async () => {
    expect((await putSettings({ notifyWeekly: 'yes' })).status).toBe(400);
  });

  it('rejects an empty body', async () => {
    const response = await putSettings({});

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Nothing to update');
  });

  it('never touches another user\'s settings', async () => {
    await putSettings({ ntfyTopic: `mazzy-other-${stamp}` }, OTHER_USER_ID);

    const mine = await getSettings();

    expect(mine.body.ntfyTopic).toBeNull();
  });

  it('sends a test push and reports it', async () => {
    await putSettings({ ntfyTopic: TOPIC });

    const response = await testPush();

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ sent: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      `http://ntfy.test/${encodeURIComponent(TOPIC)}`
    );
  });

  it('says why a test push did not go out', async () => {
    const noTopic = await testPush();
    expect(noTopic.body).toEqual({ sent: false, reason: 'no-topic' });

    delete process.env.NTFY_URL;
    await putSettings({ ntfyTopic: TOPIC });
    const notConfigured = await testPush();
    expect(notConfigured.body).toEqual({ sent: false, reason: 'not-configured' });
  });

  it('reports a failed send without a 500', async () => {
    await putSettings({ ntfyTopic: TOPIC });
    fetchMock.mockImplementation(async () => new Response('bad', { status: 502 }));

    const response = await testPush();

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ sent: false, reason: 'send-failed' });
  });
});
