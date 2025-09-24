import { registerUser, loginUser } from '../../services/authService';
import { prisma } from '../../lib/prisma';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

const TEST_EMAIL = 'auth-service@example.com';
const OTHER_EMAIL = 'other@example.com';

beforeEach(async () => {
  await prisma.user.deleteMany({ where: { email: { in: [TEST_EMAIL, OTHER_EMAIL, 'nonexistent@example.com'] } } });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { in: [TEST_EMAIL, OTHER_EMAIL, 'nonexistent@example.com'] } } });
  await prisma.$disconnect();
});

test('should register user with valid data', async () => {
  const res = await registerUser(TEST_EMAIL, 'password123', 'Test User');
  expect(res.token).toBeDefined();
  expect(res.userWithoutPassword.email).toBe(TEST_EMAIL);
  expect((res.userWithoutPassword as any).passwordHash).toBeUndefined();
});

test('should reject duplicate email registration', async () => {
  await registerUser(TEST_EMAIL, 'password123', 'Test User');
  await expect(registerUser(TEST_EMAIL, 'password123', 'Test User')).rejects.toThrow('User already exists');
});

test('should login user with valid credentials', async () => {
  await registerUser(TEST_EMAIL, 'password123', 'Test User');
  const res = await loginUser(TEST_EMAIL, 'password123');
  expect(res.token).toBeDefined();
  expect(res.user.email).toBe(TEST_EMAIL);
  expect((res.user as any).passwordHash).toBeUndefined();
});

test('should reject login with invalid credentials', async () => {
  await registerUser(TEST_EMAIL, 'password123', 'Test User');
  await expect(loginUser(TEST_EMAIL, 'wrongpassword')).rejects.toThrow('Invalid credentials');
});

test('should reject login with non-existent user', async () => {
  await expect(loginUser('nonexistent@example.com', 'password123')).rejects.toThrow('Invalid credentials');
});