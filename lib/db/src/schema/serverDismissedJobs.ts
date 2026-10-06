import { pgTable, integer, timestamp, primaryKey, index } from "drizzle-orm/pg-core";
import { jobsTable } from "./jobs";
import { serversTable } from "./servers";

export const serverDismissedJobsTable = pgTable(
  "server_dismissed_jobs",
  {
    serverId: integer("server_id")
      .notNull()
      .references(() => serversTable.id, { onDelete: "cascade" }),
    jobId: integer("job_id")
      .notNull()
      .references(() => jobsTable.id, { onDelete: "cascade" }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.serverId, t.jobId] }),
    serverIdx: index("server_dismissed_jobs_server_idx").on(t.serverId),
  }),
);

export type ServerDismissedJob = typeof serverDismissedJobsTable.$inferSelect;
