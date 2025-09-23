import { Request, Response, NextFunction } from 'express';
import { verifyToken, extractTokenFromHeader } from '../services/jwtService';
import { prisma } from '../lib/prisma';

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        fullName: string;
      };
    }
  }
}

export const authenticateToken = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    const token = extractTokenFromHeader(authHeader);
    
    if (!token) {
      return res.status(401).json({ error: 'Access token required' });
    }
    
    const decoded = verifyToken(token) as { userId: string };
    
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, email: true, fullName: true }
    });
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid token - user not found' });
    }
    
    req.user = user;
    next();
    
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(401).json({ error: 'Invalid token' });
  }
};