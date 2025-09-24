import { app } from '../../index';
import { prisma } from '../../lib/prisma';
import request from 'supertest';

describe('Auth Routes', () => {
    beforeEach(async () => {
        await prisma.user.deleteMany({});
    });
});


test('should register user with valid data', async () => {
    const res = await request(app)
        .post('/api/auth/register')
        .send({
            email: 'test@example.com',
            password: 'password123',
            fullName: 'Test User'
        });
    expect(res.status).toBe(201);
});

afterAll(async () => {
    await prisma.$disconnect();
});

test('should login user with valid credentials', async () => {
    const res = await request(app)
        .post('/api/auth/login')
        .send({
            email: 'test@example.com',
            password: 'password123'
        });
    expect(res.status).toBe(200);
});

afterAll(async () => {
    await prisma.$disconnect();
});