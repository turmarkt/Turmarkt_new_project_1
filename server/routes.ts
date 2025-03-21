import { ProductAttribute, type ProductAttributes } from "@shared/schema";
import { z } from "zod";
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

function normalizeImageUrl(url: string): string {
  try {
    url = url.split('?')[0];

    if (url.includes('/ty')) {
      url = `https://cdn.dsmcdn.com${url}`;
    }

    if (url.startsWith('//')) {
      url = 'https:' + url;
    } else if (!url.startsWith('http')) {
      url = 'https://' + url;
    }

    url = url.replace(/\/mnresize\/\d+\/\d+\//, '/');
    url = url.replace(/_\d+x\d+/, '');

    if (!url.includes('_org_zoom')) {
      url = url.replace(/\.(jpg|jpeg|png|webp)$/, '_org_zoom.$1');
    }

    return url;
  } catch (error: any) {
    debug(`URL normalizasyon hatası: ${error.message}`);
    return url;
  }
}

async function scrapeProduct(url: string): Promise<InsertProduct> {
  debug("Scraping başlatıldı");

  try {
    const $ = await fetchProductPage(url);

    const brand = $('.pr-new-br span').first().text().trim();
    debug(`Marka: ${brand}`);

    const productName = $('.prdct-desc-cntnr-name').text().trim();
    debug(`Ürün adı: ${productName}`);

    let title = brand && productName ? `${brand} ${productName}` : (
      productName 
    );

    debug(`Birleştirilmiş başlık: ${title}`);

    if (!title) {
      throw new ProductDataError("Ürün başlığı bulunamadı", "title");
    }

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

    const images: Set<string> = new Set();
    debug("Görsel yakalama başlatıldı");

    $('script').each((_, element) => {
      const scriptContent = $(element).html() || '';
      if (scriptContent.includes('window.__PRODUCT_DETAIL_APP_INITIAL_STATE__')) {
        try {
          const match = scriptContent.match(/window\.__PRODUCT_DETAIL_APP_INITIAL_STATE__\s*=\s*({.*?});/s);
          if (match) {
            const data = JSON.parse(match[1]);
            const productImages = data?.product?.images || [];
            debug(`JSON'dan ${productImages.length} adet görsel bulundu`);
            productImages.forEach((img: any) => {
              if (typeof img === 'string') {
                const imgUrl = normalizeImageUrl(img);
                images.add(imgUrl);
                debug(`JSON'dan görsel eklendi: ${imgUrl}`);
              } else if (img.url) {
                const imgUrl = normalizeImageUrl(img.url);
                images.add(imgUrl);
                debug(`JSON'dan görsel eklendi: ${imgUrl}`);
              }
            });
          }
        } catch (error: any) {
          debug(`JSON parse hatası: ${error.message}`);
        }
      }
    });

    const imageSelectors = [
      '.gallery-modal-content img[src]',
      '.gallery-modal-content img[data-src]',
      '.product-detail-wrapper img[src]',
      '.product-detail-wrapper img[data-src]',
      '.slick-slider img[src]',
      '.slick-slider img[data-src]',
      '.product-slide img[src]',
      '.product-slide img[data-src]',
      '.image-container img[src]',
      '.image-container img[data-src]',
      '.product-box img[src]',
      '.product-box img[data-src]',
      'picture source[srcset]'
    ];

    debug(`${imageSelectors.length} adet görsel selektörü kontrol ediliyor`);

    for (const selector of imageSelectors) {
      const elements = $(selector);
      debug(`'${selector}' için ${elements.length} element bulundu`);

      elements.each((_, el) => {
        const srcAttr = $(el).attr('src');
        const dataSrc = $(el).attr('data-src');
        const srcset = $(el).attr('srcset') || $(el).attr('data-srcset');

        let sources = [srcAttr, dataSrc].filter(Boolean);

        if (srcset) {
          const srcsetUrls = srcset.split(',')
            .map(s => s.trim().split(' ')[0])
            .filter(Boolean);
          sources = [...sources, ...srcsetUrls];
        }

        sources.forEach(src => {
          if (!src) return;
          try {
            const normalizedUrl = normalizeImageUrl(src);
            images.add(normalizedUrl);
            debug(`DOM'dan görsel eklendi: ${normalizedUrl}`);
          } catch (error: any) {
            debug(`Görsel işlenirken hata: ${error.message}`);
          }
        });
      });
    }

    const uniqueImages = Array.from(images).filter(url => {
      try {
        new URL(url);
        return true;
      } catch {
        return false;
      }
    });

    debug(`Toplam ${uniqueImages.length} benzersiz görsel bulundu`);

    const categories: string[] = [];
    $('.breadcrumb li').each((_, el) => {
      const category = $(el).text().trim();
      if (category && !category.includes('>')) {
        categories.push(category);
      }
    });

    const product: InsertProduct = {
      url,
      title,
      description: "",
      price: price.toString(),
      basePrice: basePrice.toString(),
      images: uniqueImages,
      video: null,
      variants: {
        sizes: [],
        colors: []
      },
      attributes: {
        "Hacim": ProductAttribute.Hacim,
        "Menşei": ProductAttribute.Mensei,
        "Paket İçeriği": ProductAttribute.PaketIcerigi
      },
      categories: categories.length > 0 ? categories : ['Giyim'],
      tags: categories
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