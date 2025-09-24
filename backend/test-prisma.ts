import { prisma } from './src/lib/prisma';

async function createTestUser() {
  const user = await prisma.user.create({
    data: {
      email: 'test@example.com',
      passwordHash: 'temporary-hash',
      fullName: 'Test User'
    }
  });
  
  console.log('Created user:', user);
  return user;
}

createTestUser();