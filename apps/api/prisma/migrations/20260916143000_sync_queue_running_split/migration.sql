DROP INDEX IF EXISTS "SyncRun_one_active_per_connection_idx";
DROP INDEX IF EXISTS "SyncRun_active_connection_key";

CREATE UNIQUE INDEX "SyncRun_one_running_per_connection_idx"
ON "SyncRun" ("connectionId")
WHERE "status" = 'RUNNING';

CREATE UNIQUE INDEX "SyncRun_one_queued_per_connection_idx"
ON "SyncRun" ("connectionId")
WHERE "status" = 'QUEUED';
