---
version: 1
slug: "frontend-src-app-tsx"
primary_target: "frontend/src/App.tsx"
related_targets: ["frontend/src/pages"]
---

# Surface: the whole signed-in app (Overview, Transactions, Budgets, Recurring, Net worth, Connections)

Mode: Operate. Phone and desktop equally (PRODUCT.md). Code-led build.

Audience and job: the owner and later 3 more household adults; the daily loop is sync, review new transactions, see budgets, glance at net worth. Weekly: adjust budgets, check recurring, update manual balances.

Constraints: keep every working feature and API; numbers must stay exact (transfers and hidden rows never in totals); 10-bank limit always visible on Connections; no invented data.

Chosen direction: Kakeibo Household Ledger (user's pick on the decision page, second hand). Approved sketch: .impeccable/mocks/decision/kakeibo.html.

Memorable moment: opening the app shows *this month as a ledger spread*: what came in, what went out, what you saved, the plan line by line, and one calm reflection sentence.

## Direction contract

THESIS: Money as the household's monthly ledger ritual — plan, record, reflect — on calm ruled pages that state facts plainly and celebrate what was saved. It refuses the category default of a white card grid with a gradient hero, emoji icons, and a dashboard of equal-weight widgets.

OWN-WORLD: Warm off-white page ground (#f6f4ef) with one white "spread" surface per screen, hairline rules (#e4e0d6) and dashed ledger lines between rows; ink #22252b; sage green #4f7a6a for saved / on-track / primary action; terracotta #c96f4a only for over-budget and needs-attention; no other accents. One humanist grotesk (Hanken Grotesk), tabular figures everywhere money appears, small uppercase tracked labels for section heads. No gradients, no emoji, no drop-shadow cards; radius 10px on the spread, 4px on bars.

STORY: The visitor sees in seconds how the month is going (in, out, saved), which plan lines need care, and how many transactions wait for review; they review in a few taps and leave reassured. Overspending is stated plainly with what happens next (rolls into next month), never shamed.

FIRST VIEWPORT: Top bar (desktop): name left, section tabs (This month, Transactions, Budgets, Recurring, Net worth, Connections) with an underline on the active tab; phone: bottom tab bar with 5 items. Page title row: "November 2026" large with "Day 18 of 30" beside it and month arrows. One spread split in two pages: left page = three figures (Income, Spent, Saved so far) on ruled underlines, then "Plan for the month" budget lines (name, thin track, spent / planned), then the reflection note in a tinted inset; right page = "To review · 12 new" ledger list with a terracotta dot on unreviewed rows and the primary dark "Review 12 transactions" button, then "Coming up" recurring lines. On phone the two pages stack: figures, review, plan, coming up.

FORM: Kakeibo household account book, 1st of 7 on my ordered grounded list in round 1 (presented as IMPECCABLE'S PICK, chosen as YOUR FAVORITE in round 2). Signature move: the reflection line — one generated plain-language sentence per screen summarizing the month (saved vs last month, what rolls over). Disciplines kept from the declined hands: one fixed scale for every month-to-month comparison; guide words naming the date range in view on long lists; on phone the review queue shows one transaction per screen and snaps to the next. seed:6aa78836449a743d

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
