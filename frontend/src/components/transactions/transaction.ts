/**
 * The shape one ledger row has on the wire, plus the small formatters every
 * transaction surface shares. Kept out of the page so the list and the review
 * queue read a row the same way.
 */
import { money } from '@/lib/money';

export interface TransactionRow {
  id: string;
  name: string;
  merchantName: string | null;
  merchantDisplay: string | null;
  amount: number;
  date: string;
  pending: boolean;
  isTransfer: boolean;
  hidden: boolean;
  reviewed: boolean;
  primaryCategory: string | null;
  categorySource: 'PLAID' | 'RULE' | 'USER';
  notes: string | null;
  account: {
    id: string;
    name: string;
    mask: string | null;
    type: string;
    subtype: string;
  } | null;
}

/** The cleaned merchant name when there is one, otherwise the bank's own text. */
export const displayNameOf = (row: TransactionRow) =>
  row.merchantDisplay ?? row.merchantName ?? row.name;

/** The bank's own memo, only when it says something the display name does not. */
export const bankMemoOf = (row: TransactionRow): string | null => {
  const displayName = displayNameOf(row);
  return row.name && row.name !== displayName ? row.name : null;
};

/** "Everyday Checking ••4321", the way the account reads on a statement. */
export const accountLabel = (account: TransactionRow['account']) =>
  account ? `${account.name}${account.mask ? ` ••${account.mask}` : ''}` : '';

const toDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** Ledger dates read "Nov 2"; a row from another year carries its year so it cannot be misread. */
export const shortDay = (value: string) => {
  const date = toDate(value);
  if (!date) return '—';
  const sameYear = date.getUTCFullYear() === new Date().getUTCFullYear();
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
};

export const dayMonth = (value: string) => {
  const date = toDate(value);
  if (!date) return '—';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
};

/** Row money: the API stores money out as a positive amount, so out is a true minus. */
export const signedAmount = (amount: number) => {
  if (amount === 0) return money(0);
  return amount > 0 ? `−${money(amount)}` : `+${money(-amount)}`;
};

/** Money in earns the sage ink and a plus; money out stays ink. */
export const amountTone = (amount: number) => (amount > 0 ? 'text-ink' : 'text-sage-ink');
