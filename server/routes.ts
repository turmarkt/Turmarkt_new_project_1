import { ProductAttribute } from "@shared/schema";
import type { Express } from "express";
import { createServer } from "http";
import { storage } from "./storage";
import * as cheerio from "cheerio";
import { urlSchema, type InsertProduct } from "@shared/schema";
import { TrendyolScrapingError, ProductDataError, handleError } from "./errors";
import fetch from "node-fetch";

// Firefox binary path'ini belirle
process.env.FIREFOX_BIN = '/nix/store/firefox-esr/bin/firefox-esr';

// Debug loglama
function debug(message: string) {
  console.log(`[DEBUG] ${message}`);
}

// Fiyat temizleme yardımcı fonksiyonu
function cleanPrice(price: string): number {
  return parseFloat(price.replace(/[^\d,]/g, '').replace(',', '.'));
}

async function fetchProductPage(url: string): Promise<cheerio.CheerioAPI> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const html = await response.text();
    debug("HTML içeriği başarıyla alındı");
    return cheerio.load(html);

  } catch (error: any) {
    debug("Veri çekme hatası");
    throw new TrendyolScrapingError("Sayfa yüklenemedi", {
      status: 500,
      statusText: "Fetch Error",
      details: error.message
    });
  }
}

// Açıklamaları çek fonksiyonu
function extractDescription($: cheerio.CheerioAPI): string {
  const descriptions: string[] = [];

  // Ana ürün açıklaması
  const mainDesc = $('.product-description-text').text().trim() ||
                  $('.detail-desc-content').text().trim() ||
                  $('.description-text').text().trim();
  if (mainDesc) {
    descriptions.push(mainDesc);
  }

  // Marka açıklaması
  const brandDesc = $('.brand-description').text().trim();
  if (brandDesc) {
    descriptions.push(brandDesc);
  }

  // Detaylı açıklama
  const detailDesc = $('.detail-description').text().trim();
  if (detailDesc) {
    descriptions.push(detailDesc);
  }

  return descriptions.join('\n\n').trim();
}

async function scrapeProduct(url: string): Promise<InsertProduct> {
  debug("Scraping başlatıldı");

  try {
    const $ = await fetchProductPage(url);

    // Temel ürün bilgilerini çek
    const title = $('.pr-new-br span').first().text().trim() || $('.prdct-desc-cntnr-ttl').first().text().trim();
    if (!title) {
      throw new ProductDataError("Ürün başlığı bulunamadı", "title");
    }

    // Fiyat çek
    const priceSelectors = [
      '.prc-box-dscntd',
      '.prc-box-sllng',
      '.product-price-container .prc-dsc',
      '.product-price-container .prc',
      '.featured-prices .prc-dsc',
      '.featured-prices span',
      '.pr-bx-pr-dsc',
      '.pr-bx-pr-sv',
      '.prc-dsc'
    ];

    let rawPrice = '';
    for (const selector of priceSelectors) {
      const priceElement = $(selector).first();
      if (priceElement.length > 0) {
        rawPrice = priceElement.text().trim();
        if (rawPrice) break;
      }
    }

    if (!rawPrice) {
      throw new ProductDataError("Ürün fiyatı bulunamadı", "price");
    }

    const basePrice = cleanPrice(rawPrice);
    const price = (basePrice * 1.15).toFixed(2); // %15 kar ekle

    // Görselleri çek
    const images: Set<string> = new Set();

    // Ürün görsellerini çek
    $('.gallery-modal-content img').each((_, img) => {
      const src = $(img).attr('src');
      if (src) images.add(src);
    });

    // Varyantları çek
    const variants = {
      sizes: [] as string[],
      colors: []
    };

    // Bedenleri çek
    $('.variant-list-item:not(.disabled), .sp-itm:not(.so), .size-variant-wrapper:not(.disabled)').each((_, el) => {
      const size = $(el).text().trim();
      if (size && !variants.sizes.includes(size)) {
        variants.sizes.push(size);
      }
    });

    // Kategorileri çek
    const categories: string[] = [];
    $('.breadcrumb-wrapper a, .breadcrumb-wrapper span').each((_, el) => {
      const category = $(el).text().trim();
      if (category && !category.includes('>') && category !== '') {
        categories.push(category);
      }
    });

    // Video URL'sini çek
    let videoUrl = null;
    const videoElement = $('.gallery-modal-content video source').first();
    if (videoElement.length > 0) {
      videoUrl = videoElement.attr('src') || null;
    }

    // Açıklamayı çek
    const description = extractDescription($);

    // Ürün nesnesi oluştur - Sadece ProductAttribute değerlerini kullan
    const product: InsertProduct = {
      url,
      title,
      description,
      price: price.toString(),
      basePrice: basePrice.toString(),
      images: Array.from(images),
      video: videoUrl,
      variants,
      attributes: {
        Hacim: ProductAttribute.Hacim,
        Mensei: ProductAttribute.Mensei,
        "Paket İçeriği": ProductAttribute.PaketIcerigi
      },
      categories: categories.length > 0 ? categories : ['Trendyol'],
      tags: [...categories, ...variants.colors, ...variants.sizes].filter(Boolean)
    };

    debug("Ürün oluşturuldu");
    return product;

  } catch (error: any) {
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
      debug("Scrape isteği alındı");
      const { url } = urlSchema.parse(req.body);

      // Cache kontrolü
      const existing = await storage.getProduct(url);
      if (existing) {
        debug("Ürün cache'den alındı");
        return res.json(existing);
      }

      debug("Ürün verileri çekiliyor");
      const product = await scrapeProduct(url);
      debug("Ürün başarıyla çekildi, kaydediliyor");
      const saved = await storage.saveProduct(product);

      res.json(saved);

    } catch (error) {
      debug("API hatası");
      const { status, message, details } = handleError(error);
      res.status(status).json({ message, details });
    }
  });

  return httpServer;
}