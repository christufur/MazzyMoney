import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import BudgetPage from './Budgets';
import '@testing-library/jest-dom';

jest.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ logout: jest.fn() }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('../services/api', () => {
  const original = jest.requireActual('../services/api');
  return {
    ...original,
    budgetAPI: {
      getBudgets: jest.fn().mockResolvedValue({
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
            startDate: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            budgetAlerts: [
              {
                id: 'alert-1',
                thresholdPercent: 80,
                alertType: 'BUDGET_APPROACHING',
                isEnabled: true,
                emailEnabled: true,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
              }
            ]
          }
        ]
      }),
      createAlert: jest.fn().mockResolvedValue({
        alert: {
          id: 'alert-2',
          thresholdPercent: 90,
          alertType: 'SPENDING_THRESHOLD',
          isEnabled: true,
          emailEnabled: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      }),
      updateAlert: jest.fn().mockResolvedValue({
        alert: {
          id: 'alert-1',
          thresholdPercent: 80,
          alertType: 'BUDGET_APPROACHING',
          isEnabled: false,
          emailEnabled: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      }),
      deleteAlert: jest.fn().mockResolvedValue({})
    },
    transactionAPI: {
      getSpendingByCategory: jest.fn().mockResolvedValue({ categories: [] })
    }
  };
});

const { budgetAPI } = require('../services/api');

describe('Budget Alerts UI', () => {
  it('renders existing alerts and allows management', async () => {
    render(
      <MemoryRouter>
        <BudgetPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Groceries')).toBeInTheDocument();
      expect(screen.getByText('Budget approaching • 80%')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Manage Alerts'));

    await waitFor(() => {
      expect(screen.getByText('Manage Alerts')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Enabled'));
    expect(budgetAPI.updateAlert).toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Threshold %'), { target: { value: '90' } });
    fireEvent.click(screen.getByText('Add Alert'));
    await waitFor(() => {
      expect(budgetAPI.createAlert).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByText('Remove'));
    await waitFor(() => {
      expect(budgetAPI.deleteAlert).toHaveBeenCalled();
    });
  });
});

