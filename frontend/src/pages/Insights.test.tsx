import type { ReactNode } from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, beforeEach, describe, it, expect } from 'vitest';
import InsightsPage from './Insights';
import { analyticsAPI, transactionAPI } from '../services/api';

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ logout: vi.fn(), user: null }),
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}));

// jsdom has no layout, so ResponsiveContainer would measure 0x0 and draw nothing.
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactNode }) => (
      <actual.ResponsiveContainer width={600} height={240}>
        {children}
      </actual.ResponsiveContainer>
    ),
  };
});

vi.mock('../services/api', () => ({
  transactionAPI: {
    getTransactions: vi.fn(),
    getSpendingByCategory: vi.fn(),
    getMonthlyTrends: vi.fn(),
    getReviewCount: vi.fn().mockResolvedValue({ count: 0 }),
  },
  analyticsAPI: {
    getInsights: vi.fn(),
    getMerchants: vi.fn(),
  },
}));

const getTransactions = vi.mocked(transactionAPI.getTransactions);
const getSpendingByCategory = vi.mocked(transactionAPI.getSpendingByCategory);
const getMonthlyTrends = vi.mocked(transactionAPI.getMonthlyTrends);
const getInsights = vi.mocked(analyticsAPI.getInsights);
const getMerchants = vi.mocked(analyticsAPI.getMerchants);

const listResponse = (income: number, expenses: number) => ({
  transactions: [],
  pagination: { currentPage: 1, totalPages: 1, totalCount: 0, hasNext: false, hasPrev: false },
  summary: {
    totalTransactions: 0,
    totalAmount: 0,
    income,
    incomeCount: 1,
    expenses,
    expenseCount: 4,
    netAmount: income - expenses,
  },
});

const categoryRows = [
  { category: 'Housing', amount: 1400, transactionCount: 1 },
  { category: 'Groceries', amount: 600, transactionCount: 9 },
  { category: 'Transportation', amount: 200, transactionCount: 5 },
];

const trends = [
  { month: new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' }), income: 5000, expenses: 2200 },
];

const renderPage = () =>
  render(
    <MemoryRouter>
      <InsightsPage />
    </MemoryRouter>
  );

/**
 * Pretend a viewport `matches` the query. jsdom has no layout, so the chart reads the media
 * query itself; this is the only way to prove the phone branch is what a phone gets.
 */
const stubViewport = (matches: boolean) => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('max-width') ? matches : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  );
};

/** The start of the period the page asks for, counted from the same clock the page uses. */
const monthsAgoStart = (monthsBack: number) => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
  return `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-01`;
};

describe('Reports page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTransactions.mockResolvedValue(listResponse(5000, 2200));
    getSpendingByCategory.mockResolvedValue(categoryRows);
    getMonthlyTrends.mockResolvedValue(trends);
    getInsights.mockResolvedValue({ insights: [] });
    getMerchants.mockResolvedValue({ merchants: [] });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('draws the whole report as one sheet with ruled sections, not a stack of cards', async () => {
    const { container } = renderPage();
    await screen.findByTestId('category-ledger');

    const sheets = container.querySelectorAll('.sheet');
    expect(sheets).toHaveLength(1);
    expect(sheets[0].textContent).toContain('Where the money went');
    expect(sheets[0].textContent).toContain('Month by month');
    expect(sheets[0].textContent).toContain('Cash flow');
    expect(sheets[0].textContent).toContain('Changes this month');
    expect(sheets[0].textContent).toContain('Top merchants');

    // Every section after the figures is divided by a hairline rule.
    const sections = sheets[0].querySelectorAll(':scope > section');
    expect(sections.length).toBe(6);
    Array.from(sections)
      .slice(1)
      .forEach((section) => expect(section.className).toContain('border-t border-rule'));

    // One title only, and it comes from the layout.
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Reports');
  });

  it('renders income, spending, and net from the summary', async () => {
    renderPage();

    const figures = await screen.findByTestId('figures');
    expect(within(figures).getByText('Income')).toBeInTheDocument();
    expect(within(figures).getByText('$5,000')).toBeInTheDocument();
    expect(within(figures).getByText('Spending')).toBeInTheDocument();
    expect(within(figures).getByText('$2,200')).toBeInTheDocument();
    expect(within(figures).getByText('Net')).toBeInTheDocument();
    expect(within(figures).getByText('$2,800')).toBeInTheDocument();
    expect(screen.getByText('You kept 56% of your income.')).toBeInTheDocument();
  });

  it('shows a negative net with a real minus sign, never terra', async () => {
    getTransactions.mockResolvedValue(listResponse(1000, 1600));
    renderPage();

    const figures = await screen.findByTestId('figures');
    const net = within(figures).getByText('−$600');
    expect(net).toBeInTheDocument();
    expect(net.className).not.toContain('text-terra');
    expect(screen.getByText('Spending was 60% more than income.')).toBeInTheDocument();
  });

  it('ranks the category ledger from the largest category down', async () => {
    renderPage();

    const ledger = await screen.findByTestId('category-ledger');
    const names = Array.from(ledger.querySelectorAll('li')).map((row) =>
      row.firstElementChild?.textContent
    );
    expect(names).toEqual(['Housing', 'Groceries', 'Transportation']);

    // The largest category is 100% of the bar scale and 64% of spending.
    const first = ledger.querySelectorAll('li')[0];
    expect(within(first as HTMLElement).getByText('$1,400.00')).toBeInTheDocument();
    expect(within(first as HTMLElement).getByText('64%')).toBeInTheDocument();
  });

  it('draws the spending bars in ink, never sage', async () => {
    renderPage();

    const ledger = await screen.findByTestId('category-ledger');
    const bars = Array.from(ledger.querySelectorAll<HTMLElement>('[data-bar-fill="spending"]'));

    // Spending is ink everywhere; sage is only money in and money kept.
    expect(bars).toHaveLength(3);
    bars.forEach((bar) => {
      expect(bar.className).toContain('bg-ink');
      expect(bar.className).not.toContain('bg-sage');
    });
  });

  it('puts each category bar on its own full-width line under the name on a phone', async () => {
    renderPage();

    const ledger = await screen.findByTestId('category-ledger');
    const row = ledger.querySelectorAll('li')[0] as HTMLElement;
    const track = row.querySelector<HTMLElement>('[data-bar="spending"]');
    const fill = row.querySelector<HTMLElement>('[data-bar-fill="spending"]');

    // The bar spans the whole row below md and shares the line above it.
    expect(track?.className).toContain('w-full');
    expect(track?.className).toContain('order-last');
    expect(track?.className).toContain('md:w-auto');
    expect(track?.className).toContain('md:order-none');
    // The fill is spending, so it is ink.
    expect(fill?.className).toContain('bg-ink');
  });

  it('rolls categories past the eighth into Other', async () => {
    const rows = Array.from({ length: 9 }, (_, index) => ({
      category: `Category ${index + 1}`,
      amount: 100 - index,
    }));
    getSpendingByCategory.mockResolvedValue(rows);
    // The summary is the whole period, so the rows add up to it here.
    getTransactions.mockResolvedValue(listResponse(1000, rows.reduce((sum, row) => sum + row.amount, 0)));

    renderPage();

    const ledger = await screen.findByTestId('category-ledger');
    const names = Array.from(ledger.querySelectorAll('li')).map((row) =>
      row.firstElementChild?.textContent
    );
    expect(names).toHaveLength(9);
    expect(names[8]).toBe('Other');
    // The ninth category is folded into Other.
    expect(within(ledger.querySelectorAll('li')[8] as HTMLElement).getByText('$92.00')).toBeInTheDocument();
  });

  it('keeps the ledger honest when spending has no category', async () => {
    getSpendingByCategory.mockResolvedValue([{ category: 'Housing', amount: 1000 }]);
    getTransactions.mockResolvedValue(listResponse(2000, 1500));

    renderPage();

    const ledger = await screen.findByTestId('category-ledger');
    await waitFor(() => {
      expect(within(ledger).getByText('Not categorized')).toBeInTheDocument();
    });
    expect(within(ledger).getByText('$500.00')).toBeInTheDocument();
  });

  it('says a category is new when last month had no baseline to compare with', async () => {
    getInsights.mockResolvedValue({
      insights: [{ category: 'Food & Dining', change: 49, percentChange: null }],
    });
    renderPage();

    await screen.findByTestId('category-ledger');
    const sentence = await screen.findByText('Food & Dining is new this month ($49).');
    // No baseline means no percentage: "up 100%" would be invented.
    expect(sentence.textContent).not.toContain('100%');
    expect(sentence.textContent).not.toContain('up');
    expect(document.body.textContent).not.toContain('NaN');
    expect(document.body.textContent).not.toContain('Infinity');
  });

  it('does not print a dash for a category that has a real baseline', async () => {
    getInsights.mockResolvedValue({
      insights: [{ category: 'Groceries', change: 82, percentChange: 24.4 }],
    });
    renderPage();

    expect(
      await screen.findByText('Groceries is up $82 (24%) on last month.')
    ).toBeInTheDocument();
  });

  it('asks for the new date range when the period changes', async () => {
    renderPage();
    await screen.findByTestId('category-ledger');

    expect(getTransactions.mock.calls[0][0]).toMatchObject({ dateFrom: monthsAgoStart(2) });

    fireEvent.click(screen.getByRole('button', { name: '1Y' }));

    await waitFor(() => {
      expect(getTransactions).toHaveBeenLastCalledWith(
        expect.objectContaining({ dateFrom: monthsAgoStart(11) })
      );
    });
    expect(getSpendingByCategory).toHaveBeenLastCalledWith(
      expect.objectContaining({ dateFrom: monthsAgoStart(11) })
    );
  });

  it('says so when the period has no transactions', async () => {
    getTransactions.mockResolvedValue(listResponse(0, 0));
    getSpendingByCategory.mockResolvedValue([]);
    renderPage();

    expect(
      await screen.findByText('No transactions in this period. Try a longer period.')
    ).toBeInTheDocument();
    expect(screen.getByText('No spending recorded in this period.')).toBeInTheDocument();
  });

  it('shows a ranked cash-flow list instead of the diagram below 640 px', async () => {
    stubViewport(true);
    renderPage();

    const list = await screen.findByTestId('cash-flow-list');
    const rows = Array.from(list.querySelectorAll('li')).map((row) => row.textContent ?? '');

    // Largest flow first, labelled by category (the section says it is income) with share and amount.
    expect(rows[0]).toContain('Housing');
    expect(rows[0]).toContain('28%');
    expect(rows[0]).toContain('$1,400.00');
    expect(rows[1]).toContain('Groceries');
    expect(rows[1]).toContain('12%');

    // No diagram at all, and the list bars are thin and ink for spending.
    expect(screen.queryByTestId('cash-flow-diagram')).not.toBeInTheDocument();
    expect(document.querySelector('svg[role="img"]')).toBeNull();
    const bars = Array.from(list.querySelectorAll<HTMLElement>('[data-bar-fill="spending"]'));
    expect(bars.length).toBeGreaterThan(0);
    bars.forEach((bar) => {
      expect(bar.className).toContain('h-1.5');
      expect(bar.className).toContain('bg-ink');
    });
  });

  it('keeps the diagram on a wide screen', async () => {
    stubViewport(false);
    renderPage();

    expect(await screen.findByTestId('cash-flow-diagram')).toBeInTheDocument();
    expect(screen.queryByTestId('cash-flow-list')).not.toBeInTheDocument();
  });

  it('puts every desktop label outside the bands, never on one', async () => {
    stubViewport(false);
    renderPage();

    const svg = await screen.findByTestId('cash-flow-diagram');
    await waitFor(() => {
      expect(svg.querySelectorAll('[data-role="label-name"]').length).toBeGreaterThan(0);
    });

    const nodes = Array.from(
      svg.querySelectorAll<SVGRectElement>('[data-layer="nodes"] rect')
    );
    // The node blocks are the only ink rectangles: the bands are paths.
    const blocks = nodes.map((rect) => ({
      x0: Number(rect.getAttribute('x')),
      x1: Number(rect.getAttribute('x')) + Number(rect.getAttribute('width')),
    }));
    const leftBlock = Math.min(...blocks.map((b) => b.x0));
    const rightBlock = Math.max(...blocks.map((b) => b.x1));

    const names = Array.from(svg.querySelectorAll<SVGTextElement>('[data-role="label-name"]'));
    expect(names.length).toBeGreaterThan(1);

    names.forEach((label) => {
      const x = Number(label.getAttribute('x'));
      const anchor = label.getAttribute('text-anchor');
      // Every label sits in a gutter: left of the left-hand node, or right of the right-hand node.
      const inLeftGutter = anchor === 'end' && x <= leftBlock;
      const inRightGutter = anchor === 'start' && x >= rightBlock;
      expect(inLeftGutter || inRightGutter).toBe(true);
    });

    // The right-hand labels use the empty right side of the spread.
    const rightLabels = names.filter((label) => label.getAttribute('text-anchor') === 'start');
    expect(rightLabels.length).toBeGreaterThan(1);
    rightLabels.forEach((label) => {
      expect(Number(label.getAttribute('x'))).toBeGreaterThan(rightBlock);
    });
  });

  it('shows an inline error with a retry', async () => {
    getTransactions.mockRejectedValueOnce(new Error('offline'));
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the report.');

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(getTransactions).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId('figures')).toBeInTheDocument();
  });
});
