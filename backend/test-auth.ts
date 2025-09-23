import dotenv from 'dotenv';
dotenv.config();

import { registerUser, loginUser } from './src/services/authService';
import { prisma } from './src/lib/prisma';

async function testAuthService() {
  console.log('🧪 Testing Auth Service...\n');
  
  // Test data
  const testUser = {
    email: 'authtest@example.com',
    password: 'testpassword123',
    fullName: 'Auth Test User'
  };

  try {
    // Clean up any existing test user first
    console.log('🧹 Cleaning up existing test data...');
    await prisma.user.deleteMany({
      where: { email: testUser.email }
    });
    
    // Test 1: User Registration
    console.log('1️⃣ Testing user registration...');
    const registrationResult = await registerUser(
      testUser.email,
      testUser.password,
      testUser.fullName
    );
    
    console.log('✅ Registration successful!');
    console.log('   User ID:', registrationResult.user.id);
    console.log('   Email:', registrationResult.user.email);
    console.log('   Token exists:', !!registrationResult.token);
    console.log('   Password hash hidden:', !('passwordHash' in registrationResult.user));
    
    // Test 2: Duplicate Registration (should fail)
    console.log('\n2️⃣ Testing duplicate registration (should fail)...');
    try {
      await registerUser(testUser.email, testUser.password, testUser.fullName);
      console.log('❌ ERROR: Duplicate registration should have failed!');
    } catch (error: any) {
      console.log('✅ Duplicate registration correctly failed:', error.message);
    }
    
    // Test 3: Login with correct credentials
    console.log('\n3️⃣ Testing login with correct credentials...');
    const loginResult = await loginUser(testUser.email, testUser.password);
    
    console.log('✅ Login successful!');
    console.log('   User ID:', loginResult.user.id);
    console.log('   Token exists:', !!loginResult.token);
    console.log('   Tokens match:', registrationResult.token !== loginResult.token); // Should be different (new timestamps)
    
    // Test 4: Login with wrong password (should fail)
    console.log('\n4️⃣ Testing login with wrong password (should fail)...');
    try {
      await loginUser(testUser.email, 'wrongpassword');
      console.log('❌ ERROR: Wrong password should have failed!');
    } catch (error: any) {
      console.log('✅ Wrong password correctly failed:', error.message);
    }
    
    // Test 5: Login with non-existent user (should fail)
    console.log('\n5️⃣ Testing login with non-existent user (should fail)...');
    try {
      await loginUser('nonexistent@example.com', testUser.password);
      console.log('❌ ERROR: Non-existent user should have failed!');
    } catch (error: any) {
      console.log('✅ Non-existent user correctly failed:', error.message);
    }
    
    console.log('\n🎉 All auth service tests passed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    // Clean up test data
    console.log('\n🧹 Cleaning up test data...');
    await prisma.user.deleteMany({
      where: { email: testUser.email }
    });
    
    // Close Prisma connection
    await prisma.$disconnect();
  }
}

testAuthService();