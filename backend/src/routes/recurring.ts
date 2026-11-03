import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authenticateToken } from '../middleware/auth';
import { RecurringService, monthlyEquivalent } from '../services/recurringService';
import type { RecurringSeries } from '../../prisma/generated/prisma';

const router = Router();

router.use(authenticateToken);

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The next 30 days of bills, including anything due today. */
const UPCOMING_DAYS = 30;

function toPayloadSeries(series: RecurringSeries) {
  return {
    id: series.id,
    merchantKey: series.merchantKey,
    displayName: series.displayName,
    averageAmount: series.averageAmount,
    intervalDays: series.intervalDays,
    lastDate: series.lastDate,
    nextDate: series.nextDate,
    status: series.status,
    monthlyEquivalent: monthlyEquivalent(series),
    previousAmount: series.previousAmount,
    amountChangedAt: series.amountChangedAt,
  };
}

/** Shapes the page in one place so GET and POST /refresh always agree. */
async function buildPayload(userId: string) {
  const rows = await prisma.recurringSeries.findMany({
    where: { userId },
    orderBy: [{ nextDate: 'asc' }, { displayName: 'asc' }],
  });

  const series = rows.map(toPayloadSeries);
  const active = series.filter((row) => row.status === 'ACTIVE');

  const monthlyTotalCents = Math.round(
    active.reduce((sum, row) => sum + row.monthlyEquivalent, 0) * 100
  );

  const now = new Date();
  // Dates are UTC midnight, so the window starts at today's UTC midnight: a bill due
  // today counts, and one already overdue does not (the nightly refresh moves it on).
  const windowStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const cutoff = now.getTime() + UPCOMING_DAYS * MS_PER_DAY;

  const upcoming = active
    .filter((row) => {
      const next = row.nextDate.getTime();
      return next >= windowStart && next <= cutoff;
    })
    .sort((a, b) => a.nextDate.getTime() - b.nextDate.getTime());

  return { series, monthlyTotal: monthlyTotalCents, upcoming };
}

// GET /api/recurring - the stored series, the monthly total, and the next 30 days
router.get('/', async (req: Request, res: Response) => {
  try {
    res.json(await buildPayload(req.user!.id));
  } catch (error: any) {
    console.error('Error fetching recurring series:', error);
    res.status(500).json({ error: 'Failed to fetch recurring charges' });
  }
});

// POST /api/recurring/refresh - detect again now (the nightly cron does the same)
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    await RecurringService.refreshForUser(userId);
    res.json(await buildPayload(userId));
  } catch (error: any) {
    console.error('Error refreshing recurring series:', error);
    res.status(500).json({ error: 'Failed to refresh recurring charges' });
  }
});

// PATCH /api/recurring/:id - ignore or restore one series
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;
    const { status } = req.body ?? {};

    if (status !== 'ACTIVE' && status !== 'IGNORED') {
      return res.status(400).json({ error: 'status must be ACTIVE or IGNORED' });
    }

    // Scoped by userId: another user's id is a 404, not a 403 (it does not exist for this caller).
    const existing = await prisma.recurringSeries.findFirst({ where: { id, userId } });

    if (!existing) {
      return res.status(404).json({ error: 'Recurring series not found' });
    }

    const updated = await prisma.recurringSeries.update({
      where: { id: existing.id },
      data: { status },
    });

    res.json({ series: toPayloadSeries(updated) });
  } catch (error: any) {
    console.error('Error updating recurring series:', error);
    res.status(500).json({ error: 'Failed to update recurring series' });
  }
});

export default router;
