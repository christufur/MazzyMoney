import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi, beforeEach, describe, it, expect } from 'vitest';
import type { ReactNode } from 'react';
import CloseMonthPage from './CloseMonth';
import { budgetAPI, monthNoteAPI, transactionAPI } from '../services/api';

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ logout: vi.fn(), user: null }),
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('../services/api', () => ({
  budgetAPI: { getBudgets: vi.fn() },
  monthNoteAPI: { get: vi.fn(), save: vi.fn() },
  transactionAPI: { getTransactions: vi.fn(), getReviewCount: vi.fn() },
}));

const budget = (category: string, spent: number, available: number) =>
  ({ id: category, category, spent, available, rollover: false }) as any;

const note = (month: string, extra = {}) => ({ month, note: null, savingsTarget: null, closedAt: null, ...extra });

beforeEach(() => {
  vi.mocked(transactionAPI.getReviewCount).mockResolvedValue({ count: 0 });
  vi.mocked(transactionAPI.getTransactions).mockImplementation(async (params: any) => ({
    transactions: [],
    pagination: { currentPage: 1, totalPages: 0, totalCount: 0, hasNext: false, hasPrev: false },
    summary:
      params.dateFrom === '2026-10-01'
        ? { income: 5000, expenses: 3800, netAmount: 1200, totalTransactions: 0 }
        : { income: 4000, expenses: 3500, netAmount: 500, totalTransactions: 0 },
  }) as any);
  vi.mocked(budgetAPI.getBudgets).mockResolvedValue({
    month: '2026-10',
    budgets: [budget('Groceries', 400, 500), budget('Snacks', 80, 50)],
    totals: { budgeted: 0, spent: 0, available: 0, remaining: 0 },
  } as any);
  vi.mocked(monthNoteAPI.get).mockImplementation(async (month: string) =>
    note(month, month === '2026-10' ? { savingsTarget: 1000 } : {})
  );
  vi.mocked(monthNoteAPI.save).mockImplementation(async (month: string, changes: any) =>
    note(month, { ...changes, closedAt: changes.closed ? '2026-11-02T18:00:00.000Z' : null })
  );
});

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/close/:month" element={<CloseMonthPage />} />
        <Route path="/overview" element={<p>overview page</p>} />
      </Routes>
    </MemoryRouter>
  );

describe('CloseMonth', () => {
  it('shows the month in, out, and saved, with over-budget lines first', async () => {
    renderAt('/close/2026-10');

    expect(await screen.findByText('$1,200')).toBeInTheDocument();
    expect(screen.getByText('$5,000')).toBeInTheDocument();
    expect(screen.getByText(/You saved \$1,200 in October/)).toHaveTextContent('That meets your $1,000 target.');

    const lines = within(screen.getByRole('region', { name: 'Budgets' })).getAllByRole('listitem');
    expect(lines[0]).toHaveTextContent('Snacks');
    expect(lines[0]).toHaveTextContent('$30 over');
    expect(lines[1]).toHaveTextContent('$100 left');
  });

  it('closes the month with its note and sets the next month target', async () => {
    renderAt('/close/2026-10');
    await screen.findByText('$1,200');

    fireEvent.change(screen.getByLabelText('What would you keep or change?'), { target: { value: 'Fewer snacks.' } });
    fireEvent.change(screen.getByLabelText('Savings target for November'), { target: { value: '800' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close October' }));

    await waitFor(() => expect(monthNoteAPI.save).toHaveBeenCalledWith('2026-10', { note: 'Fewer snacks.', closed: true }));
    expect(monthNoteAPI.save).toHaveBeenCalledWith('2026-11', { savingsTarget: 800 });
    expect(await screen.findByText('Closed Nov 2, 2026')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
  });

  it('refuses a negative target', async () => {
    renderAt('/close/2026-10');
    await screen.findByText('$1,200');

    fireEvent.change(screen.getByLabelText('Savings target for November'), { target: { value: '-5' } });
    expect(screen.getByText('Enter an amount of 0 or more.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close October' })).toBeDisabled();
  });

  it('sends a bad or unfinished month back to the overview', async () => {
    renderAt('/close/2999-01');
    expect(await screen.findByText('overview page')).toBeInTheDocument();
  });
});
