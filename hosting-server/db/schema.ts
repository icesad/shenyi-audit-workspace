import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// User-owned profile only. Legacy browser business databases are not migrated.
export const accountProfiles = sqliteTable("account_profiles", {
  userId: text("user_id").primaryKey().notNull(),
  phone: text("phone").notNull().default(""),
  displayName: text("display_name").notNull().default(""),
  revision: integer("revision").notNull().default(0),
  updatedAt: text("updated_at").notNull().default(""),
});
