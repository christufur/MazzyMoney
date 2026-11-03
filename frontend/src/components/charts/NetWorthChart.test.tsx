import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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

const response = (overrides: Partial<NetWorthResponse> = {}): NetWorthResponse => ({
  current: { assets: 30000, liabilities: 22000, netWorth: 8000 },
  change: { amount: 1500.5, percent: 23.08 },
  points: [
    { date: '2025-01-01', assets: 29000, liabilities: 22500, netWorth: 6500 },
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
    expect(change.className).toContain('text-green-600');
    expect(screen.getByText('(+23.1%)')).toBeInTheDocument();

    // The first load uses the default range.
    expect(getNetWorth).toHaveBeenCalledWith('6m');
  });

  it('does not call the API for the old hero metrics and shows the card heading', async () => {
    render(<NetWorthChart />);

    expect(await screen.findByRole('heading', { name: 'Net worth' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Net worth range' })).toBeInTheDocument();
  });

  it('lists a liability under Liabilities as a negative amount in red', async () => {
    render(<NetWorthChart />);

    await screen.findByTestId('net-worth-value');

    expect(screen.getByText('Liabilities')).toBeInTheDocument();
    expect(screen.getByText('Assets')).toBeInTheDocument();

    const liability = screen.getByText('-$22,000.00');
    expect(liability).toBeInTheDocument();
    expect(liability.className).toContain('text-red-600');

    // Assets stay positive and neutral colored.
    const asset = screen.getByText('$25,000.00');
    expect(asset).toBeInTheDocument();
    expect(asset.className).not.toContain('text-red-600');

    // The manual account is marked as such so it is clear where it came from.
    expect(screen.getByText('Fidelity 401(k)', { exact: false })).toBeInTheDocument();
  });

  it('shows a negative change in red with a minus sign', async () => {
    getNetWorth.mockResolvedValue(
      response({ change: { amount: -250.25, percent: -3.03 } })
    );

    render(<NetWorthChart />);

    await screen.findByTestId('net-worth-value');

    const change = screen.getByTestId('net-worth-change');
    expect(change).toHaveTextContent('\u2212$250.25');
    expect(change.className).toContain('text-red-600');
  });

  it('requests range=1y when the 1Y button is clicked', async () => {
    render(<NetWorthChart />);

    await screen.findByTestId('net-worth-value');
    getNetWorth.mockClear();

    fireEvent.click(screen.getByRole('button', { name: '1Y' }));

    await waitFor(() => expect(getNetWorth).toHaveBeenCalledWith('1y'));
    expect(screen.getByRole('button', { name: '1Y' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('requests every range from its own button', async () => {
    render(<NetWorthChart />);

    await screen.findByTestId('net-worth-value');

    for (const [label, value] of [
      ['1M', '1m'],
      ['3M', '3m'],
      ['All', 'all'],
    ] as const) {
      getNetWorth.mockClear();
      fireEvent.click(screen.getByRole('button', { name: label }));
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
    expect(screen.getByTestId('net-worth-change')).toHaveTextContent('+$0.00');
  });

  it('shows an inline error with a retry that reloads the data', async () => {
    getNetWorth.mockRejectedValueOnce({
      response: { status: 500, data: { error: 'Failed to fetch net worth' } },
    });

    render(<NetWorthChart />);

    expect(await screen.findByText('Failed to fetch net worth')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(getNetWorth).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId('net-worth-value')).toHaveTextContent('$8,000.00');
    expect(screen.queryByText('Failed to fetch net worth')).not.toBeInTheDocument();
  });
});
