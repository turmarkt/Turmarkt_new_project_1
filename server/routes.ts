// Firefox binary path'ini belirle
process.env.FIREFOX_BIN = '/nix/store/firefox-esr/bin/firefox-esr';

import type { Express } from "express";
import { createServer } from "http";
import { storage } from "./storage";
import * as cheerio from "cheerio";
import { urlSchema, type InsertProduct } from "@shared/schema";
import { TrendyolScrapingError, ProductDataError, handleError } from "./errors";
import { createObjectCsvWriter } from "csv-writer";
import { Builder, By, until } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox';

// Debug loglama
function debug(message: string, data?: any) {
  console.log(`[DEBUG] ${message}`, data ? JSON.stringify(data, null, 2) : '');
}

// Fiyat temizleme yardımcı fonksiyonu
function cleanPrice(price: string): number {
  return parseFloat(price.replace(/[^\d,]/g, '').replace(',', '.'));
}

// Kategori yolu işleme fonksiyonu
function processCategories($: cheerio.CheerioAPI): string[] {
  const categories: string[] = [];

  // Breadcrumb kategorilerini çek
  $('.breadcrumb-wrapper a, .breadcrumb-wrapper span').each((_, el) => {
    const category = $(el).text().trim();
    // Sadece anlamlı kategori isimlerini al ('>' gibi ayraçları atlayarak)
    if (category && !category.includes('>') && category !== '') {
      categories.push(category);
    }
  });

  debug("Çekilen kategori yolu:", categories);

  // Eğer kategori bulunamadıysa varsayılan kategori yapısını kullan
  if (categories.length === 0) {
    return ['Trendyol', 'Giyim'];
  }

  return categories;
}

// Selenium ile veri çekme fonksiyonu
async function fetchProductPage(url: string): Promise<cheerio.CheerioAPI> {
  let driver;
  try {
    const options = new firefox.Options();
    options.addArguments('--headless');
    options.setBinary(process.env.FIREFOX_BIN);

    driver = await new Builder()
      .forBrowser('firefox')
      .setFirefoxOptions(options)
      .build();

    await driver.get(url);

    // Sayfa yüklenene kadar bekle
    await driver.wait(until.elementLocated(By.css('.product-price-container')), 15000);

    // Fiyat elementinin görünür olmasını bekle
    await driver.wait(until.elementLocated(By.css('.prc-box-dscntd, .prc-box-sllng')), 15000);

    const html = await driver.getPageSource();
    debug("HTML içeriği başarıyla alındı, uzunluk:", html.length);
    return cheerio.load(html);

  } catch (error: any) {
    debug("Veri çekme hatası:", error);
    throw new TrendyolScrapingError("Sayfa yüklenemedi", {
      status: 500,
      statusText: "Fetch Error",
      details: error.message
    });
  } finally {
    if (driver) {
      await driver.quit();
    }
  }
}

// Ana scraping fonksiyonu
async function scrapeProduct(url: string): Promise<InsertProduct> {
  debug("Scraping başlatıldı:", url);

  try {
    const $ = await fetchProductPage(url);

    // Temel ürün bilgilerini çek
    const title = $('.pr-new-br span').first().text().trim() || $('.prdct-desc-cntnr-ttl').first().text().trim();
    if (!title) {
      throw new ProductDataError("Ürün başlığı bulunamadı", "title");
    }

    // Fiyat bilgilerini çek
    const priceSelector = '.product-price-container .prc-box-dscntd, .product-price-container .prc-box-sllng';
    const rawPrice = $(priceSelector).first().text().trim();

    if (!rawPrice) {
      throw new ProductDataError("Ürün fiyatı bulunamadı", "price");
    }

    const basePrice = cleanPrice(rawPrice);
    const price = (basePrice * 1.15).toFixed(2); // %15 kar ekle

    debug("Fiyat hesaplandı:", { basePrice, calculatedPrice: price });

    // Açıklama
    const description = $('.product-description-text').text().trim();

    // Görselleri çek
    const images: string[] = [];
    $('.gallery-modal-content img, .product-img img').each((_, img) => {
      const src = $(img).attr('src');
      if (src && !images.includes(src)) {
        images.push(src);
      }
    });

    // Video URL'sini çek
    let videoUrl = null;
    const videoElement = $('.gallery-modal-content video source');
    if (videoElement.length > 0) {
      videoUrl = videoElement.attr('src') || null;
    }

    // Kategorileri çek
    const categories = processCategories($);

    // Varyantları çek
    const variants = {
      sizes: [] as string[],
      colors: [] as string[]
    };

    // Bedenleri çek
    $('.variant-list-item:not(.disabled), .sp-itm:not(.so)').each((_, el) => {
      const size = $(el).text().trim();
      if (size && !variants.sizes.includes(size)) {
        variants.sizes.push(size);
      }
    });

    // Renkleri çek
    $('.color-list li span, .slc-txt').each((_, el) => {
      const color = $(el).text().trim();
      if (color && !variants.colors.includes(color)) {
        variants.colors.push(color);
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

    // Ürün nesnesi oluştur
    const product: InsertProduct = {
      url,
      title,
      description,
      price: price.toString(),
      basePrice: basePrice.toString(),
      images,
      video: videoUrl,
      variants,
      attributes,
      categories: categories.length > 0 ? categories : ['Trendyol', 'Giyim'],
      tags: [...categories, ...variants.colors, ...variants.sizes].filter(Boolean)
    };

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

  return httpServer;
}