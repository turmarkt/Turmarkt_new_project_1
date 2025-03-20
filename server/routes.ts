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
// Script içeriğinden JSON benzeri verileri çıkar
function extractJSONFromScript(content: string): string[] {
  const images: string[] = [];

  try {
    // window.__PRODUCT_DETAIL_APP_INITIAL_STATE__ kontrolü
    const initialStateMatch = content.match(/window\.__PRODUCT_DETAIL_APP_INITIAL_STATE__\s*=\s*({.*?});/s);
    if (initialStateMatch) {
      const data = JSON.parse(initialStateMatch[1]);
      if (data?.product?.images) {
        debug("PRODUCT_DETAIL_APP_INITIAL_STATE görsel sayısı:", data.product.images.length);
        images.push(...data.product.images);
      }
    }

    // productDetailModel kontrolü
    const modelMatch = content.match(/window\.productDetailModel\s*=\s*({.*?});/s);
    if (modelMatch) {
      const data = JSON.parse(modelMatch[1]);
      if (data?.images) {
        debug("productDetailModel görsel sayısı:", data.images.length);
        images.push(...data.images);
      }
      if (data?.productImages) {
        debug("productDetailModel.productImages görsel sayısı:", data.productImages.length);
        images.push(...data.productImages);
      }
    }

    // TYPageName.product kontrolü
    const pageMatch = content.match(/TYPageName\.product\s*=\s*({.*?});/s);
    if (pageMatch) {
      const data = JSON.parse(pageMatch[1]);
      if (data?.images) {
        debug("TYPageName.product görsel sayısı:", data.images.length);
        images.push(...data.images);
      }
    }

    // productImages array kontrolü
    const imagesMatch = content.match(/var\s+productImages\s*=\s*(\[.*?\])/s);
    if (imagesMatch) {
      const data = JSON.parse(imagesMatch[1]);
      if (Array.isArray(data)) {
        debug("productImages görsel sayısı:", data.length);
        images.push(...data);
      }
    }

    debug("Toplam bulunan script görselleri:", images.length);
  } catch (error) {
    debug("Script parse hatası:", error);
  }

  return images.filter(img => img && typeof img === 'string');
}

// Görsel URL'sini yüksek çözünürlüklü hale getir
function getHighResImageUrl(url: string): string {
  if (!url) return '';

  try {
    // URL'yi düzelt
    let imageUrl = url;
    if (!imageUrl.startsWith('http')) {
      imageUrl = `https://cdn.dsmcdn.com${imageUrl}`;
    }

    // Debug için orijinal ve düzeltilmiş URL'yi göster
    debug(`Orijinal URL: ${url}`);
    debug(`Düzeltilmiş URL: ${imageUrl}`);

    // Tüm boyut dönüşümlerini uygula
    imageUrl = imageUrl
      .replace(/\/mnresize\/128\/192\//, '/mnresize/1200/1800/')
      .replace(/\/mnresize\/256\/384\//, '/mnresize/1200/1800/')
      .replace(/\/mnresize\/500\/750\//, '/mnresize/1200/1800/')
      .replace(/\/mnresize\/600\/900\//, '/mnresize/1200/1800/')
      .replace(/\/mnresize\/800\/1200\//, '/mnresize/1200/1800/');

    // Son URL'yi debug için göster
    debug(`Son URL: ${imageUrl}`);

    return imageUrl;
  } catch (error) {
    debug("URL dönüştürme hatası:", error);
    return url;
  }
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
      const scriptImages = extractJSONFromScript(scriptContent);
      scriptImages.forEach(img => {
        if (typeof img === 'string') {
          images.add(getHighResImageUrl(img));
        }
      });
    });

    // Data özelliklerinden görselleri çek
    const dataSelectors = [
      '[data-gallery-images]',
      '[data-images]',
      '[data-product-images]',
      '[data-gallery-list]',
      '[data-media-gallery]'
    ];

    dataSelectors.forEach(selector => {
      const elements = $(selector);
      elements.each((_, element) => {
        const data = $(element).attr('data-gallery-images') ||
                    $(element).attr('data-images') ||
                    $(element).attr('data-product-images') ||
                    $(element).attr('data-gallery-list') ||
                    $(element).attr('data-media-gallery');

        if (data) {
          try {
            const parsedData = JSON.parse(data);
            if (Array.isArray(parsedData)) {
              parsedData.forEach(img => {
                if (typeof img === 'string') {
                  images.add(getHighResImageUrl(img));
                }
              });
            }
          } catch (error) {
            debug(`Data özelliği parse hatası (${selector}):`, error);
          }
        }
      });
    });

    // DOM'dan görselleri çek
    const imageSelectors = [
      '.gallery-modal-content img',
      '.product-img img',
      '.image-container img',
      '.product-slide img',
      '.slick-slide img',
      '.product-stamp img',
      '.gallery-modal img',
      '[data-src*="ty"]',
      '[data-original*="ty"]',
      'picture source[srcset*="ty"]',
      '.swiper-slide img'
    ];

    imageSelectors.forEach(selector => {
      $(selector).each((_, element) => {
        const sources = [
          $(element).attr('src'),
          $(element).attr('data-src'),
          $(element).attr('data-original'),
          $(element).attr('srcset')
        ].filter(Boolean);

        sources.forEach(src => {
          if (src) {
            const urls = src.split(',')
              .map(s => s.trim().split(' ')[0])
              .filter(url => url.includes('ty'));

            urls.forEach(url => images.add(getHighResImageUrl(url)));
          }
        });
      });
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

    // Ürün detaylarını çek
    $('.detail-attr-item').each((_, item) => {
      const label = $(item).find('.attr-label').text().trim();
      const value = $(item).find('.attr-value').text().trim();
      if (label && value) {
        attributes[label] = value;
        debug(`Detay özellik eklendi: ${label} = ${value}`);
      }
    });

    // Özellik listesini çek
    $('.feature-list li').each((_, item) => {
      const text = $(item).text().trim();
      const [label, value] = text.split(':').map(s => s.trim());
      if (label && value) {
        attributes[label] = value;
        debug(`Liste özellik eklendi: ${label} = ${value}`);
      }
    });

    debug("Toplam özellik sayısı:", Object.keys(attributes).length);

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

    // Açıklama içeriğini çek
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