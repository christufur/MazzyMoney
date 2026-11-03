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

    expect(await screen.findByText('Banks used: 3 / 10')).toBeInTheDocument();
  });

  it('shows Reconnect only for the bank that needs a new login', async () => {
    renderPage();

    await screen.findByText('Banks used: 3 / 10');

    // Link asks for its token first, so wait for the button label to settle.
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Reconnect' })).toHaveLength(1));

    const reconnectButtons = screen.getAllByRole('button', { name: 'Reconnect' });

    const loginNeededCard = screen.getByText('Second Bank').closest('div.bg-white') as HTMLElement;
    expect(within(loginNeededCard).getByRole('button', { name: 'Reconnect' })).toBe(reconnectButtons[0]);

    const activeCard = screen.getByText('First Platypus Bank').closest('div.bg-white') as HTMLElement;
    expect(within(activeCard).queryByRole('button', { name: 'Reconnect' })).not.toBeInTheDocument();

    expect(screen.getByText('Login needed')).toBeInTheDocument();
    expect(screen.getByText('••2222')).toBeInTheDocument();
    expect(screen.getByText('ITEM_LOGIN_REQUIRED')).toBeInTheDocument();
  });

  it('disables Add bank when all ten connections are used', async () => {
    getItems.mockResolvedValue(itemsResponse({ used: 10 }));

    renderPage();

    await screen.findByText('Banks used: 10 / 10');

    expect(await screen.findByRole('button', { name: 'Add bank' })).toBeDisabled();
    expect(
      screen.getByText('All 10 free bank connections are in use. Remove one to connect another bank.')
    ).toBeInTheDocument();
    // No token for a new connection: every request here must be update mode (a free reconnect).
    expect(createLinkToken.mock.calls.every(([itemId]) => Boolean(itemId))).toBe(true);
  });

  it('removes a bank after the confirmation, then reloads the list', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderPage();

    await screen.findByText('Banks used: 3 / 10');

    const firstBankCard = screen.getByText('First Platypus Bank').closest('div.bg-white') as HTMLElement;
    fireEvent.click(within(firstBankCard).getByRole('button', { name: 'Remove' }));

    expect(confirmSpy).toHaveBeenCalledWith(
      'Remove First Platypus Bank? Its accounts and transactions will be deleted from Mazzy Money.'
    );
    await waitFor(() => expect(removeItem).toHaveBeenCalledWith('item-1'));
    await waitFor(() => expect(getItems).toHaveBeenCalledTimes(2));
  });

  it('does not remove a bank when the confirmation is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    renderPage();

    await screen.findByText('Banks used: 3 / 10');

    const firstBankCard = screen.getByText('First Platypus Bank').closest('div.bg-white') as HTMLElement;
    fireEvent.click(within(firstBankCard).getByRole('button', { name: 'Remove' }));

    expect(removeItem).not.toHaveBeenCalled();
  });

  it('shows the empty state with an Add bank button when no bank is connected', async () => {
    getItems.mockResolvedValue(itemsResponse({ items: [], used: 0 }));

    renderPage();

    expect(await screen.findByText('No banks connected yet')).toBeInTheDocument();
    expect(screen.getByText('Banks used: 0 / 10')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Add bank' })).toBeEnabled();
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
    render(<PlaidLink itemId="item-2" onSuccess={onSuccess} buttonText="Reconnect" />);

    await screen.findByRole('button', { name: 'Reconnect' });
    expect(createLinkToken).toHaveBeenCalledWith('item-2');

    // Update mode returns no public token for a new Item, so nothing is exchanged.
    await act(async () => {
      await plaidLinkState.config.onSuccess('');
    });

    expect(exchangePublicToken).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('explains the free connection limit instead of a generic failure', async () => {
    createLinkToken.mockRejectedValue({ response: { status: 409, data: { error: 'ITEM_LIMIT' } } });

    render(<PlaidLink onSuccess={vi.fn()} buttonText="Add bank" />);

    expect(
      await screen.findByText('All 10 free bank connections are in use. Remove one first.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument();
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

  it('asks for a new link token on Try Again', async () => {
    createLinkToken.mockRejectedValueOnce({ response: { status: 409, data: { error: 'ITEM_LIMIT' } } });

    render(<PlaidLink onSuccess={vi.fn()} buttonText="Add bank" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Try Again' }));

    await waitFor(() => expect(createLinkToken).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('button', { name: 'Add bank' })).toBeInTheDocument();
  });
});
