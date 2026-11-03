// Monthly close (plan E7): one row per user and month with the owner's note, the savings
// target for that month, and when the month was closed. A month with no row reads as open.

import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authenticateToken } from '../middleware/auth';
import { isMonthKey } from '../services/budgetSyncService';

const router = Router();
router.use(authenticateToken);

const NOTE_MAX = 2000;

const view = (month: string, row: { note: string | null; savingsTarget: number | null; closedAt: Date | null } | null) => ({
  month,
  note: row?.note ?? null,
  savingsTarget: row?.savingsTarget ?? null,
  closedAt: row?.closedAt ?? null,
});

router.get('/:month', async (req: Request, res: Response) => {
  const { month } = req.params;
  if (!isMonthKey(month)) return res.status(400).json({ error: 'Month must be YYYY-MM' });

  const row = await prisma.monthNote.findUnique({
    where: { userId_month: { userId: req.user!.id, month } },
  });
  res.json(view(month, row));
});

/** Body: `note` (text or null), `savingsTarget` (number ≥ 0 or null), `closed` (boolean). Absent fields stay as they are. */
router.put('/:month', async (req: Request, res: Response) => {
  const { month } = req.params;
  if (!isMonthKey(month)) return res.status(400).json({ error: 'Month must be YYYY-MM' });

  const { note, savingsTarget, closed } = req.body ?? {};
  const data: { note?: string | null; savingsTarget?: number | null; closedAt?: Date | null } = {};

  if (note !== undefined) {
    if (note !== null && typeof note !== 'string') return res.status(400).json({ error: 'Note must be text or null' });
    const text = note?.trim() ?? '';
    if (text.length > NOTE_MAX) return res.status(400).json({ error: `Note must be ${NOTE_MAX} characters or fewer` });
    data.note = text || null;
  }

  if (savingsTarget !== undefined) {
    if (savingsTarget !== null && (typeof savingsTarget !== 'number' || !Number.isFinite(savingsTarget) || savingsTarget < 0)) {
      return res.status(400).json({ error: 'Savings target must be 0 or more, or null' });
    }
    data.savingsTarget = savingsTarget === null ? null : Math.round(savingsTarget * 100) / 100;
  }

  if (closed !== undefined) {
    if (typeof closed !== 'boolean') return res.status(400).json({ error: 'Closed must be true or false' });
    data.closedAt = closed ? new Date() : null;
  }

  const userId = req.user!.id;
  const existing = await prisma.monthNote.findUnique({ where: { userId_month: { userId, month } } });
  // Closing an already closed month keeps the first close date.
  if (data.closedAt && existing?.closedAt) delete data.closedAt;

  const row = await prisma.monthNote.upsert({
    where: { userId_month: { userId, month } },
    create: { userId, month, ...data },
    update: data,
  });
  res.json(view(month, row));
});

export default router;
