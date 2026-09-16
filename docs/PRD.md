# Product Requirements — Finance Health

## Vision
A professional but simple personal-finance app that turns bank data into understandable financial-health guidance. The user should know in seconds: how much they have, what they owe, where money is going, what is coming next, and what deserves attention.

## Core principles
- Read-only by default.
- One source of truth across banks and cards.
- Explainable financial-health indicators.
- Low cognitive load: progressive disclosure instead of dashboards full of noise.
- Manual data entry exists only for facts Open Finance cannot know reliably.

## Main navigation
1. **Hoje** — consolidated financial position and priority alerts.
2. **Movimentações** — all transactions, search, filters, categorization and recurring detection.
3. **Planejamento** — budgets, cash-flow forecast, goals and upcoming commitments.
4. **Patrimônio** — accounts, investments, liabilities and net worth.
5. **Saúde** — Financial Health Index with explainable components and trends.

## Today dashboard
- Total available cash.
- Current month income vs expenses.
- Credit-card bills: open amount, due date, projected next invoices.
- Upcoming recurring expenses.
- Free cash-flow projection to next payday / end of month.
- Financial-health index and only the 1–3 highest-priority actions.
- Connection freshness and data-quality warning.

## Transactions
- Unified timeline across accounts/cards.
- Provider category + user override.
- Merchant normalization.
- Search by description/merchant/value/date.
- Transfer detection to prevent double-counting.
- Installment grouping.
- Recurring/subscription detection.
- Rules engine: "transactions containing X -> category Y".

## Credit cards
- Per-card balance and limit when available.
- Open/closed bills when provider exposes bills.
- Due date and closing date.
- Installments and future exposure.
- Total card commitment by month.
- Credit utilization indicator.

## Planning
- Monthly category budgets.
- Fixed vs variable expense view.
- Recurring cash-flow calendar.
- Forecast for 30/60/90 days.
- Goals with target amount/date.
- Emergency-fund target in months of essential expenses.

## Debt and loans
- Outstanding balance, installment, rate when available.
- Monthly debt-service burden.
- Debt schedule and concentration.
- No automated refinancing recommendation in v1; show factual comparisons only.

## Investments / assets
- Consolidated balance by institution/type.
- Contributions/withdrawals where data allows.
- Allocation and net-worth history.
- No asset-picking recommendations in v1.

## Financial Health Index (0–100)
Educational internal index, not a credit score.

Suggested components:
- 25 pts — monthly cash-flow / savings rate.
- 20 pts — emergency liquidity coverage.
- 20 pts — debt-service burden.
- 15 pts — revolving/card utilization and bill stress.
- 10 pts — budget stability / essential-expense concentration.
- 10 pts — short-term resilience (upcoming commitments vs liquid cash).

Each component returns:
- score;
- current measured value;
- target/reference band;
- confidence (high/medium/low);
- data sources used;
- explanation;
- suggested action phrased as an option, not a command.

## Alerts
Examples:
- Bill due in <= 3 days and available cash is insufficient.
- Spending category > configured budget.
- Recurring charge increased materially.
- Duplicate/suspiciously repeated charge candidate.
- Cash-flow projection becomes negative.
- Connection stale/error.
- Large unusual transaction relative to personal baseline.

## Data quality
Every dashboard aggregate has a data-quality state:
- Complete
- Partial
- Stale
- Estimated
This prevents false precision when a bank does not expose bills/loans/investments.

## v1 acceptance criteria
- Connect at least one Meu Pluggy-linked institution.
- Import accounts + transactions.
- Persist and incrementally update data.
- Consolidated monthly income/expense.
- Credit-card bills when available.
- Basic recurring detection.
- Financial Health Index with explainability.
- Mobile dashboard with biometric app lock.
