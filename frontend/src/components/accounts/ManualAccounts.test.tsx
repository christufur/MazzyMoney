import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { vi, beforeEach, beforeAll, afterAll, afterEach, describe, it, expect } from 'vitest';
import ManualAccounts from './ManualAccounts';
import { accountAPI } from '../../services/api';
import type { AccountListItem } from '../../services/api';

/**
 * jsdom has no layout engine. Radix Select and Dialog call a few of its methods,
 * so give them harmless stand-ins for the duration of this file.
 */
beforeAll(() => {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.scrollIntoView = vi.fn();
  proto.hasPointerCapture = vi.fn(() => false);
  proto.releasePointerCapture = vi.fn();
  proto.setPointerCapture = vi.fn();

  // The Select popover measures itself with a ResizeObserver, which jsdom lacks.
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

vi.mock('../../services/api', () => ({
  accountAPI: {
    getAccounts: vi.fn(),
    createManual: vi.fn(),
    updateManual: vi.fn(),
    updateManualBalance: vi.fn(),
    deleteManual: vi.fn(),
    getManualHistory: vi.fn(),
    importCsv: vi.fn(),
  },
}));

const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));

const getAccounts = vi.mocked(accountAPI.getAccounts);
const createManual = vi.mocked(accountAPI.createManual);
const updateManualBalance = vi.mocked(accountAPI.updateManualBalance);
const deleteManual = vi.mocked(accountAPI.deleteManual);
const importCsv = vi.mocked(accountAPI.importCsv);

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

/** Opens the Add account dialog and returns it. */
const openAddDialog = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Add account' }));
  return screen.findByRole('dialog');
};

/** Picks a kind from the Radix Select inside the open dialog. */
const chooseKind = async (dialog: HTMLElement, label: string) => {
  fireEvent.click(within(dialog).getByRole('combobox', { name: 'Kind' }));
  const option = await within(await screen.findByRole('listbox')).findByRole('option', { name: label });
  fireEvent.click(option);
};

beforeEach(() => {
  getAccounts.mockResolvedValue(accountsResponse([manualAccount(), plaidAccount()]));
  createManual.mockResolvedValue({ account: manualAccount({ id: 'acct-new', name: 'House' }) });
  updateManualBalance.mockResolvedValue({ account: manualAccount() });
  deleteManual.mockResolvedValue(undefined);
  importCsv.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('ManualAccounts', () => {
  it('lists only manual accounts, with money owed as a minus in ink', async () => {
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
    expect(screen.getByRole('heading', { name: 'Manual accounts' })).toBeInTheDocument();
    expect(
      screen.getByText('For accounts Plaid does not connect: 401(k), car, house, cash.')
    ).toBeInTheDocument();

    // The Plaid account belongs to the bank list, not here.
    expect(screen.queryByText('Plaid Checking')).not.toBeInTheDocument();
    expect(getAccounts).toHaveBeenCalledTimes(1);

    const assetBalance = screen.getByText('$25,000.00');
    expect(assetBalance).toBeInTheDocument();
    expect(assetBalance.className).toContain('text-ink');

    const loanRow = screen.getByText('Car loan').closest('li') as HTMLElement;
    const liabilityBalance = within(loanRow).getByText('−$18,000.00');
    // Money owed is stated plainly in ink, not colored as an error.
    expect(liabilityBalance.className).toContain('text-ink');
    expect(liabilityBalance.className).not.toContain('text-terra');
    expect(within(loanRow).getByText('Loan')).toBeInTheDocument();
  });

  it('adds a manual account from the dialog', async () => {
    render(<ManualAccounts />);

    await screen.findByText('Fidelity 401(k)');

    const dialog = await openAddDialog();
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'House' } });
    await chooseKind(dialog, 'Property');
    fireEvent.change(within(dialog).getByLabelText('Balance'), { target: { value: '450000' } });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Add account' }));

    await waitFor(() =>
      expect(createManual).toHaveBeenCalledWith({
        name: 'House',
        kind: 'property',
        balance: 450000,
        isLiability: false,
      })
    );

    // The list reloads after the create and the dialog closes.
    await waitFor(() => expect(getAccounts).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    // Opening it again starts from a clean form.
    const reopened = await openAddDialog();
    expect(within(reopened).getByLabelText('Name')).toHaveValue('');
  });

  it('checks "This is money owed" automatically for a loan', async () => {
    render(<ManualAccounts />);

    await screen.findByText('Fidelity 401(k)');

    const dialog = await openAddDialog();
    const liabilityBox = within(dialog).getByRole('checkbox', { name: 'This is money owed' });
    expect(liabilityBox).toHaveAttribute('aria-checked', 'false');

    await chooseKind(dialog, 'Loan');
    expect(liabilityBox).toHaveAttribute('aria-checked', 'true');

    await chooseKind(dialog, 'Cash');
    expect(liabilityBox).toHaveAttribute('aria-checked', 'false');
  });

  it('shows a server error inside the dialog instead of an alert when adding fails', async () => {
    createManual.mockRejectedValue({
      response: { status: 400, data: { error: 'Kind must be one of: retirement, investment' } },
    });

    render(<ManualAccounts />);

    await screen.findByText('Fidelity 401(k)');

    const dialog = await openAddDialog();
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'House' } });
    fireEvent.change(within(dialog).getByLabelText('Balance'), { target: { value: '10' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add account' }));

    expect(await within(dialog).findByText(/Kind must be one of/)).toBeInTheDocument();
    expect(createManual).toHaveBeenCalledTimes(1);
    // The dialog stays open so the entry is not lost.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('keeps the Delete action a ghost button in ink, not an error color', async () => {
    render(<ManualAccounts />);

    await screen.findByText('Fidelity 401(k)');

    // Remove and Delete are ordinary quiet actions: terra is only for errors and over-limit.
    const deleteButton = screen.getByRole('button', { name: 'Delete' });
    expect(deleteButton).toHaveAttribute('data-variant', 'ghost');
    expect(deleteButton.className).toContain('text-ink');
    expect(deleteButton.className).not.toContain('text-terra');
  });

  it('renders as a section of the page spread when asked, with no card of its own', async () => {
    render(<ManualAccounts asSection />);

    const section = await screen.findByRole('region', { name: 'Manual accounts' });
    expect(section.className).toContain('border-t');
    expect(section.className).toContain('border-rule');
    expect(section.className).not.toContain('sheet');
    expect(screen.getByRole('heading', { name: 'Manual accounts' })).toBeInTheDocument();
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

  it('closes the inline editor without saving on Cancel', async () => {
    render(<ManualAccounts />);

    await screen.findByText('Fidelity 401(k)');

    fireEvent.click(screen.getByRole('button', { name: 'Update balance' }));
    fireEvent.change(screen.getByLabelText('New balance for Fidelity 401(k)'), {
      target: { value: '1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(updateManualBalance).not.toHaveBeenCalled();
  });

  it('deletes an account after the dialog confirmation, and keeps it when cancelled', async () => {
    render(<ManualAccounts />);

    await screen.findByText('Fidelity 401(k)');

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Delete Fidelity 401(k)?')).toBeInTheDocument();
    expect(within(dialog).getByText('Its balance history will be deleted too.')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(deleteManual).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const reopened = await screen.findByRole('alertdialog');
    fireEvent.click(within(reopened).getByRole('button', { name: 'Delete account' }));

    await waitFor(() => expect(deleteManual).toHaveBeenCalledWith('acct-manual-1'));
    await waitFor(() => expect(getAccounts).toHaveBeenCalledTimes(2));
  });

  it('keeps the row and says what happened when delete fails', async () => {
    deleteManual.mockRejectedValue({
      response: { status: 500, data: { error: 'Could not delete this account.' } },
    });

    render(<ManualAccounts />);

    await screen.findByText('Fidelity 401(k)');

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete account' }));

    expect(await screen.findByText('Could not delete this account.')).toBeInTheDocument();
    expect(screen.getByText('Fidelity 401(k)')).toBeInTheDocument();
  });

  it('rejects an empty name before calling the API', async () => {
    render(<ManualAccounts />);

    await screen.findByText('Fidelity 401(k)');

    const dialog = await openAddDialog();
    fireEvent.change(within(dialog).getByLabelText('Balance'), { target: { value: '10' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add account' }));

    expect(await within(dialog).findByText('Enter a name of 1 to 80 characters.')).toBeInTheDocument();
    expect(createManual).not.toHaveBeenCalled();
  });

  it('rejects an empty balance before calling the API', async () => {
    render(<ManualAccounts />);

    await screen.findByText('Fidelity 401(k)');

    const dialog = await openAddDialog();
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'House' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add account' }));

    expect(await within(dialog).findByText('Enter a number for the balance.')).toBeInTheDocument();
    expect(createManual).not.toHaveBeenCalled();
  });

  it('shows the empty state when the user has no manual accounts', async () => {
    getAccounts.mockResolvedValue(accountsResponse([plaidAccount()]));

    render(<ManualAccounts />);

    expect(
      await screen.findByText('No manual accounts yet. Add the 401(k), car, house, or cash.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add account' })).toBeInTheDocument();
  });

  it('offers a Try again when the list fails to load', async () => {
    getAccounts.mockRejectedValueOnce({
      response: { status: 500, data: { error: 'Could not load your manual accounts.' } },
    });

    render(<ManualAccounts />);

    expect(await screen.findByText('Could not load your manual accounts.')).toBeInTheDocument();
    // A failed load must not read as "no accounts".
    expect(
      screen.queryByText('No manual accounts yet. Add the 401(k), car, house, or cash.')
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Fidelity 401(k)')).toBeInTheDocument();
  });

  describe('CSV import', () => {
    const APPLE_CSV = [
      'Transaction Date,Clearing Date,Description,Merchant,Category,Type,Amount (USD)',
      '10/08/2026,10/09/2026,ICLOUD STORAGE,Apple,Software,Purchase,2.99',
      '10/07/2026,10/08/2026,BLUE BOTTLE COFFEE,Blue Bottle,Food & Drinks,Purchase,6.75',
      '10/05/2026,10/06/2026,Payment Thank You,Apple,Payment,Payment,250.00',
    ].join('\n');

    /** A stand-in for the browser's File: `.text()` is what the dialog reads. */
    const csvFile = (contents: string, name = 'apple-card.csv') => {
      const file = new File([contents], name, { type: 'text/csv' });
      Object.defineProperty(file, 'text', { value: async () => contents });
      return file;
    };

    const previewResponse = {
      preview: [
        { date: '2026-10-08', name: 'ICLOUD STORAGE', amount: 2.99, category: 'Software', isTransfer: false },
        { date: '2026-10-07', name: 'BLUE BOTTLE COFFEE', amount: 6.75, category: 'Food & Drinks', isTransfer: false },
      ],
      total: 3,
      errors: [{ row: 4, message: 'Missing amount' }],
    };

    const importResponse = {
      imported: 84,
      skipped: 3,
      payments: 0,
      firstDate: '2026-10-01',
      lastDate: '2026-10-31',
      note: 'Card payments are stored as transfers.',
    };

    const openImportDialog = async () => {
      render(<ManualAccounts />);
      await screen.findByText('Fidelity 401(k)');
      fireEvent.click(screen.getByRole('button', { name: 'Import CSV' }));
      return screen.findByRole('dialog');
    };

    it('shows the Wallet app hint for Apple Card exports', async () => {
      const dialog = await openImportDialog();

      expect(
        within(dialog).getByText(
          'Apple Card: in the Wallet app, open the card, tap a monthly statement, then Export Transactions (CSV).'
        )
      ).toBeInTheDocument();
      expect(within(dialog).getByLabelText('CSV file')).toHaveAttribute('accept', '.csv');
    });

    it('runs a dry run, shows the first rows and the error count, then imports for real', async () => {
      importCsv
        .mockResolvedValueOnce(previewResponse)
        .mockResolvedValueOnce(importResponse);

      const dialog = await openImportDialog();

      fireEvent.change(within(dialog).getByLabelText('CSV file'), {
        target: { files: [csvFile(APPLE_CSV)] },
      });

      // The dry run carries the file text and the chosen format, and nothing else yet.
      await waitFor(() =>
        expect(importCsv).toHaveBeenCalledWith('acct-manual-1', {
          csv: APPLE_CSV,
          format: 'apple-card',
          dryRun: true,
        })
      );

      expect(await within(dialog).findByText('3 transactions ready to import.')).toBeInTheDocument();
      expect(within(dialog).getByText('ICLOUD STORAGE')).toBeInTheDocument();
      expect(within(dialog).getByText('Oct 8')).toBeInTheDocument();
      expect(within(dialog).getByText('1 row could not be read.')).toBeInTheDocument();
      expect(within(dialog).getByText('Row 4: Missing amount')).toBeInTheDocument();

      fireEvent.click(within(dialog).getByRole('button', { name: 'Import 3 transactions' }));

      // The real import is the same body without `dryRun`, and it writes before reloading.
      await waitFor(() =>
        expect(importCsv).toHaveBeenLastCalledWith('acct-manual-1', {
          csv: APPLE_CSV,
          format: 'apple-card',
        })
      );
      await waitFor(() => expect(getAccounts).toHaveBeenCalledTimes(2));

      expect(toastMock.success).toHaveBeenCalledWith(
        'Imported 84 transactions, skipped 3 already imported.',
        { description: 'Card payments are stored as transfers.' }
      );
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('asks for the columns when the file is from another bank', async () => {
      importCsv.mockResolvedValue(previewResponse);

      const OTHER_CSV = 'Posted,Memo,Amount\n2026-10-01,Coffee,-4.25';
      const dialog = await openImportDialog();

      fireEvent.change(within(dialog).getByLabelText('CSV file'), {
        target: { files: [csvFile(OTHER_CSV, 'bank.csv')] },
      });

      // Format starts on Apple Card, so nothing has been sent yet.
      await waitFor(() => expect(importCsv).not.toHaveBeenCalled());

      fireEvent.click(within(dialog).getByRole('combobox', { name: 'Format' }));
      fireEvent.click(await within(await screen.findByRole('listbox')).findByRole('option', { name: 'Other bank' }));

      // The header row fills the column pickers, and the guesses line up with this file.
      await waitFor(() =>
        expect(importCsv).toHaveBeenCalledWith('acct-manual-1', {
          csv: OTHER_CSV,
          format: 'generic',
          mapping: { date: 'Posted', description: 'Memo', amount: 'Amount' },
          dryRun: true,
        })
      );

      // Negative amounts for purchases becomes an explicit part of the mapping.
      await within(dialog).findByRole('checkbox', { name: 'Amounts are negative for purchases' });
      fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Amounts are negative for purchases' }));

      await waitFor(() =>
        expect(importCsv).toHaveBeenLastCalledWith('acct-manual-1', {
          csv: OTHER_CSV,
          format: 'generic',
          mapping: {
            date: 'Posted',
            description: 'Memo',
            amount: 'Amount',
            negateAmount: true,
          },
          dryRun: true,
        })
      );
    });

    it('says what happened when the dry run is rejected, and imports nothing', async () => {
      importCsv.mockRejectedValueOnce({
        response: { status: 400, data: { error: 'The file has no amount column.' } },
      });

      const dialog = await openImportDialog();
      fireEvent.change(within(dialog).getByLabelText('CSV file'), {
        target: { files: [csvFile(APPLE_CSV)] },
      });

      expect(await within(dialog).findByText('The file has no amount column.')).toBeInTheDocument();
      // Nothing to import means the primary button stays disabled.
      expect(within(dialog).getByRole('button', { name: 'Import transactions' })).toBeDisabled();
    });

    it('keeps the dialog open with the error when the real import fails', async () => {
      importCsv
        .mockResolvedValueOnce(previewResponse)
        .mockRejectedValueOnce({ response: { status: 500, data: { error: 'The server ran out of room.' } } });

      const dialog = await openImportDialog();
      fireEvent.change(within(dialog).getByLabelText('CSV file'), {
        target: { files: [csvFile(APPLE_CSV)] },
      });

      fireEvent.click(await within(dialog).findByRole('button', { name: 'Import 3 transactions' }));

      expect(await within(dialog).findByText('The server ran out of room.')).toBeInTheDocument();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(toastMock.success).not.toHaveBeenCalled();
    });
  });
});
