# Mazzy Money: Implementation Plan (agent-ready)

This file turns `PROJECT_OVERVIEW.md` and `MONARCH_COMPARISON.md` into tasks. Each task is small enough for one coding agent (DeepSeek V4.1 Flash through Cursor). The orchestrator (Claude) gives out the tasks, reviews each result, and merges it.

## 0. Rules for every agent

Put this whole section at the top of every task brief.

1. **Do not read or change any `.env` file.** Use `.env.example` and `.env.test` only.
2. **Do not run tests on the dev database.** Tests use only the test database (`DATABASE_URL` must contain `_test`). `backend/src/__tests__/setup.ts` stops the run if it does not.
3. **Do not use Plaid production.** Agents use `PLAID_ENV=sandbox` only. Each production Item uses one of the 10 free places.
4. **Plaid cost rules** (`PROJECT_OVERVIEW.md` 6.5). Use only the `Transactions` product. Never call `/accounts/balance/get`, `/transactions/refresh`, or `/transactions/recurring/get`.
5. **Change only the files in the task's "Files" list.** If you must change another file, stop and say why in your final message.
6. **No new dependencies** unless the task lists them.
7. **Do not edit `backend/prisma/schema.prisma`** unless the task is a schema task. The orchestrator owns the schema.
8. **Match the code style around you.** Keep the existing layers: `routes/` → `services/` → `lib/prisma`.
9. **Every query filters by `userId`.** Each user sees only their own data.
10. **Finish with the checks** in the task's "Done when" list. Paste their output in your final message, together with the list of files you changed.

### Standard checks

```bash
cd backend  && bunx tsc --noEmit && bun test          # uses .env.test
cd frontend && bunx tsc --noEmit && bun run build && bun run test
```

## 1. How the orchestrator runs this

- **Integration branch:** `rebuild` (created from `main` after Wave 0). Each task runs in its own git worktree from `rebuild`. The task branch is `task/<ID>`.
- **Model:** Cursor `deepseek-v41-flash-1017`. Use `reasoning_effort: high`, or `max` for tasks marked ★.
- **Parallel work:** no more than 3 agents at the same time. Never run two tasks that change the same file at the same time. The "Files" lists show this.
- **Schema:** only one schema change in the whole plan (task S1). The orchestrator writes it. All later tasks build on it.
- **Review gate:** the orchestrator reads the diff, runs the standard checks, and then merges into `rebuild`. If a check fails, the orchestrator sends a new task with the error. It does not continue the old thread.
- **Human steps** are marked 👤. They need you, for example access to the homelab or the Plaid dashboard.

## 2. Before Wave 0 (👤 you)

- [ ] Approve the Wave 0 git operations and the push to GitHub.
- [ ] Start Docker Desktop, so the test Postgres can run.
- [ ] Give the orchestrator the Plaid **sandbox** secret. It goes into `.env.test` through a secret request, not through chat.
- [ ] Check the Plaid dashboard: the plan (Trial?) and the number of Items in use.
- [ ] Optional: test **Sure** for one hour (`MONARCH_COMPARISON.md` §4). If Sure is enough, stop here.

---

## Wave 0: Protect the work (orchestrator, one step after the other)

### W0.1 Back up the database
`pg_dump mazzy_money > ~/backups/mazzy_money_2026-11-02.sql`. Check that the file is not empty.

### W0.2 Repair git
1. Merge `feature/ui-ux-overhaul` into `main`. This adds budget alerts, the email service, and more tests.
2. `git rm --cached frontend` (the broken gitlink). Then add `frontend/` as normal files. Leave out `node_modules` and `build`.
3. Stop tracking `node_modules/`, `frontend/build/`, and `backend/prisma/generated/`. Add them to `.gitignore`.
4. Commit and push (👤 approval). Create the branch `rebuild`.

### W0.3 Test setup ★
- Files: `docker-compose.test.yml` (new; `postgres:16` on port 5433, database `mazzy_test`), `backend/.env.test` (new; gitignored), `backend/.env.example` (new), `backend/bunfig.toml` (new; `[test] preload = ["./src/__tests__/setup.ts"]`), `backend/src/__tests__/setup.ts` (new), `backend/package.json`, `bun.lock` files, all existing test files.
- **Move to Bun** (see §5): delete `package-lock.json` files, run `bun install`. Remove `jest`, `ts-jest`, `@types/jest`, `ts-node`, `nodemon`; add `@types/bun`. Scripts: `dev` = `bun --watch src/index.ts`, `start` = `bun src/index.ts`, `test` = `bun test`, `test:db:up` = `docker compose -f ../docker-compose.test.yml up -d`. Remove the `build` script (Bun runs TypeScript directly; `tsc` is only the type check). Change test imports from jest globals to `bun:test`; `jest.mock` becomes `mock.module`.
- Check that `bunx prisma generate` and `bunx prisma migrate reset` work. If they need Node, keep Node for the Prisma CLI only and write that down in §5.
- `setup.ts` sets `dotenv` to `.env.test`. It throws an error if `DATABASE_URL` does not contain `_test` or `PLAID_ENV` is not `sandbox`. It runs `prisma migrate deploy` (Prisma blocks `migrate reset` when an AI agent runs it). Tests delete their own rows. **Done 2026-11-02.** The old tests were kept. 3 tests that depend on the Sept 2025 date are skipped until W4.3.
- Fix the existing tests: put `beforeEach` inside `describe`, and remove the duplicate `afterAll`.
- Done when: `bun run test:db:up && bun test` passes, and running the tests with the dev URL fails at once.

---

## Wave 1: Clean up and fix (no schema changes)

### W1.1 Backend cleanup (agent)
- Files: `backend/src/routes/transactions.ts`, `backend/src/database.ts` (delete), `backend/checkdatabase.ts`, `backend/test-prisma.ts`, `testdb.ts`, `backend/scripts/clear-test-account.ts`, empty files in `src/utils/`, `src/types/`, `src/middleware/validation.ts` (delete), root `package.json` (remove the duplicate dependencies; keep only what root scripts need, or delete it if nothing needs it).
- Delete these debug endpoints: `/categories/debug`, `/categories/mapping`, `/debug/categories` (both copies), `/debug/enhanced-recategorize`, `/debug/recategorize`.
- Done when: the standard backend checks pass, and `grep -rn "debug" backend/src/routes` shows nothing.

### W1.2 Frontend cleanup and move to Vite ★ (agent)
- Files: everything in `frontend/` except `src/pages/Transactions.tsx`.
- Delete the pages and parts that nothing uses: `Dashboard.tsx`, `Reports.tsx`, `Analytics.tsx`, `BankConnectionManager.tsx`, `TransactionsList.tsx`, `services/categoryService.ts`, `App.test.tsx`, `reportWebVitals.ts`, `__mocks__/reac-router-dom.tsx`. **Keep `Accounts.tsx`** (W2.5 uses it again).
- Replace CRA with Vite. New dev dependencies: `vite`, `@vitejs/plugin-react`, `vitest`, `jsdom`. Remove `react-scripts` and `web-vitals`. Upgrade `typescript` to ^5. Use Bun as the package manager (`bun install`, delete `package-lock.json`). Scripts: `dev` = `vite`, `build` = `vite build`, `test` = `vitest run`.
- `api.ts`: `baseURL` = `import.meta.env.VITE_API_URL ?? ''`, so `/api` is a relative path in production. The Vite dev server proxies `/api` to `http://localhost:8000`.
- Move `Budget.test.tsx` to vitest.
- Remove the placeholder buttons that do nothing: "Quick Add", "Filters", "Add Transaction", "View All Accounts". Show the real user name in the sidebar card (from `useAuth`), not "User / Free Plan".
- Done when: `bunx tsc --noEmit`, `bun run build`, and `bun run test` pass, and `bun run dev` serves the login page.

### W1.3 Auth and security (agent)
- Files: `backend/src/services/authService.ts`, `backend/src/services/jwtService.ts`, `backend/src/routes/auth.ts`, `backend/src/index.ts` (admin route only), `frontend/src/contexts/AuthContext.tsx`, `frontend/src/components/auth/RegisterForm.tsx`, `frontend/src/types/auth.ts`, tests in `src/__tests__/routes/auth.test.ts`.
- Use one `toPublicUser(user)` function that returns only `id, email, fullName, createdAt`. Login, register, and `/me` all use it. Both login and register return `{ token, user }`.
- `jwt.sign(..., { expiresIn: JWT_EXPIRES_IN })`. Default `30d`.
- Admin route: return 503 if `ADMIN_API_KEY` is not set.
- Invite-only registration: the first user can register freely. After that, the body must contain `inviteCode` equal to `process.env.INVITE_CODE`, or the server returns 403. *Shortcut: one shared code in env. Upgrade to per-invite codes only if a household member must be revoked.*
- Frontend: add an invite code field to the register form. Remove `plaidAccessToken` from the `User` type and from all `updateUser` calls. On a 401, the axios interceptor must clear `userData` as well as `authToken` (now it clears only the token). *Shortcut: the JWT stays in `localStorage`; the app is reachable only on the tailnet. Move to an httpOnly cookie if it is ever exposed to the public internet.*
- Done when: the standard checks pass. New tests check that the login response has no `plaidAccessToken`, that the token has `exp`, and that the second registration without a code gets 403.

### W1.4 Analytics date and timezone fixes (agent)
- Files: `backend/src/services/analyticsService.ts`, `backend/src/routes/transactions.ts` (`/monthly-trends` only), new test `src/__tests__/services/analyticsService.test.ts`.
- Insights: compare the current calendar month (day 1 to today) with the same days of the previous month.
- Use UTC everywhere for transaction dates: `getUTCDay`, `getUTCMonth`, and `toLocaleDateString(..., { timeZone: 'UTC' })`.
- Done when: the standard checks pass. The tests run with `TZ=America/Denver` and show the correct month label and the correct weekday for `2025-09-01`.

---

## Wave 2: Data layer (Monarch Tier 1 base)

### S1 Schema change (orchestrator) ★ — **Done 2026-11-02**

As built, S1 is **additive**: the legacy `User` Plaid columns, `UserCategoryRule`, the old categorizer services, and `Budget.period/endDate` stay, so the app still compiles and runs. W2.1 and W2.3 move the code to `PlaidItem`. **S2 — done 2026-11-03** (migration `drop_legacy_user_plaid`, tested on the backup copy) dropped `User.plaid*`, `syncStatus`, `lastSyncAt`, `SyncStatus`, and `UserCategoryRule`. W4.3 decides what to do with `Budget.period/endDate`. The data migration was tested on a copy of the 2026-11-02 backup (2 Items, 5 accounts linked).

Original spec:
One migration, `rebuild_v2`. **Money stays `Float`, rounded to cents on write.** *Shortcut: `Decimal` would change every reader in the app (Prisma sends it as a JSON string). Change to `Decimal` only if a reconcile check finds a cent difference.*

- `PlaidItem`: `id, userId, accessToken, itemId @unique, institutionId, institutionName, cursor?, status (ACTIVE|LOGIN_REQUIRED|ERROR|SYNCING), lastSyncAt?, lastError?, createdAt`. Unique `(userId, institutionId)`.
- `Account`: add `plaidItemId?` (FK, cascade), `isManual Boolean @default(false)`, `isLiability Boolean`. `plaidAccountId` becomes optional (manual accounts do not have one).
- `BalanceSnapshot`: `accountId, date (@db.Date), balance`. Unique `(accountId, date)`.
- `Transaction`: add `pendingTransactionId?`, `pfcPrimary?`, `pfcDetailed?`, `categorySource (PLAID|RULE|USER) @default(PLAID)`, `isTransfer @default(false)`, `hidden @default(false)`, `reviewed @default(false)`, `merchantDisplay?`. Index `(userId, reviewed)`.
- `Rule` (replaces `UserCategoryRule`): `userId, priority, matchMerchant? (contains, case-insensitive), matchAmountMin?, matchAmountMax?, matchAccountId?, setCategory?, setMerchant?, setTransfer?, setHidden?, createdAt`.
- `Budget`: remove `endDate` and `period` meaning. A budget is `category + monthly amount + rollover Boolean + startMonth`.
- `RecurringSeries`: `userId, merchantKey, displayName, averageAmount, intervalDays, lastDate, nextDate, status (ACTIVE|IGNORED)`.
- Data migration (SQL in the same migration): copy each user's Plaid fields into one `PlaidItem` row. Link that user's accounts to it. Then remove the Plaid columns from `User`.
- Delete `smartCategorizationService.ts`, `plaidCategoryService.ts`, and the `EnhancedCategoryService` class. Put a temporary stub `services/categorizer.ts` with `categorize(tx, rules): {category, source, isTransfer, hidden, merchantDisplay}`.
- Done when: `prisma migrate dev` works on a copy of the dev backup, and the backend type-checks.

### W2.1 Plaid client and connections API (agent)
- Files: `backend/src/lib/plaid.ts` (new, the only Plaid client), `backend/src/routes/plaid.ts`, `backend/src/routes/accounts.ts`, tests.
- Remove the 3 copies of the Plaid `Configuration`.
- `POST /api/plaid/link-token` with body `{ itemId? }`. Without `itemId`: products `['transactions']`, new connection. With `itemId`: **update mode** (send `access_token`, no products).
- Before a new link token: count all `PlaidItem` rows on the server. If the count is 10 or more, return 409 `{ error: 'ITEM_LIMIT' }`.
- `POST /api/plaid/exchange`: if the user already has this `institutionId`, call `itemRemove` on the new Item and return 409. Otherwise create a `PlaidItem` and start the sync.
- `DELETE /api/plaid/items/:id`: `itemRemove`, then delete the row (the accounts cascade).
- `GET /api/plaid/items`: the user's Items with status, plus `{ used, limit: 10 }` for the server.
- Delete the legacy `GET /api/plaid/transactions` and `GET /api/plaid/accounts`.
- Done when: the standard checks pass. Tests mock `lib/plaid` and cover the limit, the duplicate institution, update mode, and delete.

### W2.2 One categorizer (agent) ★
- Files: `backend/src/services/categorizer.ts`, `backend/src/services/categories.ts` (new: the single list of display categories and the map from Plaid PFC to category), tests.
- Order: (1) the user's `Rule` rows, by priority; (2) Plaid `personal_finance_category`; (3) category "Other".
- Transfer: `pfcPrimary` is `TRANSFER_IN` or `TRANSFER_OUT`, or `pfcDetailed` is `LOAN_PAYMENTS_CREDIT_CARD_PAYMENT`. Then `isTransfer = true`.
- Do not use regex built from user data. Rule matching is a plain `includes` on lowercase text.
- Done when: unit tests cover rule priority, the PFC map, transfer detection, and a merchant name with `*` in it.

### W2.3 Sync with `/transactions/sync` (agent) ★ — after W2.1 and W2.2
- Files: `backend/src/services/transactionSyncService.ts`, `backend/src/index.ts` (cron and startup), tests with recorded sandbox fixtures.
- For each `PlaidItem`: loop `/transactions/sync` from `cursor` until `has_more` is false. Save the cursor only after the whole loop succeeds.
- `added`: upsert. If the transaction has `pending_transaction_id`, delete the pending row first and copy its `notes`, `reviewed`, and USER category.
- `modified`: update the Plaid fields. **Never** change `primaryCategory` when `categorySource` is `USER` or `RULE`.
- `removed`: delete.
- After the sync: `/accounts/get` for the balances, then upsert today's `BalanceSnapshot` for each account.
- Errors: read `error.response.data.error_code`. `ITEM_LOGIN_REQUIRED` sets status `LOGIN_REQUIRED`. Other errors set `ERROR` and `lastError`.
- On startup: change every `SYNCING` status to `ACTIVE`.
- Cron: every 4 hours, sync the Items that are `ACTIVE`. Use `TZ=UTC`.
- Done when: the tests cover added, modified, removed, pending to posted, a USER category that stays the same, and the error codes.

### W2.4 Totals without transfers (agent) — after W2.3
- Files: `backend/src/routes/transactions.ts` (summary, categories, monthly-trends), `backend/src/services/analyticsService.ts`, `backend/src/services/budgetSyncService.ts`, tests.
- Every income, expense, and budget total uses `isTransfer: false, hidden: false`. Round sums to cents.
- Done when: a test with one transfer and one card payment shows the correct income and expense.

### W2.5 Connections page (agent) — after W2.1
- Files: `frontend/src/pages/Accounts.tsx` (rename to `Connections.tsx`), `frontend/src/components/plaid/PlaidLink.tsx`, `frontend/src/services/api.ts` (the plaid part only), `App.tsx`, `SidebarLayout.tsx` (one nav item).
- List the Items: institution, accounts, status, last sync. Buttons: "Reconnect" (update mode, only when `LOGIN_REQUIRED`), "Remove" (confirm first).
- Show "Banks used: N / 10". Disable "Add bank" when the limit is reached.
- Done when: the frontend checks pass, and the flow works with Plaid sandbox (`user_good` / `pass_good`).

### W2.6 Transactions page on cached data (agent) — after W2.4
- Files: `frontend/src/pages/Transactions.tsx`, `frontend/src/services/api.ts` (the transactions part only), `backend/src/routes/transactions.ts` (new `PUT /bulk`).
- Use `GET /api/transactions` with server-side page, search, category, account, date, and type filters. Use the database `id` everywhere.
- `PUT /api/transactions/bulk` with `{ ids, category?, reviewed?, hidden? }`. It checks that all ids belong to the user. A category change sets `categorySource = USER`.
- Fix `Budgets.tsx:121` in the same task. The endpoint returns an array.
- Done when: the checks pass. Notes, category, and bulk edits stay the same after a page reload.

---

## Wave 3: Deploy to the homelab

### W3.1 One container (agent)
- Files: `backend/src/index.ts` (static serving), `Dockerfile` (new), `.dockerignore` (new), `backend/prisma/schema.prisma` (generator `binaryTargets = ["native", "debian-openssl-3.0.x"]`; this one change is allowed).
- Multi-stage build on `oven/bun:1-slim`: `bun install --frozen-lockfile`, build the frontend, `bunx prisma generate`. Install `openssl` (Prisma needs it). Set `TZ=UTC`. Start command: `bunx prisma migrate deploy && bun src/index.ts`. No backend compile step.
- Express serves `frontend/dist`, with a fallback to `index.html` for any path that is not `/api`. Remove the `cors` middleware.
- Done when: `docker build .` works, and `docker run` with the test DB serves the login page at `/`.

### W3.2 Compose, backups, docs (agent)
- Files: `docker-compose.yml`, `.env.example` (root), `DEPLOY.md`.
- Services: `app`, `db` (`postgres:16`, named volume, health check), and `backup` (`pg_dump` every night to `./backups`, keep 14 days).
- `DEPLOY.md`: how to import the compose file in CasaOS, `tailscale serve --https=443 http://localhost:8000`, how to register the `https://<host>.<tailnet>.ts.net` redirect URI in Plaid, and how to restore a backup.
- Done when: `docker compose config` is valid, and `docker compose up` works on your Mac.

### W3.3 👤 Go live
On the homelab, copy `.env`, then run `docker compose up -d` and `tailscale serve`. Restore the W0.1 backup. Log in. Run one sync.

---

## Wave 4: Monarch Tier 1 features (each task is backend + frontend; no schema changes)

| ID | Task | Depends on | Main files |
|---|---|---|---|
| W4.1 | **Review queue.** A "Needs review" filter and a count in the sidebar. A "Mark reviewed" action for one transaction and for many (uses `/bulk`). | W2.6 | `routes/transactions.ts`, `Transactions.tsx`, `SidebarLayout.tsx` |
| W4.2 ★ | **Rules.** CRUD API at `/api/rules`. A Rules page. "Apply to existing transactions" (dry-run count first). When you change a category, the app offers to create a rule. | W2.2, W2.6 | `routes/rules.ts` (new), `services/categorizer.ts`, `pages/Rules.tsx` (new) |
| W4.3 ★ | **Monthly budgets with rollover.** `GET /api/budgets?month=YYYY-MM`. Spent = expenses in that category in that month. Rollover = previous rollover + amount − spent (only when `rollover` is true). A month selector and a 6-month history bar for each budget. Budget alerts check the current month. | W2.4 | `routes/budgets.ts`, `services/budgetSyncService.ts`, `services/budgetAlertService.ts`, `Budgets.tsx` |
| W4.4 | **Manual accounts.** Create, edit, and delete a manual account (name, type, asset or liability). "Update balance" writes a `BalanceSnapshot` for today. | S1 | `routes/accounts.ts`, `Connections.tsx` or `pages/ManualAccounts.tsx` |
| W4.5 | **Net worth.** `GET /api/networth?range=` returns daily totals from the snapshots (the last known value is carried forward). Liabilities count as negative. A chart on Overview. Fix the Overview hero (debt is negative). | W2.3, W4.4 | `routes/networth.ts` (new), `Overview.tsx` |
| W4.6 ★ | **Recurring.** A nightly job finds series: same `merchantKey`, at least 3 times, amount within ±15%, interval near 7, 14, 30, 91, or 365 days. A Recurring page: monthly total, next date, "Ignore" button, and the bills for the next 30 days. Uses no Plaid recurring endpoint. | W2.3 | `services/recurringService.ts` (new), `routes/recurring.ts` (new), `pages/Recurring.tsx` (new) |

## Wave 5: Monarch Tier 2 (only after you use Wave 4 for 2 weeks)

| ID | Task | Note |
|---|---|---|
| W5.1 | Split transactions | Needs a schema change (orchestrator). Use child rows that point to a parent row. |
| W5.2 | Tags | Needs a schema change. |
| W5.3 | Goals linked to accounts | Reuse `savingsGoalService.ts`. Add routes and a page. |
| W5.4 | CSV import and export | Import maps columns to fields and skips duplicates. Export uses the current filters. |
| W5.5 | PWA | Manifest, icons, service worker for the app shell only. |
| W5.6 | Weekly recap through ntfy | Cron every Sunday: budgets over the limit, cash flow, reviews waiting. Use `NTFY_URL` and `NTFY_TOPIC`. Then remove SMTP. |
| W5.7 | Flex budget view | Group budgets as Fixed, Flexible, and Non-monthly. Only the UI changes. |

## 3. Order and parallel work

```
W0.1 → W0.2 → W0.3
  → [W1.1 ‖ W1.2 ‖ W1.3] → W1.4
  → S1 → [W2.1 ‖ W2.2] → W2.3 → [W2.4 ‖ W2.5] → W2.6
  → [W3.1 → W3.2] → W3.3 👤
  → [W4.1 ‖ W4.4 ‖ W4.6] → [W4.2 ‖ W4.5] → W4.3
```

`‖` = can run at the same time (the file lists do not overlap). W1.1 and W1.4 both change `routes/transactions.ts`, so W1.4 runs after W1.1.

## 5. Tooling: Bun

Bun 1.3 replaces npm, Node, ts-node, nodemon, and jest in the backend. In the frontend, Bun replaces npm. Vite and Vitest stay.

- Why: one tool for install, run, watch, and test. TypeScript runs directly, so the backend has no build step and no `dist/`. Installs are faster. Fewer dev dependencies.
- **Keep the code Node-compatible.** Do not use `Bun.*` APIs, `Bun.serve`, or `bun:sqlite` in app code. Express, Prisma, Plaid, `node-cron`, and `bcryptjs` stay. Then you can go back to Node by changing the scripts only.
- `bun:test` is only in test files.
- Frontend tests stay on Vitest with jsdom, because `bun test` has no simple DOM setup for React Testing Library.
- Risk: the Prisma CLI under Bun. W0.3 checks this first. If it fails, the fallback is: Bun for everything, and Node only to run the Prisma CLI.

## 4. Changes to `PROJECT_OVERVIEW.md` in this plan

- Money stays `Float`, rounded to cents (M4 is a shortcut, not a fix). Reason: see S1.
- The invite is one shared code in env, not codes that users create. Reason: see W1.3.
- Bun replaces npm/Node/jest (§5).
- Plaid's recurring endpoint is not used. The app finds recurring charges itself (cost rule 4).
