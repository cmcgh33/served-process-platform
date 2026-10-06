import { pgTable, serial, text, timestamp, varchar, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const clientsTable = pgTable("clients", {
  id: serial("id").primaryKey(),
  ownerUserId: varchar("owner_user_id", { length: 64 }),
  firmName: text("firm_name").notNull(),
  contactName: text("contact_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  address: text("address"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  ownerIdx: index("clients_owner_idx").on(t.ownerUserId),
}));

export const insertClientSchema = createInsertSchema(clientsTable).omit({ id: true, createdAt: true, ownerUserId: true });
export type InsertClient = z.infer<typeof insertClientSchema>;
export type Client = typeof clientsTable.$inferSelect;
