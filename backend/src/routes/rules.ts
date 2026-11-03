import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authenticateToken } from '../middleware/auth';
import { RuleService, validateRuleInput } from '../services/ruleService';

const router = Router();

router.use(authenticateToken);

/**
 * GET /api/rules
 * The user's rules, highest priority first, each with how many existing rows it matches.
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    res.json({ rules: await RuleService.list(req.user!.id) });
  } catch (error: any) {
    console.error('Error fetching rules:', error);
    res.status(500).json({ error: 'Failed to fetch rules' });
  }
});

/**
 * POST /api/rules/preview
 * Body: a rule draft. Returns how many rows it matches and up to ten of them. Writes nothing.
 * Registered before /:id/apply and the /:id routes so "preview" is not read as an id.
 */
router.post('/preview', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const validation = await validateRuleInput(req.body, userId);

    if (!validation.ok) {
      return res.status(400).json({ error: validation.error });
    }

    res.json(await RuleService.preview(userId, validation.fields));
  } catch (error: any) {
    console.error('Error previewing rule:', error);
    res.status(500).json({ error: 'Failed to preview rule' });
  }
});

/**
 * POST /api/rules/from-transaction
 * Body: { transactionId, setCategory }
 * Builds a rule that matches this transaction's merchant and sets the category. The rule is
 * returned unapplied; the page calls /apply after the user confirms the match count.
 */
router.post('/from-transaction', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { transactionId, setCategory } = req.body ?? {};

    if (typeof transactionId !== 'string' || transactionId.trim() === '') {
      return res.status(400).json({ error: 'transactionId is required' });
    }

    const result = await RuleService.fromTransaction(userId, transactionId, setCategory);

    if (result.status === 'not_found') {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    if (result.status === 'invalid') {
      return res.status(400).json({ error: result.error });
    }

    res.status(201).json({ rule: result.rule, matchCount: result.matchCount });
  } catch (error: any) {
    console.error('Error creating rule from transaction:', error);
    res.status(500).json({ error: 'Failed to create rule from transaction' });
  }
});

/**
 * POST /api/rules/:id/apply
 * Applies the rule to the user's existing rows and returns { updated, skippedUserCategory }.
 */
router.post('/:id/apply', async (req: Request, res: Response) => {
  try {
    const result = await RuleService.apply(req.user!.id, req.params.id);

    if (!result) {
      return res.status(404).json({ error: 'Rule not found' });
    }

    res.json(result);
  } catch (error: any) {
    console.error('Error applying rule:', error);
    res.status(500).json({ error: 'Failed to apply rule' });
  }
});

/**
 * POST /api/rules
 * 201 { rule }. The rule applies to new transactions on the next sync.
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const validation = await validateRuleInput(req.body, userId);

    if (!validation.ok) {
      return res.status(400).json({ error: validation.error });
    }

    const rule = await prisma.rule.create({ data: { userId, ...validation.fields } });

    res.status(201).json({ rule });
  } catch (error: any) {
    console.error('Error creating rule:', error);
    res.status(500).json({ error: 'Failed to create rule' });
  }
});

/**
 * PUT /api/rules/:id
 * The whole rule is replaced; the same validation as create runs first.
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;

    const existing = await prisma.rule.findFirst({ where: { id, userId }, select: { id: true } });

    if (!existing) {
      return res.status(404).json({ error: 'Rule not found' });
    }

    const validation = await validateRuleInput(req.body, userId);

    if (!validation.ok) {
      return res.status(400).json({ error: validation.error });
    }

    const rule = await prisma.rule.update({
      where: { id: existing.id },
      data: validation.fields,
    });

    res.json({ rule });
  } catch (error: any) {
    console.error('Error updating rule:', error);
    res.status(500).json({ error: 'Failed to update rule' });
  }
});

/**
 * DELETE /api/rules/:id
 * Own rules only; another user's id is a 404 (it does not exist for this caller).
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;

    const existing = await prisma.rule.findFirst({ where: { id, userId }, select: { id: true } });

    if (!existing) {
      return res.status(404).json({ error: 'Rule not found' });
    }

    await prisma.rule.delete({ where: { id: existing.id } });

    res.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting rule:', error);
    res.status(500).json({ error: 'Failed to delete rule' });
  }
});

export default router;
