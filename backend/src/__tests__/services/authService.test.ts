import {registerUser, loginUser} from '../../services/authService';

import {prisma} from '../../lib/prisma';

describe('AuthService', () => {
    beforeEach(async () => {
        await prisma.user.deleteMany({
            where: {email: 'test@example.com'}
        })
    });
});

test('should register user with valid data', async () => {
    const res = await registerUser('test@example.com', 'password123', 'Test User');
    expect(res.token).toBeDefined();
    expect(res.userWithoutPassword.email).toBe('test@example.com');
    expect((res.userWithoutPassword as any).passwordHash).toBeUndefined();
});

test('should reject duplicate email registration', async () => {
    await registerUser('test@example.com', 'password123', 'Test User');
    await expect(registerUser('test@example.com', 'password123', 'Test User')).rejects.toThrow('User already exists');
});

test('should login user with valid credentials', async () => {
    await registerUser('test@example.com', 'password123', 'Test User');
    const res = await loginUser('test@example.com', 'password123');
    expect(res.token).toBeDefined();
    expect(res.user.email).toBe('test@example.com');
    expect((res.user as any).passwordHash).toBeUndefined();
});

test('should reject login with invalid credentials', async () => {
    await registerUser('test@example.com', 'password123', 'Test User');
    await expect(loginUser('test@example.com', 'wrongpassword')).rejects.toThrow('Invalid credentials');
});

test('should reject login with non-existent user', async () => {
    await expect(loginUser('nonexistent@example.com', 'password123')).rejects.toThrow('Invalid credentials');
});

afterAll(async () => {
    await prisma.$disconnect();
});