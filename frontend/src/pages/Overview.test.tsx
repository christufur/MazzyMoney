import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, beforeEach, describe, it, expect } from 'vitest';
import type { ReactNode } from 'react';
import Overview from './Overview';
import { accountAPI, budgetAPI, networthAPI, recurringAPI, transactionAPI } from '../services/api';

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ logout: vi.fn(), user: null }),
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('../services/api', () => ({
  accountAPI: { getAccounts: vi.fn() },
  budgetAPI: { getBudgets: vi.fn() },
  networthAPI: { get: vi.fn() },
  recurringAPI: { getAll: vi.fn() },
  transactionAPI: {
    getTransactions: vi.fn(),
    getSyncStatus: vi.fn(),
    getReviewCount: vi.fn(),
    syncTransactions: vi.fn(),
  },
}));

const getTransactions = vi.mocked(transactionAPI.getTransactions);

beforeEach(() => {
  vi.mocked(accountAPI.getAccounts).mockResolvedValue({ connected: false, accounts: [] } as any);
  vi.mocked(budgetAPI.getBudgets).mockResolvedValue({
    month: '2026-11',
    budgets: [],
    totals: { budgeted: 0, spent: 0, available: 0, remaining: 0 },
  } as any);
  vi.mocked(networthAPI.get).mockResolvedValue({
    current: { assets: 0, liabilities: 0, netWorth: 0 },
    change: { amount: 0, percent: null },
    points: [],
    accounts: [],
  } as any);
  vi.mocked(recurringAPI.getAll).mockResolvedValue({ series: [], monthlyTotal: 0, upcoming: [] } as any);
  vi.mocked(transactionAPI.getSyncStatus).mockResolvedValue({ connected: false, status: 'ACTIVE', lastSyncAt: null } as any);
  vi.mocked(transactionAPI.getReviewCount).mockResolvedValue({ count: 0 });

  // The month's figures, then the review panel: the queue request is the one with `reviewed: false`.
  getTransactions.mockResolvedValue({
    transactions: [],
    pagination: { currentPage: 1, totalPages: 0, totalCount: 0, hasNext: false, hasPrev: false },
    summary: { income: 0, expenses: 0, netAmount: 0, totalTransactions: 0 },
  } as any);

  getTransactions.mockImplementation(async (params: any) => {
    const total = params?.reviewed === false ? 4 : 0;
    return {
      transactions:
        params?.reviewed === false
          ? [{ id: 'rv-1', date: '2026-11-01T12:00:00.000Z', name: 'Blue Bottle', amount: 6.75 }]
          : [],
      pagination: { currentPage: 1, totalPages: 1, totalCount: total, hasNext: false, hasPrev: false },
      summary: { income: 0, expenses: 6.75, netAmount: -6.75, totalTransactions: 0 },
    } as any;
  });
});

describe('Overview', () => {
  it('sends the review button into the review queue', async () => {
    render(
      <MemoryRouter initialEntries={['/overview']}>
        <Overview />
      </MemoryRouter>
    );

    const button = await screen.findByRole('link', { name: 'Review 4 transactions' });
    expect(button).toHaveAttribute('href', '/transactions?review=1');
  });
});
