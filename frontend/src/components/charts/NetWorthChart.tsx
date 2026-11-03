import React, { useEffect, useState } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { networthAPI } from '../../services/api';
import type { NetWorthAccount, NetWorthRange, NetWorthResponse } from '../../services/api';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { money } from '@/lib/money';

/**
 * Net worth over time. The server already counts credit cards and loans
 * negative, so every number here is used as-is.
 */
const RANGE_OPTIONS: Array<{ value: NetWorthRange; label: string }> = [
  { value: '1m', label: '1M' },
  { value: '3m', label: '3M' },
  { value: '6m', label: '6M' },
  { value: '1y', label: '1Y' },
  { value: 'all', label: 'All' },
];

const DEFAULT_RANGE: NetWorthRange = '6m';

const MINUS = '\u2212';

/** A change over the range: "+$1,500.50" / "−$250.25". */
const signedChange = (amount: number) => `${amount < 0 ? MINUS : '+'}${money(Math.abs(amount))}`;

/** A balance: "$25,000.00" / "−$22,000.00". */
const signedBalance = (amount: number) => `${amount < 0 ? MINUS : ''}${money(Math.abs(amount))}`;

const formatPercent = (percent: number) => `${percent < 0 ? MINUS : '+'}${Math.abs(percent).toFixed(1)}%`;

/** Compact axis labels: $1.2k, $1.2M. */
const formatAxisMoney = (amount: number) => {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? MINUS : '';

  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
};

const parseDay = (date: string) => new Date(`${date}T00:00:00Z`);

/** Short month labels; UTC so a date never shifts a day west of Greenwich. */
const formatShortDate = (date: string) =>
  parseDay(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

const formatLongDate = (date: string) =>
  parseDay(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });

const errorMessage = (err: any) => {
  const serverError = err?.response?.data?.error;
  if (typeof serverError === 'string' && serverError.trim()) {
    return serverError;
  }
  return 'Could not load your net worth. Try again.';
};

interface ChartTooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: Array<{ payload?: { netWorth?: number; assets?: number; liabilities?: number } }>;
}

/** A small paper stub: the day, then the three figures behind it. */
const ChartTooltip: React.FC<ChartTooltipProps> = ({ active, label, payload }) => {
  if (!active || !payload?.length) return null;

  const point = payload[0]?.payload;
  if (!point) return null;

  return (
    <div className="min-w-[12rem] rounded-md border border-rule bg-card px-3 py-2">
      <p className="mb-1.5 text-xs text-muted-foreground">{formatLongDate(String(label))}</p>
      <dl className="space-y-0.5 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-ink">Net worth</dt>
          <dd className="font-semibold tabular-nums text-ink">{money(point.netWorth ?? 0)}</dd>
        </div>
        <div className="flex justify-between gap-4 text-xs">
          <dt className="text-muted-foreground">Assets</dt>
          <dd className="tabular-nums text-muted-foreground">{money(point.assets ?? 0)}</dd>
        </div>
        <div className="flex justify-between gap-4 text-xs">
          <dt className="text-muted-foreground">Liabilities</dt>
          <dd className="tabular-nums text-muted-foreground">
            {signedBalance(-Math.abs(point.liabilities ?? 0))}
          </dd>
        </div>
      </dl>
    </div>
  );
};

/** One ledger row: the account, a quiet "manual" tag when it is, and its balance. */
const BalanceRow: React.FC<{ account: NetWorthAccount }> = ({ account }) => {
  const amount = account.isLiability ? -Math.abs(account.balance) : account.balance;

  return (
    <li className="ledger-line flex items-baseline justify-between gap-3 py-2.5 text-[15px] last:border-b-0">
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="truncate" title={account.name}>
          {account.name}
        </span>
        {account.isManual && <span className="shrink-0 text-xs text-muted-foreground">manual</span>}
      </span>
      <span className="shrink-0 tabular-nums text-ink">{signedBalance(amount)}</span>
    </li>
  );
};

interface BalanceColumnProps {
  label: string;
  accounts: NetWorthAccount[];
  total: number;
  empty: string;
}

const BalanceColumn: React.FC<BalanceColumnProps> = ({ label, accounts, total, empty }) => (
  <div>
    <h2 className="section-label">{label}</h2>
    {accounts.length === 0 ? (
      <p className="mt-3 text-[15px] text-muted-foreground">{empty}</p>
    ) : (
      <ul className="mt-1">
        {accounts.map((account) => (
          <BalanceRow key={account.id} account={account} />
        ))}
      </ul>
    )}
    <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-rule pt-3 text-[15px]">
      <span className="text-muted-foreground">Total</span>
      <span className="font-semibold tabular-nums text-ink">{signedBalance(total)}</span>
    </div>
  </div>
);

const NetWorthChart: React.FC = () => {
  const [range, setRange] = useState<NetWorthRange>(DEFAULT_RANGE);
  const [data, setData] = useState<NetWorthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Bumping this re-runs the fetch for the same range (the Try again button).
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await networthAPI.get(range);
        // A late answer for an old range must not overwrite the new one.
        if (!cancelled) {
          setData(response);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(errorMessage(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchData();

    return () => {
      cancelled = true;
    };
  }, [range, reloadKey]);

  const retry = () => setReloadKey((key) => key + 1);

  const points = data?.points ?? [];
  const accounts = data?.accounts ?? [];
  const assets = accounts.filter((account) => !account.isLiability);
  const liabilities = accounts.filter((account) => account.isLiability);

  const netWorth = data?.current.netWorth ?? 0;
  const changeAmount = data?.change.amount ?? 0;
  const percent = data?.change.percent ?? null;
  const changePositive = changeAmount >= 0;

  return (
    <>
      <section className="sheet" aria-label="Net worth">
        <div className="p-6 md:p-8">
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
            <div className="min-w-0">
              {loading && !data ? (
                <Skeleton className="h-10 w-48" />
              ) : (
                <p className="text-title font-semibold text-ink" data-testid="net-worth-value">
                  {data ? money(netWorth) : '—'}
                </p>
              )}
              {data && (
                <p className="mt-1 text-sm">
                  <span
                    className={cn('font-medium tabular-nums', changePositive ? 'text-sage-ink' : 'text-ink')}
                    data-testid="net-worth-change"
                  >
                    {signedChange(changeAmount)}
                  </span>
                  {percent !== null && (
                    <span className="ml-1.5 tabular-nums text-muted-foreground">({formatPercent(percent)})</span>
                  )}
                  <span className="ml-1.5 text-muted-foreground">in this range</span>
                </p>
              )}
            </div>

            <Tabs value={range} onValueChange={(value) => setRange(value as NetWorthRange)}>
              <TabsList variant="line" aria-label="Net worth range" className="gap-4">
                {RANGE_OPTIONS.map((option) => (
                  <TabsTrigger key={option.value} value={option.value} className="h-8 flex-none px-0">
                    {option.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>

          {error && (
            <div
              role="alert"
              className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-md bg-terra-tint px-4 py-3 text-sm text-terra"
            >
              <span>{error}</span>
              <Button variant="outline" size="sm" onClick={retry}>
                Try again
              </Button>
            </div>
          )}

          <div className="mt-6">
            {loading && !data ? (
              <Skeleton className="h-64 w-full" />
            ) : points.length === 0 ? (
              error ? null : (
                <p className="text-[15px] text-muted-foreground">
                  Net worth history starts after your first sync. Add manual accounts on the Connections
                  page.
                </p>
              )
            ) : (
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={points} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--border)" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={formatShortDate}
                      tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
                      tickLine={false}
                      axisLine={false}
                      minTickGap={24}
                    />
                    <YAxis
                      tickFormatter={formatAxisMoney}
                      tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
                      tickLine={false}
                      axisLine={false}
                      width={64}
                    />
                    <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--border)' }} />
                    <Area
                      type="monotone"
                      dataKey="netWorth"
                      name="Net worth"
                      stroke="var(--sage)"
                      strokeWidth={2}
                      fill="var(--sage)"
                      fillOpacity={0.08}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      </section>

      {accounts.length > 0 && (
        <section className="sheet mt-6 grid gap-8 p-6 md:grid-cols-2 md:p-8" aria-label="Assets and liabilities">
          <BalanceColumn
            label="Assets"
            accounts={assets}
            total={data?.current.assets ?? 0}
            empty="No asset accounts."
          />
          <BalanceColumn
            label="Liabilities"
            accounts={liabilities}
            total={-Math.abs(data?.current.liabilities ?? 0)}
            empty="No liabilities."
          />
        </section>
      )}
    </>
  );
};

export default NetWorthChart;
