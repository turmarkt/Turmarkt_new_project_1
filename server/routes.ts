import type { Express } from "express";
import { createServer } from "http";
import { storage } from "./storage";
import * as cheerio from "cheerio";
import { urlSchema, type InsertProduct } from "@shared/schema";
import { ZodError } from "zod";
import { createObjectCsvWriter } from "csv-writer";
import fetch from "node-fetch";
import { TrendyolScrapingError, URLValidationError, ProductDataError, handleError } from "./errors";

function mapToShopifyCategory(categories: string[]): string {
  const categoryMap: { [key: string]: string } = {
    'Giyim': 'Apparel & Accessories',
    'Erkek': 'Apparel & Accessories > Clothing',
    'Kadın': 'Apparel & Accessories > Clothing',
    'T-Shirt': 'Apparel & Accessories > Clothing > Shirts & Tops',
    'Tişört': 'Apparel & Accessories > Clothing > Shirts & Tops',
    'Pantolon': 'Apparel & Accessories > Clothing > Pants',
    'Elbise': 'Apparel & Accessories > Clothing > Dresses',
    'Ayakkabı': 'Apparel & Accessories > Shoes',
    'Çanta': 'Apparel & Accessories > Handbags & Wallets',
    'Aksesuar': 'Apparel & Accessories > Accessories'
  };

  for (const category of categories) {
    const normalizedCategory = category.trim().toLowerCase();
    for (const [key, value] of Object.entries(categoryMap)) {
      if (normalizedCategory.includes(key.toLowerCase())) {
        return value;
      }
    }
  }
  return 'Apparel & Accessories > Clothing';
}

export async function registerRoutes(app: Express) {
  const httpServer = createServer(app);

  app.post("/api/scrape", async (req, res) => {
    try {
      console.log("Scraping başlatıldı:", req.body);
      const { url } = urlSchema.parse(req.body);
      const existing = await storage.getProduct(url);
      if (existing) {
        console.log("Ürün cache'den alındı:", existing.id);
        return res.json(existing);
      }
      console.log("Trendyol'dan veri çekiliyor:", url);
      const response = await fetch(url);
      if (!response.ok) {
        throw new TrendyolScrapingError("Ürün sayfası yüklenemedi", {
          status: response.status,
          statusText: response.statusText
        });
      }
      const html = await response.text();
      const $ = cheerio.load(html);
      const schemaScript = $('script[type="application/ld+json"]').first().html();
      if (!schemaScript) {
        throw new ProductDataError("Ürün şeması bulunamadı", "schema");
      }
      let schema;
      try {
        schema = JSON.parse(schemaScript);
        console.log("Schema.org verisi:", schema);
        if (!schema["@type"] || !schema.name || !schema.offers) {
          throw new ProductDataError("Geçersiz ürün şeması", "schema");
        }
      } catch (error) {
        console.error("Schema parse hatası:", error);
        throw new ProductDataError("Ürün şeması geçersiz", "schema");
      }
      const title = schema.name;
      const description = schema.description;
      const price = parseFloat(schema.offers.price);
      const brand = schema.brand?.name || schema.manufacturer || title.split(' ')[0];
      if (!title || !description || isNaN(price)) {
        throw new ProductDataError("Temel ürün bilgileri eksik", "basicInfo");
      }
      const priceWithProfit = parseFloat((price * 1.15).toFixed(2));
      const attributes: Record<string, string> = {};
      if (Array.isArray(schema.additionalProperty)) {
        schema.additionalProperty.forEach((prop: any) => {
          if (prop.name && prop.unitText) {
            attributes[prop.name] = prop.unitText;
          }
        });
      }
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
          const productType = schema.pattern || schema["@type"];
          if (productType) {
            categories = [productType];
          }
        }
        if (categories.length === 0) {
          throw new ProductDataError("Kategori bilgisi bulunamadı", "categories");
        }
      } catch (error) {
        console.error("Kategori çekme hatası:", error);
        throw new ProductDataError("Kategori bilgisi işlenirken hata oluştu", "categories");
      }
      let images: string[] = [];
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
      const variants = {
        sizes: [] as string[],
        colors: [] as string[]
      };
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
      const product: InsertProduct = {
        url,
        title,
        description,
        price: priceWithProfit.toString(),
        basePrice: price.toString(),
        images,
        variants,
        attributes,
        categories,
        tags: [],
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
          {id: 'option3_name', title: 'Option3 Name'},
          {id: 'option3_value', title: 'Option3 Value'},
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
      const bodyHtml = `<div style="font-family: system-ui, sans-serif;">
          <p style="color: #333; line-height: 1.6;">${product.description}</p>
          <div style="margin-top: 20px;">
            <h2 style="color: #333; font-size: 18px; margin-bottom: 10px;">Ürün Özellikleri</h2>
            <table style="width: 100%; border-collapse: collapse;">
              <tbody>
                ${Object.entries(product.attributes)
                  .map(([key, value]) => `
                    <tr style="border-bottom: 1px solid #eee;">
                      <th style="padding: 8px; text-align: left; color: #666;">${key}</th>
                      <td style="padding: 8px; color: #333;">${value}</td>
                    </tr>
                  `).join('')}
              </tbody>
            </table>
          </div>
        </div>`;
      const mainRecord = {
        handle,
        title: product.title,
        body_html: bodyHtml,
        vendor: product.brand || product.title.split(' ')[0],
        product_category: shopifyCategory,
        type: shopifyCategory.split(' > ').pop() || 'Clothing',
        tags: product.categories.join(','),
        published: 'TRUE',
        option1_name: product.variants.sizes.length > 0 ? 'Size' : '',
        option1_value: product.variants.sizes[0] || '',
        option2_name: product.variants.colors.length > 0 ? 'Color' : '',
        option2_value: product.variants.colors[0] || '',
        option3_name: '',
        option3_value: '',
        sku: `${handle}-1`,
        price: product.price,
        requires_shipping: 'TRUE',
        fulfillment_service: 'manual',
        inventory_quantity: '100',
        inventory_policy: 'continue',
        inventory_tracker: 'shopify',
        taxable: 'TRUE',
        weight: '500',
        weight_unit: 'g',
        image_src: product.images[0],
        image_position: '1',
        image_alt_text: product.title,
        variant_image: '',
        gift_card: 'FALSE',
        seo_title: product.title,
        seo_description: product.description.substring(0, 320),
        status: 'active'
      };
      const records = [mainRecord];
      if (product.variants.sizes.length > 0 || product.variants.colors.length > 0) {
        const sizes = product.variants.sizes.filter(Boolean);
        const colors = product.variants.colors.filter(Boolean);
        if (sizes.length > 0 || colors.length > 0) {
          const variantOptions = sizes.length > 0 ? sizes : [''];
          const colorOptions = colors.length > 0 ? colors : [''];
          variantOptions.forEach((size, sIndex) => {
            colorOptions.forEach((color, cIndex) => {
              if (sIndex === 0 && cIndex === 0) return;
              const variantImage = product.images[cIndex + 1] || product.images[0];
              records.push({
                ...mainRecord,
                body_html: '',
                option1_value: size,
                option2_value: color,
                sku: `${handle}-${sIndex + 1}-${cIndex + 1}`,
                inventory_quantity: '100',
                image_src: variantImage,
                image_position: '',
                image_alt_text: `${product.title} - ${size} ${color}`.trim(),
                variant_image: variantImage
              });
            });
          });
        }
      }
      product.images.slice(1).forEach((image, index) => {
        if (image) {
          records.push({
            handle: mainRecord.handle,
            title: mainRecord.title,
            body_html: '',
            vendor: mainRecord.vendor,
            product_category: mainRecord.product_category,
            type: mainRecord.type,
            published: 'TRUE',
            image_src: image,
            image_position: (index + 2).toString(),
            image_alt_text: `${product.title} - Görsel ${index + 2}`,
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