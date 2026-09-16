CREATE UNIQUE INDEX "SyncRun_one_active_per_connection_idx"
ON "SyncRun" ("connectionId")
WHERE "status" IN ('QUEUED', 'RUNNING');
