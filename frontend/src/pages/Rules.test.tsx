import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest';
import type { ReactNode } from 'react';
import Rules from './Rules';
import { accountAPI, categoryAPI, rulesAPI, transactionAPI } from '../services/api';
import type { Rule, RuleWithMatchCount } from '../services/api';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ logout: vi.fn(), user: null }),
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('../services/api', () => ({
  rulesAPI: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    preview: vi.fn(),
    apply: vi.fn(),
    fromTransaction: vi.fn(),
  },
  categoryAPI: { getAll: vi.fn() },
  accountAPI: { getAccounts: vi.fn() },
  transactionAPI: { getReviewCount: vi.fn() },
}));

// jsdom has neither; Radix Select measures its list with ResizeObserver and scrolls to the
// selected row. Without the stubs any test that opens a Select throws.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);
Element.prototype.scrollIntoView = vi.fn();

const list = vi.mocked(rulesAPI.list);
const create = vi.mocked(rulesAPI.create);
const preview = vi.mocked(rulesAPI.preview);
const apply = vi.mocked(rulesAPI.apply);
const remove = vi.mocked(rulesAPI.remove);
const getAllCategories = vi.mocked(categoryAPI.getAll);
const getAccounts = vi.mocked(accountAPI.getAccounts);
const getReviewCount = vi.mocked(transactionAPI.getReviewCount);

const rule = (overrides: Partial<RuleWithMatchCount> = {}): RuleWithMatchCount => ({
  id: 'rule-starbucks',
  priority: 0,
  matchMerchant: 'Starbucks',
  matchAmountMin: null,
  matchAmountMax: null,
  matchAccountId: null,
  setCategory: 'Food & Dining',
  setMerchant: 'Starbucks',
  setTransfer: null,
  setHidden: null,
  createdAt: '2026-11-01T12:00:00.000Z',
  updatedAt: '2026-11-01T12:00:00.000Z',
  matchCount: 42,
  ...overrides,
});

const saved = (overrides: Partial<Rule> = {}): Rule => {
  const { matchCount: _ignored, ...fields } = rule();
  return { ...fields, ...overrides };
};

const renderPage = () =>
  render(
    <MemoryRouter>
      <Rules />
      {/* The app mounts this once at the root; a toast is only readable with it present. */}
      <Toaster />
    </MemoryRouter>
  );

/** Every list load asks for these three together; each test only cares about one. */
const mockLoad = (rules: RuleWithMatchCount[]) => {
  list.mockResolvedValue({ rules });
  getAllCategories.mockResolvedValue({
    categories: ['Food & Dining', 'Groceries', 'Travel', 'Other'],
  });
  getAccounts.mockResolvedValue({
    accounts: [
      { id: 'account-visa', name: 'Visa', mask: '8812', type: 'credit', subtype: 'credit card' },
      { id: 'account-checking', name: 'Everyday Checking', mask: '4321', type: 'depository', subtype: 'checking' },
    ],
  } as any);
};

beforeEach(() => {
  mockLoad([rule()]);
  preview.mockResolvedValue({ matchCount: 42, sample: [] });
  create.mockResolvedValue({ rule: saved() });
  apply.mockResolvedValue({ updated: 40, skippedUserCategory: 2 });
  remove.mockResolvedValue({ success: true });
  getReviewCount.mockResolvedValue({ count: 0 });
});

afterEach(() => {
  // Toasts live in a module-level store, so one test's toast would show up in the next.
  toast.dismiss();
  vi.clearAllMocks();
});

describe('Rules page', () => {
  it('reads each rule as a sentence with its match count', async () => {
    renderPage();

    const row = (await screen.findByText(/merchant contains/)).closest('li') as HTMLElement;
    expect(row).toHaveTextContent(
      'When merchant contains Starbucks → category Food & Dining, rename to Starbucks'
    );
    expect(within(row).getByText('Matches 42 transactions')).toBeInTheDocument();
  });

  it('spells out the amount range, the account, and the transfer and hide actions', async () => {
    mockLoad([
      rule({
        id: 'rule-visa',
        matchMerchant: 'Amazon',
        matchAmountMin: 5,
        matchAmountMax: 20,
        matchAccountId: 'account-visa',
        setCategory: null,
        setMerchant: null,
        setTransfer: true,
        setHidden: true,
        matchCount: 1,
      }),
    ]);
    // The first load already ran with the default payload, so the page refetches on remount.
    renderPage();

    const row = (await screen.findByText(/merchant contains/)).closest('li') as HTMLElement;
    expect(row).toHaveTextContent(
      'When merchant contains Amazon and amount $5–$20 on Visa ••8812 → mark as transfer, hide'
    );
    expect(within(row).getByText('Matches 1 transaction')).toBeInTheDocument();
  });

  it('shows the empty state and opens the form from it', async () => {
    mockLoad([]);
    renderPage();

    expect(
      await screen.findByText(
        'No rules yet. A rule saves you from fixing the same merchant every month.'
      )
    ).toBeInTheDocument();

    // The empty state repeats the call to action, so take the one inside it.
    const emptyState = screen
      .getByText('No rules yet. A rule saves you from fixing the same merchant every month.')
      .parentElement as HTMLElement;
    fireEvent.click(within(emptyState).getByRole('button', { name: 'New rule' }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('shows a failed load inline and retries', async () => {
    list.mockRejectedValueOnce({ response: { data: { error: 'Failed to fetch rules' } } });

    renderPage();

    expect(await screen.findByText('Failed to fetch rules')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText(/merchant contains/)).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('creates a rule from the dialog with the fields as a draft', async () => {
    preview.mockResolvedValue({ matchCount: 0, sample: [] });
    create.mockResolvedValue({ rule: saved({ id: 'rule-new', matchCount: undefined } as any) });

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'New rule' }));

    const dialog = await screen.findByRole('dialog');

    fireEvent.change(within(dialog).getByLabelText('Merchant contains'), {
      target: { value: 'Starbucks' },
    });
    fireEvent.change(within(dialog).getByLabelText('Amount from'), { target: { value: '5' } });
    fireEvent.change(within(dialog).getByLabelText('Amount to'), { target: { value: '20' } });

    fireEvent.click(within(dialog).getByRole('combobox', { name: 'Account' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Visa ••8812' }));

    fireEvent.click(within(dialog).getByRole('combobox', { name: 'Category' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Food & Dining' }));

    fireEvent.change(within(dialog).getByLabelText('Rename to'), {
      target: { value: 'Starbucks' },
    });
    fireEvent.click(within(dialog).getByLabelText('Mark as transfer'));

    fireEvent.change(within(dialog).getByLabelText('Priority'), { target: { value: '5' } });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save rule' }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        priority: 5,
        matchMerchant: 'Starbucks',
        matchAmountMin: 5,
        matchAmountMax: 20,
        matchAccountId: 'account-visa',
        setCategory: 'Food & Dining',
        setMerchant: 'Starbucks',
        setTransfer: true,
        setHidden: null,
      })
    );
  });

  it('previews how many past transactions the draft matches', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'New rule' }));

    const dialog = await screen.findByRole('dialog');
    // Nothing to count until the draft has a condition and an action.
    expect(within(dialog).queryByText(/Matches/)).not.toBeInTheDocument();

    preview.mockResolvedValue({
      matchCount: 42,
      sample: [
        {
          id: 'tx-1',
          date: '2026-10-30T12:00:00.000Z',
          name: 'STARBUCKS #123',
          merchantName: 'Starbucks',
          amount: 6.25,
          primaryCategory: 'Food & Dining',
        },
      ],
    });

    fireEvent.change(within(dialog).getByLabelText('Merchant contains'), {
      target: { value: 'Starbucks' },
    });
    fireEvent.change(within(dialog).getByLabelText('Rename to'), {
      target: { value: 'Starbucks' },
    });

    expect(await within(dialog).findByText('Matches 42 transactions')).toBeInTheDocument();
    expect(within(dialog).getByText('Oct 30')).toBeInTheDocument();
    expect(within(dialog).getByText('−$6.25')).toBeInTheDocument();
    expect(preview).toHaveBeenCalledWith(
      expect.objectContaining({ matchMerchant: 'Starbucks', setMerchant: 'Starbucks' })
    );
  });

  it('shows the backend validation message inline', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'New rule' }));

    const dialog = await screen.findByRole('dialog');
    create.mockRejectedValueOnce({
      response: {
        data: { error: 'A rule needs at least one action: setCategory, setMerchant, setTransfer, or setHidden' },
      },
    });

    fireEvent.change(within(dialog).getByLabelText('Merchant contains'), {
      target: { value: 'Starbucks' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save rule' }));

    expect(
      await within(dialog).findByText(
        'A rule needs at least one action: setCategory, setMerchant, setTransfer, or setHidden'
      )
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Save rule' })).toBeInTheDocument();
  });

  it('offers to apply a new rule to the matches it just found', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'New rule' }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Merchant contains'), {
      target: { value: 'Starbucks' },
    });
    fireEvent.change(within(dialog).getByLabelText('Rename to'), {
      target: { value: 'Starbucks' },
    });

    // The preview fills in first, so the save finds the count without another request.
    await within(dialog).findByText('Matches 42 transactions');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save rule' }));

    expect(
      await screen.findByText('Apply this rule to the 42 past transactions too?')
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Apply now' }));

    await waitFor(() => expect(apply).toHaveBeenCalledWith('rule-starbucks'));
    expect(await screen.findByText('Updated 40 transactions. 2 kept your own category.')).toBeInTheDocument();
  });

  it('applies a saved rule and reports what changed in a toast', async () => {
    renderPage();

    await screen.findByText(/merchant contains/);
    fireEvent.click(screen.getByRole('button', { name: 'Apply to past transactions' }));

    await waitFor(() => expect(apply).toHaveBeenCalledWith('rule-starbucks'));
    expect(await screen.findByText('Updated 40 transactions. 2 kept your own category.')).toBeInTheDocument();
  });

  it('deletes a rule through the confirm dialog', async () => {
    renderPage();

    await screen.findByText(/merchant contains/);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    const confirm = await screen.findByRole('alertdialog');
    expect(within(confirm).getByText('Delete this rule?')).toBeInTheDocument();

    // Nothing happens until the second Delete is pressed.
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith('rule-starbucks'));
    await waitFor(() => expect(screen.queryByText(/merchant contains/)).not.toBeInTheDocument());
  });

  it('leaves the rule alone when the confirm dialog is cancelled', async () => {
    renderPage();

    await screen.findByText(/merchant contains/);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    const confirm = await screen.findByRole('alertdialog');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(remove).not.toHaveBeenCalled();
  });

  it('opens the editor with the rule it was given', async () => {
    renderPage();

    await screen.findByText(/merchant contains/);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Merchant contains')).toHaveValue('Starbucks');
    expect(within(dialog).getByLabelText('Rename to')).toHaveValue('Starbucks');
    expect(within(dialog).getByLabelText('Category')).toHaveTextContent('Food & Dining');
  });
});
