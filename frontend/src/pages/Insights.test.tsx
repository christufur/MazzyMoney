import type { ReactNode } from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, beforeEach, describe, it, expect } from 'vitest';
import InsightsPage from './Insights';
import { analyticsAPI, transactionAPI } from '../services/api';

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ logout: vi.fn(), user: null }),
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}));

// jsdom has no layout, so ResponsiveContainer would measure 0x0 and draw nothing.
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactNode }) => (
      <actual.ResponsiveContainer width={600} height={240}>
        {children}
      </actual.ResponsiveContainer>
    ),
  };
});

vi.mock('../services/api', () => ({
  transactionAPI: {
    getTransactions: vi.fn(),
    getSpendingByCategory: vi.fn(),
    getMonthlyTrends: vi.fn(),
    getReviewCount: vi.fn().mockResolvedValue({ count: 0 }),
  },
  analyticsAPI: {
    getInsights: vi.fn(),
    getMerchants: vi.fn(),
  },
}));

const getTransactions = vi.mocked(transactionAPI.getTransactions);
const getSpendingByCategory = vi.mocked(transactionAPI.getSpendingByCategory);
const getMonthlyTrends = vi.mocked(transactionAPI.getMonthlyTrends);
const getInsights = vi.mocked(analyticsAPI.getInsights);
const getMerchants = vi.mocked(analyticsAPI.getMerchants);

const listResponse = (income: number, expenses: number) => ({
  transactions: [],
  pagination: { currentPage: 1, totalPages: 1, totalCount: 0, hasNext: false, hasPrev: false },
  summary: {
    totalTransactions: 0,
    totalAmount: 0,
    income,
    incomeCount: 1,
    expenses,
    expenseCount: 4,
    netAmount: income - expenses,
  },
});

const categoryRows = [
  { category: 'Housing', amount: 1400, transactionCount: 1 },
  { category: 'Groceries', amount: 600, transactionCount: 9 },
  { category: 'Transportation', amount: 200, transactionCount: 5 },
];

const trends = [
  { month: new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' }), income: 5000, expenses: 2200 },
];

const renderPage = () =>
  render(
    <MemoryRouter>
      <InsightsPage />
    </MemoryRouter>
  );

/** The start of the period the page asks for, counted from the same clock the page uses. */
const monthsAgoStart = (monthsBack: number) => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
  return `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-01`;
};

describe('Reports page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTransactions.mockResolvedValue(listResponse(5000, 2200));
    getSpendingByCategory.mockResolvedValue(categoryRows);
    getMonthlyTrends.mockResolvedValue(trends);
    getInsights.mockResolvedValue({ insights: [] });
    getMerchants.mockResolvedValue({ merchants: [] });
  });

  it('renders income, spending, and net from the summary', async () => {
    renderPage();

    const figures = await screen.findByTestId('figures');
    expect(within(figures).getByText('Income')).toBeInTheDocument();
    expect(within(figures).getByText('$5,000')).toBeInTheDocument();
    expect(within(figures).getByText('Spending')).toBeInTheDocument();
    expect(within(figures).getByText('$2,200')).toBeInTheDocument();
    expect(within(figures).getByText('Net')).toBeInTheDocument();
    expect(within(figures).getByText('$2,800')).toBeInTheDocument();
    expect(screen.getByText('You kept 56% of your income.')).toBeInTheDocument();
  });

  it('shows a negative net with a real minus sign, never terra', async () => {
    getTransactions.mockResolvedValue(listResponse(1000, 1600));
    renderPage();

    const figures = await screen.findByTestId('figures');
    const net = within(figures).getByText('−$600');
    expect(net).toBeInTheDocument();
    expect(net.className).not.toContain('text-terra');
    expect(screen.getByText('Spending was 60% more than income.')).toBeInTheDocument();
  });

  it('ranks the category ledger from the largest category down', async () => {
    renderPage();

    const ledger = await screen.findByTestId('category-ledger');
    const names = Array.from(ledger.querySelectorAll('li')).map((row) =>
      row.firstElementChild?.textContent
    );
    expect(names).toEqual(['Housing', 'Groceries', 'Transportation']);

    // The largest category is 100% of the bar scale and 64% of spending.
    const first = ledger.querySelectorAll('li')[0];
    expect(within(first as HTMLElement).getByText('$1,400.00')).toBeInTheDocument();
    expect(within(first as HTMLElement).getByText('64%')).toBeInTheDocument();
  });

  it('rolls categories past the eighth into Other', async () => {
    const rows = Array.from({ length: 9 }, (_, index) => ({
      category: `Category ${index + 1}`,
      amount: 100 - index,
    }));
    getSpendingByCategory.mockResolvedValue(rows);
    // The summary is the whole period, so the rows add up to it here.
    getTransactions.mockResolvedValue(listResponse(1000, rows.reduce((sum, row) => sum + row.amount, 0)));

    renderPage();

    const ledger = await screen.findByTestId('category-ledger');
    const names = Array.from(ledger.querySelectorAll('li')).map((row) =>
      row.firstElementChild?.textContent
    );
    expect(names).toHaveLength(9);
    expect(names[8]).toBe('Other');
    // The ninth category is folded into Other.
    expect(within(ledger.querySelectorAll('li')[8] as HTMLElement).getByText('$92.00')).toBeInTheDocument();
  });

  it('keeps the ledger honest when spending has no category', async () => {
    getSpendingByCategory.mockResolvedValue([{ category: 'Housing', amount: 1000 }]);
    getTransactions.mockResolvedValue(listResponse(2000, 1500));

    renderPage();

    const ledger = await screen.findByTestId('category-ledger');
    await waitFor(() => {
      expect(within(ledger).getByText('Not categorized')).toBeInTheDocument();
    });
    expect(within(ledger).getByText('$500.00')).toBeInTheDocument();
  });

  it('prints no NaN when last month had no spending to compare with', async () => {
    getInsights.mockResolvedValue({
      insights: [{ category: 'Groceries', change: 82, percentChange: null }],
    });
    renderPage();

    await screen.findByTestId('category-ledger');
    await waitFor(() => {
      expect(screen.getByText(/Groceries is up \$82/)).toBeInTheDocument();
    });
    expect(document.body.textContent).not.toContain('NaN');
    expect(document.body.textContent).not.toContain('Infinity');
  });

  it('asks for the new date range when the period changes', async () => {
    renderPage();
    await screen.findByTestId('category-ledger');

    expect(getTransactions.mock.calls[0][0]).toMatchObject({ dateFrom: monthsAgoStart(2) });

    fireEvent.click(screen.getByRole('button', { name: '1Y' }));

    await waitFor(() => {
      expect(getTransactions).toHaveBeenLastCalledWith(
        expect.objectContaining({ dateFrom: monthsAgoStart(11) })
      );
    });
    expect(getSpendingByCategory).toHaveBeenLastCalledWith(
      expect.objectContaining({ dateFrom: monthsAgoStart(11) })
    );
  });

  it('says so when the period has no transactions', async () => {
    getTransactions.mockResolvedValue(listResponse(0, 0));
    getSpendingByCategory.mockResolvedValue([]);
    renderPage();

    expect(
      await screen.findByText('No transactions in this period. Try a longer period.')
    ).toBeInTheDocument();
    expect(screen.getByText('No spending recorded in this period.')).toBeInTheDocument();
  });

  it('shows an inline error with a retry', async () => {
    getTransactions.mockRejectedValueOnce(new Error('offline'));
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the report.');

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId('figures')).toBeInTheDocument();
  });
});
