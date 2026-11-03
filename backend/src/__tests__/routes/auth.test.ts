import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.INVITE_CODE = 'test-invite';

import { app } from '../../index';
import { prisma } from '../../lib/prisma';

// The test database is shared with other agents, so every email is unique and cleanup is scoped.
const STAMP = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const CREATED_EMAILS: string[] = [];

const uniqueEmail = (label: string) => {
  const email = `auth-route-${label}-${STAMP}@example.com`;
  CREATED_EMAILS.push(email);
  return email;
};

const decodeToken = (token: string) => jwt.decode(token) as { userId: string; iat: number; exp: number };

const register = (email: string, extra: Record<string, unknown> = {}) =>
  request(app)
    .post('/api/auth/register')
    .send({ email, password: 'password123', fullName: 'Route User', ...extra });

beforeAll(async () => {
  // Make sure at least one user exists, so registration is in invite-only mode.
  if ((await prisma.user.count()) === 0) {
    await register(uniqueEmail('seed'), { inviteCode: 'test-invite' });
  }
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { in: CREATED_EMAILS } } });
  await prisma.$disconnect();
});

describe('POST /api/auth/register', () => {
  it('returns { token, user } with the public shape', async () => {
    const email = uniqueEmail('register');

    const response = await register(email, { inviteCode: 'test-invite' });

    expect(response.status).toBe(201);
    expect(Object.keys(response.body).sort()).toEqual(['token', 'user']);
    expect(response.body.token).toBeDefined();
    expect(response.body.user.email).toBe(email);
    expect(Object.keys(response.body.user).sort()).toEqual(['createdAt', 'email', 'fullName', 'id']);
  });

  it('returns 403 without an invite code once a user exists', async () => {
    const response = await register(uniqueEmail('no-code'));

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'Invite code required' });
  });

  it('returns 403 with a wrong invite code', async () => {
    const response = await register(uniqueEmail('wrong-code'), { inviteCode: 'nope' });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'Invite code required' });
  });

  it('returns 403 when INVITE_CODE is not configured', async () => {
    const original = process.env.INVITE_CODE;
    delete process.env.INVITE_CODE;

    try {
      const response = await register(uniqueEmail('unset-code'), { inviteCode: 'test-invite' });

      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: 'Invite code required' });
    } finally {
      process.env.INVITE_CODE = original;
    }
  });

  it('returns 409 for a duplicate email', async () => {
    const email = uniqueEmail('dupe');
    await register(email, { inviteCode: 'test-invite' });

    const response = await register(email, { inviteCode: 'test-invite' });

    expect(response.status).toBe(409);
  });

  it('returns 400 when fields are missing', async () => {
    const response = await request(app).post('/api/auth/register').send({});

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Missing required fields' });
  });
});

describe('POST /api/auth/login', () => {
  it('returns a public user with no plaidAccessToken and no passwordHash', async () => {
    const email = uniqueEmail('login');
    await register(email, { inviteCode: 'test-invite' });

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'password123' });

    expect(response.status).toBe(200);
    expect(response.body.token).toBeDefined();
    expect(Object.keys(response.body).sort()).toEqual(['token', 'user']);
    expect(response.body.user.email).toBe(email);
    expect(response.body.user).not.toHaveProperty('passwordHash');
    expect(response.body.user).not.toHaveProperty('plaidAccessToken');
    expect(Object.keys(response.body.user).sort()).toEqual(['createdAt', 'email', 'fullName', 'id']);
  });

  it('issues a token that decodes with an exp claim', async () => {
    const email = uniqueEmail('login-exp');
    await register(email, { inviteCode: 'test-invite' });

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'password123' });

    const decoded = decodeToken(response.body.token);
    expect(typeof decoded.exp).toBe('number');
    expect(decoded.userId).toBe(response.body.user.id);
  });

  it('returns 401 for wrong credentials', async () => {
    const email = uniqueEmail('login-bad');
    await register(email, { inviteCode: 'test-invite' });

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'wrongpassword' });

    expect(response.status).toBe(401);
  });
});

describe('GET /api/auth/me', () => {
  it('returns the public user shape', async () => {
    const email = uniqueEmail('me');
    const registered = await register(email, { inviteCode: 'test-invite' });

    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${registered.body.token}`);

    expect(response.status).toBe(200);
    expect(Object.keys(response.body.user).sort()).toEqual(['createdAt', 'email', 'fullName', 'id']);
    expect(response.body.user.email).toBe(email);
    expect(response.body.user).not.toHaveProperty('passwordHash');
    expect(response.body.user).not.toHaveProperty('plaidAccessToken');
  });

  it('returns 401 without a token', async () => {
    const response = await request(app).get('/api/auth/me');

    expect(response.status).toBe(401);
  });
});

describe('POST /api/admin/sync-all', () => {
  it('returns 503 when ADMIN_API_KEY is not configured', async () => {
    const original = process.env.ADMIN_API_KEY;
    delete process.env.ADMIN_API_KEY;

    try {
      const response = await request(app).post('/api/admin/sync-all').send({ adminKey: 'anything' });

      expect(response.status).toBe(503);
      expect(response.body).toEqual({ error: 'Admin endpoint disabled' });
    } finally {
      process.env.ADMIN_API_KEY = original;
    }
  });

  it('returns 401 for a wrong key and for a missing body', async () => {
    const wrongKey = await request(app).post('/api/admin/sync-all').send({ adminKey: 'nope' });
    expect(wrongKey.status).toBe(401);
    expect(wrongKey.body).toEqual({ error: 'Unauthorized' });

    const noBody = await request(app).post('/api/admin/sync-all');
    expect(noBody.status).toBe(401);
    expect(noBody.body).toEqual({ error: 'Unauthorized' });
  });
});
