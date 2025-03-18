import type { Express } from "express";
import { createServer } from "http";
import { storage } from "./storage";
import * as cheerio from "cheerio";
import { urlSchema, type InsertProduct, type Product } from "@shared/schema";
import { ZodError } from "zod";
import fetch from "node-fetch";
import { TrendyolScrapingError, URLValidationError, ProductDataError, handleError } from "./errors";

async function scrapeTrendyolCategories($: cheerio.CheerioAPI): Promise<string[]> {
  let categories: string[] = [];

  try {
    // 1. Ana breadcrumb yolundan kategorileri al
    categories = $(".breadcrumb-wrapper span, .product-path span")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(cat => cat !== ">" && cat !== "Trendyol" && cat.length > 0);

    // 2. Detay sayfasından kategorileri al
    if (categories.length === 0) {
      categories = $(".product-detail-category, .detail-category")
        .first()
        .text()
        .trim()
        .split("/")
        .map(c => c.trim())
        .filter(Boolean);
    }

    // 3. Marka ve ürün tipinden kategori oluştur
    if (categories.length === 0) {
      const brand = $(".product-brand-name, .brand-name").first().text().trim();
      const type = $(".product-type, .type-name").first().text().trim();

      if (brand && type) {
        categories = [brand, type];
      }
    }

    // 4. En az bir kategori olduğundan emin ol
    if (categories.length === 0) {
      const brandName = $(".pr-new-br span").first().text().trim();
      if (brandName) {
        categories = [brandName];
      } else {
        categories = ["Giyim"]; // Varsayılan kategori
      }
    }

    console.log("Bulunan kategoriler:", categories);
    return categories;

  } catch (error) {
    console.error("Kategori çekme hatası:", error);
    return ["Giyim"]; // Hata durumunda varsayılan kategori
  }
}


async function scrapeProductAttributes($: cheerio.CheerioAPI): Promise<Record<string, string>> {
  const attributes: Record<string, string> = {};

  try {
    // 1. Tüm olası özellik selektörleri
    const selectors = [
      '.detail-attr-container tr',
      '.product-feature-table tr',
      '.product-feature-list li',
      '.detail-attr-item',
      '[data-drroot="properties"] .detail-attr-item',
      '.product-properties li',
      '.detail-border-bottom tr',
      '.product-details tr'
    ];

    // 2. Her bir selektörü dene
    for (const selector of selectors) {
      $(selector).each((_, element) => {
        let label, value;

        // 2.1 Tablo yapısı için
        if ($(element).find('th, td').length > 0) {
          label = $(element).find('th, td:first-child').text().trim();
          value = $(element).find('td:last-child').text().trim();
        }
        // 2.2 Liste yapısı için
        else {
          const text = $(element).text().trim();
          [label, value] = text.split(':').map(s => s.trim());
        }

        // 2.3 Özel etiket yapıları için
        if (!value && $(element).find('.detail-attr-label, .property-label').length > 0) {
          label = $(element).find('.detail-attr-label, .property-label').text().trim();
          value = $(element).find('.detail-attr-value, .property-value').text().trim();
        }

        // 2.4 Geçerli değerleri ekle
        if (label && value && !attributes[label]) {
          attributes[label] = value;
        }
      });

      // Eğer özellik bulduysa döngüyü bitir
      if (Object.keys(attributes).length > 0) {
        break;
      }
    }

    // 3. Ek özellik alanlarını kontrol et
    if (Object.keys(attributes).length === 0) {
      const additionalProps = $('script[type="application/ld+json"]').map((_, el) => {
        try {
          const schema = JSON.parse($(el).html() || '{}');
          if (schema.additionalProperty) {
            return schema.additionalProperty;
          }
        } catch (e) {
          console.error('JSON parse error:', e);
        }
        return null;
      }).get().filter(Boolean);

      additionalProps.forEach((prop: any) => {
        if (prop.name && prop.value) {
          attributes[prop.name] = prop.value;
        }
      });
    }

    console.log("Bulunan özellikler:", attributes);
    return attributes;

  } catch (error) {
    console.error("Özellik çekme hatası:", error);
    return {};
  }
}

// Routes düzenlemesi
export async function registerRoutes(app: Express) {
  const httpServer = createServer(app);

  app.post("/api/scrape", async (req, res) => {
    try {
      console.log("Scraping başlatıldı:", req.body);
      const { url } = urlSchema.parse(req.body);

      // Cache kontrolü
      const existing = await storage.getProduct(url);
      if (existing) {
        console.log("Ürün cache'den alındı:", existing.id);
        return res.json(existing);
      }

      // Trendyol'dan veri çekme
      console.log("Trendyol'dan veri çekiliyor:", url);
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });

      if (!response.ok) {
        throw new TrendyolScrapingError("Ürün sayfası yüklenemedi", {
          status: response.status,
          statusText: response.statusText
        });
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      // Schema.org verisi
      const schemaScript = $('script[type="application/ld+json"]').first().html();
      if (!schemaScript) {
        throw new ProductDataError("Ürün şeması bulunamadı", "schema");
      }

      let schema;
      try {
        schema = JSON.parse(schemaScript);
        if (!schema["@type"] || !schema.name || !schema.offers) {
          throw new ProductDataError("Geçersiz ürün şeması", "schema");
        }
      } catch (error) {
        console.error("Schema parse hatası:", error);
        throw new ProductDataError("Ürün şeması geçersiz", "schema");
      }

      // Temel ürün bilgileri
      const title = schema.name;
      const description = schema.description;
      const price = parseFloat(schema.offers.price);
      const brand = schema.brand?.name || schema.manufacturer || title.split(' ')[0];

      if (!title || !description || isNaN(price)) {
        throw new ProductDataError("Temel ürün bilgileri eksik", "basicInfo");
      }

      // Kategori bilgisini al
      let categories = await scrapeTrendyolCategories($);

      // Schema.org'dan kategori bilgisini kontrol et
      if (categories.length === 0 && schema.breadcrumb?.itemListElement) {
        const schemaCategories = schema.breadcrumb.itemListElement
          .map((item: any) => item.item?.name || item.name)
          .filter((name: string | null) => name && name !== "Trendyol");

        if (schemaCategories.length > 0) {
          categories = schemaCategories;
        }
      }

      // Son kontrol
      if (categories.length === 0) {
        console.warn("Hiçbir yöntemle kategori bulunamadı");
        // Varsayılan kategori
        categories = ["Giyim"];
      }

      console.log("Final kategoriler:", categories);


      // Görseller
      let images: string[] = [];
      try {
        if (schema.image?.contentUrl) {
          images = Array.isArray(schema.image.contentUrl)
            ? schema.image.contentUrl
            : [schema.image.contentUrl];
        }

        if (images.length === 0) {
          const mainImage = $("img.detail-section-img").first().attr("src");
          if (mainImage) images.push(mainImage);

          $("div.gallery-modal-content img").each((_, el) => {
            const src = $(el).attr("src");
            if (src && !images.includes(src)) {
              images.push(src);
            }
          });
        }

        if (images.length === 0) {
          throw new ProductDataError("Ürün görselleri bulunamadı", "images");
        }
      } catch (error) {
        console.error("Görsel çekme hatası:", error);
        throw new ProductDataError("Görseller işlenirken hata oluştu", "images");
      }

      // Varyantlar
      const variants = {
        sizes: [] as string[],
        colors: [] as string[]
      };


      if (categories.some(c => c.toLowerCase().includes('ayakkabı')) || categories.some(c => c.toLowerCase().includes('sneaker'))) {
        // Schema.org varyant bilgisi
        if (schema.hasVariant) {
          schema.hasVariant.forEach((variant: any) => {
            if (variant.size && !variants.sizes.includes(variant.size)) {
              variants.sizes.push(variant.size);
            }
            if (variant.color && !variants.colors.includes(variant.color)) {
              variants.colors.push(variant.color);
            }
          });
        }

        // DOM'dan varyant bilgisi
        if (variants.sizes.length === 0) {
          variants.sizes = $(".sp-itm:not(.so)")
            .map((_, el) => $(el).text().trim())
            .get()
            .filter(Boolean);
        }

        if (variants.colors.length === 0) {
          variants.colors = $(".slc-txt")
            .map((_, el) => $(el).text().trim())
            .get()
            .filter(Boolean);
        }
      } else if (categories.some(c => c.toLowerCase().includes('cüzdan')) || categories.some(c => c.toLowerCase().includes('çanta'))) {
        // Schema.org varyant bilgisi
        if (schema.hasVariant) {
          schema.hasVariant.forEach((variant: any) => {
            if (variant.color && !variants.colors.includes(variant.color)) {
              variants.colors.push(variant.color);
            }
          });
        }
        if (variants.colors.length === 0) {
          variants.colors = $(".slc-txt")
            .map((_, el) => $(el).text().trim())
            .get()
            .filter(Boolean);
        }
      } else {
        // Schema.org varyant bilgisi
        if (schema.hasVariant) {
          schema.hasVariant.forEach((variant: any) => {
            if (variant.size && !variants.sizes.includes(variant.size)) {
              variants.sizes.push(variant.size);
            }
            if (variant.color && !variants.colors.includes(variant.color)) {
              variants.colors.push(variant.color);
            }
          });
        }

        // DOM'dan varyant bilgisi
        if (variants.sizes.length === 0) {
          variants.sizes = $(".sp-itm:not(.so)")
            .map((_, el) => $(el).text().trim())
            .get()
            .filter(Boolean);
        }

        if (variants.colors.length === 0) {
          variants.colors = $(".slc-txt")
            .map((_, el) => $(el).text().trim())
            .get()
            .filter(Boolean);
        }
      }


      // Ürün özelliklerini çek
      const attributes = await scrapeProductAttributes($);

      const product: InsertProduct = {
        url,
        title,
        description,
        price: (price * 1.15).toFixed(2), // %15 kar marjı
        basePrice: price.toString(),
        images,
        variants,
        attributes,
        categories,
        tags: [...categories],
        brand
      };

      console.log("Ürün veritabanına kaydediliyor");
      const saved = await storage.saveProduct(product);
      console.log("Ürün başarıyla kaydedildi:", saved.id);
      res.json(saved);

    } catch (error) {
      console.error("Hata oluştu:", error);
      const { status, message, details } = handleError(error);
      res.status(status).json({ message, details });
    }
  });

  return httpServer;
}