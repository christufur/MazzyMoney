import type { ReactNode } from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest';
import Settings from './Settings';
import { api } from '../services/api';

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ logout: vi.fn(), user: null }),
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('../services/api', () => ({
  api: {
    get: vi.fn(),
    put: vi.fn(),
    post: vi.fn(),
  },
}));

// Radix's Checkbox measures itself with a ResizeObserver; jsdom has none.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (!('ResizeObserver' in globalThis)) {
  (globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
    ResizeObserverStub;
}

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: vi.fn() } }));

const get = vi.mocked(api.get);
const put = vi.mocked(api.put);
const post = vi.mocked(api.post);

const settings = (overrides: Record<string, unknown> = {}) => ({
  ntfyTopic: 'mazzy-household',
  notifyLargeOver: 250,
  notifyWeekly: true,
  serverConfigured: true,
  ...overrides,
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <Settings />
    </MemoryRouter>
  );

beforeEach(() => {
  get.mockResolvedValue({ data: settings() });
  put.mockImplementation(async (_url: string, body: any) => ({
    data: settings({
      ntfyTopic: body.ntfyTopic ?? null,
      notifyLargeOver: body.notifyLargeOver ?? null,
      notifyWeekly: body.notifyWeekly ?? true,
    }),
  }));
  post.mockResolvedValue({ data: { sent: true } });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('Settings page', () => {
  it('explains where the pushes go and loads the saved topic', async () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(
      await screen.findByText('Pushes go to your phone through ntfy, on your own server.')
    ).toBeInTheDocument();

    const topic = (await screen.findByLabelText('Topic')) as HTMLInputElement;
    expect(topic.value).toBe('mazzy-household');
  });

  it('shows the amount and the weekly recap as they are saved', async () => {
    get.mockResolvedValue({ data: settings({ notifyLargeOver: 400, notifyWeekly: false }) });

    renderPage();

    expect(((await screen.findByLabelText('Tell me about charges over')) as HTMLInputElement).value).toBe(
      '400'
    );
    expect(screen.getByRole('checkbox', { name: 'Weekly recap' })).not.toBeChecked();
  });

  it('saves the topic, the amount and the weekly switch', async () => {
    renderPage();
    await screen.findByLabelText('Topic');

    fireEvent.change(screen.getByLabelText('Topic'), { target: { value: 'mazzy-new' } });
    fireEvent.change(screen.getByLabelText('Tell me about charges over'), {
      target: { value: '300' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Weekly recap' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(put).toHaveBeenCalledWith('/api/settings/notifications', {
        ntfyTopic: 'mazzy-new',
        notifyLargeOver: 300,
        notifyWeekly: false,
      })
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });

  it('sends the large amount as null when the field is cleared', async () => {
    renderPage();
    await screen.findByLabelText('Topic');

    fireEvent.change(screen.getByLabelText('Tell me about charges over'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(put).toHaveBeenCalledWith(
        '/api/settings/notifications',
        expect.objectContaining({ notifyLargeOver: null })
      )
    );
  });

  it('clears the topic with null when it is emptied', async () => {
    renderPage();
    await screen.findByLabelText('Topic');

    fireEvent.change(screen.getByLabelText('Topic'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(put).toHaveBeenCalledWith(
        '/api/settings/notifications',
        expect.objectContaining({ ntfyTopic: null })
      )
    );
  });

  it('refuses a topic the server would reject, without a request', async () => {
    renderPage();
    await screen.findByLabelText('Topic');

    fireEvent.change(screen.getByLabelText('Topic'), { target: { value: 'has spaces' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('1 to 64 characters');
    expect(put).not.toHaveBeenCalled();
  });

  it('refuses a negative large charge amount', async () => {
    renderPage();
    await screen.findByLabelText('Topic');

    fireEvent.change(screen.getByLabelText('Tell me about charges over'), {
      target: { value: '-5' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('0 or more');
    expect(put).not.toHaveBeenCalled();
  });

  it('generates a mazzy- topic of twelve characters', async () => {
    renderPage();
    const topic = (await screen.findByLabelText('Topic')) as HTMLInputElement;

    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    expect(topic.value).toMatch(/^mazzy-[a-z0-9]{12}$/);
  });

  it('generates a different topic each time', async () => {
    renderPage();
    const topic = (await screen.findByLabelText('Topic')) as HTMLInputElement;

    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    const first = topic.value;
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    expect(topic.value).not.toBe(first);
  });

  it('sends a test and says it went out', async () => {
    renderPage();
    await screen.findByLabelText('Topic');

    fireEvent.click(screen.getByRole('button', { name: 'Send a test' }));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/settings/notifications/test'));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Test push sent. Check your phone.'));
  });

  it('explains why a test did not go out', async () => {
    post.mockResolvedValue({ data: { sent: false, reason: 'no-topic' } });

    renderPage();
    await screen.findByLabelText('Topic');

    fireEvent.click(screen.getByRole('button', { name: 'Send a test' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Add a topic and save');
  });

  it('tells the owner to set NTFY_URL when the server has none', async () => {
    get.mockResolvedValue({ data: settings({ serverConfigured: false }) });

    renderPage();

    expect(
      await screen.findByText('Set NTFY_URL on the server to turn this on.')
    ).toBeInTheDocument();
  });

  it('shows how to subscribe in the ntfy app', async () => {
    renderPage();

    expect(await screen.findByText('How to get the pushes')).toBeInTheDocument();
    expect(screen.getByText(/Install the ntfy app/)).toBeInTheDocument();
    expect(screen.getByText('https://<host>.<tailnet>.ts.net:8443')).toBeInTheDocument();
    expect(screen.getByText(/Subscribe to the topic above/)).toBeInTheDocument();
  });

  it('shows a failed load inline with a retry', async () => {
    get.mockRejectedValue({ response: { data: { error: 'Failed to fetch notification settings' } } });

    renderPage();

    expect(await screen.findByText('Failed to fetch notification settings')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
