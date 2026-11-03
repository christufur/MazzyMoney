import React, { useState, useEffect, useMemo } from 'react';
import SidebarLayout from '../components/layout/SidebarLayout';
import { transactionAPI } from '../services/api';
import { TransactionNotes } from '../components/transactions/TransactionNotes';
import { SmartCategorySelector } from '../components/transactions/SmartCategorySelector';

interface Transaction {
  transaction_id: string;
  name: string;
  amount: number;
  date: string;
  category: string[] | null;
  pending: boolean;
  account_id: string;
  notes?: string;
  primaryCategory?: string;
}

interface Account {
  account_id: string;
  name: string;
  balances: {
    current: number;
    available: number;
  };
  type: string;
  subtype: string;
}

interface TransactionsResponse {
  transactions: Transaction[];
  accounts: Account[];
  total_transactions: number;
}

const TransactionsPage: React.FC = () => {
  const [data, setData] = useState<TransactionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Filter states
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedAccount, setSelectedAccount] = useState('all');
  const [dateRange, setDateRange] = useState('30'); // days
  const [amountFilter, setAmountFilter] = useState('all');
  
  // Bulk action states
  const [selectedTransactions, setSelectedTransactions] = useState<Set<string>>(new Set());
  const [bulkCategory, setBulkCategory] = useState('');
  const [showBulkActions, setShowBulkActions] = useState(false);
  
  // View states
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    const fetchTransactions = async () => {
      try {
        setLoading(true);
        // shortcut: loads the latest 500 cached rows into the old Plaid-shaped state; W2.6 replaces this with server-side paging.
        const response = await transactionAPI.getTransactions({ limit: 500 });
        const accounts = new Map<string, Account>();
        const transactions: Transaction[] = response.transactions.map((t: any) => {
          accounts.set(t.accountId, { account_id: t.accountId, name: t.account?.name ?? 'Account', balances: { current: 0, available: 0 }, type: t.account?.type ?? '', subtype: t.account?.subtype ?? '' });
          return { transaction_id: t.id, name: t.merchantDisplay ?? t.name, amount: t.amount, date: t.date, category: t.categories ?? null, pending: t.pending, account_id: t.accountId, notes: t.notes ?? undefined, primaryCategory: t.primaryCategory ?? undefined };
        });
        setData({ transactions, accounts: Array.from(accounts.values()), total_transactions: response.pagination.totalCount });
      } catch (err: any) {
        setError(err.response?.data?.error || 'Failed to fetch transactions');
      } finally {
        setLoading(false);
      }
    };

    fetchTransactions();
  }, []);

  // Get unique categories for filter dropdown
  const categories = useMemo(() => {
    if (!data?.transactions) return [];
    const categorySet = new Set<string>();
    data.transactions.forEach(transaction => {
      const category = transaction.category?.[0] || 'Other';
      categorySet.add(category);
    });
    return Array.from(categorySet).sort();
  }, [data?.transactions]);

  // Filter transactions based on current filters
  const filteredTransactions = useMemo(() => {
    if (!data?.transactions) return [];
    
    return data.transactions.filter(transaction => {
      // Search filter
      if (searchTerm && !transaction.name.toLowerCase().includes(searchTerm.toLowerCase())) {
        return false;
      }
      
      // Category filter
      if (selectedCategory !== 'all') {
        const category = transaction.category?.[0] || 'Other';
        if (category !== selectedCategory) return false;
      }
      
      // Account filter
      if (selectedAccount !== 'all' && transaction.account_id !== selectedAccount) {
        return false;
      }
      
      // Date range filter
      if (dateRange !== 'all') {
        const transactionDate = new Date(transaction.date);
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - parseInt(dateRange));
        if (transactionDate < cutoffDate) return false;
      }
      
      // Amount filter
      if (amountFilter !== 'all') {
        if (amountFilter === 'income' && transaction.amount >= 0) return false;
        if (amountFilter === 'expenses' && transaction.amount < 0) return false;
      }
      
      return true;
    });
  }, [data?.transactions, searchTerm, selectedCategory, selectedAccount, dateRange, amountFilter]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(Math.abs(amount));
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const getAccountName = (accountId: string) => {
    const account = data?.accounts.find(acc => acc.account_id === accountId);
    return account?.name || 'Unknown Account';
  };

  // Bulk action handlers
  const toggleTransactionSelection = (transactionId: string) => {
    const newSelected = new Set(selectedTransactions);
    if (newSelected.has(transactionId)) {
      newSelected.delete(transactionId);
    } else {
      newSelected.add(transactionId);
    }
    setSelectedTransactions(newSelected);
    setShowBulkActions(newSelected.size > 0);
  };

  const selectAllTransactions = () => {
    const allIds = new Set(filteredTransactions.map(t => t.transaction_id));
    setSelectedTransactions(allIds);
    setShowBulkActions(allIds.size > 0);
  };

  const clearSelection = () => {
    setSelectedTransactions(new Set());
    setShowBulkActions(false);
  };

  const applybulkCategory = async () => {
    if (!bulkCategory || selectedTransactions.size === 0) return;
    
    // TODO: Implement bulk category update API call
    // For now, update local state
    setData(prev => prev ? {
      ...prev,
      transactions: prev.transactions.map(t => 
        selectedTransactions.has(t.transaction_id)
          ? { ...t, primaryCategory: bulkCategory }
          : t
      )
    } : null);
    
    clearSelection();
    setBulkCategory('');
  };

  const getCategoryIcon = (category: string) => {
    const iconMap: Record<string, string> = {
      'Food & Dining': '🍽️',
      'Transportation': '🚗',
      'Shopping': '🛍️',
      'Entertainment': '🎬',
      'Bills & Utilities': '💡',
      'Healthcare': '🏥',
      'Travel': '✈️',
      'Income': '💰',
      'Transfer': '🔄',
      'Other': '📦'
    };
    return iconMap[category] || '📦';
  };

  const getMerchantLogo = (name: string) => {
    // Simple merchant detection - in a real app, you'd use a service like Clearbit
    const merchant = name.toLowerCase();
    if (merchant.includes('amazon')) return '🛒';
    if (merchant.includes('starbucks')) return '☕';
    if (merchant.includes('uber')) return '🚗';
    if (merchant.includes('spotify')) return '🎵';
    if (merchant.includes('netflix')) return '📺';
    if (merchant.includes('grocery') || merchant.includes('market')) return '🛒';
    if (merchant.includes('gas') || merchant.includes('shell') || merchant.includes('exxon')) return '⛽';
    return '🏪';
  };

  // Calculate summary stats for filtered transactions
  const summaryStats = useMemo(() => {
    const income = filteredTransactions
      .filter(t => t.amount < 0)
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);
    
    const expenses = filteredTransactions
      .filter(t => t.amount > 0)
      .reduce((sum, t) => sum + t.amount, 0);
    
    return {
      totalTransactions: filteredTransactions.length,
      income,
      expenses,
      netAmount: income - expenses
    };
  }, [filteredTransactions]);

  if (loading) {
    return (
      <SidebarLayout title="Transactions">
        <div className="text-center py-8">Loading transactions...</div>
      </SidebarLayout>
    );
  }

  if (error) {
    return (
      <SidebarLayout title="Transactions">
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      </SidebarLayout>
    );
  }

  if (!data || data.transactions.length === 0) {
    return (
      <SidebarLayout title="Transactions">
        <div className="text-center py-8 text-gray-500">
          No transactions found. Connect your bank account to view transactions.
        </div>
      </SidebarLayout>
    );
  }

  return (
    <SidebarLayout title="Transactions">
      <div className="space-y-6">
        {/* Header with Search and Actions */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between space-y-4 lg:space-y-0">
            {/* Search and Quick Filters */}
            <div className="flex-1 max-w-2xl">
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search transactions..."
                  className="block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-lg leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              
              {/* Quick Filter Pills */}
              <div className="flex flex-wrap items-center space-x-2 mt-3">
                <button
                  onClick={() => setAmountFilter(amountFilter === 'expenses' ? 'all' : 'expenses')}
                  className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                    amountFilter === 'expenses'
                      ? 'bg-red-100 text-red-700 border border-red-200'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Expenses
                </button>
                <button
                  onClick={() => setAmountFilter(amountFilter === 'income' ? 'all' : 'income')}
                  className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                    amountFilter === 'income'
                      ? 'bg-green-100 text-green-700 border border-green-200'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Income
                </button>
                <button
                  onClick={() => setDateRange(dateRange === '7' ? '30' : '7')}
                  className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                    dateRange === '7'
                      ? 'bg-blue-100 text-blue-700 border border-blue-200'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Last 7 Days
                </button>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center space-x-3">
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={`inline-flex items-center px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium transition-colors ${
                  showFilters ? 'bg-blue-50 text-blue-700 border-blue-300' : 'text-gray-700 bg-white hover:bg-gray-50'
                }`}
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.207A1 1 0 013 6.5V4z" />
                </svg>
                Filters
              </button>
              
              <div className="flex items-center bg-gray-100 rounded-lg p-1">
                <button
                  onClick={() => setViewMode('cards')}
                  className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                    viewMode === 'cards' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600'
                  }`}
                >
                  Cards
                </button>
                <button
                  onClick={() => setViewMode('table')}
                  className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                    viewMode === 'table' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600'
                  }`}
                >
                  Table
                </button>
              </div>

              <button className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors">
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                Add Transaction
              </button>
            </div>
          </div>
        </div>

        {/* Summary Cards - Redesigned */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500">Transactions</p>
                <p className="text-2xl font-bold text-gray-900">{summaryStats.totalTransactions}</p>
              </div>
              <div className="p-3 bg-gray-100 rounded-lg">
                <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
            </div>
          </div>
          
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500">Income</p>
                <p className="text-2xl font-bold text-green-600">+{formatCurrency(summaryStats.income)}</p>
              </div>
              <div className="p-3 bg-green-100 rounded-lg">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 11l5-5m0 0l5 5m-5-5v12" />
                </svg>
              </div>
            </div>
          </div>
          
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500">Expenses</p>
                <p className="text-2xl font-bold text-red-600">-{formatCurrency(summaryStats.expenses)}</p>
              </div>
              <div className="p-3 bg-red-100 rounded-lg">
                <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 13l-5 5m0 0l-5-5m5 5V6" />
                </svg>
              </div>
            </div>
          </div>
          
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500">Net Amount</p>
                <p className={`text-2xl font-bold ${summaryStats.netAmount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {summaryStats.netAmount >= 0 ? '+' : ''}{formatCurrency(summaryStats.netAmount)}
                </p>
              </div>
              <div className={`p-3 rounded-lg ${summaryStats.netAmount >= 0 ? 'bg-green-100' : 'bg-red-100'}`}>
                <svg className={`w-6 h-6 ${summaryStats.netAmount >= 0 ? 'text-green-600' : 'text-red-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
            </div>
          </div>
        </div>

        {/* Advanced Filters (Collapsible) */}
        {showFilters && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Advanced Filters</h3>
              <button
                onClick={() => setShowFilters(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Category Filter */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Category</label>
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="all">All Categories</option>
                  {categories.map(category => (
                    <option key={category} value={category}>{category}</option>
                  ))}
                </select>
              </div>

              {/* Account Filter */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Account</label>
                <select
                  value={selectedAccount}
                  onChange={(e) => setSelectedAccount(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="all">All Accounts</option>
                  {data.accounts.map(account => (
                    <option key={account.account_id} value={account.account_id}>
                      {account.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Date Range */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Date Range</label>
                <select
                  value={dateRange}
                  onChange={(e) => setDateRange(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="all">All Time</option>
                  <option value="7">Last 7 Days</option>
                  <option value="30">Last 30 Days</option>
                  <option value="90">Last 90 Days</option>
                  <option value="365">Last Year</option>
                </select>
              </div>

              {/* Clear Filters */}
              <div className="flex items-end">
                <button
                  onClick={() => {
                    setSearchTerm('');
                    setSelectedCategory('all');
                    setSelectedAccount('all');
                    setDateRange('30');
                    setAmountFilter('all');
                  }}
                  className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                >
                  Clear All
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Bulk Actions Bar */}
        {showBulkActions && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <span className="text-sm font-medium text-blue-900">
                  {selectedTransactions.size} transaction{selectedTransactions.size !== 1 ? 's' : ''} selected
                </span>
                <select
                  value={bulkCategory}
                  onChange={(e) => setBulkCategory(e.target.value)}
                  className="border border-blue-300 rounded-lg px-3 py-1 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select category...</option>
                  {categories.map(category => (
                    <option key={category} value={category}>{category}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={applybulkCategory}
                  disabled={!bulkCategory}
                  className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white px-4 py-1 rounded-lg text-sm font-medium transition-colors"
                >
                  Apply Category
                </button>
                <button
                  onClick={clearSelection}
                  className="bg-gray-500 hover:bg-gray-600 text-white px-4 py-1 rounded-lg text-sm font-medium transition-colors"
                >
                  Clear
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Transactions Display */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <h2 className="text-xl font-semibold text-gray-900">
                Transactions ({filteredTransactions.length})
              </h2>
              {filteredTransactions.length > 0 && (
                <button
                  onClick={selectAllTransactions}
                  className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                >
                  Select All
                </button>
              )}
            </div>
          </div>

          {filteredTransactions.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <div className="w-16 h-16 mx-auto mb-4 text-gray-300">
                <svg fill="none" stroke="currentColor" viewBox="0 0 64 64" className="w-full h-full">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5l3-3m0 0l3 3m-3-3v12" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">No transactions found</h3>
              <p className="text-gray-500">Try adjusting your filters or search terms.</p>
            </div>
          ) : viewMode === 'cards' ? (
            /* Card View */
            <div className="p-6">
              <div className="space-y-3">
                {filteredTransactions.map((transaction) => (
                  <div
                    key={transaction.transaction_id}
                    className={`bg-white border rounded-xl p-4 hover:shadow-md transition-all duration-200 ${
                      selectedTransactions.has(transaction.transaction_id) ? 'border-blue-300 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-center space-x-4">
                      {/* Selection Checkbox */}
                      <div className="flex-shrink-0">
                        <input
                          type="checkbox"
                          checked={selectedTransactions.has(transaction.transaction_id)}
                          onChange={() => toggleTransactionSelection(transaction.transaction_id)}
                          className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
                        />
                      </div>

                      {/* Merchant Logo/Icon */}
                      <div className="flex-shrink-0 w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center text-lg">
                        {getMerchantLogo(transaction.name)}
                      </div>

                      {/* Transaction Details */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <h3 className="text-sm font-medium text-gray-900 truncate">
                              {transaction.name}
                            </h3>
                            <div className="flex items-center space-x-2 mt-1">
                              <span className="text-xs text-gray-500">
                                {formatDate(transaction.date)}
                              </span>
                              <span className="text-xs text-gray-400">•</span>
                              <span className="text-xs text-gray-500">
                                {getAccountName(transaction.account_id)}
                              </span>
                              {transaction.pending && (
                                <>
                                  <span className="text-xs text-gray-400">•</span>
                                  <span className="text-xs text-yellow-600 font-medium">Pending</span>
                                </>
                              )}
                            </div>
                          </div>
                          <div className="text-right ml-4">
                            <div className={`text-lg font-semibold ${
                              transaction.amount > 0 ? 'text-red-600' : 'text-green-600'
                            }`}>
                              {transaction.amount > 0 ? '-' : '+'}
                              {formatCurrency(transaction.amount)}
                            </div>
                          </div>
                        </div>

                        {/* Category and Notes Row */}
                        <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
                          <div className="flex items-center space-x-3">
                            <div className="flex items-center space-x-2">
                              <span className="text-sm">
                                {getCategoryIcon(transaction.primaryCategory || transaction.category?.[0] || 'Other')}
                              </span>
                              <SmartCategorySelector
                                transactionId={transaction.transaction_id}
                                currentCategory={transaction.primaryCategory || transaction.category?.[0] || 'Other'}
                                onUpdate={(category) => {
                                  setData(prev => prev ? {
                                    ...prev,
                                    transactions: prev.transactions.map(t => 
                                      t.transaction_id === transaction.transaction_id 
                                        ? { ...t, primaryCategory: category }
                                        : t
                                    )
                                  } : null);
                                }}
                                compact={true}
                              />
                            </div>
                          </div>
                          <div className="flex-1 max-w-xs ml-4">
                            <TransactionNotes
                              transactionId={transaction.transaction_id}
                              initialNotes={transaction.notes || ''}
                              onUpdate={(notes) => {
                                setData(prev => prev ? {
                                  ...prev,
                                  transactions: prev.transactions.map(t => 
                                    t.transaction_id === transaction.transaction_id 
                                      ? { ...t, notes }
                                      : t
                                  )
                                } : null);
                              }}
                              compact={true}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            /* Table View */
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left">
                      <input
                        type="checkbox"
                        checked={selectedTransactions.size === filteredTransactions.length && filteredTransactions.length > 0}
                        onChange={selectedTransactions.size === filteredTransactions.length ? clearSelection : selectAllTransactions}
                        className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
                      />
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Description
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Account
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Category
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Date
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Amount
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Notes
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredTransactions.map((transaction) => (
                    <tr 
                      key={transaction.transaction_id} 
                      className={`hover:bg-gray-50 ${
                        selectedTransactions.has(transaction.transaction_id) ? 'bg-blue-50' : ''
                      }`}
                    >
                      <td className="px-6 py-4 whitespace-nowrap">
                        <input
                          type="checkbox"
                          checked={selectedTransactions.has(transaction.transaction_id)}
                          onChange={() => toggleTransactionSelection(transaction.transaction_id)}
                          className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
                        />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center space-x-3">
                          <div className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center text-sm">
                            {getMerchantLogo(transaction.name)}
                          </div>
                          <div>
                            <div className="text-sm font-medium text-gray-900">
                              {transaction.name}
                            </div>
                            {transaction.pending && (
                              <div className="text-xs text-yellow-600">Pending</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {getAccountName(transaction.account_id)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center space-x-2">
                          <span className="text-sm">
                            {getCategoryIcon(transaction.primaryCategory || transaction.category?.[0] || 'Other')}
                          </span>
                          <SmartCategorySelector
                            transactionId={transaction.transaction_id}
                            currentCategory={transaction.primaryCategory || transaction.category?.[0] || 'Other'}
                            onUpdate={(category) => {
                              setData(prev => prev ? {
                                ...prev,
                                transactions: prev.transactions.map(t => 
                                  t.transaction_id === transaction.transaction_id 
                                    ? { ...t, primaryCategory: category }
                                    : t
                                )
                              } : null);
                            }}
                            compact={true}
                          />
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {formatDate(transaction.date)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right">
                        <span className={
                          transaction.amount > 0
                            ? 'text-red-600 font-semibold'
                            : 'text-green-600 font-semibold'
                        }>
                          {transaction.amount > 0 ? '-' : '+'}
                          {formatCurrency(transaction.amount)}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <TransactionNotes
                          transactionId={transaction.transaction_id}
                          initialNotes={transaction.notes || ''}
                          onUpdate={(notes) => {
                            setData(prev => prev ? {
                              ...prev,
                              transactions: prev.transactions.map(t => 
                                t.transaction_id === transaction.transaction_id 
                                  ? { ...t, notes }
                                  : t
                              )
                            } : null);
                          }}
                          compact={true}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </SidebarLayout>
  );
};

export default TransactionsPage;