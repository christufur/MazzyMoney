# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Responsive web app, used on phone and desktop equally (confirmed). Reached only over the household's Tailscale network; later installable as a PWA.

## Users

- **Primary:** the owner, a software developer who runs the app on a homelab. Checks money on the phone during the day and does longer sessions on desktop.
- **Later:** up to 4 adults in the same household. Each has a separate login and separate data. They are not finance experts.

## Product Purpose

A self-hosted personal finance app that replaces Monarch Money (about $100 per year) at $0 cost. It connects bank accounts through Plaid, keeps transactions in a local Postgres database, and answers: where did the money go, am I inside my budgets, what charges repeat, and what is my net worth over time.

Success: the owner stops paying for Monarch and uses this every day instead.

## Positioning

Monarch-level daily finance, but owned: the data lives on the household's own server, nothing is sold or shared, and it costs nothing to run (Plaid Trial plan, 10 bank connections for the whole server).

## Operating Context

- Daily loop (the core habit): sync, then review new transactions, then budgets are correct, then glance at net worth.
- Weekly or monthly: adjust budgets, check recurring charges, update manual account balances (401(k), car, house).
- Bank connections are scarce: 10 Plaid Items for the whole server. The UI must make the count visible and never spend a connection by accident.
- Data arrives from Plaid with its own category taxonomy (personal_finance_category), mapped to one display list in `backend/src/services/categories.ts`.

## Capabilities and Constraints

Built or in progress on branch `rebuild`:
- Multi-bank Plaid sync (cursor-based), pending to posted, removed transactions.
- Transactions list with review queue, bulk edits, notes, category changes. Transfers and hidden rows are excluded from all totals.
- Rules (merchant, amount, account conditions; set category, rename, transfer, hide).
- Monthly budgets that repeat, optional rollover, 6-month history, alerts.
- Recurring charge detection with monthly total and next-30-days list.
- Net worth history from daily balance snapshots; manual accounts; liabilities count negative.
- Connections page with "Banks used: N / 10", reconnect via Plaid update mode, remove.

Stack: React 19 + Vite + TypeScript + Tailwind, Recharts, Express 5 + Prisma + Postgres, Bun. Docker on Ubuntu/CasaOS.

Not in scope: investment holdings and performance, AI assistant, Zillow/crypto sync (all cost money or add little).

Undecided: the product name. "Mazzy Money" is the working name; a new name comes later. Design must not depend on the name.

## Brand Commitments

- Feel (confirmed by owner): like Monarch Money — very clean, encouraging but calm. Trustworthy and quiet around numbers; encouraging about progress without hype or game mechanics.
- Anti-reference (owner's words): the current UI looks like the "vibe-coded" frontends of its time (gradient hero cards, emoji icons, generic Tailwind cards). The redesign must leave that look behind.
- No logo or brand assets exist yet.

## Evidence on Hand

- Real data: the owner's own bank (FirstLight Federal Credit Union), via Plaid production. Plaid sandbox data for testing.
- No testimonials, customers, or marketing claims exist; none may be invented.

## Product Principles

1. Numbers must be right before they are pretty. Never show a total that counts a transfer or a hidden row.
2. The daily loop is short: open, review, done. Every screen serves that loop or gets out of the way.
3. Calm by default, encouraging on progress. Overspending is stated plainly, never shamed.
4. Scarce resources are visible: bank connections, and money that repeats.
5. Phone and desktop are both first-class.

## Accessibility & Inclusion

Household members of mixed familiarity with finance: plain labels, no jargon without explanation. WCAG AA contrast; color is never the only signal for money in vs out.
