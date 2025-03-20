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
    debug("HTML içeriği başarıyla alındı, uzunluk:", html.length);
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

    // Tüm olası fiyat seçicileri
    const priceSelectors = [
      '.prc-box-dscntd',
      '.prc-box-sllng',
      '.product-price-container .prc-dsc',
      '.product-price-container .prc',
      '.pr-bx-pr-dsc',
      '.pr-bx-pr-sv'
    ];

    // Fiyat bilgilerini çek
    let rawPrice = '';
    for (const selector of priceSelectors) {
      const priceElement = $(selector).first();
      if (priceElement.length > 0) {
        rawPrice = priceElement.text().trim();
        debug(`Fiyat bulundu (${selector}):`, rawPrice);
        break;
      }
    }

    if (!rawPrice) {
      debug("Fiyat elementleri bulunamadı. DOM yapısı:", $('.product-price-container').html());
      throw new ProductDataError("Ürün fiyatı bulunamadı", "price");
    }

    const basePrice = cleanPrice(rawPrice);
    const price = (basePrice * 1.15).toFixed(2); // %15 kar ekle

    debug("Fiyat hesaplandı:", { basePrice, calculatedPrice: price });

    // Görselleri çek
    const images: string[] = [];

    // Ana ürün görsellerini çek
    $('.gallery-modal-content [data-original], .product-slide img').each((_, element) => {
      let src = $(element).attr('data-original') || $(element).attr('src');
      if (src) {
        // URL'yi düzelt
        if (!src.startsWith('http')) {
          src = `https:${src}`;
        }
        if (!images.includes(src)) {
          images.push(src);
          debug(`Ana görsel eklendi: ${src}`);
        }
      }
    });

    // Lazy-loaded görselleri çek
    $('[data-src*="ty"], [data-original*="ty"]').each((_, element) => {
      let src = $(element).attr('data-src') || $(element).attr('data-original');
      if (src) {
        if (!src.startsWith('http')) {
          src = `https:${src}`;
        }
        if (!images.includes(src)) {
          images.push(src);
          debug(`Lazy-loaded görsel eklendi: ${src}`);
        }
      }
    });

    // data-gallery-images özelliğini kontrol et
    const galleryDataElements = $('[data-gallery-images]');
    galleryDataElements.each((_, element) => {
      const galleryData = $(element).attr('data-gallery-images');
      if (galleryData) {
        try {
          const galleryImages = JSON.parse(galleryData);
          if (Array.isArray(galleryImages)) {
            galleryImages.forEach(img => {
              if (typeof img === 'string') {
                let imgUrl = img;
                if (!imgUrl.startsWith('http')) {
                  imgUrl = `https:${imgUrl}`;
                }
                if (!images.includes(imgUrl)) {
                  images.push(imgUrl);
                  debug(`Gallery JSON'dan görsel eklendi: ${imgUrl}`);
                }
              }
            });
          }
        } catch (error) {
          debug("Gallery JSON parse hatası:", error);
        }
      }
    });

    // Yedek görsel toplama stratejisi
    $('img[src*="ty"], .product-img img, .image-container img').each((_, element) => {
      let src = $(element).attr('src');
      if (src) {
        if (!src.startsWith('http')) {
          src = `https:${src}`;
        }
        if (!images.includes(src)) {
          images.push(src);
          debug(`Yedek görsel eklendi: ${src}`);
        }
      }
    });

    debug(`Toplam ${images.length} görsel bulundu:`, images);

    // Video URL'sini çek
    let videoUrl = null;
    const videoElement = $('.gallery-modal-content video source');
    if (videoElement.length > 0) {
      videoUrl = videoElement.attr('src') || null;
    }

    // Açıklama ve özellikleri çek
    let description = '';
    const descriptionSelectors = [
      '.product-description-text',
      '.detail-desc-content',
      '.description-text',
      '.prdct-desc-cntnr-description'
    ];

    for (const selector of descriptionSelectors) {
      const descElement = $(selector);
      if (descElement.length > 0) {
        const text = descElement.text().trim();
        if (text) {
          description = text;
          break;
        }
      }
    }

    // Özellikleri çek
    const attributes: Record<string, string> = {};

    // Ana özellik tablosunu çek
    $('.detail-attr-container tr, .product-feature-details tr, .detail-border tr').each((_, row) => {
      const label = $(row).find('th, .featured-title').text().trim();
      const value = $(row).find('td, .featured-desc').text().trim();
      if (label && value) {
        attributes[label] = value;
        debug(`Özellik eklendi: ${label} = ${value}`);
      }
    });

    // Ek özellikleri çek
    $('.product-information-list li, .detail-list li').each((_, item) => {
      const label = $(item).find('.title, .list-title').text().trim();
      const value = $(item).find('.value, .list-content').text().trim();
      if (label && value) {
        attributes[label] = value;
        debug(`Ek özellik eklendi: ${label} = ${value}`);
      }
    });

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
        debug(`Beden eklendi: ${size}`);
      }
    });

    // Renkleri çek
    $('.color-list li span, .slc-txt').each((_, el) => {
      const color = $(el).text().trim();
      if (color && !variants.colors.includes(color)) {
        variants.colors.push(color);
        debug(`Renk eklendi: ${color}`);
      }
    });

    // Kategorileri çek
    const categories: string[] = [];
    $('.breadcrumb-wrapper a, .breadcrumb-wrapper span').each((_, el) => {
      const category = $(el).text().trim();
      if (category && !category.includes('>') && category !== '') {
        categories.push(category);
        debug(`Kategori eklendi: ${category}`);
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