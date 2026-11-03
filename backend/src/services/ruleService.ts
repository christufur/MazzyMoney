// Rules (plan W4.2): create, edit, preview, and apply a rule to the rows that already exist.
//
// Matching reuses `ruleMatches` from services/categorizer.ts, so a rule behaves here exactly as it
// does on the sync path: a plain case-insensitive substring check, never a pattern compiled from
// user data. A household has a few hundred rules and a few thousand rows, so the match count and
// the apply list are computed in memory over that user's rows instead of in SQL.

import { prisma } from '../lib/prisma';
import { CATEGORIES } from './categories';
import { ruleMatches, type CategorizeInput, type RuleLike } from './categorizer';
import type { Prisma, Rule } from '../../prisma/generated/prisma';

export const MATCH_MERCHANT_MAX = 100;
export const SET_MERCHANT_MAX = 80;
export const PRIORITY_MAX = 1000;
export const PREVIEW_SAMPLE_SIZE = 10;

type CategorySourceName = 'PLAID' | 'RULE' | 'USER';
type TransactionUpdate = Prisma.TransactionUpdateManyMutationInput;

/** The rule fields the user can set; a saved rule and a draft share this shape. */
export interface RuleFields {
  priority: number;
  matchMerchant: string | null;
  matchAmountMin: number | null;
  matchAmountMax: number | null;
  matchAccountId: string | null;
  setCategory: string | null;
  setMerchant: string | null;
  setTransfer: boolean | null;
  setHidden: boolean | null;
}

export type RuleValidation = { ok: true; fields: RuleFields } | { ok: false; error: string };

/** The columns matching and applying a rule read; no notes, categories, or Plaid fields. */
export interface MatchableTransaction {
  id: string;
  name: string;
  merchantName: string | null;
  amount: number;
  accountId: string;
  date: Date;
  primaryCategory: string | null;
  categorySource: CategorySourceName;
}

export interface PreviewResult {
  matchCount: number;
  sample: Array<{
    id: string;
    date: Date;
    name: string;
    merchantName: string | null;
    amount: number;
    primaryCategory: string | null;
  }>;
}

export interface ApplyResult {
  updated: number;
  /** Rows the rule wanted to recategorise but left alone because the user owns the category. */
  skippedUserCategory: number;
}

export type RuleWithMatchCount = Rule & { matchCount: number };

const MATCHABLE_SELECT = {
  id: true,
  name: true,
  merchantName: true,
  amount: true,
  accountId: true,
  date: true,
  primaryCategory: true,
  categorySource: true,
} as const;

/**
 * Validates a rule draft for both create and update.
 *
 * A rule needs at least one condition and at least one action. Unknown extra keys are ignored;
 * `null` and a missing key both mean "not set", and a blank merchant name counts as not set.
 */
export async function validateRuleInput(input: unknown, userId: string): Promise<RuleValidation> {
  const body = (input ?? {}) as Record<string, unknown>;

  // --- Conditions -------------------------------------------------------

  let matchMerchant: string | null = null;
  if (body.matchMerchant !== undefined && body.matchMerchant !== null) {
    if (typeof body.matchMerchant !== 'string') {
      return invalid('matchMerchant must be text');
    }
    const trimmed = body.matchMerchant.trim();
    if (trimmed.length > MATCH_MERCHANT_MAX) {
      return invalid(`matchMerchant must be ${MATCH_MERCHANT_MAX} characters or fewer`);
    }
    matchMerchant = trimmed.length > 0 ? trimmed : null;
  }

  const matchAmountMin = parseAmount(body.matchAmountMin, 'matchAmountMin');
  if (!matchAmountMin.ok) return invalid(matchAmountMin.error);

  const matchAmountMax = parseAmount(body.matchAmountMax, 'matchAmountMax');
  if (!matchAmountMax.ok) return invalid(matchAmountMax.error);

  if (
    matchAmountMin.value !== null &&
    matchAmountMax.value !== null &&
    matchAmountMin.value > matchAmountMax.value
  ) {
    return invalid('matchAmountMin must not be greater than matchAmountMax');
  }

  let matchAccountId: string | null = null;
  if (body.matchAccountId !== undefined && body.matchAccountId !== null) {
    const raw = body.matchAccountId;
    if (typeof raw !== 'string' || raw.trim() === '') {
      return invalid('matchAccountId must be one of your accounts');
    }

    // Scoped by userId: another user's account id is rejected, not silently stored.
    const account = await prisma.account.findFirst({
      where: { id: raw, userId },
      select: { id: true },
    });

    if (!account) {
      return invalid('matchAccountId must be one of your accounts');
    }
    matchAccountId = account.id;
  }

  // --- Actions ----------------------------------------------------------

  let setCategory: string | null = null;
  if (body.setCategory !== undefined && body.setCategory !== null) {
    if (!isCategory(body.setCategory)) {
      return invalid('setCategory must be one of the app categories');
    }
    setCategory = body.setCategory;
  }

  let setMerchant: string | null = null;
  if (body.setMerchant !== undefined && body.setMerchant !== null) {
    if (typeof body.setMerchant !== 'string') {
      return invalid('setMerchant must be text');
    }
    const trimmed = body.setMerchant.trim();
    if (trimmed.length > SET_MERCHANT_MAX) {
      return invalid(`setMerchant must be ${SET_MERCHANT_MAX} characters or fewer`);
    }
    setMerchant = trimmed.length > 0 ? trimmed : null;
  }

  const setTransfer = parseBoolean(body.setTransfer, 'setTransfer');
  if (!setTransfer.ok) return invalid(setTransfer.error);

  const setHidden = parseBoolean(body.setHidden, 'setHidden');
  if (!setHidden.ok) return invalid(setHidden.error);

  // --- Priority ---------------------------------------------------------

  let priority = 0;
  if (body.priority !== undefined && body.priority !== null) {
    const parsed = typeof body.priority === 'number' ? body.priority : Number.NaN;
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > PRIORITY_MAX) {
      return invalid(`priority must be a whole number from 0 to ${PRIORITY_MAX}`);
    }
    priority = parsed;
  }

  // --- At least one of each ---------------------------------------------

  const hasCondition =
    matchMerchant !== null ||
    matchAmountMin.value !== null ||
    matchAmountMax.value !== null ||
    matchAccountId !== null;

  if (!hasCondition) {
    return invalid(
      'A rule needs at least one condition: matchMerchant, matchAmountMin, matchAmountMax, or matchAccountId'
    );
  }

  const hasAction =
    setCategory !== null ||
    setMerchant !== null ||
    setTransfer.value !== null ||
    setHidden.value !== null;

  if (!hasAction) {
    return invalid(
      'A rule needs at least one action: setCategory, setMerchant, setTransfer, or setHidden'
    );
  }

  return {
    ok: true,
    fields: {
      priority,
      matchMerchant,
      matchAmountMin: matchAmountMin.value,
      matchAmountMax: matchAmountMax.value,
      matchAccountId,
      setCategory,
      setMerchant,
      setTransfer: setTransfer.value,
      setHidden: setHidden.value,
    },
  };
}

/** How many of the given rows the rule matches right now. */
export function countMatches(rule: RuleFields | RuleLike, transactions: MatchableTransaction[]): number {
  const candidate = asRuleLike(rule);
  return transactions.reduce((count, transaction) => {
    return ruleMatches(candidate, toCategorizeInput(transaction)) ? count + 1 : count;
  }, 0);
}

export class RuleService {
  /** The user's rules, highest priority first, each with the number of rows it matches today. */
  static async list(userId: string): Promise<RuleWithMatchCount[]> {
    const [rules, transactions] = await Promise.all([
      prisma.rule.findMany({
        where: { userId },
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      }),
      this.matchableTransactions(userId),
    ]);

    return rules.map((rule) => ({ ...rule, matchCount: countMatches(rule, transactions) }));
  }

  /** A dry run: how many rows a draft would touch, and up to ten of them. Nothing is written. */
  static async preview(userId: string, fields: RuleFields): Promise<PreviewResult> {
    const transactions = await this.matchableTransactions(userId);
    const matched = transactions.filter((transaction) =>
      ruleMatches(asRuleLike(fields), toCategorizeInput(transaction))
    );

    return {
      matchCount: matched.length,
      // The query is newest first, so this is the ten most recent matches.
      sample: matched.slice(0, PREVIEW_SAMPLE_SIZE).map(toSample),
    };
  }

  /**
   * Applies one saved rule to the rows that already exist.
   *
   * A row the user categorised themselves (`categorySource: USER`) keeps its category, but the
   * rule's other actions still land. Returns null when the rule is not the user's.
   */
  static async apply(userId: string, ruleId: string): Promise<ApplyResult | null> {
    const rule = await prisma.rule.findFirst({ where: { id: ruleId, userId } });
    if (!rule) return null;

    const transactions = await this.matchableTransactions(userId);
    const matched = transactions.filter((transaction) =>
      ruleMatches(rule, toCategorizeInput(transaction))
    );

    if (matched.length === 0) {
      return { updated: 0, skippedUserCategory: 0 };
    }

    const actions: TransactionUpdate = {};
    if (rule.setMerchant !== null) actions.merchantDisplay = rule.setMerchant;
    if (rule.setTransfer !== null) actions.isTransfer = rule.setTransfer;
    if (rule.setHidden !== null) actions.hidden = rule.setHidden;

    // An explicit category belongs to the rule from now on. A transfer rule with no category of
    // its own uses "Transfer", the same label the categorizer gives a new transfer.
    const category: TransactionUpdate = rule.setCategory !== null
      ? { primaryCategory: rule.setCategory, categorySource: 'RULE' }
      : rule.setTransfer === true
        ? { primaryCategory: 'Transfer' }
        : {};

    const userOwned = matched.filter((transaction) => transaction.categorySource === 'USER');
    const recategorised = matched.filter((transaction) => transaction.categorySource !== 'USER');

    const skippedUserCategory = userOwned.filter((transaction) => {
      return category.primaryCategory !== undefined &&
        category.primaryCategory !== transaction.primaryCategory;
    }).length;

    const result = await prisma.$transaction(async (tx) => {
      let updated = 0;

      if (recategorised.length > 0) {
        const written = await tx.transaction.updateMany({
          where: { userId, id: { in: recategorised.map((transaction) => transaction.id) } },
          data: { ...actions, ...category },
        });
        updated += written.count;
      }

      if (userOwned.length > 0 && Object.keys(actions).length > 0) {
        const written = await tx.transaction.updateMany({
          where: { userId, id: { in: userOwned.map((transaction) => transaction.id) } },
          data: actions,
        });
        updated += written.count;
      }

      return updated;
    });

    return { updated: result, skippedUserCategory };
  }

  /**
   * Builds a rule from one transaction: the merchant text becomes the match, and the caller
   * supplies the category. The rule is not applied here; the page calls /apply once the user
   * confirms the dry-run count.
   */
  static async fromTransaction(
    userId: string,
    transactionId: string,
    setCategory: unknown
  ): Promise<
    | { status: 'not_found' }
    | { status: 'invalid'; error: string }
    | { status: 'created'; rule: Rule; matchCount: number }
  > {
    const transaction = await prisma.transaction.findFirst({
      where: { id: transactionId, userId },
      select: { name: true, merchantName: true },
    });

    if (!transaction) {
      return { status: 'not_found' };
    }

    // The cleaned merchant name when there is one, else the bank description; capped at the
    // length a match field allows.
    const label = transaction.merchantName?.trim() ? transaction.merchantName : transaction.name;
    const matchMerchant = label.trim().slice(0, MATCH_MERCHANT_MAX).trim();

    const validation = await validateRuleInput({ matchMerchant, setCategory, priority: 0 }, userId);
    if (!validation.ok) {
      return { status: 'invalid', error: validation.error };
    }

    const rule = await prisma.rule.create({ data: { userId, ...validation.fields } });
    const transactions = await this.matchableTransactions(userId);

    return { status: 'created', rule, matchCount: countMatches(rule, transactions) };
  }

  private static matchableTransactions(userId: string): Promise<MatchableTransaction[]> {
    return prisma.transaction.findMany({
      where: { userId },
      select: MATCHABLE_SELECT,
      orderBy: { date: 'desc' },
    });
  }
}

// --- Helpers ------------------------------------------------------------

function invalid(error: string): RuleValidation {
  return { ok: false, error };
}

function isCategory(value: unknown): value is string {
  return typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value);
}

/** A money amount of 0 or more, rounded to cents; a numeric string is accepted. */
function parseAmount(
  value: unknown,
  field: string
): { ok: true; value: number | null } | { ok: false; error: string } {
  if (value === undefined || value === null) {
    return { ok: true, value: null };
  }

  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : Number.NaN;

  if (!Number.isFinite(parsed)) {
    return { ok: false, error: `${field} must be a number` };
  }

  if (parsed < 0) {
    return { ok: false, error: `${field} must be 0 or more` };
  }

  return { ok: true, value: Math.round(parsed * 100) / 100 };
}

function parseBoolean(
  value: unknown,
  field: string
): { ok: true; value: boolean | null } | { ok: false; error: string } {
  if (value === undefined || value === null) {
    return { ok: true, value: null };
  }

  if (typeof value !== 'boolean') {
    return { ok: false, error: `${field} must be true or false` };
  }

  return { ok: true, value };
}

/**
 * `RuleLike` carries an id only because `categorize` reports which rule won; matching never reads
 * it, so a draft gets a placeholder.
 */
function asRuleLike(rule: RuleFields | RuleLike): RuleLike {
  return { ...rule, id: 'id' in rule ? rule.id : 'draft' };
}

function toCategorizeInput(transaction: MatchableTransaction): CategorizeInput {
  return {
    name: transaction.name,
    merchantName: transaction.merchantName,
    amount: transaction.amount,
    accountId: transaction.accountId,
  };
}

function toSample(transaction: MatchableTransaction): PreviewResult['sample'][number] {
  return {
    id: transaction.id,
    date: transaction.date,
    name: transaction.name,
    merchantName: transaction.merchantName,
    amount: transaction.amount,
    primaryCategory: transaction.primaryCategory,
  };
}
