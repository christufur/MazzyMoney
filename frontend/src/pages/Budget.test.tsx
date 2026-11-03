import type { ReactNode } from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, beforeEach, describe, it, expect } from 'vitest';
import BudgetPage from './Budgets';
import { budgetAPI } from '../services/api';
import type { Budget, BudgetMonthResponse } from '../services/api';

// Radix's Checkbox measures itself with a ResizeObserver; jsdom has none.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (!('ResizeObserver' in globalThis)) {
  (globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver = ResizeObserverStub;
}
// Radix's Select scrolls the highlighted option into view; jsdom has no layout.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

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
    categoryAPI: {
      getAll: vi.fn().mockResolvedValue({
        categories: ['Food & Dining', 'Groceries', 'Shopping', 'Transportation', 'Entertainment', 'Bills & Utilities', 'Other'],
      }),
    },
    transactionAPI: {
      getReviewCount: vi.fn().mockResolvedValue({ count: 0 }),
      getSpendingByCategory: vi.fn().mockResolvedValue({ categories: [] }),
    },
  };
});

const getBudgets = vi.mocked(budgetAPI.getBudgets);
const updateAlert = vi.mocked(budgetAPI.updateAlert);
const createAlert = vi.mocked(budgetAPI.createAlert);
const deleteAlert = vi.mocked(budgetAPI.deleteAlert);
const deleteBudget = vi.mocked(budgetAPI.deleteBudget);

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

const history = (month: string, budgeted = 400) =>
  Array.from({ length: 6 }, (_, index) => {
    const [year, monthNumber] = month.split('-').map(Number);
    return {
      month: new Date(Date.UTC(year, monthNumber - 6 + index, 1)).toISOString().slice(0, 7),
      budgeted,
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

/** A budget's ledger row, whose header toggles its history and actions. */
const expandRow = (id = 'budget-1') => fireEvent.click(screen.getByTestId(`budget-row-${id}`));

/**
 * Radix's Select opens from the keyboard without pointer capture, which jsdom
 * lacks. Open it, then click the option in the listbox.
 */
const pickCategory = async (dialog: HTMLElement, value: string) => {
  const trigger = within(dialog).getByRole('combobox', { name: 'Category' });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const listbox = await screen.findByRole('listbox');
  fireEvent.click(within(listbox).getByRole('option', { name: value }));
};

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
    deleteBudget.mockResolvedValue(undefined);
  });

  it('renders the month, the three totals, and one ledger row per budget', async () => {
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
    expect(screen.getByTestId('budget-month-position')).toHaveTextContent('This month');

    const totals = screen.getByTestId('budget-totals');
    expect(within(totals).getByText('Budgeted')).toBeInTheDocument();
    expect(within(totals).getByTestId('budgeted-total')).toHaveTextContent('$400');
    expect(within(totals).getByText('Spent')).toBeInTheDocument();
    expect(within(totals).getByTestId('spent-total')).toHaveTextContent('$200');
    expect(within(totals).getByText('Left')).toBeInTheDocument();
    expect(within(totals).getByTestId('remaining-total')).toHaveTextContent('$200');

    // One row, and its actions stay folded away until the row is opened.
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();

    expect(getBudgets).toHaveBeenCalledWith(currentMonth);
  });

  it('requests the previous month when the previous arrow is pressed', async () => {
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

  it('marks a line that went past its amount, and says what happens next', async () => {
    getBudgets.mockResolvedValue(
      payload({
        budgets: [
          budget({
            spent: 450,
            remaining: -50,
            percentUsed: 112.5,
            history: history(currentMonth),
          }),
        ],
        totals: { budgeted: 400, spent: 450, available: 400, remaining: -50 },
      })
    );

    renderPage();

    const totals = await screen.findByTestId('budget-totals');
    expect(within(totals).getByTestId('remaining-total')).toHaveTextContent('−$50');
    expect(within(totals).getByTestId('remaining-total')).toHaveClass('text-terra');

    // The row says how far past it is, and the footnote says what happens next.
    expect(screen.getByText('$50 over')).toBeInTheDocument();
    expect(
      screen.getByText('Groceries went past the amount in November 2026. It starts fresh next month.')
    ).toBeInTheDocument();
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

    const row = await screen.findByTestId('budget-card-budget-1');
    expect(within(row).getByTestId('rollover-budget-1')).toHaveTextContent(
      'includes $75.00 rolled over'
    );
  });

  it('hides the rollover line when nothing carried in', async () => {
    renderPage();

    await screen.findByTestId('budget-card-budget-1');
    expect(screen.queryByTestId('rollover-budget-1')).toBeNull();
  });

  it('opens a budget to show its six-month history chart', async () => {
    renderPage();

    await screen.findByTestId('budget-row-budget-1');
    expect(screen.queryByTestId('history-budget-1')).toBeNull();

    expandRow();

    const chart = await screen.findByTestId('history-budget-1');
    // Six months of spending bars, plus the dashed line where the budget sits.
    await waitFor(() => {
      expect(chart.querySelectorAll('.recharts-bar-rectangle')).toHaveLength(6);
    });
    expect(chart.querySelector('line[stroke-dasharray]')).not.toBeNull();
    // Month labels on the axis.
    expect(chart.textContent).toContain('Nov');
  });

  it('puts every history chart on one fixed scale', async () => {
    getBudgets.mockResolvedValue(
      payload({
        budgets: [
          budget({ month: currentMonth, history: history(currentMonth) }),
          budget({
            id: 'budget-2',
            name: 'Rent',
            category: 'Housing',
            amount: 1000,
            budgeted: 1000,
            available: 1000,
            spent: 1000,
            remaining: 0,
            percentUsed: 100,
            history: history(currentMonth, 1000),
          }),
        ],
        totals: { budgeted: 1400, spent: 1200, available: 1400, remaining: 200 },
      })
    );

    renderPage();
    await screen.findByTestId('budget-row-budget-2');

    expandRow('budget-1');
    const small = await screen.findByTestId('history-budget-1');
    // The small budget's axis reaches the same top as the large one, not just its own $400.
    await waitFor(() => expect(small.textContent).toContain('$1,100'));
  });

  it('creates a budget with a rollover flag and a start month', async () => {
    vi.mocked(budgetAPI.createBudget).mockResolvedValue({ budget: budget() });

    renderPage();
    await waitFor(() => expect(screen.getByText('Groceries')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'New budget' }));

    const dialog = screen.getByRole('dialog', { name: 'New budget' });

    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Dining out' } });
    await pickCategory(dialog, 'Food & Dining');
    fireEvent.change(within(dialog).getByLabelText('Monthly amount'), { target: { value: '250' } });
    fireEvent.click(within(dialog).getByLabelText('Roll over unused money to next month'));

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save budget' }));

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

  it('shows validation errors under the fields', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Groceries')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'New budget' }));
    const dialog = screen.getByRole('dialog', { name: 'New budget' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save budget' }));

    expect(await within(dialog).findByText('Give this budget a name.')).toBeInTheDocument();
    expect(within(dialog).getByText('Pick a category.')).toBeInTheDocument();
    expect(within(dialog).getByText('Enter an amount above $0.')).toBeInTheDocument();
    expect(budgetAPI.createBudget).not.toHaveBeenCalled();
  });

  it('shows a duplicate category error inline', async () => {
    vi.mocked(budgetAPI.createBudget).mockRejectedValue({
      response: { data: { error: 'You already have a budget for Food & Dining' } },
    });

    renderPage();
    await waitFor(() => expect(screen.getByText('Groceries')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'New budget' }));
    const dialog = screen.getByRole('dialog', { name: 'New budget' });

    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Dining out' } });
    fireEvent.change(within(dialog).getByLabelText('Monthly amount'), { target: { value: '250' } });
    await pickCategory(dialog, 'Food & Dining');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save budget' }));

    await waitFor(() => {
      expect(
        within(screen.getByRole('dialog', { name: 'New budget' })).getByText(
          'You already have a budget for Food & Dining'
        )
      ).toBeInTheDocument();
    });
  });

  it('edits a budget from its expanded row', async () => {
    vi.mocked(budgetAPI.updateBudget).mockResolvedValue({ budget: budget({ name: 'Food' }) });

    renderPage();
    await screen.findByTestId('budget-row-budget-1');
    expandRow();

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit budget' });

    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Food' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(budgetAPI.updateBudget).toHaveBeenCalledWith('budget-1', {
        name: 'Food',
        category: 'Food & Dining',
        amount: 400,
        rollover: false,
      });
    });
  });

  it('asks before deleting a budget', async () => {
    renderPage();
    await screen.findByTestId('budget-row-budget-1');
    expandRow();

    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    const confirm = screen.getByRole('alertdialog');
    expect(within(confirm).getByText(/Groceries/)).toBeInTheDocument();
    expect(deleteBudget).not.toHaveBeenCalled();

    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleteBudget).toHaveBeenCalledWith('budget-1'));
  });

  it('renders existing alerts and allows management', async () => {
    renderPage();

    await screen.findByTestId('budget-row-budget-1');
    expandRow();

    fireEvent.click(await screen.findByRole('button', { name: 'Alerts, 1 active' }));

    const alertsDialog = await screen.findByRole('dialog', { name: 'Alerts for Groceries' });
    expect(within(alertsDialog).getByText('Approaching budget · 80%')).toBeInTheDocument();

    fireEvent.click(within(alertsDialog).getByLabelText('On'));
    await waitFor(() => {
      expect(updateAlert).toHaveBeenCalledWith('budget-1', 'alert-1', { isEnabled: false });
    });

    fireEvent.change(within(alertsDialog).getByLabelText('At this percent'), { target: { value: '90' } });
    fireEvent.click(within(alertsDialog).getByRole('button', { name: 'Add alert' }));
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

  it('offers the empty state with one sentence and one button', async () => {
    getBudgets.mockResolvedValue({
      month: currentMonth,
      budgets: [],
      totals: { budgeted: 0, spent: 0, available: 0, remaining: 0 },
    });

    renderPage();

    expect(
      await screen.findByText(
        new RegExp(
          `^No budgets in ${new Date(`${currentMonth}-01T00:00:00Z`).toLocaleDateString('en-US', {
            timeZone: 'UTC',
            month: 'long',
            year: 'numeric',
          })} — a budget is a monthly amount for one category`
        )
      )
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Plan a budget' })).toBeInTheDocument();
  });
});
