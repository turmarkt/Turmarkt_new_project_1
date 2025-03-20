import type { Express } from "express";
import { createServer } from "http";
import { storage } from "./storage";
import * as cheerio from "cheerio";
import { urlSchema, type InsertProduct } from "@shared/schema";
import { TrendyolScrapingError, ProductDataError, handleError } from "./errors";
import { createObjectCsvWriter } from "csv-writer";
import fetch from "node-fetch";

// Debug loglama fonksiyonu
function debug(message: string, data?: any) {
  console.log(`[DEBUG] ${message}`, data ? JSON.stringify(data, null, 2) : '');
}

// Temel veri çekme fonksiyonu
async function fetchProductPage(url: string, retryCount = 0): Promise<cheerio.CheerioAPI> {
  debug(`Veri çekme denemesi ${retryCount + 1}/5 başlatıldı:`, { url });

  try {
    // Random delay
    const delay = Math.floor(Math.random() * 2000) + 1000;
    await new Promise(resolve => setTimeout(resolve, delay));

    // Request headers
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'max-age=0',
      'Connection': 'keep-alive',
      'DNT': '1',
      'Referer': 'https://www.google.com/',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'cross-site',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1'
    };

    // HTTP isteği
    debug("HTTP isteği yapılıyor...");
    const response = await fetch(url, { 
      headers,
      redirect: 'follow',
      follow: 5
    });

    debug("Yanıt alındı:", {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers.raw()
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const html = await response.text();
    debug("HTML içeriği alındı, uzunluk:", html.length);

    // HTML içeriğini kontrol et
    if (!html.includes('trendyol.com')) {
      debug("Geçersiz HTML yanıtı");
      throw new Error('Invalid response - trendyol.com not found in content');
    }

    // Bot koruması kontrolü
    if (html.includes('Checking if the site connection is secure') || 
        html.includes('Attention Required! | Cloudflare') ||
        html.includes('Please Wait... | Cloudflare')) {
      debug("Bot koruması tespit edildi");
      throw new Error('Bot protection detected');
    }

    // Ürün sayfası kontrolü
    const $ = cheerio.load(html);
    const isProductPage = $('.product-detail-container').length > 0;

    if (!isProductPage) {
      debug("Ürün sayfası bulunamadı");
      throw new Error('Product page not found');
    }

    debug("Sayfa başarıyla yüklendi");
    return $;

  } catch (error: any) {
    debug("Veri çekme hatası:", { 
      message: error.message,
      stack: error.stack,
      retryCount 
    });

    // Retry mekanizması
    if (retryCount < 4) {
      const waitTime = Math.min(1000 * Math.pow(2, retryCount), 8000);
      debug(`${waitTime}ms bekledikten sonra yeniden denenecek`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return fetchProductPage(url, retryCount + 1);
    }

    throw new TrendyolScrapingError(
      error.message.includes('Bot protection') 
        ? "Bot koruması nedeniyle erişim engellendi"
        : "Ürün verisi çekilemedi",
      {
        status: 500,
        statusText: "Scraping Error",
        details: error.message
      }
    );
  }
}

// Schema.org verisi çekme
async function extractProductSchema($: cheerio.CheerioAPI) {
  debug("Schema.org verisi çekiliyor");

  try {
    const schemaScript = $('script[type="application/ld+json"]').first().html();
    if (!schemaScript) {
      throw new Error('Schema script not found');
    }

    const schema = JSON.parse(schemaScript);
    debug("Schema verisi:", schema);

    if (!schema["@type"] || !schema.name) {
      throw new Error('Invalid schema structure');
    }

    return schema;
  } catch (error: any) {
    debug("Schema çekme hatası:", error);
    throw new ProductDataError("Ürün şeması geçersiz", "schema");
  }
}

// Ana veri çekme ve işleme fonksiyonu
async function scrapeProduct(url: string): Promise<InsertProduct> {
  debug("Scraping başlatıldı:", url);

  try {
    const $ = await fetchProductPage(url);
    const schema = await extractProductSchema($);

    debug("Temel ürün bilgileri çekiliyor");

    // Temel veri kontrolü
    if (!schema.name || !schema.description) {
      throw new ProductDataError("Eksik ürün bilgisi", "basic");
    }

    const product: InsertProduct = {
      url,
      title: schema.name,
      description: schema.description,
      price: schema.offers?.price?.toString() || "",
      basePrice: schema.offers?.price?.toString() || "",
      images: schema.image ? 
        (Array.isArray(schema.image) ? schema.image : [schema.image]) : [],
      variants: { sizes: [], colors: [] },
      attributes: {},
      categories: schema.category ?
        (Array.isArray(schema.category) ? schema.category : [schema.category]) :
        ['Giyim'],
      tags: [],
    };

    // Kategorileri tags olarak da kullan
    product.tags = [...product.categories];

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

// Ürün özelliklerini çekme
async function extractAttributes($: cheerio.CheerioAPI): Promise<Record<string, string>> {
  const attributes: Record<string, string> = {};

  try {
    // 1. Schema.org verilerinden özellikleri al
    $('script[type="application/ld+json"]').each((_, script) => {
      try {
        const schema = JSON.parse($(script).html() || '{}');
        if (schema.additionalProperty) {
          schema.additionalProperty.forEach((prop: any) => {
            if (prop.name && prop.unitText) {
              attributes[prop.name] = prop.unitText;
            }
          });
        }
      } catch (e) {
        console.error('Schema parse error:', e);
      }
    });

    // 2. Öne Çıkan Özellikler bölümünü bul
    $('.detail-attr-container').each((_, container) => {
      $(container).find('tr').each((_, row) => {
        const label = $(row).find('th').text().trim();
        const value = $(row).find('td').text().trim();
        if (label && value) {
          attributes[label] = value;
        }
      });
    });

    // 3. Tüm olası özellik selektörleri
    const selectors = [
      '.product-feature-list li',
      '.detail-attr-item',
      '.product-properties li',
      '.detail-border-bottom tr',
      '.product-details tr',
      '.featured-attributes-item'
    ];

    // Her bir selektör için kontrol
    selectors.forEach(selector => {
      $(selector).each((_, element) => {
        let label, value;

        // Etiket-değer çiftlerini bul
        if ($(element).find('.detail-attr-label, .property-label').length > 0) {
          label = $(element).find('.detail-attr-label, .property-label').text().trim();
          value = $(element).find('.detail-attr-value, .property-value').text().trim();
        } else if ($(element).find('th, td').length > 0) {
          label = $(element).find('th, td:first-child').text().trim();
          value = $(element).find('td:last-child').text().trim();
        } else {
          const text = $(element).text().trim();
          [label, value] = text.split(':').map(s => s.trim());
        }

        if (label && value && !attributes[label]) {
          attributes[label] = value;
        }
      });
    });

    return attributes;

  } catch (error) {
    console.error("Özellik çekme hatası:", error);
    return {};
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
      const attributes = await extractAttributes(cheerio.load(await (await fetch(product.url)).text())); // Added attribute extraction
      product.attributes = attributes; //Assign extracted attributes
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
          {id: 'Title', title: 'Title'},
          {id: 'Handle', title: 'Handle'},
          {id: 'Price', title: 'Price'},
          {id: 'Image Src', title: 'Image Src'},
          {id: 'Body', title: 'Body (HTML)'},
          {id: 'Tags', title: 'Tags'}
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