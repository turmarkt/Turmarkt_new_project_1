import type { Express } from "express";
import { createServer } from "http";
import { storage } from "./storage";
import * as cheerio from "cheerio";
import { urlSchema, type InsertProduct } from "@shared/schema";
import { ZodError } from "zod";
import { createObjectCsvWriter } from "csv-writer";
import fetch from "node-fetch";

export async function registerRoutes(app: Express) {
  const httpServer = createServer(app);

  app.post("/api/scrape", async (req, res) => {
    try {
      const { url } = urlSchema.parse(req.body);

      // First check if we already have this product
      const existing = await storage.getProduct(url);
      if (existing) {
        return res.json(existing);
      }

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error("Failed to fetch product page");
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      // Temel ürün bilgileri
      const title = $("h1.pr-new-br").text().trim();
      const description = $("div.detail-border-container").text().trim();
      const price = parseFloat($("span.prc-dsc").text().replace("TL", "").trim());
      // %15 kar ekle
      const priceWithProfit = parseFloat((price * 1.15).toFixed(2));

      // Ürün özellikleri
      const attributes: Record<string, string> = {};
      $("div.detail-attr-container div.detail-attr-item").each((_, el) => {
        const key = $(el).find(".detail-attr-key").text().trim();
        const value = $(el).find(".detail-attr-value").text().trim();
        if (key && value) {
          attributes[key] = value;
        }
      });

      // Kategori bilgisi
      const categories = $("div.product-path span")
        .map((_, el) => $(el).text().trim())
        .get()
        .filter(cat => cat !== ">");

      // Ürün etiketleri
      const tags = $(".product-tag")
        .map((_, el) => $(el).text().trim())
        .get();

      // Tüm ürün görselleri
      const images: string[] = [];

      // Ana ürün görseli
      const mainImage = $("img.detail-section-img").first().attr("src");
      if (mainImage) images.push(mainImage);

      // Galeri görselleri
      $("div.gallery-modal-content img").each((_, el) => {
        const src = $(el).attr("src");
        if (src && !images.includes(src)) {
          images.push(src);
        }
      });

      // Küçük resimler
      $("div.thumb-gallery img").each((_, el) => {
        const src = $(el).attr("src");
        if (src) {
          // Küçük resimleri büyük boyutlu versiyonlarıyla değiştir
          const fullSizeSrc = src.replace("/mnresize/128/192", "");
          if (!images.includes(fullSizeSrc)) {
            images.push(fullSizeSrc);
          }
        }
      });

      // Beden ve renk varyantları
      const variants = {
        sizes: $(".sp-itm:not(.so)")
          .map((_, el) => $(el).text().trim())
          .get(),
        colors: $(".slc-txt")
          .map((_, el) => $(el).text().trim())
          .get()
          .filter(Boolean)
      };

      // Debug için log
      console.log("Çekilen veriler:", {
        title,
        price,
        priceWithProfit,
        attributes: Object.keys(attributes).length,
        attributesList: attributes,
        categories,
        tags,
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
        tags
      };

      const saved = await storage.saveProduct(product);
      res.json(saved);

    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({ message: "Geçersiz URL formatı" });
      } else {
        res.status(500).json({ message: error instanceof Error ? error.message : "Bilinmeyen bir hata oluştu" });
      }
    }
  });

  app.post("/api/export", async (req, res) => {
    try {
      const { product } = req.body;

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
          {id: 'age_group', title: 'Google Shopping / Age group'},
          {id: 'mpn', title: 'Google Shopping / MPN'},
          {id: 'adwords_grouping', title: 'Google Shopping / AdWords Grouping'},
          {id: 'adwords_labels', title: 'Google Shopping / AdWords labels'},
          {id: 'condition', title: 'Google Shopping / Condition'}
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
          age_group: 'Adult',
          mpn: '',
          adwords_grouping: product.categories[product.categories.length - 1] || 'Giyim',
          adwords_labels: product.tags.join(','),
          condition: 'new'
        });
      });

      await csvWriter.writeRecords(records);
      res.download('products.csv');

    } catch (error) {
      if (error instanceof Error) {
        res.status(500).json({ message: error.message });
      } else {
        res.status(500).json({ message: 'Bilinmeyen bir hata oluştu' });
      }
    }
  });

  return httpServer;
}