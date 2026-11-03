import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { generateToken } from './jwtService';

// The only user shape that may leave the server: no password hash, no Plaid token.
type UserRow = {
  id: string;
  email: string;
  fullName: string;
  createdAt: Date;
};

export type PublicUser = {
  id: string;
  email: string;
  fullName: string;
  createdAt: Date;
};

export const toPublicUser = (user: UserRow): PublicUser => ({
  id: user.id,
  email: user.email,
  fullName: user.fullName,
  createdAt: user.createdAt,
});

// The first user can register freely; after that a shared invite code is required.
const assertInviteAllowed = async (inviteCode?: string) => {
  const userCount = await prisma.user.count();

  if (userCount === 0) {
    return;
  }

  // shortcut: one shared code in env; upgrade to per-invite codes only if a household member must be revoked.
  const expectedCode = process.env.INVITE_CODE;

  if (!expectedCode || inviteCode !== expectedCode) {
    throw new Error('Invite code required');
  }
};

export const registerUser = async (
  email: string,
  password: string,
  fullName: string,
  inviteCode?: string
) => {
  try {
    await assertInviteAllowed(inviteCode);

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

    return {
      token,
      user: toPublicUser(user)
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

    return {
      token,
      user: toPublicUser(user)
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
