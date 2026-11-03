import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChevronDown, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import SidebarLayout from '../components/layout/SidebarLayout';
import { budgetAPI, categoryAPI } from '../services/api';
import type { Budget, BudgetAlert, BudgetTotals } from '../services/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { money, moneyWhole } from '@/lib/money';

interface CreateBudgetRequest {
  name: string;
  category: string;
  amount: number;
  rollover?: boolean;
  startMonth?: string;
}

interface UpdateBudgetRequest {
  name?: string;
  category?: string;
  amount?: number;
  rollover?: boolean;
}

interface BudgetFormData {
  name: string;
  category: string;
  amount: string;
  rollover: boolean;
  startMonth: string;
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

/** "includes $12.00 rolled over" (or the overspend carried in when negative). */
const rolloverLabel = (rolloverIn: number) =>
  rolloverIn >= 0
    ? `includes ${money(rolloverIn)} rolled over`
    : `includes −${money(Math.abs(rolloverIn))} overspent last month`;

const EMPTY_TOTALS: BudgetTotals = { budgeted: 0, spent: 0, available: 0, remaining: 0 };

/** One plain figure with a rule under it, like the month spread on Overview. */
const Figure: React.FC<{ label: string; value: string; tone?: 'terra'; testId: string }> = ({
  label,
  value,
  tone,
  testId,
}) => (
  <div className="border-b border-rule pb-3">
    <div className="text-sm text-muted-foreground">{label}</div>
    <div
      data-testid={testId}
      className={cn('mt-1 text-figure font-semibold tabular-nums', tone === 'terra' ? 'text-terra' : 'text-ink')}
    >
      {value}
    </div>
  </div>
);

const FieldError: React.FC<{ message?: string }> = ({ message }) =>
  message ? <p className="mt-1 text-sm text-terra">{message}</p> : null;

interface BudgetRowProps {
  budget: Budget;
  expanded: boolean;
  chartMax: number;
  alerts: BudgetAlert[];
  busy: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onAlerts: () => void;
  onDelete: () => void;
}

/** One ledger line: name, track, spent / available, then its own history on expand. */
const BudgetRow: React.FC<BudgetRowProps> = ({
  budget,
  expanded,
  chartMax,
  alerts,
  busy,
  onToggle,
  onEdit,
  onAlerts,
  onDelete,
}) => {
  const over = budget.spent > budget.available;
  const pct = budget.available > 0 ? Math.min(100, (budget.spent / budget.available) * 100) : budget.spent > 0 ? 100 : 0;
  const points = (budget.history ?? []).map((point) => ({ ...point, label: shortMonth(point.month) }));

  return (
    <li
      data-testid={`budget-card-${budget.id}`}
      className={cn('ledger-line last:border-b-0', busy && 'opacity-60')}
    >
      <button
        type="button"
        data-testid={`budget-row-${budget.id}`}
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={`budget-detail-${budget.id}`}
        className="flex w-full items-start gap-2 py-3 pr-4 pl-3 text-left outline-none hover:bg-paper focus-visible:bg-paper md:pr-5"
      >
        <ChevronDown
          aria-hidden
          strokeWidth={1.75}
          className={cn(
            'mt-1 size-4 shrink-0 text-muted-foreground transition-transform',
            expanded && 'rotate-180'
          )}
        />
        <span className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 md:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_auto]">
          <span className="min-w-0">
            {/* The category reads first, like the plan lines on This month; the name is the household's own label. */}
            <span className="block truncate text-[15px] text-ink">{budget.category}</span>
            {budget.name !== budget.category && (
              <span className="block truncate text-xs text-muted-foreground">{budget.name}</span>
            )}
            {budget.rolloverIn !== 0 && (
              <span data-testid={`rollover-${budget.id}`} className="block text-xs text-muted-foreground">
                {rolloverLabel(budget.rolloverIn)}
              </span>
            )}
          </span>
          <span className="order-3 col-span-2 h-2 rounded-sm bg-muted md:order-none md:col-span-1" aria-hidden>
            <span
              className={cn('block h-2 rounded-sm', over ? 'bg-terra' : 'bg-sage')}
              style={{ width: `${pct}%` }}
            />
          </span>
          <span className="shrink-0 text-right">
            <span className="block text-[15px] tabular-nums text-muted-foreground">
              <span className="font-medium text-ink">{moneyWhole(budget.spent)}</span> / {moneyWhole(budget.available)}
            </span>
            <span className={cn('block text-xs tabular-nums', over ? 'text-terra' : 'text-muted-foreground')}>
              {over ? `${moneyWhole(Math.abs(budget.remaining))} over` : `${moneyWhole(budget.remaining)} left`}
            </span>
          </span>
        </span>
      </button>

      {expanded && (
        <div id={`budget-detail-${budget.id}`} className="pr-4 pb-5 pl-9 md:pr-5 md:pl-9">
          <p className="mb-2 text-xs text-muted-foreground">
            Six months, on this page’s one scale. The dashed line is the monthly amount.
          </p>
          <div className="h-36" data-testid={`history-${budget.id}`}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={points} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
                />
                <YAxis
                  domain={[0, chartMax]}
                  width={56}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
                  tickFormatter={(value) => moneyWhole(Number(value))}
                />
                <Tooltip
                  formatter={(value) => money(Number(value))}
                  labelFormatter={(_label, payload) => {
                    const month = (payload?.[0]?.payload as { month?: string } | undefined)?.month;
                    return month ? formatMonth(month) : '';
                  }}
                  contentStyle={{
                    background: 'var(--card)',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    boxShadow: 'none',
                    fontSize: '12px',
                    color: 'var(--foreground)',
                  }}
                  labelStyle={{ color: 'var(--muted-foreground)', marginBottom: '2px' }}
                  cursor={{ fill: 'var(--muted)' }}
                />
                <ReferenceLine y={budget.budgeted} stroke="var(--muted-foreground)" strokeDasharray="4 4" />
                <Bar dataKey="spent" name="Spent" radius={[3, 3, 0, 0]}>
                  {points.map((point) => (
                    <Cell
                      key={point.month}
                      fill={point.spent > point.budgeted ? 'var(--terra)' : 'var(--sage)'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={onEdit} disabled={busy}>
              Edit
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onAlerts}
              disabled={busy}
              aria-label={alerts.length > 0 ? `Alerts, ${alerts.length} active` : 'Alerts'}
            >
              Alerts
              {alerts.length > 0 && (
                <span aria-hidden className="text-muted-foreground">
                  · {alerts.length}
                </span>
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onDelete}
              disabled={busy}
              className="text-ink"
            >
              Delete
            </Button>
          </div>
        </div>
      )}
    </li>
  );
};

/** One row in the suggestions dialog: a category, what it costs, and what to create. */
interface SuggestionDraft {
  category: string;
  average: number;
  suggested: number;
  monthsWithSpending: number;
  checked: boolean;
  /** The amount as typed, so a half-typed value is not thrown away. */
  amount: string;
}

const BudgetPage: React.FC = () => {
  const [month, setMonth] = useState(currentMonthKey());
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [totals, setTotals] = useState<BudgetTotals>(EMPTY_TOTALS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingBudget, setEditingBudget] = useState<Budget | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Budget | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [formData, setFormData] = useState<BudgetFormData>({
    name: '',
    category: '',
    amount: '',
    rollover: false,
    startMonth: currentMonthKey(),
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
    isEnabled: true,
  });
  const [alertError, setAlertError] = useState<string | null>(null);
  const [savingAlert, setSavingAlert] = useState(false);
  const [savingToggle, setSavingToggle] = useState<string | null>(null);

  // Suggestions: one row per category the last three full months say is worth a budget.
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
  const [suggestionRows, setSuggestionRows] = useState<SuggestionDraft[]>([]);
  const [suggestionMonths, setSuggestionMonths] = useState<string[]>([]);
  const [suggestionRollover, setSuggestionRollover] = useState(false);
  const [suggestionRowErrors, setSuggestionRowErrors] = useState<Record<string, string>>({});
  const [creatingSuggestions, setCreatingSuggestions] = useState(false);

  const thisMonth = currentMonthKey();
  const nextMonthKey = shiftMonth(thisMonth, 1);
  const canGoForward = month < nextMonthKey;
  const monthPosition = month === thisMonth ? 'This month' : month > thisMonth ? 'Next month' : 'Closed month';

  const applyMonthPayload = useCallback((payload: { budgets: Budget[]; totals?: BudgetTotals }) => {
    setBudgets(payload.budgets);
    setTotals(payload.totals ?? EMPTY_TOTALS);

    const alertsByBudget: Record<string, BudgetAlert[]> = {};
    payload.budgets.forEach((budget) => {
      alertsByBudget[budget.id] = budget.budgetAlerts || [];
    });
    setSelectedBudgetAlerts(alertsByBudget);
  }, []);

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
        setError(
          err.response?.data?.error || 'Could not load this month’s budgets. Check that the server is running, then try again.'
        );
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
    } catch (err) {
      console.error('Failed to fetch categories:', err);
      return [];
    }
  };

  const refreshCategories = async () => {
    setLoadingCategories(true);
    setCategories(await fetchCategories());
    setLoadingCategories(false);
  };

  /** Re-read the visible month after a create/update/delete. */
  const reloadMonth = async () => {
    const response = await budgetAPI.getBudgets(month);
    applyMonthPayload(response);
  };

  const handleCreateBudget = async (budgetData: CreateBudgetRequest) => {
    const response = await budgetAPI.createBudget(budgetData);
    // The month payload decides whether the new budget belongs in the visible month.
    await reloadMonth();

    // A budget that starts later only shows up from its start month on.
    if (budgetData.startMonth && budgetData.startMonth > month) {
      setNotice(`${response.budget.name} starts in ${formatMonth(budgetData.startMonth)}.`);
    }

    if (!categories.includes(budgetData.category)) {
      setCategories([...categories, budgetData.category].sort());
    }
  };

  const handleUpdateBudget = async (id: string, budgetData: UpdateBudgetRequest) => {
    await budgetAPI.updateBudget(id, budgetData);
    await reloadMonth();
  };

  const validateForm = () => {
    const errors: Record<string, string> = {};

    if (!formData.name.trim()) errors.name = 'Give this budget a name.';
    if (!formData.category) errors.category = 'Pick a category.';
    if (!formData.amount || parseFloat(formData.amount) <= 0) errors.amount = 'Enter an amount above $0.';
    if (!editingBudget && !/^\d{4}-(0[1-9]|1[0-2])$/.test(formData.startMonth)) {
      errors.startMonth = 'Pick a start month.';
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
      startMonth: currentMonthKey(),
    });
    setFormErrors({});
    setEditingBudget(null);
  };

  const openCreateForm = () => {
    resetForm();
    setShowCreateForm(true);
  };

  /** Load what the last three full months say, then show the dialog. */
  const openSuggestions = async () => {
    setSuggestionsOpen(true);
    setSuggestionsLoading(true);
    setSuggestionsError(null);
    setSuggestionRowErrors({});
    setSuggestionRollover(false);
    setSuggestionRows([]);
    setSuggestionMonths([]);

    try {
      const response = await budgetAPI.getSuggestions();
      setSuggestionMonths(response.months ?? []);
      setSuggestionRows(
        (response.suggestions ?? []).map((suggestion) => ({
          ...suggestion,
          checked: true,
          amount: String(suggestion.suggested),
        }))
      );
    } catch (err: any) {
      setSuggestionsError(
        err.response?.data?.error ||
          'Could not load suggestions. Check that the server is running, then try again.'
      );
    } finally {
      setSuggestionsLoading(false);
    }
  };

  const closeSuggestions = () => {
    setSuggestionsOpen(false);
    setSuggestionRows([]);
    setSuggestionRowErrors({});
    setSuggestionsError(null);
  };

  const patchSuggestion = (category: string, patch: Partial<SuggestionDraft>) => {
    setSuggestionRows((rows) =>
      rows.map((row) => (row.category === category ? { ...row, ...patch } : row))
    );
    setSuggestionRowErrors((errors) => {
      if (!errors[category]) return errors;
      const { [category]: _dropped, ...rest } = errors;
      return rest;
    });
  };

  /**
   * Create every checked row, one at a time, each starting this month. A row that
   * fails (a duplicate, a bad amount) keeps its error and the others still go in.
   */
  const createSuggestedBudgets = async () => {
    const selected = suggestionRows.filter((row) => row.checked);

    const errors: Record<string, string> = {};
    for (const row of selected) {
      const amount = parseFloat(row.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        errors[row.category] = 'Enter an amount above $0.';
      }
    }

    if (Object.keys(errors).length > 0) {
      setSuggestionRowErrors(errors);
      return;
    }

    setCreatingSuggestions(true);
    setSuggestionRowErrors({});

    const startMonth = currentMonthKey();
    let created = 0;
    const failures: Record<string, string> = {};

    for (const row of selected) {
      try {
        await budgetAPI.createBudget({
          name: row.category,
          category: row.category,
          amount: parseFloat(row.amount),
          rollover: suggestionRollover,
          startMonth,
        });
        created += 1;
      } catch (err: any) {
        failures[row.category] =
          err.response?.data?.error || 'Could not create this budget. Try again.';
      }
    }

    setCreatingSuggestions(false);

    if (created > 0) {
      // The visible month decides whether the new budgets belong on the page.
      try {
        await reloadMonth();
      } catch (err: any) {
        setError(err.response?.data?.error || 'The budgets were created, but this page could not reload them.');
      }
      setCategories((current) =>
        [...new Set([...current, ...selected.map((row) => row.category)])].sort()
      );
    }

    if (Object.keys(failures).length > 0) {
      setSuggestionRowErrors(failures);
      setSuggestionRows((rows) => rows.filter((row) => failures[row.category]));
      if (created > 0) toast.success(`Created ${created} ${created === 1 ? 'budget' : 'budgets'}.`);
      return;
    }

    closeSuggestions();
    toast.success(`Created ${created} ${created === 1 ? 'budget' : 'budgets'}.`);
  };

  const closeForm = () => {
    setShowCreateForm(false);
    resetForm();
  };

  const openEditForm = (budget: Budget) => {
    setFormData({
      name: budget.name,
      category: budget.category,
      amount: budget.amount.toString(),
      rollover: budget.rollover,
      startMonth: currentMonthKey(),
    });
    setFormErrors({});
    setEditingBudget(budget);
    setShowCreateForm(true);
  };

  const handleAmountChange = (value: string) => {
    // Allow empty string, numbers, and decimal points
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      setFormData((prev) => ({ ...prev, amount: value }));
      if (formErrors.amount && parseFloat(value) > 0) {
        setFormErrors((prev) => ({ ...prev, amount: '' }));
      }
    }
  };

  const handleAmountFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    if (e.target.value === '0') {
      setFormData((prev) => ({ ...prev, amount: '' }));
    }
  };

  const handleAmountBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    if (e.target.value === '') return;
    const numValue = parseFloat(e.target.value);
    if (!isNaN(numValue) && numValue > 0) {
      setFormData((prev) => ({ ...prev, amount: numValue.toFixed(2) }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    try {
      setFormErrors({});

      if (editingBudget) {
        await handleUpdateBudget(editingBudget.id, {
          name: formData.name.trim(),
          category: formData.category,
          amount: parseFloat(formData.amount),
          rollover: formData.rollover,
        });
      } else {
        await handleCreateBudget({
          name: formData.name.trim(),
          category: formData.category,
          amount: parseFloat(formData.amount),
          rollover: formData.rollover,
          startMonth: formData.startMonth,
        });
      }

      closeForm();
    } catch (err: any) {
      const errorMessage = err.response?.data?.error || `Could not ${editingBudget ? 'save' : 'create'} this budget. Try again.`;

      if (errorMessage.includes('already have a')) {
        setFormErrors({ category: errorMessage });
      } else {
        setFormErrors({ general: errorMessage });
      }
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const budget = pendingDelete;
    try {
      setDeleting(budget.id);
      await budgetAPI.deleteBudget(budget.id);
      await reloadMonth();
      setPendingDelete(null);
      if (expandedId === budget.id) setExpandedId(null);
    } catch (err: any) {
      setPendingDelete(null);
      toast.error(err.response?.data?.error || 'Could not delete this budget. Try again.');
    } finally {
      setDeleting(null);
    }
  };

  const openAlerts = (budget: Budget) => {
    setAlertModalBudget(budget);
    setAlertForm({
      thresholdPercent: '90',
      alertType: 'BUDGET_APPROACHING',
      emailEnabled: true,
      isEnabled: true,
    });
    setAlertError(null);
  };

  const closeAlerts = () => {
    setAlertModalBudget(null);
    setAlertError(null);
  };

  const patchAlert = (budgetId: string, alert: BudgetAlert) => {
    setSelectedBudgetAlerts((prev) => ({
      ...prev,
      [budgetId]: (prev[budgetId] || []).map((a) => (a.id === alert.id ? alert : a)),
    }));
  };

  const toggleAlertFlag = async (budgetId: string, alert: BudgetAlert, field: 'isEnabled' | 'emailEnabled') => {
    setSavingToggle(`${alert.id}-${field}`);
    try {
      const response = await budgetAPI.updateAlert(budgetId, alert.id, { [field]: !alert[field] });
      patchAlert(budgetId, response.alert);
    } catch (err: any) {
      setAlertError(err.response?.data?.error || 'Could not update this alert. Try again.');
    } finally {
      setSavingToggle(null);
    }
  };

  const removeAlert = async (budgetId: string, alertId: string) => {
    try {
      await budgetAPI.deleteAlert(budgetId, alertId);
      setSelectedBudgetAlerts((prev) => ({
        ...prev,
        [budgetId]: (prev[budgetId] || []).filter((a) => a.id !== alertId),
      }));
    } catch (err: any) {
      setAlertError(err.response?.data?.error || 'Could not remove this alert. Try again.');
    }
  };

  // One fixed vertical scale for every history chart on the page, so the bars compare.
  const chartMax = useMemo(() => {
    let max = 0;
    for (const budget of budgets) {
      max = Math.max(max, budget.budgeted ?? 0);
      for (const point of budget.history ?? []) {
        max = Math.max(max, point.budgeted ?? 0, point.spent ?? 0);
      }
    }
    if (max <= 0) return 100;
    return Math.ceil((max * 1.1) / 50) * 50;
  }, [budgets]);

  const overLines = budgets.filter((b) => b.spent > b.available);

  return (
    <SidebarLayout title="Budgets">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous month"
            onClick={() => setMonth(shiftMonth(month, -1))}
          >
            <ChevronLeft />
          </Button>
          <div>
            <h2 className="text-lg font-semibold text-ink" data-testid="budget-month">
              {formatMonth(month)}
            </h2>
            <p className="text-sm text-muted-foreground" data-testid="budget-month-position">
              {monthPosition}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next month"
            disabled={!canGoForward}
            onClick={() => setMonth(shiftMonth(month, 1))}
          >
            <ChevronRight />
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={openSuggestions}>
            Suggest budgets
          </Button>
          <Button onClick={openCreateForm}>New budget</Button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-md bg-terra-tint px-4 py-3 text-sm text-terra"
        >
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={reloadMonth}>
            Try again
          </Button>
        </div>
      )}

      {notice && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-md border border-rule bg-card px-4 py-3 text-sm">
          <span>{notice}</span>
          <Button variant="ghost" size="sm" aria-label="Dismiss notice" onClick={() => setNotice(null)}>
            Dismiss
          </Button>
        </div>
      )}

      <div className="mb-8 grid grid-cols-3 gap-5" data-testid="budget-totals">
        <Figure label="Budgeted" value={moneyWhole(totals.budgeted)} testId="budgeted-total" />
        <Figure label="Spent" value={moneyWhole(totals.spent)} testId="spent-total" />
        <Figure
          label="Left"
          value={
            totals.remaining < 0 ? `−${moneyWhole(Math.abs(totals.remaining))}` : moneyWhole(totals.remaining)
          }
          tone={totals.remaining < 0 ? 'terra' : undefined}
          testId="remaining-total"
        />
      </div>

      {loading ? (
        <div className="sheet px-5 py-6 md:px-6">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="mt-4 h-2 w-full" />
          <Skeleton className="mt-6 h-5 w-32" />
          <Skeleton className="mt-4 h-2 w-full" />
          <Skeleton className="mt-6 h-5 w-36" />
          <Skeleton className="mt-4 h-2 w-full" />
        </div>
      ) : budgets.length === 0 ? (
        <div className="sheet px-6 py-10">
          <p className="max-w-xl text-[15px] leading-relaxed text-ink">
            No budgets in {formatMonth(month)} — a budget is a monthly amount for one category that repeats every month
            until you delete it.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button onClick={openCreateForm}>Plan a budget</Button>
            <Button variant="outline" onClick={openSuggestions}>
              Suggest budgets
            </Button>
          </div>
        </div>
      ) : (
        <section aria-label={`Budgets for ${formatMonth(month)}`} className="sheet">
          <ul>
            {budgets.map((budget) => (
              <BudgetRow
                key={budget.id}
                budget={budget}
                expanded={expandedId === budget.id}
                chartMax={chartMax}
                alerts={selectedBudgetAlerts[budget.id] ?? []}
                busy={deleting === budget.id}
                onToggle={() => setExpandedId(expandedId === budget.id ? null : budget.id)}
                onEdit={() => openEditForm(budget)}
                onAlerts={() => openAlerts(budget)}
                onDelete={() => setPendingDelete(budget)}
              />
            ))}
          </ul>
        </section>
      )}

      {!loading && budgets.length > 0 && (
        <p className="mt-4 px-1 text-[15px] text-muted-foreground">
          {overLines.length === 0
            ? `Every line is inside its amount in ${formatMonth(month)}.`
            : `${overLines.length === 1 ? overLines[0].name : `${overLines.length} lines`} went past the amount in ${formatMonth(
                month
              )}. ${
                overLines.length === 1 && !overLines[0].rollover
                  ? 'It starts fresh next month.'
                  : 'What is over comes out of next month when a line rolls over.'
              }`}
        </p>
      )}

      <Dialog
        open={showCreateForm}
        onOpenChange={(open) => {
          if (!open) closeForm();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingBudget ? 'Edit budget' : 'New budget'}</DialogTitle>
            <DialogDescription>
              {editingBudget
                ? 'Change the name, category, amount, or rollover.'
                : 'One category with a monthly amount. It repeats every month until you delete it.'}
            </DialogDescription>
          </DialogHeader>

          {formErrors.general && (
            <p className="rounded-md bg-terra-tint px-3 py-2 text-sm text-terra">{formErrors.general}</p>
          )}

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="budget-name">Name</Label>
              <Input
                id="budget-name"
                type="text"
                value={formData.name}
                onChange={(e) => {
                  setFormData((prev) => ({ ...prev, name: e.target.value }));
                  if (formErrors.name) setFormErrors((prev) => ({ ...prev, name: '' }));
                }}
                placeholder="e.g., Groceries, Entertainment"
                aria-invalid={Boolean(formErrors.name)}
              />
              <FieldError message={formErrors.name} />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="budget-category">Category</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={refreshCategories}
                  disabled={loadingCategories}
                  className="text-muted-foreground"
                >
                  <RefreshCw className={cn(loadingCategories && 'animate-spin')} />
                  Refresh
                </Button>
              </div>
              <Select
                value={formData.category}
                onValueChange={(value) => {
                  setFormData((prev) => ({ ...prev, category: value }));
                  if (formErrors.category) setFormErrors((prev) => ({ ...prev, category: '' }));
                }}
                disabled={loadingCategories}
              >
                <SelectTrigger id="budget-category" aria-label="Category" aria-invalid={Boolean(formErrors.category)} className="w-full">
                  <SelectValue placeholder={loadingCategories ? 'Loading categories…' : 'Pick a category'} />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((category) => (
                    <SelectItem key={category} value={category}>
                      {category}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError message={formErrors.category} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="budget-amount">Monthly amount</Label>
              <div className="relative">
                <span
                  aria-hidden
                  className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground"
                >
                  $
                </span>
                <Input
                  id="budget-amount"
                  type="text"
                  inputMode="decimal"
                  value={formData.amount}
                  onChange={(e) => handleAmountChange(e.target.value)}
                  onFocus={handleAmountFocus}
                  onBlur={handleAmountBlur}
                  className="pl-7"
                  placeholder="0.00"
                  aria-invalid={Boolean(formErrors.amount)}
                />
              </div>
              <FieldError message={formErrors.amount} />
            </div>

            <div className="flex items-center gap-3">
              <Checkbox
                id="budget-rollover"
                checked={formData.rollover}
                onCheckedChange={(value) => setFormData((prev) => ({ ...prev, rollover: value === true }))}
              />
              <Label htmlFor="budget-rollover" className="font-normal">
                Roll over unused money to next month
              </Label>
            </div>

            {!editingBudget && (
              <div className="space-y-1.5">
                <Label htmlFor="budget-start">Start month</Label>
                <Input
                  id="budget-start"
                  type="month"
                  value={formData.startMonth}
                  onChange={(e) => {
                    setFormData((prev) => ({ ...prev, startMonth: e.target.value }));
                    if (formErrors.startMonth) setFormErrors((prev) => ({ ...prev, startMonth: '' }));
                  }}
                  aria-invalid={Boolean(formErrors.startMonth)}
                />
                <FieldError message={formErrors.startMonth} />
                <p className="text-xs text-muted-foreground">
                  Spending already in this category counts from this month on.
                </p>
              </div>
            )}

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={closeForm}>
                Cancel
              </Button>
              <Button type="submit">{editingBudget ? 'Save changes' : 'Save budget'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={suggestionsOpen}
        onOpenChange={(open) => {
          if (!open) closeSuggestions();
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Suggest budgets</DialogTitle>
            <DialogDescription>
              From your last {suggestionMonths.length || 3} full months of spending. Untick what you do not want, and
              change any amount before creating it.
            </DialogDescription>
          </DialogHeader>

          {suggestionsError && (
            <p role="alert" className="rounded-md bg-terra-tint px-3 py-2 text-sm text-terra">
              {suggestionsError}
            </p>
          )}

          {suggestionsLoading ? (
            <div className="space-y-3 py-2" data-testid="suggestions-loading">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : suggestionRows.length === 0 ? (
            <p className="py-2 text-[15px] leading-relaxed text-ink">
              No suggestions: every category with regular spending already has a budget.
            </p>
          ) : (
            <ul className="max-h-80 overflow-y-auto" data-testid="suggestion-rows">
              {suggestionRows.map((row) => (
                <li
                  key={row.category}
                  data-testid={`suggestion-${row.category}`}
                  className="ledger-line py-3 last:border-b-0"
                >
                  <div className="flex items-start gap-3">
                    <Checkbox
                      id={`suggestion-${row.category}-on`}
                      aria-label={row.category}
                      checked={row.checked}
                      onCheckedChange={(value) => patchSuggestion(row.category, { checked: value === true })}
                      className="mt-1"
                    />
                    <div className="min-w-0 flex-1">
                      <span className="text-[15px] text-ink">{row.category}</span>
                      <span className="mt-0.5 block text-sm text-muted-foreground">
                        about {moneyWhole(row.average)} a month over the last {suggestionMonths.length || 3} months
                      </span>
                      <div className="mt-2 flex items-center gap-2">
                        <div className="relative w-32">
                          <span
                            aria-hidden
                            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground"
                          >
                            $
                          </span>
                          <Input
                            aria-label={`${row.category} monthly amount`}
                            type="text"
                            inputMode="decimal"
                            value={row.amount}
                            disabled={!row.checked}
                            onChange={(e) => {
                              const value = e.target.value;
                              if (value === '' || /^\d*\.?\d*$/.test(value)) {
                                patchSuggestion(row.category, { amount: value });
                              }
                            }}
                            className="pl-7"
                          />
                        </div>
                        <span className="text-sm text-muted-foreground">a month</span>
                      </div>
                      {suggestionRowErrors[row.category] && (
                        <p className="mt-1 text-sm text-terra">{suggestionRowErrors[row.category]}</p>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {suggestionRows.length > 0 && (
            <div className="flex items-center gap-3 border-t border-rule pt-4">
              <Checkbox
                id="suggestion-rollover"
                checked={suggestionRollover}
                onCheckedChange={(value) => setSuggestionRollover(value === true)}
              />
              <Label htmlFor="suggestion-rollover" className="font-normal">
                Roll over unused money
              </Label>
            </div>
          )}

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={closeSuggestions}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={createSuggestedBudgets}
              disabled={
                creatingSuggestions ||
                suggestionsLoading ||
                suggestionRows.filter((row) => row.checked).length === 0
              }
            >
              {(() => {
                const count = suggestionRows.filter((row) => row.checked).length;
                return creatingSuggestions
                  ? 'Creating…'
                  : `Create ${count} ${count === 1 ? 'budget' : 'budgets'}`;
              })()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(alertModalBudget)}
        onOpenChange={(open) => {
          if (!open) closeAlerts();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Alerts{alertModalBudget ? ` for ${alertModalBudget.name}` : ''}</DialogTitle>
            <DialogDescription>
              We tell you when this line gets near its amount. Alerts check this month.
            </DialogDescription>
          </DialogHeader>

          {alertError && (
            <p role="alert" className="rounded-md bg-terra-tint px-3 py-2 text-sm text-terra">
              {alertError}
            </p>
          )}

          <ul className="max-h-64 overflow-y-auto">
            {(alertModalBudget ? selectedBudgetAlerts[alertModalBudget.id] ?? [] : []).map((alert) => {
              const busy =
                savingToggle === `${alert.id}-isEnabled` || savingToggle === `${alert.id}-emailEnabled`;
              return (
                <li
                  key={alert.id}
                  className="ledger-line flex items-center justify-between gap-3 py-3 last:border-b-0"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {`${describeAlert(alert)} · ${alert.thresholdPercent}%`}
                    </p>
                    <div className="mt-1.5 flex items-center gap-4">
                      <span className="flex items-center gap-2">
                        <Checkbox
                          id={`alert-${alert.id}-on`}
                          checked={alert.isEnabled}
                          disabled={busy}
                          onCheckedChange={() => alertModalBudget && toggleAlertFlag(alertModalBudget.id, alert, 'isEnabled')}
                        />
                        <Label htmlFor={`alert-${alert.id}-on`} className="font-normal text-muted-foreground">
                          On
                        </Label>
                      </span>
                      <span className="flex items-center gap-2">
                        <Checkbox
                          id={`alert-${alert.id}-email`}
                          checked={alert.emailEnabled}
                          disabled={busy}
                          onCheckedChange={() =>
                            alertModalBudget && toggleAlertFlag(alertModalBudget.id, alert, 'emailEnabled')
                          }
                        />
                        <Label htmlFor={`alert-${alert.id}-email`} className="font-normal text-muted-foreground">
                          Email
                        </Label>
                      </span>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    className="text-muted-foreground"
                    onClick={() => alertModalBudget && removeAlert(alertModalBudget.id, alert.id)}
                  >
                    Remove
                  </Button>
                </li>
              );
            })}
            {(alertModalBudget ? selectedBudgetAlerts[alertModalBudget.id] ?? [] : []).length === 0 && (
              <li className="pb-1 text-[15px] text-muted-foreground">No alerts on this line yet.</li>
            )}
          </ul>

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
                  isEnabled: alertForm.isEnabled,
                });

                setSelectedBudgetAlerts((prev) => ({
                  ...prev,
                  [alertModalBudget.id]: [...(prev[alertModalBudget.id] || []), response.alert],
                }));

                setAlertForm({
                  thresholdPercent: '90',
                  alertType: 'BUDGET_APPROACHING',
                  emailEnabled: true,
                  isEnabled: true,
                });
              } catch (err: any) {
                setAlertError(err.response?.data?.error || 'Could not save this alert. Try again.');
              } finally {
                setSavingAlert(false);
              }
            }}
            className="space-y-4 border-t border-rule pt-4"
          >
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="alert-type">When</Label>
                <Select
                  value={alertForm.alertType}
                  onValueChange={(value) =>
                    setAlertForm((prev) => ({ ...prev, alertType: value as BudgetAlert['alertType'] }))
                  }
                >
                  <SelectTrigger id="alert-type" aria-label="When" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BUDGET_APPROACHING">Approaching the amount</SelectItem>
                    <SelectItem value="BUDGET_EXCEEDED">Over the amount</SelectItem>
                    <SelectItem value="SPENDING_THRESHOLD">A custom threshold</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="alert-threshold">At this percent</Label>
                <Input
                  id="alert-threshold"
                  type="number"
                  min={0}
                  max={200}
                  value={alertForm.thresholdPercent}
                  onChange={(e) => setAlertForm((prev) => ({ ...prev, thresholdPercent: e.target.value }))}
                  required
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-5">
              <span className="flex items-center gap-2">
                <Checkbox
                  id="alert-form-on"
                  checked={alertForm.isEnabled}
                  onCheckedChange={(value) => setAlertForm((prev) => ({ ...prev, isEnabled: value === true }))}
                />
                <Label htmlFor="alert-form-on" className="font-normal">
                  Alert is on
                </Label>
              </span>
              <span className="flex items-center gap-2">
                <Checkbox
                  id="alert-form-email"
                  checked={alertForm.emailEnabled}
                  onCheckedChange={(value) => setAlertForm((prev) => ({ ...prev, emailEnabled: value === true }))}
                />
                <Label htmlFor="alert-form-email" className="font-normal">
                  Email me
                </Label>
              </span>
            </div>

            <div className="flex justify-end">
              <Button type="submit" size="sm" disabled={savingAlert}>
                Add alert
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this budget?</AlertDialogTitle>
            <AlertDialogDescription>
              “{pendingDelete?.name}” stops repeating from next month. Spending already recorded stays as it is.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmDelete} disabled={Boolean(deleting)}>
              {deleting ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarLayout>
  );
};

export default BudgetPage;
