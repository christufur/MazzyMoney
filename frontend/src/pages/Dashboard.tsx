import React, { useState, useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";
import { PlaidLink } from "../components/plaid/PlaidLink";
import { SyncStatus } from "../components/sync/SyncStatus";
import SidebarLayout from "../components/layout/SidebarLayout";
import { accountAPI, transactionAPI } from "../services/api";
import { TransactionNotes } from "../components/transactions/TransactionNotes";
import {
  Tooltip,
  ResponsiveContainer,
  Legend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
} from "recharts";

const Overview: React.FC = () => {
  const { user } = useAuth();
  const [refreshKey, setRefreshKey] = useState(0);
  const [dashboardData, setDashboardData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch all dashboard data
  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch accounts data
      const accountsData = await accountAPI.getAccounts();
      
      let transactionsData = null;
      let spendingByCategory = [];
      let monthlyTrends = [];

      if (accountsData.connected) {
        try {
          // Fetch transaction summary
          transactionsData = await transactionAPI.getTransactions({ limit: 10 });
          
          // Fetch spending by category
          spendingByCategory = await transactionAPI.getSpendingByCategory({
            dateFrom: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] // Last 30 days
          });

          // Fetch monthly trends
          monthlyTrends = await transactionAPI.getMonthlyTrends(6); // Last 6 months
        } catch (transactionError) {
          console.log('Transactions not yet synced, using account data only');
        }
      }

      setDashboardData({
        accounts: accountsData,
        transactions: transactionsData,
        spendingByCategory,
        monthlyTrends
      });

    } catch (err: any) {
      console.error('Error fetching dashboard data:', err);
      setError(err.response?.data?.error || 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, [refreshKey]);

  const handlePlaidSuccess = () => {
    setRefreshKey(prev => prev + 1);
  };

  const handleSyncComplete = () => {
    setRefreshKey(prev => prev + 1);
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  // Calculate dashboard metrics
  const getDashboardMetrics = () => {
    const accounts = dashboardData?.accounts?.accounts || [];
    const transactionSummary = dashboardData?.transactions?.summary;
    
    const totalBalance = accounts.reduce((sum: number, account: any) => 
      sum + account.balances.current, 0
    );

    const availableBalance = accounts.reduce((sum: number, account: any) => 
      sum + (account.balances.available || account.balances.current), 0
    );

    // Use real transaction data if available, otherwise show account-based metrics
    const income = transactionSummary?.income || 0;
    const expenses = transactionSummary?.expenses || 0;
    const netAmount = income - expenses;
    const savingsRate = income > 0 ? ((income - expenses) / income) * 100 : 0;

    return {
      totalBalance,
      availableBalance,
      income,
      expenses,
      netAmount,
      savingsRate,
      accountsCount: accounts.length
    };
  };

  const metrics = dashboardData ? getDashboardMetrics() : null;

  const COLORS = [
    "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", 
    "#06b6d4", "#f97316", "#84cc16", "#64748b", "#ec4899"
  ];

  if (loading) {
    return (
      <SidebarLayout title="Overview">
        <div className="flex justify-center items-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <span className="ml-3">Loading overview...</span>
        </div>
      </SidebarLayout>
    );
  }

  return (
    <SidebarLayout title="Overview">
      <div className="space-y-6">
        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
            <div className="flex justify-between items-center">
              <span>{error}</span>
              <button 
                onClick={fetchDashboardData}
                className="ml-4 text-red-600 hover:text-red-800 underline"
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {!dashboardData?.accounts?.connected ? (
          // No bank connected state
          <div className="bg-white rounded-lg shadow p-8">
            <div className="text-center">
              <div className="mx-auto h-16 w-16 text-gray-400 mb-4">
                <svg fill="none" stroke="currentColor" viewBox="0 0 48 48">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} 
                    d="M12 8v8.01M12 8c0 1.105.895 2 2 2s2-.895 2-2-2-2-2-2c-1.105 0-2 .895-2 2z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                Welcome to Your Financial Dashboard
              </h3>
              <p className="text-gray-600 mb-6 max-w-md mx-auto">
                Connect your bank account to start tracking your finances, viewing insights, 
                and managing your money effectively.
              </p>
              <PlaidLink onSuccess={handlePlaidSuccess} />
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Sync Status */}
            <SyncStatus onSyncComplete={handleSyncComplete} />

            {/* Summary Cards */}
            <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="bg-white rounded-lg shadow p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-500">Total Balance</p>
                    <p className="text-2xl font-bold text-gray-900">
                      {metrics ? formatCurrency(metrics.totalBalance) : '--'}
                    </p>
                  </div>
                  <div className="p-3 bg-blue-100 rounded-full">
                    <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
                    </svg>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-500">Available Funds</p>
                    <p className="text-2xl font-bold text-green-600">
                      {metrics ? formatCurrency(metrics.availableBalance) : '--'}
                    </p>
                  </div>
                  <div className="p-3 bg-green-100 rounded-full">
                    <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 11l5-5m0 0l5 5m-5-5v12" />
                    </svg>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-500">Monthly Expenses</p>
                    <p className="text-2xl font-bold text-red-600">
                      {metrics && metrics.expenses > 0 ? `-${formatCurrency(metrics.expenses)}` : '--'}
                    </p>
                  </div>
                  <div className="p-3 bg-red-100 rounded-full">
                    <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 13l-5 5m0 0l-5-5m5 5V6" />
                    </svg>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-500">Accounts</p>
                    <p className="text-2xl font-bold text-purple-600">
                      {metrics ? metrics.accountsCount : 0}
                    </p>
                  </div>
                  <div className="p-3 bg-purple-100 rounded-full">
                    <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                    </svg>
                  </div>
                </div>
              </div>
            </section>

            {/* Two-Column Layout */}
            <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left Column - Charts */}
              <div className="lg:col-span-2 space-y-6">
                {/* Account Balances Chart */}
                <div className="bg-white rounded-lg shadow p-6">
                  <h2 className="text-lg font-semibold mb-4">Account Balances</h2>
                  {dashboardData?.accounts?.accounts?.length > 0 ? (
                    <div className="h-72">
                      <ResponsiveContainer>
                        <BarChart data={dashboardData.accounts.accounts.map((acc: any) => ({
                          name: acc.name,
                          balance: acc.balances.current,
                          available: acc.balances.available || acc.balances.current
                        }))}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="name" />
                          <YAxis tickFormatter={(value) => formatCurrency(value)} />
                          <Tooltip formatter={(value) => [formatCurrency(value as number)]} />
                          <Legend />
                          <Bar dataKey="balance" fill="#3b82f6" name="Current Balance" />
                          <Bar dataKey="available" fill="#10b981" name="Available" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="h-72 flex items-center justify-center text-gray-500">
                      No account data available
                    </div>
                  )}
                </div>

                {/* Spending by Category */}
                {dashboardData?.spendingByCategory?.length > 0 && (
                  <div className="bg-white rounded-lg shadow p-6">
                    <h2 className="text-lg font-semibold mb-4">Spending by Category (Last 30 Days)</h2>
                    <div className="h-72">
                      <ResponsiveContainer>
                        <PieChart>
                          <Pie
                            data={dashboardData.spendingByCategory}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={100}
                            dataKey="amount"
                            label={({ category, amount }: any) => `${category}: ${formatCurrency(amount)}`}
                          >
                            {dashboardData.spendingByCategory.map((entry: any, index: number) => (
                              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(value) => [formatCurrency(value as number), 'Amount']} />
                          <Legend />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {/* Monthly Trends */}
                {dashboardData?.monthlyTrends?.length > 0 && (
                  <div className="bg-white rounded-lg shadow p-6">
                    <h2 className="text-lg font-semibold mb-4">Monthly Trends</h2>
                    <div className="h-72">
                      <ResponsiveContainer>
                        <LineChart data={dashboardData.monthlyTrends}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="month" />
                          <YAxis tickFormatter={(value) => formatCurrency(value)} />
                          <Tooltip formatter={(value) => [formatCurrency(value as number)]} />
                          <Legend />
                          <Line type="monotone" dataKey="income" stroke="#10b981" strokeWidth={2} name="Income" />
                          <Line type="monotone" dataKey="expenses" stroke="#ef4444" strokeWidth={2} name="Expenses" />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {/* Recent Transactions */}
                <div className="bg-white rounded-lg shadow p-6">
                  <h2 className="text-lg font-semibold mb-4">Recent Transactions</h2>
                  {dashboardData?.transactions?.transactions?.length > 0 ? (
                    <div className="space-y-3">
                      {dashboardData.transactions.transactions.slice(0, 5).map((transaction: any) => (
                        <div key={transaction.id} className="py-3 border-b border-gray-100 last:border-b-0">
                          <div className="flex justify-between items-start mb-2">
                            <div className="flex-1">
                              <p className="font-medium text-gray-900">{transaction.name}</p>
                              <p className="text-sm text-gray-500">{new Date(transaction.date).toLocaleDateString()}</p>
                            </div>
                            <div className="text-right ml-4">
                              <p className={`font-semibold ${transaction.amount > 0 ? 'text-red-600' : 'text-green-600'}`}>
                                {transaction.amount > 0 ? '-' : '+'}{formatCurrency(Math.abs(transaction.amount))}
                              </p>
                              {transaction.primaryCategory && (
                                <p className="text-xs text-gray-500">{transaction.primaryCategory}</p>
                              )}
                            </div>
                          </div>
                          <TransactionNotes
                            transactionId={transaction.id}
                            initialNotes={transaction.notes || ''}
                            onUpdate={(notes) => {
                              // Update the transaction in the local state
                              setDashboardData((prev: any) => ({
                                ...prev,
                                transactions: {
                                  ...prev.transactions,
                                  transactions: prev.transactions.transactions.map((t: any) => 
                                    t.id === transaction.id 
                                      ? { ...t, notes }
                                      : t
                                  )
                                }
                              }));
                            }}
                            compact={true}
                          />
                        </div>
                      ))}
                      <div className="text-center pt-4">
                        <a href="/transactions" className="text-blue-600 hover:text-blue-800 text-sm font-medium">
                          View All Transactions →
                        </a>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-8 text-gray-500">
                      <p>No transactions found.</p>
                      <p className="text-sm mt-2">Transactions will appear here after they sync from your bank.</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column - Summary & Info */}
              <div className="space-y-6">
                {/* Quick Stats */}
                <div className="bg-white rounded-lg shadow p-6">
                  <h2 className="text-lg font-semibold mb-4">Quick Stats</h2>
                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Connected Accounts</span>
                      <span className="font-medium">{metrics?.accountsCount || 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Institution</span>
                      <span className="font-medium">{dashboardData?.accounts?.institution?.name || 'Unknown'}</span>
                    </div>
                    {dashboardData?.transactions && (
                      <>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Total Transactions</span>
                          <span className="font-medium">{dashboardData.transactions.summary?.totalTransactions || 0}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">This Month Income</span>
                          <span className="font-medium text-green-600">
                            {formatCurrency(metrics?.income || 0)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">This Month Expenses</span>
                          <span className="font-medium text-red-600">
                            {formatCurrency(metrics?.expenses || 0)}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Account List */}
                <div className="bg-white rounded-lg shadow p-6">
                  <h2 className="text-lg font-semibold mb-4">Your Accounts</h2>
                  <div className="space-y-3">
                    {dashboardData?.accounts?.accounts?.map((account: any) => (
                      <div key={account.account_id} className="flex justify-between items-center">
                        <div>
                          <p className="font-medium text-gray-900">{account.name}</p>
                          <p className="text-sm text-gray-500 capitalize">{account.subtype}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold">{formatCurrency(account.balances.current)}</p>
                          {account.balances.available !== null && account.balances.available !== account.balances.current && (
                            <p className="text-xs text-gray-500">
                              Available: {formatCurrency(account.balances.available)}
                            </p>
                          )}
                        </div>
                      </div>
                    )) || (
                      <p className="text-gray-500 text-center py-4">No accounts found</p>
                    )}
                  </div>
                  <div className="text-center pt-4 mt-4 border-t">
                    <a href="/accounts" className="text-blue-600 hover:text-blue-800 text-sm font-medium">
                      Manage Accounts →
                    </a>
                  </div>
                </div>

                {/* Quick Actions */}
                <div className="bg-white rounded-lg shadow p-6">
                  <h2 className="text-lg font-semibold mb-4">Quick Actions</h2>
                  <div className="space-y-3">
                    <a 
                      href="/transactions" 
                      className="block w-full bg-blue-50 hover:bg-blue-100 text-blue-700 px-4 py-3 rounded-md text-sm font-medium transition-colors"
                    >
                      📊 View All Transactions
                    </a>
                    <a 
                      href="/reports" 
                      className="block w-full bg-green-50 hover:bg-green-100 text-green-700 px-4 py-3 rounded-md text-sm font-medium transition-colors"
                    >
                      📈 Financial Reports
                    </a>
                    <a 
                      href="/budget" 
                      className="block w-full bg-yellow-50 hover:bg-yellow-100 text-yellow-700 px-4 py-3 rounded-md text-sm font-medium transition-colors"
                    >
                      💰 Manage Budgets
                    </a>
                    <a 
                      href="/accounts" 
                      className="block w-full bg-purple-50 hover:bg-purple-100 text-purple-700 px-4 py-3 rounded-md text-sm font-medium transition-colors"
                    >
                      🏦 Manage Accounts
                    </a>
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}
      </div>
    </SidebarLayout>
  );
};

export default Overview;