import { ProductAttribute, type ProductAttributes } from "@shared/schema";
import type { Express } from "express";
import { createServer } from "http";
import { storage } from "./storage";
import * as cheerio from "cheerio";
import { urlSchema, type InsertProduct } from "@shared/schema";
import { TrendyolScrapingError, ProductDataError, handleError } from "./errors";
import fetch from "node-fetch";

function debug(message: string) {
  console.log(`[DEBUG] ${message}`);
}

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
    const priceSelectors = ['.prc-box-dscntd', '.prc-box-sllng', '.product-price-container .prc-dsc'];
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
    const price = (basePrice * 1.15).toFixed(2);

    // Görselleri çek
    const images: Set<string> = new Set();

    // Tüm olası görsel selektörleri - Genişletilmiş liste
    const imageSelectors = [
      '.gallery-modal-content img',
      '.product-slide img',
      '.product-images img',
      '.product-stamp img',
      '.gallery-modal img',
      '.product-box-container img',
      '.product-gallery img',
      '.image-container img',
      '.slick-slide img',
      '.image-box img',
      'picture source[srcset]',
      'picture img'
    ];

    // Her selektör için görselleri topla
    for (const selector of imageSelectors) {
      $(selector).each((_, el) => {
        // Tüm olası görsel kaynaklarını kontrol et
        let src = $(el).attr('src') || 
                 $(el).attr('data-src') || 
                 $(el).attr('data-original') ||
                 $(el).attr('srcset')?.split(',')[0]?.trim()?.split(' ')[0];

        if (src) {
          // URL'yi temizle ve normalize et
          src = src.split('?')[0]; // Query parametrelerini kaldır

          // Küçük resimleri büyük versiyonlarıyla değiştir
          src = src.replace(/\/mnresize\/\d+\/\d+\//, '/');
          src = src.replace(/_\d+x\d+/, '');

          // En yüksek kaliteli versiyonu al
          if (!src.includes('_org_zoom')) {
            src = src.replace(/\.(jpg|jpeg|png)$/, '_org_zoom.$1');
          }

          // Görsel URL'sini normalize et
          if (!src.startsWith('http')) {
            src = `https:${src}`;
          }

          images.add(src);
        }
      });
    }

    debug(`${images.size} adet görsel bulundu`);

    // Video URL'sini çek
    let videoUrl = null;
    const videoElement = $('.gallery-modal-content video source').first();
    if (videoElement.length > 0) {
      videoUrl = videoElement.attr('src') || null;
    }

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

    // Kategorileri çek
    const categories: string[] = [];
    $('.breadcrumb li').each((_, el) => {
      const category = $(el).text().trim();
      if (category && !category.includes('>')) {
        categories.push(category);
      }
    });

    // Ürün nesnesi oluştur - Sadece sabit özelliklerle
    const product: InsertProduct = {
      url,
      title,
      description: "", // HTML'den açıklama almıyoruz
      price: price.toString(),
      basePrice: basePrice.toString(),
      images: Array.from(images),
      video: videoUrl,
      variants,
      // Sadece enum'dan gelen sabit özellikleri kullan
      attributes: {
        "Hacim": ProductAttribute.Hacim,
        "Menşei": ProductAttribute.Mensei,
        "Paket İçeriği": ProductAttribute.PaketIcerigi
      },
      categories: categories.length > 0 ? categories : ['Giyim'],
      tags: [...categories, ...variants.sizes].filter(Boolean)
    };

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

export async function registerRoutes(app: Express) {
  const httpServer = createServer(app);

  app.get("/api/history", async (req, res) => {
    try {
      const history = storage.getHistory();
      res.json(history);
    } catch (error) {
      const { status, message, details } = handleError(error);
      res.status(status).json({ message, details });
    }
  });

  app.post("/api/scrape", async (req, res) => {
    try {
      debug("Scrape isteği alındı");
      const { url } = urlSchema.parse(req.body);

      // Her istek öncesi cache'i temizle
      storage.reset();

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