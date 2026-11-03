// Notification settings (plan E2): the per-user ntfy topic and the two toggles.
//
// The topic is the only secret-ish value here: anyone on the ntfy server who knows it
// can read the household's pushes, so it is validated to a plain 1-64 char slug and is
// never logged.

import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authenticateToken } from '../middleware/auth';
import { NotifyService, isNtfyConfigured } from '../services/notifyService';

const router = Router();
router.use(authenticateToken);

const TOPIC_PATTERN = /^[A-Za-z0-9_-]+$/;
const TOPIC_MIN = 1;
const TOPIC_MAX = 64;

type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

interface NotificationSettings {
  ntfyTopic: string | null;
  notifyLargeOver: number | null;
  notifyWeekly: boolean;
}

/** A JSON body sent by this page, or a form value; `undefined` when the field is absent. */
const present = (value: unknown) => value !== undefined;

function parseTopic(value: unknown): ValidationResult<string | null> {
  if (value === null) {
    return { ok: true, value: null };
  }

  if (typeof value !== 'string') {
    return { ok: false, error: 'Topic must be text or null' };
  }

  const topic = value.trim();
  if (topic.length < TOPIC_MIN || topic.length > TOPIC_MAX) {
    return { ok: false, error: `Topic must be ${TOPIC_MIN} to ${TOPIC_MAX} characters` };
  }

  if (!TOPIC_PATTERN.test(topic)) {
    return { ok: false, error: 'Topic can use letters, numbers, dash and underscore only' };
  }

  return { ok: true, value: topic };
}

function parseLargeAmount(value: unknown): ValidationResult<number | null> {
  if (value === null || value === '') {
    return { ok: true, value: null };
  }

  const amount =
    typeof value === 'string' ? Number(value.trim()) : typeof value === 'number' ? value : NaN;

  if (!Number.isFinite(amount) || amount < 0) {
    return { ok: false, error: 'Large charge amount must be 0 or more' };
  }

  return { ok: true, value: Math.round(amount * 100) / 100 };
}

function parseWeekly(value: unknown): ValidationResult<boolean> {
  if (typeof value !== 'boolean') {
    return { ok: false, error: 'notifyWeekly must be true or false' };
  }
  return { ok: true, value };
}

const serialize = (user: {
  ntfyTopic: string | null;
  notifyLargeOver: number | null;
  notifyWeekly: boolean;
}) => ({
  ntfyTopic: user.ntfyTopic,
  notifyLargeOver: user.notifyLargeOver,
  notifyWeekly: user.notifyWeekly,
  serverConfigured: isNtfyConfigured(),
});

/**
 * GET /api/settings/notifications
 * The user's notification settings plus whether this server can send at all.
 */
router.get('/notifications', async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { ntfyTopic: true, notifyLargeOver: true, notifyWeekly: true },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(serialize(user));
  } catch (error: any) {
    console.error('Error fetching notification settings:', error);
    res.status(500).json({ error: 'Failed to fetch notification settings' });
  }
});

/**
 * PUT /api/settings/notifications
 * Body: any of `ntfyTopic`, `notifyLargeOver`, `notifyWeekly`. Only the fields sent
 * are changed, so the page can save one control without sending the rest.
 */
router.put('/notifications', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const body = req.body ?? {};
    const changes: Partial<NotificationSettings> = {};

    if (present(body.ntfyTopic)) {
      const topic = parseTopic(body.ntfyTopic);
      if (!topic.ok) {
        return res.status(400).json({ error: topic.error });
      }
      changes.ntfyTopic = topic.value;
    }

    if (present(body.notifyLargeOver)) {
      const amount = parseLargeAmount(body.notifyLargeOver);
      if (!amount.ok) {
        return res.status(400).json({ error: amount.error });
      }
      changes.notifyLargeOver = amount.value;
    }

    if (present(body.notifyWeekly)) {
      const weekly = parseWeekly(body.notifyWeekly);
      if (!weekly.ok) {
        return res.status(400).json({ error: weekly.error });
      }
      changes.notifyWeekly = weekly.value;
    }

    if (Object.keys(changes).length === 0) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: changes,
      select: { ntfyTopic: true, notifyLargeOver: true, notifyWeekly: true },
    });

    res.json(serialize(user));
  } catch (error: any) {
    console.error('Error updating notification settings:', error);
    res.status(500).json({ error: 'Failed to update notification settings' });
  }
});

/**
 * POST /api/settings/notifications/test
 * Sends one push now. Unlike a real notification this skips the dedupe log, so the
 * button works as often as the user taps it.
 */
router.post('/notifications/test', async (req: Request, res: Response) => {
  try {
    const result = await NotifyService.sendTest(req.user!.id);

    if (result.sent) {
      return res.json({ sent: true });
    }

    res.status(200).json({ sent: false, reason: result.reason ?? 'error' });
  } catch (error: any) {
    // `sendTest` already swallows its own errors; this is only a last resort.
    console.error('Error sending a test notification:', error);
    res.status(500).json({ error: 'Failed to send the test notification' });
  }
});

export default router;
