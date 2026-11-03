import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, mock, type Mock } from 'bun:test';
import { prisma } from '../../lib/prisma';
import { NotifyService, householdDay } from '../../services/notifyService';

// No real network: ntfy is a fake `fetch` on globalThis. Every row carries `stamp` and
// cleanup only ever targets rows this file created.
const stamp = Date.now();
const USER_ID = `notify-user-${stamp}`;
const OTHER_USER_ID = `notify-other-${stamp}`;
const TOPIC = `mazzy-notify-${stamp}`;

const realFetch = globalThis.fetch;
const fetchMock = mock(async (_url: any, _init?: any) => new Response('ok', { status: 200 }));

const cleanup = async () => {
  const users = [USER_ID, OTHER_USER_ID];
  await prisma.notificationLog.deleteMany({ where: { userId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
};

const setTopic = (topic: string | null) =>
  prisma.user.update({ where: { id: USER_ID }, data: { ntfyTopic: topic } });

/** The arguments of the nth `fetch` call, narrowed so the test can read them. */
const callAt = (index: number) => {
  const [url, init] = fetchMock.mock.calls[index] as unknown as [string, any];
  return { url, headers: init.headers as Record<string, string>, body: init.body as string };
};

const notification = (overrides: Record<string, any> = {}) => ({
  kind: 'large-charge',
  key: `tx-${stamp}`,
  title: '$250 at Whole Foods',
  message: 'You spent $250.00 at Whole Foods.',
  tags: ['moneybag'],
  priority: 4,
  click: '/transactions',
  ...overrides,
});

describe('NotifyService', () => {
  beforeAll(async () => {
    await cleanup();
    await prisma.user.create({
      data: {
        id: USER_ID,
        email: `notify-${stamp}@example.com`,
        fullName: 'Notify Tester',
        passwordHash: 'hash',
      },
    });
    await prisma.user.create({
      data: {
        id: OTHER_USER_ID,
        email: `notify-other-${stamp}@example.com`,
        fullName: 'Other Tester',
        passwordHash: 'hash',
      },
    });
  });

  beforeEach(async () => {
    process.env.NTFY_URL = 'http://ntfy.test';
    process.env.APP_URL = 'https://money.example.ts.net';
    await cleanup();
    await prisma.user.create({
      data: {
        id: USER_ID,
        email: `notify-${stamp}@example.com`,
        fullName: 'Notify Tester',
        passwordHash: 'hash',
      },
    });
    await prisma.user.create({
      data: {
        id: OTHER_USER_ID,
        email: `notify-other-${stamp}@example.com`,
        fullName: 'Other Tester',
        passwordHash: 'hash',
      },
    });
    await setTopic(TOPIC);

    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => new Response('ok', { status: 200 }));
    (globalThis as any).fetch = fetchMock;
  });

  afterEach(() => {
    (globalThis as any).fetch = realFetch;
  });

  afterAll(async () => {
    (globalThis as any).fetch = realFetch;
    await cleanup();
    await prisma.$disconnect();
  });

  it('posts the message to the topic with Title, Tags, Priority and Click', async () => {
    const result = await NotifyService.notify(USER_ID, notification());

    expect(result).toEqual({ sent: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const { url, headers, body } = callAt(0);
    expect(url).toBe(`http://ntfy.test/${encodeURIComponent(TOPIC)}`);
    expect(headers.Title).toBe('$250 at Whole Foods');
    expect(headers.Tags).toBe('moneybag');
    expect(headers.Priority).toBe('4');
    expect(headers.Click).toBe('https://money.example.ts.net/transactions');
    // ntfy shows the body as the notification text; it is plain text, not JSON.
    expect(body).toBe('You spent $250.00 at Whole Foods.');
  });

  it('joins several tags and leaves Click off when APP_URL is not set', async () => {
    delete process.env.APP_URL;

    await NotifyService.notify(USER_ID, notification({ tags: ['bank', 'warning'] }));

    const { headers } = callAt(0);
    expect(headers.Tags).toBe('bank,warning');
    expect(headers.Click).toBeUndefined();
  });

  it('sends the same kind and key only once', async () => {
    const first = await NotifyService.notify(USER_ID, notification());
    const second = await NotifyService.notify(USER_ID, notification());

    expect(first).toEqual({ sent: true });
    expect(second).toEqual({ sent: false, reason: 'duplicate' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const logs = await prisma.notificationLog.findMany({ where: { userId: USER_ID } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ userId: USER_ID, kind: 'large-charge', key: `tx-${stamp}` });
  });

  it('lets a different kind use the same key', async () => {
    await NotifyService.notify(USER_ID, notification());
    const other = await NotifyService.notify(USER_ID, notification({ kind: 'weekly' }));

    expect(other).toEqual({ sent: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does nothing, without an error, when NTFY_URL is not set', async () => {
    delete process.env.NTFY_URL;

    const result = await NotifyService.notify(USER_ID, notification());

    expect(result).toEqual({ sent: false, reason: 'not-configured' });
    expect(fetchMock).not.toHaveBeenCalled();
    // No log row either: the event was never claimed, so a later run can still send it.
    expect(await prisma.notificationLog.count({ where: { userId: USER_ID } })).toBe(0);
  });

  it('does nothing, without an error, when the user has no topic', async () => {
    await setTopic(null);

    const result = await NotifyService.notify(USER_ID, notification());

    expect(result).toEqual({ sent: false, reason: 'no-topic' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await prisma.notificationLog.count({ where: { userId: USER_ID } })).toBe(0);
  });

  it('never throws when ntfy is unreachable', async () => {
    fetchMock.mockImplementation(async () => {
      throw new Error('connect ECONNREFUSED');
    });

    const result = await NotifyService.notify(USER_ID, notification());

    expect(result).toEqual({ sent: false, reason: 'send-failed' });
  });

  it('reports a non-2xx answer as a failed send instead of throwing', async () => {
    fetchMock.mockImplementation(async () => new Response('nope', { status: 500 }));

    const result = await NotifyService.notify(USER_ID, notification());

    expect(result).toEqual({ sent: false, reason: 'send-failed' });
  });

  it('sendTest posts without writing a dedupe row, so it can run twice', async () => {
    const first = await NotifyService.sendTest(USER_ID);
    const second = await NotifyService.sendTest(USER_ID);

    expect(first).toEqual({ sent: true });
    expect(second).toEqual({ sent: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await prisma.notificationLog.count({ where: { userId: USER_ID } })).toBe(0);
  });

  it('sendTest says why when the server has no ntfy address', async () => {
    delete process.env.NTFY_URL;

    expect(await NotifyService.sendTest(USER_ID)).toEqual({
      sent: false,
      reason: 'not-configured',
    });
  });

  it('sends the test to the user\'s own topic', async () => {
    await NotifyService.sendTest(USER_ID);

    expect(callAt(0).url).toBe(`http://ntfy.test/${encodeURIComponent(TOPIC)}`);
    expect(callAt(0).headers.Title).toBe('Mazzy Money');
  });
});

describe('householdDay', () => {
  afterEach(() => {
    delete process.env.APP_TIMEZONE;
  });

  it('keeps the Denver day at 23:30 local, when UTC has already rolled over', () => {
    // 2026-11-03T06:30:00Z is 23:30 on Nov 2 in Denver (MST, UTC-7).
    const evening = new Date('2026-11-03T06:30:00.000Z');

    expect(householdDay(evening).toISOString()).toBe('2026-11-02T00:00:00.000Z');
  });

  it('returns the household day just after midnight local', () => {
    // 2026-11-03T07:30:00Z is 00:30 on Nov 3 in Denver, where UTC is still on the 3rd too.
    const afterMidnight = new Date('2026-11-03T07:30:00.000Z');

    expect(householdDay(afterMidnight).toISOString()).toBe('2026-11-03T00:00:00.000Z');
  });

  it('follows APP_TIMEZONE', () => {
    process.env.APP_TIMEZONE = 'Asia/Tokyo';
    // 15:30Z is already the next day in Tokyo (UTC+9).
    const afternoon = new Date('2026-11-02T15:30:00.000Z');

    expect(householdDay(afternoon).toISOString()).toBe('2026-11-03T00:00:00.000Z');
  });

  it('is a UTC-midnight date, the shape of every transaction date', () => {
    const day = householdDay(new Date('2026-11-02T20:00:00.000Z'));

    expect(day.getUTCHours()).toBe(0);
    expect(day.getUTCMinutes()).toBe(0);
    expect(day.toISOString()).toBe('2026-11-02T00:00:00.000Z');
  });
});
