import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import SidebarLayout from '../components/layout/SidebarLayout';
import CustomSankeyFlow from '../components/charts/sankey';
import { analyticsAPI, transactionAPI } from '../services/api';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { isoDay, money, moneyWhole } from '@/lib/money';

interface Summary {
  income: number;
  expenses: number;
}

interface CategoryRow {
  category: string;
  amount: number;
  transactionCount?: number;
}

interface TrendRow {
  month: string;
  income: number;
  expenses: number;
}

interface Insight {
  category: string;
  change: number;
  percentChange: number;
}

interface Merchant {
  name: string;
  totalSpent: number;
  transactionCount: number;
}

/* ---------- period ---------- */

type PeriodId = '1m' | '3m' | '6m' | '1y';

const PERIODS: { id: PeriodId; label: string; months: number }[] = [
  { id: '1m', label: '1M', months: 1 },
  { id: '3m', label: '3M', months: 3 },
  { id: '6m', label: '6M', months: 6 },
  { id: '1y', label: '1Y', months: 12 },
];

/** The first day of the month `monthsBack` months ago. Periods are calendar months. */
const monthStart = (monthsBack: number) => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
};

const rangeFor = (months: number) => ({
  dateFrom: isoDay(monthStart(months - 1)),
  dateTo: isoDay(new Date()),
});

const monthLabel = (date: Date) => date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
const shortMonth = (date: Date) => date.toLocaleDateString('en-US', { month: 'short' });

const rangeLabel = (months: number) => {
  if (months === 1) return `${monthStart(0).toLocaleDateString('en-US', { month: 'long' })} so far`;
  return `${monthLabel(monthStart(months - 1))} – ${monthLabel(new Date())}`;
};

/** Every calendar month in the period, oldest first, in the label the trends API returns. */
const monthsInRange = (months: number) =>
  Array.from({ length: months }, (_, index) => {
    const date = monthStart(months - 1 - index);
    return { label: monthLabel(date), short: shortMonth(date) };
  });

/* ---------- figures ---------- */

/** A finite number or zero: a missing or broken aggregate must never print a non-number. */
const safe = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/** The share of spending, with a floor that still tells the truth for tiny rows. */
const shareLabel = (value: number | null) => {
  if (value === null || !Number.isFinite(value) || value <= 0) return '—';
  if (value < 1) return '<1%';
  return `${Math.round(value)}%`;
};

/** `$1.5k` for axis ticks; exact money stays in the tooltip and the ledger. */
const compact = (value: number) => {
  const amount = safe(value);
  if (Math.abs(amount) >= 1000) {
    const thousands = amount / 1000;
    return `$${Number.isInteger(thousands) ? thousands : thousands.toFixed(1)}k`;
  }
  return `$${Math.round(amount)}`;
};

/** A rounded ceiling for the bar chart, so every month is measured on one scale. */
const scaleTop = (max: number) => {
  if (!Number.isFinite(max) || max <= 0) return 100;
  const step = 10 ** Math.floor(Math.log10(max));
  return Math.ceil(max / step) * step;
};

const Figure: React.FC<{ label: string; value: string; tone?: 'sage' }> = ({ label, value, tone }) => (
  <div className="border-b border-rule pb-3">
    <div className="text-sm text-muted-foreground">{label}</div>
    <div className={cn('mt-1 text-figure font-semibold tabular-nums', tone === 'sage' && 'text-sage-ink')}>
      {value}
    </div>
  </div>
);

const Section: React.FC<{ title: string; hint?: string; children: React.ReactNode }> = ({
  title,
  hint,
  children,
}) => (
  <section className="sheet p-6 md:p-8">
    <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h2 className="section-label">{title}</h2>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
    {children}
  </section>
);

const LedgerRow: React.FC<{ name: string; amount: number; share: number | null; max: number }> = ({
  name,
  amount,
  share,
  max,
}) => {
  const width = max > 0 ? Math.min(100, (amount / max) * 100) : 0;
  return (
    <li className="ledger-line flex items-center gap-3 py-3 text-[15px]">
      <span className="w-28 shrink-0 truncate sm:w-44">{name}</span>
      <span className="h-1.5 flex-1 rounded-sm bg-muted" aria-hidden>
        <span className="block h-1.5 rounded-sm bg-sage" style={{ width: `${width}%` }} />
      </span>
      <span className="w-20 shrink-0 text-right font-medium tabular-nums">{money(amount)}</span>
      <span className="w-10 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
        {shareLabel(share)}
      </span>
    </li>
  );
};

const CHANGED_UP = 'text-ink';
const CHANGED_DOWN = 'text-sage-ink';

/** "Groceries is up $82 (24%) on last month." The share is a dash when last month had nothing to compare. */
const changeSentence = (insight: Insight) => {
  const change = safe(insight.change);
  const amount = moneyWhole(Math.abs(change));
  const percent = Number.isFinite(insight.percentChange)
    ? `${Math.abs(Math.round(insight.percentChange))}%`
    : '—';
  return `${insight.category} is ${change > 0 ? 'up' : 'down'} ${amount} (${percent}) on last month.`;
};

const InsightsPage: React.FC = () => {
  const [period, setPeriod] = useState<PeriodId>('3m');
  const months = PERIODS.find((item) => item.id === period)?.months ?? 3;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary>({ income: 0, expenses: 0 });
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [trends, setTrends] = useState<TrendRow[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [merchants, setMerchants] = useState<Merchant[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { dateFrom, dateTo } = rangeFor(months);

    try {
      const [list, byCategory] = await Promise.all([
        transactionAPI.getTransactions({ dateFrom, dateTo, limit: 1 }),
        transactionAPI.getSpendingByCategory({ dateFrom, dateTo }),
      ]);

      setSummary({
        income: safe(list?.summary?.income),
        expenses: safe(list?.summary?.expenses),
      });
      setCategories(Array.isArray(byCategory) ? byCategory : []);

      // The panels below the figures are context: one failing panel leaves the rest of the page.
      const [trendRows, insightRows, merchantRows] = await Promise.all([
        transactionAPI.getMonthlyTrends(months).catch(() => []),
        analyticsAPI.getInsights().catch(() => ({ insights: [] })),
        analyticsAPI.getMerchants(10).catch(() => ({ merchants: [] })),
      ]);

      setTrends(Array.isArray(trendRows) ? trendRows : []);
      setInsights(Array.isArray(insightRows?.insights) ? insightRows.insights : []);
      setMerchants(Array.isArray(merchantRows?.merchants) ? merchantRows.merchants : []);
    } catch (err: any) {
      setError(
        err?.response?.data?.error ||
          'Could not load the report. Check that the server is running, then try again.'
      );
    } finally {
      setLoading(false);
    }
  }, [months]);

  useEffect(() => {
    load();
  }, [load]);

  const net = summary.income - summary.expenses;
  const saved = Math.max(0, net);
  const nothingRecorded = summary.income === 0 && summary.expenses === 0;

  const savingsLine = (() => {
    if (summary.income <= 0) return '—';
    const rate = (net / summary.income) * 100;
    if (!Number.isFinite(rate)) return '—';
    return rate >= 0
      ? `You kept ${Math.round(rate)}% of your income.`
      : `Spending was ${Math.round(Math.abs(rate))}% more than income.`;
  })();

  /**
   * The ranked spending ledger: top eight categories, everything else in "Other",
   * plus whatever the totals counted but no category holds. Shares are of spending.
   */
  const ledger = useMemo(() => {
    const ranked = categories
      .filter((row) => safe(row.amount) > 0)
      .map((row) => ({ name: row.category || 'Other', amount: safe(row.amount) }))
      .sort((a, b) => b.amount - a.amount);

    const rows = ranked.slice(0, 8).map((row) => ({ ...row }));
    const tail = ranked.slice(8).reduce((sum, row) => sum + row.amount, 0);
    const other = rows.find((row) => row.name === 'Other');
    if (other) other.amount += tail;
    else if (tail > 0) rows.push({ name: 'Other', amount: tail });

    const categorized = ranked.reduce((sum, row) => sum + row.amount, 0);
    const uncategorized = Math.round((summary.expenses - categorized) * 100) / 100;
    if (uncategorized > 0.01) rows.push({ name: 'Not categorized', amount: uncategorized });

    const max = rows.reduce((largest, row) => Math.max(largest, row.amount), 0);
    const total = summary.expenses > 0 ? summary.expenses : rows.reduce((sum, row) => sum + row.amount, 0);
    // A period with no spending has no shares: the row shows a dash rather than a division.
    return rows.map((row) => ({
      ...row,
      max,
      share: total > 0 ? (row.amount / total) * 100 : null,
    }));
  }, [categories, summary.expenses]);

  const chartData = useMemo(
    () =>
      monthsInRange(months).map((month) => {
        const row = trends.find((item) => item.month === month.label);
        return {
          month: month.short,
          income: Math.max(0, safe(row?.income)),
          spending: Math.max(0, safe(row?.expenses)),
        };
      }),
    [trends, months]
  );

  const chartTop = useMemo(
    () => scaleTop(chartData.reduce((max, row) => Math.max(max, row.income, row.spending), 0)),
    [chartData]
  );

  const changes = useMemo(
    () =>
      insights
        .filter((insight) => Number.isFinite(insight.change) && Math.abs(insight.change) >= 0.01)
        .slice()
        .sort((a, b) => Math.abs(b.change) - Math.abs(a.change)),
    [insights]
  );

  const flows = useMemo(
    () => ledger.map((row) => ({ category: row.name, amount: row.amount })),
    [ledger]
  );

  return (
    <SidebarLayout title="Reports">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <p className="text-sm text-muted-foreground">{rangeLabel(months)}</p>
        <div role="group" aria-label="Period" className="inline-flex rounded-md border border-rule bg-card p-0.5">
          {PERIODS.map((item) => (
            <Button
              key={item.id}
              variant="ghost"
              size="sm"
              aria-pressed={period === item.id}
              onClick={() => setPeriod(item.id)}
              className={cn(
                'h-7 rounded-sm px-3 text-xs font-medium',
                period === item.id && 'bg-muted text-ink'
              )}
            >
              {item.label}
            </Button>
          ))}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-md bg-terra-tint px-4 py-3 text-sm text-terra"
        >
          {error}
          <Button variant="outline" size="sm" onClick={load}>
            Try again
          </Button>
        </div>
      )}

      {!error && (
        <>
          <section className="sheet p-6 md:p-8">
            {loading ? (
              <Skeleton className="h-20" />
            ) : (
              <>
                <div className="grid grid-cols-3 gap-5" data-testid="figures">
                  <Figure label="Income" value={moneyWhole(summary.income)} />
                  <Figure label="Spending" value={moneyWhole(summary.expenses)} />
                  <Figure
                    label="Net"
                    value={net >= 0 ? moneyWhole(net) : `−${moneyWhole(-net)}`}
                    tone={net > 0 ? 'sage' : undefined}
                  />
                </div>
                <p className="mt-4 text-sm text-muted-foreground">{savingsLine}</p>
                {nothingRecorded && (
                  <p className="mt-3 text-[15px]">
                    No transactions in this period. Try a longer period.
                  </p>
                )}
              </>
            )}
          </section>

          <div className="mt-6 space-y-6">
            <Section title="Where the money went" hint="Share of all spending">
              {loading ? (
                <Skeleton className="h-56" />
              ) : ledger.length === 0 ? (
                <p className="text-[15px] text-muted-foreground">
                  No spending recorded in this period.
                </p>
              ) : (
                <>
                  <ul data-testid="category-ledger">
                    {ledger.map((row) => (
                      <LedgerRow
                        key={row.name}
                        name={row.name}
                        amount={row.amount}
                        share={row.share}
                        max={row.max}
                      />
                    ))}
                  </ul>
                  <p className="mt-4 text-sm text-muted-foreground">
                    Bars are scaled to the largest category; each percent is of all spending.
                  </p>
                </>
              )}
            </Section>

            <Section title="Month by month" hint="Every month on one scale">
              {loading ? (
                <Skeleton className="h-56" />
              ) : chartData.every((row) => row.income === 0 && row.spending === 0) ? (
                <p className="text-[15px] text-muted-foreground">No months with activity in this period.</p>
              ) : (
                <>
                  <div className="h-64 w-full" data-testid="month-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2}>
                        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                        <XAxis
                          dataKey="month"
                          tickLine={false}
                          axisLine={{ stroke: 'var(--border)' }}
                          tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
                        />
                        <YAxis
                          domain={[0, chartTop]}
                          allowDecimals={false}
                          tickLine={false}
                          axisLine={false}
                          width={52}
                          tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
                          tickFormatter={(value) => compact(Number(value))}
                        />
                        <Tooltip
                          cursor={{ fill: 'var(--muted)' }}
                          formatter={(value) => money(Number(value))}
                          labelStyle={{ color: 'var(--foreground)' }}
                          contentStyle={{
                            background: 'var(--card)',
                            border: '1px solid var(--border)',
                            borderRadius: 8,
                            fontSize: 12,
                          }}
                        />
                        <Bar dataKey="income" name="Income" fill="var(--sage)" radius={[3, 3, 0, 0]} />
                        <Bar
                          dataKey="spending"
                          name="Spending"
                          fill="var(--foreground)"
                          fillOpacity={0.75}
                          radius={[3, 3, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-3 flex items-center gap-5 text-sm text-muted-foreground">
                    <span className="flex items-center gap-2">
                      <span className="size-2.5 rounded-sm bg-sage" aria-hidden />
                      Income
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="size-2.5 rounded-sm bg-ink/75" aria-hidden />
                      Spending
                    </span>
                  </div>
                </>
              )}
            </Section>

            <Section title="Cash flow" hint="Where income goes in this period">
              {loading ? (
                <Skeleton className="h-64" />
              ) : (
                <>
                  <CustomSankeyFlow
                    income={net < 0 ? summary.expenses : summary.income}
                    savings={saved}
                    flows={flows}
                    formatCurrency={money}
                    sourceLabel={net < 0 ? 'Spending' : 'Income'}
                  />
                  {net < 0 && (
                    <p className="mt-3 text-[15px]">
                      Spending was {moneyWhole(-net)} more than income in this period.
                    </p>
                  )}
                </>
              )}
            </Section>

            <Section title="Changes this month" hint="Against the same days last month">
              {loading ? (
                <Skeleton className="h-24" />
              ) : changes.length === 0 ? (
                <p className="text-[15px] text-muted-foreground">No category moved much from last month.</p>
              ) : (
                <ul>
                  {changes.map((insight) => (
                    <li
                      key={insight.category}
                      className={cn(
                        'ledger-line py-2.5 text-[15px]',
                        insight.change > 0 ? CHANGED_UP : CHANGED_DOWN
                      )}
                    >
                      {changeSentence(insight)}
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Top merchants" hint="All time">
              {loading ? (
                <Skeleton className="h-40" />
              ) : merchants.length === 0 ? (
                <p className="text-[15px] text-muted-foreground">No merchant spending recorded yet.</p>
              ) : (
                <ul>
                  {merchants.slice(0, 10).map((merchant) => (
                    <li
                      key={merchant.name}
                      className="ledger-line flex items-baseline gap-3 py-2.5 text-[15px]"
                    >
                      <span className="min-w-0 flex-1 truncate">{merchant.name}</span>
                      <span className="shrink-0 text-sm text-muted-foreground">
                        {safe(merchant.transactionCount)}{' '}
                        {safe(merchant.transactionCount) === 1 ? 'purchase' : 'purchases'}
                      </span>
                      <span className="w-24 shrink-0 text-right font-medium tabular-nums">
                        {money(safe(merchant.totalSpent))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        </>
      )}
    </SidebarLayout>
  );
};

export default InsightsPage;
