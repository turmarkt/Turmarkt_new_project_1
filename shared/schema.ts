import { pgTable, text, serial, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Ürün özellikleri için dinamik şema
export const attributeSchema = z.record(z.string());

export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  url: text("url").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  price: text("price").notNull(),
  basePrice: text("base_price").notNull(),
  images: text("images").array().notNull(),
  video: text("video"),
  variants: jsonb("variants").notNull(),
  attributes: jsonb("attributes").$type<Record<string, string>>().notNull(),
  categories: text("categories").array().notNull(),
  tags: text("tags").array().notNull()
});

// Ürün ekleme şeması
export const insertProductSchema = createInsertSchema(products).extend({
  attributes: attributeSchema
});

export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof products.$inferSelect;

export const urlSchema = z.object({
  url: z.string().refine((url) => {
    try {
      const parsedUrl = new URL(url);
      const isValidHost = parsedUrl.hostname === "www.trendyol.com";
      const isProductUrl = parsedUrl.pathname.includes("/p-") || parsedUrl.pathname.includes("-p-");
      return isValidHost && isProductUrl;
    } catch {
      return false;
    }
  }, "Geçerli bir Trendyol ürün URL'si giriniz. Örnek: https://www.trendyol.com/marka/urun-adi-p-123456")
});