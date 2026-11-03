import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import SidebarLayout from '../components/layout/SidebarLayout';
import { api } from '../services/api';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { moneyWhole } from '@/lib/money';

/**
 * Notification settings (plan E2). Pushes leave this server through a self-hosted ntfy
 * instance; the topic is the address the household's phones subscribe to, so it is the
 * one field that must be easy to copy onto a phone and hard to guess.
 */

export interface NotificationSettings {
  ntfyTopic: string | null;
  notifyLargeOver: number | null;
  notifyWeekly: boolean;
  serverConfigured: boolean;
}

export interface TestResult {
  sent: boolean;
  reason?: string;
}

/** The reason phrases the server can answer with, as something the owner can act on. */
const REASON_TEXT: Record<string, string> = {
  'not-configured': 'This server has no NTFY_URL yet, so nothing can be sent.',
  'no-topic': 'Add a topic and save before sending a test.',
  duplicate: 'This notification was already sent.',
  'send-failed': 'The ntfy server did not accept the push. Check that it is running.',
  error: 'The push could not be sent. Check the server logs.',
};

/** Kept in the page: `services/api.ts` is shared with other agents right now. */
const notificationAPI = {
  get: async (): Promise<NotificationSettings> => {
    const response = await api.get('/api/settings/notifications');
    return response.data;
  },

  save: async (changes: Partial<NotificationSettings>): Promise<NotificationSettings> => {
    const response = await api.put('/api/settings/notifications', changes);
    return response.data;
  },

  test: async (): Promise<TestResult> => {
    const response = await api.post('/api/settings/notifications/test');
    return response.data;
  },
};

const TOPIC_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const TOPIC_BODY_LENGTH = 12;

/** `mazzy-` plus twelve random characters: the shape ntfy topics like and people can read out. */
const generateTopic = (): string => {
  const bytes = new Uint8Array(TOPIC_BODY_LENGTH);

  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    // Only reachable on an old runtime; the topic still needs to be unguessable enough
    // to keep a household's pushes off a shared server.
    for (let index = 0; index < bytes.length; index++) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  const body = Array.from(bytes, (byte) => TOPIC_ALPHABET[byte % TOPIC_ALPHABET.length]).join('');
  return `mazzy-${body}`;
};

const Settings: React.FC = () => {
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [topic, setTopic] = useState('');
  const [largeOver, setLargeOver] = useState('');
  const [weekly, setWeekly] = useState(true);

  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const applySettings = useCallback((next: NotificationSettings) => {
    setSettings(next);
    setTopic(next.ntfyTopic ?? '');
    setLargeOver(next.notifyLargeOver === null ? '' : String(next.notifyLargeOver));
    setWeekly(next.notifyWeekly);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      applySettings(await notificationAPI.get());
    } catch (err: any) {
      setLoadError(
        err.response?.data?.error ||
          'Could not load your notification settings. Check that the server is running, then try again.'
      );
    } finally {
      setLoading(false);
    }
  }, [applySettings]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);

    const trimmedTopic = topic.trim();
    const trimmedAmount = largeOver.trim();

    if (trimmedTopic !== '' && !/^[A-Za-z0-9_-]{1,64}$/.test(trimmedTopic)) {
      setFormError('A topic is 1 to 64 characters: letters, numbers, dash and underscore.');
      return;
    }

    let amount: number | null = null;
    if (trimmedAmount !== '') {
      amount = Number(trimmedAmount);
      if (!Number.isFinite(amount) || amount < 0) {
        setFormError('The large charge amount must be 0 or more. Leave it empty to turn those pushes off.');
        return;
      }
    }

    try {
      setSaving(true);
      applySettings(
        await notificationAPI.save({
          ntfyTopic: trimmedTopic === '' ? null : trimmedTopic,
          notifyLargeOver: amount,
          notifyWeekly: weekly,
        })
      );
      toast.success('Notification settings saved.');
    } catch (err: any) {
      setFormError(err.response?.data?.error || 'Could not save these settings. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setFormError(null);
    try {
      setTesting(true);
      const result = await notificationAPI.test();
      if (result.sent) {
        toast.success('Test push sent. Check your phone.');
      } else {
        const reason = (result.reason && REASON_TEXT[result.reason]) || REASON_TEXT.error;
        setFormError(reason);
      }
    } catch (err: any) {
      setFormError(err.response?.data?.error || 'Could not send a test push. Try again.');
    } finally {
      setTesting(false);
    }
  };

  const serverConfigured = settings?.serverConfigured ?? true;
  const thresholdLabel = largeOver.trim() === '' ? null : Number(largeOver);
  const thresholdHint =
    thresholdLabel !== null && Number.isFinite(thresholdLabel) && thresholdLabel >= 0
      ? `A push for any single charge over ${moneyWhole(thresholdLabel)}.`
      : 'Leave it empty to stop the large charge pushes.';

  return (
    <SidebarLayout title="Settings">
      {loadError && (
        <div
          role="alert"
          className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-md bg-terra-tint px-4 py-3 text-sm text-terra"
        >
          <span>{loadError}</span>
          <Button variant="outline" size="sm" onClick={load}>
            Try again
          </Button>
        </div>
      )}

      <section aria-label="Notifications" className="sheet">
        <div className="border-b border-rule px-6 py-5 md:px-8">
          <h2 className="section-label">Notifications</h2>
          <p className="mt-2 max-w-xl text-[15px] text-muted-foreground">
            Pushes go to your phone through ntfy, on your own server.
          </p>
        </div>

        {loading && !settings ? (
          <div className="space-y-4 px-6 py-6 md:px-8" aria-busy="true">
            <span className="sr-only">Loading notification settings</span>
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-9 w-full max-w-sm" />
            <Skeleton className="h-4 w-56" />
          </div>
        ) : (
          <form onSubmit={handleSave} noValidate className="px-6 py-6 md:px-8">
            {!serverConfigured && (
              <p className="mb-6 rounded-md bg-paper px-4 py-3 text-sm text-muted-foreground">
                Set NTFY_URL on the server to turn this on.
              </p>
            )}

            <div className="max-w-md space-y-6">
              <div className="space-y-1.5">
                <Label htmlFor="ntfy-topic">Topic</Label>
                <div className="flex items-start gap-2">
                  <Input
                    id="ntfy-topic"
                    value={topic}
                    maxLength={64}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="mazzy-household"
                    onChange={(event) => setTopic(event.target.value)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setTopic(generateTopic())}
                    className="shrink-0"
                  >
                    Generate
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  The topic is the address your phones listen on. Anyone who knows it can read
                  your pushes, so treat it like a password.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ntfy-large-over">Tell me about charges over</Label>
                <div className="flex items-center gap-2">
                  <span aria-hidden className="text-sm text-muted-foreground">
                    $
                  </span>
                  <Input
                    id="ntfy-large-over"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    placeholder="No limit"
                    value={largeOver}
                    onChange={(event) => setLargeOver(event.target.value)}
                    className="max-w-[9rem]"
                  />
                </div>
                <p className="text-xs text-muted-foreground">{thresholdHint}</p>
              </div>

              <div className="flex items-start gap-3">
                <Checkbox
                  id="ntfy-weekly"
                  checked={weekly}
                  onCheckedChange={(checked) => setWeekly(checked === true)}
                  className="mt-0.5"
                />
                <div className="space-y-1">
                  <Label htmlFor="ntfy-weekly" className="font-normal">
                    Weekly recap
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    One push on Sunday evening: what the week cost, what the month has saved, and
                    what still needs review.
                  </p>
                </div>
              </div>
            </div>

            {formError && (
              <p role="alert" className="mt-6 text-sm text-terra">
                {formError}
              </p>
            )}

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
              <Button type="button" variant="outline" onClick={handleTest} disabled={testing}>
                {testing ? 'Sending…' : 'Send a test'}
              </Button>
            </div>
          </form>
        )}

        <div className="border-t border-rule px-6 py-6 md:px-8">
          <h3 className="section-label">How to get the pushes</h3>
          <ol className="mt-3 max-w-xl space-y-2 text-[15px] leading-relaxed">
            <li>
              1. Install the ntfy app on your phone (iOS or Android).
            </li>
            <li>
              2. Add this server:{' '}
              <span className="text-ink">https://&lt;host&gt;.&lt;tailnet&gt;.ts.net:8443</span>
            </li>
            <li>3. Subscribe to the topic above, spelled exactly as it is saved.</li>
            <li>4. Send a test and check that the push arrives.</li>
          </ol>
          <p className="mt-3 max-w-xl text-sm text-muted-foreground">
            Your phone has to be on the tailnet for this address to answer, which is the same
            network the app already uses.
          </p>
        </div>
      </section>
    </SidebarLayout>
  );
};

export default Settings;
