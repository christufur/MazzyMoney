import { Router, Request, Response } from 'express';
import { Products, CountryCode } from 'plaid';
import { prisma } from '../lib/prisma';
import { authenticateToken } from '../middleware/auth';
import { plaidClient, ITEM_LIMIT, plaidErrorCode } from '../lib/plaid';

const router = Router();

// Protect all routes with authentication
router.use(authenticateToken);

/**
 * POST /api/plaid/link-token
 * Body: { itemId? }
 * Without itemId: a Link token for a new Item (blocked when the server is at ITEM_LIMIT).
 * With itemId: update mode for that Item, so a re-login never uses another free place.
 */
router.post('/link-token', async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { itemId } = req.body ?? {};

  try {
    if (itemId) {
      const item = await prisma.plaidItem.findFirst({
        where: { id: itemId, userId },
      });

      if (!item) {
        return res.status(404).json({ error: 'ITEM_NOT_FOUND' });
      }

      const response = await plaidClient.linkTokenCreate({
        user: { client_user_id: userId },
        client_name: 'Mazzy Money',
        country_codes: [CountryCode.Us],
        language: 'en',
        access_token: item.accessToken,
      });

      return res.json({ link_token: response.data.link_token });
    }

    const used = await prisma.plaidItem.count();
    if (used >= ITEM_LIMIT) {
      return res.status(409).json({ error: 'ITEM_LIMIT' });
    }

    const response = await plaidClient.linkTokenCreate({
      user: { client_user_id: userId },
      client_name: 'Mazzy Money',
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: 'en',
    });

    res.json({ link_token: response.data.link_token });
  } catch (error: any) {
    console.error('Error creating link token:', plaidErrorCode(error) ?? error.message);
    res.status(500).json({ error: 'Failed to create link token' });
  }
});

/**
 * POST /api/plaid/exchange
 * Body: { public_token }
 * Stores one PlaidItem plus its accounts. One Item per institution per user.
 */
router.post('/exchange', async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { public_token } = req.body ?? {};

  if (!public_token) {
    return res.status(400).json({ error: 'public_token is required' });
  }

  // Set once Plaid has created the Item and cleared once it is saved; an unsaved Item still costs a free place.
  let unsavedAccessToken: string | null = null;

  try {
    const exchangeResponse = await plaidClient.itemPublicTokenExchange({
      public_token,
    });
    const accessToken = exchangeResponse.data.access_token;
    const plaidItemId = exchangeResponse.data.item_id;
    unsavedAccessToken = accessToken;

    const itemResponse = await plaidClient.itemGet({ access_token: accessToken });
    const institutionId = itemResponse.data.item.institution_id;

    if (!institutionId) {
      await removeUnsavedItem(unsavedAccessToken);
      return res.status(502).json({ error: 'MISSING_INSTITUTION_ID' });
    }

    const institutionResponse = await plaidClient.institutionsGetById({
      institution_id: institutionId,
      country_codes: [CountryCode.Us],
    });
    const institutionName = institutionResponse.data.institution.name;

    const existing = await prisma.plaidItem.findFirst({
      where: { userId, institutionId },
    });

    if (existing) {
      // A second Item for the same bank costs one of the 10 free places, so revoke it.
      await removeUnsavedItem(unsavedAccessToken);
      return res.status(409).json({ error: 'DUPLICATE_INSTITUTION' });
    }

    const item = await prisma.plaidItem.create({
      data: {
        userId,
        accessToken,
        itemId: plaidItemId,
        institutionId,
        institutionName,
        status: 'ACTIVE',
      },
    });
    unsavedAccessToken = null;

    const accountsResponse = await plaidClient.accountsGet({ access_token: accessToken });

    for (const plaidAccount of accountsResponse.data.accounts) {
      const accountData = {
        plaidItemId: item.id,
        name: plaidAccount.name,
        officialName: plaidAccount.official_name ?? null,
        type: plaidAccount.type,
        subtype: plaidAccount.subtype ?? 'unknown',
        mask: plaidAccount.mask ?? null,
        currentBalance: plaidAccount.balances.current ?? 0,
        availableBalance: plaidAccount.balances.available ?? null,
        creditLimit: plaidAccount.balances.limit ?? null,
        isLiability: plaidAccount.type === 'credit' || plaidAccount.type === 'loan',
        isActive: true,
      };

      const existingAccount = await prisma.account.findUnique({
        where: { plaidAccountId: plaidAccount.account_id },
      });

      // plaidAccountId is unique across the table; never touch a row owned by another user.
      if (existingAccount && existingAccount.userId !== userId) {
        continue;
      }

      if (existingAccount) {
        await prisma.account.update({
          where: { id: existingAccount.id },
          data: accountData,
        });
        continue;
      }

      await prisma.account.create({
        data: {
          plaidAccountId: plaidAccount.account_id,
          userId,
          ...accountData,
        },
      });
    }

    // W2.3 starts the first transaction sync here.

    res.json({
      item: {
        id: item.id,
        institutionName: item.institutionName,
        status: item.status,
      },
    });
  } catch (error: any) {
    await removeUnsavedItem(unsavedAccessToken);
    console.error('Error exchanging public token:', plaidErrorCode(error) ?? error.message);
    res.status(500).json({ error: 'Failed to exchange public token' });
  }
});

async function removeUnsavedItem(accessToken: string | null) {
  if (!accessToken) return;
  try {
    await plaidClient.itemRemove({ access_token: accessToken });
  } catch (removeError: any) {
    console.warn('Error removing unsaved Plaid item:', plaidErrorCode(removeError) ?? removeError?.message);
  }
}

/**
 * GET /api/plaid/items
 * The user's connected banks, plus the server-wide Item count for the connections page.
 */
router.get('/items', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    const items = await prisma.plaidItem.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      include: {
        accounts: {
          where: { isActive: true },
          orderBy: { createdAt: 'asc' },
          select: { id: true, name: true, mask: true, type: true, subtype: true },
        },
      },
    });

    const used = await prisma.plaidItem.count();

    res.json({
      items: items.map((item) => ({
        id: item.id,
        institutionName: item.institutionName,
        status: item.status,
        lastSyncAt: item.lastSyncAt,
        lastError: item.lastError,
        accounts: item.accounts,
      })),
      used,
      limit: ITEM_LIMIT,
    });
  } catch (error: any) {
    console.error('Error fetching plaid items:', error);
    res.status(500).json({ error: 'Failed to fetch connected banks' });
  }
});

/**
 * DELETE /api/plaid/items/:id
 * Revokes the Item at Plaid, then deletes the row (accounts and transactions cascade).
 */
router.delete('/items/:id', async (req: Request, res: Response) => {
  const userId = req.user!.id;

  try {
    const item = await prisma.plaidItem.findFirst({
      where: { id: req.params.id, userId },
    });

    if (!item) {
      return res.status(404).json({ error: 'ITEM_NOT_FOUND' });
    }

    try {
      await plaidClient.itemRemove({ access_token: item.accessToken });
    } catch (removeError: any) {
      const code = plaidErrorCode(removeError);
      // The Item is already gone at Plaid: still drop the local row.
      if (code !== 'ITEM_NOT_FOUND') {
        console.error('Error removing item from Plaid:', code ?? removeError?.message);
        return res.status(502).json({ error: 'PLAID_REMOVE_FAILED', code });
      }
    }

    await prisma.plaidItem.delete({ where: { id: item.id } });

    res.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting plaid item:', error);
    res.status(500).json({ error: 'Failed to remove connected bank' });
  }
});

export default router;
