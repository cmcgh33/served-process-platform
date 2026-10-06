import { pgTable, serial, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { jobsTable } from "./jobs";
import { serversTable } from "./servers";

export const jobReleaseEventsTable = pgTable(
  "job_release_events",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id")
      .notNull()
      .references(() => jobsTable.id, { onDelete: "cascade" }),
    serverId: integer("server_id")
      .notNull()
      .references(() => serversTable.id),
    reason: text("reason").notNull(),
    releasedAt: timestamp("released_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    jobIdx: index("job_release_events_job_idx").on(t.jobId),
    jobReleasedIdx: index("job_release_events_job_released_idx").on(
      t.jobId,
      t.releasedAt,
    ),
  }),
);

export const insertJobReleaseEventSchema = createInsertSchema(jobReleaseEventsTable).omit({
  id: true,
  releasedAt: true,
});
export type InsertJobReleaseEvent = z.infer<typeof insertJobReleaseEventSchema>;
export type JobReleaseEvent = typeof jobReleaseEventsTable.$inferSelect;
