import type { Express } from "express";
import { createServer } from "http";
import { storage } from "./storage";
import * as cheerio from "cheerio";
import { urlSchema, type InsertProduct } from "@shared/schema";
import { ZodError } from "zod";
import { createObjectCsvWriter } from "csv-writer";
import fetch from "node-fetch";
import { TrendyolScrapingError, URLValidationError, ProductDataError, handleError } from "./errors";

export async function registerRoutes(app: Express) {
  const httpServer = createServer(app);

  app.post("/api/scrape", async (req, res) => {
    try {
      console.log("Scraping başlatıldı:", req.body);

      const { url } = urlSchema.parse(req.body);

      // First check if we already have this product
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

      // Schema.org verisini parse et
      const schemaScript = $('script[type="application/ld+json"]').first().html();
      if (!schemaScript) {
        throw new ProductDataError("Ürün şeması bulunamadı", "schema");
      }

      let schema;
      try {
        schema = JSON.parse(schemaScript);
      } catch (error) {
        throw new ProductDataError("Ürün şeması geçersiz", "schema");
      }

      // Temel ürün bilgileri
      const title = schema.name;
      const description = schema.description;
      const price = parseFloat(schema.offers.price);
      // %15 kar ekle
      const priceWithProfit = parseFloat((price * 1.15).toFixed(2));

      if (!title || !description || isNaN(price)) {
        throw new ProductDataError("Temel ürün bilgileri eksik", "basicInfo");
      }

      // Ürün özellikleri
      const attributes: Record<string, string> = {};
      schema.additionalProperty.forEach((prop: any) => {
        attributes[prop.name] = prop.unitText;
      });

      // Kategori bilgisi
      const categories = schema.breadcrumb.itemListElement
        .map((item: any) => item.item.name)
        .filter((name: string) => name !== "Trendyol");

      if (categories.length === 0) {
        throw new ProductDataError("Kategori bilgisi bulunamadı", "categories");
      }

      // Tüm ürün görselleri
      const images = schema.image.contentUrl;
      if (!images || images.length === 0) {
        throw new ProductDataError("Ürün görselleri bulunamadı", "images");
      }

      // Beden ve renk varyantları
      const variants = {
        sizes: schema.hasVariant
          ? schema.hasVariant.map((variant: any) => variant.size).flat().filter(Boolean)
          : [],
        colors: schema.hasVariant
          ? schema.hasVariant.map((variant: any) => variant.color).filter(Boolean)
          : []
      };

      // Debug için log
      console.log("Çekilen veriler:", {
        title,
        price,
        priceWithProfit,
        attributes: Object.keys(attributes).length,
        attributesList: attributes,
        categories,
        tags: [],
        images: images.length,
        imageUrls: images,
        variants
      });

      const product: InsertProduct = {
        url,
        title,
        description,
        price: priceWithProfit,
        basePrice: price,
        images,
        variants,
        attributes,
        categories,
        tags: []
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

  // CSV export endpoint güncellemesi
  app.post("/api/export", async (req, res) => {
    try {
      console.log("CSV export başlatıldı");
      const { product } = req.body;

      if (!product) {
        throw new ProductDataError("Ürün verisi bulunamadı", "product");
      }

      const csvWriter = createObjectCsvWriter({
        path: 'products.csv',
        header: [
          {id: 'handle', title: 'Handle'},
          {id: 'title', title: 'Title'},
          {id: 'body', title: 'Body (HTML)'},
          {id: 'vendor', title: 'Vendor'},
          {id: 'product_category', title: 'Product category'},
          {id: 'type', title: 'Type'},
          {id: 'tags', title: 'Tags'},
          {id: 'published', title: 'Published on online store'},
          {id: 'status', title: 'Status'},
          {id: 'sku', title: 'SKU'},
          {id: 'barcode', title: 'Barcode'},
          {id: 'option1_name', title: 'Option1 name'},
          {id: 'option1_value', title: 'Option1 value'},
          {id: 'option2_name', title: 'Option2 name'},
          {id: 'option2_value', title: 'Option2 value'},
          {id: 'option3_name', title: 'Option3 name'},
          {id: 'option3_value', title: 'Option3 value'},
          {id: 'price', title: 'Price'},
          {id: 'price_international', title: 'Price / International'},
          {id: 'compare_at_price', title: 'Compare-at price'},
          {id: 'compare_at_price_international', title: 'Compare-at price / International'},
          {id: 'weight', title: 'Weight value (grams)'},
          {id: 'weight_unit', title: 'Weight unit for display'},
          {id: 'requires_shipping', title: 'Requires shipping'},
          {id: 'fulfillment_service', title: 'Fulfillment service'},
          {id: 'image_src', title: 'Product image URL'},
          {id: 'image_position', title: 'Image position'},
          {id: 'image_alt_text', title: 'Image alt text'},
          {id: 'variant_image', title: 'Variant image URL'},
          {id: 'gift_card', title: 'Gift card'},
          {id: 'seo_title', title: 'SEO title'},
          {id: 'seo_description', title: 'SEO description'},
          {id: 'google_category', title: 'Google Shopping / Google product category'},
          {id: 'gender', title: 'Google Shopping / Gender'},
          {id: 'age_group', title: 'Google Shopping / Age group'}
        ]
      });

      // HTML formatında ürün detayları oluştur
      let htmlDescription = `<div class="product-description">
        <h2>Ürün Açıklaması</h2>
        <p>${product.description}</p>`;

      // Ürün özelliklerini ekle
      if (Object.keys(product.attributes).length > 0) {
        htmlDescription += `
        <h2>Ürün Özellikleri</h2>
        <table class="product-specs">
          <tbody>`;

        for (const [key, value] of Object.entries(product.attributes)) {
          htmlDescription += `
            <tr>
              <th>${key}</th>
              <td>${value}</td>
            </tr>`;
        }

        htmlDescription += `
          </tbody>
        </table>
        </div>`;
      }

      const records = [];

      // Ana ürün ve görselleri
      product.images.forEach((image: string, index: number) => {
        records.push({
          handle: product.title.toLowerCase().replace(/\s+/g, '-'),
          title: product.title,
          body: htmlDescription,
          vendor: 'Trendyol',
          product_category: product.categories.join(' > '),
          type: product.categories[product.categories.length - 1] || 'Giyim',
          tags: product.tags.join(', '),
          published: 'TRUE',
          status: 'active',
          sku: '',
          barcode: '',
          option1_name: product.variants.sizes.length > 0 ? 'Size' : '',
          option1_value: product.variants.sizes[0] || '',
          option2_name: product.variants.colors.length > 0 ? 'Color' : '',
          option2_value: product.variants.colors[0] || '',
          option3_name: '',
          option3_value: '',
          price: product.price,
          price_international: '',
          compare_at_price: product.basePrice,
          compare_at_price_international: '',
          weight: '500',
          weight_unit: 'g',
          requires_shipping: 'TRUE',
          fulfillment_service: 'manual',
          image_src: image,
          image_position: index + 1,
          image_alt_text: `${product.title} - Görsel ${index + 1}`,
          variant_image: '',
          gift_card: 'FALSE',
          seo_title: product.title,
          seo_description: product.description.substring(0, 320),
          google_category: product.categories.join(' > '),
          gender: 'Unisex',
          age_group: 'Adult'
        });
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