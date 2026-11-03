// CSV import of card transactions into a manual account (plan Wave E, E3).
//
// The owner pays the Apple Card and Affirm from checking, but Plaid cannot see those cards, so the
// purchases are missing from the ledger. Apple Card's monthly CSV (or a generic column mapping) is
// parsed here and written as ordinary Transaction rows, with the same conventions as the sync path:
// positive amount = money out, cents-rounded amounts, dates at UTC midnight, and rows older than the
// review window arrive reviewed.
//
// Duplicates: `importHash` = sha256(accountId|date|amount|description), unique per account
// (`@@unique([accountId, importHash])`), so importing the same file twice skips every row that is
// already there. Two identical purchases in one file also collapse to one row by design.
//
// No Plaid calls, no dependencies: the CSV parser below is small and RFC-4180 shaped (quoted
// fields, doubled quotes inside quotes, CRLF or LF line endings, a BOM at the start).

import { createHash } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { CATEGORIES } from './categories';
import { categorize, type RuleLike } from './categorizer';
import type { Prisma } from '../../prisma/generated/prisma';

/** The request body is capped at 6 MB in the route, so the file itself can be 5 MB. */
export const MAX_CSV_BYTES = 5 * 1024 * 1024;
export const MAX_DATA_ROWS = 5000;
/** How many parsed rows a dry run previews. */
export const PREVIEW_SIZE = 5;
const INSERT_BATCH_SIZE = 500;
// Same window as the Plaid sync: the review queue is for what is new, not for last quarter.
const REVIEW_WINDOW_DAYS = 14;

export const IMPORT_NOTE =
  'The account balance is left alone: an import adds transactions only. ' +
  'Use "Update balance" to set what the account shows today.';

export type ImportFormat = 'apple-card' | 'generic';

export interface ImportMapping {
  date: string;
  description: string;
  amount: string;
  merchant?: string;
  category?: string;
  /** Set when the file's amounts are the other way round: positive = money in. */
  negateAmount?: boolean;
}

export interface ImportRowError {
  /** 1-based line in the CSV, so the header is line 1 and the first data row is line 2. */
  row: number;
  message: string;
}

export interface ImportPreviewRow {
  /** 1-based CSV line the row came from, so the page can point back at the file. */
  row: number;
  /** YYYY-MM-DD (UTC). */
  date: string;
  description: string;
  merchant: string | null;
  /** Positive = money out, negative = money in. */
  amount: number;
  category: string;
  isTransfer: boolean;
}

export interface ImportPreview {
  dryRun: true;
  /** Up to the first five rows that would be imported, in file order. */
  preview: ImportPreviewRow[];
  /** Rows that would be imported (valid and not already in the account). */
  total: number;
  /** Rows skipped because the account already has the same date, amount, and description. */
  duplicates: number;
  errors: ImportRowError[];
  note: string;
}

export interface ImportApplied {
  dryRun: false;
  imported: number;
  skipped: number;
  /** Card payments ("Payment" rows) among the imported ones: excluded from spending totals. */
  payments: number;
  /** YYYY-MM-DD of the earliest and latest imported row, or null when nothing was written. */
  firstDate: string | null;
  lastDate: string | null;
  errors: ImportRowError[];
  note: string;
}

export interface ImportRequest {
  userId: string;
  accountId: string;
  csv: unknown;
  format: unknown;
  mapping?: unknown;
  dryRun?: boolean;
}

export type ImportOutcome =
  | { ok: true; body: ImportPreview | ImportApplied }
  | { ok: false; status: number; error: string; errors?: ImportRowError[] };

/** One row that parsed cleanly, before categorization and the database. */
interface ParsedRow {
  row: number;
  date: Date;
  dateKey: string;
  description: string;
  merchant: string | null;
  amount: number;
  /** Category from the file (Apple's category, or a generic mapping's category column). */
  csvCategory: string | null;
  /** Apple "Payment": a card payoff, stored as a transfer. */
  isPayment: boolean;
}

interface CsvRecord {
  fields: string[];
  /** 1-based line the record starts on. */
  line: number;
}

interface ColumnIndex {
  date: number;
  description: number;
  amount: number;
  merchant: number | null;
  category: number | null;
  /** Apple only: Payment / Purchase / Credit / Refund. */
  type: number | null;
}

type ColumnLookup = { ok: true; columns: ColumnIndex } | { ok: false; error: string };
type MappingLookup = { ok: true; mapping: ImportMapping } | { ok: false; error: string };

/**
 * Apple's categories as they arrive in the CSV. Anything not listed here (and not already one of
 * our own names) falls back to the categorizer, which answers "Other" when there is no PFC.
 */
const APPLE_CATEGORY_MAP: Record<string, string> = {
  restaurants: 'Food & Dining',
  grocery: 'Groceries',
  gas: 'Transportation',
  transportation: 'Transportation',
  shopping: 'Shopping',
  entertainment: 'Entertainment',
  travel: 'Travel',
  medical: 'Healthcare',
  utilities: 'Bills & Utilities',
  hotels: 'Travel',
  airlines: 'Travel',
  alcohol: 'Food & Dining',
  insurance: 'Insurance',
  other: 'Other'
};

/** Columns Apple's export must have for the import to be safe. */
const APPLE_REQUIRED_COLUMNS = ['transaction date', 'description', 'type', 'amount (usd)'];

const APPLE_HEADER_HINT =
  '"Transaction Date,Clearing Date,Description,Merchant,Category,Type,Amount (USD)[,Purchased By]"';

export class ImportService {
  /**
   * Parse, categorize, and (unless `dryRun`) write the file's rows into one manual account.
   * Rows with a bad date or amount are reported and skipped; a file where every row is bad is a 400.
   */
  static async importCsv(request: ImportRequest): Promise<ImportOutcome> {
    const { csv } = request;

    if (typeof csv !== 'string' || csv.trim() === '') {
      return { ok: false, status: 400, error: 'csv must be a non-empty string holding the file contents' };
    }

    const bytes = Buffer.byteLength(csv, 'utf8');
    if (bytes > MAX_CSV_BYTES) {
      return {
        ok: false,
        status: 400,
        error: `CSV is too large: ${formatMegabytes(bytes)} (limit 5 MB). Split the file and import the parts.`,
      };
    }

    if (request.format !== 'apple-card' && request.format !== 'generic') {
      return { ok: false, status: 400, error: "format must be 'apple-card' or 'generic'" };
    }
    const format: ImportFormat = request.format;

    let mapping: ImportMapping | null = null;
    if (format === 'generic') {
      const parsedMapping = parseMapping(request.mapping);
      if (!parsedMapping.ok) {
        return { ok: false, status: 400, error: parsedMapping.error };
      }
      mapping = parsedMapping.mapping;
    }

    const records = parseCsv(csv);
    if (records.length === 0) {
      return { ok: false, status: 400, error: 'CSV is empty' };
    }

    // A stray blank line before the header is not the header; blank rows elsewhere are not data.
    const firstContent = records.findIndex((record) => record.fields.some((field) => field.trim() !== ''));
    if (firstContent === -1) {
      return { ok: false, status: 400, error: 'CSV is empty' };
    }

    const header = records[firstContent].fields;
    const dataRecords = records
      .slice(firstContent + 1)
      .filter((record) => record.fields.some((field) => field.trim() !== ''));

    if (dataRecords.length === 0) {
      return { ok: false, status: 400, error: 'CSV has a header but no data rows' };
    }
    if (dataRecords.length > MAX_DATA_ROWS) {
      return {
        ok: false,
        status: 400,
        error: `CSV has ${dataRecords.length.toLocaleString('en-US')} data rows (limit 5,000). Split the file and import the parts.`,
      };
    }

    const lookup = format === 'apple-card' ? appleColumns(header) : genericColumns(header, mapping!);
    if (!lookup.ok) {
      return { ok: false, status: 400, error: lookup.error };
    }

    const parsed = parseRows(dataRecords, lookup.columns, format, mapping);

    if (parsed.rows.length === 0) {
      return {
        ok: false,
        status: 400,
        error: `No row could be read: all ${parsed.errors.length} data rows have an error`,
        errors: parsed.errors,
      };
    }

    const rules: RuleLike[] = await prisma.rule.findMany({ where: { userId: request.userId } });
    const candidates = parsed.rows.map((row) => buildTransaction(row, request.userId, request.accountId, rules));

    // Two real purchases can share date, amount, and description (two coffees in one day). Number
    // repeats within the file, so both are kept while a re-import of the same file still dedupes.
    const occurrences = new Map<string, number>();
    for (const candidate of candidates) {
      const n = occurrences.get(candidate.importHash) ?? 0;
      occurrences.set(candidate.importHash, n + 1);
      if (n > 0) {
        candidate.importHash = createHash('sha256').update(`${candidate.importHash}#${n}`).digest('hex');
        candidate.data.importHash = candidate.importHash;
      }
    }

    const hashes = candidates.map((candidate) => candidate.importHash);
    const existing = await prisma.transaction.findMany({
      where: { userId: request.userId, accountId: request.accountId, importHash: { in: hashes } },
      select: { importHash: true },
    });
    const existingHashes = new Set(existing.map((row) => row.importHash));
    const seen = new Set<string>();

    // A row already imported (same file again, or an overlapping statement) is skipped.
    const toInsert = candidates.filter((candidate) => {
      if (existingHashes.has(candidate.importHash) || seen.has(candidate.importHash)) {
        return false;
      }
      seen.add(candidate.importHash);
      return true;
    });
    const duplicates = candidates.length - toInsert.length;

    if (request.dryRun === true) {
      return {
        ok: true,
        body: {
          dryRun: true,
          preview: toInsert.slice(0, PREVIEW_SIZE).map(toPreviewRow),
          total: toInsert.length,
          duplicates,
          errors: parsed.errors,
          note: IMPORT_NOTE,
        },
      };
    }

    let imported = 0;
    for (let index = 0; index < toInsert.length; index += INSERT_BATCH_SIZE) {
      const batch = toInsert.slice(index, index + INSERT_BATCH_SIZE).map((row) => row.data);
      const result = await prisma.transaction.createMany({ data: batch, skipDuplicates: true });
      imported += result.count;
    }
    // `skipDuplicates` is the backstop if two imports of the same file race; those rows are
    // duplicates too, so the caller's "imported + skipped = rows in the file" still adds up.
    const skipped = candidates.length - imported;

    const dateKeys = toInsert.map((candidate) => candidate.dateKey).sort();

    return {
      ok: true,
      body: {
        dryRun: false,
        imported,
        skipped,
        payments: toInsert.filter((candidate) => candidate.isPayment).length,
        firstDate: dateKeys[0] ?? null,
        lastDate: dateKeys[dateKeys.length - 1] ?? null,
        errors: parsed.errors,
        note: IMPORT_NOTE,
      },
    };
  }
}

// --- Rows to transactions -------------------------------------------------

/** A row ready to write, plus the fields the response needs that are not columns. */
interface Candidate {
  data: Prisma.TransactionCreateManyInput;
  importHash: string;
  dateKey: string;
  isPayment: boolean;
  /** The CSV line this row came from, so a preview can point back at the file. */
  rowNumber: number;
}

/**
 * The user's rules run first (a rule the user wrote beats a CSV category); otherwise the file's
 * category wins, and the categorizer answers "Other" when the file has none we recognize.
 */
function buildTransaction(
  row: ParsedRow,
  userId: string,
  accountId: string,
  rules: RuleLike[]
): Candidate {
  const categorized = categorize(
    {
      name: row.description,
      merchantName: row.merchant,
      amount: row.amount,
      accountId,
    },
    rules
  );

  // A rule that actually sets a category owns it, exactly as on the sync path; a rule that only
  // renames a merchant leaves the file's category alone. A transfer is never a spending category,
  // so a payment row (or a row a rule marks as a transfer) is "Transfer" unless a rule says why not.
  const ruleSetCategory = categorized.source === 'RULE';
  const isTransfer = row.isPayment || categorized.isTransfer;
  const category = ruleSetCategory
    ? categorized.category
    : isTransfer
      ? 'Transfer'
      : row.csvCategory ?? categorized.category;
  const dateKey = row.dateKey;
  const importHash = hashRow(accountId, dateKey, row.amount, row.description);

  return {
    importHash,
    dateKey,
    isPayment: row.isPayment,
    rowNumber: row.row,
    data: {
      userId,
      accountId,
      plaidTransactionId: null,
      importHash,
      name: row.description,
      merchantName: row.merchant,
      amount: row.amount,
      date: row.date,
      pending: false,
      primaryCategory: category,
      categorySource: ruleSetCategory ? 'RULE' : 'PLAID',
      isTransfer,
      hidden: categorized.hidden,
      merchantDisplay: categorized.merchantDisplay,
      reviewed: isOlderThanReviewWindow(row.date),
    },
  };
}

function toPreviewRow(row: Candidate): ImportPreviewRow {
  return {
    row: row.rowNumber,
    date: row.dateKey,
    description: row.data.name,
    merchant: row.data.merchantName ?? null,
    amount: row.data.amount,
    category: row.data.primaryCategory ?? 'Other',
    isTransfer: Boolean(row.data.isTransfer),
  };
}

/** sha256 of account + date + amount + description: the same purchase hashes the same every time. */
export function hashRow(accountId: string, dateKey: string, amount: number, description: string): string {
  return createHash('sha256')
    .update(`${accountId}|${dateKey}|${amount.toFixed(2)}|${description}`)
    .digest('hex');
}

// --- Parsing --------------------------------------------------------------

/**
 * A small RFC-4180 reader: commas separate fields, `"` quotes a field (and may hold commas,
 * newlines, and `""` for a literal quote), and both CRLF and LF end a record. A leading BOM is
 * dropped, because Excel writes one and it would otherwise hide inside the first header name.
 */
export function parseCsv(input: string): CsvRecord[] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;

  const endRecord = () => {
    fields.push(field);
    field = '';
    records.push({ fields, line: recordLine });
    fields = [];
    recordLine = line;
  };

  for (let index = 0; index < text.length; index++) {
    const char = text[index];

    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index++;
        } else {
          inQuotes = false;
        }
      } else if (char === '\r' && text[index + 1] === '\n') {
        // A CRLF inside quotes stays inside the field, as one newline.
        line++;
        field += '\n';
        index++;
      } else {
        if (char === '\n') line++;
        field += char;
      }
      continue;
    }

    // A quote only opens a quoted field at its start; one in the middle of a value is literal
    // (a description like `5" x 7"` is not a quote error).
    if (char === '"' && field === '') {
      inQuotes = true;
      continue;
    }

    if (char === ',') {
      fields.push(field);
      field = '';
      continue;
    }

    if (char === '\r' || char === '\n') {
      if (char === '\r' && text[index + 1] === '\n') index++;
      line++;
      endRecord();
      continue;
    }

    field += char;
  }

  // A file without a final newline still has a last record.
  if (field !== '' || fields.length > 0) {
    fields.push(field);
    records.push({ fields, line: recordLine });
  }

  return records;
}

function parseRows(
  records: CsvRecord[],
  columns: ColumnIndex,
  format: ImportFormat,
  mapping: ImportMapping | null
): { rows: ParsedRow[]; errors: ImportRowError[] } {
  const rows: ParsedRow[] = [];
  const errors: ImportRowError[] = [];

  for (const record of records) {
    const read = (index: number | null) => (index === null ? '' : (record.fields[index] ?? '').trim());

    const rawDate = read(columns.date);
    const rawAmount = read(columns.amount);
    const description = read(columns.description);
    const merchant = read(columns.merchant);

    const date = parseImportDate(rawDate);
    const amount = parseAmount(rawAmount);

    if (!date) {
      errors.push({
        row: record.line,
        message:
          rawDate === ''
            ? 'Date is empty'
            : format === 'apple-card'
              ? `Date "${rawDate}" is not a valid MM/DD/YYYY date`
              : `Date "${rawDate}" is not a valid YYYY-MM-DD or MM/DD/YYYY date`,
      });
      continue;
    }

    if (amount === null) {
      errors.push({
        row: record.line,
        message: rawAmount === '' ? 'Amount is empty' : `Amount "${rawAmount}" is not a number`,
      });
      continue;
    }

    if (description === '') {
      errors.push({ row: record.line, message: 'Description is empty' });
      continue;
    }

    const type = read(columns.type).toLowerCase();
    const csvCategory = read(columns.category);

    const isPayment = format === 'apple-card' && type === 'payment';
    const isCredit = format === 'apple-card' && (type === 'credit' || type === 'refund');

    // Apple already writes purchases positive and payments/credits negative; the `Type` column
    // makes the sign explicit, so it decides: Payment, Credit, and Refund are money in (negative)
    // and everything else is money out (positive), whatever the amount column's sign. A generic
    // file is taken at face value unless the mapping flips it.
    let storedAmount: number;
    if (format === 'apple-card') {
      storedAmount = isPayment || isCredit ? -Math.abs(amount) : Math.abs(amount);
    } else {
      storedAmount = mapping?.negateAmount ? -amount : amount;
    }

    rows.push({
      row: record.line,
      date,
      dateKey: formatDateOnly(date),
      description,
      merchant: merchant === '' ? null : merchant,
      amount: roundCents(storedAmount),
      csvCategory: isPayment ? 'Transfer' : categoryFromFile(csvCategory),
      isPayment,
    });
  }

  return { rows, errors };
}

/** Apple's categories first, then one of our own names written as-is, else null (categorizer decides). */
function categoryFromFile(value: string): string | null {
  const key = value.trim().toLowerCase().replace(/\s+/g, ' ');
  if (key === '') return null;

  const mapped = APPLE_CATEGORY_MAP[key];
  if (mapped) return mapped;

  const own = CATEGORIES.find((category) => category.toLowerCase() === key);
  return own ?? null;
}

/** Strict `MM/DD/YYYY` or `YYYY-MM-DD` at UTC midnight; null for anything that is not a real date. */
export function parseImportDate(value: string): Date | null {
  const trimmed = value.trim();
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (slash) {
    return utcDate(Number(slash[3]), Number(slash[1]), Number(slash[2]));
  }

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  if (iso) {
    return utcDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  return null;
}

function utcDate(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return date;
}

/**
 * `-12.34`, `12.34`, `$1,234.56`, `(12.34)` for negative, and a leading minus or trailing `-`.
 * Anything else is null, so the row is reported instead of stored as 0.
 */
export function parseAmount(value: string): number | null {
  let text = value.trim().replace(/[\s$]/g, '');
  if (text === '') return null;

  let negative = false;
  if (text.startsWith('(') && text.endsWith(')')) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (text.endsWith('-')) {
    negative = true;
    text = text.slice(0, -1);
  }
  if (text.startsWith('-')) {
    negative = true;
    text = text.slice(1);
  } else if (text.startsWith('+')) {
    text = text.slice(1);
  }

  text = text.replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(text)) return null;

  const amount = Number(text);
  if (!Number.isFinite(amount)) return null;

  return negative ? -amount : amount;
}

// --- Columns --------------------------------------------------------------

function appleColumns(header: string[]): ColumnLookup {
  const index = indexColumns(header);
  const missing = APPLE_REQUIRED_COLUMNS.filter((name) => !index.has(name));

  if (missing.length > 0) {
    return {
      ok: false,
      error: `This does not look like an Apple Card CSV. Expected the header ${APPLE_HEADER_HINT}; missing column(s): ${missing.join(', ')}`,
    };
  }

  return {
    ok: true,
    columns: {
      date: index.get('transaction date')!,
      description: index.get('description')!,
      amount: index.get('amount (usd)')!,
      merchant: index.get('merchant') ?? null,
      category: index.get('category') ?? null,
      type: index.get('type')!,
    },
  };
}

function genericColumns(header: string[], mapping: ImportMapping): ColumnLookup {
  const index = indexColumns(header);
  const errors: string[] = [];

  const column = (field: 'date' | 'description' | 'amount' | 'merchant' | 'category', required: boolean) => {
    const name = mapping[field];
    if (name === undefined) return null;

    const found = index.get(normalizeHeader(name));
    if (found === undefined) {
      if (required) errors.push(`mapping.${field} names the column "${name}", which is not in the header`);
      return null;
    }
    return found;
  };

  const date = column('date', true);
  const description = column('description', true);
  const amount = column('amount', true);
  const merchant = column('merchant', false);
  const category = column('category', false);

  if (errors.length > 0) {
    return {
      ok: false,
      error: `${errors.join('; ')}. The header is: ${header.map((name) => name.trim()).join(', ')}`,
    };
  }

  return {
    ok: true,
    columns: {
      date: date!,
      description: description!,
      amount: amount!,
      merchant,
      category,
      type: null,
    },
  };
}

function indexColumns(header: string[]): Map<string, number> {
  const index = new Map<string, number>();
  header.forEach((name, position) => {
    const key = normalizeHeader(name);
    if (key !== '' && !index.has(key)) {
      index.set(key, position);
    }
  });
  return index;
}

function normalizeHeader(value: string): string {
  return value.replace(/\u00a0/g, ' ').trim().toLowerCase().replace(/\s+/g, ' ');
}

function parseMapping(value: unknown): MappingLookup {
  if (value === undefined || value === null) {
    return { ok: false, error: 'mapping is required for format "generic"' };
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'mapping must be an object naming the date, description, and amount columns' };
  }

  const source = value as Record<string, unknown>;
  const required: Array<'date' | 'description' | 'amount'> = ['date', 'description', 'amount'];

  for (const field of required) {
    const column = source[field];
    if (typeof column !== 'string' || column.trim() === '') {
      return { ok: false, error: `mapping.${field} must be the name of a column in the CSV` };
    }
  }

  for (const field of ['merchant', 'category'] as const) {
    const column = source[field];
    if (column !== undefined && column !== null && typeof column !== 'string') {
      return { ok: false, error: `mapping.${field} must be a column name` };
    }
  }

  if (source.negateAmount !== undefined && typeof source.negateAmount !== 'boolean') {
    return { ok: false, error: 'mapping.negateAmount must be true or false' };
  }

  return {
    ok: true,
    mapping: {
      date: (source.date as string).trim(),
      description: (source.description as string).trim(),
      amount: (source.amount as string).trim(),
      merchant: typeof source.merchant === 'string' && source.merchant.trim() !== '' ? source.merchant.trim() : undefined,
      category: typeof source.category === 'string' && source.category.trim() !== '' ? source.category.trim() : undefined,
      negateAmount: source.negateAmount === true,
    },
  };
}

// --- Small helpers --------------------------------------------------------

function roundCents(amount: number): number {
  return Math.round(amount * 100) / 100;
}

function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startOfUtcDay(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function isOlderThanReviewWindow(date: Date, now: Date = new Date()): boolean {
  return date.getTime() < startOfUtcDay(now).getTime() - REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
