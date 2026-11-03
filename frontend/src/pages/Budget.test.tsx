import type { ReactNode } from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, beforeEach, describe, it, expect } from 'vitest';
import BudgetPage from './Budgets';
import { budgetAPI } from '../services/api';
import type { Budget, BudgetMonthResponse } from '../services/api';

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ logout: vi.fn(), user: null }),
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}));

// jsdom has no layout, so ResponsiveContainer would measure 0x0 and draw nothing.
// A fixed size lets the real BarChart render.
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactNode }) => (
      <actual.ResponsiveContainer width={400} height={128}>
        {children}
      </actual.ResponsiveContainer>
    ),
  };
});

vi.mock('../services/api', () => {
  const now = new Date().toISOString();

  return {
    budgetAPI: {
      getBudgets: vi.fn(),
      createBudget: vi.fn(),
      updateBudget: vi.fn(),
      deleteBudget: vi.fn(),
      getAlerts: vi.fn(),
      createAlert: vi.fn(),
      updateAlert: vi.fn(),
      deleteAlert: vi.fn().mockResolvedValue({}),
    },
    transactionAPI: {
      getSpendingByCategory: vi.fn().mockResolvedValue({ categories: [] }),
    },
  };
});

const getBudgets = vi.mocked(budgetAPI.getBudgets);
const updateAlert = vi.mocked(budgetAPI.updateAlert);
const createAlert = vi.mocked(budgetAPI.createAlert);
const deleteAlert = vi.mocked(budgetAPI.deleteAlert);

const MONTH = '2026-11';

const monthOffset = (offset: number) => {
  const now = new Date();
  return `${new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1))
    .toISOString()
    .slice(0, 7)}`;
};

/** The month the page opens on, which is the current UTC month. */
const currentMonth = monthOffset(0);
const previousMonth = monthOffset(-1);

const history = (month: string) =>
  Array.from({ length: 6 }, (_, index) => {
    const [year, monthNumber] = month.split('-').map(Number);
    return {
      month: new Date(Date.UTC(year, monthNumber - 6 + index, 1)).toISOString().slice(0, 7),
      budgeted: 400,
      spent: index === 5 ? 200 : 100 + index,
    };
  });

const budget = (overrides: Partial<Budget> = {}): Budget => ({
  id: 'budget-1',
  name: 'Groceries',
  category: 'Food & Dining',
  amount: 400,
  rollover: false,
  startDate: new Date(Date.UTC(2026, 10, 1)).toISOString(),
  isActive: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  budgetAlerts: [
    {
      id: 'alert-1',
      thresholdPercent: 80,
      alertType: 'BUDGET_APPROACHING',
      isEnabled: true,
      emailEnabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
  month: MONTH,
  budgeted: 400,
  spent: 200,
  rolloverIn: 0,
  available: 400,
  remaining: 200,
  percentUsed: 50,
  history: history(MONTH),
  ...overrides,
});

const payload = (overrides: Partial<BudgetMonthResponse> = {}): BudgetMonthResponse => ({
  month: currentMonth,
  budgets: [budget({ month: currentMonth, history: history(currentMonth) })],
  totals: { budgeted: 400, spent: 200, available: 400, remaining: 200 },
  ...overrides,
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <BudgetPage />
    </MemoryRouter>
  );

describe('Budgets page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getBudgets.mockResolvedValue(payload());
    createAlert.mockResolvedValue({
      alert: {
        id: 'alert-2',
        thresholdPercent: 90,
        alertType: 'SPENDING_THRESHOLD',
        isEnabled: true,
        emailEnabled: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
    updateAlert.mockResolvedValue({
      alert: {
        id: 'alert-1',
        thresholdPercent: 80,
        alertType: 'BUDGET_APPROACHING',
        isEnabled: false,
        emailEnabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
    deleteAlert.mockResolvedValue(undefined);
  });

  it('renders the month totals and a budget card', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Groceries')).toBeInTheDocument();
    });

    expect(screen.getByTestId('budget-month')).toHaveTextContent(
      new Date(`${currentMonth}-01T00:00:00Z`).toLocaleDateString('en-US', {
        timeZone: 'UTC',
        month: 'long',
        year: 'numeric',
      })
    );

    // Totals card: budgeted, spent, remaining.
    const totals = screen.getByTestId('budget-totals');
    expect(within(totals).getByText('Budgeted')).toBeInTheDocument();
    expect(within(totals).getByTestId('budgeted-total')).toHaveTextContent('$400.00');
    expect(within(totals).getByText('Spent')).toBeInTheDocument();
    expect(within(totals).getByTestId('spent-total')).toHaveTextContent('$200.00');
    expect(within(totals).getByText('Remaining')).toBeInTheDocument();
    expect(within(totals).getByTestId('remaining-total')).toHaveTextContent('$200.00');

    expect(getBudgets).toHaveBeenCalledWith(currentMonth);
  });

  it('requests the previous month when ◀ is pressed', async () => {
    getBudgets.mockResolvedValue(payload());

    renderPage();
    await waitFor(() => expect(screen.getByText('Groceries')).toBeInTheDocument());

    getBudgets.mockResolvedValue(
      payload({
        month: previousMonth,
        budgets: [budget({ month: previousMonth, history: history(previousMonth) })],
      })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));

    await waitFor(() => {
      expect(getBudgets).toHaveBeenLastCalledWith(previousMonth);
    });
  });

  it('cannot go past next month', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Groceries')).toBeInTheDocument());

    const next = screen.getByRole('button', { name: 'Next month' });
    expect(next).not.toBeDisabled();

    fireEvent.click(next);

    await waitFor(() => {
      expect(getBudgets).toHaveBeenLastCalledWith(monthOffset(1));
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled();
    });
  });

  it('shows the rollover amount when money carried in', async () => {
    getBudgets.mockResolvedValue(
      payload({
        budgets: [
          budget({
            rollover: true,
            rolloverIn: 75,
            available: 475,
            remaining: 275,
            history: history(currentMonth),
          }),
        ],
        totals: { budgeted: 400, spent: 200, available: 475, remaining: 275 },
      })
    );

    renderPage();

    const card = await screen.findByTestId('budget-card-budget-1');
    expect(within(card).getByTestId('rollover-budget-1')).toHaveTextContent(
      'includes $75.00 rolled over'
    );
  });

  it('hides the rollover line when nothing carried in', async () => {
    renderPage();

    await screen.findByTestId('budget-card-budget-1');
    expect(screen.queryByTestId('rollover-budget-1')).toBeNull();
  });

  it('renders a six-month history chart for each budget', async () => {
    renderPage();

    const chart = await screen.findByTestId('history-budget-1');
    // Six months of spending bars, plus the dashed line where the budget sits.
    await waitFor(() => {
      expect(chart.querySelectorAll('.recharts-bar-rectangle')).toHaveLength(6);
    });
    expect(chart.querySelector('line[stroke-dasharray]')).not.toBeNull();
    // Month labels on the axis.
    expect(chart.textContent).toContain('Nov');
  });

  it('creates a budget with a rollover flag and a start month', async () => {
    vi.mocked(budgetAPI.createBudget).mockResolvedValue({ budget: budget() });

    renderPage();
    await waitFor(() => expect(screen.getByText('Groceries')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Create Budget' }));

    const dialog = screen.getByRole('dialog', { name: 'Create budget' });

    fireEvent.change(within(dialog).getByPlaceholderText('e.g., Groceries, Entertainment'), {
      target: { value: 'Dining out' },
    });
    fireEvent.change(within(dialog).getByRole('combobox'), {
      target: { value: 'Food & Dining' },
    });
    fireEvent.change(within(dialog).getByPlaceholderText('0.00'), { target: { value: '250' } });
    fireEvent.click(within(dialog).getByLabelText('Roll over unused money to next month'));

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Budget' }));

    await waitFor(() => {
      expect(budgetAPI.createBudget).toHaveBeenCalledWith({
        name: 'Dining out',
        category: 'Food & Dining',
        amount: 250,
        rollover: true,
        startMonth: currentMonth,
      });
    });
  });

  it('shows a duplicate category error inline', async () => {
    vi.mocked(budgetAPI.createBudget).mockRejectedValue({
      response: { data: { error: 'You already have a budget for Food & Dining' } },
    });

    renderPage();
    await waitFor(() => expect(screen.getByText('Groceries')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Create Budget' }));
    const dialog = screen.getByRole('dialog', { name: 'Create budget' });

    fireEvent.change(within(dialog).getByPlaceholderText('e.g., Groceries, Entertainment'), {
      target: { value: 'Dining out' },
    });
    fireEvent.change(within(dialog).getByPlaceholderText('0.00'), { target: { value: '250' } });
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'Food & Dining' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Budget' }));

    await waitFor(() => {
      expect(
        within(screen.getByRole('dialog', { name: 'Create budget' })).getByText(
          'You already have a budget for Food & Dining'
        )
      ).toBeInTheDocument();
    });
  });

  it('renders existing alerts and allows management', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('1 alert active')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Manage' }));

    await waitFor(() => {
      expect(screen.getByText('Manage Alerts')).toBeInTheDocument();
      expect(screen.getByText('Approaching budget • 80%')).toBeInTheDocument();
    });

    const alertsDialog = screen.getByRole('dialog', { name: 'Manage alerts' });

    fireEvent.click(within(alertsDialog).getByRole('button', { name: 'Enabled' }));
    await waitFor(() => {
      expect(updateAlert).toHaveBeenCalled();
    });

    fireEvent.change(within(alertsDialog).getByRole('spinbutton'), { target: { value: '90' } });
    fireEvent.click(within(alertsDialog).getByRole('button', { name: 'Add Alert' }));
    await waitFor(() => {
      expect(createAlert).toHaveBeenCalled();
    });

    // The new alert was added to the list, so there are now two Remove buttons.
    await waitFor(() => {
      expect(within(alertsDialog).getAllByRole('button', { name: 'Remove' })).toHaveLength(2);
    });
    fireEvent.click(within(alertsDialog).getAllByRole('button', { name: 'Remove' })[0]);
    await waitFor(() => {
      expect(deleteAlert).toHaveBeenCalledWith('budget-1', 'alert-1');
    });
  });
});
