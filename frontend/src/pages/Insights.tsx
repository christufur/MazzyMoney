import React, { useState, useEffect, useMemo, useRef } from 'react';
import SidebarLayout from '../components/layout/SidebarLayout';
import CustomSankeyFlow from '../components/charts/sankey';
import { transactionAPI, analyticsAPI } from '../services/api';
import {
    ResponsiveContainer,
    PieChart,
    Pie,
    Cell,
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    LineChart,
    Line
} from 'recharts';

interface Transaction {
    id: string;
    name: string;
    amount: number;
    date: string;
    primaryCategory: string | null;
    pending: boolean;
}

interface TransactionSummary {
    totalTransactions: number;
    totalAmount: number;
    income: number;
    incomeCount: number;
    expenses: number;
    expenseCount: number;
    netAmount: number;
}

interface CategoryData {
    category: string;
    amount: number;
    transactionCount: number;
    percentage: number;
    color: string;
}

interface TrendData {
    month: string;
    [key: string]: any;
}

interface Insight {
    category: string;
    change: number;
    percentChange: number;
    type: 'increase' | 'decrease';
    severity: 'high' | 'medium';
}

interface Merchant {
    name: string;
    totalSpent: number;
    transactionCount: number;
    categories: string[];
    averageSpent: number;
    lastTransaction: string;
}

const InsightsPage: React.FC = () => {
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [summary, setSummary] = useState<TransactionSummary | null>(null);
    const [trends, setTrends] = useState<TrendData[]>([]);
    const [insights, setInsights] = useState<Insight[]>([]);
    const [merchants, setMerchants] = useState<Merchant[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedPeriod, setSelectedPeriod] = useState('30'); // days

    // Tab state - combining reports and analytics
    const [activeTab, setActiveTab] = useState<
        'overview' | 'cashflow' | 'spending' | 'trends' | 'insights' | 'merchants'
    >('overview');

    useEffect(() => {
        fetchAllData();
    }, [selectedPeriod]);

    const fetchAllData = async () => {
        try {
            setLoading(true);
            setError(null);

            // Calculate date range
            const endDate = new Date().toISOString().split('T')[0];
            const startDate = new Date(
                Date.now() - parseInt(selectedPeriod) * 24 * 60 * 60 * 1000
            ).toISOString().split('T')[0];

            // Fetch all data in parallel
            const [transactionsRes, analyticsRes] = await Promise.all([
                transactionAPI.getTransactions({
                    dateFrom: startDate,
                    dateTo: endDate,
                    limit: 1000,
                }),
                Promise.all([
                    analyticsAPI.getTrends(6),
                    analyticsAPI.getInsights(),
                    analyticsAPI.getMerchants(10),
                ]).catch(() => [{ trends: [] }, { insights: [] }, { merchants: [] }])
            ]);

            setTransactions(transactionsRes.transactions);
            setSummary(transactionsRes.summary);
            
            if (Array.isArray(analyticsRes)) {
                setTrends(analyticsRes[0]?.trends || []);
                setInsights(analyticsRes[1]?.insights || []);
                setMerchants(analyticsRes[2]?.merchants || []);
            }
        } catch (err: any) {
            console.error('Error fetching insights data:', err);
            setError(err.response?.data?.error || 'Failed to fetch insights data');
        } finally {
            setLoading(false);
        }
    };

    const getCategoryColor = (category: string): string => {
        const colorMap: Record<string, string> = {
            'Income': '#10b981',
            'Savings': '#059669',
            'Mortgage': '#f59e0b',
            'Housing': '#f97316',
            'Home Improvement': '#eab308',
            'Bills & Utilities': '#3b82f6',
            'Food & Dining': '#ef4444',
            'Transportation': '#8b5cf6',
            'Financial': '#ec4899',
            'Loan Repayment': '#ec4899',
            'Insurance': '#06b6d4',
            'Shopping': '#14b8a6',
            'Entertainment': '#10b981',
            'Healthcare': '#f97316',
            'Travel': '#8b5cf6',
            'Personal Care': '#14b8a6',
            'Cash & ATM': '#6b7280',
            'Government': '#7c3aed',
            'Other': '#9ca3af'
        };
        return colorMap[category] || '#9ca3af';
    };

    // Process spending data
    const spendingData = useMemo(() => {
        if (!transactions.length) return [];

        const categoryTotals = transactions
            .filter((t) => t.amount > 0) // Only expenses
            .reduce((acc: Record<string, number>, transaction) => {
                const category = transaction.primaryCategory || 'Other';
                acc[category] = (acc[category] || 0) + transaction.amount;
                return acc;
            }, {});

        const totalExpenses = Object.values(categoryTotals).reduce((sum, amount) => sum + amount, 0);

        return Object.entries(categoryTotals)
            .map(([category, amount]) => ({
                category,
                amount,
                percentage: totalExpenses > 0 ? (amount / totalExpenses) * 100 : 0,
                color: getCategoryColor(category),
                transactionCount: transactions.filter(t => 
                    t.amount > 0 && (t.primaryCategory || 'Other') === category
                ).length
            }))
            .sort((a, b) => b.amount - a.amount);
    }, [transactions]);

    // Process monthly trends data
    const monthlyTrendsData = useMemo(() => {
        if (!transactions.length) return [];

        const monthlyData: Record<string, { income: number; expenses: number; date: Date }> = {};
        
        transactions.forEach(transaction => {
            const date = new Date(transaction.date);
            const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            
            if (!monthlyData[monthKey]) {
                monthlyData[monthKey] = { income: 0, expenses: 0, date };
            }
            
            if (transaction.amount < 0) {
                monthlyData[monthKey].income += Math.abs(transaction.amount);
            } else {
                monthlyData[monthKey].expenses += transaction.amount;
            }
        });

        return Object.entries(monthlyData)
            .map(([month, data]) => ({
                month: data.date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
                income: data.income,
                expenses: data.expenses,
                netIncome: data.income - data.expenses
            }))
            .sort((a, b) => new Date(a.month).getTime() - new Date(b.month).getTime())
            .slice(-6); // Last 6 months
    }, [transactions]);

    // Calculate financial health score
    const financialHealthScore = useMemo(() => {
        if (!summary || summary.income === 0) return 0;
        
        const savingsRate = (summary.netAmount / summary.income) * 100;
        const expenseRatio = (summary.expenses / summary.income) * 100;
        
        let score = 50; // Base score
        
        // Savings rate impact (40 points max)
        if (savingsRate >= 20) score += 40;
        else if (savingsRate >= 10) score += 30;
        else if (savingsRate >= 5) score += 20;
        else if (savingsRate >= 0) score += 10;
        else score -= 20; // Negative savings
        
        // Expense diversity (10 points max)
        const categoryCount = spendingData.length;
        if (categoryCount >= 5 && categoryCount <= 8) score += 10;
        else if (categoryCount >= 3) score += 5;
        
        return Math.max(0, Math.min(100, score));
    }, [summary, spendingData]);

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
        }).format(amount);
    };

    const formatPercentage = (percentage: number) => {
        return `${percentage.toFixed(1)}%`;
    };

    const getPeriodText = () => {
        switch (selectedPeriod) {
            case '7': return 'Last 7 Days';
            case '30': return 'Last 30 Days';
            case '90': return 'Last 3 Months';
            case '365': return 'Last 12 Months';
            default: return 'Selected Period';
        }
    };

    if (loading) {
        return (
            <SidebarLayout title="Insights">
                <div className="flex justify-center items-center h-64">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                    <span className="ml-3">Loading insights...</span>
                </div>
            </SidebarLayout>
        );
    }

    if (error) {
        return (
            <SidebarLayout title="Insights">
                <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
                    {error}
                    <button 
                        onClick={fetchAllData}
                        className="ml-4 underline hover:no-underline"
                    >
                        Retry
                    </button>
                </div>
            </SidebarLayout>
        );
    }

    if (!summary || summary.expenses === 0) {
        return (
            <SidebarLayout title="Insights">
                <div className="text-center py-12 text-gray-500">
                    <div className="text-6xl mb-4">📊</div>
                    <h3 className="text-xl font-medium text-gray-900 mb-2">No data available</h3>
                    <p>No transactions found for the selected period.</p>
                    <p className="text-sm mt-2">
                        Connect your bank account and wait for transactions to sync.
                    </p>
                </div>
            </SidebarLayout>
        );
    }

    const getHealthScoreColor = (score: number) => {
        if (score >= 80) return 'text-green-600';
        if (score >= 60) return 'text-yellow-600';
        return 'text-red-600';
    };

    const getHealthScoreLabel = (score: number) => {
        if (score >= 80) return 'Excellent';
        if (score >= 60) return 'Good';
        if (score >= 40) return 'Fair';
        return 'Needs Improvement';
    };

    return (
        <SidebarLayout title="Insights">
            <div className="space-y-6">
                {/* Header Section */}
                <div className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-xl shadow-lg text-white p-8">
                    <div className="text-center">
                        <h2 className="text-2xl font-bold mb-2">Financial Insights</h2>
                        <p className="text-indigo-100 mb-6">Understand your spending patterns and financial health</p>
                        
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div className="text-center">
                                <div className="text-3xl font-bold mb-1">{formatCurrency(summary.expenses)}</div>
                                <div className="text-indigo-100 text-sm">Total Spending</div>
                                <div className="text-xs text-indigo-200 mt-1">{getPeriodText()}</div>
                            </div>
                            <div className="text-center">
                                <div className="text-3xl font-bold mb-1">{spendingData.length}</div>
                                <div className="text-indigo-100 text-sm">Categories</div>
                                <div className="text-xs text-indigo-200 mt-1">Active spending</div>
                            </div>
                            <div className="text-center">
                                <div className={`text-3xl font-bold mb-1 ${financialHealthScore >= 60 ? 'text-green-200' : 'text-yellow-200'}`}>
                                    {financialHealthScore}
                                </div>
                                <div className="text-indigo-100 text-sm">Health Score</div>
                                <div className="text-xs text-indigo-200 mt-1">{getHealthScoreLabel(financialHealthScore)}</div>
                            </div>
                        </div>

                        {/* Period Selector */}
                        <div className="mt-6 flex justify-center">
                            <div className="bg-white/10 backdrop-blur-sm rounded-lg p-1 flex space-x-1">
                                {[
                                    { value: '7', label: '7D' },
                                    { value: '30', label: '30D' },
                                    { value: '90', label: '3M' },
                                    { value: '365', label: '1Y' }
                                ].map((period) => (
                                    <button
                                        key={period.value}
                                        onClick={() => setSelectedPeriod(period.value)}
                                        className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                                            selectedPeriod === period.value
                                                ? 'bg-white text-indigo-600'
                                                : 'text-white hover:bg-white/20'
                                        }`}
                                    >
                                        {period.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Navigation Tabs */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200">
                    <div className="px-6 py-4">
                        <div className="flex space-x-8 overflow-x-auto">
                            {[
                                { id: 'overview', name: 'Overview', icon: '📊' },
                                { id: 'spending', name: 'Spending', icon: '💳' },
                                { id: 'trends', name: 'Trends', icon: '📈' },
                                { id: 'cashflow', name: 'Cash Flow', icon: '🌊' },
                                { id: 'insights', name: 'Smart Insights', icon: '🧠' },
                                { id: 'merchants', name: 'Top Merchants', icon: '🏪' }
                            ].map((tab) => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id as any)}
                                    className={`flex items-center space-x-2 pb-2 px-1 border-b-2 font-medium text-sm transition-colors whitespace-nowrap ${
                                        activeTab === tab.id
                                            ? 'border-indigo-500 text-indigo-600'
                                            : 'border-transparent text-gray-500 hover:text-gray-700'
                                    }`}
                                >
                                    <span>{tab.icon}</span>
                                    <span>{tab.name}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Overview Tab */}
                {activeTab === 'overview' && (
                    <div className="space-y-6">
                        {/* Financial Health Dashboard */}
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            {/* Financial Health Score */}
                            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                                <div className="text-center">
                                    <h3 className="text-lg font-semibold mb-4">Financial Health</h3>
                                    
                                    {/* Health Score Ring */}
                                    <div className="relative w-32 h-32 mx-auto mb-4">
                                        <svg className="w-32 h-32 transform -rotate-90" viewBox="0 0 100 100">
                                            <circle
                                                cx="50"
                                                cy="50"
                                                r="40"
                                                stroke="rgb(229, 231, 235)"
                                                strokeWidth="8"
                                                fill="none"
                                            />
                                            <circle
                                                cx="50"
                                                cy="50"
                                                r="40"
                                                stroke={
                                                    financialHealthScore >= 80 ? '#10b981' :
                                                    financialHealthScore >= 60 ? '#f59e0b' : '#ef4444'
                                                }
                                                strokeWidth="8"
                                                fill="none"
                                                strokeDasharray="251.3"
                                                strokeDashoffset={251.3 - (financialHealthScore / 100) * 251.3}
                                                strokeLinecap="round"
                                                className="transition-all duration-500"
                                            />
                                        </svg>
                                        <div className="absolute inset-0 flex items-center justify-center">
                                            <div className="text-center">
                                                <div className={`text-2xl font-bold ${getHealthScoreColor(financialHealthScore)}`}>
                                                    {financialHealthScore}
                                                </div>
                                                <div className="text-xs text-gray-500">Score</div>
                                            </div>
                                        </div>
                                    </div>
                                    
                                    <p className={`text-sm font-medium ${getHealthScoreColor(financialHealthScore)}`}>
                                        {getHealthScoreLabel(financialHealthScore)}
                                    </p>
                                    <div className="mt-4 space-y-2 text-left">
                                        <div className="flex justify-between text-sm">
                                            <span className="text-gray-600">Savings Rate</span>
                                            <span className={`font-medium ${summary.netAmount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                {formatPercentage((summary.netAmount / summary.income) * 100)}
                                            </span>
                                        </div>
                                        <div className="flex justify-between text-sm">
                                            <span className="text-gray-600">Expense Ratio</span>
                                            <span className="font-medium">{formatPercentage((summary.expenses / summary.income) * 100)}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Spending Breakdown Donut */}
                            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                                <h3 className="text-lg font-semibold mb-4">Spending Breakdown</h3>
                                <div className="relative">
                                    <ResponsiveContainer width="100%" height={250}>
                                        <PieChart>
                                            <Pie
                                                data={spendingData.slice(0, 6)}
                                                cx="50%"
                                                cy="50%"
                                                innerRadius={60}
                                                outerRadius={100}
                                                paddingAngle={2}
                                                dataKey="amount"
                                            >
                                                {spendingData.slice(0, 6).map((entry, index) => (
                                                    <Cell key={`cell-${index}`} fill={entry.color} />
                                                ))}
                                            </Pie>
                                            <Tooltip 
                                                formatter={(value: any) => [formatCurrency(value), 'Amount']}
                                                labelFormatter={(label: any) => `${label}`}
                                                contentStyle={{
                                                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                                                    border: 'none',
                                                    borderRadius: '8px',
                                                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                                                }}
                                            />
                                        </PieChart>
                                    </ResponsiveContainer>
                                    
                                    {/* Center text */}
                                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                        <div className="text-center">
                                            <div className="text-lg font-bold text-gray-900">{formatCurrency(summary.expenses)}</div>
                                            <div className="text-xs text-gray-500">Total Spent</div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Monthly Trends */}
                            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                                <h3 className="text-lg font-semibold mb-4">Income vs Expenses</h3>
                                <ResponsiveContainer width="100%" height={250}>
                                    <BarChart data={monthlyTrendsData.slice(-6)}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                                        <XAxis 
                                            dataKey="month" 
                                            tick={{ fontSize: 12 }}
                                            stroke="#6b7280"
                                        />
                                        <YAxis 
                                            tick={{ fontSize: 12 }}
                                            stroke="#6b7280"
                                            tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                                        />
                                        <Tooltip 
                                            formatter={(value: any, name: string) => [
                                                formatCurrency(value), 
                                                name === 'income' ? 'Income' : name === 'expenses' ? 'Expenses' : 'Net Income'
                                            ]}
                                            contentStyle={{
                                                backgroundColor: 'rgba(255, 255, 255, 0.95)',
                                                border: 'none',
                                                borderRadius: '8px',
                                                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                                            }}
                                        />
                                        <Bar dataKey="income" fill="#10b981" radius={[2, 2, 0, 0]} />
                                        <Bar dataKey="expenses" fill="#ef4444" radius={[2, 2, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        {/* Detailed Analytics Grid */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {/* Top Categories List */}
                            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                                <div className="flex items-center justify-between mb-6">
                                    <h3 className="text-lg font-semibold">Top Spending Categories</h3>
                                    <span className="text-sm text-gray-500">{getPeriodText()}</span>
                                </div>
                                <div className="space-y-4">
                                    {spendingData.slice(0, 6).map((category, index) => (
                                        <div key={category.category} className="flex items-center space-x-4 p-3 rounded-lg hover:bg-gray-50 transition-colors">
                                            <div className="flex-shrink-0">
                                                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${category.color}20` }}>
                                                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: category.color }} />
                                                </div>
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center justify-between">
                                                    <h4 className="text-sm font-medium text-gray-900 truncate">{category.category}</h4>
                                                    <span className="text-sm font-semibold text-gray-900">{formatCurrency(category.amount)}</span>
                                                </div>
                                                <div className="flex items-center justify-between mt-1">
                                                    <div className="flex-1 bg-gray-200 rounded-full h-1.5 mr-3">
                                                        <div 
                                                            className="h-1.5 rounded-full transition-all duration-300"
                                                            style={{ 
                                                                width: `${category.percentage}%`,
                                                                backgroundColor: category.color 
                                                            }}
                                                        />
                                                    </div>
                                                    <span className="text-xs text-gray-500">{formatPercentage(category.percentage)}</span>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Key Metrics */}
                            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                                <h3 className="text-lg font-semibold mb-6">Key Financial Metrics</h3>
                                <div className="space-y-6">
                                    <div className="flex items-center justify-between p-4 bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg border border-green-100">
                                        <div className="flex items-center space-x-3">
                                            <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                                                <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 11l5-5m0 0l5 5m-5-5v12" />
                                                </svg>
                                            </div>
                                            <div>
                                                <h4 className="text-sm font-medium text-gray-900">Total Income</h4>
                                                <p className="text-xs text-gray-600">{summary.incomeCount} transactions</p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-lg font-bold text-green-600">{formatCurrency(summary.income)}</div>
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between p-4 bg-gradient-to-r from-red-50 to-rose-50 rounded-lg border border-red-100">
                                        <div className="flex items-center space-x-3">
                                            <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center">
                                                <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 13l-5 5m0 0l-5-5m5 5V6" />
                                                </svg>
                                            </div>
                                            <div>
                                                <h4 className="text-sm font-medium text-gray-900">Total Expenses</h4>
                                                <p className="text-xs text-gray-600">{summary.expenseCount} transactions</p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-lg font-bold text-red-600">{formatCurrency(summary.expenses)}</div>
                                        </div>
                                    </div>

                                    <div className={`flex items-center justify-between p-4 rounded-lg border ${summary.netAmount >= 0 ? 'bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-100' : 'bg-gradient-to-r from-orange-50 to-red-50 border-orange-100'}`}>
                                        <div className="flex items-center space-x-3">
                                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${summary.netAmount >= 0 ? 'bg-blue-100' : 'bg-orange-100'}`}>
                                                <svg className={`w-5 h-5 ${summary.netAmount >= 0 ? 'text-blue-600' : 'text-orange-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                                                </svg>
                                            </div>
                                            <div>
                                                <h4 className="text-sm font-medium text-gray-900">Net Amount</h4>
                                                <p className="text-xs text-gray-600">{summary.netAmount >= 0 ? 'Positive' : 'Deficit'}</p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <div className={`text-lg font-bold ${summary.netAmount >= 0 ? 'text-blue-600' : 'text-orange-600'}`}>
                                                {formatCurrency(summary.netAmount)}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="pt-4 border-t border-gray-100">
                                        <div className="flex justify-between text-sm text-gray-600 mb-2">
                                            <span>Active Categories</span>
                                            <span className="font-medium text-gray-900">{spendingData.length}</span>
                                        </div>
                                        <div className="flex justify-between text-sm text-gray-600">
                                            <span>Avg. per Transaction</span>
                                            <span className="font-medium text-gray-900">
                                                {formatCurrency(summary.expenseCount > 0 ? summary.expenses / summary.expenseCount : 0)}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Spending Tab */}
                {activeTab === 'spending' && (
                    <div className="space-y-6">
                        {/* Spending Overview */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {/* Spending Chart */}
                            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                                <h3 className="text-lg font-semibold mb-4">Spending by Category</h3>
                                <ResponsiveContainer width="100%" height={400}>
                                    <PieChart>
                                        <Pie
                                            data={spendingData}
                                            cx="50%"
                                            cy="50%"
                                            labelLine={false}
                                            label={({ category, percentage }: any) => 
                                                percentage > 5 ? `${category} (${percentage.toFixed(1)}%)` : ''
                                            }
                                            outerRadius={150}
                                            fill="#8884d8"
                                            dataKey="amount"
                                        >
                                            {spendingData.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={entry.color} />
                                            ))}
                                        </Pie>
                                        <Tooltip 
                                            formatter={(value: any) => [formatCurrency(value), 'Amount']}
                                            contentStyle={{
                                                backgroundColor: 'rgba(255, 255, 255, 0.95)',
                                                border: 'none',
                                                borderRadius: '8px',
                                                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                                            }}
                                        />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>

                            {/* Category Details */}
                            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                                <div className="flex items-center justify-between mb-6">
                                    <h3 className="text-lg font-semibold">Category Breakdown</h3>
                                    <span className="text-sm text-gray-500">
                                        {spendingData.length} categories
                                    </span>
                                </div>
                                <div className="space-y-3 max-h-96 overflow-y-auto">
                                    {spendingData.map((category, index) => (
                                        <div key={category.category} className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 transition-colors">
                                            <div className="flex items-center space-x-3">
                                                <div className="flex items-center justify-center w-8 h-8 rounded-lg" style={{ backgroundColor: `${category.color}20` }}>
                                                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: category.color }} />
                                                </div>
                                                <div>
                                                    <h4 className="text-sm font-medium text-gray-900">{category.category}</h4>
                                                    <p className="text-xs text-gray-500">{category.transactionCount} transactions</p>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <div className="text-sm font-semibold text-gray-900">{formatCurrency(category.amount)}</div>
                                                <div className="text-xs text-gray-500">{formatPercentage(category.percentage)}</div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Trends Tab */}
                {activeTab === 'trends' && (
                    <div className="space-y-6">
                        {/* Monthly Trends */}
                        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                            <div className="flex items-center justify-between mb-6">
                                <div>
                                    <h3 className="text-lg font-semibold">Income vs Expenses Trend</h3>
                                    <p className="text-sm text-gray-500 mt-1">Last 6 months comparison</p>
                                </div>
                            </div>
                            <ResponsiveContainer width="100%" height={400}>
                                <LineChart data={monthlyTrendsData}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                                    <XAxis 
                                        dataKey="month" 
                                        tick={{ fontSize: 12 }}
                                        stroke="#6b7280"
                                    />
                                    <YAxis 
                                        tick={{ fontSize: 12 }}
                                        stroke="#6b7280"
                                        tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                                    />
                                    <Tooltip 
                                        formatter={(value: any, name: string) => [
                                            formatCurrency(value), 
                                            name === 'income' ? 'Income' : name === 'expenses' ? 'Expenses' : 'Net Income'
                                        ]}
                                        contentStyle={{
                                            backgroundColor: 'rgba(255, 255, 255, 0.95)',
                                            border: 'none',
                                            borderRadius: '8px',
                                            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                                        }}
                                    />
                                    <Legend />
                                    <Line 
                                        type="monotone" 
                                        dataKey="income" 
                                        stroke="#10b981" 
                                        strokeWidth={3}
                                        dot={{ fill: '#10b981', strokeWidth: 2, r: 4 }}
                                        name="Income"
                                    />
                                    <Line 
                                        type="monotone" 
                                        dataKey="expenses" 
                                        stroke="#ef4444" 
                                        strokeWidth={3}
                                        dot={{ fill: '#ef4444', strokeWidth: 2, r: 4 }}
                                        name="Expenses"
                                    />
                                    <Line 
                                        type="monotone" 
                                        dataKey="netIncome" 
                                        stroke="#3b82f6" 
                                        strokeWidth={2}
                                        strokeDasharray="5 5"
                                        dot={{ fill: '#3b82f6', strokeWidth: 2, r: 3 }}
                                        name="Net Income"
                                    />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>

                        {/* Trend Insights */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                                <div className="flex items-center space-x-3 mb-4">
                                    <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                                        <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                                        </svg>
                                    </div>
                                    <h4 className="text-lg font-semibold">Income Trend</h4>
                                </div>
                                <div className="text-2xl font-bold text-green-600 mb-2">
                                    +{formatPercentage(
                                        monthlyTrendsData.length >= 2 
                                            ? ((monthlyTrendsData[monthlyTrendsData.length - 1]?.income - monthlyTrendsData[monthlyTrendsData.length - 2]?.income) / monthlyTrendsData[monthlyTrendsData.length - 2]?.income * 100) || 0
                                            : 0
                                    )}
                                </div>
                                <p className="text-sm text-gray-600">vs last month</p>
                            </div>

                            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                                <div className="flex items-center space-x-3 mb-4">
                                    <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center">
                                        <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
                                        </svg>
                                    </div>
                                    <h4 className="text-lg font-semibold">Expense Trend</h4>
                                </div>
                                <div className="text-2xl font-bold text-red-600 mb-2">
                                    +{formatPercentage(
                                        monthlyTrendsData.length >= 2 
                                            ? ((monthlyTrendsData[monthlyTrendsData.length - 1]?.expenses - monthlyTrendsData[monthlyTrendsData.length - 2]?.expenses) / monthlyTrendsData[monthlyTrendsData.length - 2]?.expenses * 100) || 0
                                            : 0
                                    )}
                                </div>
                                <p className="text-sm text-gray-600">vs last month</p>
                            </div>

                            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                                <div className="flex items-center space-x-3 mb-4">
                                    <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                                        <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                                        </svg>
                                    </div>
                                    <h4 className="text-lg font-semibold">Best Month</h4>
                                </div>
                                <div className="text-lg font-bold text-blue-600 mb-2">
                                    {monthlyTrendsData.length > 0 
                                        ? monthlyTrendsData.reduce((best, current) => 
                                            current.netIncome > best.netIncome ? current : best
                                        ).month
                                        : 'N/A'
                                    }
                                </div>
                                <p className="text-sm text-gray-600">highest net income</p>
                            </div>
                        </div>
                    </div>
                )}

                {/* Cash Flow Tab */}
                {activeTab === 'cashflow' && (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                        <CustomSankeyFlow
                            income={summary.income}
                            savings={summary.netAmount}
                            flows={spendingData}
                            formatCurrency={formatCurrency}
                        />
                    </div>
                )}

                {/* Smart Insights Tab */}
                {activeTab === 'insights' && (
                    <div className="space-y-6">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {/* AI Insights */}
                            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                                <div className="flex items-center space-x-3 mb-6">
                                    <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                                        <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                                        </svg>
                                    </div>
                                    <h3 className="text-lg font-semibold">Smart Insights</h3>
                                </div>
                                <div className="space-y-4">
                                    {/* Generate insights based on data */}
                                    {summary.netAmount < 0 && (
                                        <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                                            <h4 className="text-sm font-medium text-red-800 mb-2">⚠️ Spending Alert</h4>
                                            <p className="text-sm text-red-700">
                                                You're spending more than you earn this period. Consider reviewing your top expense categories.
                                            </p>
                                        </div>
                                    )}
                                    
                                    {spendingData.length > 0 && spendingData[0].percentage > 40 && (
                                        <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                                            <h4 className="text-sm font-medium text-yellow-800 mb-2">💡 Category Focus</h4>
                                            <p className="text-sm text-yellow-700">
                                                {spendingData[0].category} represents {formatPercentage(spendingData[0].percentage)} of your spending. 
                                                Consider setting a budget for this category.
                                            </p>
                                        </div>
                                    )}
                                    
                                    {summary.netAmount > 0 && (summary.netAmount / summary.income) > 0.2 && (
                                        <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                                            <h4 className="text-sm font-medium text-green-800 mb-2">🎉 Great Savings</h4>
                                            <p className="text-sm text-green-700">
                                                Excellent! You're saving {formatPercentage((summary.netAmount / summary.income) * 100)} of your income. 
                                                Keep up the great work!
                                            </p>
                                        </div>
                                    )}
                                    
                                    {spendingData.length < 3 && (
                                        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                                            <h4 className="text-sm font-medium text-blue-800 mb-2">📊 Spending Diversity</h4>
                                            <p className="text-sm text-blue-700">
                                                Your spending is concentrated in few categories. Consider reviewing if this reflects your priorities.
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Recommendations */}
                            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                                <div className="flex items-center space-x-3 mb-6">
                                    <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                                        <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 12v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                                        </svg>
                                    </div>
                                    <h3 className="text-lg font-semibold">Recommendations</h3>
                                </div>
                                <div className="space-y-4">
                                    <div className="flex items-start space-x-3 p-3 rounded-lg bg-gray-50">
                                        <div className="w-6 h-6 bg-green-100 rounded-full flex items-center justify-center mt-0.5">
                                            <span className="text-xs font-medium text-green-600">1</span>
                                        </div>
                                        <div>
                                            <h4 className="text-sm font-medium text-gray-900">Set Category Budgets</h4>
                                            <p className="text-sm text-gray-600 mt-1">
                                                Create budgets for your top {Math.min(3, spendingData.length)} spending categories to track your goals.
                                            </p>
                                        </div>
                                    </div>
                                    
                                    <div className="flex items-start space-x-3 p-3 rounded-lg bg-gray-50">
                                        <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center mt-0.5">
                                            <span className="text-xs font-medium text-blue-600">2</span>
                                        </div>
                                        <div>
                                            <h4 className="text-sm font-medium text-gray-900">Review Transactions</h4>
                                            <p className="text-sm text-gray-600 mt-1">
                                                Regularly categorize and add notes to transactions for better insights.
                                            </p>
                                        </div>
                                    </div>
                                    
                                    <div className="flex items-start space-x-3 p-3 rounded-lg bg-gray-50">
                                        <div className="w-6 h-6 bg-purple-100 rounded-full flex items-center justify-center mt-0.5">
                                            <span className="text-xs font-medium text-purple-600">3</span>
                                        </div>
                                        <div>
                                            <h4 className="text-sm font-medium text-gray-900">Track Progress</h4>
                                            <p className="text-sm text-gray-600 mt-1">
                                                Check your financial health score monthly to stay on track with your goals.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Top Merchants Tab */}
                {activeTab === 'merchants' && (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-lg font-semibold">Top Merchants</h3>
                            <span className="text-sm text-gray-500">{getPeriodText()}</span>
                        </div>
                        
                        {merchants.length > 0 ? (
                            <div className="space-y-4">
                                {merchants.slice(0, 10).map((merchant, index) => (
                                    <div key={merchant.name} className="flex items-center justify-between p-4 rounded-lg hover:bg-gray-50 transition-colors">
                                        <div className="flex items-center space-x-4">
                                            <div className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center">
                                                <span className="text-sm font-medium text-gray-600">#{index + 1}</span>
                                            </div>
                                            <div>
                                                <h4 className="text-sm font-medium text-gray-900">{merchant.name}</h4>
                                                <p className="text-xs text-gray-500">
                                                    {merchant.transactionCount} transactions • Avg: {formatCurrency(merchant.averageSpent)}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-sm font-semibold text-gray-900">{formatCurrency(merchant.totalSpent)}</div>
                                            <div className="text-xs text-gray-500">
                                                {merchant.categories.slice(0, 2).join(', ')}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-center py-8 text-gray-500">
                                <div className="text-4xl mb-4">🏪</div>
                                <h4 className="text-lg font-medium text-gray-900 mb-2">No merchant data</h4>
                                <p>Merchant analysis will appear as you add more transactions.</p>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </SidebarLayout>
    );
};

export default InsightsPage;
