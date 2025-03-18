import type { Express } from "express";
import { createServer } from "http";
import { storage } from "./storage";
import * as cheerio from "cheerio";
import { urlSchema, type InsertProduct } from "@shared/schema";
import { ZodError } from "zod";
import { createObjectCsvWriter } from "csv-writer";
import fetch from "node-fetch";

export async function registerRoutes(app: Express) {
  const httpServer = createServer(app);

  app.post("/api/scrape", async (req, res) => {
    try {
      const { url } = urlSchema.parse(req.body);

      // First check if we already have this product
      const existing = await storage.getProduct(url);
      if (existing) {
        return res.json(existing);
      }

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error("Failed to fetch product page");
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      // Temel ürün bilgileri
      const title = $("h1.pr-new-br").text().trim();
      const description = $("div.detail-border-container").text().trim();
      const price = parseFloat($("span.prc-dsc").text().replace("TL", "").trim());
      // %15 kar ekle
      const priceWithProfit = parseFloat((price * 1.15).toFixed(2));

      // Ürün özellikleri
      const attributes: Record<string, string> = {};
      $(".detail-attr-container .detail-attr-item").each((_, el) => {
        const key = $(el).find(".detail-attr-key").text().trim();
        const value = $(el).find(".detail-attr-value").text().trim();
        if (key && value) {
          attributes[key] = value;
        }
      });

      // Kategori bilgisi
      const categories = $(".product-path span")
        .map((_, el) => $(el).text().trim())
        .get()
        .filter(cat => cat !== ">");

      // Ürün etiketleri
      const tags = $(".product-tag")
        .map((_, el) => $(el).text().trim())
        .get();

      // Tüm ürün görselleri
      const images = [];
      // Ana ürün görselleri
      $("img.detail-section-img").each((_, el) => {
        const src = $(el).attr("src");
        if (src && !images.includes(src)) {
          images.push(src);
        }
      });
      // Galeri görselleri
      $(".gallery-modal-content img").each((_, el) => {
        const src = $(el).attr("src");
        if (src && !images.includes(src)) {
          images.push(src);
        }
      });
      // Ek görseller
      $("img[data-gallery]").each((_, el) => {
        const src = $(el).attr("src");
        if (src && !images.includes(src)) {
          images.push(src);
        }
      });

      // Beden ve renk varyantları
      const variants = {
        sizes: $(".sp-itm:not(.so)")
          .map((_, el) => $(el).text().trim())
          .get(),
        colors: $(".slc-txt")
          .map((_, el) => $(el).text().trim())
          .get()
          .filter(Boolean)
      };

      const product: InsertProduct = {
        url,
        title,
        description,
        price: priceWithProfit,
        basePrice: price, // Added basePrice
        images,
        variants,
        attributes,
        categories,
        tags
      };

      const saved = await storage.saveProduct(product);
      res.json(saved);

    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({ message: "Geçersiz URL formatı" });
      } else {
        res.status(500).json({ message: error instanceof Error ? error.message : "Bilinmeyen bir hata oluştu" });
      }
    }
  });

  app.post("/api/export", async (req, res) => {
    try {
      const { product } = req.body;

      const csvWriter = createObjectCsvWriter({
        path: 'products.csv',
        header: [
          {id: 'handle', title: 'Handle'},
          {id: 'title', title: 'Title'},
          {id: 'body', title: 'Body (HTML)'},
          {id: 'vendor', title: 'Vendor'},
          {id: 'product_category', title: 'Product category'},
          {id: 'type', title: 'Type'},
          {id: 'tags', title: 'Tags'},
          {id: 'published', title: 'Published on online store'},
          {id: 'status', title: 'Status'},
          {id: 'option1_name', title: 'Option1 Name'},
          {id: 'option1_value', title: 'Option1 Value'},
          {id: 'option2_name', title: 'Option2 Name'},
          {id: 'option2_value', title: 'Option2 Value'},
          {id: 'price', title: 'Price'},
          {id: 'compare_at_price', title: 'Compare-at price'},
          {id: 'requires_shipping', title: 'Requires shipping'},
          {id: 'image_src', title: 'Product image URL'},
          {id: 'image_position', title: 'Image position'}
        ]
      });

      // Varyant kontrolü yaparak ana ürün kaydını oluştur
      const hasSizes = product.variants.sizes && product.variants.sizes.length > 0;
      const hasColors = product.variants.colors && product.variants.colors.length > 0;

      // HTML formatında ürün detayları oluştur
      let htmlDescription = `<p>${product.description}</p>`;

      // Ürün özelliklerini ekle
      if (Object.keys(product.attributes).length > 0) {
        htmlDescription += '<h3>Ürün Özellikleri</h3><ul>';
        for (const [key, value] of Object.entries(product.attributes)) {
          htmlDescription += `<li><strong>${key}:</strong> ${value}</li>`;
        }
        htmlDescription += '</ul>';
      }

      const records = [];

      // Ana ürün ve görselleri
      product.images.forEach((image: string, index: number) => {
        records.push({
          handle: product.title.toLowerCase().replace(/\s+/g, '-'),
          title: product.title,
          body: htmlDescription,
          vendor: 'Trendyol',
          product_category: product.categories.join(' > '),
          type: product.categories[product.categories.length - 1] || 'Giyim',
          tags: product.tags.join(', '),
          published: 'TRUE',
          status: 'active',
          option1_name: hasSizes ? 'Size' : '',
          option1_value: hasSizes ? product.variants.sizes[0] : '',
          option2_name: hasColors ? 'Color' : '',
          option2_value: hasColors ? product.variants.colors[0] : '',
          price: product.price,
          compare_at_price: product.basePrice,
          requires_shipping: 'TRUE',
          image_src: image,
          image_position: index + 1
        });
      });

      // Tüm varyantları ayrı kayıtlar olarak ekle
      if (hasSizes && hasColors) {
        for (const size of product.variants.sizes) {
          for (const color of product.variants.colors) {
            if (size === product.variants.sizes[0] && color === product.variants.colors[0]) {
              continue; // Ana ürün kaydını tekrar ekleme
            }
            records.push({
              handle: product.title.toLowerCase().replace(/\s+/g, '-'),
              title: product.title,
              body: htmlDescription,
              vendor: 'Trendyol',
              product_category: product.categories.join(' > '),
              type: product.categories[product.categories.length - 1] || 'Giyim',
              tags: product.tags.join(', '),
              published: 'TRUE',
              status: 'active',
              option1_name: 'Size',
              option1_value: size,
              option2_name: 'Color',
              option2_value: color,
              price: product.price,
              compare_at_price: product.basePrice,
              requires_shipping: 'TRUE',
              image_src: product.images[0] || '',
              image_position: 1
            });
          }
        }
      }

      await csvWriter.writeRecords(records);

      res.download('products.csv');

    } catch (error) {
      if (error instanceof Error) {
        res.status(500).json({ message: error.message });
      } else {
        res.status(500).json({ message: 'Bilinmeyen bir hata oluştu' });
      }
    }
  });

  return httpServer;
}