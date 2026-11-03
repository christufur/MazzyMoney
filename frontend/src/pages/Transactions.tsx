import React, { useCallback, useEffect, useMemo, useState } from 'react';
import SidebarLayout from '../components/layout/SidebarLayout';
import { accountAPI, categoryAPI, transactionAPI } from '../services/api';
import type { TransactionListParams } from '../services/api';
import { TransactionNotes } from '../components/transactions/TransactionNotes';
import { SmartCategorySelector } from '../components/transactions/SmartCategorySelector';

const PAGE_SIZE = 50;

interface TransactionRow {
  id: string;
  name: string;
  merchantName: string | null;
  merchantDisplay: string | null;
  amount: number;
  date: string;
  pending: boolean;
  isTransfer: boolean;
  hidden: boolean;
  reviewed: boolean;
  primaryCategory: string | null;
  categorySource: 'PLAID' | 'RULE' | 'USER';
  notes: string | null;
  account: {
    id: string;
    name: string;
    mask: string | null;
    type: string;
    subtype: string;
  } | null;
}

interface Pagination {
  currentPage: number;
  totalPages: number;
  totalCount: number;
  hasNext: boolean;
  hasPrev: boolean;
}

interface Summary {
  income: number;
  expenses: number;
  netAmount: number;
  totalTransactions: number;
}

type Tab = 'all' | 'review';
type DateRange = '30' | '90' | '365' | 'all';
type TypeFilter = 'all' | 'income' | 'expense';

const EMPTY_PAGINATION: Pagination = {
  currentPage: 1,
  totalPages: 0,
  totalCount: 0,
  hasNext: false,
  hasPrev: false,
};

/** "Today minus N days" as a plain date, in UTC so the browser's zone cannot shift it. */
const dateFromForRange = (range: DateRange): string | undefined => {
  if (range === 'all') return undefined;
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - Number(range));
  return cutoff.toISOString().slice(0, 10);
};

const formatMoney = (amount: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Math.abs(amount));

const formatDate = (date: string) =>
  new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });

const displayNameOf = (row: TransactionRow) =>
  row.merchantDisplay ?? row.merchantName ?? row.name;

const TransactionsPage: React.FC = () => {
  const [tab, setTab] = useState<Tab>('all');
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [accountId, setAccountId] = useState('all');
  const [dateRange, setDateRange] = useState<DateRange>('90');
  const [type, setType] = useState<TypeFilter>('all');

  const [rows, setRows] = useState<TransactionRow[]>([]);
  const [pagination, setPagination] = useState<Pagination>(EMPTY_PAGINATION);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const [reviewCount, setReviewCount] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [categories, setCategories] = useState<string[]>([]);
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string; mask: string | null }>>([]);

  const reload = useCallback(() => setRefreshKey(key => key + 1), []);

  /** Any filter change goes back to page one and drops a selection of rows you can no longer see. */
  const applyFilter = (apply: () => void) => {
    apply();
    setPage(1);
    setSelected(new Set());
  };

  // Search waits for a pause in typing so a fast typist does not fire a request per key.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
      setSelected(new Set());
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    let active = true;

    categoryAPI
      .getAll()
      .then(response => {
        if (active) setCategories(response.categories ?? []);
      })
      .catch(() => {
        // The selector keeps working with an empty filter list; rows still load.
      });

    accountAPI
      .getAccounts()
      .then(response => {
        if (!active) return;
        setAccounts(
          (response.accounts ?? []).map((account: any) => ({
            id: account.id,
            name: account.name,
            mask: account.mask ?? null,
          }))
        );
      })
      .catch(() => {
        // Account filtering is a convenience; a failure must not block the list.
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    transactionAPI
      .getReviewCount()
      .then(response => {
        if (active) setReviewCount(response.count ?? 0);
      })
      .catch(() => {
        if (active) setReviewCount(0);
      });

    return () => {
      active = false;
    };
  }, [refreshKey]);

  const params = useMemo<TransactionListParams>(() => {
    const next: TransactionListParams = { page, limit: PAGE_SIZE };

    if (tab === 'review') next.reviewed = false;
    if (search) next.search = search;
    if (category !== 'all') next.category = category;
    if (accountId !== 'all') next.accountId = accountId;
    if (type !== 'all') next.type = type;

    const dateFrom = dateFromForRange(dateRange);
    if (dateFrom) next.dateFrom = dateFrom;

    return next;
  }, [page, tab, search, category, accountId, type, dateRange]);

  useEffect(() => {
    let active = true;

    const fetchTransactions = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await transactionAPI.getTransactions(params);
        if (!active) return;
        setRows(response.transactions ?? []);
        setPagination(response.pagination ?? EMPTY_PAGINATION);
        setSummary(response.summary ?? null);
      } catch (err: any) {
        if (!active) return;
        setError(err.response?.data?.error || 'Failed to load transactions.');
        setRows([]);
      } finally {
        if (active) setLoading(false);
      }
    };

    fetchTransactions();

    return () => {
      active = false;
    };
  }, [params, refreshKey]);

  const selectedIds = useMemo(() => Array.from(selected), [selected]);

  const toggleRow = (id: string) => {
    setSelected(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allOnPageSelected = rows.length > 0 && rows.every(row => selected.has(row.id));

  const toggleAllOnPage = () => {
    setSelected(allOnPageSelected ? new Set() : new Set(rows.map(row => row.id)));
  };

  const runBulk = async (changes: Parameters<typeof transactionAPI.bulkUpdate>[1], message: string) => {
    if (selectedIds.length === 0) return;

    try {
      setBusy(true);
      setActionError(null);
      await transactionAPI.bulkUpdate(selectedIds, changes);
      setSelected(new Set());
      reload();
    } catch (err: any) {
      setActionError(err.response?.data?.error || `Failed to ${message}.`);
    } finally {
      setBusy(false);
    }
  };

  const markAllOnPageReviewed = async () => {
    if (rows.length === 0) return;

    try {
      setBusy(true);
      setActionError(null);
      await transactionAPI.bulkUpdate(rows.map(row => row.id), { reviewed: true });
      setSelected(new Set());
      reload();
    } catch (err: any) {
      setActionError(err.response?.data?.error || 'Failed to mark these transactions as reviewed.');
    } finally {
      setBusy(false);
    }
  };

  const toggleReviewed = async (row: TransactionRow) => {
    try {
      setActionError(null);
      await transactionAPI.update(row.id, { reviewed: !row.reviewed });
      reload();
    } catch (err: any) {
      setActionError(err.response?.data?.error || 'Failed to update the review status.');
    }
  };

  const setNotes = (id: string, notes: string) => {
    setRows(previous => previous.map(row => (row.id === id ? { ...row, notes } : row)));
  };

  const netPositive = (summary?.netAmount ?? 0) >= 0;

  return (
    <SidebarLayout title="Transactions">
      <div className="space-y-4">
        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-gray-200" role="tablist" aria-label="Transaction views">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'all'}
            onClick={() => applyFilter(() => setTab('all'))}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === 'all'
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            All
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'review'}
            onClick={() => applyFilter(() => setTab('review'))}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === 'review'
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            Needs review ({reviewCount})
          </button>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4" role="group" aria-label="Summary">
          <div className="bg-white rounded-xl shadow-xs border border-gray-200 p-5">
            <p className="text-sm font-medium text-gray-500">Income</p>
            <p className="text-2xl font-bold text-green-600">+{formatMoney(summary?.income ?? 0)}</p>
          </div>
          <div className="bg-white rounded-xl shadow-xs border border-gray-200 p-5">
            <p className="text-sm font-medium text-gray-500">Spending</p>
            <p className="text-2xl font-bold text-red-600">−{formatMoney(summary?.expenses ?? 0)}</p>
          </div>
          <div className="bg-white rounded-xl shadow-xs border border-gray-200 p-5">
            <p className="text-sm font-medium text-gray-500">Net</p>
            <p className={`text-2xl font-bold ${netPositive ? 'text-green-600' : 'text-red-600'}`}>
              {netPositive ? '+' : '−'}
              {formatMoney(summary?.netAmount ?? 0)}
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl shadow-xs border border-gray-200 p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="lg:col-span-2">
              <label htmlFor="transaction-search" className="sr-only">
                Search transactions
              </label>
              <input
                id="transaction-search"
                type="search"
                value={searchInput}
                onChange={event => setSearchInput(event.target.value)}
                placeholder="Search name, merchant, or notes..."
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div>
              <label htmlFor="filter-category" className="sr-only">
                Category
              </label>
              <select
                id="filter-category"
                value={category}
                onChange={event => applyFilter(() => setCategory(event.target.value))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All categories</option>
                {categories.map(name => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="filter-account" className="sr-only">
                Account
              </label>
              <select
                id="filter-account"
                value={accountId}
                onChange={event => applyFilter(() => setAccountId(event.target.value))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All accounts</option>
                {accounts.map(account => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                    {account.mask ? ` ••${account.mask}` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex gap-3">
              <div className="flex-1">
                <label htmlFor="filter-range" className="sr-only">
                  Date range
                </label>
                <select
                  id="filter-range"
                  value={dateRange}
                  onChange={event => applyFilter(() => setDateRange(event.target.value as DateRange))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                >
                  <option value="30">Last 30 days</option>
                  <option value="90">Last 90 days</option>
                  <option value="365">Last 365 days</option>
                  <option value="all">All time</option>
                </select>
              </div>

              <div className="flex-1">
                <label htmlFor="filter-type" className="sr-only">
                  Type
                </label>
                <select
                  id="filter-type"
                  value={type}
                  onChange={event => applyFilter(() => setType(event.target.value as TypeFilter))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                >
                  <option value="all">All types</option>
                  <option value="income">Income</option>
                  <option value="expense">Expense</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {actionError && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">
            {actionError}
          </div>
        )}

        {/* Bulk bar */}
        {selectedIds.length > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center gap-3">
            <span className="text-sm font-medium text-blue-900">
              {selectedIds.length} selected
            </span>

            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="bulk-category" className="sr-only">
                Set category for selected transactions
              </label>
              <select
                id="bulk-category"
                aria-label="Set category for selected transactions"
                value=""
                disabled={busy}
                onChange={event => {
                  const nextCategory = event.target.value;
                  if (!nextCategory) return;
                  runBulk({ category: nextCategory }, 'set the category');
                }}
                className="border border-blue-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Set category...</option>
                {categories.map(name => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>

              <button
                type="button"
                disabled={busy}
                onClick={() => runBulk({ reviewed: true }, 'mark these transactions reviewed')}
                className="px-3 py-1.5 rounded-lg text-sm font-medium bg-white border border-blue-300 text-blue-800 hover:bg-blue-100 disabled:opacity-50"
              >
                Mark reviewed
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => runBulk({ hidden: true }, 'hide these transactions')}
                className="px-3 py-1.5 rounded-lg text-sm font-medium bg-white border border-blue-300 text-blue-800 hover:bg-blue-100 disabled:opacity-50"
              >
                Hide
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => runBulk({ isTransfer: true }, 'mark these transactions as transfers')}
                className="px-3 py-1.5 rounded-lg text-sm font-medium bg-white border border-blue-300 text-blue-800 hover:bg-blue-100 disabled:opacity-50"
              >
                Mark as transfer
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => runBulk({ isTransfer: false }, 'mark these transactions as not transfers')}
                className="px-3 py-1.5 rounded-lg text-sm font-medium bg-white border border-blue-300 text-blue-800 hover:bg-blue-100 disabled:opacity-50"
              >
                Not a transfer
              </button>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="px-3 py-1.5 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100"
              >
                Clear
              </button>
            </div>
          </div>
        )}

        {/* List */}
        <div className="bg-white rounded-xl shadow-xs border border-gray-200">
          <div className="px-4 py-3 border-b border-gray-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                aria-label="Select all on this page"
                checked={allOnPageSelected}
                onChange={toggleAllOnPage}
                disabled={rows.length === 0}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded-sm focus:ring-blue-500"
              />
              <h2 className="text-sm font-semibold text-gray-700">
                {pagination.totalCount} transaction{pagination.totalCount === 1 ? '' : 's'}
              </h2>
            </div>

            {tab === 'review' && rows.length > 0 && (
              <button
                type="button"
                onClick={markAllOnPageReviewed}
                disabled={busy}
                className="text-sm font-medium text-blue-700 hover:text-blue-800 disabled:opacity-50"
              >
                Mark all on this page reviewed
              </button>
            )}
          </div>

          {/* Column labels: the rows stack on a narrow screen, so the header only shows when they line up. */}
          <div className="hidden md:grid md:grid-cols-[auto_minmax(0,1fr)_11rem_12rem_7rem_4rem] md:gap-4 md:items-center px-4 py-2 bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-500 uppercase tracking-wide">
            <span className="w-4" />
            <span>Description</span>
            <span>Account</span>
            <span>Category</span>
            <span className="text-right">Amount</span>
            <span className="text-right">Reviewed</span>
          </div>

          {loading ? (
            <div className="px-4 py-12 text-center text-gray-500">Loading transactions...</div>
          ) : error ? (
            <div className="px-4 py-12 text-center">
              <p className="text-red-600 mb-3">{error}</p>
              <button
                type="button"
                onClick={reload}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium"
              >
                Try again
              </button>
            </div>
          ) : rows.length === 0 ? (
            <div className="px-4 py-12 text-center text-gray-500">
              No transactions match these filters.
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {rows.map(row => {
                const displayName = displayNameOf(row);
                const moneyOut = row.amount > 0;

                return (
                  <div key={row.id} className={selected.has(row.id) ? 'bg-blue-50' : undefined}>
                    <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <input
                          type="checkbox"
                          aria-label={`Select ${displayName}`}
                          checked={selected.has(row.id)}
                          onChange={() => toggleRow(row.id)}
                          className="mt-1 w-4 h-4 text-blue-600 border-gray-300 rounded-sm focus:ring-blue-500"
                        />

                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{displayName}</p>
                          {row.name !== displayName && (
                            <p className="text-xs text-gray-400 truncate">{row.name}</p>
                          )}
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 text-xs text-gray-500">
                            <span>{formatDate(row.date)}</span>
                            {row.account && (
                              <>
                                <span className="text-gray-300">•</span>
                                <span>
                                  {row.account.name}
                                  {row.account.mask ? ` ••${row.account.mask}` : ''}
                                </span>
                              </>
                            )}
                            {row.pending && (
                              <span className="px-1.5 py-0.5 rounded-sm bg-amber-100 text-amber-800 font-medium">
                                Pending
                              </span>
                            )}
                            {row.isTransfer && (
                              <span className="px-1.5 py-0.5 rounded-sm bg-cyan-100 text-cyan-800 font-medium">
                                Transfer
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-3 pl-7 sm:pl-0 sm:justify-end">
                        <div className="sm:w-44">
                          <SmartCategorySelector
                            transactionId={row.id}
                            currentCategory={row.primaryCategory || 'Other'}
                            categories={categories}
                            compact
                            onUpdate={nextCategory => {
                              setRows(previous =>
                                previous.map(entry =>
                                  entry.id === row.id ? { ...entry, primaryCategory: nextCategory } : entry
                                )
                              );
                            }}
                          />
                        </div>

                        <span
                          className={`sm:w-28 text-right text-sm font-semibold tabular-nums ${
                            moneyOut ? 'text-red-600' : 'text-green-600'
                          }`}
                        >
                          {moneyOut ? '−' : '+'}
                          {formatMoney(row.amount)}
                        </span>

                        <button
                          type="button"
                          onClick={() => toggleReviewed(row)}
                          aria-label={
                            row.reviewed
                              ? `Mark ${displayName} as not reviewed`
                              : `Mark ${displayName} as reviewed`
                          }
                          aria-pressed={row.reviewed}
                          title={row.reviewed ? 'Reviewed' : 'Mark reviewed'}
                          className={`w-8 h-8 flex items-center justify-center rounded-full border transition-colors ${
                            row.reviewed
                              ? 'bg-green-100 border-green-300 text-green-700'
                              : 'bg-white border-gray-300 text-gray-300 hover:text-gray-500'
                          }`}
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        </button>
                      </div>
                    </div>

                    <div className="pl-11 pr-4 pb-3">
                      <TransactionNotes
                        transactionId={row.id}
                        initialNotes={row.notes ?? ''}
                        compact
                        onUpdate={notes => setNotes(row.id, notes)}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pager */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
            <span className="text-sm text-gray-500">
              Page {pagination.totalPages === 0 ? 0 : pagination.currentPage} of {pagination.totalPages}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={!pagination.hasPrev || loading}
                onClick={() => {
                  setPage(current => Math.max(1, current - 1));
                  setSelected(new Set());
                }}
                className="px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={!pagination.hasNext || loading}
                onClick={() => {
                  setPage(current => current + 1);
                  setSelected(new Set());
                }}
                className="px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </div>
    </SidebarLayout>
  );
};

export default TransactionsPage;
