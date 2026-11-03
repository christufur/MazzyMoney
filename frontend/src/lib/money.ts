const exact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const whole = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** $1,234.56 — tables and figures. */
export const money = (n: number) => exact.format(n);
/** $1,235 — sentences and compact lines. */
export const moneyWhole = (n: number) => whole.format(Math.round(n));

/** Month helpers on local calendar months, as the household reads them. */
export const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
export const parseMonth = (key: string) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1);
};
export const addMonths = (key: string, n: number) => {
  const d = parseMonth(key);
  return monthKey(new Date(d.getFullYear(), d.getMonth() + n, 1));
};
export const monthName = (key: string, withYear = true) =>
  parseMonth(key).toLocaleDateString('en-US', withYear ? { month: 'long', year: 'numeric' } : { month: 'long' });
export const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
