import { describe, it, expect } from 'bun:test';

import { cleanMerchantName } from '../../services/merchantNames';

// E4: what a FirstLight memo reads like on the left, what the household should see on the right.
// The left column is copied from real Plaid rows for this bank, so a regression shows up as a
// concrete wrong name instead of a vague shape change.
const TABLE: Array<[string, string]> = [
  // The raw memos from the brief.
  [
    'Withdrawal / APPLE CASH SENT MONEY 1INFINITELOOP CA Date 10/31/26 0000000630',
    'Apple Cash Sent Money',
  ],
  [
    'MAVERIK #752 / Ref1: 5541082144 Ref2: 1102092144 Ref3: 630615041023 15 Expires: 202',
    'Maverik',
  ],
  [
    'Withdrawal / DAVES HOT CHICKEN 1225 EL PASO TX Date 10/31/26 000000063049441404',
    'Daves Hot Chicken',
  ],
  ['Deposit NTESS, LLC / TYPE: PAYROLL ID: A850097942 CO: NTESS, LLC', 'NTESS'],
  ['Withdrawal Home Banking / Transfer To Share 0070 Internet Access 10/1', 'Transfer to savings'],
  // Channel words, one and two at a time.
  ['POS PURCHASE STARBUCKS 4412', 'Starbucks'],
  ['PURCHASE WHOLEFDS MKT 10453', 'Wholefds MKT'],
  ['DEBIT CARD PURCHASE NETFLIX.COM', 'Netflix.com'],
  ['RECURRING Spotify USA', 'Spotify USA'],
  // Street address, city, and state at the end.
  ['TARGET 00012345 LAS CRUCES NM', 'Target'],
  ['ALBERTSONS 1023 EL PASO TX', 'Albertsons'],
  ['PIZZA HUT 1234 SAN ANTONIO TX', 'Pizza Hut'],
  // A reference number with no separators.
  ['CHECKCARD 1031 SQ *BLUE BOTTLE COFFEE 00000006304944', 'SQ *Blue Bottle Coffee'],  ['WALMART SUPERCENTER 630615041023', 'Walmart Supercenter'],
  // A card number and an expiry marker.
  ['SPEEDWAY 0412 Card 4471 Expires 09/28', 'Speedway'],
  // Brand acronyms stay in capitals; ordinary words do not.
  ['AWS AMAZON WEB SERVICES', 'AWS Amazon Web Services'],
  ['GNC 0456', 'GNC'],
  // Real FirstLight memos found on the first backfill.
  ['Deposit NTESS, LLC / TYPE: PAYROLL ID: A850097942 CO: NTESS, LLC %% ACH ECC CCD %% ACH Trace 0000', 'NTESS'],
  ['Deposit Home Banking Transfer / From Share 0001 Internet Access 09:37', 'Transfer from savings'],
  ['Deposit Dividend 0.150% / %% APY Earned 0.15% 07/01/26 to 09/30/26 %% APYE Avg Daily Bal 911.40', 'Dividend'],
  ['Withdrawal / CASH APP*SHOKHINA JALI Oakland CA Date 10/15/26 0000006304', 'Cash App*Shokhina Jali'],
  ['Withdrawal / 365 VEND 4 TROY MI Date 10/14/26 1 6287581310 0', '365 Vend'],
  ['Deposit NEW MEXICO STATE / TYPE: INVOICE ID: 9856000401 CO: NEW MEXICO STATE %% ACH ECC', 'New Mexico State'],
  // A source name that is already readable must come through untouched.
  ['Blue Bottle Coffee', 'Blue Bottle Coffee'],
  ['Transfer from savings', 'Transfer from savings'],
  // The one-time savings transfer the other way.
  ['Withdrawal / Transfer From Share 0070 Internet Access 10/1', 'Transfer from savings'],
  ['Withdrawal Home Banking / Internet Access 04/22/2026 11:55 828597 Zelle RUPAK DEY Ref:611200F072GM', 'Zelle Rupak Dey'],
  ['Withdrawal at ATM FIRSTLIGHT / 2001 E LOHMAN LAS CRUCES NM %% Card 25 #1924 #000000005893', 'ATM withdrawal'],
  ['Withdrawal Cash / 3105 Del Rey,Las Cruces NM. Card 1924', 'ATM withdrawal'],
  ['NON FL ATM FEE / Canna Co 3510 NORTHRISE DR STE Las Cruces NM %% Card 25 #1924', 'ATM fee'],
  ['Deposit by Check / 3105 Del Rey Blvd, Las Cruces, NM. Card 1924', 'Check deposit'],
  ['Debit Card Fee / VISA INTERNATIONAL SERVICE ASSESSMENT Date 09/03/26 %% Card 25 #1924', 'Card fee'],
  ['COMMENT / INQ FIRSTLIGHT 3105 DEL REY BLVD', 'Balance inquiry'],
  // Nothing to clean: the raw text comes back rather than an empty row.
  ['Withdrawal', 'Withdrawal'],
];

describe('cleanMerchantName', () => {
  for (const [raw, expected] of TABLE) {
    it(`turns ${JSON.stringify(raw)} into ${JSON.stringify(expected)}`, () => {
      expect(cleanMerchantName(raw)).toBe(expected);
    });
  }

  it('keeps more than fifteen real-looking rows in the table', () => {
    expect(TABLE.length).toBeGreaterThanOrEqual(15);
  });

  it('never returns an empty string, falling back to the trimmed memo', () => {
    for (const raw of ['/', '/ /', 'Date 10/31/26', '0000000630', 'Withdrawal']) {
      expect(cleanMerchantName(raw)).not.toBe('');
    }
  });

  it('is pure: the same memo always gives the same name', () => {
    const raw = 'Withdrawal / DAVES HOT CHICKEN 1225 EL PASO TX Date 10/31/26 000000063049441404';
    expect(cleanMerchantName(raw)).toBe(cleanMerchantName(raw));
  });

  it('does not treat a merchant that starts like a channel word as one', () => {
    expect(cleanMerchantName('POSTMATES 1234')).toBe('Postmates');
    expect(cleanMerchantName('ACHIEVE FITNESS')).toBe('Achieve Fitness');
  });
});
