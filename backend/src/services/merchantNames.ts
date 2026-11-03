// Readable merchant names when the bank sends a raw memo (plan Wave E, E4).
//
// FirstLight (through Plaid) often sends no `merchant_name`, so a row reads like a paragraph:
// the channel word, the merchant, a street address, the city and state, the date, and two
// reference numbers — "Withdrawal / DAVES HOT CHICKEN 1225 EL PASO TX Date 10/31/26 0000000630…".
// `cleanMerchantName` turns that into "Daves Hot Chicken".
//
// The function is pure: same input, same output, no database, no clock. Each step below is a
// small, separate string step so the behaviour is visible in the test table instead of hiding
// inside one giant regular expression.
//
// This only ever fills `Transaction.merchantDisplay` for a row Plaid sent without a
// `merchant_name` and no rule renamed. A rule's `setMerchant` and the user always win.

/** Channel words the bank puts in front of the actual merchant, longest first. */
const PREFIX_WORDS = [
  'debit card purchase',
  'pos purchase',
  'checkcard',
  'withdrawal',
  'deposit',
  'purchase',
  'recurring',
  'debit',
  'pos',
  'ach',
];

/**
 * Where a memo stops being a merchant name: a bank field or a reference number follows.
 * Everything from the earliest hit to the end of the string is dropped.
 */
const CUT_MARKERS: RegExp[] = [
  /(?:^|\s)date\b/i,
  /\sref\d*\s*:/i,
  /(?:^|\s)id\s*:/i,
  /(?:^|\s)co\s*:/i,
  /(?:^|\s)type\s*:/i,
  /\bexpires?\b/i,
  /\bexp\s*:/i,
  // An ACH payment-type code the bank prints before the reference: "… PPD ID: 1234".
  /\sppd\b/i,
  // "Card 1234", "Card No. 1234", "Card #1234", "Card Ending 1234".
  /\scard\s*(?:no\.?|number|#|ending\s+in|ending)?\s*\d/i,
  // A store number: "MAVERIK #752".
  /#\s*\d/,
];

/** Trailing street numbers ("… EL PASO TX" leaves "1225"), never a name. */
const TRAILING_NUMBER = /^\d{1,5}$/;

/** Two-letter state (and territory) codes a bank appends after the city. */
const STATE_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN',
  'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH',
  'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT',
  'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'PR', 'VI', 'GU',
]);

/** A month word or abbreviation on its own is a date: "31 OCT 26", "31 OCT". */
const MONTH_TOKEN =
  /^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?$/i;

/**
 * First words of the two-word cities the household actually sees ("EL PASO", "LAS CRUCES",
 * "MOUNTAIN VIEW"). Without this list a city like "EL PASO" would leave "EL" behind, and a
 * merchant like "PIZZA HUT" would lose "HUT" to a greedy two-word guess.
 */
const CITY_FIRST_WORDS = new Set([
  'EL', 'LA', 'LAS', 'LOS', 'DEL', 'DES', 'SAN', 'SANTA', 'SANTO', 'NEW', 'SALT', 'FORT',
  'FT', 'MOUNT', 'MT', 'MOUNTAIN', 'GRAND', 'RIO', 'SIERRA', 'PORT', 'NORTH', 'SOUTH', 'EAST',
  'WEST', 'ST', 'SAINT', 'PALO', 'PALM', 'CORPUS', 'LONG', 'BAY', 'SUN', 'TWIN', 'ROUND',
  'UNION', 'CEDAR', 'MESILLA', 'ALTO', 'ALAMO',
]);

/** Lowercase words inside a name unless they start it ("City of El Paso Utility"). */
const MINOR_WORDS = new Set([
  'a', 'an', 'and', 'at', 'by', 'de', 'for', 'in', 'of', 'on', 'the', 'to',
]);

/**
 * Short brand acronyms that stay in capitals ("AWS", "GNC"). Length alone cannot decide:
 * "HOT" in "DAVES HOT CHICKEN" is a word, "CVS" is a brand. So a token of three letters or
 * fewer keeps its capitals when it is on this list or has no vowel at all.
 */
const ACRONYMS = new Set([
  'AWS', 'GNC', 'CVS', 'AT&T', 'USA', 'USPS', 'UPS', 'KFC', 'BMW', 'HEB', 'ASU', 'NMSU',
  'IBM', 'AMD', 'DHL', 'HBO', 'NPR', 'YMCA', 'PBS', 'DPS', 'EPCC', 'UTEP', 'ATM', 'WMT',
]);
const VOWELS = /[AEIOU]/i;

/** Company suffixes dropped from an ACH "CO:" name: "NTESS, LLC" -> "NTESS". */
const LEGAL_SUFFIX =
  /[\s,.]*\b(?:L\.?L\.?C\.?|INC\.?|INCORPORATED|CORP\.?|CORPORATION|CO\.?|COMPANY|LTD\.?|LIMITED|L\.?L\.?P\.?|L\.?P\.?|P\.?C\.?|PLLC|N\.?A\.?)$/i;

/** `Transfer To Share 0070 …` is money between the household's own accounts. */
const SHARE_TRANSFER = /\btransfer\s+(to|from)\s+(?:share|savings)\b/i;

/**
 * The name to show for a bank memo.
 *
 * Never returns an empty string: when every step strips the whole memo, the trimmed raw text
 * comes back, because a raw memo still beats a blank row.
 */
export function cleanMerchantName(raw: string): string {
  const original = String(raw ?? '').trim();
  if (!original) {
    return '';
  }

  // A move between the household's own accounts is not a merchant at all.
  const transfer = SHARE_TRANSFER.exec(original);
  if (transfer) {
    return transfer[1].toLowerCase() === 'to' ? 'Transfer to savings' : 'Transfer from savings';
  }

  // A bank ACH line names the counterparty in its own field ("TYPE: PAYROLL … CO: NTESS, LLC").
  const counterparty = coName(original);
  if (counterparty) {
    return counterparty;
  }

  let text = dropPrefixes(original);
  // "Home Banking" says which screen the entry came from, not who was paid.
  text = text.replace(/\bhome\s+banking\b/gi, ' ');
  text = stripDates(text);
  text = cutAtBankFields(text);
  text = dropTrailingPlace(text);
  text = dropTrailingNumber(text);
  text = text.replace(/^[\s/|:,.+-]+/, '').replace(/[\s/|:,-]+$/, '');
  text = collapseSpaces(text);

  const cleaned = titleCase(text);
  return cleaned || original;
}

/**
 * Drop leading channel words ("POS PURCHASE", "Withdrawal /", "ACH"), repeatedly: a memo can
 * start with two of them. Only a whole word counts, so "POSTMATES" keeps its P. The steps run
 * in the order a memo reads: channel word, terminal id, merchant, then bank fields.
 */
function dropPrefixes(input: string): string {
  let text = input;

  for (;;) {
    const lower = text.toLowerCase();
    const prefix = PREFIX_WORDS.find(word => {
      if (!lower.startsWith(word)) return false;
      const next = text.charAt(word.length);
      return next === '' || /[\s/:,.-]/.test(next);
    });

    if (!prefix) {
      break;
    }

    text = text.slice(prefix.length).replace(/^[\s/:,.-]+/, '');
  }

  // A terminal id sits between the channel word and the merchant ("CHECKCARD 1031 SQ *…").
  // Only 3+ digits: a leading "7" is far more likely the start of "7 ELEVEN".
  return text.replace(/^\d{3,8}\s+/, '');
}

/** Remove date tokens anywhere: "07/12", "10/31/26", "2026-10-31", "31 OCT 26". */
function stripDates(input: string): string {
  return input
    .split(/\s+/)
    .filter(token => !/^\d{1,4}[/-]\d{1,2}([/-]\d{2,4})?$/.test(token))
    .filter(token => !MONTH_TOKEN.test(token))
    .join(' ');
}

/** Cut the memo at the first bank field or reference number. */
function cutAtBankFields(input: string): string {
  let cut = input.length;

  for (const marker of CUT_MARKERS) {
    const match = marker.exec(input);
    if (match && match.index < cut) {
      cut = match.index;
    }
  }

  // A token holding six or more digits is a card, trace, or reference number, however it is
  // punctuated: "0000000630494414", "630615041023", "866-579-7172".
  for (const match of input.matchAll(/\S+/g)) {
    const digits = (match[0].match(/\d/g) ?? []).length;
    if (digits >= 6) {
      cut = Math.min(cut, match.index ?? input.length);
      break;
    }
  }

  return input.slice(0, cut);
}

/**
 * Drop a trailing city and state ("EL PASO TX", "LAS CRUCES NM"): the state goes, then the city
 * word, then a recognised first word of a two-word city. The merchant name itself always stays.
 */
function dropTrailingPlace(input: string): string {
  const tokens = input.replace(/,/g, ' ').split(/\s+/).filter(Boolean);
  const last = tokens[tokens.length - 1];

  if (!last || !STATE_CODES.has(last.toUpperCase())) {
    return tokens.join(' ');
  }

  tokens.pop();

  // The street number came with no city ("… 1INFINITELOOP CA"): drop the address and stop,
  // because the word before it is the merchant's last word, not a city.
  const afterState = tokens[tokens.length - 1];
  if (tokens.length >= 2 && afterState && /^\d/.test(afterState)) {
    tokens.pop();
    return tokens.join(' ');
  }

  const isWord = (token: string | undefined): token is string =>
    typeof token === 'string' && /\p{L}/u.test(token) && /^[A-Za-z0-9][A-Za-z0-9'’.-]*$/.test(token);

  for (let taken = 0; taken < 2; taken++) {
    const index = tokens.length - 1;
    // Never drop the whole name: one token has to survive.
    if (index < 1 || !isWord(tokens[index])) break;

    // The second word of a two-word city is only safe when the first word is a known one
    // ("EL PASO", "LAS CRUCES"); otherwise "PIZZA HUT" would lose "HUT".
    if (taken === 1 && !CITY_FIRST_WORDS.has(tokens[index].toUpperCase())) break;

    tokens.pop();
  }

  return tokens.join(' ');
}

/** "CHIPOTLE 1234" is a street number, not part of the name. */
function dropTrailingNumber(input: string): string {
  const tokens = input.split(/\s+/).filter(Boolean);

  if (tokens.length >= 2 && TRAILING_NUMBER.test(tokens[tokens.length - 1])) {
    tokens.pop();
  }

  return tokens.join(' ');
}

function collapseSpaces(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

/**
 * A bank ACH line carries the counterparty in its own "CO:" field, and that field is the only
 * readable part of the memo.
 */
function coName(input: string): string | null {
  if (!/\bco\s*:/i.test(input) || !/\btype\s*:/i.test(input)) {
    return null;
  }

  const match = /\bco\s*:\s*(.+)$/is.exec(input);
  if (!match) {
    return null;
  }

  const name = cutAtBankFields(match[1]).replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  const withoutSuffix = stripLegalSuffix(name);
  if (!withoutSuffix) return null;

  // A one-word counterparty keeps its capitals ("NTESS" is the name). A multi-word all-caps
  // one reads better as words ("CITY OF EL PASO" -> "City of El Paso").
  return withoutSuffix.includes(' ') ? titleCase(withoutSuffix) : withoutSuffix;
}

/** "NTESS, LLC" -> "NTESS": the legal form is not part of the name a person says. */
function stripLegalSuffix(name: string): string {
  let text = name.trim();

  for (;;) {
    const stripped = text.replace(LEGAL_SUFFIX, '').trim();
    if (stripped === text || stripped === '') {
      return text.replace(/[\s,.]+$/, '');
    }
    text = stripped;
  }
}

/**
 * Title-case words the bank sent in ALL CAPS, and leave everything else alone: a name the
 * source already cased ("Blue Bottle Coffee") and a reference-looking token ("R099") stay as
 * they are. Short brand acronyms (AWS, GNC, AT&T) keep their capitals.
 */
function titleCase(input: string): string {
  return input
    .split(' ')
    .map((token, index) => {
      const parts = /^([^A-Za-z0-9]*)(.*?)([^A-Za-z0-9]*)$/.exec(token);
      if (!parts) return token;

      const [, lead, core, trail] = parts;
      const letters = core.replace(/[^A-Za-z]/g, '');

      if (!letters) return token;
      // Mixed case came from the source and is already readable.
      if (/[a-z]/.test(core)) return token;
      // Digits make a token an address or reference: "R099", "1INFINITELOOP".
      if (/\d/.test(core)) return token;

      const lower = core.toLowerCase();
      if (MINOR_WORDS.has(lower) && index > 0) {
        return `${lead}${lower}${trail}`;
      }

      if (letters.length <= 3) {
        return ACRONYMS.has(core.toUpperCase()) || !VOWELS.test(core) ? token : toTitle(core, lead, trail);
      }

      return toTitle(core, lead, trail);
    })
    .join(' ');
}

/** "CHICKEN" -> "Chicken", keeping any punctuation the token arrived with. */
function toTitle(core: string, lead: string, trail: string): string {
  const lower = core.toLowerCase();
  return `${lead}${lower.charAt(0).toUpperCase()}${lower.slice(1)}${trail}`;
}
