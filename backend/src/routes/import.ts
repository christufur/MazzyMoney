// CSV import of card transactions into a manual account (plan Wave E, E3).
//
// `POST /api/accounts/manual/:id/import` with `{ csv, format, mapping?, dryRun? }`. Mounted ahead
// of the app-wide JSON parser, because a card export is megabytes where the rest of the API is
// small: this router parses up to 6 MB and ImportService holds the file itself to 5 MB / 5,000
// rows. Everything else is ordinary: the caller's own manual account or a 404, and no Plaid calls.

import express, { Router, Request, Response, NextFunction } from 'express';
import { authenticateToken } from '../middleware/auth';
import { prisma } from '../lib/prisma';
import { ImportService } from '../services/importService';

/** The body ceiling for this route; the CSV inside may be up to 5 MB. */
export const IMPORT_BODY_LIMIT = '6mb';

const importRouter = Router();

const jsonParser = express.json({ limit: IMPORT_BODY_LIMIT });

/**
 * A body that is not valid JSON, or is over the limit, answers in JSON like every other route
 * instead of express's default HTML page. Registered last: an error handler only sees errors from
 * the layers before it.
 */
const bodyErrorHandler = (err: any, _req: Request, res: Response, next: NextFunction) => {
  if (err?.type === 'entity.too.large') {
    return res.status(400).json({
      error: `Request body is too large. Send one CSV of at most 5 MB (body limit ${IMPORT_BODY_LIMIT}).`,
    });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Body must be JSON: { csv, format, mapping?, dryRun? }' });
  }
  return next(err);
};

/**
 * POST /api/accounts/manual/:id/import
 * Body: { csv: string, format: 'apple-card' | 'generic', mapping?, dryRun? }
 *
 * 200 { imported, skipped, payments, firstDate, lastDate, errors, note } — or, with dryRun,
 * 200 { dryRun: true, preview, total, duplicates, errors, note } and nothing is written.
 * 400 for an unusable file (empty, wrong header, over 5 MB, over 5,000 rows, every row invalid).
 * 404 when the account is not one of the caller's manual accounts.
 */
importRouter.post('/:id/import', authenticateToken, jsonParser, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    const account = await prisma.account.findFirst({
      where: { id: req.params.id, userId, isManual: true },
      select: { id: true },
    });

    if (!account) {
      return res.status(404).json({ error: 'MANUAL_ACCOUNT_NOT_FOUND' });
    }

    const body = req.body ?? {};
    const outcome = await ImportService.importCsv({
      userId,
      accountId: account.id,
      csv: body.csv,
      format: body.format,
      mapping: body.mapping,
      dryRun: body.dryRun,
    });

    if (!outcome.ok) {
      return res.status(outcome.status).json({ error: outcome.error, errors: outcome.errors });
    }

    res.json(outcome.body);
  } catch (error: any) {
    console.error('Error importing CSV:', error);
    res.status(500).json({ error: 'Failed to import CSV' });
  }
});

importRouter.use(bodyErrorHandler);

export { importRouter };
