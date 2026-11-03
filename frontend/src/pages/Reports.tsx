import React, { useState, useEffect, useMemo, useRef } from 'react';
import SidebarLayout from '../components/layout/SidebarLayout';
import CustomSankeyFlow from '../components/charts/sankey';
import { transactionAPI } from '../services/api';
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
    Legend
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

// Custom Sankey-style Flow Chart Component
const CashFlowChart: React.FC<{
    income: number;
    expenses: CategoryData[];
    savings: number;
    className?: string;
}> = ({ income, expenses, savings, className = "" }) => {
    const svgRef = useRef<SVGSVGElement>(null);

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        }).format(amount);
    };

    const formatPercentage = (percentage: number) => {
        return `${percentage.toFixed(1)}%`;
    };

    return (
        <div className={`bg-gradient-to-r from-blue-50 to-green-50 rounded-lg p-6 ${className}`}>
            {/* Header */}
            <div className="text-center mb-8">
                <h3 className="text-2xl font-bold text-gray-800 mb-2">Cash Flow Breakdown</h3>
                <p className="text-gray-600">How your income flows to expenses and savings</p>
            </div>

            {/* Main Flow Visualization */}
            <div className="relative">
                {/* Income Section */}
                <div className="flex justify-center mb-8">
                    <div className="bg-green-500 text-white rounded-lg px-8 py-6 shadow-lg">
                        <div className="text-center">
                            <div className="text-sm opacity-90 mb-1">💰 TOTAL INCOME</div>
                            <div className="text-3xl font-bold">{formatCurrency(income)}</div>
                            <div className="text-sm opacity-90 mt-1">100%</div>
                        </div>
                    </div>
                </div>

                {/* Flow Lines */}
                <div className="relative mb-8">
                    <svg 
                        className="absolute inset-0 w-full h-24" 
                        style={{ zIndex: 1 }}
                        preserveAspectRatio="none"
                    >
                        <defs>
                            <linearGradient id="flowGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                                <stop offset="0%" stopColor="#10b981" stopOpacity="0.8"/>
                                <stop offset="100%" stopColor="#6366f1" stopOpacity="0.6"/>
                            </linearGradient>
                        </defs>
                        {/* Main flow line */}
                        <path
                            d="M 50% 0 Q 50% 50 20% 100 M 50% 0 Q 50% 50 80% 100"
                            stroke="url(#flowGradient)"
                            strokeWidth="4"
                            fill="none"
                            opacity="0.7"
                        />
                        {/* Multiple flow lines for visual effect */}
                        {expenses.slice(0, 6).map((_, index) => (
                            <path
                                key={index}
                                d={`M 50% 0 Q 50% 50 ${20 + index * 12}% 100`}
                                stroke="url(#flowGradient)"
                                strokeWidth="2"
                                fill="none"
                                opacity="0.5"
                            />
                        ))}
                    </svg>
                </div>

                {/* Expenses and Savings Section */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Expenses */}
                    <div>
                        <h4 className="text-lg font-semibold text-gray-700 mb-4 text-center">
                            💸 Expenses ({formatCurrency(expenses.reduce((sum, e) => sum + e.amount, 0))})
                        </h4>
                        <div className="space-y-3">
                            {expenses.slice(0, 6).map((expense, index) => (
                                <div 
                                    key={expense.category}
                                    className="bg-white rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow"
                                >
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center space-x-3">
                                            <div 
                                                className="w-4 h-4 rounded-full"
                                                style={{ backgroundColor: expense.color }}
                                            />
                                            <span className="font-medium text-gray-700">{expense.category}</span>
                                        </div>
                                        <div className="text-right">
                                            <div className="font-bold text-red-600">
                                                {formatCurrency(expense.amount)}
                                            </div>
                                            <div className="text-xs text-gray-500">
                                                {formatPercentage(expense.percentage)}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="w-full bg-gray-200 rounded-full h-2">
                                        <div
                                            className="h-2 rounded-full transition-all duration-500"
                                            style={{ 
                                                width: `${Math.min(expense.percentage, 100)}%`,
                                                backgroundColor: expense.color
                                            }}
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Savings */}
                    <div>
                        <h4 className="text-lg font-semibold text-gray-700 mb-4 text-center">
                            💰 Financial Position
                        </h4>
                        <div className="space-y-4">
                            {savings > 0 ? (
                                <div className="bg-green-100 border border-green-300 rounded-lg p-6 text-center">
                                    <div className="text-4xl mb-2">🎯</div>
                                    <div className="text-2xl font-bold text-green-600 mb-1">
                                        {formatCurrency(savings)}
                                    </div>
                                    <div className="text-sm text-green-700 font-medium">Savings & Investments</div>
                                    <div className="text-xs text-green-600 mt-1">
                                        {formatPercentage((savings / income) * 100)} of income
                                    </div>
                                </div>
                            ) : (
                                <div className="bg-red-100 border border-red-300 rounded-lg p-6 text-center">
                                    <div className="text-4xl mb-2">⚠️</div>
                                    <div className="text-2xl font-bold text-red-600 mb-1">
                                        {formatCurrency(Math.abs(savings))}
                                    </div>
                                    <div className="text-sm text-red-700 font-medium">Over Budget</div>
                                    <div className="text-xs text-red-600 mt-1">
                                        {formatPercentage((Math.abs(savings) / income) * 100)} deficit
                                    </div>
                                </div>
                            )}

                            {/* Summary Stats */}
                            <div className="bg-blue-50 rounded-lg p-4">
                                <div className="text-center">
                                    <div className="text-sm text-blue-600 font-medium mb-2">Expense Ratio</div>
                                    <div className="text-xl font-bold text-blue-700">
                                        {formatPercentage((expenses.reduce((sum, e) => sum + e.amount, 0) / income) * 100)}
                                    </div>
                                    <div className="text-xs text-blue-600 mt-1">of total income</div>
                                </div>
                            </div>

                            <div className="bg-purple-50 rounded-lg p-4">
                                <div className="text-center">
                                    <div className="text-sm text-purple-600 font-medium mb-2">Categories</div>
                                    <div className="text-xl font-bold text-purple-700">
                                        {expenses.length}
                                    </div>
                                    <div className="text-xs text-purple-600 mt-1">expense types</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const ReportsPage: React.FC = () => {
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [summary, setSummary] = useState<TransactionSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedPeriod, setSelectedPeriod] = useState('30'); // days

    // Tab state
    const [activeTab, setActiveTab] = useState<
        'cashflow' | 'spending' | 'income'
    >('cashflow');

    useEffect(() => {
        fetchReportsData();
    }, [selectedPeriod]);

    const fetchReportsData = async () => {
        try {
            setLoading(true);
            setError(null);

            // Calculate date range
            const endDate = new Date().toISOString().split('T')[0];
            const startDate = new Date(
                Date.now() - parseInt(selectedPeriod) * 24 * 60 * 60 * 1000
            ).toISOString().split('T')[0];

            const response = await transactionAPI.getTransactions({
                dateFrom: startDate,
                dateTo: endDate,
                limit: 1000,
            });

            setTransactions(response.transactions);
            setSummary(response.summary);
        } catch (err: any) {
            console.error('Error fetching reports data:', err);
            setError(err.response?.data?.error || 'Failed to fetch reports data');
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
            <SidebarLayout title="Reports">
                <div className="flex justify-center items-center h-64">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                    <span className="ml-3">Loading reports...</span>
                </div>
            </SidebarLayout>
        );
    }

    if (error) {
        return (
            <SidebarLayout title="Reports">
                <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
                    {error}
                    <button 
                        onClick={fetchReportsData}
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
            <SidebarLayout title="Reports">
                <div className="text-center py-8 text-gray-500">
                    <div className="text-6xl mb-4">📊</div>
                    <h3 className="text-lg font-medium text-gray-900 mb-2">No data available</h3>
                    <p>No transactions found for the selected period.</p>
                    <p className="text-sm mt-2">
                        Connect your bank account and wait for transactions to sync.
                    </p>
                </div>
            </SidebarLayout>
        );
    }

    return (
        <SidebarLayout title="Financial Reports">
            <div className="space-y-6">
                {/* Header with Tabs and Controls */}
                <div className="bg-white rounded-lg shadow">
                    <div className="flex items-center justify-between px-6 py-4 border-b">
                        <div className="flex space-x-8">
                            <button
                                onClick={() => setActiveTab('cashflow')}
                                className={`pb-2 px-1 border-b-2 font-medium text-sm ${
                                    activeTab === 'cashflow'
                                        ? 'border-orange-500 text-orange-600'
                                        : 'border-transparent text-gray-500 hover:text-gray-700'
                                }`}
                            >
                                Cash Flow
                            </button>
                            <button
                                onClick={() => setActiveTab('spending')}
                                className={`pb-2 px-1 border-b-2 font-medium text-sm ${
                                    activeTab === 'spending'
                                        ? 'border-orange-500 text-orange-600'
                                        : 'border-transparent text-gray-500 hover:text-gray-700'
                                }`}
                            >
                                Spending Analysis
                            </button>
                            <button
                                onClick={() => setActiveTab('income')}
                                className={`pb-2 px-1 border-b-2 font-medium text-sm ${
                                    activeTab === 'income'
                                        ? 'border-orange-500 text-orange-600'
                                        : 'border-transparent text-gray-500 hover:text-gray-700'
                                }`}
                            >
                                Income
                            </button>
                        </div>

                        <div className="flex items-center space-x-4">
                            <select
                                value={selectedPeriod}
                                onChange={(e) => setSelectedPeriod(e.target.value)}
                                className="border border-gray-300 rounded-md px-3 py-1 text-sm"
                            >
                                <option value="7">Last 7 Days</option>
                                <option value="30">Last 30 Days</option>
                                <option value="90">Last 3 Months</option>
                                <option value="365">Last 12 Months</option>
                            </select>
                        </div>
                    </div>
                </div>

                {/* Summary Cards */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                    <div className="bg-white rounded-lg shadow p-6 text-center">
                        <div className="text-2xl font-bold text-green-600 mb-2">
                            {formatCurrency(summary.income)}
                        </div>
                        <div className="text-sm text-gray-500">TOTAL INCOME</div>
                        <div className="text-xs text-gray-400 mt-1">{summary.incomeCount} transactions</div>
                    </div>

                    <div className="bg-white rounded-lg shadow p-6 text-center">
                        <div className="text-2xl font-bold text-red-600 mb-2">
                            {formatCurrency(summary.expenses)}
                        </div>
                        <div className="text-sm text-gray-500">TOTAL EXPENSES</div>
                        <div className="text-xs text-gray-400 mt-1">{summary.expenseCount} transactions</div>
                    </div>

                    <div className="bg-white rounded-lg shadow p-6 text-center">
                        <div className={`text-2xl font-bold mb-2 ${summary.netAmount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {formatCurrency(summary.netAmount)}
                        </div>
                        <div className="text-sm text-gray-500">NET INCOME</div>
                        <div className="text-xs text-gray-400 mt-1">{getPeriodText()}</div>
                    </div>

                    <div className="bg-white rounded-lg shadow p-6 text-center">
                        <div className="text-2xl font-bold text-purple-600 mb-2">
                            {summary.income > 0 ? formatPercentage((summary.netAmount / summary.income) * 100) : '0%'}
                        </div>
                        <div className="text-sm text-gray-500">SAVINGS RATE</div>
                        <div className="text-xs text-gray-400 mt-1">
                            {summary.netAmount >= 0 ? 'Positive' : 'Deficit'}
                        </div>
                    </div>
                </div>

                {/* Cash Flow Tab with D3 Sankey */}
                {activeTab === 'cashflow' && (
                    <CustomSankeyFlow
                        income={summary.income}
                        savings={summary.netAmount}
                        flows={spendingData}
                        formatCurrency={formatCurrency}
                    />
                )}

                {/* Spending Analysis Tab */}
                {activeTab === 'spending' && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Spending Pie Chart */}
                        <div className="bg-white rounded-lg shadow p-6">
                            <h2 className="text-lg font-semibold mb-4">Spending by Category</h2>
                            {spendingData.length > 0 ? (
                                <div className="h-80">
                                    <ResponsiveContainer>
                                        <PieChart>
                                            <Pie
                                                data={spendingData}
                                                cx="50%"
                                                cy="50%"
                                                outerRadius={100}
                                                dataKey="amount"
                                                label={({ category, percentage }: any) => 
                                                    percentage > 5 ? `${category} (${percentage.toFixed(1)}%)` : ''
                                                }
                                            >
                                                {spendingData.map((entry, index) => (
                                                    <Cell key={`cell-${index}`} fill={entry.color} />
                                                ))}
                                            </Pie>
                                            <Tooltip 
                                                formatter={(value: number) => [formatCurrency(value), 'Amount']}
                                            />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>
                            ) : (
                                <div className="h-80 flex items-center justify-center text-gray-500">
                                    No spending data available
                                </div>
                            )}
                        </div>

                        {/* Detailed Category List */}
                        <div className="bg-white rounded-lg shadow p-6">
                            <h2 className="text-lg font-semibold mb-4">Category Breakdown</h2>
                            <div className="space-y-4">
                                {spendingData.slice(0, 8).map((category, index) => (
                                    <div key={category.category} className="border-b border-gray-100 pb-3 last:border-b-0">
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="flex items-center space-x-3">
                                                <div 
                                                    className="w-4 h-4 rounded-full"
                                                    style={{ backgroundColor: category.color }}
                                                />
                                                <span className="font-medium">{category.category}</span>
                                            </div>
                                            <div className="text-right">
                                                <div className="font-bold text-gray-900">
                                                    {formatCurrency(category.amount)}
                                                </div>
                                                <div className="text-sm text-gray-500">
                                                    {formatPercentage(category.percentage)}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="w-full bg-gray-200 rounded-full h-2">
                                            <div
                                                className="h-2 rounded-full transition-all duration-300"
                                                style={{ 
                                                    width: `${category.percentage}%`,
                                                    backgroundColor: category.color
                                                }}
                                            />
                                        </div>
                                        <div className="text-xs text-gray-500 mt-1">
                                            {category.transactionCount} transactions
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* Income Tab */}
                {activeTab === 'income' && (
                    <div className="bg-white rounded-lg shadow p-6">
                        <h2 className="text-lg font-semibold mb-6">Income Analysis</h2>
                        <div className="text-center py-12">
                            <div className="text-6xl mb-4">💰</div>
                            <div className="text-4xl font-bold text-green-600 mb-2">
                                {formatCurrency(summary.income)}
                            </div>
                            <div className="text-gray-500 mb-4">Total Income - {getPeriodText()}</div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
                                <div className="bg-green-50 p-4 rounded-lg">
                                    <div className="text-2xl font-bold text-green-600">
                                        {summary.incomeCount}
                                    </div>
                                    <div className="text-sm text-gray-600">Income Transactions</div>
                                </div>
                                <div className="bg-blue-50 p-4 rounded-lg">
                                    <div className="text-2xl font-bold text-blue-600">
                                        {summary.incomeCount > 0 ? formatCurrency(summary.income / summary.incomeCount) : '$0'}
                                    </div>
                                    <div className="text-sm text-gray-600">Average per Transaction</div>
                                </div>
                                <div className="bg-purple-50 p-4 rounded-lg">
                                    <div className="text-2xl font-bold text-purple-600">
                                        {summary.income > 0 ? formatPercentage((summary.netAmount / summary.income) * 100) : '0%'}
                                    </div>
                                    <div className="text-sm text-gray-600">Savings Rate</div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </SidebarLayout>
    );
};

export default ReportsPage;