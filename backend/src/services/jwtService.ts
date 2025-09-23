import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

if (!JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is required');
}

// Type assertion after the check
const JWT_SECRET_VERIFIED = JWT_SECRET as string;

export const generateToken = (userId: string) => {

    const payload = {
        userId: userId,
        // Let JWT library handle timestamps automatically
    };

    const token = jwt.sign(
        payload,
        JWT_SECRET_VERIFIED,
    );

    return token;
};

export const verifyToken = (token: string) => {
    try {
        const decoded = jwt.verify(token, JWT_SECRET_VERIFIED);
        return decoded;
    } catch (error) {
        if (error instanceof jwt.TokenExpiredError) {
            throw new Error('Token expired');
        } else if (error instanceof jwt.JsonWebTokenError) {
            throw new Error('Invalid token');
        } else {
            throw new Error('Token verification failed');
        }
    }
};

export const extractTokenFromHeader = (authHeader?: string) => {
    if (!authHeader) {
        return null;
    }

    if (authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        return token;  // ← Don't forget this!
    }

    return null;
};