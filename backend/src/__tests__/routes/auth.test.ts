import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

import { app } from '../../index';
import { prisma } from '../../lib/prisma';

describe('Auth Routes', () => {
  beforeEach(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: '@example.com' } } });
  });

afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: '@example.com' } } });
    await prisma.$disconnect();
  });

  it('registers a user', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ email: 'test@example.com', password: 'password123', fullName: 'Test User' });

    expect(response.status).toBe(201);
    expect(response.body.token).toBeDefined();
  });

  it('logs in an existing user', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ email: 'login@example.com', password: 'password123', fullName: 'Login User' });

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'login@example.com', password: 'password123' });

    expect(response.status).toBe(200);
    expect(response.body.token).toBeDefined();
  });
});