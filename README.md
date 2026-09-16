# Finance Health

Starter architecture for a personal financial-health application integrated with Pluggy / Meu Pluggy.

## Stack

- Mobile: React Native + Expo Router
- Backend: NestJS + TypeScript
- Database: PostgreSQL + Prisma
- Provider: Pluggy Data API (`pluggy-sdk` server-side)
- Integration posture: read-only

## Why this shape

The Pluggy quickstart currently supports Expo/React Native and its official Node SDK. The secret stays in the backend; mobile receives only a short-lived Connect Token.

## First run

1. Copy `.env.example` to `.env`.
2. Add your Pluggy Development Application `PLUGGY_CLIENT_ID` and `PLUGGY_CLIENT_SECRET`.
3. Set a long random `JWT_SECRET` and `WEBHOOK_SHARED_SECRET`.
4. `pnpm install --frozen-lockfile`
5. `pnpm db:up`
6. `pnpm db:generate`
7. `pnpm db:migrate`
8. `pnpm dev:api`
9. In another terminal, configure `apps/mobile/.env.local` from
   `apps/mobile/.env.example` and run `pnpm dev:mobile`.

The API listens on `0.0.0.0` in development so a device on the same network can reach it.
For a physical device, set `EXPO_PUBLIC_API_URL` to the API's LAN address instead of
`localhost` or `127.0.0.1`. The Pluggy credentials and webhook secret belong only in the API
environment.

Useful checks:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm db:deploy` for an already-created database

## Test on a physical iPhone

The current dependency set is compatible with Expo Go, so an EAS build is not required for
the first device test. With the API running, find the computer's LAN IPv4 address, put it in
`apps/mobile/.env.local` as `EXPO_PUBLIC_API_URL=http://<IP-DO-COMPUTADOR>:3000`, and run:

```text
cd apps/mobile
npx expo start --tunnel
```

Open the QR code with Expo Go on the iPhone. The phone and the API must be reachable from the
same network when using a LAN URL. For real Pluggy webhooks, use a public HTTPS staging URL or
an HTTPS tunnel and register `https://<host>/v1/webhooks/pluggy` in the Pluggy Dashboard with the
`x-finance-health-secret` header; never put that secret in the mobile environment.

## Meu Pluggy setup

1. Connect your own banks in Meu Pluggy.
2. Create a Development Application in the Pluggy Dashboard.
3. Enable/list the `MeuPluggy` connector for that application.
4. Authorize each connected bank from Meu Pluggy into the developer application.
5. Put only the Developer Application credentials in the backend `.env`.

## Implemented MVP slice

### Foundation and security

- [x] monorepo skeleton
- [x] Pluggy server boundary with provider mappers
- [x] short-lived Connect Token endpoint
- [x] JWT access tokens and rotating opaque refresh sessions
- [x] ownership checks on user-scoped resources
- [x] strict DTO and environment validation
- [x] helmet, request IDs, CORS allowlist and throttling
- [x] Prisma schema, initial migrations and PostgreSQL health checks

### Real data and intelligence

- [x] Pluggy Connect flow and connection lifecycle
- [x] account, transaction, bill, investment and loan persistence
- [x] `/v2/transactions` cursor synchronization through the official SDK helper
- [x] idempotent webhook inbox with asynchronous PostgreSQL-backed queue/worker
- [x] merchant normalization, recurring candidates and internal-transfer matching
- [x] user categories and category rules
- [x] consolidated dashboard and financial-health history
- [x] transparent score components with coverage, confidence, quality and provenance

### Mobile MVP

- [x] authenticated Expo app with SecureStore refresh token handling
- [x] biometric app unlock when available
- [x] Pluggy Connect UI and reconnect trigger
- [x] dashboard, connection status, loading, error and insufficient-data states

The remaining product backlog includes offline caching, notification preferences, CSV export,
forecasting and a richer planning experience. These are deliberately outside the first
read-only financial-data MVP.

## Important

The health index is an educational application metric. It is not a credit score and should not be presented as a regulated credit assessment.
