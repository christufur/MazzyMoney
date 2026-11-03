// Order: the first matching rule by priority (descending), then Plaid personal_finance_category
// (detailed, then primary), then 'Other'. Rule matching is a plain case-insensitive substring
// check; no pattern is ever compiled from user data, so a merchant like "SQ *BLUE BOTTLE" is safe.

import { PFC_DETAILED_MAP, PFC_PRIMARY_MAP } from './categories';

export interface CategorizeInput {
  name: string;
  merchantName?: string | null;
  amount: number;
  accountId: string;
  pfcPrimary?: string | null;
  pfcDetailed?: string | null;
}

export interface RuleLike {
  id: string;
  priority: number;
  matchMerchant?: string | null;
  matchAmountMin?: number | null;
  matchAmountMax?: number | null;
  matchAccountId?: string | null;
  setCategory?: string | null;
  setMerchant?: string | null;
  setTransfer?: boolean | null;
  setHidden?: boolean | null;
}

export interface CategorizeResult {
  category: string;
  source: 'PLAID' | 'RULE';
  isTransfer: boolean;
  hidden: boolean;
  merchantDisplay: string | null;
  ruleId: string | null;
}

export function ruleMatches(rule: RuleLike, tx: CategorizeInput): boolean {
  let hasCondition = false;

  if (rule.matchMerchant != null) {
    hasCondition = true;
    const haystack = `${tx.merchantName ?? ''} ${tx.name}`.toLowerCase();
    if (!haystack.includes(rule.matchMerchant.toLowerCase())) return false;
  }

  if (rule.matchAmountMin != null) {
    hasCondition = true;
    if (Math.abs(tx.amount) < rule.matchAmountMin) return false;
  }

  if (rule.matchAmountMax != null) {
    hasCondition = true;
    if (Math.abs(tx.amount) > rule.matchAmountMax) return false;
  }

  if (rule.matchAccountId != null) {
    hasCondition = true;
    if (tx.accountId !== rule.matchAccountId) return false;
  }

  return hasCondition;
}

export function categorize(tx: CategorizeInput, rules: RuleLike[]): CategorizeResult {
  const ordered = rules
    .map((rule, index) => ({ rule, index }))
    .sort((a, b) => b.rule.priority - a.rule.priority || a.index - b.index)
    .map(entry => entry.rule);

  const rule = ordered.find(candidate => ruleMatches(candidate, tx)) ?? null;

  const ruleCategory = rule?.setCategory ? rule.setCategory : null;
  const isTransfer = rule?.setTransfer ?? looksLikeTransfer(tx);

  let category: string;
  let source: CategorizeResult['source'];

  if (ruleCategory) {
    category = ruleCategory;
    source = 'RULE';
  } else {
    source = 'PLAID';
    category = isTransfer ? 'Transfer' : plaidCategory(tx);
  }

  return {
    category,
    source,
    isTransfer,
    hidden: rule?.setHidden ?? false,
    merchantDisplay: rule?.setMerchant ?? null,
    ruleId: rule?.id ?? null
  };
}

function plaidCategory(tx: CategorizeInput): string {
  const detailed = tx.pfcDetailed ? PFC_DETAILED_MAP[tx.pfcDetailed] : undefined;
  if (detailed) return detailed;

  const primary = tx.pfcPrimary ? PFC_PRIMARY_MAP[tx.pfcPrimary] : undefined;
  if (primary) return primary;

  return 'Other';
}

function looksLikeTransfer(tx: CategorizeInput): boolean {
  // An ATM withdrawal comes out as TRANSFER_OUT, but it is spending, not a transfer.
  if (tx.pfcDetailed === 'TRANSFER_OUT_WITHDRAWAL') return false;
  if (tx.pfcPrimary === 'TRANSFER_IN' || tx.pfcPrimary === 'TRANSFER_OUT') return true;
  return tx.pfcDetailed === 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT';
}
