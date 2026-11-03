import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';

/**
 * The only Plaid client in the app.
 *
 * Cost rules (PROJECT_OVERVIEW.md 6.5): use the `Transactions` product only and
 * never call the endpoints that are billed per call. The Trial plan is free for
 * up to 10 Items, so ITEM_LIMIT guards every new connection.
 */
const plaidEnv = process.env.PLAID_ENV ?? 'sandbox';
const basePath =
  (PlaidEnvironments as Record<string, string>)[plaidEnv] ?? PlaidEnvironments.sandbox;

const configuration = new Configuration({
  basePath,
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET,
    },
  },
});

export const plaidClient = new PlaidApi(configuration);

/** Free Trial plan: 10 Items for the whole server. */
export const ITEM_LIMIT = 10;

/** Plaid puts its error code in the axios response body. */
export function plaidErrorCode(err: any): string | undefined {
  return err?.response?.data?.error_code;
}
