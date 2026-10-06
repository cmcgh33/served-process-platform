import { pgTable, serial, text, integer, varchar, timestamp, index, bigint, uniqueIndex } from "drizzle-orm/pg-core";
import { jobsTable } from "./jobs";

export const documentsTable = pgTable("documents", {
  id: serial("id").primaryKey(),
  ownerUserId: varchar("owner_user_id", { length: 64 }).notNull(),
  jobId: integer("job_id").references(() => jobsTable.id),
  name: text("name").notNull(),
  size: bigint("size", { mode: "number" }).notNull(),
  contentType: text("content_type").notNull(),
  objectPath: text("object_path").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  ownerIdx: index("documents_owner_idx").on(t.ownerUserId),
  jobIdx: index("documents_job_idx").on(t.jobId),
  objectPathUniq: uniqueIndex("documents_object_path_uniq").on(t.objectPath),
}));

// Pending upload reservations created when an attorney requests a presigned
// PUT URL. Binds objectPath -> ownerUserId so a different attorney cannot
// later claim the path via POST /documents (IDOR protection). Reservations
// expire after 1 hour and are reserved against the caller's plan quota.
export const uploadReservationsTable = pgTable("upload_reservations", {
  objectPath: text("object_path").primaryKey(),
  ownerUserId: varchar("owner_user_id", { length: 64 }).notNull(),
  expectedSize: bigint("expected_size", { mode: "number" }).notNull(),
  contentType: text("content_type").notNull(),
  name: text("name").notNull(),
  jobId: integer("job_id").references(() => jobsTable.id),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  ownerIdx: index("upload_reservations_owner_idx").on(t.ownerUserId),
  expiresIdx: index("upload_reservations_expires_idx").on(t.expiresAt),
}));

export type Document = typeof documentsTable.$inferSelect;
export type InsertDocument = typeof documentsTable.$inferInsert;
export type UploadReservation = typeof uploadReservationsTable.$inferSelect;
