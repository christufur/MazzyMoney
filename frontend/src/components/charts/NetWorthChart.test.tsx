import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest';
import NetWorthChart from './NetWorthChart';
import { networthAPI } from '../../services/api';
import type { NetWorthResponse } from '../../services/api';

// Recharts' ResponsiveContainer measures its parent, which is always 0x0 in jsdom.
// A fixed-size stand-in lets the chart render while keeping the real AreaChart.
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 800, height: 300 }}>{children}</div>
    ),
  };
});

vi.mock('../../services/api', () => ({
  networthAPI: {
    get: vi.fn(),
  },
}));

const getNetWorth = vi.mocked(networthAPI.get);

/** Radix Tabs selects on press-down, which is what a real press does first. */
const chooseRange = (name: string) =>
  fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0 });

const response = (overrides: Partial<NetWorthResponse> = {}): NetWorthResponse => ({
  current: { assets: 30000, liabilities: 22000, netWorth: 8000 },
  change: { amount: 1500.5, percent: 23.08 },
  points: [
    { date: '2025-01-01', assets: 29000, liabilities: 22500.5, netWorth: 6499.5 },
    { date: '2025-02-01', assets: 29500, liabilities: 22300, netWorth: 7200 },
    { date: '2025-03-01', assets: 30000, liabilities: 22000, netWorth: 8000 },
  ],
  accounts: [
    {
      id: 'acct-checking',
      name: 'Everyday Checking',
      type: 'depository',
      isManual: false,
      isLiability: false,
      balance: 5000,
    },
    {
      id: 'acct-401k',
      name: 'Fidelity 401(k)',
      type: 'retirement',
      isManual: true,
      isLiability: false,
      balance: 25000,
    },
    {
      id: 'acct-card',
      name: 'Travel Card',
      type: 'credit',
      isManual: false,
      isLiability: true,
      balance: 22000,
    },
  ],
  ...overrides,
});

beforeEach(() => {
  getNetWorth.mockResolvedValue(response());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('NetWorthChart', () => {
  it('shows the current net worth and the signed change for the range', async () => {
    render(<NetWorthChart />);

    expect(await screen.findByTestId('net-worth-value')).toHaveTextContent('$8,000.00');

    const change = screen.getByTestId('net-worth-change');
    expect(change).toHaveTextContent('+$1,500.50');
    // Money in over the range is sage, not a Tailwind green.
    expect(change.className).toContain('text-sage-ink');
    expect(screen.getByText('(+23.1%)')).toBeInTheDocument();

    // The first load uses the default range.
    expect(getNetWorth).toHaveBeenCalledWith('6m');
  });

  it('puts the figure, the range, the chart, and the balances in one ruled spread', async () => {
    render(<NetWorthChart />);

    const spread = await screen.findByRole('region', { name: 'Net worth' });
    expect(spread).toHaveClass('sheet');

    // Each part is a section of that spread, divided by a rule, not a separate card.
    expect(within(spread).getByRole('tablist', { name: 'Net worth range' })).toBeInTheDocument();
    expect(within(spread).getByRole('region', { name: 'Net worth history' })).toBeInTheDocument();
    expect(within(spread).getByRole('region', { name: 'Assets and liabilities' })).toBeInTheDocument();
    expect(within(spread).getByRole('heading', { name: 'Assets' })).toBeInTheDocument();
    expect(within(spread).getByRole('heading', { name: 'Liabilities' })).toBeInTheDocument();

    // No second title-size heading: the page title lives in the layout.
    const titleSized = screen
      .getAllByRole('heading')
      .filter((heading) => heading.className.includes('text-title'));
    expect(titleSized).toHaveLength(0);
  });

  it('lists a liability under Liabilities as a negative amount in ink, and totals each column', async () => {
    render(<NetWorthChart />);

    await screen.findByTestId('net-worth-value');

    const sections = screen.getByRole('region', { name: 'Assets and liabilities' });
    const liabilities = within(sections).getByRole('heading', { name: 'Liabilities' }).parentElement as HTMLElement;
    const assets = within(sections).getByRole('heading', { name: 'Assets' }).parentElement as HTMLElement;

    const liabilityList = within(liabilities).getByRole('list');
    const liability = within(liabilityList).getByText('−$22,000.00');
    expect(liability).toBeInTheDocument();
    // Money owed is stated plainly, not colored as an error.
    expect(liability.className).toContain('text-ink');
    expect(liability.className).not.toContain('text-terra');

    expect(within(assets).getByText('Everyday Checking')).toBeInTheDocument();
    expect(within(assets).getByText('$25,000.00')).toBeInTheDocument();
    expect(within(liabilities).queryByText('Everyday Checking')).not.toBeInTheDocument();

    // Totals close each column.
    expect(within(assets).getByText('Total').parentElement).toHaveTextContent('$30,000.00');
    expect(within(liabilities).getByText('Total').parentElement).toHaveTextContent('−$22,000.00');
  });

  it('marks a manual account with a muted tag', async () => {
    render(<NetWorthChart />);

    await screen.findByTestId('net-worth-value');

    const manualRow = screen.getByText('Fidelity 401(k)').closest('li') as HTMLElement;
    expect(within(manualRow).getByText('manual')).toBeInTheDocument();

    const plaidRow = screen.getByText('Everyday Checking').closest('li') as HTMLElement;
    expect(within(plaidRow).queryByText('manual')).not.toBeInTheDocument();
  });

  it('shows a negative change in ink with a minus sign', async () => {
    getNetWorth.mockResolvedValue(
      response({
        change: { amount: -250.25, percent: -3.03 },
        points: [
          { date: '2025-01-01', assets: 30250.25, liabilities: 22000, netWorth: 8250.25 },
          { date: '2025-03-01', assets: 30000, liabilities: 22000, netWorth: 8000 },
        ],
      })
    );

    render(<NetWorthChart />);

    await screen.findByTestId('net-worth-value');

    const change = screen.getByTestId('net-worth-change');
    expect(change).toHaveTextContent('\u2212$250.25');
    expect(change.className).toContain('text-ink');
    expect(change.className).not.toContain('text-sage-ink');
  });

  it('asks for 1y when the 1Y range is chosen', async () => {
    render(<NetWorthChart />);

    await screen.findByTestId('net-worth-value');
    getNetWorth.mockClear();

    chooseRange('1Y');

    await waitFor(() => expect(getNetWorth).toHaveBeenCalledWith('1y'));
    expect(screen.getByRole('tab', { name: '1Y' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '6M' })).toHaveAttribute('aria-selected', 'false');
  });

  it('requests every range from its own tab', async () => {
    render(<NetWorthChart />);

    await screen.findByTestId('net-worth-value');

    for (const [label, value] of [
      ['1M', '1m'],
      ['3M', '3m'],
      ['All', 'all'],
    ] as const) {
      getNetWorth.mockClear();
      chooseRange(label);
      await waitFor(() => expect(getNetWorth).toHaveBeenCalledWith(value));
    }
  });

  it('shows the empty state when the user has no snapshots yet', async () => {
    getNetWorth.mockResolvedValue(
      response({ current: { assets: 0, liabilities: 0, netWorth: 0 }, change: { amount: 0, percent: null }, points: [], accounts: [] })
    );

    render(<NetWorthChart />);

    expect(
      await screen.findByText(
        'Net worth history starts after your first sync. Add manual accounts on the Connections page.'
      )
    ).toBeInTheDocument();
    // The totals are still rendered, just with no history.
    expect(screen.getByTestId('net-worth-value')).toHaveTextContent('$0.00');
    // No history means no change to report, not a fake +$0.00.
    expect(screen.queryByTestId('net-worth-change')).not.toBeInTheDocument();
  });

  it('ignores leading $0 days and says when history starts', async () => {
    getNetWorth.mockResolvedValue(
      response({
        change: { amount: 8000, percent: null },
        points: [
          { date: '2025-01-01', assets: 0, liabilities: 0, netWorth: 0 },
          { date: '2025-03-01', assets: 30000, liabilities: 22000, netWorth: 8000 },
        ],
      })
    );

    render(<NetWorthChart />);

    expect(await screen.findByText(/History starts Mar 1/)).toBeInTheDocument();
    expect(screen.queryByTestId('net-worth-change')).not.toBeInTheDocument();
  });

  it('says which part of the history is worked back from transactions', async () => {
    getNetWorth.mockResolvedValue(response({ estimatedBefore: '2025-03-01' }));
    render(<NetWorthChart />);

    expect(
      await screen.findByText('Before Mar 1, balances are worked back from your transactions.')
    ).toBeInTheDocument();
  });

  it('keeps the chart visible while a new range loads', async () => {
    render(<NetWorthChart />);

    await screen.findByTestId('net-worth-value');

    // A request that never answers keeps the loading state in place.
    getNetWorth.mockReturnValue(new Promise<NetWorthResponse>(() => {}));
    chooseRange('1M');
    await waitFor(() => expect(getNetWorth).toHaveBeenCalledWith('1m'));

    // The old points stay until the new answer arrives, so the figure does not blank out.
    expect(screen.getByTestId('net-worth-value')).toHaveTextContent('$8,000.00');
  });

  it('shows an inline error with a retry that reloads the data', async () => {
    getNetWorth.mockRejectedValueOnce({
      response: { status: 500, data: { error: 'Failed to fetch net worth' } },
    });

    render(<NetWorthChart />);

    expect(await screen.findByText('Failed to fetch net worth')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(getNetWorth).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId('net-worth-value')).toHaveTextContent('$8,000.00');
    expect(screen.queryByText('Failed to fetch net worth')).not.toBeInTheDocument();
  });

  it('does not read as "no history yet" when the request failed', async () => {
    getNetWorth.mockRejectedValueOnce({
      response: { status: 500, data: { error: 'Failed to fetch net worth' } },
    });

    render(<NetWorthChart />);

    expect(await screen.findByText('Failed to fetch net worth')).toBeInTheDocument();
    expect(
      screen.queryByText(/Net worth history starts after your first sync/)
    ).not.toBeInTheDocument();
  });
});
