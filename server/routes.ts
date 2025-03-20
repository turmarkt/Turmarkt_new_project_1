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

    // Temel ürün bilgilerini çek
    const title = $('.pr-new-br span').first().text().trim() || $('.prdct-desc-cntnr-ttl').first().text().trim();
    if (!title) {
      throw new ProductDataError("Ürün başlığı bulunamadı", "title");
    }

    // Fiyat bilgilerini çek ve kar oranını uygula
    let rawPrice = '';
    let rawBasePrice = '';

    // Farklı fiyat selektörlerini dene
    $('.product-price-container').find('.prc-box-dscntd, .prc-box-sllng').each((_, el) => {
      const price = $(el).text().trim();
      if (price && !rawPrice) {
        rawPrice = price;
      }
    });

    $('.product-price-container').find('.prc-box-orgnl').each((_, el) => {
      const price = $(el).text().trim();
      if (price) {
        rawBasePrice = price;
      }
    });

    // Eğer indirimli fiyat yoksa normal fiyatı kullan
    if (!rawPrice) {
      throw new ProductDataError("Ürün fiyatı bulunamadı", "price");
    }

    if (!rawBasePrice) {
      rawBasePrice = rawPrice;
    }

    debug("Ham fiyat verileri:", { rawPrice, rawBasePrice });

    // Fiyatları temizle ve hesapla
    const basePrice = cleanPrice(rawBasePrice);
    const price = (basePrice * 1.15).toFixed(2); // %15 kar ekle

    debug("Fiyat hesaplandı:", { basePrice, calculatedPrice: price });

    const description = $('.product-description-text').text().trim();

    // Görselleri çek
    const images: string[] = [];
    $('.gallery-modal-content img, .product-img img').each((_, img) => {
      const src = $(img).attr('src');
      if (src && !images.includes(src)) {
        images.push(src);
      }
    });

    // Varyantları çek
    const variants = {
      sizes: [] as string[],
      colors: [] as string[]
    };

    // Bedenleri çek
    $('.sp-itm:not(.so), .variant-list-item:not(.disabled)').each((_, size) => {
      const sizeText = $(size).text().trim();
      if (sizeText && !variants.sizes.includes(sizeText)) {
        variants.sizes.push(sizeText);
      }
    });

    // Renkleri çek
    $('.slc-txt, .color-list li span').each((_, color) => {
      const colorText = $(color).text().trim();
      if (colorText && !variants.colors.includes(colorText)) {
        variants.colors.push(colorText);
      }
    });

    // Özellikleri çek
    const attributes: Record<string, string> = {};
    $('.detail-attr-container tr, .product-feature-details tr').each((_, row) => {
      const label = $(row).find('th').text().trim();
      const value = $(row).find('td').text().trim();
      if (label && value) {
        attributes[label] = value;
      }
    });

    // Kategorileri çek
    const categories = $('.product-path span')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);

    const product: InsertProduct = {
      url,
      title,
      description,
      price: price.toString(),
      basePrice: basePrice.toString(),
      images,
      variants,
      attributes,
      categories: categories.length > 0 ? categories : ['Giyim'],
      tags: [...categories, ...variants.colors, ...variants.sizes].filter(Boolean)
    };

    debug("Ürün verisi oluşturuldu:", product);
    return product;

  } catch (error: any) {
    debug("Scraping hatası:", error);
    if (error instanceof TrendyolScrapingError || error instanceof ProductDataError) {
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