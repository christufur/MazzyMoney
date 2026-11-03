import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authenticateToken } from '../middleware/auth';

const accountsRouter = Router();

accountsRouter.use(authenticateToken);

/**
 * Kinds a manual account can have. The 401(k), cars, and the house stay manual
 * so they do not use one of the ten free Plaid Items.
 */
const MANUAL_ACCOUNT_KINDS = [
  'retirement',
  'investment',
  'property',
  'vehicle',
  'cash',
  'loan',
  'other',
] as const;

type ManualAccountKind = (typeof MANUAL_ACCOUNT_KINDS)[number];

const NAME_MAX_LENGTH = 80;

/**
 * GET /api/accounts
 * All of the user's active accounts from the database (Plaid and manual).
 * No Plaid calls: W2.3 owns syncing.
 */
accountsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    const [accounts, items] = await Promise.all([
      prisma.account.findMany({
        where: { userId, isActive: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.plaidItem.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' },
        select: { institutionName: true },
      }),
    ]);

    const totalBalance = accounts.reduce((sum, acc) => sum + acc.currentBalance, 0);
    const totalAvailable = accounts.reduce((sum, acc) => sum + (acc.availableBalance ?? 0), 0);

    res.json({
      accounts: accounts.map(formatAccountForFrontend),
      // Kept for the current frontend (it reads `institution.name`) until W2.5 rebuilds the page.
      institution: items[0] ? { name: items[0].institutionName } : null,
      connected: items.length > 0,
      summary: {
        totalAccounts: accounts.length,
        totalBalance,
        totalAvailable,
      },
    });
  } catch (error: any) {
    console.error('Error fetching accounts:', error);
    res.status(500).json({ error: 'Failed to fetch accounts' });
  }
});

/**
 * POST /api/accounts/manual
 * Body: { name, kind, balance, isLiability? }
 * Creates a manual account and its first balance snapshot (today, UTC).
 */
accountsRouter.post('/manual', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const body = req.body ?? {};

    const name = parseName(body.name);
    if (name === null) {
      return res.status(400).json({ error: `Name must be 1-${NAME_MAX_LENGTH} characters` });
    }

    if (!isManualAccountKind(body.kind)) {
      return res.status(400).json({ error: `Kind must be one of: ${MANUAL_ACCOUNT_KINDS.join(', ')}` });
    }
    const kind = body.kind;

    if (!isFiniteNumber(body.balance)) {
      return res.status(400).json({ error: 'Balance must be a number' });
    }

    if (body.isLiability !== undefined && typeof body.isLiability !== 'boolean') {
      return res.status(400).json({ error: 'isLiability must be true or false' });
    }
    // A loan is a liability unless the user says otherwise.
    const isLiability = body.isLiability ?? kind === 'loan';

    const currentBalance = roundCents(body.balance);
    const today = startOfUtcDay();

    const account = await prisma.$transaction(async (tx) => {
      const created = await tx.account.create({
        data: {
          userId,
          name,
          // Manual accounts reuse the Plaid type/subtype columns for their kind.
          type: kind,
          subtype: kind,
          isManual: true,
          isLiability,
          plaidAccountId: null,
          plaidItemId: null,
          currentBalance,
        },
      });

      await tx.balanceSnapshot.upsert({
        where: { accountId_date: { accountId: created.id, date: today } },
        create: { accountId: created.id, date: today, balance: currentBalance },
        update: { balance: currentBalance },
      });

      return created;
    });

    res.status(201).json({ account: formatAccountForFrontend(account) });
  } catch (error: any) {
    console.error('Error creating manual account:', error);
    res.status(500).json({ error: 'Failed to create manual account' });
  }
});

/**
 * PUT /api/accounts/manual/:id
 * Body: { name?, kind?, isLiability? } — the balance has its own route.
 */
accountsRouter.put('/manual/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const body = req.body ?? {};

    const existing = await findManualAccount(userId, req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'MANUAL_ACCOUNT_NOT_FOUND' });
    }

    const data: {
      name?: string;
      type?: string;
      subtype?: string;
      isLiability?: boolean;
    } = {};

    if (body.name !== undefined) {
      const name = parseName(body.name);
      if (name === null) {
        return res.status(400).json({ error: `Name must be 1-${NAME_MAX_LENGTH} characters` });
      }
      data.name = name;
    }

    if (body.kind !== undefined) {
      if (!isManualAccountKind(body.kind)) {
        return res.status(400).json({ error: `Kind must be one of: ${MANUAL_ACCOUNT_KINDS.join(', ')}` });
      }
      data.type = body.kind;
      data.subtype = body.kind;
    }

    if (body.isLiability !== undefined) {
      if (typeof body.isLiability !== 'boolean') {
        return res.status(400).json({ error: 'isLiability must be true or false' });
      }
      data.isLiability = body.isLiability;
    }

    const account =
      Object.keys(data).length === 0
        ? existing
        : await prisma.account.update({ where: { id: existing.id }, data });

    res.json({ account: formatAccountForFrontend(account) });
  } catch (error: any) {
    console.error('Error updating manual account:', error);
    res.status(500).json({ error: 'Failed to update manual account' });
  }
});

/**
 * POST /api/accounts/manual/:id/balance
 * Body: { balance, date? (YYYY-MM-DD, defaults to today UTC) }
 * Today's date also updates the account balance; a past date back-fills the
 * snapshot for the net-worth chart without touching the current balance.
 */
accountsRouter.post('/manual/:id/balance', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const body = req.body ?? {};

    const existing = await findManualAccount(userId, req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'MANUAL_ACCOUNT_NOT_FOUND' });
    }

    if (!isFiniteNumber(body.balance)) {
      return res.status(400).json({ error: 'Balance must be a number' });
    }

    const today = startOfUtcDay();
    let snapshotDate = today;

    if (body.date !== undefined) {
      const parsed = parseDateOnly(body.date);
      if (!parsed) {
        return res.status(400).json({ error: 'Date must be a valid YYYY-MM-DD date' });
      }
      if (parsed.getTime() > today.getTime()) {
        return res.status(400).json({ error: 'Date cannot be in the future' });
      }
      snapshotDate = parsed;
    }

    const balance = roundCents(body.balance);
    const isToday = snapshotDate.getTime() === today.getTime();

    const account = await prisma.$transaction(async (tx) => {
      const updated = isToday
        ? await tx.account.update({
            where: { id: existing.id },
            data: { currentBalance: balance },
          })
        : existing;

      await tx.balanceSnapshot.upsert({
        where: { accountId_date: { accountId: existing.id, date: snapshotDate } },
        create: { accountId: existing.id, date: snapshotDate, balance },
        update: { balance },
      });

      return updated;
    });

    res.json({ account: formatAccountForFrontend(account) });
  } catch (error: any) {
    console.error('Error updating manual account balance:', error);
    res.status(500).json({ error: 'Failed to update manual account balance' });
  }
});

/**
 * DELETE /api/accounts/manual/:id
 * Only the user's own manual accounts. Snapshots cascade.
 */
accountsRouter.delete('/manual/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    const existing = await findManualAccount(userId, req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'MANUAL_ACCOUNT_NOT_FOUND' });
    }

    await prisma.account.delete({ where: { id: existing.id } });

    res.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting manual account:', error);
    res.status(500).json({ error: 'Failed to delete manual account' });
  }
});

/**
 * GET /api/accounts/manual/:id/history
 * Every balance snapshot, oldest first (YYYY-MM-DD).
 */
accountsRouter.get('/manual/:id/history', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    const existing = await findManualAccount(userId, req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'MANUAL_ACCOUNT_NOT_FOUND' });
    }

    const snapshots = await prisma.balanceSnapshot.findMany({
      where: { accountId: existing.id },
      orderBy: { date: 'asc' },
    });

    res.json({
      snapshots: snapshots.map((snapshot) => ({
        date: formatDateOnly(snapshot.date),
        balance: snapshot.balance,
      })),
    });
  } catch (error: any) {
    console.error('Error fetching manual account history:', error);
    res.status(500).json({ error: 'Failed to fetch manual account history' });
  }
});

// --- Helpers -------------------------------------------------------------

/**
 * A manual account that belongs to this user. Plaid accounts are not manual,
 * so they 404 here just like another user's account.
 */
function findManualAccount(userId: string, id: string) {
  return prisma.account.findFirst({ where: { id, userId, isManual: true } });
}

function isManualAccountKind(value: unknown): value is ManualAccountKind {
  return typeof value === 'string' && (MANUAL_ACCOUNT_KINDS as readonly string[]).includes(value);
}

/** Trimmed name, or null when missing or too long. */
function parseName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  if (name.length === 0 || name.length > NAME_MAX_LENGTH) return null;
  return name;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function roundCents(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/** Today at 00:00 UTC, the date part used by BalanceSnapshot. */
function startOfUtcDay(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Strict YYYY-MM-DD (UTC midnight), or null for anything else. */
function parseDateOnly(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// Helper function to format account for frontend (matching Plaid format)
function formatAccountForFrontend(account: any) {
  return {
    // Manual accounts have no Plaid id, so the database id is always sent separately
    // for the manual account routes.
    id: account.id,
    account_id: account.plaidAccountId ?? account.id,
    name: account.name,
    official_name: account.officialName,
    balances: {
      current: account.currentBalance,
      available: account.availableBalance,
      limit: account.creditLimit,
    },
    type: account.type,
    subtype: account.subtype,
    mask: account.mask,
    isManual: Boolean(account.isManual),
    isLiability: Boolean(account.isLiability),
  };
}

export { accountsRouter };
