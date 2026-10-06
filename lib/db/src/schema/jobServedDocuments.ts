import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { jobsTable } from "./jobs";

/**
 * Documents-served list — the per-job catalogue of legal documents that the
 * process server is being asked to deliver (Summons, Complaint, Motion,
 * Subpoena, Petition, Order, Other …). Distinct from the `documents` table,
 * which stores actual uploaded file blobs; this table is purely the metadata
 * list rendered onto the affidavit's "Documents Served" block so the court
 * filing reflects exactly what was in the recipient's hand.
 *
 * Stored as a child table (rather than a JSON column on `jobs`) so the
 * affidavit pipeline can read & order entries deterministically and so we
 * can later query "how many summonses were served this month" without
 * cracking JSON.
 */
export const jobServedDocumentsTable = pgTable(
  "job_served_documents",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id")
      .notNull()
      .references(() => jobsTable.id, { onDelete: "cascade" }),
    /**
     * Free-text title (e.g. "First Amended Complaint", "Summons in a Civil
     * Case"). What the court would see on a docket entry.
     */
    title: text("title").notNull(),
    /**
     * Coarse category — kept as free text rather than an enum so unusual
     * filings ("Writ of Habeas Corpus", "Order to Show Cause") aren't
     * blocked by a schema migration. The post-job UI offers a fixed
     * dropdown of common values + Other.
     */
    documentType: text("document_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    jobIdx: index("job_served_documents_job_idx").on(t.jobId),
  }),
);

export const insertJobServedDocumentSchema = createInsertSchema(
  jobServedDocumentsTable,
).omit({ id: true, createdAt: true });
export type InsertJobServedDocument = z.infer<typeof insertJobServedDocumentSchema>;
export type JobServedDocument = typeof jobServedDocumentsTable.$inferSelect;
