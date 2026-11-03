import type { ReactNode } from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import BudgetPage from './Budgets';
import { budgetAPI } from '../services/api';

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ logout: vi.fn(), user: null }),
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('../services/api', () => {
  const now = new Date().toISOString();

  return {
    budgetAPI: {
      getBudgets: vi.fn().mockResolvedValue({
        budgets: [
          {
            id: 'budget-1',
            name: 'Groceries',
            category: 'Food & Dining',
            amount: 400,
            period: 'MONTHLY',
            spent: 200,
            remaining: 200,
            percentUsed: 50,
            isActive: true,
            startDate: now,
            updatedAt: now,
            createdAt: now,
            budgetAlerts: [
              {
                id: 'alert-1',
                thresholdPercent: 80,
                alertType: 'BUDGET_APPROACHING',
                isEnabled: true,
                emailEnabled: true,
                createdAt: now,
                updatedAt: now,
              },
            ],
          },
        ],
      }),
      createAlert: vi.fn().mockResolvedValue({
        alert: {
          id: 'alert-2',
          thresholdPercent: 90,
          alertType: 'SPENDING_THRESHOLD',
          isEnabled: true,
          emailEnabled: false,
          createdAt: now,
          updatedAt: now,
        },
      }),
      updateAlert: vi.fn().mockResolvedValue({
        alert: {
          id: 'alert-1',
          thresholdPercent: 80,
          alertType: 'BUDGET_APPROACHING',
          isEnabled: false,
          emailEnabled: true,
          createdAt: now,
          updatedAt: now,
        },
      }),
      deleteAlert: vi.fn().mockResolvedValue({}),
    },
    transactionAPI: {
      getSpendingByCategory: vi.fn().mockResolvedValue({ categories: [] }),
    },
  };
});

describe('Budget Alerts UI', () => {
  it('renders existing alerts and allows management', async () => {
    render(
      <MemoryRouter>
        <BudgetPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Groceries')).toBeInTheDocument();
      expect(screen.getByText('1 alert active')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Manage' }));

    await waitFor(() => {
      expect(screen.getByText('Manage Alerts')).toBeInTheDocument();
      expect(screen.getByText('Approaching budget • 80%')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Enabled' }));
    await waitFor(() => {
      expect(budgetAPI.updateAlert).toHaveBeenCalled();
    });

    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '90' } });
    fireEvent.click(screen.getByText('Add Alert'));
    await waitFor(() => {
      expect(budgetAPI.createAlert).toHaveBeenCalled();
    });

    fireEvent.click(screen.getAllByText('Remove')[0]);
    await waitFor(() => {
      expect(budgetAPI.deleteAlert).toHaveBeenCalled();
    });
  });
});
