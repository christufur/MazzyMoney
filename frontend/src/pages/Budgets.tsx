import React, { useState, useEffect } from 'react';
import SidebarLayout from '../components/layout/SidebarLayout';
import { budgetAPI, categoryAPI, BudgetAlert } from '../services/api';

export interface Budget {
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

export interface CreateBudgetRequest {
  name: string;
  category: string;
  amount: number;
  period: 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  startDate?: string;
}

export interface UpdateBudgetRequest {
  name?: string;
  category?: string;
  amount?: number;
  period?: 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  startDate?: string;
  endDate?: string;
}

export interface BudgetFormData {
  name: string;
  category: string;
  amount: string; // Keep as string for better form handling
  period: 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
}

const describeAlert = (alert: BudgetAlert) => {
  switch (alert.alertType) {
    case 'BUDGET_EXCEEDED':
      return 'Budget exceeded';
    case 'BUDGET_APPROACHING':
      return 'Approaching budget';
    case 'SPENDING_THRESHOLD':
    default:
      return 'Spending threshold';
  }
};

const BudgetPage: React.FC = () => {
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingBudget, setEditingBudget] = useState<Budget | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [formData, setFormData] = useState<BudgetFormData>({
    name: '',
    category: '',
    amount: '',
    period: 'MONTHLY'
  });
  const [categories, setCategories] = useState<string[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(true);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [selectedBudgetAlerts, setSelectedBudgetAlerts] = useState<Record<string, BudgetAlert[]>>({});
  const [alertModalBudget, setAlertModalBudget] = useState<Budget | null>(null);
  const [alertForm, setAlertForm] = useState({
    thresholdPercent: '90',
    alertType: 'BUDGET_APPROACHING' as BudgetAlert['alertType'],
    emailEnabled: true,
    isEnabled: true
  });
  const [alertError, setAlertError] = useState<string | null>(null);
  const [savingAlert, setSavingAlert] = useState(false);
  const [savingToggle, setSavingToggle] = useState<string | null>(null);

  // Fetch categories and budgets
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setLoadingCategories(true);
        
        // Fetch categories and budgets in parallel
        const [categoriesResponse, budgetsResponse] = await Promise.all([
          fetchCategories(),
          budgetAPI.getBudgets()
        ]);
        
        setCategories(categoriesResponse);
        setBudgets(budgetsResponse.budgets);
        const alertsByBudget: Record<string, BudgetAlert[]> = {};
        budgetsResponse.budgets.forEach((budget: Budget) => {
          alertsByBudget[budget.id] = budget.budgetAlerts || [];
        });
        setSelectedBudgetAlerts(alertsByBudget);
      } catch (err: any) {
        setError(err.response?.data?.error || 'Failed to fetch data');
      } finally {
        setLoading(false);
        setLoadingCategories(false);
      }
    };

    fetchData();
  }, []);

  // Fetch the one display-category list from /api/categories (W2.6).
  // /api/transactions/categories returns an array of spending rows, not { categories }.
  const fetchCategories = async (): Promise<string[]> => {
    try {
      const response = await categoryAPI.getAll();
      return [...(response.categories ?? [])].sort();
    } catch (error) {
      console.error('Failed to fetch categories:', error);
      return [];
    }
  };

  // Refresh categories manually
  const refreshCategories = async () => {
    try {
      setLoadingCategories(true);
      const newCategories = await fetchCategories();
      setCategories(newCategories);
    } catch (error) {
      console.error('Failed to refresh categories:', error);
    } finally {
      setLoadingCategories(false);
    }
  };

  // Create budget handler
  const handleCreateBudget = async (budgetData: CreateBudgetRequest) => {
    try {
      const response = await budgetAPI.createBudget(budgetData);
      setBudgets(prev => [response.budget, ...prev]);
      setSelectedBudgetAlerts(prev => ({
        ...prev,
        [response.budget.id]: response.budget.budgetAlerts || []
      }));
      
      // Refresh categories to include new category if it doesn't exist
      if (!categories.includes(budgetData.category)) {
        const updatedCategories = [...categories, budgetData.category].sort();
        setCategories(updatedCategories);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to create budget');
    }
  };

  // update budget handler
  const handleUpdateBudget = async (id: string, budgetData: UpdateBudgetRequest) => {
    try{
      const response = await budgetAPI.updateBudget(id, budgetData);
      setBudgets(prev => prev.map(b => b.id === id ? response.budget : b));
      setSelectedBudgetAlerts(prev => ({
        ...prev,
        [id]: response.budget.budgetAlerts || []
      }));
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to update budget');
    }
    };

    // delete budget handler
    const handleDeleteBudget = async (id: string) => {
      try {
        await budgetAPI.deleteBudget(id);
        setBudgets(prev => prev.filter(b => b.id !== id));
      } catch (err: any) {
        setError(err.response?.data?.error || 'Failed to delete budget');
      }
    };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  const getBudgetStatus = (percentUsed: number) => {
    if (percentUsed <= 70) return { color: 'text-green-600', bg: 'bg-green-100', label: 'On Track' };
    if (percentUsed <= 90) return { color: 'text-yellow-600', bg: 'bg-yellow-100', label: 'Warning' };
    if (percentUsed <= 100) return { color: 'text-orange-600', bg: 'bg-orange-100', label: 'Near Limit' };
    return { color: 'text-red-600', bg: 'bg-red-100', label: 'Over Budget' };
  };

  const getProgressBarColor = (percentUsed: number) => {
    if (percentUsed <= 70) return 'bg-green-500';
    if (percentUsed <= 90) return 'bg-yellow-500';
    if (percentUsed <= 100) return 'bg-orange-500';
    return 'bg-red-500';
  };

  const validateForm = () => {
    const errors: Record<string, string> = {};

    if (!formData.name.trim()) {
      errors.name = 'Budget name is required';
    }

    if (!formData.category) {
      errors.category = 'Category is required';
    }

    if (!formData.amount || parseFloat(formData.amount) <= 0) {
      errors.amount = 'Budget amount must be greater than 0';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const resetForm = () => {
    setFormData({
      name: '',
      category: '',
      amount: '',
      period: 'MONTHLY'
    });
    setFormErrors({});
    setEditingBudget(null);
  };

  const openCreateForm = () => {
    resetForm();
    setShowCreateForm(true);
  };

  const openEditForm = (budget: Budget) => {
    setFormData({
      name: budget.name,
      category: budget.category,
      amount: budget.amount.toString(),
      period: budget.period
    });
    setFormErrors({});
    setEditingBudget(budget);
    setShowCreateForm(true);
  };

  const handleAmountChange = (value: string) => {
    // Allow empty string, numbers, and decimal points
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      setFormData(prev => ({ ...prev, amount: value }));
      
      // Clear amount error when user starts typing valid number
      if (formErrors.amount && parseFloat(value) > 0) {
        setFormErrors(prev => ({ ...prev, amount: '' }));
      }
    }
  };

  const handleAmountFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    // Clear the field if it's "0" when focused
    if (e.target.value === '0') {
      setFormData(prev => ({ ...prev, amount: '' }));
    }
  };

  const handleAmountBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    // If field is empty on blur, don't set it to 0
    if (e.target.value === '') {
      return;
    }
    
    // Format to 2 decimal places if it's a valid number
    const numValue = parseFloat(e.target.value);
    if (!isNaN(numValue) && numValue > 0) {
      setFormData(prev => ({ ...prev, amount: numValue.toFixed(2) }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    try {
      const submitData = {
        name: formData.name.trim(),
        category: formData.category,
        amount: parseFloat(formData.amount),
        period: formData.period
      };

      if (editingBudget) {
        // Update existing budget
        await handleUpdateBudget(editingBudget.id, submitData);
      } else {
        // Create new budget
        await handleCreateBudget(submitData);
      }
      
      setShowCreateForm(false);
      resetForm();
    } catch (error: any) {
      const errorMessage = error.response?.data?.error || `Failed to ${editingBudget ? 'update' : 'create'} budget`;
      
      // Handle specific error types
      if (errorMessage.includes('already have a')) {
        setFormErrors({ category: errorMessage });
      } else {
        setFormErrors({ general: errorMessage });
      }
    }
  };

  const handleDelete = async (budgetId: string) => {
    const budget = budgets.find(b => b.id === budgetId);
    if (!budget) return;

    const confirmed = window.confirm(
      `Are you sure you want to delete the "${budget.name}" budget? This action cannot be undone.`
    );

    if (!confirmed) return;

    try {
      setDeleting(budgetId);
      await handleDeleteBudget(budgetId);
    } catch (error: any) {
      alert(error.response?.data?.error || 'Failed to delete budget');
    } finally {
      setDeleting(null);
    }
  };

  const totalBudget = budgets.reduce((sum, b) => sum + b.amount, 0);
  const totalSpent = budgets.reduce((sum, b) => sum + b.spent, 0);
  const totalRemaining = totalBudget - totalSpent;

  if (loading) {
    return (
      <SidebarLayout>
        <div className="flex justify-center items-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <span className="ml-3">Loading budgets...</span>
        </div>
      </SidebarLayout>
    );
  }

  if (error) {
    return (
      <SidebarLayout>
        <div className="flex justify-center items-center h-64">
          <div className="text-center">
            <div className="text-red-500 text-lg mb-2">Error loading budgets</div>
            <div className="text-gray-600 mb-4">{error}</div>
            <button
              onClick={() => window.location.reload()}
              className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded"
            >
              Retry
            </button>
          </div>
        </div>
      </SidebarLayout>
    );
  }

  // Get category icon for better visual representation
  const getCategoryIcon = (category: string) => {
    const iconMap: Record<string, string> = {
      'Food & Dining': '🍽️',
      'Transportation': '🚗',
      'Shopping': '🛍️',
      'Entertainment': '🎬',
      'Bills & Utilities': '💡',
      'Healthcare': '🏥',
      'Travel': '✈️',
      'Housing': '🏠',
      'Personal Care': '💄',
      'Education': '📚',
      'Other': '📦'
    };
    return iconMap[category] || '📦';
  };

  // Calculate overall budget health
  const overallBudgetHealth = budgets.length > 0 ? totalSpent / totalBudget * 100 : 0;
  const budgetsOnTrack = budgets.filter(b => b.percentUsed <= 70).length;
  const budgetsOverspent = budgets.filter(b => b.percentUsed > 100).length;

  return (
    <SidebarLayout title="Budgets">
      <div className="space-y-6">
        {/* Budget Hero Section */}
        <div className="bg-gradient-to-r from-purple-600 to-blue-600 rounded-xl shadow-lg text-white p-8">
          <div className="text-center">
            <h2 className="text-2xl font-bold mb-2">Budget Overview</h2>
            <p className="text-purple-100 mb-6">Track your spending and achieve your financial goals</p>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="text-center">
                <div className="text-3xl font-bold mb-1">{formatCurrency(totalBudget)}</div>
                <div className="text-purple-100 text-sm">Total Budget</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold mb-1">{formatCurrency(totalSpent)}</div>
                <div className="text-purple-100 text-sm">Total Spent</div>
              </div>
              <div className="text-center">
                <div className={`text-3xl font-bold mb-1 ${totalRemaining >= 0 ? 'text-green-200' : 'text-red-200'}`}>
                  {formatCurrency(Math.abs(totalRemaining))}
                </div>
                <div className="text-purple-100 text-sm">
                  {totalRemaining >= 0 ? 'Remaining' : 'Over Budget'}
                </div>
              </div>
            </div>

            {/* Overall Progress Ring */}
            <div className="mt-6 flex justify-center">
              <div className="relative w-24 h-24">
                <svg className="w-24 h-24 transform -rotate-90" viewBox="0 0 100 100">
                  <circle
                    cx="50"
                    cy="50"
                    r="40"
                    stroke="rgba(255,255,255,0.2)"
                    strokeWidth="8"
                    fill="none"
                  />
                  <circle
                    cx="50"
                    cy="50"
                    r="40"
                    stroke="white"
                    strokeWidth="8"
                    fill="none"
                    strokeDasharray="251.3"
                    strokeDashoffset={251.3 - (overallBudgetHealth / 100) * 251.3}
                    className="transition-all duration-500"
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-lg font-bold">{overallBudgetHealth.toFixed(0)}%</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Budget Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500">Active Budgets</p>
                <p className="text-2xl font-bold text-gray-900">{budgets.length}</p>
              </div>
              <div className="p-3 bg-blue-100 rounded-lg">
                <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500">On Track</p>
                <p className="text-2xl font-bold text-green-600">{budgetsOnTrack}</p>
              </div>
              <div className="p-3 bg-green-100 rounded-lg">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500">Overspent</p>
                <p className="text-2xl font-bold text-red-600">{budgetsOverspent}</p>
              </div>
              <div className="p-3 bg-red-100 rounded-lg">
                <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.268 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500">Avg. Usage</p>
                <p className="text-2xl font-bold text-purple-600">
                  {budgets.length > 0 ? (budgets.reduce((sum, b) => sum + b.percentUsed, 0) / budgets.length).toFixed(0) : 0}%
                </p>
              </div>
              <div className="p-3 bg-purple-100 rounded-lg">
                <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
            </div>
          </div>
        </div>

        {/* Header with Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-4 sm:space-y-0">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Your Budgets</h2>
            <p className="text-gray-600 mt-1">Manage your spending by category</p>
          </div>
          <button
            onClick={openCreateForm}
            className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            Create Budget
          </button>
        </div>

        {/* Budget Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {budgets.map((budget) => {
            const status = getBudgetStatus(budget.percentUsed);
            const progressColor = getProgressBarColor(budget.percentUsed);
            const isDeleting = deleting === budget.id;
            const categoryIcon = getCategoryIcon(budget.category);
            
            // Calculate progress ring stroke offset
            const radius = 36;
            const circumference = 2 * Math.PI * radius;
            const progressOffset = circumference - (budget.percentUsed / 100) * circumference;
            
            return (
              <div key={budget.id} className={`bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-all duration-200 ${isDeleting ? 'opacity-50' : ''}`}>
                {/* Header */}
                <div className="flex items-start justify-between mb-6">
                  <div className="flex items-center space-x-3">
                    <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center text-xl">
                      {categoryIcon}
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">{budget.name}</h3>
                      <p className="text-sm text-gray-500">{budget.category} • {budget.period.toLowerCase()}</p>
                    </div>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${status.bg} ${status.color}`}>
                    {status.label}
                  </span>
                </div>

                {/* Progress Section */}
                <div className="flex items-center space-x-6 mb-6">
                  {/* Progress Ring */}
                  <div className="relative">
                    <svg className="w-20 h-20 transform -rotate-90" viewBox="0 0 100 100">
                      <circle
                        cx="50"
                        cy="50"
                        r={radius}
                        stroke="rgb(229, 231, 235)"
                        strokeWidth="8"
                        fill="none"
                      />
                      <circle
                        cx="50"
                        cy="50"
                        r={radius}
                        stroke={
                          budget.percentUsed <= 70 ? '#10b981' :
                          budget.percentUsed <= 90 ? '#f59e0b' :
                          budget.percentUsed <= 100 ? '#f97316' : '#ef4444'
                        }
                        strokeWidth="8"
                        fill="none"
                        strokeDasharray={circumference}
                        strokeDashoffset={progressOffset}
                        strokeLinecap="round"
                        className="transition-all duration-500"
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-lg font-bold text-gray-900">
                        {budget.percentUsed.toFixed(0)}%
                      </span>
                    </div>
                  </div>

                  {/* Budget Details */}
                  <div className="flex-1">
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-600">Spent</span>
                        <span className="text-lg font-semibold text-gray-900">
                          {formatCurrency(budget.spent)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-600">Budget</span>
                        <span className="text-sm text-gray-700">
                          {formatCurrency(budget.amount)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-600">Remaining</span>
                        <span className={`text-sm font-medium ${budget.remaining >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {budget.remaining >= 0 ? '' : '-'}{formatCurrency(Math.abs(budget.remaining))}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Insights Section */}
                <div className="mb-6">
                  {budget.percentUsed > 100 ? (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                      <div className="flex items-start space-x-2">
                        <svg className="w-4 h-4 text-red-500 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        <div>
                          <p className="text-sm font-medium text-red-800">Budget Exceeded</p>
                          <p className="text-xs text-red-600 mt-1">
                            You've spent {formatCurrency(budget.spent - budget.amount)} over your {budget.period.toLowerCase()} budget.
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : budget.percentUsed > 90 ? (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                      <div className="flex items-start space-x-2">
                        <svg className="w-4 h-4 text-yellow-500 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                        </svg>
                        <div>
                          <p className="text-sm font-medium text-yellow-800">Approaching Limit</p>
                          <p className="text-xs text-yellow-600 mt-1">
                            You have {formatCurrency(budget.remaining)} left for this {budget.period.toLowerCase()}.
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                      <div className="flex items-start space-x-2">
                        <svg className="w-4 h-4 text-green-500 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                        <div>
                          <p className="text-sm font-medium text-green-800">On Track</p>
                          <p className="text-xs text-green-600 mt-1">
                            Great job! You have {formatCurrency(budget.remaining)} remaining.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Alerts Summary */}
                {selectedBudgetAlerts[budget.id]?.length > 0 && (
                  <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <svg className="w-4 h-4 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-5 5-5-5h5v-5a7.5 7.5 0 0 0-15 0v5h5l-5 5-5-5h5V12a9.5 9.5 0 0 1 19 0v5z" />
                        </svg>
                        <span className="text-sm font-medium text-gray-700">
                          {selectedBudgetAlerts[budget.id].length} alert{selectedBudgetAlerts[budget.id].length !== 1 ? 's' : ''} active
                        </span>
                      </div>
                      <button
                        onClick={() => {
                          setAlertModalBudget(budget);
                          setAlertForm({
                            thresholdPercent: '90',
                            alertType: 'BUDGET_APPROACHING',
                            emailEnabled: true,
                            isEnabled: true
                          });
                          setAlertError(null);
                        }}
                        className="text-xs text-purple-600 hover:text-purple-700 font-medium"
                      >
                        Manage
                      </button>
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center justify-between pt-4 border-t border-gray-100">
                  <div className="flex space-x-3">
                    <button
                      onClick={() => openEditForm(budget)}
                      disabled={isDeleting}
                      className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50"
                    >
                      <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                      Edit
                    </button>
                    {selectedBudgetAlerts[budget.id]?.length === 0 && (
                      <button
                        onClick={() => {
                          setAlertModalBudget(budget);
                          setAlertForm({
                            thresholdPercent: '90',
                            alertType: 'BUDGET_APPROACHING',
                            emailEnabled: true,
                            isEnabled: true
                          });
                          setAlertError(null);
                        }}
                        disabled={isDeleting}
                        className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-purple-600 hover:text-purple-700 disabled:opacity-50"
                      >
                        <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-5 5-5-5h5v-5a7.5 7.5 0 0 0-15 0v5h5l-5 5-5-5h5V12a9.5 9.5 0 0 1 19 0v5z" />
                        </svg>
                        Add Alert
                      </button>
                    )}
                  </div>
                  <button
                    onClick={() => handleDelete(budget.id)}
                    disabled={isDeleting}
                    className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                  >
                    {isDeleting ? (
                      <>
                        <svg className="animate-spin w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Deleting...
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        Delete
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Create/Edit Budget Modal */}
        {showCreateForm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md">
              <h3 className="text-lg font-semibold mb-4">
                {editingBudget ? 'Edit Budget' : 'Create New Budget'}
              </h3>
              
              {formErrors.general && (
                <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
                  {formErrors.general}
                </div>
              )}
              
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Budget Name
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => {
                      setFormData(prev => ({ ...prev, name: e.target.value }));
                      if (formErrors.name) {
                        setFormErrors(prev => ({ ...prev, name: '' }));
                      }
                    }}
                    className={`w-full border rounded-md px-3 py-2 ${
                      formErrors.name ? 'border-red-500' : 'border-gray-300'
                    }`}
                    placeholder="e.g., Groceries, Entertainment"
                  />
                  {formErrors.name && (
                    <p className="text-red-500 text-sm mt-1">{formErrors.name}</p>
                  )}
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-sm font-medium text-gray-700">
                      Category
                    </label>
                    <button
                      type="button"
                      onClick={refreshCategories}
                      disabled={loadingCategories}
                      className="text-xs text-blue-600 hover:text-blue-800 disabled:text-gray-400"
                    >
                      {loadingCategories ? 'Refreshing...' : 'Refresh'}
                    </button>
                  </div>
                  <select
                    value={formData.category}
                    onChange={(e) => {
                      setFormData(prev => ({ ...prev, category: e.target.value }));
                      if (formErrors.category) {
                        setFormErrors(prev => ({ ...prev, category: '' }));
                      }
                    }}
                    disabled={loadingCategories}
                    className={`w-full border rounded-md px-3 py-2 ${
                      formErrors.category ? 'border-red-500' : 'border-gray-300'
                    } ${loadingCategories ? 'bg-gray-100' : ''}`}
                  >
                    <option value="">
                      {loadingCategories ? 'Loading categories...' : 'Select Category'}
                    </option>
                    {categories.map(category => (
                      <option key={category} value={category}>{category}</option>
                    ))}
                  </select>
                  {formErrors.category && (
                    <p className="text-red-500 text-sm mt-1">{formErrors.category}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Budget Amount
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">$</span>
                    <input
                      type="text"
                      value={formData.amount}
                      onChange={(e) => handleAmountChange(e.target.value)}
                      onFocus={handleAmountFocus}
                      onBlur={handleAmountBlur}
                      className={`w-full border rounded-md pl-8 pr-3 py-2 ${
                        formErrors.amount ? 'border-red-500' : 'border-gray-300'
                      }`}
                      placeholder="0.00"
                    />
                  </div>
                  {formErrors.amount && (
                    <p className="text-red-500 text-sm mt-1">{formErrors.amount}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Period
                  </label>
                  <select
                    value={formData.period}
                    onChange={(e) => setFormData(prev => ({ ...prev, period: e.target.value as 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY' }))}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                  >
                    <option value="WEEKLY">Weekly</option>
                    <option value="MONTHLY">Monthly</option>
                    <option value="QUARTERLY">Quarterly</option>
                    <option value="YEARLY">Yearly</option>
                  </select>
                </div>

                <div className="flex justify-end space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowCreateForm(false)}
                    className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-md"
                  >
                    {editingBudget ? 'Update Budget' : 'Create Budget'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {alertModalBudget && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold">Manage Alerts</h3>
                  <p className="text-sm text-gray-500">{alertModalBudget.name} ({alertModalBudget.category})</p>
                </div>
                <button
                  onClick={() => {
                    setAlertModalBudget(null);
                    setAlertError(null);
                  }}
                  className="text-gray-500 hover:text-gray-700"
                >
                  ✕
                </button>
              </div>

              {alertError && (
                <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
                  {alertError}
                </div>
              )}

              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!alertModalBudget) return;

                  try {
                    setSavingAlert(true);
                    setAlertError(null);
                    const response = await budgetAPI.createAlert(alertModalBudget.id, {
                      thresholdPercent: parseFloat(alertForm.thresholdPercent),
                      alertType: alertForm.alertType,
                      emailEnabled: alertForm.emailEnabled,
                      isEnabled: alertForm.isEnabled
                    });

                    setSelectedBudgetAlerts(prev => ({
                      ...prev,
                      [alertModalBudget.id]: [...(prev[alertModalBudget.id] || []), response.alert]
                    }));

                    setAlertForm({
                      thresholdPercent: '90',
                      alertType: 'BUDGET_APPROACHING',
                      emailEnabled: true,
                      isEnabled: true
                    });
                  } catch (err: any) {
                    setAlertError(err.response?.data?.error || 'Failed to save alert');
                  } finally {
                    setSavingAlert(false);
                  }
                }}
                className="space-y-4"
              >
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Alert Type</label>
                    <select
                      value={alertForm.alertType}
                      onChange={(e) => setAlertForm(prev => ({ ...prev, alertType: e.target.value as BudgetAlert['alertType'] }))}
                      className="w-full border border-gray-300 rounded-md px-3 py-2"
                    >
                      <option value="BUDGET_APPROACHING">Approaching budget</option>
                      <option value="BUDGET_EXCEEDED">Exceeded budget</option>
                      <option value="SPENDING_THRESHOLD">Custom threshold</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Threshold %</label>
                    <input
                      type="number"
                      min={0}
                      max={200}
                      value={alertForm.thresholdPercent}
                      onChange={(e) => setAlertForm(prev => ({ ...prev, thresholdPercent: e.target.value }))}
                      className="w-full border border-gray-300 rounded-md px-3 py-2"
                      required
                    />
                  </div>
                </div>

                <div className="flex items-center space-x-4">
                  <label className="flex items-center space-x-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={alertForm.isEnabled}
                      onChange={(e) => setAlertForm(prev => ({ ...prev, isEnabled: e.target.checked }))}
                    />
                    <span>Enabled</span>
                  </label>
                  <label className="flex items-center space-x-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={alertForm.emailEnabled}
                      onChange={(e) => setAlertForm(prev => ({ ...prev, emailEnabled: e.target.checked }))}
                    />
                    <span>Email notification</span>
                  </label>
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={savingAlert}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-md disabled:opacity-50"
                  >
                    {savingAlert ? 'Saving...' : 'Add Alert'}
                  </button>
                </div>
              </form>

              <div>
                <h4 className="text-sm font-medium text-gray-700 mb-2">Existing Alerts</h4>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {(selectedBudgetAlerts[alertModalBudget.id] || []).map(alert => (
                    <div key={alert.id} className="border border-gray-200 rounded-md p-3 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-800">
                          {describeAlert(alert)} • {alert.thresholdPercent}%
                        </p>
                        <div className="flex items-center space-x-3 mt-2">
                          <button
                            type="button"
                            onClick={async () => {
                              if (!alertModalBudget) return;
                              setSavingToggle(alert.id + '-enabled');
                              try {
                                const response = await budgetAPI.updateAlert(alertModalBudget.id, alert.id, {
                                  isEnabled: !alert.isEnabled
                                });
                                setSelectedBudgetAlerts(prev => ({
                                  ...prev,
                                  [alertModalBudget.id]: (prev[alertModalBudget.id] || []).map(a =>
                                    a.id === alert.id ? response.alert : a
                                  )
                                }));
                              } catch (err: any) {
                                setAlertError(err.response?.data?.error || 'Failed to update alert');
                              } finally {
                                setSavingToggle(null);
                              }
                            }}
                            className={`text-xs px-2 py-1 rounded ${alert.isEnabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
                            disabled={savingToggle === alert.id + '-enabled'}
                          >
                            {savingToggle === alert.id + '-enabled' ? 'Updating...' : alert.isEnabled ? 'Enabled' : 'Disabled'}
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              if (!alertModalBudget) return;
                              setSavingToggle(alert.id + '-email');
                              try {
                                const response = await budgetAPI.updateAlert(alertModalBudget.id, alert.id, {
                                  emailEnabled: !alert.emailEnabled
                                });
                                setSelectedBudgetAlerts(prev => ({
                                  ...prev,
                                  [alertModalBudget.id]: (prev[alertModalBudget.id] || []).map(a =>
                                    a.id === alert.id ? response.alert : a
                                  )
                                }));
                              } catch (err: any) {
                                setAlertError(err.response?.data?.error || 'Failed to update alert');
                              } finally {
                                setSavingToggle(null);
                              }
                            }}
                            className={`text-xs px-2 py-1 rounded ${alert.emailEnabled ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}
                            disabled={savingToggle === alert.id + '-email'}
                          >
                            {savingToggle === alert.id + '-email' ? 'Updating...' : alert.emailEnabled ? 'Email on' : 'Email off'}
                          </button>
                        </div>
                      </div>
                      <button
                        onClick={async () => {
                          if (!alertModalBudget) return;
                          try {
                            await budgetAPI.deleteAlert(alertModalBudget.id, alert.id);
                            setSelectedBudgetAlerts(prev => ({
                              ...prev,
                              [alertModalBudget.id]: (prev[alertModalBudget.id] || []).filter(a => a.id !== alert.id)
                            }));
                          } catch (err: any) {
                            setAlertError(err.response?.data?.error || 'Failed to delete alert');
                          }
                        }}
                        className="text-red-500 hover:text-red-700 text-sm"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  {(selectedBudgetAlerts[alertModalBudget.id] || []).length === 0 && (
                    <p className="text-sm text-gray-500">No alerts yet.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Empty State */}
        {budgets.length === 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12">
            <div className="text-center">
              <div className="w-20 h-20 mx-auto mb-6 bg-gradient-to-br from-purple-100 to-blue-100 rounded-xl flex items-center justify-center">
                <svg className="w-10 h-10 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-3">Start Building Your Budget</h3>
              <p className="text-gray-600 mb-8 max-w-md mx-auto">
                Take control of your finances by creating budgets for different categories. 
                Track your spending and achieve your financial goals.
              </p>
              
              <div className="grid grid-cols-2 gap-4 max-w-sm mx-auto mb-8 text-sm text-gray-600">
                <div className="flex items-center space-x-2">
                  <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span>Track spending</span>
                </div>
                <div className="flex items-center space-x-2">
                  <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span>Set alerts</span>
                </div>
                <div className="flex items-center space-x-2">
                  <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span>Reach goals</span>
                </div>
                <div className="flex items-center space-x-2">
                  <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span>Stay on track</span>
                </div>
              </div>

              <button
                onClick={openCreateForm}
                className="inline-flex items-center px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
              >
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                Create Your First Budget
              </button>
            </div>
          </div>
        )}
      </div>
    </SidebarLayout>
  );
};

export default BudgetPage;