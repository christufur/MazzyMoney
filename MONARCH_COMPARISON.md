# Mazzy Money compared with Monarch Money

Date: 2026-11-02. Goal: replace Monarch (about $99.99 per year) with a self-hosted app that costs $0. It runs on the homelab and stays on the Plaid Trial plan (see `PROJECT_OVERVIEW.md` section 6.5).

The Monarch facts come from Monarch's help center and from 2026 reviews (sources at the end). The Mazzy facts come from the code review in `PROJECT_OVERVIEW.md`.

## 1. Feature by feature

Status of Mazzy today: ✅ works · ⚠️ partly works or has bugs · ❌ missing.

| # | Monarch feature | What Monarch does | Mazzy today | Need it? |
|---|---|---|---|---|
| 1 | Account sync | Many banks, cards, loans, investments, and crypto in one place. | ⚠️ One bank per user. Sync gets 500 transactions maximum and creates duplicates (H7, M1). | **Must** |
| 2 | Net worth | Dashboard and history chart. Manual assets: home (Zillow value), vehicles. | ⚠️ Sums the current balances only. Debt counts as positive. No history. | **Must** |
| 3 | Manual accounts | Accounts you update by hand. | ❌ | **Must** (401(k), car, house, cash) |
| 4 | Transactions list | Search, filters, edit category, notes, tags, attachments. | ⚠️ Edits on the Transactions page fail (H5). No tags. | **Must** |
| 5 | Review queue | New transactions go to "Needs review". You mark them reviewed. | ❌ | **Must**. This is the daily habit of the app. |
| 6 | Rules | Match merchant, amount, or account. Then set category, rename merchant, add tag, split, hide from budget, or set review status. Apply to past transactions too. | ❌ The `UserCategoryRule` table exists, but nothing uses it. | **Must** |
| 7 | Transfers and hidden transactions | Transfers and card payments do not count in budgets or cash flow. | ❌ They count, so the totals are wrong (H6). | **Must** |
| 8 | Category budgets | A planned amount for each category, each month. | ⚠️ The first period only. It does not repeat (M2). | **Must** |
| 9 | Rollover | Money left in a category moves to the next month. | ❌ | **Must** (needed for non-monthly bills) |
| 10 | Flex budgeting | Three groups: Fixed, Flexible (one total for all variable spending), Non-monthly. | ❌ | Should |
| 11 | Recurring | Finds repeated charges. Shows upcoming bills on a calendar. | ❌ | **Must** |
| 12 | Cash flow reports | Income, spending, and cash flow. Sankey chart. Filters by account, category, merchant, tag. | ⚠️ Charts and a Sankey exist. The numbers are wrong because of transfers (H6). | **Must** (fix it) |
| 13 | Splits | Divide one transaction into many categories. | ❌ | Should |
| 14 | Merchant names | Clean and rename merchant names. | ❌ Shows the raw bank text. | Should (a rule action) |
| 15 | Goals | "Save up" and "pay down" goals, linked to accounts. | ❌ The `SavingsGoal` service exists, but it has no routes and no UI. | Should |
| 16 | CSV import and export | Import history (for example, from Mint). Export your data. | ❌ | Should. Plaid gives about 2 years of history. Import older history from a CSV. |
| 17 | Mobile app | iOS and Android apps. | ❌ Web only. | Should: a PWA (home-screen web app) over Tailscale. |
| 18 | Weekly recap | A summary each week: categories over budget, cash flow, items to review. | ❌ | Should: send it through ntfy. No AI is needed. |
| 19 | Multiple people | A household shares one view. Collaborators can be assigned transactions to review. | ⚠️ Separate logins, separate data. This is your choice (6.2). | Later: read-only account sharing |
| 20 | Investments | Holdings, performance chart, compare with the S&P 500. | ❌ | **Skip**. It needs the paid Plaid Investments product. Use a manual 401(k) balance. |
| 21 | Forecasting | Future balance and spending plan (Plus tier). | ⚠️ `/api/analytics/forecast` exists, but its page is not routed. | Skip for now |
| 22 | AI assistant | Chat about your money. Uses third-party LLMs. | ❌ | Skip. Optional later. |
| 23 | Zillow and crypto sync | Automatic home value and crypto balances. | ❌ | Skip. Use manual accounts. |
| 24 | Saved reports, dashboard widgets | Custom reports. Dashboard that you can change. | ❌ | Skip |

## 2. What you need: the "Monarch core"

People use Monarch every day for one loop: **sync, then review, then the budget is correct, then see net worth**. Build that loop first. Build everything else after it.

**Tier 1: replaces Monarch for daily use**
1. Correct sync for many banks: `PlaidItem` table and `/transactions/sync` (rows 1, 7).
2. A Transactions page that works, with a review queue (rows 4, 5).
3. Rules that apply to new and past transactions: category, rename, hide, mark as transfer (rows 6, 7, 14).
4. Budgets that repeat each month, with rollover (rows 8, 9).
5. Manual accounts, daily balance snapshots, and the net worth chart (rows 2, 3).
6. Recurring charge detection and an upcoming-bills calendar (row 11).
7. Correct cash flow and Sankey (row 12). This is mostly done when rule 3 marks transfers.

**Tier 2: makes it better than "good enough"**
8. Splits and tags (row 13).
9. Goals linked to accounts (row 15).
10. CSV import and export (row 16).
11. PWA, so the app works on your phone (row 17).
12. Weekly recap through ntfy (row 18).
13. Flex budgeting view (row 10).

**Skipped:** investments, forecasting, AI assistant, Zillow, crypto, saved reports. Each one costs money (Plaid products or LLM calls), or it adds much work for a small benefit.

## 3. What Mazzy already has that you can reuse

- Plaid Link, token exchange, and cron sync (they need fixes, not a rewrite).
- Prisma schema with `Account`, `Transaction`, `Budget`, `SavingsGoal`, `UserCategoryRule`.
- Pages and charts: Overview, Budgets UI, Insights with a Sankey chart, the category picker, and the notes editor.
- Analytics endpoints: top merchants, day of week, monthly summary, forecast.

About 40% of Tier 1 exists in some form. The largest new parts are the review queue, the rules engine, recurring detection, and net worth history.

## 4. An option to check before you build: Sure

**Sure** (`github.com/we-promise/sure`) is an open-source, self-hosted app that is similar to Monarch. It is a community fork of Maybe Finance, which is archived. It is still maintained (last push 2026-05). It runs in Docker with a compose file. It supports Plaid and SimpleFIN, and you can close registration after setup.

- Possible benefit: net worth, accounts, transactions, and budgets already work. You could have a working app in one evening.
- Possible problems: it is written in Ruby on Rails, so you cannot change it as easily as your own TypeScript code. I did not confirm that it works with your own Plaid keys and stays inside the Trial plan limits.

Recommendation: spend one hour testing Sure in Docker on the homelab before you start Tier 1.
- If Sure does what you need, use it. You save months of work.
- If you want to build and own the app (for learning, or for exact control), continue with Mazzy. This plan is still valid.

## 5. Cost

| | Monarch | Mazzy (plan) |
|---|---|---|
| Subscription | about $99.99 per year (Core), about $199 per year (Plus) | $0 |
| Bank data | included | Plaid Trial: $0 for up to 10 Items |
| Hosting | included | homelab (power only) |
| Your time | none | Tier 1 is the main cost |

## Sources

- [Monarch: About](https://www.monarch.com/about)
- [Monarch help: Getting Started](https://help.monarch.com/hc/en-us/articles/360048393272-Getting-Started-with-Monarch)
- [Monarch help: Transaction Rules](https://help.monarch.com/hc/en-us/articles/360048393372-Transaction-Rules)
- [Monarch help: Rollover Budgets](https://help.monarch.com/hc/en-us/articles/4411119762196-Rollover-Budgets)
- [Monarch help: Using Flex Budgeting](https://help.monarch.com/hc/en-us/articles/32125337244052-Using-Flex-Budgeting)
- [Monarch help: Splitting Transactions](https://help.monarch.com/hc/en-us/articles/360050178492-Splitting-Transactions)
- [Monarch help: Investments in Monarch](https://help.monarch.com/hc/en-us/articles/41855507661076-Investments-in-Monarch)
- [Forbes Advisor review](https://www.forbes.com/advisor/banking/monarch-budget-app-review/)
- [CNBC Select review](https://www.cnbc.com/select/monarch-money-budgeting-app-review/)
- [Penny Hoarder review (pricing)](https://www.thepennyhoarder.com/budgeting/monarch-money-review/)
- [Sure on GitHub](https://github.com/we-promise/sure)
- [Sure docs](https://www.mintlify.com/we-promise/sure/introduction)
