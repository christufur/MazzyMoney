import React, { useState, useEffect, useCallback } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import SidebarLayout from '../components/layout/SidebarLayout';
import { budgetAPI, categoryAPI } from '../services/api';
import type { Budget, BudgetAlert, BudgetTotals } from '../services/api';

export interface CreateBudgetRequest {
  name: string;
  category: string;
  amount: number;
  rollover?: boolean;
  startMonth?: string;
}

export interface UpdateBudgetRequest {
  name?: string;
  category?: string;
  amount?: number;
  rollover?: boolean;
}

export interface BudgetFormData {
  name: string;
  category: string;
  amount: string; // Keep as string for better form handling
  rollover: boolean;
  startMonth: string; // YYYY-MM, create only
}

/* Month helpers. Months are `YYYY-MM` strings compared in UTC, like the API. */

const currentMonthKey = (): string => {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
};

const shiftMonth = (month: string, delta: number): string => {
  const [year, monthNumber] = month.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
};

const formatMonth = (month: string): string => {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(Date.UTC(year, monthNumber - 1, 1)).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  });
};

/** `2026-11` → `Nov` for the history chart's axis. */
const shortMonth = (month: string): string => {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(Date.UTC(year, monthNumber - 1, 1)).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
  });
};

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

const getRingColor = (percentUsed: number) => {
  if (percentUsed <= 70) return '#10b981';
  if (percentUsed <= 90) return '#f59e0b';
  if (percentUsed <= 100) return '#f97316';
  return '#ef4444';
};

/** "includes $12.00 rolled over" (or the overspend carried in when negative). */
const rolloverLabel = (rolloverIn: number) =>
  rolloverIn >= 0
    ? `includes ${formatCurrency(rolloverIn)} rolled over`
    : `includes -${formatCurrency(Math.abs(rolloverIn))} overspent last month`;

const EMPTY_TOTALS: BudgetTotals = { budgeted: 0, spent: 0, available: 0, remaining: 0 };

const BudgetPage: React.FC = () => {
  const [month, setMonth] = useState(currentMonthKey());
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [totals, setTotals] = useState<BudgetTotals>(EMPTY_TOTALS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingBudget, setEditingBudget] = useState<Budget | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [formData, setFormData] = useState<BudgetFormData>({
    name: '',
    category: '',
    amount: '',
    rollover: false,
    startMonth: currentMonthKey()
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

  const nextMonthKey = shiftMonth(currentMonthKey(), 1);
  const canGoForward = month < nextMonthKey;

  const applyMonthPayload = useCallback(
    (payload: { budgets: Budget[]; totals?: BudgetTotals }) => {
      setBudgets(payload.budgets);
      setTotals(payload.totals ?? EMPTY_TOTALS);

      const alertsByBudget: Record<string, BudgetAlert[]> = {};
      payload.budgets.forEach((budget) => {
        alertsByBudget[budget.id] = budget.budgetAlerts || [];
      });
      setSelectedBudgetAlerts(alertsByBudget);
    },
    []
  );

  // Categories load once; budgets load again whenever the month changes.
  useEffect(() => {
    const loadCategories = async () => {
      setLoadingCategories(true);
      try {
        setCategories(await fetchCategories());
      } finally {
        setLoadingCategories(false);
      }
    };

    loadCategories();
  }, []);

  useEffect(() => {
    let active = true;

    const loadBudgets = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await budgetAPI.getBudgets(month);
        if (!active) return;
        applyMonthPayload(response);
      } catch (err: any) {
        if (!active) return;
        setError(err.response?.data?.error || 'Failed to fetch budgets');
      } finally {
        if (active) setLoading(false);
      }
    };

    loadBudgets();
    return () => {
      active = false;
    };
  }, [month, applyMonthPayload]);

  // Fetch categories from transactions
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
    const response = await budgetAPI.createBudget(budgetData);
    // The month payload decides whether the new budget belongs in the visible month.
    await reloadMonth();

    // A budget that starts later only shows up from its start month on.
    if (budgetData.startMonth && budgetData.startMonth > month) {
      setNotice(`${response.budget.name} starts in ${formatMonth(budgetData.startMonth)}.`);
    }

    // Refresh categories to include new category if it doesn't exist
    if (!categories.includes(budgetData.category)) {
      const updatedCategories = [...categories, budgetData.category].sort();
      setCategories(updatedCategories);
    }
  };

  // update budget handler
  const handleUpdateBudget = async (id: string, budgetData: UpdateBudgetRequest) => {
    await budgetAPI.updateBudget(id, budgetData);
    await reloadMonth();
  };

  // delete budget handler
  const handleDeleteBudget = async (id: string) => {
    await budgetAPI.deleteBudget(id);
    await reloadMonth();
  };

  /** Re-read the visible month after a create/update/delete. */
  const reloadMonth = async () => {
    const response = await budgetAPI.getBudgets(month);
    applyMonthPayload(response);
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

    if (!editingBudget && !/^\d{4}-(0[1-9]|1[0-2])$/.test(formData.startMonth)) {
      errors.startMonth = 'Pick a start month';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const resetForm = () => {
    setFormData({
      name: '',
      category: '',
      amount: '',
      rollover: false,
      startMonth: currentMonthKey()
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
      rollover: budget.rollover,
      startMonth: currentMonthKey()
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
      setFormErrors({});

      if (editingBudget) {
        await handleUpdateBudget(editingBudget.id, {
          name: formData.name.trim(),
          category: formData.category,
          amount: parseFloat(formData.amount),
          rollover: formData.rollover
        });
      } else {
        await handleCreateBudget({
          name: formData.name.trim(),
          category: formData.category,
          amount: parseFloat(formData.amount),
          rollover: formData.rollover,
          startMonth: formData.startMonth
        });
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
      `Are you sure you want to delete the "${budget.name}" budget? This will stop it from repeating every month.`
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

  const overallPercentUsed =
    totals.available > 0 ? (totals.spent / totals.available) * 100 : totals.spent > 0 ? 100 : 0;
  const budgetsOnTrack = budgets.filter(b => b.percentUsed <= 70).length;
  const budgetsOverspent = budgets.filter(b => b.percentUsed > 100).length;

  return (
    <SidebarLayout title="Budgets">
      <div className="space-y-6">
        {/* Month selector */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setMonth(shiftMonth(month, -1))}
              aria-label="Previous month"
              className="px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
            >
              ◀
            </button>
            <h2 className="text-xl font-bold text-gray-900 min-w-44 text-center" data-testid="budget-month">
              {formatMonth(month)}
            </h2>
            <button
              onClick={() => setMonth(shiftMonth(month, 1))}
              aria-label="Next month"
              disabled={!canGoForward}
              className="px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ▶
            </button>
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

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
            <div className="flex justify-between items-center">
              <span>{error}</span>
              <button onClick={reloadMonth} className="ml-4 text-red-600 hover:text-red-800 underline">
                Try Again
              </button>
            </div>
          </div>
        )}

        {notice && (
          <div className="bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded">
            <div className="flex justify-between items-center">
              <span>{notice}</span>
              <button
                onClick={() => setNotice(null)}
                className="ml-4 text-blue-600 hover:text-blue-800"
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Totals card */}
        <div
          className="bg-linear-to-r from-purple-600 to-blue-600 rounded-xl shadow-lg text-white p-6"
          data-testid="budget-totals"
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="text-center">
              <div className="text-3xl font-bold mb-1" data-testid="budgeted-total">
                {formatCurrency(totals.budgeted)}
              </div>
              <div className="text-purple-100 text-sm">Budgeted</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold mb-1" data-testid="spent-total">
                {formatCurrency(totals.spent)}
              </div>
              <div className="text-purple-100 text-sm">Spent</div>
            </div>
            <div className="text-center">
              <div
                className={`text-3xl font-bold mb-1 ${totals.remaining >= 0 ? 'text-green-200' : 'text-red-200'}`}
                data-testid="remaining-total"
              >
                {totals.remaining >= 0 ? '' : '-'}
                {formatCurrency(Math.abs(totals.remaining))}
              </div>
              <div className="text-purple-100 text-sm">
                {totals.remaining >= 0 ? 'Remaining' : 'Over Budget'}
              </div>
            </div>
          </div>

          <div className="mt-6">
            <div className="h-3 w-full bg-white/20 rounded-full overflow-hidden">
              <div
                className="h-3 bg-white rounded-full transition-all duration-500"
                style={{ width: `${Math.min(overallPercentUsed, 100)}%` }}
              />
            </div>
            <div className="mt-2 text-center text-sm text-purple-100">
              {overallPercentUsed.toFixed(0)}% of {formatCurrency(totals.available)} available
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <p className="text-sm font-medium text-gray-500">Active Budgets</p>
            <p className="text-2xl font-bold text-gray-900">{budgets.length}</p>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <p className="text-sm font-medium text-gray-500">On Track</p>
            <p className="text-2xl font-bold text-green-600">{budgetsOnTrack}</p>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <p className="text-sm font-medium text-gray-500">Overspent</p>
            <p className="text-2xl font-bold text-red-600">{budgetsOverspent}</p>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center items-center h-40">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <span className="ml-3 text-gray-600">Loading budgets...</span>
          </div>
        ) : (
          <>
            {/* Budget grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {budgets.map((budget) => {
                const status = getBudgetStatus(budget.percentUsed);
                const progressColor = getProgressBarColor(budget.percentUsed);
                const isDeleting = deleting === budget.id;
                const radius = 36;
                const circumference = 2 * Math.PI * radius;
                const progressOffset =
                  circumference - (Math.min(budget.percentUsed, 100) / 100) * circumference;

                return (
                  <div
                    key={budget.id}
                    data-testid={`budget-card-${budget.id}`}
                    className={`bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-all duration-200 ${isDeleting ? 'opacity-50' : ''}`}
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center space-x-3">
                        <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center text-xl">
                          {getCategoryIcon(budget.category)}
                        </div>
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900">{budget.name}</h3>
                          <p className="text-sm text-gray-500">
                            {budget.category} • monthly{budget.rollover ? ' • rolls over' : ''}
                          </p>
                        </div>
                      </div>
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${status.bg} ${status.color}`}>
                        {status.label}
                      </span>
                    </div>

                    <div className="flex items-center space-x-6 mb-4">
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
                            stroke={getRingColor(budget.percentUsed)}
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

                      <div className="flex-1 space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-gray-600">Spent</span>
                          <span className="text-lg font-semibold text-gray-900">
                            {formatCurrency(budget.spent)}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-gray-600">of</span>
                          <span className="text-sm text-gray-700">{formatCurrency(budget.available)}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-gray-600">Remaining</span>
                          <span
                            className={`text-sm font-medium ${budget.remaining >= 0 ? 'text-green-600' : 'text-red-600'}`}
                          >
                            {budget.remaining >= 0 ? '' : '-'}
                            {formatCurrency(Math.abs(budget.remaining))}
                          </span>
                        </div>
                      </div>
                    </div>

                    {budget.rolloverIn !== 0 && (
                      <p className="mb-3 text-xs text-purple-700" data-testid={`rollover-${budget.id}`}>
                        {rolloverLabel(budget.rolloverIn)}
                      </p>
                    )}

                    <div className="mb-2 h-2 w-full bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-2 rounded-full ${progressColor} transition-all duration-500`}
                        style={{ width: `${Math.min(budget.percentUsed, 100)}%` }}
                      />
                    </div>

                    {/* Six-month history */}
                    <div className="mt-4 h-32" data-testid={`history-${budget.id}`}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={budget.history.map(point => ({ ...point, label: shortMonth(point.month) }))}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} />
                          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                          <YAxis tick={{ fontSize: 11 }} width={40} />
                          <Tooltip
                            formatter={(value) => formatCurrency(Number(value))}
                            labelFormatter={(_label, payload) => {
                              const month = (payload?.[0]?.payload as { month?: string } | undefined)?.month;
                              return month ? formatMonth(month) : '';
                            }}
                          />
                          <ReferenceLine y={budget.budgeted} stroke="#6366f1" strokeDasharray="4 4" />
                          <Bar dataKey="spent" name="Spent" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>

                    {selectedBudgetAlerts[budget.id]?.length > 0 && (
                      <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <svg className="w-4 h-4 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-5 5-5-5h5v-5a7.5 7.5 0 0 0-15 0v5h5l-5 5-5-5h5V12a9.5 9.5 0 0 1 19 0v5z" />
                            </svg>
                            <span className="text-sm font-medium text-gray-700">
                              {selectedBudgetAlerts[budget.id].length} alert
                              {selectedBudgetAlerts[budget.id].length !== 1 ? 's' : ''} active
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

                    <div className="mt-4 flex items-center justify-between pt-4 border-t border-gray-100">
                      <div className="flex space-x-3">
                        <button
                          onClick={() => openEditForm(budget)}
                          disabled={isDeleting}
                          className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50"
                        >
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
                            Add Alert
                          </button>
                        )}
                      </div>
                      <button
                        onClick={() => handleDelete(budget.id)}
                        disabled={isDeleting}
                        className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                      >
                        {isDeleting ? 'Deleting...' : 'Delete'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Empty state */}
            {budgets.length === 0 && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12">
                <div className="text-center">
                  <h3 className="text-xl font-semibold text-gray-900 mb-3">
                    No budgets in {formatMonth(month)}
                  </h3>
                  <p className="text-gray-600 mb-8 max-w-md mx-auto">
                    A budget is a monthly amount for one category. It repeats every month until
                    you delete it, and you can roll unused money into the next month.
                  </p>
                  <button
                    onClick={openCreateForm}
                    className="inline-flex items-center px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
                  >
                    Create Your First Budget
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* Create/Edit Budget Modal */}
        {showCreateForm && (
          <div
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
            role="dialog"
            aria-modal="true"
            aria-label={editingBudget ? 'Edit budget' : 'Create budget'}
          >
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
                    Monthly Amount
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

                <label className="flex items-center space-x-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={formData.rollover}
                    onChange={(e) => setFormData(prev => ({ ...prev, rollover: e.target.checked }))}
                  />
                  <span>Roll over unused money to next month</span>
                </label>

                {!editingBudget && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Start Month
                    </label>
                    <input
                      type="month"
                      value={formData.startMonth}
                      onChange={(e) => {
                        setFormData(prev => ({ ...prev, startMonth: e.target.value }));
                        if (formErrors.startMonth) {
                          setFormErrors(prev => ({ ...prev, startMonth: '' }));
                        }
                      }}
                      className={`w-full border rounded-md px-3 py-2 ${
                        formErrors.startMonth ? 'border-red-500' : 'border-gray-300'
                      }`}
                    />
                    {formErrors.startMonth && (
                      <p className="text-red-500 text-sm mt-1">{formErrors.startMonth}</p>
                    )}
                    <p className="text-xs text-gray-500 mt-1">
                      Spending already in this category counts from this month on.
                    </p>
                  </div>
                )}

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
                    {editingBudget ? 'Save Changes' : 'Save Budget'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {alertModalBudget && (
          <div
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
            role="dialog"
            aria-modal="true"
            aria-label="Manage alerts"
          >
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
      </div>
    </SidebarLayout>
  );
};

// Category icon for better visual representation
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

export default BudgetPage;
