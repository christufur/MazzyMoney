import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import SidebarLayout from '../components/layout/SidebarLayout';
import {
  accountAPI,
  budgetAPI,
  networthAPI,
  recurringAPI,
  transactionAPI,
  type Budget,
  type NetWorthResponse,
  type RecurringSeries,
} from '../services/api';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { addMonths, isoDay, money, moneyWhole, monthKey, monthName, parseMonth } from '@/lib/money';
import { reflectOnMonth } from '@/lib/reflection';
import { historyChange, realHistory } from '@/lib/networth';

interface Summary { income: number; expenses: number }
interface ReviewRow { id: string; date: string; name: string; merchantName?: string | null; merchantDisplay?: string | null; amount: number; primaryCategory?: string | null }
interface SyncInfo { connected: boolean; status: string; lastSyncAt: string | null }

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

const since = (iso: string | null) => {
  if (!iso) return 'Not synced yet';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'Synced just now';
  if (min < 60) return `Synced ${min} min ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `Synced ${h} h ago` : `Synced ${new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
};

function rangeFor(month: string, cutDay?: number) {
  const start = parseMonth(month);
  const lastDay = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
  const end = new Date(start.getFullYear(), start.getMonth(), Math.min(cutDay ?? lastDay, lastDay));
  return { dateFrom: isoDay(start), dateTo: isoDay(end) };
}

const Figure: React.FC<{ label: string; value: string; tone?: 'sage' | 'terra' }> = ({ label, value, tone }) => (
  <div className="border-b border-rule pb-3">
    <div className="text-sm text-muted-foreground">{label}</div>
    <div className={cn('mt-1 text-figure font-semibold tabular-nums', tone === 'sage' && 'text-sage-ink', tone === 'terra' && 'text-terra')}>
      {value}
    </div>
  </div>
);

const PlanLine: React.FC<{ b: Budget }> = ({ b }) => {
  const over = b.spent > b.available;
  const pct = b.available > 0 ? Math.min(100, (b.spent / b.available) * 100) : b.spent > 0 ? 100 : 0;
  return (
    <li className="ledger-line grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-4 py-3 text-[15px]">
      <span className="truncate">{b.category}</span>
      <span className="h-2 rounded-sm bg-muted" aria-hidden>
        <span className={cn('block h-2 rounded-sm', over ? 'bg-terra' : 'bg-sage')} style={{ width: `${pct}%` }} />
      </span>
      <span className={cn('text-right tabular-nums', over ? 'text-terra' : 'text-muted-foreground')}>
        <span className={cn('font-medium', !over && 'text-ink')}>{moneyWhole(b.spent)}</span> / {moneyWhole(b.available)}
      </span>
    </li>
  );
};

const Overview: React.FC = () => {
  const thisMonth = monthKey(new Date());
  const [month, setMonth] = useState(thisMonth);
  const isCurrent = month === thisMonth;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary>({ income: 0, expenses: 0 });
  const [lastSaved, setLastSaved] = useState<number | null>(null);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [review, setReview] = useState<{ rows: ReviewRow[]; total: number }>({ rows: [], total: 0 });
  const [upcoming, setUpcoming] = useState<RecurringSeries[]>([]);
  const [netWorth, setNetWorth] = useState<NetWorthResponse | null>(null);
  const [sync, setSync] = useState<SyncInfo | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const today = new Date().getDate();
    try {
      const [monthTx, budgetRes, accounts] = await Promise.all([
        transactionAPI.getTransactions({ ...rangeFor(month), limit: 1 }),
        budgetAPI.getBudgets(month),
        accountAPI.getAccounts(),
      ]);
      setSummary({ income: monthTx.summary?.income ?? 0, expenses: monthTx.summary?.expenses ?? 0 });
      setBudgets(budgetRes.budgets ?? []);
      setConnected(Boolean(accounts?.connected));

      // Secondary panels: a failure here leaves the panel empty instead of failing the page.
      const [prevTx, reviewTx, rec, nw, st] = await Promise.allSettled([
        transactionAPI.getTransactions({ ...rangeFor(addMonths(month, -1), isCurrent ? today : undefined), limit: 1 }),
        transactionAPI.getTransactions({ reviewed: false, limit: 6 }),
        recurringAPI.getAll(),
        networthAPI.get('6m'),
        transactionAPI.getSyncStatus(),
      ]);
      setLastSaved(prevTx.status === 'fulfilled' && prevTx.value.summary
        ? (prevTx.value.summary.income ?? 0) - (prevTx.value.summary.expenses ?? 0)
        : null);
      setReview(reviewTx.status === 'fulfilled'
        ? { rows: reviewTx.value.transactions ?? [], total: reviewTx.value.pagination?.totalCount ?? 0 }
        : { rows: [], total: 0 });
      setUpcoming(rec.status === 'fulfilled' ? rec.value.upcoming.slice(0, 5) : []);
      setNetWorth(nw.status === 'fulfilled' ? nw.value : null);
      setSync(st.status === 'fulfilled' ? st.value : null);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Could not load this month. Check that the server is running, then try again.');
    } finally {
      setLoading(false);
    }
  }, [month, isCurrent]);

  useEffect(() => { load(); }, [load]);

  // While a sync runs, check every 3 s and reload the month when it finishes.
  useEffect(() => {
    if (!syncing) return;
    const t = setInterval(async () => {
      const st = await transactionAPI.getSyncStatus().catch(() => null);
      if (st && st.status !== 'SYNCING') {
        setSyncing(false);
        load();
      }
    }, 3000);
    return () => clearInterval(t);
  }, [syncing, load]);

  const startSync = async () => {
    try {
      await transactionAPI.syncTransactions(false);
      setSyncing(true);
    } catch (err: any) {
      if (err.response?.status === 409) setSyncing(true);
      else setError(err.response?.data?.error || 'Could not start a sync. Try again in a minute.');
    }
  };

  const saved = summary.income - summary.expenses;
  const start = parseMonth(month);
  const daysInMonth = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();

  const reflection = useMemo(
    () =>
      reflectOnMonth({
        isCurrentMonth: isCurrent,
        monthLabel: monthName(month, false),
        nextMonthLabel: monthName(addMonths(month, 1), false),
        income: summary.income,
        spent: summary.expenses,
        lastMonthSaved: lastSaved,
        overLines: budgets.map((b) => ({ category: b.category, over: b.spent - b.available, rollover: b.rollover })),
        hasBudgets: budgets.length > 0,
      }),
    [isCurrent, month, summary, lastSaved, budgets]
  );

  return (
    <SidebarLayout title={monthName(month)} showTitle={false}>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}>
            <ChevronLeft />
          </Button>
          <div>
            <h1 className="text-title font-semibold text-ink">{monthName(month)}</h1>
            <p className="text-sm text-muted-foreground">
              {isCurrent ? `Day ${new Date().getDate()} of ${daysInMonth}` : 'Closed month'}
            </p>
          </div>
          <Button variant="ghost" size="icon" aria-label="Next month" disabled={isCurrent} onClick={() => setMonth(addMonths(month, 1))}>
            <ChevronRight />
          </Button>
        </div>
        {sync?.connected && (
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span aria-live="polite">{syncing || sync.status === 'SYNCING' ? 'Syncing your banks…' : sync.status === 'TOKEN_EXPIRED'
              ? <Link to="/connections" className="text-terra underline underline-offset-4">A bank needs you to log in again</Link>
              : since(sync.lastSyncAt)}</span>
            <Button variant="outline" size="sm" onClick={startSync} disabled={syncing}>
              <RefreshCw className={cn(syncing && 'animate-spin')} /> Sync now
            </Button>
          </div>
        )}
      </div>

      {error && (
        <div role="alert" className="mb-6 flex items-center justify-between gap-4 rounded-md bg-terra-tint px-4 py-3 text-sm text-terra">
          {error}
          <Button variant="outline" size="sm" onClick={load}>Try again</Button>
        </div>
      )}

      {connected === false && !loading && (
        <p className="mb-6 rounded-md border border-rule bg-card px-4 py-3 text-sm">
          No bank is connected yet. <Link to="/connections" className="font-medium underline underline-offset-4">Connect a bank</Link> to fill this ledger, or add a manual account there.
        </p>
      )}

      <section
        aria-label={`${monthName(month)} ledger`}
        className="sheet flex flex-col md:grid md:grid-cols-2"
      >
        <div className="contents md:block">
        <div className="order-1 p-6 md:p-8">
          {loading ? <Skeleton className="h-20" /> : (
            <div className="grid grid-cols-3 gap-5">
              <Figure label="Income" value={moneyWhole(summary.income)} />
              <Figure label="Spent" value={moneyWhole(summary.expenses)} />
              <Figure
                label={saved >= 0 ? (isCurrent ? 'Saved so far' : 'Saved') : (isCurrent ? 'Net so far' : 'Net')}
                value={saved >= 0 ? moneyWhole(saved) : `−${moneyWhole(-saved)}`}
                tone={saved > 0 ? 'sage' : undefined}
              />
            </div>
          )}
        </div>

        <div className="order-3 border-t border-rule p-6 md:p-8">
          <h2 className="section-label mb-1">Plan for the month</h2>
          {loading ? <Skeleton className="mt-3 h-40" /> : budgets.length === 0 ? (
            <p className="mt-3 text-[15px] text-muted-foreground">
              No budgets yet. <Link to="/budgets" className="font-medium text-ink underline underline-offset-4">Plan this month</Link> to see each line here.
            </p>
          ) : (
            <ul>{budgets.map((b) => <PlanLine key={b.id} b={b} />)}</ul>
          )}
          {!loading && (
            <p className="mt-6 rounded-md bg-paper px-5 py-4 text-[15px] leading-relaxed">{reflection}</p>
          )}
        </div>

        </div>
        <div className="contents md:block md:border-l md:border-rule">
        <div className="order-2 border-t border-rule p-6 md:border-t-0 md:p-8">
          <h2 className="section-label mb-3">
            {review.total > 0 ? `To review · ${review.total} new` : 'To review'}
          </h2>
          {loading ? <Skeleton className="h-40" /> : review.total === 0 ? (
            <p className="text-[15px] text-muted-foreground">Everything is reviewed. New transactions appear here after each sync.</p>
          ) : (
            <>
              <ul>
                {review.rows.map((t) => (
                  <li key={t.id} className="grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-muted py-2.5 text-sm">
                    <span className="text-muted-foreground">{shortDate(t.date)}</span>
                    <span className="flex min-w-0 items-center gap-2">
                      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-terra" />
                      <span className="truncate">{t.merchantDisplay ?? t.merchantName ?? t.name}</span>
                    </span>
                    <span className={cn('text-right font-medium tabular-nums', t.amount < 0 && 'text-sage-ink')}>
                      {t.amount < 0 ? `+${money(-t.amount)}` : money(t.amount)}
                    </span>
                  </li>
                ))}
              </ul>
              <Button asChild className="mt-5">
                <Link to="/transactions">Review {review.total} transaction{review.total === 1 ? '' : 's'}</Link>
              </Button>
            </>
          )}
        </div>

        <div className="order-4 border-t border-rule p-6 md:p-8">
          <h2 className="section-label mb-1">Coming up</h2>
          {loading ? <Skeleton className="mt-3 h-24" /> : upcoming.length === 0 ? (
            <p className="mt-3 text-[15px] text-muted-foreground">No repeating bills due in the next 30 days.</p>
          ) : (
            <ul>
              {upcoming.map((s) => (
                <li key={s.id} className="ledger-line grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-3 py-2.5 text-sm">
                  <span className="text-muted-foreground">{shortDate(s.nextDate)}</span>
                  <span className="truncate">{s.displayName}</span>
                  <span className="text-right font-medium tabular-nums">{money(s.averageAmount)}</span>
                </li>
              ))}
            </ul>
          )}
          {netWorth && (() => {
            const history = realHistory(netWorth.points);
            const change = historyChange(history);
            if (history.length === 0) return null;
            return (
              <Link to="/net-worth" className="mt-6 flex items-baseline justify-between gap-4 rounded-md px-1 py-1 text-sm hover:bg-paper">
                <span className="text-muted-foreground">Net worth</span>
                <span className="tabular-nums">
                  <span className="font-semibold">{moneyWhole(netWorth.current.netWorth)}</span>{' '}
                  {change && (
                    <span className={change.amount >= 0 ? 'text-sage-ink' : 'text-ink'}>
                      {change.amount >= 0 ? '+' : '−'}{moneyWhole(Math.abs(change.amount))} since {shortDate(history[0].date)}
                    </span>
                  )}
                </span>
              </Link>
            );
          })()}
        </div>
        </div>
      </section>
    </SidebarLayout>
  );
};

export default Overview;
