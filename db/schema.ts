import { pgTable, serial, text, timestamp, jsonb } from "drizzle-orm/pg-core";

export type ArticleSection = { heading: string; paragraphs: string[] };

export const articles = pgTable("articles", {
  id: serial().primaryKey(),
  slug: text().notNull().unique(),
  title: text().notNull(),
  description: text().notNull(),
  sections: jsonb().$type<ArticleSection[]>().notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
});
