import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import SidebarLayout from '../components/layout/SidebarLayout';
import { PlaidLink } from '../components/plaid/PlaidLink';
import ManualAccounts from '../components/accounts/ManualAccounts';
import { plaidAPI } from '../services/api';
import type { PlaidItem, PlaidItemStatus, PlaidItemsResponse } from '../services/api';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

const POLL_INTERVAL_MS = 5000;

const statusLabels: Record<PlaidItemStatus, string> = {
  ACTIVE: 'Connected',
  SYNCING: 'Syncing',
  LOGIN_REQUIRED: 'Login needed',
  ERROR: 'Error',
};

/** A status is a word first, a dot second: color never carries it alone. */
const StatusTag: React.FC<{ status: PlaidItemStatus }> = ({ status }) => {
  if (status === 'SYNCING') {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <RefreshCw className="size-3.5 animate-spin" strokeWidth={1.75} aria-hidden />
        {statusLabels.SYNCING}
      </span>
    );
  }

  const needsCare = status === 'LOGIN_REQUIRED' || status === 'ERROR';

  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm', needsCare ? 'text-terra' : 'text-ink')}>
      <span
        aria-hidden
        className={cn('size-1.5 shrink-0 rounded-full', needsCare ? 'bg-terra' : 'bg-sage')}
      />
      {statusLabels[status] ?? status}
    </span>
  );
};

const formatLastSync = (lastSyncAt: string | null) => {
  if (!lastSyncAt) return 'Not synced yet';
  const date = new Date(lastSyncAt);
  if (Number.isNaN(date.getTime())) return 'Not synced yet';
  return `Last sync ${date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })}`;
};

const formatMask = (mask: string | null) => (mask ? `••${mask}` : '');

const formatSubtype = (subtype: string) =>
  subtype && subtype !== 'unknown' ? subtype.replace(/_/g, ' ') : 'account';

const errorMessage = (err: any, fallback: string) => {
  const serverError = err?.response?.data?.error;
  return typeof serverError === 'string' && serverError.trim() ? serverError : fallback;
};

const ConnectionsPage: React.FC = () => {
  const [data, setData] = useState<PlaidItemsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  // The bank whose Remove dialog is open; null keeps the dialog closed.
  const [removeTarget, setRemoveTarget] = useState<PlaidItem | null>(null);
  // A failed removal stays in the dialog with the buttons, not on the page behind it.
  const [removeError, setRemoveError] = useState<string | null>(null);

  const fetchItems = useCallback(async (options: { silent?: boolean } = {}) => {
    try {
      setError(null);
      const response = await plaidAPI.getItems();
      setData(response);
    } catch (err: any) {
      console.error('Error fetching connected banks:', err);
      setError(errorMessage(err, 'Could not load your banks. Try again.'));
    } finally {
      // Only the first load shows the skeleton; a refresh keeps the sheet in place.
      if (!options.silent) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  // Poll while a bank is syncing, and stop as soon as none is.
  const hasSyncingItem = Boolean(data?.items.some((item) => item.status === 'SYNCING'));

  useEffect(() => {
    if (!hasSyncingItem) {
      return;
    }

    const timer = setInterval(() => {
      fetchItems({ silent: true });
    }, POLL_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [hasSyncingItem, fetchItems]);

  const handleRemove = async (item: PlaidItem) => {
    try {
      setRemovingId(item.id);
      setRemoveError(null);
      await plaidAPI.removeItem(item.id);
      setRemoveTarget(null);
      await fetchItems();
    } catch (err: any) {
      console.error('Remove bank error:', err);
      setRemoveError(errorMessage(err, `Could not remove ${item.institutionName}. Try again.`));
    } finally {
      setRemovingId(null);
    }
  };

  const items = data?.items ?? [];
  const used = data?.used ?? 0;
  const limit = data?.limit ?? 10;
  const yours = items.length;
  const atLimit = used >= limit;
  const progressPercent = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;

  const addBankButton = (
    <PlaidLink onSuccess={() => fetchItems()} buttonText="Add bank" disabled={atLimit} />
  );

  return (
    <SidebarLayout title="Connections">
      {error && (
        <div
          role="alert"
          className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-md bg-terra-tint px-4 py-3 text-sm text-terra"
        >
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={() => fetchItems()}>
            Try again
          </Button>
        </div>
      )}

      <section aria-label="Connections" className="sheet">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 p-6 md:p-8">
          <div className="min-w-0">
            {loading && !data ? (
              <Skeleton className="h-11 w-64" />
            ) : (
              <>
                <p className="text-[15px] text-ink">
                  Banks used on this server: {used} of {limit} · {yours} {yours === 1 ? 'is' : 'are'} yours
                </p>
                <div
                  role="progressbar"
                  aria-label="Bank connections used"
                  aria-valuenow={used}
                  aria-valuemin={0}
                  aria-valuemax={limit}
                  className="mt-2 h-2 w-48 overflow-hidden rounded-sm bg-muted"
                >
                  <div
                    className={cn('h-2 rounded-sm', atLimit ? 'bg-terra' : 'bg-ink')}
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                {atLimit && (
                  <p className="mt-2 max-w-md text-sm text-terra">
                    All {limit} bank connections are in use. Remove one before adding another.
                  </p>
                )}
              </>
            )}
          </div>
          {/* The empty state below carries the button when there is nothing to add to. */}
          {items.length > 0 && <div>{addBankButton}</div>}
        </div>

        <section aria-label="Banks" className="border-t border-rule p-6 md:p-8">
          <h2 className="section-label">Banks</h2>
          {loading ? (
            <div className="mt-3" aria-busy="true">
              <span className="sr-only">Loading connections</span>
              <Skeleton className="h-6 w-48" />
              <Skeleton className="mt-4 h-24 w-full" />
            </div>
          ) : !data ? null : items.length === 0 ? (
            <>
              <p className="mt-2 max-w-md text-[15px] text-muted-foreground">
                No banks connected yet. Connect a bank to see its accounts, balances, and transactions
                in Mazzy Money.
              </p>
              <div className="mt-5">{addBankButton}</div>
            </>
          ) : (
            <div className="-mx-6 mt-2 md:-mx-8">
              {items.map((item) => (
                <div
                  key={item.id}
                  role="region"
                  aria-label={item.institutionName}
                  className="border-t border-rule px-6 py-5 first:border-t-0 first:pt-2 md:px-8"
                >
                  <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-[15px] font-semibold text-ink">{item.institutionName}</h3>
                      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                        <StatusTag status={item.status} />
                        <span className="text-muted-foreground">{formatLastSync(item.lastSyncAt)}</span>
                      </p>
                      {item.status === 'ERROR' && item.lastError && (
                        <p className="mt-1 text-xs text-muted-foreground">{item.lastError}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Update mode: reconnect the existing Item instead of using another free place. */}
                      {item.status === 'LOGIN_REQUIRED' && (
                        <PlaidLink
                          itemId={item.id}
                          buttonText="Reconnect"
                          variant="outline"
                          size="sm"
                          onSuccess={() => fetchItems()}
                        />
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-ink"
                        onClick={() => {
                          setRemoveError(null);
                          setRemoveTarget(item);
                        }}
                        disabled={removingId === item.id}
                      >
                        {removingId === item.id ? 'Removing…' : 'Remove'}
                      </Button>
                    </div>
                  </div>

                  {item.accounts.length > 0 && (
                    <ul className="mt-2">
                      {item.accounts.map((account) => (
                        <li
                          key={account.id}
                          className="ledger-line flex items-baseline justify-between gap-3 py-2.5 text-[15px] last:border-b-0"
                        >
                          <span className="flex min-w-0 items-baseline gap-2">
                            <span className="truncate" title={account.name}>
                              {account.name}
                            </span>
                            {account.mask && (
                              <span className="shrink-0 tabular-nums text-muted-foreground">
                                {formatMask(account.mask)}
                              </span>
                            )}
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {formatSubtype(account.subtype)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Accounts Plaid does not connect: the 401(k), car, house, cash. A section, not a second spread. */}
        <ManualAccounts asSection />
      </section>

      <AlertDialog
        open={Boolean(removeTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setRemoveTarget(null);
            setRemoveError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removeTarget?.institutionName}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its accounts and transactions will be deleted from Mazzy Money.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {removeError && (
            <p role="alert" className="text-sm text-terra">
              {removeError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(removingId)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={Boolean(removingId)}
              onClick={(event) => {
                // Keep the dialog open while the request runs; the list reloads first.
                event.preventDefault();
                if (removeTarget) handleRemove(removeTarget);
              }}
            >
              {removingId ? 'Removing…' : 'Remove bank'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarLayout>
  );
};

export default ConnectionsPage;
