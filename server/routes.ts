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

      const title = $("h1.pr-new-br").text().trim();
      const description = $("div.detail-border-container").text().trim();
      const price = parseFloat($("span.prc-dsc").text().replace("TL", "").trim());

      const images = $("div.gallery-modal-content img")
        .map((_, img) => $(img).attr("src"))
        .get()
        .filter(Boolean);

      const variants = {
        sizes: $("div.sp-itm")
          .map((_, el) => $(el).text().trim())
          .get(),
        colors: $("div.slc-txt")
          .map((_, el) => $(el).text().trim())
          .get()
      };

      const product: InsertProduct = {
        url,
        title,
        description,
        price,
        images,
        variants
      };

      const saved = await storage.saveProduct(product);
      res.json(saved);

    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({ message: "Invalid URL format" });
      } else {
        res.status(500).json({ message: error.message });
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
          {id: 'type', title: 'Type'},
          {id: 'price', title: 'Price'},
          {id: 'option1_name', title: 'Option1 Name'},
          {id: 'option1_value', title: 'Option1 Value'},
          {id: 'option2_name', title: 'Option2 Name'},
          {id: 'option2_value', title: 'Option2 Value'},
          {id: 'image_src', title: 'Image Src'}
        ]
      });

      const records = [];

      // Varyant kontrolü yaparak ana ürün kaydını oluştur
      const hasSizes = product.variants.sizes && product.variants.sizes.length > 0;
      const hasColors = product.variants.colors && product.variants.colors.length > 0;

      records.push({
        handle: product.title.toLowerCase().replace(/\s+/g, '-'),
        title: product.title,
        body: product.description,
        vendor: 'Trendyol',
        type: 'Clothing',
        price: product.price,
        option1_name: hasSizes ? 'Size' : '',
        option1_value: hasSizes ? product.variants.sizes[0] : '',
        option2_name: hasColors ? 'Color' : '',
        option2_value: hasColors ? product.variants.colors[0] : '',
        image_src: product.images[0] || ''
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
              body: product.description,
              vendor: 'Trendyol',
              type: 'Clothing',
              price: product.price,
              option1_name: 'Size',
              option1_value: size,
              option2_name: 'Color',
              option2_value: color,
              image_src: product.images[0] || ''
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