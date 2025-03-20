import type { Express } from "express";
import { createServer } from "http";
import { storage } from "./storage";
import * as cheerio from "cheerio";
import { urlSchema, type InsertProduct } from "@shared/schema";
import { TrendyolScrapingError, ProductDataError, handleError } from "./errors";
import { createObjectCsvWriter } from "csv-writer";
import fetch from "node-fetch";

// Temel veri çekme fonksiyonu
async function fetchProductPage(url: string, retryCount = 0): Promise<cheerio.CheerioAPI> {
  console.log(`Veri çekme denemesi ${retryCount + 1}/5 başlatıldı:`, url);

  try {
    // Random delay
    const delay = Math.floor(Math.random() * 2000) + 1000;
    await new Promise(resolve => setTimeout(resolve, delay));

    // Request headers
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
    };

    // HTTP isteği
    console.log("HTTP isteği yapılıyor...");
    const response = await fetch(url, { headers });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const html = await response.text();

    // HTML içeriğini kontrol et
    if (!html.includes('trendyol.com')) {
      throw new Error('Invalid response');
    }

    return cheerio.load(html);

  } catch (error: any) {
    console.error("Veri çekme hatası:", error.message);

    if (retryCount < 4) {
      console.log(`Yeniden deneniyor (${retryCount + 1}/5)...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      return fetchProductPage(url, retryCount + 1);
    }

    throw new TrendyolScrapingError("Ürün verisi çekilemedi", {
      status: 500,
      statusText: "Scraping Error",
      details: error.message
    });
  }
}

// Schema.org verisi çekme
async function extractProductSchema($: cheerio.CheerioAPI) {
  const schemaScript = $('script[type="application/ld+json"]').first().html();
  if (!schemaScript) {
    throw new ProductDataError("Ürün şeması bulunamadı", "schema");
  }

  try {
    const schema = JSON.parse(schemaScript);
    if (!schema["@type"] || !schema.name) {
      throw new ProductDataError("Geçersiz ürün şeması", "schema");
    }
    return schema;
  } catch (error) {
    console.error("Schema parse hatası:", error);
    throw new ProductDataError("Ürün şeması geçersiz", "schema");
  }
}

// Ana veri çekme ve işleme fonksiyonu
async function scrapeProduct(url: string): Promise<InsertProduct> {
  console.log("Scraping başlatıldı:", url);

  const $ = await fetchProductPage(url);
  const schema = await extractProductSchema($);

  const title = schema.name;
  const description = schema.description;
  const price = schema.offers?.price?.toString() || "";
  const basePrice = price; // Fiyat hesaplaması için
  const images = schema.image ? 
    (Array.isArray(schema.image) ? schema.image : [schema.image]) : [];

  const categories = schema.category ?
    (Array.isArray(schema.category) ? schema.category : [schema.category]) :
    ['Giyim'];

  return {
    url,
    title,
    description,
    price,
    basePrice,
    images,
    variants: { sizes: [], colors: [] },
    attributes: {},
    categories,
    tags: [...categories],
    brand: schema.brand?.name || title.split(' ')[0] // Added brand fallback
  };
}

// Ürün özelliklerini çekme (unchanged except for error handling)
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
      const { url } = urlSchema.parse(req.body);

      // Cache kontrolü
      const existing = await storage.getProduct(url);
      if (existing) {
        console.log("Ürün cache'den alındı:", existing.id);
        return res.json(existing);
      }

      console.log("Ürün verileri çekiliyor:", url);
      const product = await scrapeProduct(url);
      const attributes = await extractAttributes(cheerio.load(await (await fetch(product.url)).text())); // Added attribute extraction
      product.attributes = attributes; //Assign extracted attributes
      console.log("Ürün başarıyla çekildi, kaydediliyor");
      const saved = await storage.saveProduct(product);
      console.log("Ürün kaydedildi:", saved.id);

      res.json(saved);

    } catch (error) {
      console.error("Hata oluştu:", error);
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
          {id: 'Tags', title: 'Tags'},
          {id: 'Brand', title: 'Brand'} // Added Brand field
        ]
      });

      await csvWriter.writeRecords([{
        Title: product.title,
        Handle: product.title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        Price: product.price,
        'Image Src': product.images[0] || '',
        Body: product.description,
        Tags: product.tags.join(','),
        Brand: product.brand // Added Brand field
      }]);

      res.download('products.csv');

    } catch (error) {
      console.error("CSV export hatası:", error);
      const { status, message, details } = handleError(error);
      res.status(status).json({ message, details });
    }
  });

  return httpServer;
}