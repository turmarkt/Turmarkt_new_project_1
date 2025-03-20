// Firefox binary path'ini belirle
process.env.FIREFOX_BIN = '/nix/store/firefox-esr/bin/firefox-esr';

import type { Express } from "express";
import { createServer } from "http";
import { storage } from "./storage";
import * as cheerio from "cheerio";
import { urlSchema, type InsertProduct } from "@shared/schema";
import { TrendyolScrapingError, ProductDataError, handleError } from "./errors";
import { createObjectCsvWriter } from "csv-writer";
import fetch from "node-fetch";


// Debug loglama
function debug(message: string, data?: any) {
  console.log(`[DEBUG] ${message}`, data ? JSON.stringify(data, null, 2) : '');
}

// Fiyat temizleme yardımcı fonksiyonu
function cleanPrice(price: string): number {
  return parseFloat(price.replace(/[^\d,]/g, '').replace(',', '.'));
}

// Temel veri çekme fonksiyonu
async function fetchProductPage(url: string): Promise<cheerio.CheerioAPI> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const html = await response.text();
    return cheerio.load(html);
  } catch (error: any) {
    debug("Veri çekme hatası:", error);
    throw new TrendyolScrapingError("Sayfa yüklenemedi", {
      status: 500,
      statusText: "Fetch Error",
      details: error.message
    });
  }
}

// Ana veri çekme ve işleme fonksiyonu
async function scrapeProduct(url: string): Promise<InsertProduct> {
  debug("Scraping başlatıldı:", url);

  try {
    const $ = await fetchProductPage(url);

    // Schema.org verisini çek
    const schemaScript = $('script[type="application/ld+json"]').first().html();
    if (!schemaScript) {
      throw new ProductDataError("Ürün şeması bulunamadı", "schema");
    }

    const schema = JSON.parse(schemaScript);
    debug("Schema verisi bulundu:", schema);

    // Fiyat bilgisini al ve %15 kar ekle
    const basePrice = parseFloat(schema.offers?.price || "0");
    if (!basePrice) {
      throw new ProductDataError("Ürün fiyatı bulunamadı", "price");
    }

    const price = (basePrice * 1.15).toFixed(2); // %15 kar ekle
    debug("Fiyat hesaplandı:", { basePrice, calculatedPrice: price });

    // Ürün nesnesi oluştur
    const product: InsertProduct = {
      url,
      title: schema.name,
      description: schema.description || "",
      price: price.toString(),
      basePrice: basePrice.toString(),
      images: schema.image?.contentUrl || [],
      variants: {
        sizes: [],
        colors: []
      },
      attributes: {},
      categories: ['Giyim'],
      tags: []
    };

    // Varyantları çek (renkler ve bedenler)
    if (schema.hasVariant) {
      schema.hasVariant.forEach((variant: any) => {
        if (variant.size && !product.variants.sizes.includes(variant.size)) {
          product.variants.sizes.push(variant.size);
        }
        if (variant.color && !product.variants.colors.includes(variant.color)) {
          product.variants.colors.push(variant.color);
        }
      });
    }

    // Özellikleri çek
    if (schema.additionalProperty) {
      schema.additionalProperty.forEach((prop: any) => {
        if (prop.name && prop.unitText) {
          product.attributes[prop.name] = prop.unitText;
        }
      });
    }

    // Etiketleri oluştur
    product.tags = [
      ...product.categories,
      ...product.variants.colors,
      ...product.variants.sizes
    ].filter(Boolean);

    debug("Ürün verisi oluşturuldu:", product);
    return product;

  } catch (error: any) {
    debug("Scraping hatası:", error);
    if (error instanceof ProductDataError) {
      throw error;
    }
    throw new TrendyolScrapingError("Ürün verisi işlenirken hata oluştu", {
      status: 500,
      statusText: "Processing Error",
      details: error.message
    });
  }
}

// Ana route'lar
export async function registerRoutes(app: Express) {
  const httpServer = createServer(app);

  // Scraping endpoint'i
  app.post("/api/scrape", async (req, res) => {
    try {
      debug("Scrape isteği alındı:", req.body);
      const { url } = urlSchema.parse(req.body);

      // Cache kontrolü
      const existing = await storage.getProduct(url);
      if (existing) {
        debug("Ürün cache'den alındı:", existing.id);
        return res.json(existing);
      }

      debug("Ürün verileri çekiliyor:", url);
      const product = await scrapeProduct(url);
      debug("Ürün başarıyla çekildi, kaydediliyor");
      const saved = await storage.saveProduct(product);
      debug("Ürün kaydedildi:", saved.id);

      res.json(saved);

    } catch (error) {
      debug("API hatası:", error);
      const { status, message, details } = handleError(error);
      res.status(status).json({ message, details });
    }
  });

  // Export endpoint'i
  app.post("/api/export", async (req, res) => {
    try {
      const { product } = req.body;
      if (!product) {
        throw new ProductDataError("Ürün verisi bulunamadı", "export");
      }

      const csvWriter = createObjectCsvWriter({
        path: 'products.csv',
        header: [
          { id: 'Title', title: 'Title' },
          { id: 'Handle', title: 'Handle' },
          { id: 'Price', title: 'Price' },
          { id: 'Image Src', title: 'Image Src' },
          { id: 'Body', title: 'Body (HTML)' },
          { id: 'Tags', title: 'Tags' }
        ]
      });

      await csvWriter.writeRecords([{
        Title: product.title,
        Handle: product.title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        Price: product.price,
        'Image Src': product.images[0] || '',
        Body: product.description,
        Tags: product.tags.join(',')
      }]);

      res.download('products.csv');

    } catch (error) {
      debug("CSV export hatası:", error);
      const { status, message, details } = handleError(error);
      res.status(status).json({ message, details });
    }
  });

  return httpServer;
}