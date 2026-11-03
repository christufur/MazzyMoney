import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth';
import { CATEGORIES } from '../services/categories';

const router = Router();
router.use(authenticateToken);

/**
 * GET /api/categories
 * The one display-category list. The categorizer, budgets, and the transaction
 * category picker all read it from here so they cannot drift apart.
 */
router.get('/', (_req: Request, res: Response) => {
  res.json({ categories: CATEGORIES });
});

export default router;
