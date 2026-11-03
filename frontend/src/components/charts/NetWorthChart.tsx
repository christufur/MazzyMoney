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

/**
 * Net worth over time (W4.5). The server already counts credit cards and loans
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

const formatMoney = (amount: number) =>
  amount.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

/** Signed change: "+$120.00" / "−$120.00" with a real minus sign. */
const formatSignedMoney = (amount: number) => {
  const sign = amount < 0 ? MINUS : '+';
  return `${sign}${formatMoney(Math.abs(amount))}`;
};

const formatPercent = (percent: number) =>
  `${percent < 0 ? MINUS : '+'}${Math.abs(percent).toFixed(1)}%`;

const formatSignedPercent = (percent: number | null) =>
  percent === null ? null : formatPercent(percent);

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

/** Tooltip with the net worth plus what is behind it: assets and liabilities. */
const ChartTooltip: React.FC<ChartTooltipProps> = ({ active, label, payload }) => {
  if (!active || !payload?.length) return null;

  const point = payload[0]?.payload;
  if (!point) return null;

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm px-3 py-2 text-sm">
      <p className="font-medium text-gray-900 mb-1">{formatLongDate(String(label))}</p>
      <p className="text-gray-900">Net worth: {formatMoney(point.netWorth ?? 0)}</p>
      <p className="text-gray-600">Assets: {formatMoney(point.assets ?? 0)}</p>
      <p className="text-gray-600">Liabilities: {formatMoney(point.liabilities ?? 0)}</p>
    </div>
  );
};

/** One line in the Assets or Liabilities column. Liabilities read as negative. */
const AccountBalanceRow: React.FC<{ account: NetWorthAccount }> = ({ account }) => {
  const amount = account.isLiability ? -Math.abs(account.balance) : account.balance;

  return (
    <li className="flex items-center justify-between py-2">
      <span className="text-sm text-gray-700 truncate pr-3" title={account.name}>
        {account.name}
        {account.isManual && <span className="text-xs text-gray-400"> · manual</span>}
      </span>
      <span className={`text-sm font-medium ${account.isLiability ? 'text-red-600' : 'text-gray-900'}`}>
        {formatMoney(amount)}
      </span>
    </li>
  );
};

const NetWorthChart: React.FC = () => {
  const [range, setRange] = useState<NetWorthRange>(DEFAULT_RANGE);
  const [data, setData] = useState<NetWorthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Bumping this re-runs the fetch for the same range (the Retry button).
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
  const changePercent = data?.change.percent ?? null;
  const changePositive = changeAmount >= 0;
  const changeClasses = changePositive ? 'text-green-600' : 'text-red-600';
  const percentLabel = formatSignedPercent(changePercent);

  return (
    <section
      className="bg-white rounded-xl shadow-sm border border-gray-200 p-6"
      aria-label="Net worth"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide">Net worth</h2>
          <p className="text-3xl md:text-4xl font-bold text-gray-900 mt-2" data-testid="net-worth-value">
            {loading && !data ? '--' : formatMoney(netWorth)}
          </p>
          {data && (
            <p className="text-sm mt-1">
              <span className={`font-medium ${changeClasses}`} data-testid="net-worth-change">
                {formatSignedMoney(changeAmount)}
              </span>
              {percentLabel && <span className={`ml-2 font-medium ${changeClasses}`}>({percentLabel})</span>}
              <span className="text-gray-500 ml-2">in this range</span>
            </p>
          )}
        </div>

        <div className="flex items-center gap-1" role="group" aria-label="Net worth range">
          {RANGE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setRange(option.value)}
              aria-pressed={range === option.value}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                range === option.value
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mt-4 bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded-lg flex justify-between items-center">
          <span>{error}</span>
          <button type="button" onClick={retry} className="underline font-medium">
            Retry
          </button>
        </div>
      )}

      <div className="mt-6">
        {loading && !data ? (
          <p className="text-sm text-gray-500">Loading net worth history…</p>
        ) : points.length === 0 ? (
          <p className="text-sm text-gray-500">
            Net worth history starts after your first sync. Add manual accounts on the Connections
            page.
          </p>
        ) : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={points} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="netWorthFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563eb" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatShortDate}
                  tick={{ fontSize: 12, fill: '#6b7280' }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={24}
                />
                <YAxis
                  tickFormatter={formatAxisMoney}
                  tick={{ fontSize: 12, fill: '#6b7280' }}
                  tickLine={false}
                  axisLine={false}
                  width={64}
                />
                <Tooltip content={<ChartTooltip />} />
                <Area
                  type="monotone"
                  dataKey="netWorth"
                  name="Net worth"
                  stroke="#2563eb"
                  strokeWidth={2}
                  fill="url(#netWorthFill)"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {(assets.length > 0 || liabilities.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6 pt-6 border-t border-gray-200">
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">
              Assets
              <span className="ml-2 font-normal text-gray-500">
                {formatMoney(data?.current.assets ?? 0)}
              </span>
            </h3>
            {assets.length === 0 ? (
              <p className="text-sm text-gray-400">No asset accounts.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {assets.map((account) => (
                  <AccountBalanceRow key={account.id} account={account} />
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">
              Liabilities
              <span className="ml-2 font-normal text-gray-500">
                {formatMoney(data?.current.liabilities ?? 0)}
              </span>
            </h3>
            {liabilities.length === 0 ? (
              <p className="text-sm text-gray-400">No liabilities.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {liabilities.map((account) => (
                  <AccountBalanceRow key={account.id} account={account} />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
};

export default NetWorthChart;
