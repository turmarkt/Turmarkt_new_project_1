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


async function exportToShopify(product: Product) {
  const handle = product.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  // Shopify kategori eşleştirmesi
  let shopifyCategory = "Apparel & Accessories > Clothing";
  let productType = "Clothing";

  if (product.categories.some(c => c.toLowerCase().includes('cüzdan'))) {
    shopifyCategory = "Apparel & Accessories > Handbags, Wallets & Cases > Wallets & Money Clips";
    productType = "Wallets";
  } else if (product.categories.some(c => c.toLowerCase().includes('tişört'))) {
    shopifyCategory = "Apparel & Accessories > Clothing > Shirts & Tops";
    productType = "Shirts";
  } else if (product.categories.some(c => c.toLowerCase().includes('ayakkabı'))) {
    shopifyCategory = "Apparel & Accessories > Shoes > Athletic Shoes";
    productType = "Shoes";
  }

  // Ana ürün kaydı
  const mainRecord = {
    handle,
    title: product.title,
    body_html: `<div class="product-description">
      <p>${product.description}</p>
      <div class="specifications">
        <h2>Ürün Özellikleri</h2>
        <table>
          ${Object.entries(product.attributes)
            .map(([key, value]) => `
              <tr>
                <th>${key}</th>
                <td>${value}</td>
              </tr>
            `).join('')}
        </table>
      </div>
    </div>`,
    vendor: product.brand,
    product_category: shopifyCategory,
    type: productType,
    tags: product.categories.join(','),
    published: 'TRUE',
    option1_name: product.variants.sizes.length > 0 ? 'Size' : '',
    option1_value: product.variants.sizes[0] || '',
    option2_name: product.variants.colors.length > 0 ? 'Color' : '',
    option2_value: product.variants.colors[0] || '',
    sku: `${handle}-1`,
    price: product.price,
    requires_shipping: 'TRUE',
    taxable: 'TRUE',
    inventory_tracker: 'shopify',
    inventory_quantity: '100',
    inventory_policy: 'continue',
    fulfillment_service: 'manual',
    weight: '500',
    weight_unit: 'g',
    image_src: product.images[0],
    image_position: '1',
    image_alt_text: product.title,
    gift_card: 'FALSE',
    status: 'active'
  };

  const records = [mainRecord];

  // Varyant kayıtları
  if (product.variants.sizes.length > 0) {
    for (let i = 1; i < product.variants.sizes.length; i++) {
      records.push({
        ...mainRecord,
        body_html: '',
        option1_value: product.variants.sizes[i],
        sku: `${handle}-size-${i}`,
        inventory_quantity: '100',
        image_position: ''
      });
    }
  }

  if (product.variants.colors.length > 0) {
    for (let i = 1; i < product.variants.colors.length; i++) {
      const variantImage = product.images[i] || product.images[0];
      records.push({
        ...mainRecord,
        body_html: '',
        option2_value: product.variants.colors[i],
        sku: `${handle}-color-${i}`,
        inventory_quantity: '100',
        image_src: variantImage,
        image_position: '',
        variant_image: variantImage
      });
    }
  }

  // Ek görsel kayıtları
  for (let i = 1; i < product.images.length; i++) {
    records.push({
      handle,
      title: product.title,
      product_category: shopifyCategory,
      type: productType,
      published: 'TRUE',
      image_src: product.images[i],
      image_position: (i + 1).toString(),
      image_alt_text: `${product.title} - Görsel ${i + 1}`,
      status: 'active'
    });
  }

  // CSV yazıcı
  const csvWriter = createObjectCsvWriter({
    path: 'products.csv',
    header: [
      {id: 'handle', title: 'Handle'},
      {id: 'title', title: 'Title'},
      {id: 'body_html', title: 'Body (HTML)'},
      {id: 'vendor', title: 'Vendor'},
      {id: 'product_category', title: 'Product Category'},
      {id: 'type', title: 'Type'},
      {id: 'tags', title: 'Tags'},
      {id: 'published', title: 'Published'},
      {id: 'option1_name', title: 'Option1 Name'},
      {id: 'option1_value', title: 'Option1 Value'},
      {id: 'option2_name', title: 'Option2 Name'},
      {id: 'option2_value', title: 'Option2 Value'},
      {id: 'sku', title: 'SKU'},
      {id: 'price', title: 'Price'},
      {id: 'requires_shipping', title: 'Requires Shipping'},
      {id: 'taxable', title: 'Taxable'},
      {id: 'inventory_tracker', title: 'Inventory Tracker'},
      {id: 'inventory_quantity', title: 'Inventory Qty'},
      {id: 'inventory_policy', title: 'Inventory Policy'},
      {id: 'fulfillment_service', title: 'Fulfillment Service'},
      {id: 'weight', title: 'Weight'},
      {id: 'weight_unit', title: 'Weight Unit'},
      {id: 'image_src', title: 'Image Src'},
      {id: 'image_position', title: 'Image Position'},
      {id: 'image_alt_text', title: 'Image Alt Text'},
      {id: 'variant_image', title: 'Variant Image'},
      {id: 'gift_card', title: 'Gift Card'},
      {id: 'status', title: 'Status'}
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
        if (variants.sizes.length === 0 ) {
          variants.sizes = $(".sp-itm:not(.so)")
            .map((_, el) => $(el).text().trim())
            .get()
            .filter(Boolean);
        }

        if (variants.colors.length === 0 ) {
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
          if (variants.colors.length === 0 ) {
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
        if (variants.sizes.length === 0 ) {
          variants.sizes = $(".sp-itm:not(.so)")
            .map((_, el) => $(el).text().trim())
            .get()
            .filter(Boolean);
        }

        if (variants.colors.length === 0 ) {
          variants.colors = $(".slc-txt")
            .map((_, el) => $(el).text().trim())
            .get()
            .filter(Boolean);
        }
      }


      // Özellikler
      const attributes: Record<string, string> = {};
      if (Array.isArray(schema.additionalProperty)) {
        schema.additionalProperty.forEach((prop: any) => {
          if (prop.name && prop.value) {
            attributes[prop.name] = prop.value;
          }
        });
      }

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