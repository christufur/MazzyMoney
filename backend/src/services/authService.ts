import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { generateToken } from './jwtService';

export const registerUser = async (email: string, password: string, fullName: string) => {
    try {
      // Check if user exists
      const existingUser = await prisma.user.findUnique({
        where: { email }
      });
      
      if (existingUser) {
        throw new Error('User already exists');
      }
      
      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);
      
      // Create user
      const user = await prisma.user.create({
        data: {
          email,
          fullName,
          passwordHash: hashedPassword
        }
      });
      
      // Generate token for auto-login
      const token = generateToken(user.id);
      
      // Return user WITHOUT password hash
      const { passwordHash, ...userWithoutPassword } = user;
      
      return {
        token,
        userWithoutPassword: userWithoutPassword
      };
      
    } catch (error) {
      console.error('Registration error:', error);
      
      // Re-throw specific errors, wrap unknown errors
      if (error instanceof Error) {
        throw error;
      } else {
        throw new Error('Registration failed');
      }
    }
  };

  export const loginUser = async (email: string, password: string) => {
    try {
        console.log('Logging in user...');

        const user = await prisma.user.findUnique({
            where: {
                email
            }
        });

        if (!user) {
            throw new Error("Invalid credentials"); 
        }

        const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

        if (!isPasswordValid) {
            throw new Error("Invalid credentials"); 
        }

        const token = generateToken(user.id);
        
        const { passwordHash, ...userWithoutPassword } = user;
        
        return {
            token,
            user: userWithoutPassword  // ← Fixed typo
        }
    } catch (error) {
        console.log('Failed to login user');
        if (error instanceof Error) {
            throw error;
        } else {
            throw new Error('Failed to login user');
        }
    }
};