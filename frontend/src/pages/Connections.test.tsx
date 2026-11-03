import { render, screen, waitFor, fireEvent, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest';
import type { ReactNode } from 'react';
import ConnectionsPage from './Connections';
import { PlaidLink } from '../components/plaid/PlaidLink';
import { plaidAPI, PlaidItem, PlaidItemsResponse } from '../services/api';

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ logout: vi.fn(), user: null }),
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}));

// The manual accounts sheet has its own tests; here it only has to be on the page.
vi.mock('../components/accounts/ManualAccounts', () => ({
  default: () => <div>Manual accounts</div>,
}));

// Keep the options Link was given so a test can run the success callback.
const plaidLinkState = vi.hoisted(() => ({ config: null as any }));

vi.mock('react-plaid-link', () => ({
  usePlaidLink: (config: any) => {
    plaidLinkState.config = config;
    return { open: vi.fn(), ready: true };
  },
}));

vi.mock('../services/api', () => ({
  plaidAPI: {
    createLinkToken: vi.fn(),
    exchangePublicToken: vi.fn(),
    getItems: vi.fn(),
    removeItem: vi.fn(),
  },
}));

const createLinkToken = vi.mocked(plaidAPI.createLinkToken);
const exchangePublicToken = vi.mocked(plaidAPI.exchangePublicToken);
const getItems = vi.mocked(plaidAPI.getItems);
const removeItem = vi.mocked(plaidAPI.removeItem);

const account = (id: string, name: string, mask: string | null = '1234', subtype = 'checking') => ({
  id,
  name,
  mask,
  type: 'depository',
  subtype,
});

const items: PlaidItem[] = [
  {
    id: 'item-1',
    institutionName: 'First Platypus Bank',
    status: 'ACTIVE',
    lastSyncAt: '2026-11-01T12:00:00.000Z',
    lastError: null,
    accounts: [account('acct-1', 'Plaid Checking')],
  },
  {
    id: 'item-2',
    institutionName: 'Second Bank',
    status: 'LOGIN_REQUIRED',
    lastSyncAt: null,
    lastError: null,
    accounts: [account('acct-2', 'Plaid Saving', '2222', 'savings')],
  },
  {
    id: 'item-3',
    institutionName: 'Third Bank',
    status: 'ERROR',
    lastSyncAt: null,
    lastError: 'ITEM_LOGIN_REQUIRED',
    accounts: [account('acct-3', 'Plaid Credit Card', null, 'credit card')],
  },
];

const itemsResponse = (overrides: Partial<PlaidItemsResponse> = {}): PlaidItemsResponse => ({
  items,
  used: 3,
  limit: 10,
  ...overrides,
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <ConnectionsPage />
    </MemoryRouter>
  );

/** The section for one bank, addressed by its accessible name. */
const bankSection = (name: string) => screen.getByRole('region', { name });

beforeEach(() => {
  createLinkToken.mockResolvedValue({ link_token: 'link-sandbox-token' });
  exchangePublicToken.mockResolvedValue({
    item: { id: 'item-4', institutionName: 'New Bank', status: 'ACTIVE' },
  });
  removeItem.mockResolvedValue({ success: true });
  getItems.mockResolvedValue(itemsResponse());
  plaidLinkState.config = null;
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('Connections page', () => {
  it('shows how many of the ten bank connections are used', async () => {
    renderPage();

    expect(await screen.findByText('Banks used: 3 of 10')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Bank connections used' })).toHaveAttribute(
      'aria-valuenow',
      '3'
    );
  });

  it('shows Reconnect only for the bank that needs a new login', async () => {
    renderPage();

    await screen.findByText('Banks used: 3 of 10');

    // Link asks for its token first, so wait for the button label to settle.
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Reconnect' })).toHaveLength(1));

    const loginNeeded = bankSection('Second Bank');
    expect(within(loginNeeded).getByRole('button', { name: 'Reconnect' })).toBeInTheDocument();
    expect(within(loginNeeded).getByText('Login needed')).toBeInTheDocument();
    expect(within(loginNeeded).getByText('••2222')).toBeInTheDocument();
    expect(within(loginNeeded).getByText('savings')).toBeInTheDocument();

    const active = bankSection('First Platypus Bank');
    expect(within(active).queryByRole('button', { name: 'Reconnect' })).not.toBeInTheDocument();
    expect(within(active).getByText('Connected')).toBeInTheDocument();

    // The failing bank states the server's word for it, quietly, below the status.
    const failing = bankSection('Third Bank');
    expect(within(failing).getByText('Error')).toBeInTheDocument();
    expect(within(failing).getByText('ITEM_LOGIN_REQUIRED')).toBeInTheDocument();
    expect(within(failing).queryByRole('button', { name: 'Reconnect' })).not.toBeInTheDocument();
  });

  it('shows the last sync time and the account subtype', async () => {
    renderPage();

    await screen.findByText('Banks used: 3 of 10');

    expect(within(bankSection('First Platypus Bank')).getByText(/^Last sync Nov 1, /)).toBeInTheDocument();
    expect(within(bankSection('Second Bank')).getByText('Not synced yet')).toBeInTheDocument();
  });

  it('disables Add bank when all ten connections are used', async () => {
    getItems.mockResolvedValue(itemsResponse({ used: 10 }));

    renderPage();

    await screen.findByText('Banks used: 10 of 10');

    expect(await screen.findByRole('button', { name: 'Add bank' })).toBeDisabled();
    expect(
      screen.getByText('All 10 bank connections are in use. Remove one before adding another.')
    ).toBeInTheDocument();
    // No token for a new connection: every request here must be update mode (a free reconnect).
    expect(createLinkToken.mock.calls.every(([itemId]) => Boolean(itemId))).toBe(true);
  });

  it('removes a bank after the dialog confirmation, then reloads the list', async () => {
    renderPage();

    await screen.findByText('Banks used: 3 of 10');

    fireEvent.click(within(bankSection('First Platypus Bank')).getByRole('button', { name: 'Remove' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Remove First Platypus Bank?')).toBeInTheDocument();
    expect(
      within(dialog).getByText('Its accounts and transactions will be deleted from Mazzy Money.')
    ).toBeInTheDocument();
    expect(removeItem).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove bank' }));

    await waitFor(() => expect(removeItem).toHaveBeenCalledWith('item-1'));
    await waitFor(() => expect(getItems).toHaveBeenCalledTimes(2));
  });

  it('does not remove a bank when the dialog is cancelled', async () => {
    renderPage();

    await screen.findByText('Banks used: 3 of 10');

    fireEvent.click(within(bankSection('First Platypus Bank')).getByRole('button', { name: 'Remove' }));

    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(removeItem).not.toHaveBeenCalled();
  });

  it('keeps the dialog and says what happened when removing fails', async () => {
    removeItem.mockRejectedValue({ response: { status: 500, data: { error: 'Plaid is unavailable.' } } });

    renderPage();

    await screen.findByText('Banks used: 3 of 10');

    fireEvent.click(within(bankSection('First Platypus Bank')).getByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove bank' }));

    expect(await screen.findByText('Plaid is unavailable.')).toBeInTheDocument();
    expect(getItems).toHaveBeenCalledTimes(1);
  });

  it('shows the empty state with an Add bank button when no bank is connected', async () => {
    getItems.mockResolvedValue(itemsResponse({ items: [], used: 0 }));

    renderPage();

    expect(await screen.findByText('No banks connected yet')).toBeInTheDocument();
    expect(screen.getByText('Banks used: 0 of 10')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Add bank' })).toBeEnabled();
    // The manual accounts section stays on the page either way.
    expect(screen.getByText('Manual accounts')).toBeInTheDocument();
  });

  it('says the banks could not be loaded instead of showing an empty ledger', async () => {
    getItems.mockRejectedValue({ response: { status: 500, data: { error: 'Server is starting.' } } });

    renderPage();

    expect(await screen.findByText('Server is starting.')).toBeInTheDocument();
    // An error is not the same as "nothing connected yet".
    expect(screen.queryByText('No banks connected yet')).not.toBeInTheDocument();
  });
});

describe('PlaidLink', () => {
  it('exchanges the public token for a new bank, then reloads', async () => {
    const onSuccess = vi.fn();
    render(<PlaidLink onSuccess={onSuccess} buttonText="Add bank" />);

    const addButton = await screen.findByRole('button', { name: 'Add bank' });
    await waitFor(() => expect(createLinkToken).toHaveBeenCalledWith(undefined));
    fireEvent.click(addButton);

    await act(async () => {
      await plaidLinkState.config.onSuccess('public-sandbox-token');
    });

    expect(exchangePublicToken).toHaveBeenCalledWith('public-sandbox-token');
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('reconnects in update mode without exchanging a token', async () => {
    const onSuccess = vi.fn();
    render(<PlaidLink itemId="item-2" onSuccess={onSuccess} buttonText="Reconnect" variant="outline" />);

    const button = await screen.findByRole('button', { name: 'Reconnect' });
    expect(createLinkToken).toHaveBeenCalledWith('item-2');
    // The outline variant is the quiet second action on the bank row.
    expect(button).toHaveAttribute('data-variant', 'outline');

    // Update mode returns no public token for a new Item, so nothing is exchanged.
    await act(async () => {
      await plaidLinkState.config.onSuccess('');
    });

    expect(exchangePublicToken).not.toHaveBeenCalled();
  });

  it('explains the free connection limit instead of a generic failure', async () => {
    createLinkToken.mockRejectedValue({ response: { status: 409, data: { error: 'ITEM_LIMIT' } } });

    render(<PlaidLink onSuccess={vi.fn()} buttonText="Add bank" />);

    expect(
      await screen.findByText('All 10 free bank connections are in use. Remove one first.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('explains a duplicate institution when the exchange is rejected', async () => {
    exchangePublicToken.mockRejectedValue({
      response: { status: 409, data: { error: 'DUPLICATE_INSTITUTION' } },
    });

    const onSuccess = vi.fn();
    render(<PlaidLink onSuccess={onSuccess} buttonText="Add bank" />);

    await screen.findByRole('button', { name: 'Add bank' });
    await waitFor(() => expect(plaidLinkState.config).not.toBeNull());
    await act(async () => {
      await plaidLinkState.config.onSuccess('public-sandbox-token');
    });

    expect(await screen.findByText('This bank is already connected. Use Reconnect instead.')).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('asks for a new link token on Try again', async () => {
    createLinkToken.mockRejectedValueOnce({ response: { status: 409, data: { error: 'ITEM_LIMIT' } } });

    render(<PlaidLink onSuccess={vi.fn()} buttonText="Add bank" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(createLinkToken).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('button', { name: 'Add bank' })).toBeInTheDocument();
  });

  it('keeps its label when disabled at the bank limit, and asks for no token', async () => {
    render(<PlaidLink onSuccess={vi.fn()} buttonText="Add bank" disabled />);

    const button = screen.getByRole('button', { name: 'Add bank' });
    expect(button).toBeDisabled();
    expect(createLinkToken).not.toHaveBeenCalled();
  });
});
