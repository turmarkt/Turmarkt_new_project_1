import { pgTable, text, serial, numeric, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Sabit özellikleri enum olarak tanımla
export enum ProductAttribute {
  Hacim = "15 ml",
  Mensei = "CN",
  PaketIcerigi = "Tekli"
}

// Attributes şemasını kesin olarak tanımla
const attributesSchema = z.object({
  Hacim: z.literal(ProductAttribute.Hacim),
  Mensei: z.literal(ProductAttribute.Mensei),
  "Paket İçeriği": z.literal(ProductAttribute.PaketIcerigi)
}).strict(); // strict() ile fazladan özellik eklenmesini engelle

// Attribute tipini oluştur
export type ProductAttributes = {
  Hacim: ProductAttribute.Hacim;
  Mensei: ProductAttribute.Mensei;
  "Paket İçeriği": ProductAttribute.PaketIcerigi;
};

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
  attributes: jsonb("attributes").$type<ProductAttributes>().notNull(),
  categories: text("categories").array().notNull(),
  tags: text("tags").array().notNull()
});

export const insertProductSchema = createInsertSchema(products).extend({
  attributes: attributesSchema
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