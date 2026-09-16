-- Preserve unknown provider financial fields as unknown instead of inventing BRL/zero values.
ALTER TABLE "Account"
  ALTER COLUMN "currency" DROP DEFAULT,
  ALTER COLUMN "currency" DROP NOT NULL;

ALTER TABLE "Investment"
  ALTER COLUMN "currency" DROP DEFAULT,
  ALTER COLUMN "currency" DROP NOT NULL;

ALTER TABLE "Loan"
  ALTER COLUMN "currency" DROP DEFAULT,
  ALTER COLUMN "currency" DROP NOT NULL;

ALTER TABLE "FinancialSnapshot"
  ALTER COLUMN "liquidAssets" DROP NOT NULL,
  ALTER COLUMN "investedAssets" DROP NOT NULL,
  ALTER COLUMN "liabilities" DROP NOT NULL,
  ALTER COLUMN "netWorth" DROP NOT NULL;

ALTER TABLE "WebhookEvent"
  ADD COLUMN "accountId" TEXT,
  ADD COLUMN "resourceIds" JSONB,
  ADD COLUMN "providerErrorCode" TEXT,
  ADD COLUMN "connectionId" TEXT,
  ADD COLUMN "syncRunId" TEXT;

ALTER TABLE "SyncRun"
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "nextAttemptAt" TIMESTAMP(3),
  ADD COLUMN "dataQuality" "DataQuality",
  ADD COLUMN "dataQualityReasons" JSONB;

CREATE INDEX "WebhookEvent_connectionId_status_receivedAt_idx"
  ON "WebhookEvent"("connectionId", "status", "receivedAt");

CREATE INDEX "WebhookEvent_syncRunId_idx"
  ON "WebhookEvent"("syncRunId");

CREATE TABLE "MetricAggregate" (
  "name" TEXT NOT NULL,
  "counter" BIGINT NOT NULL DEFAULT 0,
  "observationCount" BIGINT NOT NULL DEFAULT 0,
  "totalMs" BIGINT NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MetricAggregate_pkey" PRIMARY KEY ("name")
);

ALTER TABLE "WebhookEvent"
  ADD CONSTRAINT "WebhookEvent_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WebhookEvent"
  ADD CONSTRAINT "WebhookEvent_syncRunId_fkey"
  FOREIGN KEY ("syncRunId") REFERENCES "SyncRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
