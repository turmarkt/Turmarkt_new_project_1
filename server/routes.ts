import type { Express } from "express";
import { createServer } from "http";
import { storage } from "./storage";
import * as cheerio from "cheerio";
import { urlSchema, type InsertProduct } from "@shared/schema";
import { ZodError } from "zod";
import { createObjectCsvWriter } from "csv-writer";
import fetch from "node-fetch";
import { TrendyolScrapingError, URLValidationError, ProductDataError, handleError } from "./errors";
import { getCategoryConfig } from "./category-mapping";

function mapToShopifyCategory(categories: string[]): string {
  const normalizedCategories = categories.map(c => c.toLowerCase().trim());
  const config = getCategoryConfig(normalizedCategories);
  return config.shopifyCategory;
}

function getVariantConfig(categories: string[]): {
  sizeLabel: string;
  colorLabel: string;
  defaultStock: number;
} {
  const categoryType = categories.map(c => c.toLowerCase()).join(' ');

  // Kategori bazlı varyant yapılandırması
  if (categoryType.includes('ayakkabı') || categoryType.includes('sneaker')) {
    return {
      sizeLabel: 'Numara',
      colorLabel: 'Renk',
      defaultStock: 50
    };
  } else if (categoryType.includes('cüzdan') || categoryType.includes('çanta')) {
    return {
      sizeLabel: '',
      colorLabel: 'Renk',
      defaultStock: 100
    };
  } else {
    // Giyim için varsayılan
    return {
      sizeLabel: 'Beden',
      colorLabel: 'Renk',
      defaultStock: 75
    };
  }
}

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

      // Kategori bilgisi
      let categories: string[] = [];
      try {
        if (schema.breadcrumb?.itemListElement) {
          categories = schema.breadcrumb.itemListElement
            .map((item: any) => item.item?.name || item.name)
            .filter((name: string | null) => name && name !== "Trendyol");
        }

        if (categories.length === 0) {
          categories = $(".product-path span")
            .map((_, el) => $(el).text().trim())
            .get()
            .filter(cat => cat !== ">" && cat !== "Trendyol");
        }

        if (categories.length === 0) {
          throw new ProductDataError("Kategori bilgisi bulunamadı", "categories");
        }
      } catch (error) {
        console.error("Kategori çekme hatası:", error);
        throw new ProductDataError("Kategori bilgisi işlenirken hata oluştu", "categories");
      }

      // Kategori konfigürasyonu
      const categoryConfig = getCategoryConfig(categories);

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

      if (categoryConfig.variantConfig.hasVariants) {
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
        if (variants.sizes.length === 0 && categoryConfig.variantConfig.sizeLabel) {
          variants.sizes = $(".sp-itm:not(.so)")
            .map((_, el) => $(el).text().trim())
            .get()
            .filter(Boolean);
        }

        if (variants.colors.length === 0 && categoryConfig.variantConfig.colorLabel) {
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

      // Önerilen özellikleri ekle
      categoryConfig.attributes.forEach(attr => {
        if (!attributes[attr]) {
          const value = $(`[data-attribute="${attr}"]`).text().trim();
          if (value) attributes[attr] = value;
        }
      });

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

      const shopifyCategory = mapToShopifyCategory(product.categories);
      const variantConfig = getVariantConfig(product.categories);

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
          {id: 'barcode', title: 'Barcode'},
          {id: 'weight', title: 'Weight'},
          {id: 'weight_unit', title: 'Weight Unit'},
          {id: 'inventory_tracker', title: 'Inventory Tracker'},
          {id: 'inventory_quantity', title: 'Inventory Qty'},
          {id: 'inventory_policy', title: 'Inventory Policy'},
          {id: 'fulfillment_service', title: 'Fulfillment Service'},
          {id: 'image_src', title: 'Image Src'},
          {id: 'image_position', title: 'Image Position'},
          {id: 'image_alt_text', title: 'Image Alt Text'},
          {id: 'variant_image', title: 'Variant Image'},
          {id: 'gift_card', title: 'Gift Card'},
          {id: 'seo_title', title: 'SEO Title'},
          {id: 'seo_description', title: 'SEO Description'},
          {id: 'status', title: 'Status'}
        ]
      });

      const handle = product.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

      const bodyHtml = `
<div class="product-description">
  <div class="description">
    <p>${product.description}</p>
  </div>
  <div class="specifications">
    <h2>Ürün Özellikleri</h2>
    <table>
      <tbody>
        ${Object.entries(product.attributes)
          .map(([key, value]) => `
            <tr>
              <th>${key}</th>
              <td>${value}</td>
            </tr>
          `).join('')}
      </tbody>
    </table>
  </div>
</div>`;

      // Ana ürün kaydı
      const mainRecord = {
        handle,
        title: product.title,
        body_html: bodyHtml,
        vendor: product.brand,
        product_category: shopifyCategory,
        type: shopifyCategory.split(' > ').pop() || 'Clothing',
        tags: product.categories.join(','),
        published: 'TRUE',
        sku: `${handle}-1`,
        price: product.price,
        requires_shipping: 'TRUE',
        taxable: 'TRUE',
        barcode: '',
        weight: '500',
        weight_unit: 'g',
        inventory_tracker: 'shopify',
        inventory_quantity: variantConfig.defaultStock.toString(),
        inventory_policy: 'continue',
        fulfillment_service: 'manual',
        image_src: product.images[0],
        image_position: '1',
        image_alt_text: product.title,
        gift_card: 'FALSE',
        seo_title: product.title,
        seo_description: product.description.substring(0, 320),
        status: 'active'
      };

      const records = [mainRecord];

      // Varyant kayıtları
      if (product.variants.sizes.length > 0 || product.variants.colors.length > 0) {
        const sizes = product.variants.sizes.filter(Boolean);
        const colors = product.variants.colors.filter(Boolean);

        if (sizes.length > 0 || colors.length > 0) {
          // Ana kayıtta option ayarları
          if (sizes.length > 0 && variantConfig.sizeLabel) {
            mainRecord.option1_name = variantConfig.sizeLabel;
            mainRecord.option1_value = sizes[0];
          }

          if (colors.length > 0 && variantConfig.colorLabel) {
            mainRecord.option2_name = variantConfig.colorLabel;
            mainRecord.option2_value = colors[0];
          }

          // Size varyantları
          for (let i = 1; i < sizes.length; i++) {
            records.push({
              ...mainRecord,
              body_html: '',
              option1_value: sizes[i],
              sku: `${handle}-size-${i}`,
              inventory_quantity: variantConfig.defaultStock.toString(),
              image_position: ''
            });
          }

          // Renk varyantları
          for (let i = 1; i < colors.length; i++) {
            const variantImage = product.images[i] || product.images[0];
            records.push({
              ...mainRecord,
              body_html: '',
              option2_value: colors[i],
              sku: `${handle}-color-${i}`,
              inventory_quantity: variantConfig.defaultStock.toString(),
              image_src: variantImage,
              image_position: '',
              variant_image: variantImage
            });
          }
        }
      }

      // Ek görsel kayıtları
      product.images.slice(1).forEach((image, index) => {
        if (image) {
          records.push({
            handle,
            title: product.title,
            image_src: image,
            image_position: (index + 2).toString(),
            image_alt_text: `${product.title} - Görsel ${index + 2}`,
            published: 'TRUE',
            status: 'active'
          });
        }
      });

      await csvWriter.writeRecords(records);
      console.log("CSV başarıyla oluşturuldu");
      res.download('products.csv');

    } catch (error) {
      console.error("CSV export hatası:", error);
      const { status, message, details } = handleError(error);
      res.status(status).json({ message, details });
    }
  });

  return httpServer;
}