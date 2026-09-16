# Architecture

```text
┌─────────────────────────────────────┐
│ React Native / Expo                 │
│ Today · Transactions · Plan · Health│
└─────────────────┬───────────────────┘
                  │ HTTPS / JSON
                  ▼
┌─────────────────────────────────────┐
│ NestJS modular monolith             │
│ auth/JWT + rotating sessions        │
│ connections                         │
│ accounts                            │
│ transactions                        │
│ cards & bills                       │
│ investments / loans                 │
│ planning                            │
│ financial-health                    │
│ webhooks                            │
│ sync queue + worker                 │
│ health/readiness                    │
└──────────────┬───────────┬──────────┘
               │           │
               │           └──────────────► Pluggy Data API
               │                            (server credentials only)
               ▼
          PostgreSQL
```

## Pluggy flow

```text
Mobile asks API for connect token
        │
        ▼
API uses CLIENT_ID + CLIENT_SECRET
        │
        ▼
Pluggy returns short-lived Connect Token
        │
        ▼
Mobile opens Pluggy Connect
        │
        ▼
Meu Pluggy OAuth / institution connection
        │
        ▼
Pluggy webhook -> API
        │
        ▼
Webhook inbox (eventId unique, no raw payload)
        │
        ▼
PostgreSQL queue/worker syncs normalized data
        │
        ▼
Dashboard and Financial Health read the user's own records
```

## Sync strategy

- Initial connection: hydrate item, accounts, the last 90 days of provider-supported transaction history, bills, investments and loans.
- Ongoing: rely on provider/Meu Pluggy auto-sync and Pluggy webhooks.
- `transactions/created`: consume the provided cursor/link or fetch changed window.
- `transactions/updated`: refetch IDs and upsert.
- `transactions/deleted`: soft-delete/tombstone provider transactions.
- `item/updated`: refresh account balances + non-transaction products.
- Store `eventId` before processing to guarantee idempotency. Duplicate deliveries return success without enqueueing another run.
- A connection can only be accessed through its authenticated `userId`; provider IDs are never application primary keys.
- Connector failures are persisted as connection/sync-run product states and are not exposed as raw provider errors.

## Provider boundary

Never make UI/business rules depend directly on raw Pluggy models. Use adapters:

`Pluggy Transaction -> ProviderTransactionDTO -> Domain Transaction -> API ViewModel`

This keeps the application replaceable/testable if the provider changes.

## Money

Persist monetary fields using PostgreSQL Decimal/Numeric (`Decimal(18,2)` initially). Domain calculations must use a decimal library or integer cents, never JS floating-point aggregation.

## Financial Health contract

The score is educational, versioned (`fh-v1.0.0`) and intentionally returns an unavailable
component when its inputs are absent. Each component includes the measurement, reference band,
confidence, data quality, provenance, source fields, calculation window, explanation and a
remediation idea. A global coverage value prevents sparse data from being presented as a
precise score.
