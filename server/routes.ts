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

// Görsel işleme ve çekme fonksiyonları
function getHighResImageUrl(url: string): string {
  if (!url) return '';

  // URL'yi düzelt
  let imageUrl = url.startsWith('http') ? url : `https:${url}`;

  // Boyut parametrelerini ekle
  imageUrl = imageUrl.replace(/\/mnresize\/\d+\/\d+\//, '/mnresize/1200/1800/');

  return imageUrl;
}

// Script içeriğinden JSON benzeri verileri çıkar
function extractJSONFromScript(content: string, pattern: RegExp): any {
  try {
    const match = content.match(pattern);
    if (match && match[1]) {
      return JSON.parse(match[1].replace(/\\'/g, "'"));
    }
  } catch (error) {
    debug("JSON parse hatası:", error);
  }
  return null;
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
        debug(`Fiyat bulundu (${selector}):`, rawPrice);
        if (rawPrice) break;
      }
    }

    if (!rawPrice) {
      throw new ProductDataError("Ürün fiyatı bulunamadı", "price");
    }

    const basePrice = cleanPrice(rawPrice);
    const price = (basePrice * 1.15).toFixed(2); // %15 kar ekle

    debug("Fiyat hesaplandı:", { rawPrice, basePrice, calculatedPrice: price });

    // Görselleri çek
    const images: Set<string> = new Set();

    // Script kaynaklarından görselleri çek
    $('script').each((_, element) => {
      const scriptContent = $(element).html() || '';

      // productDetailModel'den görselleri çek
      if (scriptContent.includes('productDetailModel')) {
        const data = extractJSONFromScript(scriptContent, /window\.productDetailModel\s*=\s*({.*?});/s);
        if (data?.images) {
          data.images.forEach((img: string) => {
            if (typeof img === 'string') {
              images.add(getHighResImageUrl(img));
            }
          });
        }
      }

      // TYPageName.product'dan görselleri çek
      if (scriptContent.includes('TYPageName.product')) {
        const data = extractJSONFromScript(scriptContent, /TYPageName\.product\s*=\s*({.*?});/s);
        if (data?.images) {
          data.images.forEach((img: string) => {
            if (typeof img === 'string') {
              images.add(getHighResImageUrl(img));
            }
          });
        }
      }

      // productImages değişkeninden görselleri çek
      if (scriptContent.includes('productImages')) {
        const data = extractJSONFromScript(scriptContent, /var\s+productImages\s*=\s*(\[.*?\])/s);
        if (Array.isArray(data)) {
          data.forEach((img: string) => {
            if (typeof img === 'string') {
              images.add(getHighResImageUrl(img));
            }
          });
        }
      }

      // productDetail.images'dan görselleri çek
      if (scriptContent.includes('productDetail')) {
        const data = extractJSONFromScript(scriptContent, /var\s+productDetail\s*=\s*({.*?});/s);
        if (data?.images) {
          data.images.forEach((img: string) => {
            if (typeof img === 'string') {
              images.add(getHighResImageUrl(img));
            }
          });
        }
      }
    });

    // DOM'dan görselleri çek
    const imageSelectors = [
      '.gallery-modal-content img',
      '.product-img img',
      '.image-container img',
      '.product-slide img',
      '.slick-slide img',
      '[data-src*="ty"]',
      '[data-original*="ty"]',
      'picture source[srcset*="ty"]'
    ];

    imageSelectors.forEach(selector => {
      $(selector).each((_, element) => {
        const src = $(element).attr('src') || 
                   $(element).attr('data-src') || 
                   $(element).attr('data-original') ||
                   $(element).attr('srcset');

        if (src) {
          // Srcset içindeki tüm URL'leri işle
          const urls = src.split(',').map(s => s.trim().split(' ')[0]);
          urls.forEach(url => {
            if (url.includes('ty')) {
              images.add(getHighResImageUrl(url));
            }
          });
        }
      });
    });

    // data-gallery-images özelliğinden görselleri çek
    const galleryElements = [
      '[data-gallery-images]',
      '[data-images]',
      '[data-product-images]'
    ];

    galleryElements.forEach(selector => {
      const element = $(selector).first();
      const data = element.attr('data-gallery-images') || 
                  element.attr('data-images') || 
                  element.attr('data-product-images');

      if (data) {
        try {
          const galleryImages = JSON.parse(data);
          if (Array.isArray(galleryImages)) {
            galleryImages.forEach(img => {
              if (typeof img === 'string') {
                images.add(getHighResImageUrl(img));
              }
            });
          }
        } catch (error) {
          debug(`Gallery data parse hatası (${selector}):`, error);
        }
      }
    });

    debug(`Toplam ${images.size} benzersiz görsel bulundu`);

    // Varyantları çek
    const variants = {
      sizes: [] as string[],
      colors: [] as string[]
    };

    // Bedenleri çek
    $('.variant-list-item:not(.disabled), .sp-itm:not(.so), .size-variant-wrapper:not(.disabled)').each((_, el) => {
      const size = $(el).text().trim();
      if (size && !variants.sizes.includes(size)) {
        variants.sizes.push(size);
        debug(`Beden eklendi: ${size}`);
      }
    });

    // Renkleri çek
    $('.color-list li span, .slc-txt, .color-variant-wrapper').each((_, el) => {
      const color = $(el).text().trim();
      if (color && !variants.colors.includes(color)) {
        variants.colors.push(color);
        debug(`Renk eklendi: ${color}`);
      }
    });

    // Özellikleri çek
    const attributes: Record<string, string> = {};

    // Tüm özellik tablolarını tara
    $('.detail-attr-container tr, .product-feature-details tr, .detail-border tr').each((_, row) => {
      const label = $(row).find('th, .featured-title').text().trim();
      const value = $(row).find('td, .featured-desc').text().trim();
      if (label && value) {
        attributes[label] = value;
        debug(`Özellik eklendi: ${label} = ${value}`);
      }
    });

    // Ek özellikleri çek
    $('.product-information-list li').each((_, item) => {
      const label = $(item).find('.title').text().trim();
      const value = $(item).find('.value').text().trim();
      if (label && value) {
        attributes[label] = value;
        debug(`Ek özellik eklendi: ${label} = ${value}`);
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

    // Video URL'sini çek
    let videoUrl = null;
    const videoElement = $('.gallery-modal-content video source').first();
    if (videoElement.length > 0) {
      videoUrl = videoElement.attr('src') || null;
    }

    // Ürün açıklamasını çek
    const description = $('.product-description-text').text().trim() || 
                       $('.detail-desc-content').text().trim() || 
                       $('.description-text').text().trim();

    // Ürün nesnesi oluştur
    const product: InsertProduct = {
      url,
      title,
      description: description || '',
      price: price.toString(),
      basePrice: basePrice.toString(),
      images: Array.from(images),
      video: videoUrl,
      variants,
      attributes,
      categories: categories.length > 0 ? categories : ['Trendyol'],
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