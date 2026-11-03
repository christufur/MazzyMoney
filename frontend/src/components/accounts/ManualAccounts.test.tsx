import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest';
import ManualAccounts from './ManualAccounts';
import { accountAPI } from '../../services/api';
import type { AccountListItem } from '../../services/api';

vi.mock('../../services/api', () => ({
  accountAPI: {
    getAccounts: vi.fn(),
    createManual: vi.fn(),
    updateManual: vi.fn(),
    updateManualBalance: vi.fn(),
    deleteManual: vi.fn(),
    getManualHistory: vi.fn(),
  },
}));

const getAccounts = vi.mocked(accountAPI.getAccounts);
const createManual = vi.mocked(accountAPI.createManual);
const updateManualBalance = vi.mocked(accountAPI.updateManualBalance);
const deleteManual = vi.mocked(accountAPI.deleteManual);

const manualAccount = (overrides: Partial<AccountListItem> = {}): AccountListItem => ({
  id: 'acct-manual-1',
  account_id: 'acct-manual-1',
  name: 'Fidelity 401(k)',
  official_name: null,
  balances: { current: 25000, available: null, limit: null },
  type: 'retirement',
  subtype: 'retirement',
  mask: null,
  isManual: true,
  isLiability: false,
  ...overrides,
});

const plaidAccount = (): AccountListItem => ({
  id: 'acct-plaid-1',
  account_id: 'plaid-account-1',
  name: 'Plaid Checking',
  official_name: 'Everyday Checking',
  balances: { current: 1200, available: 1100, limit: null },
  type: 'depository',
  subtype: 'checking',
  mask: '1111',
  isManual: false,
  isLiability: false,
});

const accountsResponse = (accounts: AccountListItem[]) => ({ accounts });

beforeEach(() => {
  getAccounts.mockResolvedValue(accountsResponse([manualAccount(), plaidAccount()]));
  createManual.mockResolvedValue({ account: manualAccount({ id: 'acct-new', name: 'House' }) });
  updateManualBalance.mockResolvedValue({ account: manualAccount() });
  deleteManual.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('ManualAccounts', () => {
  it('lists only manual accounts, with liabilities shown as negative in red', async () => {
    getAccounts.mockResolvedValue(
      accountsResponse([
        manualAccount(),
        manualAccount({
          id: 'acct-loan',
          name: 'Car loan',
          type: 'loan',
          subtype: 'loan',
          balances: { current: 18000, available: null, limit: null },
          isLiability: true,
        }),
        plaidAccount(),
      ])
    );

    render(<ManualAccounts />);

    expect(await screen.findByText('Fidelity 401(k)')).toBeInTheDocument();
    expect(screen.getByText('Manual accounts')).toBeInTheDocument();
    expect(
      screen.getByText('For accounts Plaid does not connect: 401(k), car, house, cash.')
    ).toBeInTheDocument();

    // The Plaid account belongs to the bank list, not here.
    expect(screen.queryByText('Plaid Checking')).not.toBeInTheDocument();
    expect(getAccounts).toHaveBeenCalledTimes(1);

    expect(screen.getByText('$25,000.00')).toBeInTheDocument();

    const liabilityBalance = screen.getByText('-$18,000.00');
    expect(liabilityBalance).toBeInTheDocument();
    expect(liabilityBalance.className).toContain('text-red-600');

    const assetBalance = screen.getByText('$25,000.00');
    expect(assetBalance.className).not.toContain('text-red-600');
  });

  it('adds a manual account from the form', async () => {
    render(<ManualAccounts />);

    await screen.findByText('Fidelity 401(k)');

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'House' } });
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'property' } });
    fireEvent.change(screen.getByLabelText('Balance'), { target: { value: '450000' } });

    fireEvent.click(screen.getByRole('button', { name: 'Add account' }));

    await waitFor(() =>
      expect(createManual).toHaveBeenCalledWith({
        name: 'House',
        kind: 'property',
        balance: 450000,
        isLiability: false,
      })
    );

    // The list is reloaded after the create.
    await waitFor(() => expect(getAccounts).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText('Name')).toHaveValue('');
  });

  it('checks the liability box automatically for a loan', async () => {
    render(<ManualAccounts />);

    await screen.findByText('Fidelity 401(k)');

    const liabilityBox = screen.getByRole('checkbox', { name: 'This is a liability' }) as HTMLInputElement;
    expect(liabilityBox.checked).toBe(false);

    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'loan' } });
    expect(liabilityBox.checked).toBe(true);

    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'cash' } });
    expect(liabilityBox.checked).toBe(false);
  });

  it('shows a server error inline instead of an alert when adding fails', async () => {
    createManual.mockRejectedValue({
      response: { status: 400, data: { error: 'Kind must be one of: retirement, investment' } },
    });

    render(<ManualAccounts />);

    await screen.findByText('Fidelity 401(k)');

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'House' } });
    fireEvent.change(screen.getByLabelText('Balance'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add account' }));

    expect(await screen.findByText(/Kind must be one of/)).toBeInTheDocument();
    expect(createManual).toHaveBeenCalledTimes(1);
  });

  it('updates a balance for today after Save, then reloads', async () => {
    render(<ManualAccounts />);

    await screen.findByText('Fidelity 401(k)');

    fireEvent.click(screen.getByRole('button', { name: 'Update balance' }));

    const balanceInput = screen.getByLabelText('New balance for Fidelity 401(k)');
    expect(balanceInput).toHaveValue(25000);

    fireEvent.change(balanceInput, { target: { value: '27500.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(updateManualBalance).toHaveBeenCalledWith('acct-manual-1', 27500.5, undefined)
    );
    await waitFor(() => expect(getAccounts).toHaveBeenCalledTimes(2));
    // The inline editor closes again.
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it('back-fills a past balance with the date the user picks', async () => {
    render(<ManualAccounts />);

    await screen.findByText('Fidelity 401(k)');

    fireEvent.click(screen.getByRole('button', { name: 'Update balance' }));
    fireEvent.change(screen.getByLabelText('New balance for Fidelity 401(k)'), {
      target: { value: '24000' },
    });
    fireEvent.change(screen.getByLabelText('Balance date for Fidelity 401(k)'), {
      target: { value: '2025-06-30' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(updateManualBalance).toHaveBeenCalledWith('acct-manual-1', 24000, '2025-06-30')
    );
  });

  it('rejects a non-numeric balance before calling the API', async () => {
    render(<ManualAccounts />);

    await screen.findByText('Fidelity 401(k)');

    fireEvent.click(screen.getByRole('button', { name: 'Update balance' }));
    fireEvent.change(screen.getByLabelText('New balance for Fidelity 401(k)'), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Enter a number for the balance.')).toBeInTheDocument();
    expect(updateManualBalance).not.toHaveBeenCalled();
  });

  it('deletes an account after the confirmation, and keeps it when cancelled', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<ManualAccounts />);

    await screen.findByText('Fidelity 401(k)');

    const row = screen.getByText('Fidelity 401(k)').closest('li') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));

    expect(confirmSpy).toHaveBeenCalledWith(
      'Delete Fidelity 401(k)? Its balance history will be deleted too.'
    );
    expect(deleteManual).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleteManual).toHaveBeenCalledWith('acct-manual-1'));
    await waitFor(() => expect(getAccounts).toHaveBeenCalledTimes(2));
  });

  it('shows the empty state when the user has no manual accounts', async () => {
    getAccounts.mockResolvedValue(accountsResponse([plaidAccount()]));

    render(<ManualAccounts />);

    expect(
      await screen.findByText('No manual accounts yet. Add the 401(k), car, house, or cash below.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add account' })).toBeInTheDocument();
  });
});
