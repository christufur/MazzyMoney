import dotenv from 'dotenv';
dotenv.config(); // ← Add this line at the top

import { generateToken, verifyToken, extractTokenFromHeader } from './src/services/jwtService';

function testJWT() {
  console.log('Testing JWT service...');
  
  try {
    // Test 1: Generate token
    const token = generateToken('test-user-123');
    console.log('✅ Generated token:', token.substring(0, 50) + '...');
    
    // Test 2: Verify token
    const decoded = verifyToken(token);
    console.log('✅ Decoded payload:', decoded);
    
    // Test 3: Extract from header
    const extracted = extractTokenFromHeader(`Bearer ${token}`);
    console.log('✅ Token extraction works:', extracted === token);
    
    // Test 4: Invalid header
    const invalid = extractTokenFromHeader('Invalid header');
    console.log('✅ Invalid header returns null:', invalid === null);
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

testJWT();