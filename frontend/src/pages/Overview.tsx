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
          <div className="bg-gradient-to-br from-blue-50 to-indigo-100 rounded-xl shadow-lg border border-blue-200 p-8">
            <div className="text-center">
              <div className="mx-auto h-20 w-20 text-blue-500 mb-6">
                <svg fill="none" stroke="currentColor" viewBox="0 0 48 48" className="w-full h-full">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} 
                    d="M12 8v8.01M12 8c0 1.105.895 2 2 2s2-.895 2-2-2-2-2-2c-1.105 0-2 .895-2 2z" />
                </svg>
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-3">
                Welcome to Your Financial Hub
              </h3>
              <p className="text-gray-600 mb-8 max-w-lg mx-auto text-lg">
                Connect your bank account to unlock powerful insights, track spending patterns, 
                and take control of your financial future.
              </p>
              <div className="mb-6">
                <PlaidLink onSuccess={handlePlaidSuccess} />
              </div>
              <div className="grid grid-cols-2 gap-4 max-w-md mx-auto text-sm text-gray-600">
                <div className="flex items-center space-x-2">
                  <div className="w-5 h-5 bg-green-100 rounded-full flex items-center justify-center">
                    <svg className="w-3 h-3 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <span>Real-time balances</span>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="w-5 h-5 bg-green-100 rounded-full flex items-center justify-center">
                    <svg className="w-3 h-3 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <span>Smart categorization</span>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="w-5 h-5 bg-green-100 rounded-full flex items-center justify-center">
                    <svg className="w-3 h-3 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <span>Budget tracking</span>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="w-5 h-5 bg-green-100 rounded-full flex items-center justify-center">
                    <svg className="w-3 h-3 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <span>Financial insights</span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Sync Status */}
            <SyncStatus onSyncComplete={handleSyncComplete} />

            {/* Net Worth Hero Section */}
            <section className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-xl shadow-lg text-white p-8 mb-6">
              <div className="text-center">
                <p className="text-blue-100 text-sm uppercase tracking-wide font-medium mb-2">Net Worth</p>
                <p className="text-4xl md:text-5xl font-bold mb-4">
                  {metrics ? formatCurrency(metrics.totalBalance) : '--'}
                </p>
                <div className="flex items-center justify-center space-x-6 text-sm">
                  <div className="flex items-center space-x-2">
                    <div className="w-2 h-2 bg-green-300 rounded-full"></div>
                    <span className="text-blue-100">
                      {metrics?.accountsCount || 0} accounts connected
                    </span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <div className="w-2 h-2 bg-green-300 rounded-full"></div>
                    <span className="text-blue-100">
                      Last updated: {new Date().toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </div>
            </section>

            {/* Financial Health Cards */}
            <section className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="p-2 bg-green-100 rounded-lg">
                    <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 11l5-5m0 0l5 5m-5-5v12" />
                    </svg>
                  </div>
                  <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full">This month</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500 mb-1">Income</p>
                  <p className="text-2xl font-bold text-green-600">
                    {metrics && metrics.income > 0 ? `+${formatCurrency(metrics.income)}` : '--'}
                  </p>
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="p-2 bg-red-100 rounded-lg">
                    <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 13l-5 5m0 0l-5-5m5 5V6" />
                    </svg>
                  </div>
                  <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full">This month</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500 mb-1">Expenses</p>
                  <p className="text-2xl font-bold text-red-600">
                    {metrics && metrics.expenses > 0 ? `-${formatCurrency(metrics.expenses)}` : '--'}
                  </p>
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className={`p-2 rounded-lg ${metrics && metrics.netAmount >= 0 ? 'bg-blue-100' : 'bg-orange-100'}`}>
                    <svg className={`w-6 h-6 ${metrics && metrics.netAmount >= 0 ? 'text-blue-600' : 'text-orange-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                  </div>
                  <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                    {metrics && metrics.savingsRate >= 20 ? 'Great!' : metrics && metrics.savingsRate >= 10 ? 'Good' : 'Can improve'}
                  </span>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500 mb-1">Savings Rate</p>
                  <p className={`text-2xl font-bold ${metrics && metrics.netAmount >= 0 ? 'text-blue-600' : 'text-orange-600'}`}>
                    {metrics ? `${metrics.savingsRate.toFixed(1)}%` : '--'}
                  </p>
                </div>
              </div>
            </section>

            {/* Main Content Grid */}
            <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left Column - Key Insights & Actions */}
              <div className="lg:col-span-2 space-y-6">
                
                {/* Smart Insights Section */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-lg font-semibold text-gray-900">💡 Smart Insights</h2>
                    <button className="text-sm text-blue-600 hover:text-blue-700 font-medium">View All</button>
                  </div>
                  <div className="space-y-4">
                    {dashboardData?.spendingByCategory?.length > 0 ? (
                      <>
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                          <div className="flex items-start space-x-3">
                            <div className="p-1 bg-blue-100 rounded-full">
                              <svg className="w-4 h-4 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                              </svg>
                            </div>
                            <div className="flex-1">
                              <p className="text-sm font-medium text-blue-900">Top spending category this month</p>
                              <p className="text-sm text-blue-700">
                                {dashboardData.spendingByCategory[0]?.category}: {formatCurrency(dashboardData.spendingByCategory[0]?.amount || 0)}
                              </p>
                            </div>
                          </div>
                        </div>
                        {metrics && metrics.savingsRate < 10 && (
                          <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                            <div className="flex items-start space-x-3">
                              <div className="p-1 bg-orange-100 rounded-full">
                                <svg className="w-4 h-4 text-orange-600" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                </svg>
                              </div>
                              <div className="flex-1">
                                <p className="text-sm font-medium text-orange-900">Low savings rate</p>
                                <p className="text-sm text-orange-700">
                                  Your savings rate is {metrics.savingsRate.toFixed(1)}%. Consider setting up a budget to save more.
                                </p>
                              </div>
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="text-center py-8 text-gray-500">
                        <p className="text-sm">Insights will appear here once you have transaction data.</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Recent Transactions Feed */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-lg font-semibold text-gray-900">Recent Transactions</h2>
                    <a href="/transactions" className="text-sm text-blue-600 hover:text-blue-700 font-medium">
                      View All →
                    </a>
                  </div>
                  {dashboardData?.transactions?.transactions?.length > 0 ? (
                    <div className="space-y-4">
                      {dashboardData.transactions.transactions.slice(0, 6).map((transaction: any) => (
                        <div key={transaction.id} className="flex items-center space-x-4 p-3 hover:bg-gray-50 rounded-lg transition-colors">
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                            transaction.amount > 0 ? 'bg-red-100' : 'bg-green-100'
                          }`}>
                            {transaction.amount > 0 ? (
                              <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 13l-5 5m0 0l-5-5m5 5V6" />
                              </svg>
                            ) : (
                              <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 11l5-5m0 0l5 5m-5-5v12" />
                              </svg>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-gray-900 truncate">{transaction.name}</p>
                            <div className="flex items-center space-x-2 text-sm text-gray-500">
                              <span>{new Date(transaction.date).toLocaleDateString()}</span>
                              {transaction.primaryCategory && (
                                <>
                                  <span>•</span>
                                  <span className="bg-gray-100 px-2 py-1 rounded text-xs">{transaction.primaryCategory}</span>
                                </>
                              )}
                            </div>
                          </div>
                          <div className="text-right">
                            <p className={`font-semibold ${transaction.amount > 0 ? 'text-red-600' : 'text-green-600'}`}>
                              {transaction.amount > 0 ? '-' : '+'}{formatCurrency(Math.abs(transaction.amount))}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-12 text-gray-500">
                      <div className="w-12 h-12 mx-auto mb-4 text-gray-300">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 48 48" className="w-full h-full">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5l3-3m0 0l3 3m-3-3v12" />
                        </svg>
                      </div>
                      <p className="font-medium">No transactions yet</p>
                      <p className="text-sm mt-1">Transactions will appear here after they sync from your bank.</p>
                    </div>
                  )}
                </div>

                {/* Quick Spending Overview */}
                {dashboardData?.spendingByCategory?.length > 0 && (
                  <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                    <div className="flex items-center justify-between mb-6">
                      <h2 className="text-lg font-semibold text-gray-900">Spending This Month</h2>
                      <a href="/insights" className="text-sm text-blue-600 hover:text-blue-700 font-medium">
                        View Details →
                      </a>
                    </div>
                    <div className="space-y-4">
                      {dashboardData.spendingByCategory.slice(0, 5).map((category: any, index: number) => (
                        <div key={category.category} className="flex items-center justify-between">
                          <div className="flex items-center space-x-3">
                            <div 
                              className="w-3 h-3 rounded-full"
                              style={{ backgroundColor: COLORS[index % COLORS.length] }}
                            />
                            <span className="text-sm font-medium text-gray-700">{category.category}</span>
                          </div>
                          <div className="text-right">
                            <span className="text-sm font-semibold text-gray-900">
                              {formatCurrency(category.amount)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Right Column - Accounts & Actions */}
              <div className="space-y-6">
                
                {/* Account Summary Cards */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-lg font-semibold text-gray-900">Your Accounts</h2>
                    <span className="text-sm text-gray-500">
                      {dashboardData?.accounts?.institution?.name || 'Bank'}
                    </span>
                  </div>
                  <div className="space-y-4">
                    {dashboardData?.accounts?.accounts?.length > 0 ? (
                      dashboardData.accounts.accounts.map((account: any) => (
                        <div key={account.account_id} className="bg-gray-50 rounded-lg p-4 hover:bg-gray-100 transition-colors">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center space-x-3">
                              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                                account.subtype === 'checking' ? 'bg-blue-100' :
                                account.subtype === 'savings' ? 'bg-green-100' :
                                account.subtype === 'credit' ? 'bg-purple-100' : 'bg-gray-100'
                              }`}>
                                <svg className={`w-4 h-4 ${
                                  account.subtype === 'checking' ? 'text-blue-600' :
                                  account.subtype === 'savings' ? 'text-green-600' :
                                  account.subtype === 'credit' ? 'text-purple-600' : 'text-gray-600'
                                }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                                </svg>
                              </div>
                              <div>
                                <p className="font-medium text-gray-900 text-sm">{account.name}</p>
                                <p className="text-xs text-gray-500 capitalize">{account.subtype}</p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="font-semibold text-gray-900">{formatCurrency(account.balances.current)}</p>
                              {account.balances.available !== null && account.balances.available !== account.balances.current && (
                                <p className="text-xs text-gray-500">
                                  Avail: {formatCurrency(account.balances.available)}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-6 text-gray-500">
                        <div className="w-12 h-12 mx-auto mb-3 text-gray-300">
                          <svg fill="none" stroke="currentColor" viewBox="0 0 48 48" className="w-full h-full">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                          </svg>
                        </div>
                        <p className="text-sm font-medium">No accounts connected</p>
                        <p className="text-xs mt-1">Connect your bank to see accounts</p>
                      </div>
                    )}
                  </div>
                  <div className="mt-4 pt-4 border-t border-gray-200">
                    <button className="w-full text-blue-600 hover:text-blue-700 text-sm font-medium">
                      View All Accounts
                    </button>
                  </div>
                </div>

                {/* Monthly Summary */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                  <h2 className="text-lg font-semibold text-gray-900 mb-6">This Month</h2>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
                          <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 11l5-5m0 0l5 5m-5-5v12" />
                          </svg>
                        </div>
                        <span className="text-sm font-medium text-gray-700">Income</span>
                      </div>
                      <span className="text-sm font-semibold text-green-600">
                        +{formatCurrency(metrics?.income || 0)}
                      </span>
                    </div>
                    
                    <div className="flex items-center justify-between p-3 bg-red-50 rounded-lg">
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center">
                          <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 13l-5 5m0 0l-5-5m5 5V6" />
                          </svg>
                        </div>
                        <span className="text-sm font-medium text-gray-700">Expenses</span>
                      </div>
                      <span className="text-sm font-semibold text-red-600">
                        -{formatCurrency(metrics?.expenses || 0)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                          <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                          </svg>
                        </div>
                        <span className="text-sm font-medium text-gray-700">Transactions</span>
                      </div>
                      <span className="text-sm font-semibold text-gray-700">
                        {dashboardData?.transactions?.summary?.totalTransactions || 0}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Quick Actions */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                  <h2 className="text-lg font-semibold text-gray-900 mb-6">Quick Actions</h2>
                  <div className="space-y-3">
                    <button className="w-full flex items-center justify-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-3 rounded-lg text-sm font-medium transition-colors">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                      </svg>
                      <span>Add Transaction</span>
                    </button>
                    
                    <a 
                      href="/budgets" 
                      className="w-full flex items-center justify-center space-x-2 bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-3 rounded-lg text-sm font-medium transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2z" />
                      </svg>
                      <span>Manage Budgets</span>
                    </a>
                    
                    <a 
                      href="/insights" 
                      className="w-full flex items-center justify-center space-x-2 bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-3 rounded-lg text-sm font-medium transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                      </svg>
                      <span>View Insights</span>
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