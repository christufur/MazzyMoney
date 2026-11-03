import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const DEFAULT_JWT_EXPIRES_IN = '30d';

// Read lazily so tests (and a reloaded env) can set these before the first sign.
const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is required');
  }
  return secret;
};

const getJwtExpiresIn = () => process.env.JWT_EXPIRES_IN || DEFAULT_JWT_EXPIRES_IN;

export const generateToken = (userId: string) => {
  const payload = {
    userId,
  };

  return jwt.sign(payload, getJwtSecret(), {
    expiresIn: getJwtExpiresIn() as jwt.SignOptions['expiresIn'],
  });
};

export const verifyToken = (token: string) => {
  try {
    return jwt.verify(token, getJwtSecret());
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new Error('Token expired');
    } else if (error instanceof jwt.JsonWebTokenError) {
      throw new Error('Invalid token');
    }
    throw new Error('Token verification failed');
  }
};

export const extractTokenFromHeader = (authHeader?: string) => {
  if (!authHeader) {
    return null;
  }

  if (authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  return null;
};
