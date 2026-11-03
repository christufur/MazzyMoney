import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import SidebarLayout from '../components/layout/SidebarLayout';
import { recurringAPI } from '../services/api';
import type { RecurringResponse, RecurringSeries, RecurringStatus } from '../services/api';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { money } from '@/lib/money';

/** The labels the detector's intervals map to on the page. */
const FREQUENCY_LABELS: Record<number, string> = {
  7: 'Weekly',
  14: 'Every 2 weeks',
  30: 'Monthly',
  91: 'Quarterly',
  365: 'Yearly',
};

const frequencyLabel = (intervalDays: number) =>
  FREQUENCY_LABELS[intervalDays] ?? `Every ${intervalDays} days`;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Dates are UTC midnight in the API, so read them in UTC to avoid a day's drift. */
const shortDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
};

/** Today's UTC midnight, the line an expected charge crosses once its day has passed. */
const startOfToday = () => {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
};

/** The charge was due and never arrived: the row states that instead of a date. */
const overdueLabel = (row: RecurringSeries) => `Expected ${shortDate(row.nextDate)}, not seen yet`;

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Phone stacks name over the facts; from md the columns line up under the header. */
// Fixed last column: the header's empty cell must be as wide as the rows' Ignore button.
const ROW_GRID = 'md:grid-cols-[minmax(0,1fr)_7rem_6rem_6rem_10rem_5rem]';

interface SeriesRowProps {
  row: RecurringSeries;
  ignored: boolean;
  overdue: boolean;
  busy: boolean;
  onToggle: (row: RecurringSeries) => void;
}

const SeriesRow: React.FC<SeriesRowProps> = ({ row, ignored, overdue, busy, onToggle }) => {
  const when = overdue ? overdueLabel(row) : shortDate(row.nextDate);

  return (
    <li
      data-testid={`recurring-row-${row.id}`}
      className={cn(
        'ledger-line grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-3 last:border-b-0 md:gap-x-4',
        ROW_GRID,
        ignored && 'text-muted-foreground'
      )}
    >
      <span className="min-w-0">
        <span className={cn('block truncate text-[15px]', ignored ? 'text-muted-foreground' : 'text-ink')}>
          {row.displayName}
        </span>
        <span className="mt-0.5 block text-xs md:hidden">
          {frequencyLabel(row.intervalDays)} · ≈ {money(row.monthlyEquivalent)} a month ·{' '}
          <span className={cn(overdue && 'text-muted-foreground')}>{when}</span>
        </span>
      </span>
      <span className="hidden text-sm md:block">{frequencyLabel(row.intervalDays)}</span>
      <span
        className={cn('hidden text-right text-sm tabular-nums md:block', ignored ? 'text-muted-foreground' : 'text-ink')}
      >
        {money(row.averageAmount)}
      </span>
      <span className="hidden text-right text-sm tabular-nums md:block">≈ {money(row.monthlyEquivalent)}</span>
      <span
        className={cn(
          'hidden text-right text-sm md:block',
          overdue ? 'text-muted-foreground' : ignored ? 'text-muted-foreground' : 'text-ink'
        )}
      >
        {when}
      </span>
      <span className="col-start-2 row-start-1 md:col-auto md:row-auto">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onToggle(row)}
          disabled={busy}
          className={cn('-mr-2 shrink-0 text-ink md:justify-self-end', !ignored && 'text-muted-foreground')}
        >
          {busy ? 'Saving…' : ignored ? 'Restore' : 'Ignore'}
        </Button>
      </span>
    </li>
  );
};

const RecurringPage: React.FC = () => {
  const [data, setData] = useState<RecurringResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setData(await recurringAPI.getAll());
    } catch (err: any) {
      console.error('Error loading recurring charges:', err);
      setError(err.response?.data?.error || 'Could not load repeating charges. Try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleRefresh = async () => {
    try {
      setRefreshing(true);
      setError(null);
      setData(await recurringAPI.refresh());
    } catch (err: any) {
      console.error('Error refreshing recurring charges:', err);
      setError(err.response?.data?.error || 'Could not look for repeating charges again. Try again.');
    } finally {
      setRefreshing(false);
    }
  };

  const handleToggle = async (row: RecurringSeries) => {
    const nextStatus: RecurringStatus = row.status === 'ACTIVE' ? 'IGNORED' : 'ACTIVE';

    try {
      setSavingId(row.id);
      setError(null);
      const response = await recurringAPI.setStatus(row.id, nextStatus);

      // Update in place so the total and the next-30-days list stay in step with the rows.
      setData((current) => {
        if (!current) return current;
        const series = current.series.map((item) =>
          item.id === response.series.id ? response.series : item
        );
        const active = series.filter((item) => item.status === 'ACTIVE');
        return {
          ...current,
          series,
          monthlyTotal: Math.round(
            active.reduce((sum, item) => sum + item.monthlyEquivalent, 0) * 100
          ),
        };
      });
    } catch (err: any) {
      console.error('Error updating recurring charge:', err);
      setError(err.response?.data?.error || 'Could not update this charge. Try again.');
    } finally {
      setSavingId(null);
    }
  };

  const today = useMemo(startOfToday, []);

  const { activeSeries, ignoredSeries, overdueIds, upcoming } = useMemo(() => {
    const rows = data?.series ?? [];
    const active = rows.filter((row) => row.status === 'ACTIVE');
    const cutoff = Date.now() + 30 * MS_PER_DAY;
    const overdue = new Set(
      active.filter((row) => new Date(row.nextDate).getTime() < today).map((row) => row.id)
    );

    return {
      activeSeries: active,
      ignoredSeries: rows.filter((row) => row.status === 'IGNORED'),
      overdueIds: overdue,
      // Expected means due already or due within 30 days; an overdue one stays at the top.
      upcoming: active
        .filter((row) => new Date(row.nextDate).getTime() <= cutoff)
        .sort((a, b) => new Date(a.nextDate).getTime() - new Date(b.nextDate).getTime()),
    };
  }, [data?.series, today]);

  const monthlyTotal = (data?.monthlyTotal ?? 0) / 100;
  const notSeenCount = overdueIds.size;
  const hasSeries = (data?.series.length ?? 0) > 0;

  const summary =
    notSeenCount > 0
      ? `About ${money(monthlyTotal)} a month, including ${count(notSeenCount, 'charge')} not seen yet this cycle`
      : `About ${money(monthlyTotal)} a month in repeating charges`;

  return (
    <SidebarLayout title="Recurring">
      {error && (
        <div
          role="alert"
          className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-md bg-terra-tint px-4 py-3 text-sm text-terra"
        >
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={load}>
            Try again
          </Button>
        </div>
      )}

      <section aria-label="Recurring charges" className="sheet">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 p-6 md:p-8">
          <div>
            {loading && !data ? (
              <Skeleton className="h-8 w-80" />
            ) : (
              <>
                <p className="text-figure font-semibold text-ink">{summary}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  From {count(activeSeries.length, 'active series', 'active series')}
                  {ignoredSeries.length > 0 && ` · ${ignoredSeries.length} ignored`}
                </p>
              </>
            )}
          </div>
          <Button variant="outline" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw className={cn(refreshing && 'animate-spin')} />
            Refresh
          </Button>
        </div>

        <section aria-label="Next 30 days" className="border-t border-rule p-6 md:p-8">
          <h2 className="section-label">Next 30 days</h2>
          <p className="mt-1 text-sm text-muted-foreground">Bills the detector expects to see soon.</p>
          {loading ? (
            <div className="mt-3">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="mt-3 h-4 w-56" />
              <Skeleton className="mt-3 h-4 w-48" />
            </div>
          ) : upcoming.length === 0 ? (
            <p className="mt-3 text-[15px] text-muted-foreground">No bills expected in the next 30 days.</p>
          ) : (
            <ul className="mt-1">
              {upcoming.map((row) => {
                const overdue = overdueIds.has(row.id);
                return (
                  <li
                    key={row.id}
                    data-testid={`upcoming-row-${row.id}`}
                    className="ledger-line grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 py-2.5 text-sm last:border-b-0"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-ink">{row.displayName}</span>
                      <span className="block text-xs text-muted-foreground">
                        {overdue ? overdueLabel(row) : shortDate(row.nextDate)}
                      </span>
                    </span>
                    <span className="text-right font-medium tabular-nums">{money(row.averageAmount)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-label="All recurring charges" className="border-t border-rule p-6 md:p-8">
          <h2 className="section-label">All recurring</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Found from your transactions. Ignore one to keep it out of the monthly total.
          </p>

          {loading ? (
            <div className="mt-3">
              <Skeleton className="h-4 w-52" />
              <Skeleton className="mt-3 h-4 w-44" />
              <Skeleton className="mt-3 h-4 w-48" />
            </div>
          ) : !hasSeries ? (
            <p className="mt-3 text-[15px] text-muted-foreground">
              No recurring charges found yet. They appear after a few months of transactions.
            </p>
          ) : (
            <>
              <div
                aria-hidden
                className={cn(
                  'section-label mt-4 hidden border-b border-rule pb-2 md:grid md:gap-x-4',
                  ROW_GRID
                )}
              >
                <span>Name</span>
                <span>Repeats</span>
                <span className="text-right">Amount</span>
                <span className="text-right">A month</span>
                <span className="text-right">Next</span>
                <span />
              </div>
              <ul>
                {activeSeries.map((row) => (
                  <SeriesRow
                    key={row.id}
                    row={row}
                    ignored={false}
                    overdue={overdueIds.has(row.id)}
                    busy={savingId === row.id}
                    onToggle={handleToggle}
                  />
                ))}
              </ul>
            </>
          )}
        </section>

        {!loading && ignoredSeries.length > 0 && (
          <section
            aria-label={`Ignored (${ignoredSeries.length})`}
            className="border-t border-rule p-6 md:p-8"
          >
            <h2 className="section-label">Ignored ({ignoredSeries.length})</h2>
            <p className="mt-1 text-sm text-muted-foreground">Left out of the monthly total.</p>
            <ul className="mt-1">
              {ignoredSeries.map((row) => (
                <SeriesRow
                  key={row.id}
                  row={row}
                  ignored
                  overdue={false}
                  busy={savingId === row.id}
                  onToggle={handleToggle}
                />
              ))}
            </ul>
          </section>
        )}
      </section>
    </SidebarLayout>
  );
};

export default RecurringPage;
