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

    if (url.match(/\.(mp4|webm|ogg|mov)$/i)) {
      debug(`Video dosyası filtrelendi: ${url}`);
      return '';
    }

    if (!url.match(/\.(jpg|jpeg|png|webp)$/i)) {
      debug(`Desteklenmeyen dosya formatı: ${url}`);
      return '';
    }

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

    debug(`Normalize edilmiş görsel URL: ${url}`);
    return url;
  } catch (error: any) {
    debug(`URL normalizasyon hatası: ${error.message}`);
    return '';
  }
}

async function scrapeProduct(url: string): Promise<InsertProduct> {
  debug("Scraping başlatıldı");

  try {
    const $ = await fetchProductPage(url);

    const brand = $('.pr-new-br span').first().text().trim() ||
                     $('h1.pr-new-br').first().text().trim();
    debug(`Marka: ${brand}`);

    const productName = $('.prdct-desc-cntnr-name').text().trim() ||
                       $('.pr-in-w').first().text().trim().replace(/\d+(\.\d+)?\s*TL.*$/, '');
    debug(`Ürün adı: ${productName}`);

    // Başlığı birleştir
    let title = '';
    if (brand && productName) {
      title = `${brand} ${productName}`;
    } else if (productName) {
      title = productName;
    } else {
      title = $('.pr-in-w').first().text().trim()
              .replace(/\d+(\.\d+)?\s*TL.*$/, '')
              .replace(/Tükeniyor!?/g, '')
              .trim();
    }

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

    // Varyant verilerini başlat
    const variants = {
      sizes: new Set<string>(),
      colors: new Set<string>()
    };

    // Sayfa içeriğinden varyantları çek
    $('script').each((_, element) => {
      const scriptContent = $(element).html() || '';
      if (scriptContent.includes('window.__PRODUCT_DETAIL_APP_INITIAL_STATE__')) {
        try {
          const match = scriptContent.match(/window\.__PRODUCT_DETAIL_APP_INITIAL_STATE__\s*=\s*({.*?});/s);
          if (match) {
            const data = JSON.parse(match[1]);
            debug("Product detail state bulundu");

            // Varyantları kontrol et
            if (data.product?.variants) {
              data.product.variants.forEach((variant: any) => {
                // Stokta olan varyantları kontrol et
                if (variant.stock > 0) {
                  if (variant.attributeName === "Numara" || variant.attributeName === "Beden") {
                    const value = variant.attributeValue || variant.value;
                    if (value) {
                      variants.sizes.add(value);
                      debug(`Stokta olan ${variant.attributeName} varyantı bulundu: ${value}`);
                    }
                  }
                }
              });
            }

            // Alternatif varyant yapısını kontrol et
            if (data.product?.slicedAttributes) {
              data.product.slicedAttributes.forEach((attr: any) => {
                if (attr.name === "Numara" || attr.name === "Beden") {
                  attr.attributes.forEach((item: any) => {
                    if (item.inStock) {
                      const value = item.value.toString().trim();
                      if (value) {
                        variants.sizes.add(value);
                        debug(`Stokta olan ${attr.name} seçeneği bulundu: ${value}`);
                      }
                    }
                  });
                }
              });
            }

            // Renk varyantını kontrol et
            if (data.product?.color) {
              // Rengi temizle ve düzgün formata getir
              const color = data.product.color.split('-')[0].trim();
              if (color) {
                variants.colors.add(color);
                debug(`Renk varyantı bulundu: ${color}`);
              }
            }

            // Alternatif renk varyantını kontrol et
            if (data.product?.attributes) {
              data.product.attributes.forEach((attr: any) => {
                if (attr.name === "Renk") {
                  // Rengi temizle ve düzgün formata getir
                  const colors = attr.value.split(',').map((c: string) => c.trim());
                  colors.forEach((color: string) => {
                    if (color) {
                      variants.colors.add(color);
                      debug(`Özelliklerden renk varyantı bulundu: ${color}`);
                    }
                  });
                }
              });
            }
          }
        } catch (error) {
          debug(`State parse hatası: ${error}`);
          if (error instanceof Error) {
            debug(`Hata detayı: ${error.message}`);
            debug(`Hata stack: ${error.stack}`);
          }
        }
      }
    });

    debug(`Toplam ${variants.sizes.size} adet stokta olan beden/numara varyantı bulundu`);
    debug(`Varyant listesi: ${Array.from(variants.sizes).join(', ')}`);
    debug(`Toplam ${variants.colors.size} adet renk varyantı bulundu`);
    debug(`Renk listesi: ${Array.from(variants.colors).join(', ')}`);


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
                if (imgUrl) images.add(imgUrl);
              } else if (img.url) {
                const imgUrl = normalizeImageUrl(img.url);
                if (imgUrl) images.add(imgUrl);
              }
            });
          }
        } catch (error: any) {
          debug(`JSON parse hatası: ${error.message}`);
        }
      }
    });

    // Ürün özelliklerini çek
    const attributes: Record<string, string> = {};

    // JSON-LD'den özellikleri çek
    $('script[type="application/ld+json"]').each((_, element) => {
      try {
        const data = JSON.parse($(element).html() || '');
        if (data.additionalProperty) {
          data.additionalProperty.forEach((prop: any) => {
            if (prop.name && prop.unitText) {
              attributes[prop.name] = prop.unitText;
              debug(`JSON-LD'den özellik bulundu: ${prop.name} = ${prop.unitText}`);
            }
          });
        }
      } catch (error) {
        debug(`JSON parse hatası: ${error}`);
      }
    });

    const uniqueImages = Array.from(images).filter((url, index, arr) => {
      try {
        new URL(url);
        // Son görseli hariç tut
        return index < arr.length - 1;
      } catch {
        return false;
      }
    });

    const categories: string[] = [];
    $('.breadcrumb li').each((_, el) => {
      const category = $(el).text().trim();
      if (category && !category.includes('>')) {
        categories.push(category);
      }
    });

    if (Object.keys(attributes).length === 0) {
      debug("Hiç özellik bulunamadı!");
    } else {
      debug(`Toplam ${Object.keys(attributes).length} özellik bulundu`);
      debug("Bulunan özellikler:");
      Object.entries(attributes).forEach(([key, value]) => {
        debug(`${key}: ${value}`);
      });
    }

    const product: InsertProduct = {
      url,
      title,
      description: $('.product-description').text().trim() || "",
      price: price.toString(),
      basePrice: basePrice.toString(),
      images: uniqueImages,
      video: null,
      variants: {
        sizes: Array.from(variants.sizes),
        colors: Array.from(variants.colors)
      },
      attributes,
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