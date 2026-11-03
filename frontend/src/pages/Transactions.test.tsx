import { render, screen, waitFor, fireEvent, within, configure, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, beforeEach, afterEach, beforeAll, describe, it, expect } from 'vitest';
import type { ReactNode } from 'react';
import TransactionsPage from './Transactions';
import { accountAPI, categoryAPI, rulesAPI, transactionAPI } from '../services/api';

// Radix Select opens a portal and restores focus on close; under the full suite those
// passes take longer than the one-second default. Every query here is a real one, so
// the extra wall clock buys reliability, not leniency.
configure({ asyncUtilTimeout: 8000 });

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
  rulesAPI: {
    fromTransaction: vi.fn(),
    apply: vi.fn(),
  },
}));

// Capture toasts so the "Always do this" action can be pressed in the test.
const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));

const getTransactions = vi.mocked(transactionAPI.getTransactions);
const getReviewCount = vi.mocked(transactionAPI.getReviewCount);
const bulkUpdate = vi.mocked(transactionAPI.bulkUpdate);
const updateTransaction = vi.mocked(transactionAPI.update);
const updateNotes = vi.mocked(transactionAPI.updateNotes);
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

const renderPage = (route = '/transactions') =>
  render(
    <MemoryRouter initialEntries={[route]}>
      <TransactionsPage />
    </MemoryRouter>
  );

/**
 * The filters and the bulk category picker are shadcn selects, so open and choose like a
 * reader. Radix positions its listbox from a measurement pass, and the first open of a
 * freshly mounted one in jsdom can come up empty; closing and opening it again renders
 * normally. That is also what a person does when a menu appears blank.
 */
const chooseOption = async (triggerName: string, optionName: string) => {
  const trigger = await screen.findByRole('combobox', { name: triggerName });

  for (let attempt = 0; attempt < 4; attempt += 1) {
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    if (screen.queryAllByRole('listbox').length === 0) {
      await screen.findByRole('listbox').catch(() => null);
    }

    const option = screen.queryAllByRole('option').find(el => el.textContent === optionName);
    if (option) {
      fireEvent.click(option);
      return option;
    }

    fireEvent.keyDown(document.body, { key: 'Escape' });
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });
  }

  throw new Error(`The "${triggerName}" picker never offered "${optionName}".`);
};

beforeAll(() => {
  // Radix Select reads pointer capture and scroll APIs that jsdom does not implement.
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  // Radix's popper reports "placed" from a requestAnimationFrame; jsdom's rAF is real,
  // so a loaded suite can outrun it. Run the callback now, which is what a browser does
  // in the next frame anyway.
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

beforeEach(() => {
  getTransactions.mockResolvedValue(pageResponse() as any);
  getReviewCount.mockResolvedValue({ count: 3 });
  bulkUpdate.mockResolvedValue({ updated: 2 });
  updateTransaction.mockResolvedValue({ success: true } as any);
  updateNotes.mockResolvedValue({ success: true } as any);
  getAllCategories.mockResolvedValue({ categories: ['Groceries', 'Travel', 'Other'] });
  getAccounts.mockResolvedValue({
    accounts: [{ id: 'account-1', name: 'Everyday Checking', mask: '4321' }],
  } as any);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('Transactions page', () => {
  it('renders the cached rows and the figures from the API', async () => {
    renderPage();

    // The display name wins over the bank's own text.
    expect(await screen.findByText('Whole Foods')).toBeInTheDocument();
    expect(screen.getByText('Corner Shop')).toBeInTheDocument();

    // The raw bank memo is folded away until the row is expanded.
    expect(screen.queryByText('WHOLEFDS MKT 123')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Bank memo for Whole Foods' }));
    expect(await screen.findByText('WHOLEFDS MKT 123')).toBeInTheDocument();

    // Account name and mask on each row.
    expect(screen.getAllByText('Everyday Checking ••4321').length).toBeGreaterThanOrEqual(2);

    // Money out is ink with a minus; money in is sage with a plus.
    const list = screen.getByRole('list', { name: 'Transactions' });
    expect(within(list).getAllByText('−$12.50')[0]).toHaveClass('text-ink');
    expect(within(list).getAllByText('+$100.00')[0]).toHaveClass('text-sage-ink');

    // The three figures come from the API's summary, not from the visible rows.
    const summary = screen.getByRole('group', { name: 'Summary' });
    expect(within(summary).getByText('Income')).toBeInTheDocument();
    expect(within(summary).getByText('Spending')).toBeInTheDocument();
    expect(within(summary).getByText('Net')).toBeInTheDocument();
    expect(within(summary).getByText('+$100.00')).toBeInTheDocument();
    expect(within(summary).getByText('−$12.50')).toBeInTheDocument();
    expect(within(summary).getByText('+$87.50')).toBeInTheDocument();

    expect(screen.getByRole('tab', { name: 'Needs review (3)' })).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
    // Guide words name the span of dates on screen and the place in the ledger.
    expect(screen.getByText('Jun 15 · page 1 of 3')).toBeInTheDocument();

    expect(getTransactions).toHaveBeenCalledWith(expect.objectContaining({ page: 1, limit: 50 }));
  });

  it('keeps the last four account digits when the account name is long', async () => {
    getTransactions.mockResolvedValue(
      pageResponse({
        transactions: [
          row('tx-9', {
            merchantDisplay: 'Long account row',
            account: {
              id: 'account-2',
              name: 'Household Joint Everyday Checking Account',
              mask: '9876',
              type: 'depository',
              subtype: 'checking',
            },
          }),
        ],
      }) as any
    );

    renderPage();

    await screen.findByText('Long account row');
    // The mask sits in its own non-truncating span, so it can never be cut off.
    const mask = screen.getByText('••9876');
    expect(mask).toHaveClass('shrink-0');
    expect(mask.className).not.toContain('truncate');
  });

  it('shows Pending, and only repeats Transfer when the category does not already say it', async () => {
    getTransactions.mockResolvedValue(
      pageResponse({
        transactions: [
          row('tx-3', { name: 'Pending row', pending: true, isTransfer: true }),
          row('tx-4', { name: 'Card payment', isTransfer: true, primaryCategory: 'Transfer' }),
        ],
      }) as any
    );

    renderPage();

    const list = await screen.findByRole('list', { name: 'Transactions' });
    const [pendingRow, transferRow] = within(list).getAllByRole('listitem');

    expect(within(pendingRow).getByText('Pending')).toBeInTheDocument();
    // The chip still says Groceries, so the row earns its Transfer pill.
    expect(within(pendingRow).getByText('Transfer')).toBeInTheDocument();

    // The second row's category chip already reads "Transfer": one word, not two.
    const chips = within(transferRow).getByRole('button', { name: 'Category: Transfer' });
    expect(chips).toBeInTheDocument();
    expect(within(transferRow).queryByText('Transfer', { selector: '[data-slot="badge"]' })).toBeNull();
  });

  it('does not open the note editor until it is asked for', async () => {
    renderPage();

    await screen.findByText('Whole Foods');
    expect(screen.queryByRole('textbox', { name: 'Note' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Add a note' }).length).toBe(2);
  });

  it('sends reviewed=false on the Needs review tab', async () => {
    renderPage();

    await screen.findByText('Whole Foods');
    // The first page load is the unfiltered list.
    expect(getTransactions.mock.calls[0][0]).not.toHaveProperty('reviewed');

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Needs review (3)' }), { button: 0 });

    await waitFor(() =>
      expect(getTransactions).toHaveBeenLastCalledWith(expect.objectContaining({ reviewed: false }))
    );
  });

  // Radix's select portal mounts its items from a measurement pass that jsdom cannot
  // finish reliably under load, so this asserts the bulk action through the picker's
  // sibling button on the same `runBulk` path and the category picker in its own test.
  it('bulk-updates the two selected rows', { timeout: 20000 }, async () => {
    renderPage();

    await screen.findByText('Whole Foods');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Whole Foods' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Corner Shop' }));

    expect(screen.getByText('2 selected')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Mark reviewed' }));

    await waitFor(() =>
      expect(bulkUpdate).toHaveBeenCalledWith(['tx-1', 'tx-2'], { reviewed: true })
    );

    // The list and the review count both reload after a bulk edit.
    await waitFor(() => expect(getTransactions.mock.calls.length).toBeGreaterThan(1));
    await waitFor(() => expect(getReviewCount.mock.calls.length).toBeGreaterThan(1));
  });

  it('offers the page categories in the bulk category picker', { timeout: 20000 }, async () => {
    renderPage();

    await screen.findByText('Whole Foods');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Whole Foods' }));

    // The picker only appears once the page's category list has landed.
    await waitFor(() =>
      expect(
        screen.getByRole('combobox', { name: 'Set category for selected transactions' })
      ).toBeInTheDocument()
    );

    await chooseOption('Set category for selected transactions', 'Travel');

    await waitFor(() =>
      expect(bulkUpdate).toHaveBeenCalledWith(['tx-1'], { category: 'Travel' })
    );
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
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Needs review (3)' }), { button: 0 });

    fireEvent.click(await screen.findByRole('button', { name: 'Mark all on this page reviewed' }));

    await waitFor(() => expect(bulkUpdate).toHaveBeenCalledWith(['tx-1', 'tx-2'], { reviewed: true }));
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

    await chooseOption('Category', 'Travel');
    await chooseOption('Account', 'Everyday Checking ••4321');
    await chooseOption('Type', 'Income');
    await chooseOption('Date range', 'All time');

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
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('loads the category list once for the filter and the row selectors', async () => {
    renderPage();

    await screen.findByText('Whole Foods');

    // Every row uses the same list, so opening a picker asks the API for nothing.
    fireEvent.click(screen.getAllByRole('button', { name: 'Category: Groceries' })[0]);
    expect(await screen.findByRole('button', { name: 'Travel' })).toBeInTheDocument();

    expect(getAllCategories).toHaveBeenCalledTimes(1);
  });

  it('offers a rule after a category change and applies it to past rows', async () => {
    vi.mocked(transactionAPI.updateCategory).mockResolvedValue({});
    vi.mocked(rulesAPI.fromTransaction).mockResolvedValue({ rule: { id: 'rule-1' } as any, matchCount: 3 });
    vi.mocked(rulesAPI.apply).mockResolvedValue({ updated: 3, skippedUserCategory: 0 });
    renderPage();

    await screen.findByText('Whole Foods');
    fireEvent.click(screen.getAllByRole('button', { name: 'Category: Groceries' })[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Travel' }));

    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    const [message, options] = toastMock.mock.calls.at(-1)!;
    expect(message).toBe('Whole Foods is now Travel.');
    await options.action.onClick();

    expect(rulesAPI.fromTransaction).toHaveBeenCalledWith(expect.any(String), 'Travel');
    expect(rulesAPI.apply).toHaveBeenCalledWith('rule-1');
    expect(toastMock.success).toHaveBeenCalledWith('Rule saved. 3 past transactions updated.');
  });

  it('saves an inline note', async () => {
    renderPage();

    await screen.findByText('Whole Foods');
    fireEvent.click(screen.getAllByRole('button', { name: 'Add a note' })[0]);

    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), {
      target: { value: 'Split with Jordan' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updateNotes).toHaveBeenCalledWith('tx-1', 'Split with Jordan'));
    expect(await screen.findByText('Split with Jordan')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Edit note' }).length).toBe(1);
  });
});

describe('Review mode', () => {
  const reviewPage = (overrides: Record<string, any> = {}) =>
    pageResponse({
      transactions: [
        row('rv-1', { merchantDisplay: 'Blue Bottle', amount: 6.75, primaryCategory: 'Coffee' }),
        row('rv-2', { merchantDisplay: 'Shell', amount: 48.2, primaryCategory: 'Gas' }),
      ],
      pagination: { currentPage: 1, totalPages: 1, totalCount: 2, hasNext: false, hasPrev: false },
      ...overrides,
    });

  it('renders one card per transaction and asks only for unreviewed rows', async () => {
    getTransactions.mockResolvedValue(reviewPage() as any);

    renderPage('/transactions?review=1');

    expect(await screen.findByText('Blue Bottle')).toBeInTheDocument();
    expect(screen.getByText('Shell')).toBeInTheDocument();
    expect(screen.getByText('1 of 2')).toBeInTheDocument();

    const list = screen.getByRole('list', { name: 'Transactions to review' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);

    expect(getTransactions).toHaveBeenCalledWith(expect.objectContaining({ reviewed: false, limit: 50 }));
  });

  it('marks a card reviewed with Looks right and moves on', async () => {
    getTransactions.mockResolvedValue(reviewPage() as any);

    renderPage('/transactions?review=1');

    await screen.findByText('Blue Bottle');
    const list = screen.getByRole('list', { name: 'Transactions to review' });
    fireEvent.click(within(list).getAllByRole('button', { name: 'Looks right' })[0]);

    await waitFor(() => expect(updateTransaction).toHaveBeenCalledWith('rv-1', { reviewed: true }));
    // The answered card leaves the queue and the progress line advances.
    await waitFor(() => expect(within(list).queryByText('Blue Bottle')).not.toBeInTheDocument());
    expect(screen.getByText('Shell')).toBeInTheDocument();
    expect(screen.getByText('2 of 2')).toBeInTheDocument();
  });

  it('says All caught up when the queue is empty', async () => {
    getTransactions.mockResolvedValue(emptyPage() as any);

    renderPage('/transactions?review=1');

    expect(await screen.findByText('All caught up.')).toBeInTheDocument();
    // The queue's own way back to the month, named so the tab bar link cannot match it.
    const caughtUp = screen.getByText('All caught up.').closest('.sheet') as HTMLElement;
    expect(within(caughtUp).getByRole('link', { name: 'This month' })).toHaveAttribute(
      'href',
      '/overview'
    );
  });

  it('moves with J and K and answers with Enter', async () => {
    getTransactions.mockResolvedValue(reviewPage() as any);

    renderPage('/transactions?review=1');
    await screen.findByText('Blue Bottle');

    const list = screen.getByRole('list', { name: 'Transactions to review' });
    const cards = within(list).getAllByRole('listitem');
    expect(cards[0]).toHaveAttribute('aria-current', 'true');

    fireEvent.keyDown(window, { key: 'j' });
    await waitFor(() => expect(cards[1]).toHaveAttribute('aria-current', 'true'));

    fireEvent.keyDown(window, { key: 'k' });
    await waitFor(() => expect(cards[0]).toHaveAttribute('aria-current', 'true'));

    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(updateTransaction).toHaveBeenCalledWith('rv-1', { reviewed: true }));
  });

  it('saves the transfer and hide switches from the card', async () => {
    getTransactions.mockResolvedValue(reviewPage() as any);

    renderPage('/transactions?review=1');

    await screen.findByText('Blue Bottle');
    const list = screen.getByRole('list', { name: 'Transactions to review' });
    const card = within(list).getAllByRole('listitem')[0];

    fireEvent.click(within(card).getByRole('switch', { name: 'Transfer' }));
    await waitFor(() => expect(updateTransaction).toHaveBeenCalledWith('rv-1', { isTransfer: true }));

    fireEvent.click(within(card).getByRole('switch', { name: 'Hide from totals' }));
    await waitFor(() => expect(updateTransaction).toHaveBeenCalledWith('rv-1', { hidden: true }));
  });

  it('lays the queue out as one snapping card per screen on a phone', async () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as any;

    try {
      getTransactions.mockResolvedValue(reviewPage() as any);
      renderPage('/transactions?review=1');

      await screen.findByText('Blue Bottle');
      const list = screen.getByRole('list', { name: 'Transactions to review' });
      expect(list.className).toContain('snap-x');
      expect(list.className).toContain('snap-mandatory');

      const cards = within(list).getAllByRole('listitem');
      expect(cards).toHaveLength(2);
      // Each card takes the full width and snaps its own center to the track.
      expect(cards[0].className).toContain('snap-center');
      expect(cards[0].className).toContain('w-full');
      expect(within(cards[0]).getByRole('button', { name: 'Looks right' })).toBeInTheDocument();
      expect(within(cards[0]).getByRole('button', { name: 'Skip' })).toBeInTheDocument();
    } finally {
      window.matchMedia = original;
    }
  });
});
