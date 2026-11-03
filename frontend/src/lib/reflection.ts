import { moneyWhole } from './money';

export interface ReflectionInput {
  isCurrentMonth: boolean;
  monthLabel: string;      // "November"
  nextMonthLabel: string;  // "December"
  income: number;          // positive
  spent: number;           // positive; transfers and hidden rows already excluded by the API
  /** Saved by the same day last month; null when unknown or not comparable. */
  lastMonthSaved: number | null;
  overLines: { category: string; over: number; rollover: boolean }[];
  hasBudgets: boolean;
  /** The savings target set when the month before was closed; null or absent when none. */
  savingsTarget?: number | null;
}

/** The spread's one plain sentence about the month: facts first, calm about overspending. */
export function reflectOnMonth(r: ReflectionInput): string {
  if (r.income === 0 && r.spent === 0) {
    return r.isCurrentMonth ? 'Nothing recorded for this month yet.' : `Nothing was recorded in ${r.monthLabel}.`;
  }

  const parts: string[] = [];
  const saved = r.income - r.spent;

  if (saved >= 0) {
    let s = r.isCurrentMonth
      ? `You have saved ${moneyWhole(saved)} so far this month`
      : `You saved ${moneyWhole(saved)} in ${r.monthLabel}`;
    if (r.lastMonthSaved !== null) {
      const diff = Math.round(saved - r.lastMonthSaved);
      if (diff > 0) s += `, ${moneyWhole(diff)} more than at this point last month`;
      else if (diff < 0) s += `, ${moneyWhole(-diff)} less than at this point last month`;
    }
    parts.push(`${s}.`);
  } else {
    parts.push(
      r.isCurrentMonth
        ? `Spending is ${moneyWhole(-saved)} ahead of income so far this month.`
        : `Spending was ${moneyWhole(-saved)} more than income in ${r.monthLabel}.`
    );
  }

  if (r.savingsTarget) {
    const target = moneyWhole(r.savingsTarget);
    if (saved >= r.savingsTarget) parts.push(`That meets your ${target} target.`);
    else if (r.isCurrentMonth) parts.push(`${moneyWhole(r.savingsTarget - Math.max(saved, 0))} to go to your ${target} target.`);
    else parts.push(`The target was ${target}.`);
  }

  const over = [...r.overLines].filter((l) => l.over > 0).sort((a, b) => b.over - a.over);
  if (over.length > 0) {
    const [top, ...rest] = over;
    const tense = r.isCurrentMonth ? 'is' : 'went';
    parts.push(
      `${top.category} ${tense} ${moneyWhole(top.over)} over${top.rollover ? ` and rolls into ${r.nextMonthLabel}` : ''}.`
    );
    if (rest.length === 1) parts.push(`${rest[0].category} is over too.`);
    else if (rest.length > 1) parts.push(`${rest.length} more lines are over too.`);
  } else if (r.hasBudgets) {
    parts.push('Every budget line is on plan.');
  }

  return parts.join(' ');
}
