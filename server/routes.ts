// Firefox binary path'ini belirle
process.env.FIREFOX_BIN = '/nix/store/firefox-esr/bin/firefox-esr';

import type { Express } from "express";
import { createServer } from "http";
import { storage } from "./storage";
import * as cheerio from "cheerio";
import { urlSchema, type InsertProduct } from "@shared/schema";
import { TrendyolScrapingError, ProductDataError, handleError } from "./errors";
import { createObjectCsvWriter } from "csv-writer";
import axios from "axios";
import axiosRetry from "axios-retry";

// Axios retry konfigürasyonu
axiosRetry(axios, { 
  retries: 3,
  retryDelay: (retryCount) => retryCount * 1000,
  retryCondition: (error) => {
    return axiosRetry.isNetworkOrIdempotentRequestError(error) || error.response?.status === 500;
  }
});

// Debug loglama
function debug(message: string, data?: any) {
  console.log(`[DEBUG] ${message}`, data ? JSON.stringify(data, null, 2) : '');
}

// Fiyat temizleme yardımcı fonksiyonu
function cleanPrice(price: string): number {
  return parseFloat(price.replace(/[^\d,]/g, '').replace(',', '.'));
}

// Varyant işleme fonksiyonu
function processVariants(variants: any[]): { sizes: string[], colors: string[] } {
  const result = {
    sizes: [] as string[],
    colors: [] as string[]
  };

  if (Array.isArray(variants)) {
    // Tüm bedenleri topla ve düzleştir
    const allSizes = variants.reduce((sizes, variant) => {
      if (variant.size) {
        // Eğer size bir array ise düzleştir, değilse tek eleman olarak al
        const sizeArray = Array.isArray(variant.size) ? variant.size : [variant.size];
        return [...sizes, ...sizeArray];
      }
      return sizes;
    }, [] as string[]);

    // Benzersiz bedenleri filtrele
    result.sizes = [...new Set(allSizes)].sort((a, b) => {
      // Numerik sıralama yap
      const numA = parseInt(a);
      const numB = parseInt(b);
      return numA - numB;
    });

    // Renkleri ekle (tekrarsız)
    const allColors = variants.reduce((colors, variant) => {
      if (variant.color && !colors.includes(variant.color)) {
        colors.push(variant.color);
      }
      return colors;
    }, [] as string[]);

    result.colors = [...new Set(allColors)];
  }

  debug("İşlenmiş varyantlar:", result);
  return result;
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

// Temel veri çekme fonksiyonu
async function fetchProductPage(url: string): Promise<cheerio.CheerioAPI> {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1'
      },
      maxRedirects: 5,
      timeout: 10000
    });

    if (response.status !== 200) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const html = response.data;
    if (!html.includes('trendyol.com')) {
      throw new Error('Invalid response - trendyol.com not found in content');
    }

    debug("HTML içeriği başarıyla alındı, uzunluk:", html.length);
    return cheerio.load(html);

  } catch (error: any) {
    debug("Veri çekme hatası:", error);
    throw new TrendyolScrapingError("Sayfa yüklenemedi", {
      status: error.response?.status || 500,
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

  // CSV export endpoint'i
  app.post("/api/export", async (req, res) => {
    try {
      const { product } = req.body;
      if (!product) {
        throw new ProductDataError("Ürün verisi bulunamadı", "export");
      }

      const csvWriter = createObjectCsvWriter({
        path: 'products.csv',
        header: [
          { id: 'Handle', title: 'Handle' },
          { id: 'Title', title: 'Title' },
          { id: 'Body', title: 'Body (HTML)' },
          { id: 'Vendor', title: 'Vendor' },
          { id: 'Product Category', title: 'Product Category' },
          { id: 'Type', title: 'Type' },
          { id: 'Tags', title: 'Tags' },
          { id: 'Published', title: 'Published' },
          { id: 'Option1 Name', title: 'Option1 Name' },
          { id: 'Option1 Value', title: 'Option1 Value' },
          { id: 'Option2 Name', title: 'Option2 Name' },
          { id: 'Option2 Value', title: 'Option2 Value' },
          { id: 'Variant SKU', title: 'Variant SKU' },
          { id: 'Variant Price', title: 'Variant Price' },
          { id: 'Variant Compare At Price', title: 'Variant Compare At Price' },
          { id: 'Image Src', title: 'Image Src' },
          { id: 'Image Alt Text', title: 'Image Alt Text' }
        ]
      });

      // Ürün handle'ı oluştur
      const handle = product.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

      // CSV kaydı oluştur
      const records = [];

      // Her beden için tek bir varyant oluştur
      const uniqueSizes = [...new Set(product.variants.sizes)].sort((a, b) => parseInt(a) - parseInt(b));
      uniqueSizes.forEach((size: string) => {
        records.push({
          Handle: handle,
          Title: product.title,
          'Body': product.description,
          'Vendor': product.brand || 'Trendyol',
          'Product Category': product.categories[0] || 'Giyim',
          'Type': product.categories[0] || 'Giyim',
          'Tags': product.tags.join(','),
          'Published': 'TRUE',
          'Option1 Name': 'Size',
          'Option1 Value': size,
          'Option2 Name': 'Color',
          'Option2 Value': product.variants.colors[0] || 'Default',
          'Variant SKU': `${handle}-${size}`,
          'Variant Price': product.price,
          'Variant Compare At Price': product.basePrice,
          'Image Src': product.images[0] || '',
          'Image Alt Text': product.title
        });
      });

      // Ek görseller için kayıtlar
      if (product.images.length > 1) {
        product.images.slice(1).forEach((image: string) => {
          records.push({
            Handle: handle,
            'Image Src': image,
            'Image Alt Text': product.title
          });
        });
      }

      await csvWriter.writeRecords(records);
      res.download('products.csv');

    } catch (error) {
      debug("CSV export hatası:", error);
      const { status, message, details } = handleError(error);
      res.status(status).json({ message, details });
    }
  });

  return httpServer;
}