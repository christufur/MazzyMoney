import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { categoryAPI, transactionAPI, type TransactionChanges } from '../../services/api';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { ReviewCard } from './ReviewCard';
import { LEDGER_GRID, TransactionRowView } from './TransactionRowView';
import { RowToggle } from './RowToggle';
import { offerRule } from './offerRule';
import { usePhoneLayout } from './usePhoneLayout';
import { displayNameOf } from './transaction';
import type { TransactionRow } from './transaction';

const PAGE_SIZE = 50;
/** Ask for the next page while there are still this many rows ahead. */
const PREFETCH_AT = 3;

interface ReviewQueueProps {
  /** Called when the last card of the queue is answered. */
  onFinished?: () => void;
}

/**
 * The daily habit, one transaction at a time.
 *
 * On a phone each card fills the screen and the track snaps to the next, so
 * "Looks right" is a single tap and swiping either way is free. On a desktop the
 * same queue is the ruled list, moved with J and K and answered with Enter.
 *
 * The queue never guesses a category for you. It puts the one thing that needs a
 * human in front of you, then gets out of the way.
 */
export const ReviewQueue: React.FC<ReviewQueueProps> = ({ onFinished }) => {
  const phone = usePhoneLayout();

  const [rows, setRows] = useState<TransactionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [answered, setAnswered] = useState(0);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [memoOpen, setMemoOpen] = useState<Set<string>>(new Set());
  const [editingNote, setEditingNote] = useState<string | null>(null);

  /** The card the reader is on; null means the first one. */
  const [cursorId, setCursorId] = useState<string | null>(null);
  const rowRefs = useRef<Array<HTMLElement | null>>([]);

  const found = cursorId ? rows.findIndex(row => row.id === cursorId) : 0;
  const index = found < 0 ? 0 : found;
  const current = rows[index] ?? null;

  useEffect(() => {
    let active = true;
    categoryAPI
      .getAll()
      .then(response => {
        if (active) setCategories(response.categories ?? []);
      })
      .catch(() => {
        // The selector loads its own list if the page could not preload one.
      });
    return () => {
      active = false;
    };
  }, []);

  // One page at a time: 50 rows is several minutes of reviewing.
  useEffect(() => {
    let active = true;

    (async () => {
      try {
        setError(null);
        if (page === 1) setLoading(true);
        const response = await transactionAPI.getTransactions({ reviewed: false, page, limit: PAGE_SIZE });
        if (!active) return;

        const incoming: TransactionRow[] = response.transactions ?? [];
        setRows(previous =>
          page === 1
            ? incoming
            : [...previous, ...incoming.filter(row => !previous.some(seen => seen.id === row.id))]
        );
        setHasNext(Boolean(response.pagination?.hasNext));
        if (page === 1) setTotal(response.pagination?.totalCount ?? incoming.length);
      } catch (err: any) {
        if (!active) return;
        setError(
          err.response?.data?.error ||
            'Could not load the review queue. Check that the server is running, then try again.'
        );
        setRows([]);
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [page]);

  // The next page arrives while the reader is still a few cards away from the end.
  useEffect(() => {
    if (loading || !hasNext || rows.length === 0) return;
    if (index >= rows.length - PREFETCH_AT) setPage(currentPage => currentPage + 1);
  }, [index, rows.length, hasNext, loading]);

  // Bring the cursor row into view whenever it moves.
  useEffect(() => {
    if (!cursorId) return;
    const node = rowRefs.current[index];
    if (!node || typeof node.scrollIntoView !== 'function') return;
    try {
      node.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    } catch {
      // An engine without options support leaves the track where it already is.
    }
  }, [cursorId, index]);

  const reload = useCallback(() => {
    setRows([]);
    setTotal(0);
    setAnswered(0);
    setCursorId(null);
    setPage(1);
    setHasNext(false);
    setLoading(true);
  }, []);

  /** The row after `at`, or the one before at the very end, so the track never goes blank. */
  const nextAfter = (at: number) => rows[at + 1]?.id ?? rows[at - 1]?.id ?? null;

  /** Moves on without saving anything. */
  const skip = () => {
    if (!current) return;
    setCursorId(nextAfter(index));
    setAnswered(value => value + 1);
  };

  const confirm = async (row: TransactionRow) => {
    if (busy) return;
    const at = Math.max(rows.findIndex(entry => entry.id === row.id), 0);
    try {
      setBusy(true);
      setActionError(null);
      await transactionAPI.update(row.id, { reviewed: true });
      setRows(previous => previous.filter(entry => entry.id !== row.id));
      setCursorId(nextAfter(at));
      setAnswered(value => value + 1);
      if (rows.length === 1) onFinished?.();
    } catch (err: any) {
      setActionError(err.response?.data?.error || 'Could not mark this reviewed. Try again.');
    } finally {
      setBusy(false);
    }
  };

  /** Transfer and hide are switches, not a form: the card shows the new state at once. */
  const setFlag = async (row: TransactionRow, changes: TransactionChanges) => {
    setRows(previous => previous.map(entry => (entry.id === row.id ? { ...entry, ...changes } : entry)));
    try {
      await transactionAPI.update(row.id, changes);
    } catch (err: any) {
      setRows(previous => previous.map(entry => (entry.id === row.id ? row : entry)));
      toast.error(err.response?.data?.error || 'Could not save that change. Try again.');
    }
  };

  const changeCategory = (row: TransactionRow, category: string) => {
    setRows(previous =>
      previous.map(entry => (entry.id === row.id ? { ...entry, primaryCategory: category } : entry))
    );
    offerRule({ transactionId: row.id, merchant: displayNameOf(row), category, onApplied: reload });
  };

  const setNote = (id: string, notes: string) =>
    setRows(previous => previous.map(entry => (entry.id === id ? { ...entry, notes } : entry)));

  const toggleMemo = (id: string) =>
    setMemoOpen(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // J and K move the cursor, Enter answers the row under it. Typing ignores all three.
  // No dependency array: the handler reads the freshest rows and cursor on every render,
  // and one listener being swapped per render is cheaper than a stale closure.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) {
        return;
      }

      if (event.key === 'j' || event.key === 'J') {
        event.preventDefault();
        setCursorId(rows[Math.min(index + 1, rows.length - 1)]?.id ?? null);
      } else if (event.key === 'k' || event.key === 'K') {
        event.preventDefault();
        setCursorId(rows[Math.max(index - 1, 0)]?.id ?? null);
      } else if (event.key === 'Enter') {
        // A focused control already answers its own Enter.
        if (target instanceof HTMLElement && target.closest('button, a, [role="switch"], [role="combobox"]')) {
          return;
        }
        if (!current) return;
        event.preventDefault();
        confirm(current);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const caughtUp = !loading && !error && rows.length === 0;
  const progress = useMemo(() => {
    if (total === 0) return 'Loading the queue…';
    return `${Math.min(answered + 1, total)} of ${total}`;
  }, [answered, total]);

  if (loading) {
    return (
      <div className="sheet space-y-4 p-5" aria-busy="true" aria-label="Loading the review queue">
        <Skeleton className="h-6 w-2/5" />
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-terra-tint px-4 py-3 text-sm text-terra"
      >
        <span>{error}</span>
        <Button variant="outline" size="sm" onClick={reload}>
          Try again
        </Button>
      </div>
    );
  }

  if (caughtUp) {
    return (
      <div className="sheet px-6 py-16 text-center">
        <p className="text-xl font-semibold text-ink">All caught up.</p>
        <p className="mx-auto mt-2 max-w-sm text-[15px] text-muted-foreground">
          Every new transaction has been looked at. The next sync brings more.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <Button asChild>
            <Link to="/overview">This month</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link to="/transactions">Back to transactions</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm tabular-nums text-muted-foreground" aria-live="polite">
          {progress}
        </p>
        <div className="flex items-center gap-3">
          {!phone && <p className="text-xs text-muted-foreground">J and K move · Enter marks</p>}
          <Button asChild variant="ghost" size="sm">
            <Link to="/transactions">Done</Link>
          </Button>
        </div>
      </div>

      {actionError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-terra-tint px-4 py-3 text-sm text-terra"
        >
          <span>{actionError}</span>
          <Button variant="outline" size="sm" onClick={() => setActionError(null)}>
            Dismiss
          </Button>
        </div>
      )}

      <div className="sheet overflow-hidden">
        {/* Desktop keeps the ruled header; on a phone the card names its own fields. */}
        {!phone && (
          <div
            aria-hidden
            className={cn('hidden items-center gap-4 border-b border-rule px-4 py-2 md:grid', LEDGER_GRID)}
          >
            <span className="size-4" />
            <span className="section-label">Date</span>
            <span className="section-label">Description</span>
            <span className="section-label">Account</span>
            <span className="section-label">Category</span>
            <span className="section-label text-right">Amount</span>
            <span />
          </div>
        )}

        <div
          role="list"
          aria-label="Transactions to review"
          className={cn(
            phone ? 'flex snap-x snap-mandatory overflow-x-auto' : 'block'
          )}
        >
          {rows.map((row, rowIndex) => {
            const isCurrent = rowIndex === index;
            const attach = (node: HTMLElement | null) => {
              rowRefs.current[rowIndex] = node;
            };

            if (phone) {
              return (
                <ReviewCard
                  key={row.id}
                  refCallback={attach}
                  row={row}
                  categories={categories}
                  busy={busy}
                  memoOpen={memoOpen.has(row.id)}
                  onToggleMemo={() => toggleMemo(row.id)}
                  editingNote={editingNote === row.id}
                  onEditingNote={open => setEditingNote(open ? row.id : null)}
                  onCategoryChange={category => changeCategory(row, category)}
                  onNoteChange={notes => setNote(row.id, notes)}
                  onFlag={changes => setFlag(row, changes)}
                  onConfirm={() => confirm(row)}
                  onSkip={skip}
                />
              );
            }

            return (
              <div key={row.id} ref={attach}>
                <TransactionRowView
                  row={row}
                  categories={categories}
                  active={isCurrent}
                  onCategoryChange={category => changeCategory(row, category)}
                  onNoteChange={notes => setNote(row.id, notes)}
                  detail={
                    <div className="flex flex-wrap items-center gap-2">
                      <RowToggle
                        label="Transfer"
                        checked={row.isTransfer}
                        onChange={checked => setFlag(row, { isTransfer: checked })}
                      />
                      <RowToggle
                        label="Hide from totals"
                        checked={row.hidden}
                        onChange={checked => setFlag(row, { hidden: checked })}
                      />
                      <Button size="xs" variant="ghost" onClick={skip} disabled={busy}>
                        Skip
                      </Button>
                    </div>
                  }
                  action={
                    <Button size="sm" onClick={() => confirm(row)} disabled={busy}>
                      Looks right
                    </Button>
                  }
                />
              </div>
            );
          })}
        </div>
      </div>

      {phone && <p className="text-xs text-muted-foreground">Swipe for the next one</p>}
    </div>
  );
};

export default ReviewQueue;
