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

interface Budget {
  id: string;
  name: string;
  category: string;
  amount: number;
  period: 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  spent: number;
  remaining: number;
  percentUsed: number;
  isActive: boolean;
  startDate: string;
  endDate?: string;
  createdAt: string;
  updatedAt: string;
  budgetAlerts?: BudgetAlert[];
}

interface CreateBudgetRequest {
  name: string;
  category: string;
  amount: number;
  period: 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  startDate?: string;
}

interface UpdateBudgetRequest {
  name?: string;
  category?: string;
  amount?: number;
  period?: 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  startDate?: string;
  endDate?: string;
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

export const plaidAPI = {
  createLinkToken: async () => {
    const response = await api.post('/api/plaid/create_link_token');
    return response.data;
  },
  
  exchangePublicToken: async (publicToken: string) => {
    const response = await api.post('/api/plaid/exchange_public_token', {
      public_token: publicToken
    });
    return response.data;
  },

  disconnectBank: async () => {
    const response = await api.delete('/api/plaid/disconnect');
    return response.data;
  },

  refreshConnection: async () => {
    const response = await api.post('/api/plaid/refresh');
    return response.data;
  },

  getAccounts: async () => {
    const response = await api.get('/api/plaid/accounts');
    return response.data;
  },
  
  // Legacy endpoint - kept for backward compatibility
  getTransactions: async () => {
    console.warn('Using legacy getTransactions - consider migrating to transactionAPI.getTransactions');
    const response = await api.get('/api/plaid/transactions');
    return response.data;
  },
};

// New cached transaction API
export const transactionAPI = {
  /**
   * Get cached transactions with filtering and pagination
   */
  getTransactions: async (params?: {
    page?: number;
    limit?: number;
    category?: string;
    accountId?: string;
    search?: string;
    dateFrom?: string;
    dateTo?: string;
    amountMin?: number;
    amountMax?: number;
    type?: 'income' | 'expense' | 'all';
  }) => {
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
   * Get categorization suggestions
   */
  getSuggestions: async (transactionId: string) => {
    const response = await api.get(`/api/transactions/${transactionId}/suggestions`);
    return response.data;
  },
};

// New cached accounts API
export const accountAPI = {
  /**
   * Get cached account information
   */
  getAccounts: async () => {
    const response = await api.get('/api/accounts');
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
  getBudgets: async (): Promise<{ budgets: Budget[] }> => {
    const response = await api.get('/api/budgets');
    return response.data;
  },

  createBudget: async (budgetData: CreateBudgetRequest): Promise<{ budget: Budget }> => {
    const response = await api.post('/api/budgets', budgetData);
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
