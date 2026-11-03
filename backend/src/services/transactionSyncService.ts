// Cursor-based Plaid transaction sync (plan W2.3; PROJECT_OVERVIEW.md H7-H10).
//
// Every PlaidItem keeps one `/transactions/sync` cursor. A run pulls all pages until `has_more`
// is false, applies added/modified/removed, and saves the new cursor only after everything above
// succeeded. A crash therefore replays the same updates instead of losing them, and the upserts
// make that replay harmless.
//
// `categorySource` is the hard rule (H8): a USER or RULE category is never overwritten here. Only
// rows Plaid categorises itself (source PLAID) are re-categorised when Plaid sends a change.
//
// Cost rules (PROJECT_OVERVIEW.md 6.5): only `/transactions/sync` and `/accounts/get`.

import { prisma } from '../lib/prisma';
import { plaidClient, plaidErrorCode } from '../lib/plaid';
import { categorize, type RuleLike } from './categorizer';
import { BudgetSyncService } from './budgetSyncService';
import type { PlaidItem } from '../../prisma/generated/prisma';

/** Plaid's maximum page size. */
const PAGE_SIZE = 500;
/** Pause between Items so a server-wide sweep stays under Plaid's rate limits. */
const ITEM_PAUSE_MS = 1000;
// History older than this arrives already reviewed: the queue is for what is new, not the past year.
const REVIEW_WINDOW_DAYS = 14;

type ItemStatusName = 'ACTIVE' | 'SYNCING' | 'LOGIN_REQUIRED' | 'ERROR';
type CategorySourceName = 'PLAID' | 'RULE' | 'USER';

/** Only the fields this service reads; structurally compatible with plaid's `Transaction`. */
type PlaidTransactionLike = {
  transaction_id: string;
  account_id: string;
  amount: number;
  date: string;
  authorized_date?: string | null;
  name: string;
  merchant_name?: string | null;
  pending?: boolean;
  pending_transaction_id?: string | null;
  category?: string[] | null;
  personal_finance_category?: { primary?: string | null; detailed?: string | null } | null;
  location?: { city?: string | null; region?: string | null; country?: string | null } | null;
};

type RemovedTransactionLike = { transaction_id: string };

type PendingCarryOver = {
  notes: string | null;
  reviewed: boolean;
  primaryCategory: string | null;
  categorySource: CategorySourceName;
};

export type SyncItemResult =
  | { skipped: true }
  | { success: true; added: number; modified: number; removed: number }
  | { success: false; error: string };

export interface SyncedItem {
  itemId: string;
  institutionName: string;
  result: SyncItemResult;
}

export interface UserSyncResult {
  userId: string;
  items: SyncedItem[];
}

export type SyncStatusName = 'NEVER_SYNCED' | 'SYNCING' | 'TOKEN_EXPIRED' | 'ERROR' | 'SYNCED';

export interface SyncStatusPayload {
  connected: boolean;
  status: SyncStatusName;
  lastSyncAt: Date | null;
  transactionCount: number;
  items: Array<{
    id: string;
    institutionName: string;
    status: ItemStatusName;
    lastSyncAt: Date | null;
    lastError: string | null;
  }>;
}

export class TransactionSyncService {
  /**
   * Sync one PlaidItem. Safe to call twice: the second call sees SYNCING and skips.
   */
  static async syncItem(plaidItemId: string): Promise<SyncItemResult> {
    // Claim the Item atomically so two cron runs (or a cron run and a manual sync) never overlap.
    const claim = await prisma.plaidItem.updateMany({
      where: { id: plaidItemId, status: { not: 'SYNCING' } },
      data: { status: 'SYNCING' },
    });

    if (claim.count === 0) {
      return { skipped: true };
    }

    const item = await prisma.plaidItem.findUnique({ where: { id: plaidItemId } });
    if (!item) {
      // Removed between the claim and the read: nothing left to sync.
      return { skipped: true };
    }

    try {
      const { accountIdByPlaidId, balances } = await this.syncAccounts(item);
      const rules: RuleLike[] = await prisma.rule.findMany({ where: { userId: item.userId } });

      const updates = await this.pullUpdates(item);

      const added = await this.applyAdded(item.userId, updates.added, accountIdByPlaidId, rules);
      const modified = await this.applyModified(item.userId, updates.modified, accountIdByPlaidId, rules);
      const removed = await this.applyRemoved(item.userId, updates.removed);

      await this.snapshotBalances(balances);

      // Only now, with every change stored, is the cursor allowed to move forward.
      await prisma.plaidItem.update({
        where: { id: item.id },
        data: {
          cursor: updates.cursor,
          status: 'ACTIVE',
          lastSyncAt: new Date(),
          lastError: null,
        },
      });

      console.log(
        `Plaid sync done for item ${item.id}: ${added} added, ${modified} modified, ${removed} removed`
      );

      return { success: true, added, modified, removed };
    } catch (error: any) {
      const code = plaidErrorCode(error);
      const status: ItemStatusName = code === 'ITEM_LOGIN_REQUIRED' ? 'LOGIN_REQUIRED' : 'ERROR';
      const lastError = describeError(error, item.accessToken);

      // The cursor stays where it was: the next run re-downloads this batch.
      await prisma.plaidItem
        .update({ where: { id: item.id }, data: { status, lastError } })
        .catch((updateError) => {
          console.error(`Could not record the sync failure for item ${item.id}:`, updateError);
        });

      console.error(`Plaid sync failed for item ${item.id}:`, lastError);

      return { success: false, error: lastError };
    }
  }

  /**
   * Sync every Item of one user that is worth retrying, then refresh budget alerts.
   */
  static async syncUser(userId: string, options: { pauseMs?: number } = {}): Promise<UserSyncResult> {
    const items = await prisma.plaidItem.findMany({
      where: { userId, status: { in: ['ACTIVE', 'ERROR'] } },
      orderBy: { createdAt: 'asc' },
    });

    const synced: SyncedItem[] = [];

    for (const [index, item] of items.entries()) {
      if (index > 0 && options.pauseMs) {
        await pause(options.pauseMs);
      }

      synced.push({
        itemId: item.id,
        institutionName: item.institutionName,
        result: await this.syncItem(item.id),
      });
    }

    // Budget alerts are per user, and a broken bank should not stop them.
    try {
      await BudgetSyncService.syncUserBudgets(userId);
    } catch (budgetError) {
      console.error(`Budget sync failed for user ${userId}:`, budgetError);
    }

    return { userId, items: synced };
  }

  /**
   * Sweep the whole server (cron, admin route). Grouped by user so budgets sync once per user.
   */
  static async syncAll(): Promise<UserSyncResult[]> {
    const items = await prisma.plaidItem.findMany({
      where: { status: { in: ['ACTIVE', 'ERROR'] } },
      select: { userId: true },
      orderBy: { createdAt: 'asc' },
    });

    const userIds = [...new Set(items.map((item) => item.userId))];
    const results: UserSyncResult[] = [];

    for (const [index, userId] of userIds.entries()) {
      // Pause between every Item, including across users.
      if (index > 0) {
        await pause(ITEM_PAUSE_MS);
      }

      results.push(await this.syncUser(userId, { pauseMs: ITEM_PAUSE_MS }));
    }

    return results;
  }

  /**
   * A process that stopped mid-sync leaves Items stuck in SYNCING; recover them at startup (H9).
   */
  static async resetStuckSyncs(): Promise<number> {
    const result = await prisma.plaidItem.updateMany({
      where: { status: 'SYNCING' },
      data: { status: 'ACTIVE' },
    });

    if (result.count > 0) {
      console.log(`Reset ${result.count} stuck Plaid sync(s) to ACTIVE`);
    }

    return result.count;
  }

  /**
   * The shape the current frontend expects (SyncStatus.tsx), derived from the Items.
   */
  static async getSyncStatus(userId: string): Promise<SyncStatusPayload> {
    const [items, transactionCount] = await Promise.all([
      prisma.plaidItem.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
      prisma.transaction.count({ where: { userId } }),
    ]);

    const lastSyncAt = items.reduce<Date | null>((latest, item) => {
      if (!item.lastSyncAt) return latest;
      return !latest || item.lastSyncAt > latest ? item.lastSyncAt : latest;
    }, null);

    let status: SyncStatusName;
    // SYNCING first: the frontend polls only while it sees SYNCING, including the very first sync.
    if (items.some((item) => item.status === 'SYNCING')) {
      status = 'SYNCING';
    } else if (!lastSyncAt) {
      status = 'NEVER_SYNCED';
    } else if (items.some((item) => item.status === 'LOGIN_REQUIRED')) {
      // The frontend calls this state TOKEN_EXPIRED and shows "please reconnect".
      status = 'TOKEN_EXPIRED';
    } else if (items.some((item) => item.status === 'ERROR')) {
      status = 'ERROR';
    } else {
      status = 'SYNCED';
    }

    return {
      connected: items.length > 0,
      status,
      lastSyncAt,
      transactionCount,
      items: items.map((item) => ({
        id: item.id,
        institutionName: item.institutionName,
        status: item.status as ItemStatusName,
        lastSyncAt: item.lastSyncAt,
        lastError: item.lastError,
      })),
    };
  }

  /**
   * Re-download everything for the user. Safe: the upserts are idempotent and USER/RULE
   * categories are protected, so a full resync cannot undo manual edits.
   */
  static async fullResync(userId: string): Promise<UserSyncResult> {
    await prisma.plaidItem.updateMany({ where: { userId }, data: { cursor: null } });
    return this.syncUser(userId);
  }

  /**
   * `/accounts/get` once per Item, then upsert the accounts and remember their balances.
   * Same ownership rule as the connections route: a row owned by another user is never taken over.
   */
  private static async syncAccounts(item: PlaidItem) {
    const response = await plaidClient.accountsGet({ access_token: item.accessToken });

    const accountIdByPlaidId = new Map<string, string>();
    const balances: Array<{ accountId: string; balance: number }> = [];

    for (const plaidAccount of response.data.accounts) {
      const accountFields = {
        plaidItemId: item.id,
        name: plaidAccount.name,
        officialName: plaidAccount.official_name ?? null,
        type: plaidAccount.type,
        subtype: plaidAccount.subtype ?? 'unknown',
        mask: plaidAccount.mask ?? null,
        currentBalance: roundCents(plaidAccount.balances.current ?? 0),
        availableBalance: plaidAccount.balances.available ?? null,
        creditLimit: plaidAccount.balances.limit ?? null,
        isLiability: plaidAccount.type === 'credit' || plaidAccount.type === 'loan',
        isActive: true,
      };

      const existing = await prisma.account.findUnique({
        where: { plaidAccountId: plaidAccount.account_id },
      });

      // plaidAccountId is unique across the table, so a collision means someone else's row.
      if (existing && existing.userId !== item.userId) {
        console.warn(
          `Skipping Plaid account ${plaidAccount.account_id}: it belongs to another user`
        );
        continue;
      }

      const account = existing
        ? await prisma.account.update({ where: { id: existing.id }, data: accountFields })
        : await prisma.account.create({
            data: {
              plaidAccountId: plaidAccount.account_id,
              userId: item.userId,
              ...accountFields,
            },
          });

      accountIdByPlaidId.set(plaidAccount.account_id, account.id);
      balances.push({ accountId: account.id, balance: account.currentBalance });
    }

    return { accountIdByPlaidId, balances };
  }

  /**
   * Pull every page from the saved cursor. Plaid can change data while we paginate; in that case
   * it asks us to start over, which we do exactly once from the saved cursor.
   */
  private static async pullUpdates(item: PlaidItem) {
    const startCursor = item.cursor ?? undefined;
    let restarted = false;

    for (;;) {
      try {
        const added: PlaidTransactionLike[] = [];
        const modified: PlaidTransactionLike[] = [];
        const removed: RemovedTransactionLike[] = [];

        let cursor = startCursor;
        let nextCursor: string | undefined = startCursor;
        let hasMore = true;

        while (hasMore) {
          const page = await plaidClient.transactionsSync({
            access_token: item.accessToken,
            cursor,
            count: PAGE_SIZE,
          });

          added.push(...(page.data.added as PlaidTransactionLike[]));
          modified.push(...(page.data.modified as PlaidTransactionLike[]));
          removed.push(...(page.data.removed as RemovedTransactionLike[]));

          nextCursor = page.data.next_cursor;
          hasMore = page.data.has_more;

          // Plaid always returns a cursor while more pages exist. If a page ever says
          // "more" without one, stopping beats looping forever on the same cursor.
          if (hasMore && !page.data.next_cursor) {
            console.warn(`Plaid returned has_more with no cursor for item ${item.id}; stopping`);
            break;
          }

          cursor = page.data.next_cursor;
        }

        // Plaid returns an empty next_cursor while the historical pull is still pending. Keep the
        // cursor we already have in that case (and on a first sync it is legitimately empty).
        return { added, modified, removed, cursor: nextCursor || startCursor || null };
      } catch (error: any) {
        const retriable =
          !restarted && plaidErrorCode(error) === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION';

        if (!retriable) {
          throw error;
        }

        restarted = true;
        console.warn(`Plaid changed data mid-pagination for item ${item.id}; restarting the pull`);
      }
    }
  }

  private static async applyAdded(
    userId: string,
    added: PlaidTransactionLike[],
    accountIdByPlaidId: Map<string, string>,
    rules: RuleLike[]
  ): Promise<number> {
    let applied = 0;

    for (const transaction of added) {
      const accountId = accountIdByPlaidId.get(transaction.account_id);
      if (!accountId) {
        console.warn(
          `Skipping Plaid transaction ${transaction.transaction_id}: unknown account ${transaction.account_id}`
        );
        continue;
      }

      const existing = await prisma.transaction.findUnique({
        where: { plaidTransactionId: transaction.transaction_id },
      });

      if (existing && existing.userId !== userId) {
        console.warn(
          `Skipping Plaid transaction ${transaction.transaction_id}: it belongs to another user`
        );
        continue;
      }

      const carried = transaction.pending_transaction_id
        ? await this.findPendingRow(userId, transaction.pending_transaction_id)
        : null;

      const categorized = this.categorizePlaidTransaction(transaction, accountId, rules);
      const fields = plaidFields(transaction, accountId);

      // A USER/RULE category survives the pending -> posted hand-off.
      const keepCategory =
        carried && (carried.categorySource === 'USER' || carried.categorySource === 'RULE')
          ? carried
          : null;

      if (!existing) {
        await prisma.transaction.create({
          data: {
            plaidTransactionId: transaction.transaction_id,
            userId,
            ...fields,
            primaryCategory: keepCategory?.primaryCategory ?? categorized.category,
            categorySource: keepCategory?.categorySource ?? categorized.source,
            isTransfer: categorized.isTransfer,
            hidden: categorized.hidden,
            merchantDisplay: categorized.merchantDisplay,
            notes: carried?.notes ?? null,
            reviewed: carried?.reviewed ?? isOlderThanReviewWindow(fields.date),
          },
        });
      } else {
        await prisma.transaction.update({
          where: { id: existing.id },
          data: {
            ...fields,
            // Replaying a batch must not undo a manual edit made in the meantime.
            ...(existing.categorySource === 'PLAID'
              ? {
                  primaryCategory: categorized.category,
                  isTransfer: categorized.isTransfer,
                  hidden: categorized.hidden,
                  merchantDisplay: categorized.merchantDisplay,
                }
              : {}),
            ...(carried ? { notes: carried.notes, reviewed: carried.reviewed } : {}),
          },
        });
      }

      // The posted row now holds its edits, so the pending placeholder can go. Doing this
      // after the write means a failure in between can never drop the user's notes.
      if (carried) {
        await prisma.transaction.delete({ where: { id: carried.rowId } });
      }

      applied++;
    }

    return applied;
  }

  private static async applyModified(
    userId: string,
    modified: PlaidTransactionLike[],
    accountIdByPlaidId: Map<string, string>,
    rules: RuleLike[]
  ): Promise<number> {
    let applied = 0;

    for (const transaction of modified) {
      const accountId = accountIdByPlaidId.get(transaction.account_id);
      if (!accountId) {
        console.warn(
          `Skipping modified transaction ${transaction.transaction_id}: unknown account ${transaction.account_id}`
        );
        continue;
      }

      const existing = await prisma.transaction.findUnique({
        where: { plaidTransactionId: transaction.transaction_id },
      });

      if (existing && existing.userId !== userId) {
        console.warn(
          `Skipping modified transaction ${transaction.transaction_id}: it belongs to another user`
        );
        continue;
      }

      const fields = plaidFields(transaction, accountId);

      if (!existing) {
        // We joined the sync cursor mid-stream: keep the row rather than drop it.
        const categorized = this.categorizePlaidTransaction(transaction, accountId, rules);
        await prisma.transaction.create({
          data: {
            plaidTransactionId: transaction.transaction_id,
            userId,
            ...fields,
            primaryCategory: categorized.category,
            categorySource: categorized.source,
            isTransfer: categorized.isTransfer,
            hidden: categorized.hidden,
            merchantDisplay: categorized.merchantDisplay,
          },
        });
      } else if (existing.categorySource === 'PLAID') {
        const categorized = this.categorizePlaidTransaction(transaction, accountId, rules);
        await prisma.transaction.update({
          where: { id: existing.id },
          data: {
            ...fields,
            primaryCategory: categorized.category,
            isTransfer: categorized.isTransfer,
            hidden: categorized.hidden,
            merchantDisplay: categorized.merchantDisplay,
          },
        });
      } else {
        // USER / RULE owns the category, notes and reviewed flag: only Plaid's own fields move.
        await prisma.transaction.update({ where: { id: existing.id }, data: fields });
      }

      applied++;
    }

    return applied;
  }

  private static async applyRemoved(
    userId: string,
    removed: RemovedTransactionLike[]
  ): Promise<number> {
    const plaidIds = removed.map((entry) => entry.transaction_id).filter(Boolean);
    if (plaidIds.length === 0) {
      return 0;
    }

    const result = await prisma.transaction.deleteMany({
      where: { userId, plaidTransactionId: { in: plaidIds } },
    });

    return result.count;
  }

  /**
   * The pending row whose posted counterpart is arriving. It is deleted only after the posted
   * row is written, so an error in between leaves the user's edits safely in place.
   */
  private static async findPendingRow(
    userId: string,
    pendingTransactionId: string
  ): Promise<(PendingCarryOver & { rowId: string }) | null> {
    const pending = await prisma.transaction.findFirst({
      where: { userId, plaidTransactionId: pendingTransactionId },
      select: {
        id: true,
        notes: true,
        reviewed: true,
        primaryCategory: true,
        categorySource: true,
      },
    });

    if (!pending) {
      return null;
    }

    return {
      rowId: pending.id,
      notes: pending.notes,
      reviewed: pending.reviewed,
      primaryCategory: pending.primaryCategory,
      categorySource: pending.categorySource,
    };
  }

  /** Today's UTC date at midnight: snapshots are one row per account per day. */
  private static async snapshotBalances(
    balances: Array<{ accountId: string; balance: number }>
  ): Promise<void> {
    const today = startOfUtcDay();

    for (const account of balances) {
      await prisma.balanceSnapshot.upsert({
        where: { accountId_date: { accountId: account.accountId, date: today } },
        create: { accountId: account.accountId, date: today, balance: account.balance },
        update: { balance: account.balance },
      });
    }
  }

  private static categorizePlaidTransaction(
    transaction: PlaidTransactionLike,
    accountId: string,
    rules: RuleLike[]
  ) {
    const pfc = transaction.personal_finance_category ?? null;

    return categorize(
      {
        name: transaction.name,
        merchantName: transaction.merchant_name ?? null,
        amount: roundCents(transaction.amount),
        accountId,
        pfcPrimary: pfc?.primary ?? null,
        pfcDetailed: pfc?.detailed ?? null,
      },
      rules
    );
  }
}

/** Fields that always come straight from Plaid, whatever the category source is. */
function plaidFields(transaction: PlaidTransactionLike, accountId: string) {
  const pfc = transaction.personal_finance_category ?? null;

  return {
    accountId,
    name: transaction.name,
    merchantName: transaction.merchant_name ?? null,
    amount: roundCents(transaction.amount),
    date: new Date(transaction.date),
    authorizedDate: transaction.authorized_date ? new Date(transaction.authorized_date) : null,
    pending: transaction.pending ?? false,
    pendingTransactionId: transaction.pending_transaction_id ?? null,
    pfcPrimary: pfc?.primary ?? null,
    pfcDetailed: pfc?.detailed ?? null,
    categories: transaction.category ?? [],
    detailedCategory: pfc?.detailed ?? null,
    city: transaction.location?.city ?? null,
    region: transaction.location?.region ?? null,
    country: transaction.location?.country ?? null,
  };
}

/** Money stays Float in the schema, so every stored amount is rounded to cents. */
function isOlderThanReviewWindow(date: Date, now: Date = new Date()): boolean {
  return date.getTime() < startOfUtcDay(now).getTime() - REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

function roundCents(amount: number): number {
  return Math.round(amount * 100) / 100;
}

function startOfUtcDay(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** A short reason for `lastError` that can never contain the access token. */
function describeError(error: any, accessToken: string): string {
  const code = plaidErrorCode(error);
  if (code) {
    return code;
  }

  const raw = typeof error?.message === 'string' ? error.message : 'Unknown error';
  const withoutToken = accessToken ? raw.split(accessToken).join('[redacted]') : raw;

  return withoutToken.length > 200 ? `${withoutToken.slice(0, 200)}…` : withoutToken;
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
