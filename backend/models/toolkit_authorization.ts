import {
  pgTable,
  serial,
  varchar,
  timestamp,
  integer,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./user";

export const toolkit_authorizations = pgTable(
  "toolkit_authorizations",
  {
    id: serial("id").primaryKey(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    toolkitName: varchar("toolkit_name", { length: 256 }).notNull(),
  },
  (table) => ({
    userIdToolkitNameIdx: uniqueIndex("user_id_toolkit_name_idx").on(
      table.userId,
      table.toolkitName,
    ),
  }),
);

export type ToolkitAuthorization = typeof toolkit_authorizations.$inferSelect;
export type NewToolkitAuthorization =
  typeof toolkit_authorizations.$inferInsert;
