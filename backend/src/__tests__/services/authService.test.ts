import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import jwt from 'jsonwebtoken';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.INVITE_CODE = 'test-invite';

import { registerUser, loginUser, toPublicUser } from '../../services/authService';
import { prisma } from '../../lib/prisma';

// The test database is shared with other agents, so every email is unique and cleanup is scoped.
const STAMP = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const CREATED_EMAILS: string[] = [];

const uniqueEmail = (label: string) => {
  const email = `auth-service-${label}-${STAMP}@example.com`;
  CREATED_EMAILS.push(email);
  return email;
};

const decodeToken = (token: string) => jwt.decode(token) as { userId: string; iat: number; exp: number };

beforeAll(async () => {
  // Make sure at least one user exists, so registration is in invite-only mode.
  if ((await prisma.user.count()) === 0) {
    await registerUser(uniqueEmail('seed'), 'password123', 'Seed User');
  }
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { in: CREATED_EMAILS } } });
  await prisma.$disconnect();
});

describe('toPublicUser', () => {
  test('returns only the public fields', () => {
    const row = {
      id: 'user_1',
      email: 'public@example.com',
      fullName: 'Public User',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      passwordHash: 'hashed',
      plaidAccessToken: 'access-sandbox-secret',
    };

    const publicUser = toPublicUser(row);

    expect(Object.keys(publicUser).sort()).toEqual(['createdAt', 'email', 'fullName', 'id']);
    expect(publicUser).toEqual({
      id: 'user_1',
      email: 'public@example.com',
      fullName: 'Public User',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
  });
});

describe('registerUser', () => {
  test('returns { token, user } with no password hash and no Plaid token', async () => {
    const email = uniqueEmail('register');

    const res = await registerUser(email, 'password123', 'Test User', 'test-invite');

    expect(res.token).toBeDefined();
    expect(Object.keys(res).sort()).toEqual(['token', 'user']);
    expect(res.user.email).toBe(email);
    expect(res.user.fullName).toBe('Test User');
    expect(res.user.createdAt).toBeInstanceOf(Date);
    expect((res.user as any).passwordHash).toBeUndefined();
    expect((res.user as any).plaidAccessToken).toBeUndefined();
    expect(Object.keys(res.user).sort()).toEqual(['createdAt', 'email', 'fullName', 'id']);
  });

  test('rejects duplicate email registration', async () => {
    const email = uniqueEmail('dupe');
    await registerUser(email, 'password123', 'Other User', 'test-invite');

    await expect(
      registerUser(email, 'password123', 'Other User', 'test-invite')
    ).rejects.toThrow('User already exists');
  });

  test('rejects registration without the invite code once a user exists', async () => {
    await expect(
      registerUser(uniqueEmail('no-code'), 'password123', 'Test User')
    ).rejects.toThrow('Invite code required');
  });

  test('rejects registration with a wrong invite code', async () => {
    await expect(
      registerUser(uniqueEmail('wrong-code'), 'password123', 'Test User', 'wrong-code')
    ).rejects.toThrow('Invite code required');
  });

  test('rejects registration when INVITE_CODE is not configured', async () => {
    const original = process.env.INVITE_CODE;
    delete process.env.INVITE_CODE;

    try {
      await expect(
        registerUser(uniqueEmail('unset-code'), 'password123', 'Test User', 'test-invite')
      ).rejects.toThrow('Invite code required');
    } finally {
      process.env.INVITE_CODE = original;
    }
  });
});

describe('loginUser', () => {
  test('returns the public user shape and a token with an exp claim', async () => {
    const email = uniqueEmail('login');
    const registered = await registerUser(email, 'password123', 'Test User', 'test-invite');

    const res = await loginUser(email, 'password123');

    expect(res.token).toBeDefined();
    expect(Object.keys(res).sort()).toEqual(['token', 'user']);
    expect(res.user.email).toBe(email);
    expect(res.user.id).toBe(registered.user.id);
    expect((res.user as any).passwordHash).toBeUndefined();
    expect((res.user as any).plaidAccessToken).toBeUndefined();
    expect(Object.keys(res.user).sort()).toEqual(['createdAt', 'email', 'fullName', 'id']);

    const decoded = decodeToken(res.token);
    expect(typeof decoded.exp).toBe('number');
    expect(decoded.userId).toBe(res.user.id);
  });

  test('defaults the token lifetime to 30 days', async () => {
    const email = uniqueEmail('login-default-exp');
    await registerUser(email, 'password123', 'Test User', 'test-invite');

    delete process.env.JWT_EXPIRES_IN;

    const res = await loginUser(email, 'password123');
    const decoded = decodeToken(res.token);

    expect(decoded.exp - decoded.iat).toBe(30 * 24 * 60 * 60);
  });

  test('honours JWT_EXPIRES_IN', async () => {
    const email = uniqueEmail('login-custom-exp');
    await registerUser(email, 'password123', 'Test User', 'test-invite');

    process.env.JWT_EXPIRES_IN = '1h';

    try {
      const res = await loginUser(email, 'password123');
      const decoded = decodeToken(res.token);

      expect(decoded.exp - decoded.iat).toBe(60 * 60);
    } finally {
      delete process.env.JWT_EXPIRES_IN;
    }
  });

  test('rejects login with invalid credentials', async () => {
    const email = uniqueEmail('login-bad-password');
    await registerUser(email, 'password123', 'Test User', 'test-invite');

    await expect(loginUser(email, 'wrongpassword')).rejects.toThrow('Invalid credentials');
  });

  test('rejects login with a non-existent user', async () => {
    await expect(
      loginUser(`auth-service-missing-${STAMP}@example.com`, 'password123')
    ).rejects.toThrow('Invalid credentials');
  });
});
