import React, { useCallback, useEffect, useMemo, useState } from 'react';
import SidebarLayout from '../components/layout/SidebarLayout';
import { recurringAPI } from '../services/api';
import type { RecurringResponse, RecurringSeries, RecurringStatus } from '../services/api';

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

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);

/** Dates are UTC midnight in the API, so read them in UTC to avoid a day's drift. */
const formatDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
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
      setError(err.response?.data?.error || 'Failed to load recurring charges.');
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
      setError(err.response?.data?.error || 'Failed to refresh recurring charges.');
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

      // Update in place so the totals and the next-30-days list stay in step with the table.
      setData((current) => {
        if (!current) return current;
        const updated = current.series.map((item) =>
          item.id === response.series.id ? response.series : item
        );
        return buildPayload(updated);
      });
    } catch (err: any) {
      console.error('Error updating recurring charge:', err);
      setError(err.response?.data?.error || 'Failed to update this recurring charge.');
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

  if (loading) {
    return (
      <SidebarLayout title="Recurring">
        <div className="flex justify-center items-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <span className="ml-3">Loading recurring charges...</span>
        </div>
      </SidebarLayout>
    );
  }

  const renderTable = (rows: RecurringSeries[], ignored: boolean) => (
    <div className="overflow-x-auto">
      <table className={`min-w-full divide-y divide-gray-200 ${ignored ? 'text-gray-400' : ''}`}>
        <thead>
          <tr className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
            <th className="px-4 py-3">Name</th>
            <th className="px-4 py-3">Frequency</th>
            <th className="px-4 py-3 text-right">Amount</th>
            <th className="px-4 py-3 text-right">Per month</th>
            <th className="px-4 py-3">Next date</th>
            <th className="px-4 py-3 text-right">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row) => (
            <tr key={row.id} className={ignored ? 'opacity-60' : ''}>
              <td className={`px-4 py-3 text-sm font-medium ${ignored ? 'text-gray-500' : 'text-gray-900'}`}>
                {row.displayName}
              </td>
              <td className="px-4 py-3 text-sm">{frequencyLabel(row.intervalDays)}</td>
              <td className="px-4 py-3 text-sm text-right">{formatCurrency(row.averageAmount)}</td>
              <td className="px-4 py-3 text-sm text-right">{formatCurrency(row.monthlyEquivalent)}</td>
              <td className="px-4 py-3 text-sm">{formatDate(row.nextDate)}</td>
              <td className="px-4 py-3 text-sm text-right">
                <button
                  onClick={() => handleToggle(row)}
                  disabled={savingId === row.id}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors disabled:opacity-50 ${
                    ignored
                      ? 'text-blue-600 hover:text-blue-800'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {savingId === row.id ? 'Saving...' : ignored ? 'Restore' : 'Ignore'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <SidebarLayout title="Recurring">
      <div className="space-y-6">
        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-sm">
            <div className="flex justify-between items-center">
              <span>{error}</span>
              <button onClick={load} className="ml-4 text-red-600 hover:text-red-800 underline">
                Try Again
              </button>
            </div>
          </div>
        )}

        {/* Monthly total */}
        <div className="bg-linear-to-r from-purple-600 to-blue-600 rounded-xl shadow-lg text-white p-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <p className="text-purple-100 text-sm">Recurring charges</p>
              <h2 className="text-3xl font-bold mt-1">
                ≈ {formatCurrency(monthlyTotal)} / month in recurring charges
              </h2>
              <p className="text-purple-100 text-sm mt-2">{activeSeries.length} active series</p>
            </div>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="inline-flex items-center justify-center px-4 py-2 bg-white/20 hover:bg-white/30 disabled:opacity-60 text-white rounded-lg font-medium transition-colors"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h5M20 20v-5h-5M5.5 9a7 7 0 0111.9-2.6L20 9M4 15l2.6 2.6A7 7 0 0018.5 15" />
              </svg>
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>

        {/* Next 30 days */}
        <div className="bg-white rounded-xl shadow-xs border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900">Next 30 days</h3>
            <p className="text-sm text-gray-500 mt-1">Bills the detector expects to see soon.</p>
          </div>
          {upcoming.length === 0 ? (
            <div className="px-6 py-8 text-center text-gray-500">
              No bills expected in the next 30 days.
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {upcoming.map((row) => (
                <li key={row.id} className="px-6 py-3 flex items-center justify-between">
                  <div className="flex items-center space-x-4 min-w-0">
                    <span className="text-sm text-gray-500 w-24 shrink-0">{formatDate(row.nextDate)}</span>
                    <span className="text-sm font-medium text-gray-900 truncate">{row.displayName}</span>
                  </div>
                  <span className="text-sm text-gray-700">{formatCurrency(row.averageAmount)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* All recurring */}
        <div className="bg-white rounded-xl shadow-xs border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900">All recurring</h3>
            <p className="text-sm text-gray-500 mt-1">
              Detected from your transactions. Ignore one to keep it out of the monthly total.
            </p>
          </div>

          {(data?.series.length ?? 0) === 0 ? (
            <div className="px-6 py-12 text-center">
              <div className="w-16 h-16 mx-auto mb-4 bg-linear-to-br from-purple-100 to-blue-100 rounded-xl flex items-center justify-center">
                <svg className="w-8 h-8 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h5M20 20v-5h-5M5.5 9a7 7 0 0111.9-2.6L20 9M4 15l2.6 2.6A7 7 0 0018.5 15" />
                </svg>
              </div>
              <p className="text-gray-600">
                No recurring charges found yet. They appear after a few months of transactions.
              </p>
            </div>
          ) : (
            <>
              {activeSeries.length > 0 && renderTable(activeSeries, false)}

              {ignoredSeries.length > 0 && (
                <div className="border-t border-gray-200">
                  <p className="px-6 pt-4 pb-2 text-sm font-medium text-gray-500">
                    Ignored ({ignoredSeries.length})
                  </p>
                  {renderTable(ignoredSeries, true)}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </SidebarLayout>
  );
};

export default RecurringPage;
