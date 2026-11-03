import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest';
import type { ReactNode } from 'react';
import TransactionsPage from './Transactions';
import { accountAPI, categoryAPI, transactionAPI } from '../services/api';

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ logout: vi.fn(), user: null }),
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('../services/api', () => ({
  transactionAPI: {
    getTransactions: vi.fn(),
    getReviewCount: vi.fn(),
    bulkUpdate: vi.fn(),
    update: vi.fn(),
    updateNotes: vi.fn(),
    updateCategory: vi.fn(),
  },
  categoryAPI: {
    getAll: vi.fn(),
  },
  accountAPI: {
    getAccounts: vi.fn(),
  },
}));

const getTransactions = vi.mocked(transactionAPI.getTransactions);
const getReviewCount = vi.mocked(transactionAPI.getReviewCount);
const bulkUpdate = vi.mocked(transactionAPI.bulkUpdate);
const updateTransaction = vi.mocked(transactionAPI.update);
const getAllCategories = vi.mocked(categoryAPI.getAll);
const getAccounts = vi.mocked(accountAPI.getAccounts);

const row = (id: string, overrides: Record<string, any> = {}) => ({
  id,
  name: `Raw ${id}`,
  merchantName: null,
  merchantDisplay: null,
  amount: 12.5,
  date: '2026-06-15T12:00:00.000Z',
  pending: false,
  isTransfer: false,
  hidden: false,
  reviewed: false,
  primaryCategory: 'Groceries',
  categorySource: 'PLAID',
  notes: null,
  account: {
    id: 'account-1',
    name: 'Everyday Checking',
    mask: '4321',
    type: 'depository',
    subtype: 'checking',
  },
  ...overrides,
});

const pageResponse = (overrides: Record<string, any> = {}) => ({
  transactions: [
    row('tx-1', { merchantDisplay: 'Whole Foods', name: 'WHOLEFDS MKT 123' }),
    row('tx-2', { name: 'Corner Shop', amount: -100 }),
  ],
  pagination: {
    currentPage: 1,
    totalPages: 3,
    totalCount: 120,
    hasNext: true,
    hasPrev: false,
  },
  summary: {
    totalTransactions: 2,
    totalAmount: -87.5,
    income: 100,
    incomeCount: 1,
    expenses: 12.5,
    expenseCount: 1,
    netAmount: 87.5,
  },
  ...overrides,
});

const emptyPage = () => ({
  transactions: [],
  pagination: { currentPage: 0, totalPages: 0, totalCount: 0, hasNext: false, hasPrev: false },
  summary: null,
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <TransactionsPage />
    </MemoryRouter>
  );

beforeEach(() => {
  getTransactions.mockResolvedValue(pageResponse() as any);
  getReviewCount.mockResolvedValue({ count: 3 });
  bulkUpdate.mockResolvedValue({ updated: 2 });
  updateTransaction.mockResolvedValue({ success: true } as any);
  getAllCategories.mockResolvedValue({ categories: ['Groceries', 'Travel', 'Other'] });
  getAccounts.mockResolvedValue({
    accounts: [{ id: 'account-1', name: 'Everyday Checking', mask: '4321' }],
  } as any);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('Transactions page', () => {
  it('renders the cached rows and the summary from the API', async () => {
    renderPage();

    // The display name wins over the raw bank text, which stays visible underneath.
    expect(await screen.findByText('Whole Foods')).toBeInTheDocument();
    expect(screen.getByText('WHOLEFDS MKT 123')).toBeInTheDocument();
    expect(screen.getByText('Corner Shop')).toBeInTheDocument();

    // Account name and mask on each row (the filter has an option with the same text).
    expect(screen.getAllByText('Everyday Checking ••4321').length).toBeGreaterThanOrEqual(2);

    // Money out is red and signed with a minus, money in is green with a plus.
    const spending = screen.getAllByText('−$12.50')[0];
    expect(spending).toHaveClass('text-red-600');
    const income = screen.getAllByText('+$100.00')[0];
    expect(income).toHaveClass('text-green-600');

    // The three summary cards come from the API's summary, not from the visible rows.
    const summary = screen.getByRole('group', { name: 'Summary' });
    expect(within(summary).getByText('Income')).toBeInTheDocument();
    expect(within(summary).getByText('Spending')).toBeInTheDocument();
    expect(within(summary).getByText('Net')).toBeInTheDocument();
    expect(within(summary).getByText('+$100.00')).toBeInTheDocument();
    expect(within(summary).getByText('−$12.50')).toBeInTheDocument();
    expect(within(summary).getByText('+$87.50')).toBeInTheDocument();

    expect(screen.getByRole('tab', { name: 'Needs review (3)' })).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();

    expect(getTransactions).toHaveBeenCalledWith(expect.objectContaining({ page: 1, limit: 50 }));
  });

  it('shows the Pending and Transfer badges', async () => {
    getTransactions.mockResolvedValue(
      pageResponse({
        transactions: [row('tx-3', { name: 'Pending row', pending: true, isTransfer: true })],
      }) as any
    );

    renderPage();

    expect(await screen.findByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('Transfer')).toBeInTheDocument();
  });

  it('sends reviewed=false on the Needs review tab', async () => {
    renderPage();

    await screen.findByText('Whole Foods');
    // The first page load is the unfiltered list.
    expect(getTransactions.mock.calls[0][0]).not.toHaveProperty('reviewed');

    fireEvent.click(screen.getByRole('tab', { name: 'Needs review (3)' }));

    await waitFor(() =>
      expect(getTransactions).toHaveBeenLastCalledWith(expect.objectContaining({ reviewed: false }))
    );
  });

  it('bulk-updates the two selected rows with the chosen category', async () => {
    renderPage();

    await screen.findByText('Whole Foods');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Whole Foods' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Corner Shop' }));

    expect(screen.getByText('2 selected')).toBeInTheDocument();

    const bulkCategory = screen.getByRole('combobox', {
      name: 'Set category for selected transactions',
    });
    fireEvent.change(bulkCategory, { target: { value: 'Travel' } });

    await waitFor(() =>
      expect(bulkUpdate).toHaveBeenCalledWith(['tx-1', 'tx-2'], { category: 'Travel' })
    );

    // The list and the review count both reload after a bulk edit.
    await waitFor(() => expect(getTransactions.mock.calls.length).toBeGreaterThan(1));
    await waitFor(() => expect(getReviewCount.mock.calls.length).toBeGreaterThan(1));
  });

  it('marks one row reviewed through PUT /:id', async () => {
    renderPage();

    await screen.findByText('Whole Foods');
    fireEvent.click(screen.getByRole('button', { name: 'Mark Whole Foods as reviewed' }));

    await waitFor(() => expect(updateTransaction).toHaveBeenCalledWith('tx-1', { reviewed: true }));
  });

  it('marks every row on the page reviewed from the review tab', async () => {
    renderPage();

    await screen.findByText('Whole Foods');
    fireEvent.click(screen.getByRole('tab', { name: 'Needs review (3)' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Mark all on this page reviewed' }));

    await waitFor(() =>
      expect(bulkUpdate).toHaveBeenCalledWith(['tx-1', 'tx-2'], { reviewed: true })
    );
  });

  it('requests page 2 on Next', async () => {
    renderPage();

    await screen.findByText('Whole Foods');

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() =>
      expect(getTransactions).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }))
    );
  });

  it('debounces the search and sends it to the API', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderPage();

      await screen.findByText('Whole Foods');
      fireEvent.change(screen.getByRole('searchbox', { name: 'Search transactions' }), {
        target: { value: 'jordan' },
      });

      await vi.advanceTimersByTimeAsync(400);

      await waitFor(() =>
        expect(getTransactions).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'jordan' }))
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends the category, account, range, and type filters to the API', async () => {
    renderPage();

    await screen.findByText('Whole Foods');

    fireEvent.change(screen.getByRole('combobox', { name: 'Category' }), {
      target: { value: 'Travel' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Account' }), {
      target: { value: 'account-1' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Type' }), {
      target: { value: 'income' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Date range' }), {
      target: { value: 'all' },
    });

    await waitFor(() =>
      expect(getTransactions).toHaveBeenLastCalledWith(
        expect.objectContaining({
          category: 'Travel',
          accountId: 'account-1',
          type: 'income',
          page: 1,
        })
      )
    );

    const lastParams = getTransactions.mock.calls[getTransactions.mock.calls.length - 1][0] as any;
    expect(lastParams).not.toHaveProperty('dateFrom');
  });

  it('shows the empty state when nothing matches and an inline error when the request fails', async () => {
    getTransactions.mockResolvedValue(emptyPage() as any);

    const { unmount } = renderPage();
    expect(await screen.findByText('No transactions match these filters.')).toBeInTheDocument();
    unmount();

    getTransactions.mockRejectedValue({ response: { data: { error: 'Nope' } } });
    renderPage();

    expect(await screen.findByText('Nope')).toBeInTheDocument();
    expect(screen.queryByText('No transactions match these filters.')).not.toBeInTheDocument();
  });

  it('loads the category list once for the filter and the row selectors', async () => {
    renderPage();

    await screen.findByText('Whole Foods');

    // The filter dropdown uses the backend list.
    const filter = screen.getByRole('combobox', { name: 'Category' });
    expect(within(filter).getByRole('option', { name: 'Travel' })).toBeInTheDocument();

    // Every row uses the same list, so opening a picker asks the API for nothing.
    fireEvent.click(screen.getAllByRole('button', { name: /Groceries/ })[0]);
    expect(await screen.findByRole('button', { name: 'Travel' })).toBeInTheDocument();

    expect(getAllCategories).toHaveBeenCalledTimes(1);
  });
});
