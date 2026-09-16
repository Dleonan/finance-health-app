# AGENTS.md — Finance Health

## Product invariant
This is a personal financial health application. Default to READ-ONLY financial integrations.
Do not add PIX, transfers, payment initiation, boleto payment, or `PluggyPaymentsClient` without an explicit architectural decision.

## Security invariants
1. `PLUGGY_CLIENT_SECRET` is server-side only. Never expose it to React Native, Expo public variables, logs, analytics, crash reports, or API responses.
2. The mobile app receives only a short-lived Pluggy Connect Token.
3. Never persist bank passwords, MFA values, raw authentication payloads, API keys, or Connect Tokens.
4. Encrypt sensitive local application secrets at rest and redact financial data from logs.
5. Webhook processing must be idempotent by `eventId`.
6. All money uses integer cents or Decimal in persistence/domain logic; never binary floating point for accounting totals.
7. Store provider IDs separately from internal IDs. Never use a Pluggy ID as the application's primary key.
8. All timestamps are UTC in storage. Convert only at presentation boundaries.

## Pluggy integration rules
1. Use official `pluggy-sdk` server-side.
2. Use `/v2/transactions` cursor pagination via SDK helpers (`fetchTransactionsCursor` / `fetchAllTransactions`). Do not add new code using deprecated page-based transactions.
3. Prefer webhook-driven + Meu Pluggy daily sync. Do not create aggressive polling loops or recurring manual PATCH item updates.
4. A transaction is upserted by `(provider, providerTransactionId)`.
5. Handle created, updated and deleted transaction webhook events.
6. Connector/item errors are product states, not unhandled exceptions.

## Architecture
- Modular monolith first.
- Mobile: React Native + Expo Router.
- API: NestJS + TypeScript.
- Persistence: PostgreSQL + Prisma.
- Keep external provider DTOs in the integration boundary; map them into our own domain model.
- Domain modules must not import Pluggy SDK directly.

## Financial-health rules
- The Financial Health Index is educational and transparent, not a credit score.
- Every score component must expose inputs, formula, confidence/data-quality, and remediation ideas.
- Never recommend a specific security/fund/crypto asset solely from this index.
- Distinguish observed facts from estimates and user-entered assumptions.

## Testing
- Unit-test all money calculations and score boundaries.
- Add fixture-based Pluggy mapping tests.
- Add idempotency tests for webhooks.
- No test may require real bank credentials.
