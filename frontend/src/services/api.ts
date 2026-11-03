import axios from 'axios';

export interface BudgetAlert {
  id: string;
  thresholdPercent: number;
  alertType: 'SPENDING_THRESHOLD' | 'BUDGET_EXCEEDED' | 'BUDGET_APPROACHING';
  isEnabled: boolean;
  emailEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** One month of a budget's history, for the per-budget bar chart. */
export interface BudgetHistoryPoint {
  month: string;
  budgeted: number;
  spent: number;
}

/**
 * A budget is a category plus a monthly amount, active from its start month
 * onward. `amount` is what the user set; the month fields describe the month
 * that was requested.
 */
export interface Budget {
  id: string;
  name: string;
  category: string;
  amount: number;
  rollover: boolean;
  startDate: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  budgetAlerts?: BudgetAlert[];
  /** The requested month, `YYYY-MM`. */
  month: string;
  /** The monthly amount. */
  budgeted: number;
  spent: number;
  /** Unspent (or overspent, when negative) money carried in from last month. */
  rolloverIn: number;
  /** `budgeted + rolloverIn`. */
  available: number;
  remaining: number;
  percentUsed: number;
  history: BudgetHistoryPoint[];
}

export interface BudgetTotals {
  budgeted: number;
  spent: number;
  available: number;
  remaining: number;
}

export interface BudgetMonthResponse {
  month: string;
  budgets: Budget[];
  totals: BudgetTotals;
}

/** One category the last few months say is worth a budget. */
export interface BudgetSuggestion {
  category: string;
  /** Net spending averaged over the months read, in dollars. */
  average: number;
  /** `average` rounded up to the next $10, the amount to offer. */
  suggested: number;
  monthsWithSpending: number;
}

export interface BudgetSuggestionsResponse {
  /** The full calendar months read, oldest first, as `YYYY-MM`. */
  months: string[];
  suggestions: BudgetSuggestion[];
}

interface CreateBudgetRequest {
  name: string;
  category: string;
  amount: number;
  rollover?: boolean;
  /** `YYYY-MM`; defaults to the current month. */
  startMonth?: string;
}

interface UpdateBudgetRequest {
  name?: string;
  category?: string;
  amount?: number;
  rollover?: boolean;
}

interface BudgetAlertRequest {
  thresholdPercent: number;
  alertType: BudgetAlert['alertType'];
  emailEnabled?: boolean;
  isEnabled?: boolean;
}

const API_BASE_URL = import.meta.env.VITE_API_URL ?? '';

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Auth token management
export const setAuthToken = (token: string) => {
  localStorage.setItem('authToken', token);
  api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
};

export const removeAuthToken = () => {
  localStorage.removeItem('authToken');
  delete api.defaults.headers.common['Authorization'];
};

const savedToken = localStorage.getItem('authToken');
if (savedToken) {
  setAuthToken(savedToken);
}

// API methods
export const authAPI = {
  register: async (email: string, password: string, fullName: string, inviteCode?: string) => {
    const response = await api.post('/api/auth/register', {
      email, password, fullName, inviteCode
    });
    return response.data;
  },
  
  login: async (email: string, password: string) => {
    const response = await api.post('/api/auth/login', {
      email, password
    });
    return response.data;
  },

  getCurrentUser: async () => {
    const response = await api.get('/api/auth/me');
    return response.data;
  },
};

export interface PlaidAccountSummary {
  id: string;
  name: string;
  mask: string | null;
  type: string;
  subtype: string;
}

export type PlaidItemStatus = 'ACTIVE' | 'SYNCING' | 'LOGIN_REQUIRED' | 'ERROR';

export interface PlaidItem {
  id: string;
  institutionName: string;
  status: PlaidItemStatus;
  lastSyncAt: string | null;
  lastError: string | null;
  accounts: PlaidAccountSummary[];
}

export interface PlaidItemsResponse {
  items: PlaidItem[];
  used: number;
  limit: number;
}

export const plaidAPI = {
  /**
   * Link token for a new Item, or update mode when `itemId` is given
   * (a re-login must never use another of the free Items).
   */
  createLinkToken: async (itemId?: string) => {
    const response = await api.post('/api/plaid/link-token', itemId ? { itemId } : {});
    return response.data as { link_token: string };
  },

  exchangePublicToken: async (publicToken: string) => {
    const response = await api.post('/api/plaid/exchange', {
      public_token: publicToken
    });
    return response.data as { item: Pick<PlaidItem, 'id' | 'institutionName' | 'status'> };
  },

  getItems: async () => {
    const response = await api.get('/api/plaid/items');
    return response.data as PlaidItemsResponse;
  },

  removeItem: async (id: string) => {
    const response = await api.delete(`/api/plaid/items/${id}`);
    return response.data as { success: true };
  },
};

// New cached transaction API
export type TransactionTypeFilter = 'income' | 'expense' | 'all';

export interface TransactionListParams {
  page?: number;
  limit?: number;
  category?: string;
  accountId?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  amountMin?: number;
  amountMax?: number;
  type?: TransactionTypeFilter;
  /** true = already reviewed, false = the review queue. */
  reviewed?: boolean;
  /** Hidden rows are left out of the list unless this is true. */
  includeHidden?: boolean;
  /** Transfers are in the list by default. */
  transfers?: 'exclude' | 'only';
}

export interface TransactionChanges {
  reviewed?: boolean;
  hidden?: boolean;
  isTransfer?: boolean;
}

export interface TransactionBulkChanges extends TransactionChanges {
  category?: string;
}

export const transactionAPI = {
  /**
   * Get cached transactions with filtering and pagination
   */
  getTransactions: async (params?: TransactionListParams) => {
    const response = await api.get('/api/transactions', { params });
    return response.data;
  },

  /**
   * Get spending by category
   */
  getSpendingByCategory: async (params?: {
    dateFrom?: string;
    dateTo?: string;
  }) => {
    const response = await api.get('/api/transactions/categories', { params });
    return response.data;
  },

  /**
   * Get monthly trends
   */
  getMonthlyTrends: async (months?: number) => {
    const response = await api.get('/api/transactions/monthly-trends', {
      params: { months }
    });
    return response.data;
  },

  /**
   * Trigger manual sync
   */
  syncTransactions: async (force: boolean = false) => {
    const response = await api.post('/api/transactions/sync', { force });
    return response.data;
  },

  /**
   * Get sync status
   */
  getSyncStatus: async () => {
    const response = await api.get('/api/transactions/sync-status');
    return response.data;
  },

  /**
   * How many rows the review queue still has (not reviewed, not hidden).
   */
  getReviewCount: async (): Promise<{ count: number }> => {
    const response = await api.get('/api/transactions/review-count');
    return response.data;
  },

  /**
   * Update transaction notes
   */
  updateNotes: async (transactionId: string, notes: string) => {
    const response = await api.put(`/api/transactions/${transactionId}/notes`, { notes });
    return response.data;
  },

  /**
   * Update transaction category
   */
  updateCategory: async (transactionId: string, category: string) => {
    const response = await api.put(`/api/transactions/${transactionId}/category`, { category });
    return response.data;
  },

  /**
   * Review / hide / transfer switches for one row.
   */
  update: async (transactionId: string, changes: TransactionChanges) => {
    const response = await api.put(`/api/transactions/${transactionId}`, changes);
    return response.data;
  },

  /**
   * The same edits for many rows. The server rejects the whole batch if any id is
   * not the user's, so nothing changes on a 403.
   */
  bulkUpdate: async (
    ids: string[],
    changes: TransactionBulkChanges
  ): Promise<{ updated: number }> => {
    const response = await api.put('/api/transactions/bulk', { ids, ...changes });
    return response.data;
  },
};

/** The single display-category list, owned by the backend. */
export const categoryAPI = {
  getAll: async (): Promise<{ categories: string[] }> => {
    const response = await api.get('/api/categories');
    return response.data;
  },
};

// New cached accounts API
export type ManualAccountKind =
  | 'retirement'
  | 'investment'
  | 'property'
  | 'vehicle'
  | 'cash'
  | 'loan'
  | 'other';

export interface AccountListItem {
  id: string;
  account_id: string;
  name: string;
  official_name: string | null;
  balances: {
    current: number;
    available: number | null;
    limit: number | null;
  };
  type: string;
  subtype: string;
  mask: string | null;
  isManual: boolean;
  isLiability: boolean;
}

export interface BalanceSnapshotPoint {
  date: string;
  balance: number;
}

/** Apple Card exports its own columns; every other bank is mapped by hand. */
export type CsvImportFormat = 'apple-card' | 'generic';

/** Which column holds what, for a "Other bank" file. */
export interface CsvImportMapping {
  date: string;
  description: string;
  amount: string;
  merchant?: string;
  category?: string;
  /** Purchases are negative in the file, so flip the sign on the way in. */
  negateAmount?: boolean;
}

export interface CsvImportRequest {
  csv: string;
  format: CsvImportFormat;
  mapping?: CsvImportMapping;
  /** Writes nothing; returns `preview` and `errors` instead of a count. */
  dryRun?: boolean;
}

/** One row a dry run would write. */
export interface CsvImportPreviewRow {
  row: number;
  date: string;
  description: string;
  merchant: string | null;
  amount: number;
  category: string;
  isTransfer: boolean;
}

/** A dry run: the rows it would add and the ones it could not read. */
export interface CsvImportPreview {
  preview: CsvImportPreviewRow[];
  total: number;
  /** Rows already in the account; a re-import skips them. */
  duplicates: number;
  errors: Array<{ row: number; message: string }>;
}

export interface CsvImportResult {
  imported: number;
  /** Rows already imported once (the same date, amount, and description). */
  skipped: number;
  /** Card payments stored as transfers, not spending. */
  payments: number;
  firstDate: string | null;
  lastDate: string | null;
  note?: string;
}

/** A dry run answers with `preview`; a real import with `imported`. */
export type CsvImportResponse = CsvImportPreview | CsvImportResult;

export const accountAPI = {
  /**
   * Get cached account information
   */
  getAccounts: async () => {
    const response = await api.get('/api/accounts');
    return response.data;
  },

  /** Create a manual account (401(k), car, house, cash) with its first snapshot. */
  createManual: async (account: {
    name: string;
    kind: ManualAccountKind;
    balance: number;
    isLiability?: boolean;
  }): Promise<{ account: AccountListItem }> => {
    const response = await api.post('/api/accounts/manual', account);
    return response.data;
  },

  /** Rename a manual account or change its kind/liability flag. */
  updateManual: async (
    id: string,
    account: { name?: string; kind?: ManualAccountKind; isLiability?: boolean }
  ): Promise<{ account: AccountListItem }> => {
    const response = await api.put(`/api/accounts/manual/${id}`, account);
    return response.data;
  },

  /**
   * Set a balance. Today's date also updates the account; a past date back-fills
   * the snapshot used by the net-worth chart.
   */
  updateManualBalance: async (
    id: string,
    balance: number,
    date?: string
  ): Promise<{ account: AccountListItem }> => {
    const response = await api.post(`/api/accounts/manual/${id}/balance`, { balance, date });
    return response.data;
  },

  deleteManual: async (id: string): Promise<void> => {
    await api.delete(`/api/accounts/manual/${id}`);
  },

  getManualHistory: async (id: string): Promise<{ snapshots: BalanceSnapshotPoint[] }> => {
    const response = await api.get(`/api/accounts/manual/${id}/history`);
    return response.data;
  },

  /**
   * Card spending Plaid cannot see: a CSV statement into a manual account.
   * Pass `dryRun: true` first for a preview; the same call without it writes.
   */
  importCsv: async (accountId: string, body: CsvImportRequest): Promise<CsvImportResponse> => {
    const response = await api.post(`/api/accounts/manual/${accountId}/import`, body);
    return response.data;
  },
};

export type NetWorthRange = '1m' | '3m' | '6m' | '1y' | 'all';

export interface NetWorthPoint {
  date: string;
  assets: number;
  liabilities: number;
  netWorth: number;
}

export interface NetWorthAccount {
  id: string;
  name: string;
  type: string;
  isManual: boolean;
  isLiability: boolean;
  /** Stored (positive) balance; liabilities are negated for display. */
  balance: number;
}

export interface NetWorthResponse {
  current: {
    assets: number;
    liabilities: number;
    netWorth: number;
  };
  change: {
    amount: number;
    percent: number | null;
  };
  points: NetWorthPoint[];
  accounts: NetWorthAccount[];
  /** The first real snapshot day; earlier points are worked back from transactions. Null when none are. */
  estimatedBefore?: string | null;
}

export const networthAPI = {
  /**
   * Net worth history. Liabilities already count negative in the totals.
   * For ranges longer than 6 months the server samples once a week.
   */
  get: async (range: NetWorthRange = '6m'): Promise<NetWorthResponse> => {
    const response = await api.get('/api/networth', { params: { range } });
    return response.data;
  },
};

// Add request interceptor for logging
api.interceptors.request.use(
  (config) => {
    // Only log in development
    if (import.meta.env.DEV) {
      console.log('🚀 API Request:', config.method?.toUpperCase(), config.url, config.params || config.data);
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Add response interceptor for logging and error handling
api.interceptors.response.use(
  (response) => {
    // Only log in development
    if (import.meta.env.DEV) {
      console.log('✅ API Response:', response.status, response.config.url);
    }
    return response;
  },
  (error) => {
    if (import.meta.env.DEV) {
      console.log('❌ API Error:', error.response?.status, error.response?.config?.url, error.response?.data);
    }
    
    if (error.response?.status === 401) {
      // Token expired or invalid
      removeAuthToken();
      localStorage.removeItem('userData');
      window.location.href = '/login';
    }
    
    return Promise.reject(error);
  }
);

// Utility function to build query parameters for date ranges
export const buildDateRangeParams = (range: string) => {
  const now = new Date();
  const params: { dateFrom?: string; dateTo?: string } = {};

  switch (range) {
    case '7d':
      params.dateFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      break;
    case '30d':
      params.dateFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      break;
    case '90d':
      params.dateFrom = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      break;
    case '1y':
      params.dateFrom = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      break;
    case 'ytd':
      params.dateFrom = `${now.getFullYear()}-01-01`;
      break;
    case 'mtd':
      params.dateFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      break;
  }

  params.dateTo = now.toISOString().split('T')[0];
  return params;
};

export const analyticsAPI = {
  getTrends: async (months?: number) => {
    const response = await api.get('/api/analytics/trends', {
      params: { months }
    });
    return response.data;
  },

  getInsights: async () => {
    const response = await api.get('/api/analytics/insights');
    return response.data;
  },

  getMerchants: async (limit?: number) => {
    const response = await api.get('/api/analytics/merchants', {
      params: { limit }
    });
    return response.data;
  },

  getDayOfWeekPatterns: async () => {
    const response = await api.get('/api/analytics/day-of-week');
    return response.data;
  },

  getMonthlySummary: async (year?: number) => {
    const response = await api.get('/api/analytics/monthly-summary', {
      params: { year }
    });
    return response.data;
  },

  getForecast: async () => {
    const response = await api.get('/api/analytics/forecast');
    return response.data;
  }
};

export const budgetAPI = {
  /** Budgets for one month, `YYYY-MM` (defaults to the current month on the server). */
  getBudgets: async (month?: string): Promise<BudgetMonthResponse> => {
    const response = await api.get('/api/budgets', { params: month ? { month } : undefined });
    return response.data;
  },

  createBudget: async (budgetData: CreateBudgetRequest): Promise<{ budget: Budget }> => {
    const response = await api.post('/api/budgets', budgetData);
    return response.data;
  },

  /** What the last three full months say to budget, one row per category. */
  getSuggestions: async (): Promise<BudgetSuggestionsResponse> => {
    const response = await api.get('/api/budgets/suggestions');
    return response.data;
  },

  updateBudget: async (id: string, budgetData: UpdateBudgetRequest): Promise<{ budget: Budget }> => {
    const response = await api.put(`/api/budgets/${id}`, budgetData);
    return response.data;
  },

  deleteBudget: async (id: string): Promise<void> => {
    await api.delete(`/api/budgets/${id}`);
  },

  getAlerts: async (budgetId: string): Promise<{ alerts: BudgetAlert[] }> => {
    const response = await api.get(`/api/budgets/${budgetId}/alerts`);
    return response.data;
  },

  createAlert: async (budgetId: string, alertData: BudgetAlertRequest): Promise<{ alert: BudgetAlert }> => {
    const response = await api.post(`/api/budgets/${budgetId}/alerts`, alertData);
    return response.data;
  },

  updateAlert: async (
    budgetId: string,
    alertId: string,
    alertData: Partial<BudgetAlertRequest>
  ): Promise<{ alert: BudgetAlert }> => {
    const response = await api.put(`/api/budgets/${budgetId}/alerts/${alertId}`, alertData);
    return response.data;
  },

  deleteAlert: async (budgetId: string, alertId: string): Promise<void> => {
    await api.delete(`/api/budgets/${budgetId}/alerts/${alertId}`);
  }
};

export type RecurringStatus = 'ACTIVE' | 'IGNORED';

export interface RecurringSeries {
  id: string;
  merchantKey: string;
  displayName: string;
  averageAmount: number;
  intervalDays: number;
  lastDate: string;
  nextDate: string;
  status: RecurringStatus;
  monthlyEquivalent: number;
  /** The amount before the latest price change; null when the price never changed. */
  previousAmount: number | null;
  /** The day the current price started. */
  amountChangedAt: string | null;
}

export interface RecurringResponse {
  series: RecurringSeries[];
  /** The ACTIVE series only, in cents. */
  monthlyTotal: number;
  upcoming: RecurringSeries[];
}

export const recurringAPI = {
  getAll: async (): Promise<RecurringResponse> => {
    const response = await api.get('/api/recurring');
    return response.data;
  },

  /** Detects the series again now instead of waiting for the nightly job. */
  refresh: async (): Promise<RecurringResponse> => {
    const response = await api.post('/api/recurring/refresh');
    return response.data;
  },

  setStatus: async (id: string, status: RecurringStatus): Promise<{ series: RecurringSeries }> => {
    const response = await api.patch(`/api/recurring/${id}`, { status });
    return response.data;
  },
};

// --- Rules (W4.2) -------------------------------------------------------

/** A saved rule. The schema fields only; `matchCount` comes from the list endpoint. */
export interface Rule {
  id: string;
  priority: number;
  matchMerchant: string | null;
  matchAmountMin: number | null;
  matchAmountMax: number | null;
  matchAccountId: string | null;
  setCategory: string | null;
  setMerchant: string | null;
  setTransfer: boolean | null;
  setHidden: boolean | null;
  createdAt: string;
  updatedAt: string;
}

export type RuleWithMatchCount = Rule & { matchCount: number };

/** What the user can set on a rule. A missing or null field means "not set". */
export interface RuleDraft {
  priority?: number;
  matchMerchant?: string | null;
  matchAmountMin?: number | null;
  matchAmountMax?: number | null;
  matchAccountId?: string | null;
  setCategory?: string | null;
  setMerchant?: string | null;
  setTransfer?: boolean | null;
  setHidden?: boolean | null;
}

/** One row a draft matches, as the preview returns it. */
export interface RuleMatchSample {
  id: string;
  date: string;
  name: string;
  merchantName: string | null;
  amount: number;
  primaryCategory: string | null;
}

/** A dry run: the count and up to the ten most recent matches. Writes nothing. */
export interface RulePreview {
  matchCount: number;
  sample: RuleMatchSample[];
}

export interface RuleApplyResult {
  updated: number;
  /** Rows left alone because the user picked that category themselves. */
  skippedUserCategory: number;
}

export const rulesAPI = {
  /** The user's rules, highest priority first, each with how many rows it matches now. */
  list: async (): Promise<{ rules: RuleWithMatchCount[] }> => {
    const response = await api.get('/api/rules');
    return response.data;
  },

  create: async (draft: RuleDraft): Promise<{ rule: Rule }> => {
    const response = await api.post('/api/rules', draft);
    return response.data;
  },

  /** The whole rule is replaced, so always send every field. */
  update: async (id: string, draft: RuleDraft): Promise<{ rule: Rule }> => {
    const response = await api.put(`/api/rules/${id}`, draft);
    return response.data;
  },

  remove: async (id: string): Promise<{ success: true }> => {
    const response = await api.delete(`/api/rules/${id}`);
    return response.data;
  },

  preview: async (draft: RuleDraft): Promise<RulePreview> => {
    const response = await api.post('/api/rules/preview', draft);
    return response.data;
  },

  /** Applies a saved rule to the rows that already exist. */
  apply: async (id: string): Promise<RuleApplyResult> => {
    const response = await api.post(`/api/rules/${id}/apply`);
    return response.data;
  },

  /**
   * Builds a rule from one transaction's merchant, unapplied. Call `apply` once the
   * user confirms the match count.
   */
  fromTransaction: async (
    transactionId: string,
    setCategory?: string
  ): Promise<{ rule: Rule; matchCount: number }> => {
    const response = await api.post('/api/rules/from-transaction', { transactionId, setCategory });
    return response.data;
  },
};

export interface MonthNote {
  month: string;
  note: string | null;
  savingsTarget: number | null;
  closedAt: string | null;
}

/** Monthly close (E7): the owner's note, the month's savings target, and when it was closed. */
export const monthNoteAPI = {
  get: async (month: string): Promise<MonthNote> => {
    const response = await api.get(`/api/month-notes/${month}`);
    return response.data;
  },

  save: async (
    month: string,
    changes: { note?: string | null; savingsTarget?: number | null; closed?: boolean }
  ): Promise<MonthNote> => {
    const response = await api.put(`/api/month-notes/${month}`, changes);
    return response.data;
  },
};
