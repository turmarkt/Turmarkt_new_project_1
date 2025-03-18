import type { Express } from "express";
import { createServer } from "http";
import { storage } from "./storage";
import * as cheerio from "cheerio";
import { urlSchema, type InsertProduct, type Product } from "@shared/schema";
import { ZodError } from "zod";
import { createObjectCsvWriter } from "csv-writer";
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


// Ürün özelliklerini çekme fonksiyonu
async function scrapeProductAttributes($: cheerio.CheerioAPI): Promise<Record<string, string>> {
  const attributes: Record<string, string> = {};

  try {
    // 1. Ürün detay tablosundan özellikleri al
    $(".detail-attr-container tr").each((_, row) => {
      const label = $(row).find("th").text().trim();
      const value = $(row).find("td").text().trim();
      if (label && value) {
        attributes[label] = value;
      }
    });

    // 2. Alternatif özellik bloklarını kontrol et
    if (Object.keys(attributes).length === 0) {
      $(".product-feature-list li").each((_, item) => {
        const text = $(item).text().trim();
        const [label, value] = text.split(':').map(s => s.trim());
        if (label && value) {
          attributes[label] = value;
        }
      });
    }

    // 3. Diğer özellik bloklarını kontrol et
    if (Object.keys(attributes).length === 0) {
      $("[data-drroot='properties'] .detail-attr-item").each((_, item) => {
        const label = $(item).find(".detail-attr-label").text().trim();
        const value = $(item).find(".detail-attr-value").text().trim();
        if (label && value) {
          attributes[label] = value;
        }
      });
    }

    return attributes;
  } catch (error) {
    console.error("Özellik çekme hatası:", error);
    return {};
  }
}

async function exportToShopify(product: Product) {
  const handle = product.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  // Ana ürün kaydı
  const mainRecord = {
    'Title': product.title,
    'URL handle': handle,
    'Description': product.description,
    'Vendor': product.brand || '',
    'Product category': 'Apparel & Accessories > Clothing',
    'Type': 'Clothing',
    'Tags': product.categories.join(','),
    'Published on online store': 'TRUE',
    'Status': 'active',
    'SKU': `${handle}-1`,
    'Barcode': '',
    'Option1 Name': product.variants.sizes.length > 0 ? 'Size' : '',
    'Option1 Value': product.variants.sizes[0] || '',
    'Option2 Name': product.variants.colors.length > 0 ? 'Color' : '',
    'Option2 Value': product.variants.colors[0] || '',
    'Option3 Name': '',
    'Option3 Value': '',
    'Price': product.price,
    'Charge tax': 'TRUE',
    'Tax code': '',
    'Inventory tracker': 'shopify',
    'Inventory quantity': '100',
    'Continue selling when out of stock': 'deny',
    'Weight value (grams)': '500',
    'Weight unit for display': 'g',
    'Requires shipping': 'TRUE',
    'Fulfillment service': 'manual',
    'Product image URL': product.images[0] || '',
    'Image position': '1',
    'Image alt text': product.title,
    'Variant image URL': '',
    'Gift card': 'FALSE',
    'SEO title': product.title,
    'SEO description': product.description.substring(0, 320),
    'Google Shopping / Google product category': 'Apparel & Accessories > Clothing',
    'Google Shopping / Gender': 'Unisex',
    'Google Shopping / Age group': 'Adult',
    'Google Shopping / MPN': `${handle}-${Date.now()}`,
    'Google Shopping / AdWords Grouping': '',
    'Google Shopping / AdWords labels': '',
    'Google Shopping / Condition': 'new',
    'Google Shopping / Custom product': 'FALSE',
    'Body (HTML)': `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
        <div style="margin-bottom: 20px;">
          <h3 style="font-size: 18px; color: #333; margin-bottom: 10px;">Ürün Açıklaması</h3>
          <p style="color: #666; line-height: 1.6;">${product.description}</p>
        </div>
        <div style="background: #f9f9f9; padding: 20px; border-radius: 8px;">
          <h3 style="font-size: 18px; color: #333; margin-bottom: 15px;">Ürün Özellikleri</h3>
          <table style="width: 100%; border-collapse: collapse; background: white;">
            <tbody>
              ${Object.entries(product.attributes)
                .map(([key, value]) => `
                  <tr>
                    <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">${key}</td>
                    <td style="padding: 8px; border-bottom: 1px solid #eee;">${value}</td>
                  </tr>
                `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `
  };

  const records = [mainRecord];

  // Varyant kayıtları
  if (product.variants.sizes.length > 0) {
    for (let i = 1; i < product.variants.sizes.length; i++) {
      records.push({
        'Title': '',
        'URL handle': handle,
        'Option1 Name': 'Size',
        'Option1 Value': product.variants.sizes[i],
        'SKU': `${handle}-size-${i}`,
        'Price': product.price,
        'Charge tax': 'TRUE',
        'Inventory tracker': 'shopify',
        'Inventory quantity': '100',
        'Continue selling when out of stock': 'deny',
        'Weight value (grams)': '500',
        'Weight unit for display': 'g',
        'Requires shipping': 'TRUE',
        'Fulfillment service': 'manual'
      });
    }
  }

  if (product.variants.colors.length > 0) {
    for (let i = 1; i < product.variants.colors.length; i++) {
      const variantImage = product.images[i] || product.images[0];
      records.push({
        'Title': '',
        'URL handle': handle,
        'Option2 Name': 'Color',
        'Option2 Value': product.variants.colors[i],
        'SKU': `${handle}-color-${i}`,
        'Price': product.price,
        'Charge tax': 'TRUE',
        'Inventory tracker': 'shopify',
        'Inventory quantity': '100',
        'Continue selling when out of stock': 'deny',
        'Weight value (grams)': '500',
        'Weight unit for display': 'g',
        'Requires shipping': 'TRUE',
        'Fulfillment service': 'manual',
        'Product image URL': variantImage,
        'Variant image URL': variantImage
      });
    }
  }

  // Ek görsel kayıtları
  for (let i = 1; i < product.images.length; i++) {
    records.push({
      'Title': '',
      'URL handle': handle,
      'Product image URL': product.images[i],
      'Image position': (i + 1).toString(),
      'Image alt text': `${product.title} - Görsel ${i + 1}`
    });
  }

  // CSV yazıcı
  const csvWriter = createObjectCsvWriter({
    path: 'products.csv',
    header: [
      {id: 'Title', title: 'Title'},
      {id: 'URL handle', title: 'URL handle'},
      {id: 'Description', title: 'Description'},
      {id: 'Vendor', title: 'Vendor'},
      {id: 'Product category', title: 'Product category'},
      {id: 'Type', title: 'Type'},
      {id: 'Tags', title: 'Tags'},
      {id: 'Published on online store', title: 'Published on online store'},
      {id: 'Status', title: 'Status'},
      {id: 'SKU', title: 'SKU'},
      {id: 'Barcode', title: 'Barcode'},
      {id: 'Option1 Name', title: 'Option1 Name'},
      {id: 'Option1 Value', title: 'Option1 Value'},
      {id: 'Option2 Name', title: 'Option2 Name'},
      {id: 'Option2 Value', title: 'Option2 Value'},
      {id: 'Option3 Name', title: 'Option3 Name'},
      {id: 'Option3 Value', title: 'Option3 Value'},
      {id: 'Price', title: 'Price'},
      {id: 'Charge tax', title: 'Charge tax'},
      {id: 'Tax code', title: 'Tax code'},
      {id: 'Inventory tracker', title: 'Inventory tracker'},
      {id: 'Inventory quantity', title: 'Inventory quantity'},
      {id: 'Continue selling when out of stock', title: 'Continue selling when out of stock'},
      {id: 'Weight value (grams)', title: 'Weight value (grams)'},
      {id: 'Weight unit for display', title: 'Weight unit for display'},
      {id: 'Requires shipping', title: 'Requires shipping'},
      {id: 'Fulfillment service', title: 'Fulfillment service'},
      {id: 'Product image URL', title: 'Product image URL'},
      {id: 'Image position', title: 'Image position'},
      {id: 'Image alt text', title: 'Image alt text'},
      {id: 'Variant image URL', title: 'Variant image URL'},
      {id: 'Gift card', title: 'Gift card'},
      {id: 'SEO title', title: 'SEO title'},
      {id: 'SEO description', title: 'SEO description'},
      {id: 'Google Shopping / Google product category', title: 'Google Shopping / Google product category'},
      {id: 'Google Shopping / Gender', title: 'Google Shopping / Gender'},
      {id: 'Google Shopping / Age group', title: 'Google Shopping / Age group'},
      {id: 'Google Shopping / MPN', title: 'Google Shopping / MPN'},
      {id: 'Google Shopping / AdWords Grouping', title: 'Google Shopping / AdWords Grouping'},
      {id: 'Google Shopping / AdWords labels', title: 'Google Shopping / AdWords labels'},
      {id: 'Google Shopping / Condition', title: 'Google Shopping / Condition'},
      {id: 'Google Shopping / Custom product', title: 'Google Shopping / Custom product'},
      {id: 'Body (HTML)', title: 'Body (HTML)'}
    ]
  });

  await csvWriter.writeRecords(records);
  return 'products.csv';
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

      // Özellikler
      //const attributes: Record<string, string> = {};
      //if (Array.isArray(schema.additionalProperty)) {
      //  schema.additionalProperty.forEach((prop: any) => {
      //    if (prop.name && prop.value) {
      //      attributes[prop.name] = prop.value;
      //    }
      //  });
      //}

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

  app.post("/api/export", async (req, res) => {
    try {
      console.log("CSV export başlatıldı");
      const { product } = req.body;

      if (!product) {
        throw new ProductDataError("Ürün verisi bulunamadı", "product");
      }

      const csvFile = await exportToShopify(product);
      res.download(csvFile);

    } catch (error) {
      console.error("CSV export hatası:", error);
      const { status, message, details } = handleError(error);
      res.status(status).json({ message, details });
    }
  });

  return httpServer;
}