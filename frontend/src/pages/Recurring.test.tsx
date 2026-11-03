import type { ReactNode } from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest';
import RecurringPage from './Recurring';
import { recurringAPI } from '../services/api';
import type { RecurringResponse, RecurringSeries } from '../services/api';

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ logout: vi.fn(), user: null }),
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('../services/api', () => ({
  recurringAPI: {
    getAll: vi.fn(),
    refresh: vi.fn(),
    setStatus: vi.fn(),
  },
}));

const getAll = vi.mocked(recurringAPI.getAll);
const refresh = vi.mocked(recurringAPI.refresh);
const setStatus = vi.mocked(recurringAPI.setStatus);

const daysFromNow = (days: number) => {
  const date = new Date();
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days, 12));
};

const series = (overrides: Partial<RecurringSeries> = {}): RecurringSeries => ({
  id: 'series-netflix',
  merchantKey: 'netflix',
  displayName: 'Netflix',
  averageAmount: 15.49,
  intervalDays: 30,
  lastDate: daysFromNow(-10).toISOString(),
  nextDate: daysFromNow(20).toISOString(),
  status: 'ACTIVE',
  monthlyEquivalent: 15.72,
  ...overrides,
});

const payload = (overrides: Partial<RecurringResponse> = {}): RecurringResponse => ({
  series: [
    series(),
    series({
      id: 'series-gym',
      merchantKey: 'gym',
      displayName: 'Planet Fitness',
      averageAmount: 25,
      intervalDays: 7,
      nextDate: daysFromNow(3).toISOString(),
      monthlyEquivalent: 108.7,
    }),
    series({
      id: 'series-ignored',
      merchantKey: 'old magazine',
      displayName: 'Old Magazine',
      averageAmount: 5,
      intervalDays: 91,
      nextDate: daysFromNow(200).toISOString(),
      status: 'IGNORED',
      monthlyEquivalent: 1.67,
    }),
  ],
  monthlyTotal: 12442,
  upcoming: [
    series({
      id: 'series-gym',
      merchantKey: 'gym',
      displayName: 'Planet Fitness',
      averageAmount: 25,
      intervalDays: 7,
      nextDate: daysFromNow(3).toISOString(),
      monthlyEquivalent: 108.7,
    }),
    series(),
  ],
  ...overrides,
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <RecurringPage />
    </MemoryRouter>
  );

beforeEach(() => {
  getAll.mockResolvedValue(payload());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('Recurring page', () => {
  it('shows the monthly total for the active series', async () => {
    renderPage();

    expect(
      await screen.findByText('≈ $124.42 / month in recurring charges')
    ).toBeInTheDocument();
  });

  it('lists the bills due in the next 30 days, soonest first', async () => {
    renderPage();

    await screen.findByText('Next 30 days');

    const upcomingList = screen.getByText('Next 30 days').closest('div.bg-white') as HTMLElement;
    const rows = within(upcomingList).getAllByRole('listitem');

    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('Planet Fitness')).toBeInTheDocument();
    expect(within(rows[0]).getByText('$25.00')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Netflix')).toBeInTheDocument();

    // Ignored series never show up under the next 30 days.
    expect(within(upcomingList).queryByText('Old Magazine')).not.toBeInTheDocument();
  });

  it('shows every series with its frequency, and the ignored one faded at the bottom', async () => {
    renderPage();

    await screen.findByText('All recurring');

    const table = screen.getByText('All recurring').closest('div.bg-white') as HTMLElement;
    const [activeTable, ignoredTable] = table.querySelectorAll('table');

    // The header has a "Monthly" column too, so read the body rows only.
    const activeRows = within(activeTable as HTMLElement).getAllByRole('row').slice(1);
    expect(activeRows.map((row) => within(row).getAllByRole('cell')[1].textContent)).toEqual([
      'Monthly',
      'Weekly',
    ]);

    expect(within(table).getByText('Ignored (1)')).toBeInTheDocument();

    const ignoredRows = within(ignoredTable as HTMLElement).getAllByRole('row').slice(1);
    expect(ignoredRows).toHaveLength(1);
    expect(ignoredRows[0]).toHaveClass('opacity-60');
    expect(within(ignoredRows[0]).getByText('Old Magazine')).toBeInTheDocument();
    expect(within(ignoredRows[0]).getByRole('button', { name: 'Restore' })).toBeInTheDocument();
  });

  it('calls setStatus with IGNORED when Ignore is clicked', async () => {
    setStatus.mockResolvedValue({ series: series({ status: 'IGNORED' }) });

    renderPage();
    await screen.findByText('All recurring');

    // Netflix also appears under "Next 30 days", so scope the click to its table row.
    const netflixRow = screen
      .getAllByText('Netflix')
      .map((node) => node.closest('tr'))
      .find((row): row is HTMLTableRowElement => Boolean(row)) as HTMLElement;
    fireEvent.click(within(netflixRow).getByRole('button', { name: 'Ignore' }));

    await waitFor(() =>
      expect(setStatus).toHaveBeenCalledWith('series-netflix', 'IGNORED')
    );

    // The row moves to the ignored block and the active total drops by its share.
    await waitFor(() =>
      expect(screen.getByText('≈ $108.70 / month in recurring charges')).toBeInTheDocument()
    );
    expect(screen.getByText('Ignored (2)')).toBeInTheDocument();
  });

  it('restores an ignored series', async () => {
    setStatus.mockResolvedValue({
      series: series({
        id: 'series-ignored',
        merchantKey: 'old magazine',
        displayName: 'Old Magazine',
        averageAmount: 5,
        intervalDays: 91,
        status: 'ACTIVE',
        monthlyEquivalent: 1.67,
      }),
    });

    renderPage();
    await screen.findByText('All recurring');

    const ignoredRow = screen.getByText('Old Magazine').closest('tr') as HTMLElement;
    fireEvent.click(within(ignoredRow).getByRole('button', { name: 'Restore' }));

    await waitFor(() =>
      expect(setStatus).toHaveBeenCalledWith('series-ignored', 'ACTIVE')
    );
  });

  it('asks the server to detect again when Refresh is clicked', async () => {
    refresh.mockResolvedValue(payload({ monthlyTotal: 20000 }));

    renderPage();
    await screen.findByText('All recurring');

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText('≈ $200.00 / month in recurring charges')
    ).toBeInTheDocument();
  });

  it('shows the empty state when nothing is detected yet', async () => {
    getAll.mockResolvedValue({ series: [], monthlyTotal: 0, upcoming: [] });

    renderPage();

    expect(
      await screen.findByText(
        'No recurring charges found yet. They appear after a few months of transactions.'
      )
    ).toBeInTheDocument();
    expect(screen.getByText('≈ $0.00 / month in recurring charges')).toBeInTheDocument();
    expect(screen.getByText('No bills expected in the next 30 days.')).toBeInTheDocument();
  });

  it('shows a failed load inline', async () => {
    getAll.mockRejectedValue({ response: { data: { error: 'Failed to fetch recurring charges' } } });

    renderPage();

    expect(await screen.findByText('Failed to fetch recurring charges')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument();
  });
});
