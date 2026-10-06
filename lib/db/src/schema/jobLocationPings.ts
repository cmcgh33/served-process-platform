import {
  pgTable,
  serial,
  integer,
  timestamp,
  doublePrecision,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { jobsTable } from "./jobs";
import { serversTable } from "./servers";

export const jobLocationPingsTable = pgTable(
  "job_location_pings",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id")
      .notNull()
      .references(() => jobsTable.id, { onDelete: "cascade" }),
    serverId: integer("server_id")
      .notNull()
      .references(() => serversTable.id),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    accuracyM: doublePrecision("accuracy_m"),
    headingDeg: doublePrecision("heading_deg"),
    speedMps: doublePrecision("speed_mps"),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    jobIdx: index("job_location_pings_job_idx").on(t.jobId),
    jobRecordedIdx: index("job_location_pings_job_recorded_idx").on(
      t.jobId,
      t.recordedAt,
    ),
  }),
);

export const insertJobLocationPingSchema = createInsertSchema(
  jobLocationPingsTable,
).omit({ id: true, recordedAt: true });
export type InsertJobLocationPing = z.infer<typeof insertJobLocationPingSchema>;
export type JobLocationPing = typeof jobLocationPingsTable.$inferSelect;
