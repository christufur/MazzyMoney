import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, CircleCheck, Search } from 'lucide-react';
import SidebarLayout from '../components/layout/SidebarLayout';
import { accountAPI, categoryAPI, transactionAPI } from '../services/api';
import type { TransactionListParams } from '../services/api';
import { TransactionNotes } from '../components/transactions/TransactionNotes';
import { SmartCategorySelector } from '../components/transactions/SmartCategorySelector';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { money } from '@/lib/money';

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

const toDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** Ledger dates read "Nov 2"; a row from another year carries its year so it cannot be misread. */
const shortDay = (value: string) => {
  const date = toDate(value);
  if (!date) return '—';
  const sameYear = date.getUTCFullYear() === new Date().getUTCFullYear();
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
};

const dayMonth = (value: string) => {
  const date = toDate(value);
  if (!date) return '—';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
};

const displayNameOf = (row: TransactionRow) => row.merchantDisplay ?? row.merchantName ?? row.name;

const accountLabel = (account: TransactionRow['account']) =>
  account ? `${account.name}${account.mask ? ` ••${account.mask}` : ''}` : '';

/** Row money: the API stores money out as a positive amount, so out is a true minus. */
const signedAmount = (amount: number) => {
  if (amount === 0) return money(0);
  return amount > 0 ? `−${money(amount)}` : `+${money(-amount)}`;
};

/** Net money: positive means more came in than went out. */
const signedNet = (amount: number) => {
  if (amount === 0) return money(0);
  return amount > 0 ? `+${money(amount)}` : `−${money(-amount)}`;
};

/** A figure that is always written with a sign, except when there is nothing to sign. */
const withSign = (amount: number, sign: '+' | '−') =>
  amount === 0 ? money(0) : `${sign}${money(Math.abs(amount))}`;

const Figure: React.FC<{ label: string; value: string; tone?: 'sage' }> = ({ label, value, tone }) => (
  <div className="min-w-0 border-b border-rule pb-3">
    <div className="truncate text-sm text-muted-foreground">{label}</div>
    {/* Three figures share one phone row, so the type steps down to keep long amounts inside the column. */}
    <div
      className={cn(
        'mt-1 whitespace-nowrap text-base font-semibold tabular-nums sm:text-lg md:text-figure',
        tone === 'sage' && 'text-sage-ink'
      )}
    >
      {value}
    </div>
  </div>
);

const tabTriggerClass =
  'flex-none -mb-px h-9 rounded-none border-b-2 border-transparent px-0 text-sm font-normal text-muted-foreground after:hidden hover:text-ink data-[state=active]:border-sage data-[state=active]:bg-transparent data-[state=active]:font-semibold data-[state=active]:text-ink data-[state=active]:shadow-none';

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
        setError(
          err.response?.data?.error ||
            'Could not load these transactions. Check that the server is running, then try again.'
        );
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
      setActionError(err.response?.data?.error || `Could not ${message}. Try again.`);
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
      setActionError(
        err.response?.data?.error || 'Could not mark these transactions as reviewed. Try again.'
      );
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
      setActionError(err.response?.data?.error || 'Could not update the review status. Try again.');
    }
  };

  const setNotes = (id: string, notes: string) => {
    setRows(previous => previous.map(row => (row.id === id ? { ...row, notes } : row)));
  };

  /** Guide words: the span of dates on screen, then where the reader is in the ledger. */
  const guideWords = useMemo(() => {
    const days = rows
      .map(row => row.date)
      .filter(value => !Number.isNaN(new Date(value).getTime()))
      .sort();
    if (days.length === 0) return null;

    const oldest = dayMonth(days[0]);
    const newest = dayMonth(days[days.length - 1]);
    const span = oldest === newest ? oldest : `${newest} – ${oldest}`;
    return pagination.totalPages > 0
      ? `${span} · page ${pagination.currentPage} of ${pagination.totalPages}`
      : span;
  }, [rows, pagination]);

  const ledger = (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap md:items-center">
        <div className="relative col-span-2 md:w-64">
          <Search
            aria-hidden
            strokeWidth={1.75}
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label="Search transactions"
            value={searchInput}
            onChange={event => setSearchInput(event.target.value)}
            placeholder="Search name, merchant, or notes"
            className="h-8 w-full pl-8"
          />
        </div>

        <Select value={category} onValueChange={value => applyFilter(() => setCategory(value))}>
          <SelectTrigger size="sm" aria-label="Category" className="w-full md:w-44">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map(name => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={accountId} onValueChange={value => applyFilter(() => setAccountId(value))}>
          <SelectTrigger size="sm" aria-label="Account" className="w-full md:w-48">
            <SelectValue placeholder="All accounts" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All accounts</SelectItem>
            {accounts.map(account => (
              <SelectItem key={account.id} value={account.id}>
                {account.name}
                {account.mask ? ` ••${account.mask}` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={dateRange}
          onValueChange={value => applyFilter(() => setDateRange(value as DateRange))}
        >
          <SelectTrigger size="sm" aria-label="Date range" className="w-full md:w-40">
            <SelectValue placeholder="Last 90 days" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
            <SelectItem value="365">Last 365 days</SelectItem>
            <SelectItem value="all">All time</SelectItem>
          </SelectContent>
        </Select>

        <Select value={type} onValueChange={value => applyFilter(() => setType(value as TypeFilter))}>
          <SelectTrigger size="sm" aria-label="Type" className="w-full md:w-36">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="income">Income</SelectItem>
            <SelectItem value="expense">Expense</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {guideWords && <p className="text-xs text-muted-foreground">{guideWords}</p>}

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

      <div className="sheet">
        {selectedIds.length > 0 && (
          <div className="sticky top-14 z-10 flex flex-wrap items-center gap-2 rounded-t-lg border-b border-rule bg-card px-4 py-2.5">
            <span className="text-sm font-medium text-ink">{selectedIds.length} selected</span>

            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Select
                value=""
                disabled={busy}
                onValueChange={value => {
                  if (value) runBulk({ category: value }, 'set the category');
                }}
              >
                <SelectTrigger
                  size="sm"
                  aria-label="Set category for selected transactions"
                  className="w-40"
                >
                  <SelectValue placeholder="Set category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map(name => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => runBulk({ reviewed: true }, 'mark these transactions reviewed')}
              >
                Mark reviewed
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => runBulk({ hidden: true }, 'hide these transactions')}
              >
                Hide
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => runBulk({ isTransfer: true }, 'mark these transactions as transfers')}
              >
                Mark as transfer
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => runBulk({ isTransfer: false }, 'mark these transactions as not transfers')}
              >
                Not a transfer
              </Button>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => setSelected(new Set())}>
                Clear
              </Button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-4 py-3">
          <div className="flex items-center gap-3">
            <Checkbox
              aria-label="Select all on this page"
              checked={allOnPageSelected}
              onCheckedChange={toggleAllOnPage}
              disabled={rows.length === 0}
            />
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-ink">{pagination.totalCount}</span>{' '}
              transaction{pagination.totalCount === 1 ? '' : 's'}
            </p>
          </div>

          {tab === 'review' && rows.length > 0 && (
            <Button variant="outline" size="sm" onClick={markAllOnPageReviewed} disabled={busy}>
              Mark all on this page reviewed
            </Button>
          )}
        </div>

        <div
          aria-hidden
          className="hidden items-center gap-4 border-b border-rule px-4 py-2 md:grid md:grid-cols-[auto_3.25rem_minmax(0,1fr)_8.5rem_10rem_6.5rem_2.25rem]"
        >
          <span className="size-4" />
          <span className="section-label">Date</span>
          <span className="section-label">Description</span>
          <span className="section-label">Account</span>
          <span className="section-label">Category</span>
          <span className="section-label text-right">Amount</span>
          <span />
        </div>

        {loading ? (
          <div aria-busy="true" aria-label="Loading transactions">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className="ledger-line grid grid-cols-[minmax(0,1fr)_5rem] items-center gap-4 px-4 py-4"
              >
                <div className="space-y-2">
                  <Skeleton className="h-4 w-2/5 max-w-56" />
                  <Skeleton className="h-3 w-1/4 max-w-32" />
                </div>
                <Skeleton className="h-4 w-16 justify-self-end" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div
            role="alert"
            className="m-4 flex flex-wrap items-center justify-between gap-3 rounded-md bg-terra-tint px-4 py-3 text-sm text-terra"
          >
            <span>{error}</span>
            <Button variant="outline" size="sm" onClick={reload}>
              Try again
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <p className="px-4 py-12 text-center text-[15px] text-muted-foreground">
            No transactions match these filters.
          </p>
        ) : (
          <div role="list" aria-label="Transactions">
            {rows.map(row => {
              const displayName = displayNameOf(row);
              const moneyOut = row.amount > 0;
              const rawName = row.name !== displayName ? row.name : null;

              return (
                <div
                  key={row.id}
                  role="listitem"
                  className={cn(
                    'group/row ledger-line grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3 transition-colors md:grid-cols-[auto_3.25rem_minmax(0,1fr)_8.5rem_10rem_6.5rem_2.25rem] md:gap-x-4 md:gap-y-0',
                    selected.has(row.id) ? 'bg-paper' : 'hover:bg-paper'
                  )}
                >
                  <Checkbox
                    aria-label={`Select ${displayName}`}
                    checked={selected.has(row.id)}
                    onCheckedChange={() => toggleRow(row.id)}
                    className="md:col-start-1 md:row-start-1"
                  />

                  <div className="min-w-0 md:col-start-3 md:row-start-1">
                    <p className="flex min-w-0 items-center gap-2 text-[15px] text-ink">
                      {!row.reviewed && (
                        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-terra" />
                      )}
                      <span className="truncate">{displayName}</span>
                    </p>

                    {rawName && (
                      <p className="hidden truncate text-xs text-muted-foreground md:block">{rawName}</p>
                    )}

                    {(row.pending || row.isTransfer) && (
                      <p className="mt-1 flex flex-wrap items-center gap-1.5">
                        {row.pending && (
                          <Badge variant="outline" className="text-muted-foreground">
                            Pending
                          </Badge>
                        )}
                        {row.isTransfer && (
                          <Badge variant="outline" className="text-muted-foreground">
                            Transfer
                          </Badge>
                        )}
                      </p>
                    )}
                  </div>

                  <span
                    className={cn(
                      'self-start whitespace-nowrap text-right text-sm font-medium tabular-nums md:col-start-6 md:row-start-1 md:self-center',
                      moneyOut ? 'text-ink' : 'text-sage-ink'
                    )}
                  >
                    {signedAmount(row.amount)}
                  </span>

                  <div className="col-span-2 col-start-2 row-start-2 flex min-w-0 flex-nowrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground md:contents">
                    <span className="shrink-0 whitespace-nowrap md:col-start-2 md:row-start-1">
                      {shortDay(row.date)}
                    </span>

                    {row.account && (
                      <span className="flex min-w-0 items-center gap-2 md:col-start-4 md:row-start-1">
                        <span aria-hidden className="md:hidden">
                          ·
                        </span>
                        <span className="truncate">{accountLabel(row.account)}</span>
                      </span>
                    )}

                    <SmartCategorySelector
                      transactionId={row.id}
                      currentCategory={row.primaryCategory || 'Other'}
                      categories={categories}
                      compact
                      className="shrink-0 md:col-start-5 md:row-start-1 md:justify-self-start"
                      onUpdate={nextCategory => {
                        setRows(previous =>
                          previous.map(entry =>
                            entry.id === row.id ? { ...entry, primaryCategory: nextCategory } : entry
                          )
                        );
                      }}
                    />

                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={
                        row.reviewed
                          ? `Mark ${displayName} as not reviewed`
                          : `Mark ${displayName} as reviewed`
                      }
                      aria-pressed={row.reviewed}
                      title={row.reviewed ? 'Reviewed' : 'Mark reviewed'}
                      onClick={() => toggleReviewed(row)}
                      className={cn(
                        'ml-auto shrink-0 rounded-full md:col-start-7 md:row-start-1 md:ml-0 md:justify-self-end',
                        row.reviewed
                          ? 'text-sage-ink hover:bg-sage-tint hover:text-sage-ink'
                          : 'text-muted-foreground/60 hover:bg-muted hover:text-ink'
                      )}
                    >
                      {row.reviewed ? <CircleCheck /> : <Check />}
                    </Button>
                  </div>

                  <TransactionNotes
                    transactionId={row.id}
                    initialNotes={row.notes ?? ''}
                    compact
                    className="col-span-2 col-start-2 row-start-3 md:col-span-1 md:col-start-3 md:row-start-2"
                    onUpdate={notes => setNotes(row.id, notes)}
                  />
                </div>
              );
            })}
          </div>
        )}

        {!loading && !error && pagination.totalCount > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <span className="text-sm text-muted-foreground">
              Page {pagination.currentPage} of {pagination.totalPages}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!pagination.hasPrev || loading}
                onClick={() => {
                  setPage(current => Math.max(1, current - 1));
                  setSelected(new Set());
                }}
              >
                Prev
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!pagination.hasNext || loading}
                onClick={() => {
                  setPage(current => current + 1);
                  setSelected(new Set());
                }}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <SidebarLayout title="Transactions">
      <div className="grid grid-cols-3 gap-4 md:gap-6" role="group" aria-label="Summary">
        {loading && !summary ? (
          <>
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </>
        ) : (
          <>
            <Figure label="Income" value={withSign(summary?.income ?? 0, '+')} tone="sage" />
            <Figure label="Spending" value={withSign(summary?.expenses ?? 0, '−')} />
            <Figure
              label="Net"
              value={signedNet(summary?.netAmount ?? 0)}
              tone={(summary?.netAmount ?? 0) > 0 ? 'sage' : undefined}
            />
          </>
        )}
      </div>

      <Tabs
        value={tab}
        onValueChange={value => applyFilter(() => setTab(value as Tab))}
        className="mt-8"
      >
        <TabsList
          variant="line"
          aria-label="Transaction views"
          className="w-full justify-start gap-6 rounded-none border-b border-rule p-0"
        >
          <TabsTrigger value="all" className={tabTriggerClass}>
            All
          </TabsTrigger>
          <TabsTrigger value="review" className={tabTriggerClass}>
            Needs review ({reviewCount})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-4 outline-none">
          {tab === 'all' && ledger}
        </TabsContent>
        <TabsContent value="review" className="mt-4 outline-none">
          {tab === 'review' && ledger}
        </TabsContent>
      </Tabs>
    </SidebarLayout>
  );
};

export default TransactionsPage;
