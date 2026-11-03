# Mazzy Money: Project Overview and Review

Review date: 2026-11-02. Reviewed: `main` at `ea4d333`, the local branch `feature/ui-ux-overhaul` (`90ac441`), and the working copy of `frontend/`.

## 1. What this project is

Mazzy Money is a personal finance web app. It connects to your bank through **Plaid**. It copies your accounts and transactions into a local **PostgreSQL** database. Then it shows balances, spending by category, budgets, and charts.

| Part | Stack | Location |
|---|---|---|
| Backend API | Node, Express 5, TypeScript, Prisma 6, `node-cron` | `backend/` |
| Database | PostgreSQL (`mazzy_money`) | local, port 5432 |
| Frontend | React 19, Create React App, Tailwind 3, Recharts, d3 | `frontend/` |
| Bank data | Plaid (`PLAID_ENV=production`, real bank) | `backend/src/routes/plaid.ts` |

## 2. How it works

1. You register and log in. The backend gives you a JWT. The frontend keeps it in `localStorage`.
2. You click "Connect Bank". Plaid Link opens. The backend exchanges the public token and stores the Plaid **access token** on your `User` row.
3. A sync starts. `TransactionSyncService` gets accounts and up to 500 transactions from Plaid. It puts a category on each transaction. It writes them to Postgres.
4. A cron job syncs again every hour, and at 9, 13, 17, and 21 o'clock.
5. The pages read the cached data from `/api/transactions`, `/api/accounts`, `/api/budgets`, and `/api/analytics`.

### Data model (`backend/prisma/schema.prisma`)

- `User`: login data, plus **one** Plaid connection (token, item, institution, sync status).
- `Account`: bank account, cached balances.
- `Transaction`: amount (Plaid sign: positive = money out), date, category, notes, pending flag.
- `Budget`: category, amount, period, start and end date.
- `SavingsGoal`: has a table and a service, but no routes and no UI.
- `UserCategoryRule`: has a table, but nothing writes to it or reads from it.

### Pages (what the router in `frontend/src/App.tsx` exposes)

| Page | State |
|---|---|
| Overview | Works. Net worth sums all balances, so credit card debt counts as a positive amount. |
| Transactions | **Broken.** See finding H5. |
| Budgets | Works for the first period only. The alert UI calls endpoints that exist only on the unpushed branch. |
| Insights | Charts work. The "Smart Insights" API always returns an empty list (finding H3). |

`Dashboard.tsx`, `Reports.tsx`, `Analytics.tsx`, `Accounts.tsx`, `BankConnectionManager.tsx`, `TransactionsList.tsx`, and `services/categoryService.ts` are not routed or imported. They are dead code. Because `Accounts.tsx` is not routed, **the UI has no way to disconnect a bank**.

## 3. Findings

Each finding has a location and its effect. Severity is for personal use on a private network.

### Critical: you can lose work or data

- **C1. The frontend is not in git.** The root repo stores `frontend` as a submodule pointer (`160000 commit 5948601`). There is no `.gitmodules` file, and that commit does not exist. GitHub has none of the frontend code. The only copy is on this laptop.
- **C2. The budget alert work is only on a local branch.** `feature/ui-ux-overhaul` (alerts, email service, jest config, more tests) was never pushed. The current frontend calls `/api/budgets/:id/alerts`, but `main` does not have that route.
- **C3. The backend tests delete all users.** `src/__tests__/routes/auth.test.ts:7` runs `prisma.user.deleteMany({})` on the database in `.env`. That database holds your real data. The delete cascades to all accounts and transactions. Do not run the tests until they use a separate database.

### High: wrong numbers or security holes

- **H1. Login sends the Plaid access token to the browser.** `authService.ts:32` and `authService.ts:73` remove only `passwordHash` from the user object. `plaidAccessToken` goes to the frontend, and `AuthContext.tsx:60` writes it to `localStorage`.
- **H2. JWTs never expire.** `jwtService.ts:21` does not pass `expiresIn`, so `JWT_EXPIRES_IN` has no effect.
- **H3. "Insights" are always empty.** `analyticsService.ts:50-55` sets "this month" to *now* and adds one month. So it looks at future transactions only.
- **H4. A category correction can crash every later sync.** `smartCategorizationService.ts:205` makes `new RegExp(pattern)` from words of transaction names. A name like `SQ *BLUE BOTTLE` gives the word `*blue`, which is not a valid regex (verified: "Nothing to repeat"). After you correct such a transaction, sync and suggestions fail until the server restarts.
- **H5. The Transactions page uses the wrong data source.** `Transactions.tsx:61` calls the legacy `/api/plaid/transactions`. That endpoint calls Plaid live: max 250 transactions, from 2023-01-01, with no saved categories or notes. The page then sends Plaid's `transaction_id` to `PUT /api/transactions/:id/notes` and `/:id/category`. Those endpoints expect the database `id`, so every notes edit and category edit on this page returns 404. Bulk category change only changes React state (`Transactions.tsx:169`).
- **H6. Totals include transfers and card payments.** Income is "amount < 0" and expense is "amount > 0". A transfer to savings counts as an expense. A credit card payment counts twice: once as the purchases and once as the payment. Savings rate, cash flow, and budgets are wrong for this reason.
- **H7. Sync gets only part of the data.** `transactionSyncService.ts:349-357` asks for 500 transactions with no pagination. The first sync gets one year, so most of that year is lost. Pending transactions that post later get a new Plaid ID, so they become duplicates. Removed transactions are never deleted.
- **H8. A sync re-applies the auto category over your manual one.** `transactionSyncService.ts:426` writes `primaryCategory` on every update. All transactions from the last 24 hours before the previous sync are updated again. The two `/debug/*recategorize` endpoints change all transactions.
- **H9. Sync can stay locked forever.** If the process stops during a sync, `syncStatus` stays `SYNCING`. The cron jobs skip `SYNCING` users (`index.ts:94`), and `/sync` returns 409. Nothing resets the status.
- **H10. The app cannot see when the bank needs a new login.** `transactionSyncService.ts:257` looks for `INVALID_ACCESS_TOKEN` in `error.message`. `plaid.ts:235` reads `error.error_code`. Plaid errors are axios errors, so the code is at `error.response.data.error_code`. Also, the code that requires a new login is usually `ITEM_LOGIN_REQUIRED`. Result: the status shows "ERROR", and the app never asks you to log in to the bank again.
- **H11. The admin endpoint has no protection if `ADMIN_API_KEY` is not set.** `index.ts:168`: `undefined !== undefined` is false, so any caller passes. (Your `.env` sets it, so locally you are safe.)

### Medium

- **M1. One bank only.** The Plaid connection fields are on `User` (`schema.prisma:20`). A second "Connect Bank" overwrites the first token. The old Plaid Item is not removed, so Plaid can still bill you for it.
- **M2. Budgets do not repeat.** A monthly budget ends on its `endDate`. After that, `budgetSyncService.ts:40` returns "spent 0" forever. There is no rollover and no history.
- **M3. Timezone errors.** Plaid dates are stored as UTC midnight. On a server in a US timezone, `monthly-trends` shows the previous month (verified: Sep 1 shows as "Aug 2025"), and day-of-week is off by one day. In Docker the timezone is UTC by default, so this goes away.
- **M4. Money is stored as `Float`.** Rounding errors add up in sums. Use `Decimal` or integer cents.
- **M5. The category logic exists in 5 copies.** `EnhancedCategoryService`, `SmartCategorizationService`, `PlaidCategoryService`, two inline copies in `routes/transactions.ts`, plus `frontend/src/services/categoryService.ts`. The copies give different results. Keyword rules match parts of words: `gas` matches "Las Ve**gas**", `att` matches "Se**att**le", `rent` matches "cur**rent**". Learned rules are in memory only, and all users share them.
- **M6. The Plaid `category` field is deprecated.** The code uses `category`. The new field is `personal_finance_category`. It is more accurate, and it marks transfers and loan payments, which fixes much of H6.
- **M7. The Budgets category list is always the default list.** `Budgets.tsx:121` reads `response.categories`, but that endpoint returns an array.
- **M8. Plaid Link asks for the `Auth` product** (`plaid.ts:34`). The app does not use it. It can cost money and reduce the number of banks you can connect.
- **M9. Unused debug endpoints.** `routes/transactions.ts` has 5 debug endpoints in about 700 lines. One of them (`/debug/categories`) is defined twice.

### Low and repo hygiene

- Root `node_modules/` (12,404 files) is in git. `backend/prisma/generated/` is in git, with a macOS-only engine binary that will not run on Ubuntu.
- `backend/src/database.ts` (raw `pg` pool), `testdb.ts`, `backend/test-prisma.ts`, and `backend/checkdatabase.ts` (contains your Plaid item ID) are leftovers. The `utils/`, `types/`, and `middleware/validation.ts` files are empty.
- The root `package.json` repeats backend and frontend dependencies.
- `frontend/build/` is an old build.
- Create React App is end-of-life. TypeScript 4.9 cannot read the current d3 types (the app code itself type-checks clean).
- The UI has placeholder buttons that do nothing: "Add Transaction", "Quick Add", "Filters", "View All Accounts", and the user card ("User / Free Plan").
- No rate limit on login. Registration is open to anyone who can reach the server.

### What is good

- The layers are clear: routes, services, Prisma. The backend type-checks with zero errors.
- Prisma migrations are in order. The indexes on `(userId, date)` fit the queries.
- The data is cached locally, so the pages do not call Plaid on each load (except the Transactions page).
- Most routes check that a record belongs to the user (`findFirst({ id, userId })`).
- The UI is consistent and complete enough to use every day after the fixes.

## 4. Gaps for the homelab (Ubuntu + CasaOS + Tailscale)

| Gap | Fix |
|---|---|
| No Dockerfile or compose file | Write one Dockerfile and one `docker-compose.yml` (app + `postgres:16`). CasaOS can import a compose file. |
| The frontend runs only from the CRA dev server | Build static files. Let Express serve them. Then one container and one port, and no CORS. |
| CORS allows only `localhost:3000` (`index.ts:24`) | Not needed if the backend serves the frontend from the same origin. |
| The API URL is fixed at build time (`REACT_APP_API_URL`) | Use relative `/api` paths. |
| The Prisma engine is built for macOS | Run `prisma generate` inside the Docker build. Stop committing `generated/`. |
| No HTTPS | `tailscale serve` gives `https://<host>.<tailnet>.ts.net`. Plaid OAuth banks (Chase and others) need an HTTPS redirect URI. This gives you one. |
| No backups | Run a nightly `pg_dump` to a mounted folder. |
| Secrets are in a `.env` file | Keep a `.env` next to the compose file, with `chmod 600`. Do not commit it. |

Recommendation: do **not** expose the app to the public internet. Reach it only through the tailnet. This also removes the need for Plaid webhooks, because cron polling is sufficient.

## 5. Draft plan

The order is: protect the work first, then make the numbers correct, then deploy, then add features. Each phase ends with something you can use.

### Phase 0: Protect the work (about 1 hour)
1. Remove the broken `frontend` submodule pointer. Add the frontend as normal files.
2. Merge or rebase `feature/ui-ux-overhaul` into `main`. Push.
3. Stop tracking `node_modules/`, `frontend/build/`, and `backend/prisma/generated/`.
4. Delete the leftover scripts and the dead pages.
5. Back up the current database with `pg_dump`.

### Phase 1: Correct and safe
1. Do not return `plaidAccessToken` in any response. Set a JWT expiry. Make the admin key required.
2. Point the Transactions page at `/api/transactions`, with server-side pagination and filters. Fix notes and category edits. Add a real bulk category endpoint.
3. Fix the Insights date bug. Fix the timezone handling.
4. Use one categorizer. Rule order: your rules (stored in `UserCategoryRule`), then Plaid `personal_finance_category`, then the fallback keywords. Never overwrite a category that you set manually (add a `categorySource` or `userCategory` column).
5. Mark transfers and credit card payments, and leave them out of income and expense totals.
6. Use a separate test database. Make the tests run with `npm test`.

### Phase 2: Deploy to the homelab
1. Write a multi-stage Dockerfile: build the frontend, build the backend, serve both from Express.
2. Write a compose file with Postgres, a volume, a health check, and a backup job.
3. Expose it with `tailscale serve`. Register the HTTPS redirect URI with Plaid.
4. Turn off open registration after you create your account.

### Phase 3: Better data from Plaid
1. Move from `/transactions/get` to `/transactions/sync` with a stored cursor. This handles paging, pending to posted, and removed transactions.
2. Add a `PlaidItem` table so you can connect many banks. Add a page to manage the connections: add, re-login (Link update mode), and remove.
3. Reset a stuck `SYNCING` status on startup. Detect `ITEM_LOGIN_REQUIRED` and show "reconnect".
4. Store money as `Decimal`.

### Phase 4: Features for personal use (choose from this list)

> Replaced by the Tier 1 and Tier 2 lists in `MONARCH_COMPARISON.md` section 2. Build in that order.

- Net worth history: save balances every day, then draw a chart. Debt counts as negative.
- Recurring charges and subscriptions: find them, then show a monthly total and the next due date.
- Budgets that repeat each period, with history and optional rollover.
- Rules page: "merchant contains X, so category Y". Apply to past transactions too.
- Split transactions. Manual transactions and manual accounts (cash, car, house value).
- Alerts through ntfy, Gotify, or Discord. These are simpler than SMTP on a homelab.
- CSV export, for taxes.
- Optional: an LLM categorizes the "Other" transactions (Claude API, or a local model on the homelab).

### Phase 5: Clean up the tooling
- Move from CRA to Vite. Upgrade TypeScript.
- Put one `package.json` per app, or use workspaces. Remove the duplicate root dependencies.

## 6. Decisions (2026-11-02)

| Question | Decision |
|---|---|
| Bank data | Keep Plaid production. |
| Users | You and your partner. Separate logins, separate data. |
| Stack | Keep the backend. Modernize the frontend tooling (see 6.1). |
| Top features | 1. Net worth history. 2. Recurring charges and subscriptions. 3. Repeating budgets. |

### 6.1 Stack recommendation

Keep **Express + Prisma + PostgreSQL + React + Tailwind + Recharts**. Change only these items:

- **CRA to Vite.** CRA is end-of-life and slow. Vite builds static files that Express can serve. The current components move over with almost no changes. This is the only stack change that gives a clear improvement.
- **Add `zod`** to validate request bodies and query strings at the API boundary.
- **Add TanStack Query** in the frontend, only if the fetch and refresh code in the pages becomes hard to manage. Do not add it at the start.

Do not rewrite with Next.js or SvelteKit. The problems in this project are logic errors (findings H3 to H10), not stack problems. A rewrite does not fix them. A rewrite also discards about 8,600 lines of UI that work. Server-side rendering gives no benefit to a private app with two users on a tailnet.

### 6.2 User model

Decision: **each person has a separate login and separate data.** Each user connects their own banks. Each user sees only their own accounts, transactions, budgets, and net worth.

- The code already does this. Every query filters by `userId`. Keep that.
- Each `PlaidItem` belongs to one user.
- Registration: the first user registers normally. After that, a new user can join only with the invite code set in the server env (`INVITE_CODE`).
- Later, only if you want it: share one account with the other user (read-only), for example a joint checking account. Do not build this now.

### 6.3 Plan changes from these decisions

- Phase 1 adds: invite-only registration, and a check that every route and every cron job filters by `userId` (the shared in-memory category rules in `smartCategorizationService.ts` break this today, see M5).
- Phase 3 is required, not optional: two people means more banks, so the `PlaidItem` table and `/transactions/sync` are needed.
- Phase 4 order: net worth history, then repeating budgets, then recurring charges. Net worth needs daily snapshots, so start those as early as possible. History cannot be filled in later.

### 6.4 Plaid cost and the 401(k)

Facts (from Plaid, November 2026):
- Plaid counts cost per **Item**. One Item = one bank login. One Item can hold many accounts.
- `Transactions` and `Investments` have a monthly fee for each Item, for as long as the Item exists. This is true even if the app makes no calls.
- The **Trial plan is free for up to 10 production Items**. Plaid does not publish the Pay-as-you-go price. Other sources estimate about $0.30 per Item per month for Transactions, but this is not verified.
- Fidelity NetBenefits (401(k)) connections through Plaid are often reported as unreliable. Some employer plans do not allow third-party access.

Decisions:
1. **Now (you only):** stay on the Trial plan. Check your plan in the Plaid dashboard. Your banks and cards will fit in 10 Items.
2. **The 401(k) is a manual account.** You type the balance once a month. A 401(k) changes slowly, so this costs one minute per month. It is free, and it does not depend on a weak connection. Do not add the Plaid `Investments` product.
3. **Later (4 adults):** you will probably need more than 10 Items. Then change to Pay-as-you-go. At the estimated rate, 15 to 20 Items cost about $5 to $6 per month. Get the real price from Plaid first. If it is too high, add SimpleFIN Bridge ($15 per year per user) as a second data source.
4. **Remove Items you do not use.** Each Item that is not removed costs money and uses one of the 10 free places. Finding M1 already wastes Items. Fix it in Phase 1, not in Phase 3.

### 6.5 Rules to keep the cost at $0

Goal: stay on the free Trial plan (10 Items), and do not lose features. All phases must obey these rules.

1. **Use only the `Transactions` product.** Remove `Auth` from Link. Do not add `Investments`, `Liabilities`, or `Identity`.
2. **Never call the endpoints that are billed per call.** Do not use `/accounts/balance/get` or `/transactions/refresh`. Use `/transactions/sync` and `/accounts/get`. Their data comes with the subscription.
3. **Re-login must use Link update mode.** When a bank asks for a new login, open Link with the existing Item's access token. Do not create a new Item. A new connection uses another of the 10 places.
4. **Remove Items you do not use.** When a user disconnects a bank, call `itemRemove`. Block a second connection to the same institution for the same user.
5. **Show the count.** The connections page shows "Items used: N / 10" for the whole server. Before Link opens for the 11th Item, the app shows a warning.
6. **Manual accounts for everything else.** 401(k), cars, house, cash. You type the balance when it changes.
7. **Joint accounts: connect them once.** Only one person connects a joint account. Later, read-only sharing (6.2) lets the other person see it without a second Item.
8. **Everything else is self-hosted and free:** Postgres, backups, and alerts through a self-hosted ntfy (instead of paid email services).

Plan changes:
- Phase 1 adds: when a user reconnects a bank or disconnects it, call `itemRemove` for the old Item.
- Phase 4 adds: **manual accounts with balance history**, before the net worth chart. Net worth needs them for the 401(k), cars, and the house.
