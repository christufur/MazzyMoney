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

/** The section whose heading is `label`, so a name in two sections stays unambiguous. */
const sectionFor = (label: string) => screen.getByRole('region', { name: label });

beforeEach(() => {
  getAll.mockResolvedValue(payload());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('Recurring page', () => {
  it('shows the monthly total for the active series', async () => {
    renderPage();

    expect(await screen.findByText('About $124.42 a month in repeating charges')).toBeInTheDocument();
    expect(screen.getByText('From 2 active series · 1 ignored')).toBeInTheDocument();
  });

  it('puts every section in one spread, under the page title only', async () => {
    renderPage();

    await screen.findByText('All recurring');

    // One spread holds the whole page: the summary, the next 30 days, all recurring, ignored.
    const spread = screen.getByRole('region', { name: 'Recurring charges' });
    expect(spread).toHaveClass('sheet');
    expect(within(spread).getByRole('heading', { name: 'Next 30 days' })).toBeInTheDocument();
    expect(within(spread).getByRole('heading', { name: 'All recurring' })).toBeInTheDocument();
    expect(within(spread).getByRole('heading', { name: 'Ignored (1)' })).toBeInTheDocument();

    // The page title comes from the layout, so no second title-size heading is drawn here.
    const titleSized = screen
      .getAllByRole('heading')
      .filter((heading) => heading.className.includes('text-title'));
    expect(titleSized).toHaveLength(1);
    expect(titleSized[0]).toBe(screen.getByRole('heading', { level: 1, name: 'Recurring' }));
  });

  it('lists the bills due in the next 30 days, soonest first', async () => {
    renderPage();

    await screen.findByText('Next 30 days');

    const rows = within(sectionFor('Next 30 days')).getAllByRole('listitem');

    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('Planet Fitness')).toBeInTheDocument();
    expect(within(rows[0]).getByText('$25.00')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Netflix')).toBeInTheDocument();

    // Ignored series never show up under the next 30 days.
    expect(within(sectionFor('Next 30 days')).queryByText('Old Magazine')).not.toBeInTheDocument();
  });

  it('says a passed charge was expected and not seen, and still counts it', async () => {
    getAll.mockResolvedValue(
      payload({
        series: [
          series({
            id: 'series-overdue',
            merchantKey: 'spotify',
            displayName: 'Spotify',
            averageAmount: 11.99,
            nextDate: daysFromNow(-6).toISOString(),
            monthlyEquivalent: 11.99,
          }),
          series(),
        ],
        monthlyTotal: 2771,
      })
    );

    renderPage();

    // The row states the day it was due and that it has not arrived.
    const row = await screen.findByTestId('recurring-row-series-overdue');
    const expected = within(row).getAllByText(/^Expected .*, not seen yet$/);
    expect(expected.length).toBeGreaterThan(0);
    expect(expected[0].className).toContain('text-muted-foreground');

    // The same line appears under Next 30 days, in muted text rather than a next date.
    const upcoming = screen.getByTestId('upcoming-row-series-overdue');
    expect(within(upcoming).getByText(/^Expected .*, not seen yet$/)).toBeInTheDocument();

    // It is still part of the total, and the summary line says so.
    expect(
      screen.getByText('About $27.71 a month, including 1 charge not seen yet this cycle')
    ).toBeInTheDocument();
  });

  it('shows every series with its frequency, and the ignored one muted at the bottom', async () => {
    renderPage();

    await screen.findByText('All recurring');
    const all = sectionFor('All recurring charges');

    // Frequencies are the detector's intervals in plain words.
    expect(within(screen.getByTestId('recurring-row-series-netflix')).getByText('Monthly')).toBeInTheDocument();
    expect(within(screen.getByTestId('recurring-row-series-gym')).getByText('Weekly')).toBeInTheDocument();
    expect(within(screen.getByTestId('recurring-row-series-ignored')).getByText('Quarterly')).toBeInTheDocument();

    // Amount, its monthly share, and the next date sit on each active row.
    const netflix = screen.getByTestId('recurring-row-series-netflix');
    expect(within(netflix).getByText('$15.49')).toBeInTheDocument();
    expect(within(netflix).getByText('≈ $15.72')).toBeInTheDocument();
    expect(within(netflix).getByRole('button', { name: 'Ignore' })).toBeInTheDocument();

    // The ignored series get their own ruled section at the bottom of the spread.
    const ignoredSection = sectionFor('Ignored (1)');
    expect(within(all).queryByText('Old Magazine')).not.toBeInTheDocument();
    expect(within(ignoredSection).getByText('Old Magazine')).toBeInTheDocument();

    const ignoredRow = screen.getByTestId('recurring-row-series-ignored');
    expect(ignoredRow).toHaveClass('text-muted-foreground');
    expect(within(ignoredRow).getByText('Old Magazine')).toBeInTheDocument();
    expect(within(ignoredRow).getByRole('button', { name: 'Restore' })).toBeInTheDocument();
  });

  it('calls setStatus with IGNORED when Ignore is clicked', async () => {
    setStatus.mockResolvedValue({ series: series({ status: 'IGNORED' }) });

    renderPage();
    await screen.findByText('All recurring');

    // Netflix also appears under "Next 30 days", so click inside its all-recurring row.
    const netflixRow = screen.getByTestId('recurring-row-series-netflix');
    fireEvent.click(within(netflixRow).getByRole('button', { name: 'Ignore' }));

    await waitFor(() => expect(setStatus).toHaveBeenCalledWith('series-netflix', 'IGNORED'));

    // The row moves to the ignored block and the active total drops by its share.
    await waitFor(() =>
      expect(screen.getByText('About $108.70 a month in repeating charges')).toBeInTheDocument()
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

    const ignoredRow = screen.getByTestId('recurring-row-series-ignored');
    fireEvent.click(within(ignoredRow).getByRole('button', { name: 'Restore' }));

    await waitFor(() => expect(setStatus).toHaveBeenCalledWith('series-ignored', 'ACTIVE'));
  });

  it('asks the server to detect again when Refresh is clicked', async () => {
    refresh.mockResolvedValue(payload({ monthlyTotal: 20000 }));

    renderPage();
    await screen.findByText('All recurring');

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('About $200.00 a month in repeating charges')).toBeInTheDocument();
  });

  it('shows the empty state when nothing is detected yet', async () => {
    getAll.mockResolvedValue({ series: [], monthlyTotal: 0, upcoming: [] });

    renderPage();

    expect(
      await screen.findByText(
        'No recurring charges found yet. They appear after a few months of transactions.'
      )
    ).toBeInTheDocument();
    expect(screen.getByText('About $0.00 a month in repeating charges')).toBeInTheDocument();
    expect(screen.getByText('No bills expected in the next 30 days.')).toBeInTheDocument();
    // Nothing ignored means no empty heading at the bottom of the spread.
    expect(screen.queryByRole('heading', { name: /^Ignored/ })).not.toBeInTheDocument();
  });

  it('shows a failed load inline', async () => {
    getAll.mockRejectedValue({ response: { data: { error: 'Failed to fetch recurring charges' } } });

    renderPage();

    expect(await screen.findByText('Failed to fetch recurring charges')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
