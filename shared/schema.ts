import { pgTable, text, serial, numeric, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  url: text("url").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  price: numeric("price").notNull(),
  images: text("images").array().notNull(),
  variants: jsonb("variants").notNull(),
  attributes: jsonb("attributes").notNull(),
  categories: text("categories").array().notNull(),
  tags: text("tags").array().notNull()
});

export const insertProductSchema = createInsertSchema(products).pick({
  url: true,
  title: true,
  description: true,
  price: true,
  images: true,
  variants: true,
  attributes: true,
  categories: true,
  tags: true
});

export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof products.$inferSelect;

export const urlSchema = z.object({
  url: z.string().url().startsWith("https://www.trendyol.com/")
});