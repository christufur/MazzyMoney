import { Router, Request, Response } from 'express';
import { registerUser, loginUser } from '../services/authService';
import { prisma } from '../lib/prisma';
import { authenticateToken } from '../middleware/auth';

const router = Router();

// POST /api/auth/register
router.post('/register', async (req: Request, res: Response) => {
  // Your implementation here
  try {
    // extract email, password, fullName from req.body
    const {email, password, fullName} = req.body;

    // validating required fields
    if (!email || !password || !fullName) {
      return res.status(400).json({error: 'Missing required fields'});
    }

    // call registerUser service
    const result = await registerUser(email, password, fullName);

    return res.status(201).json(result);

  } catch (error: any) {
    console.error('Error registering user', error);

    if (error.message === 'User already exists') {
        return res.status(409).json({ error: 'User already exists' });
    }

    res.status(500).json({error: 'Internal server error'});
  }
});

// POST /api/auth/login  
router.post('/login', async (req: Request, res: Response) => {
  // Your implementation here
  try {
    // extract email, password from req.body
    const {email, password} = req.body;

    // validating required fields 
    if (!email || !password){
        return res.status(400).json({error: 'Missing required fields'});
    }

    //call loginUser service
    const result = await loginUser(email, password);
    return res.json(result);  
} catch (error: any) {
    console.error('Error logging in user', error);

    if (error.message === 'Invalid credentials') {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (error.message === 'User not found') {
      return res.status(404).json({ error: 'User not found' });
    }

    res.status(500).json({error: 'internal server error'})
  }
});

router.get('/me', authenticateToken, async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: (req as any).user!.id },
      select: {
        id: true,
        email: true,
        fullName: true,
        createdAt: true,
        updatedAt: true,
        plaidAccessToken: false, // Don't send token to frontend
        plaidItemId: true,
        plaidInstitutionId: true,
        plaidInstitutionName: true,
        lastSyncAt: true,
        syncStatus: true
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user });
  } catch (error: any) {
    console.error('Error fetching user data:', error);
    res.status(500).json({ error: 'Failed to fetch user data' });
  }
});

export default router;