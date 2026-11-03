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

/**
 * Rebuilds the payload the API returns after a local change, so the total and the
 * "Next 30 days" list follow an Ignore/Restore without another round trip.
 */
const buildPayload = (series: RecurringSeries[]): RecurringResponse => {
  const active = series.filter((row) => row.status === 'ACTIVE');
  const now = new Date();
  const windowStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const cutoff = now.getTime() + 30 * MS_PER_DAY;

  return {
    series,
    monthlyTotal: Math.round(active.reduce((sum, row) => sum + row.monthlyEquivalent, 0) * 100),
    upcoming: active
      .filter((row) => {
        const next = new Date(row.nextDate).getTime();
        return next >= windowStart && next <= cutoff;
      })
      .sort((a, b) => new Date(a.nextDate).getTime() - new Date(b.nextDate).getTime()),
  };
};

/** Dates are UTC midnight in the API, so read them in UTC to avoid a day's drift. */
const shortDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
};

/** Phone stacks name over the facts; from md the columns line up under the header. */
// Fixed last column: the header's empty cell must be as wide as the rows' Ignore button.
const ROW_GRID = 'md:grid-cols-[minmax(0,1fr)_8rem_6rem_6rem_6rem_5rem]';

interface SeriesRowProps {
  row: RecurringSeries;
  ignored: boolean;
  busy: boolean;
  onToggle: (row: RecurringSeries) => void;
}

const SeriesRow: React.FC<SeriesRowProps> = ({ row, ignored, busy, onToggle }) => (
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
        {frequencyLabel(row.intervalDays)} · ≈ {money(row.monthlyEquivalent)} a month · next{' '}
        {shortDate(row.nextDate)}
      </span>
    </span>
    <span className="hidden text-sm md:block">{frequencyLabel(row.intervalDays)}</span>
    <span
      className={cn('hidden text-right text-sm tabular-nums md:block', ignored ? 'text-muted-foreground' : 'text-ink')}
    >
      {money(row.averageAmount)}
    </span>
    <span className="hidden text-right text-sm tabular-nums md:block">≈ {money(row.monthlyEquivalent)}</span>
    <span className="hidden text-right text-sm md:block">{shortDate(row.nextDate)}</span>
    <span className="col-start-2 row-start-1 md:col-auto md:row-auto">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onToggle(row)}
        disabled={busy}
        className={cn('-mr-2 shrink-0 md:justify-self-end', ignored ? 'text-ink' : 'text-muted-foreground')}
      >
        {busy ? 'Saving…' : ignored ? 'Restore' : 'Ignore'}
      </Button>
    </span>
  </li>
);

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
        const updated = current.series.map((item) => (item.id === response.series.id ? response.series : item));
        return buildPayload(updated);
      });
    } catch (err: any) {
      console.error('Error updating recurring charge:', err);
      setError(err.response?.data?.error || 'Could not update this charge. Try again.');
    } finally {
      setSavingId(null);
    }
  };

  const { activeSeries, ignoredSeries } = useMemo(() => {
    const rows = data?.series ?? [];
    return {
      activeSeries: rows.filter((row) => row.status === 'ACTIVE'),
      ignoredSeries: rows.filter((row) => row.status === 'IGNORED'),
    };
  }, [data?.series]);

  const monthlyTotal = (data?.monthlyTotal ?? 0) / 100;
  const upcoming = data?.upcoming ?? [];
  const hasSeries = (data?.series.length ?? 0) > 0;

  return (
    <SidebarLayout title="Recurring">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div>
          {loading && !data ? (
            <Skeleton className="h-8 w-80" />
          ) : (
            <>
              <p className="text-figure font-semibold text-ink">
                About {money(monthlyTotal)} a month in repeating charges
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {activeSeries.length === 1 ? 'From 1 active series' : `From ${activeSeries.length} active series`}
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

      <section aria-label="Next 30 days" className="sheet mb-8 px-5 py-5 md:px-6 md:py-6">
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
            {upcoming.map((row) => (
              <li
                key={row.id}
                className="ledger-line grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-3 py-2.5 text-sm last:border-b-0"
              >
                <span className="text-muted-foreground">{shortDate(row.nextDate)}</span>
                <span className="truncate">{row.displayName}</span>
                <span className="text-right font-medium tabular-nums">{money(row.averageAmount)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="All recurring charges" className="sheet px-5 py-5 md:px-6 md:py-6">
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
                <SeriesRow key={row.id} row={row} ignored={false} busy={savingId === row.id} onToggle={handleToggle} />
              ))}
            </ul>

            {ignoredSeries.length > 0 && (
              <>
                <h3 className="section-label mt-5 border-b border-rule pb-2">Ignored ({ignoredSeries.length})</h3>
                <ul>
                  {ignoredSeries.map((row) => (
                    <SeriesRow
                      key={row.id}
                      row={row}
                      ignored
                      busy={savingId === row.id}
                      onToggle={handleToggle}
                    />
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </section>
    </SidebarLayout>
  );
};

export default RecurringPage;
