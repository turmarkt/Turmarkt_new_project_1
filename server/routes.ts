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
        console.log("Schema.org verisi:", schema);

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

      if (!title || !description || isNaN(price)) {
        throw new ProductDataError("Temel ürün bilgileri eksik", "basicInfo");
      }

      // %15 kar ekle
      const priceWithProfit = parseFloat((price * 1.15).toFixed(2));

      // Ürün özellikleri
      const attributes: Record<string, string> = {};
      if (Array.isArray(schema.additionalProperty)) {
        schema.additionalProperty.forEach((prop: any) => {
          if (prop.name && prop.unitText) {
            attributes[prop.name] = prop.unitText;
          }
        });
      } else {
        console.warn("additionalProperty bir dizi değil:", schema.additionalProperty);
      }

      // Kategori bilgisi
      let categories: string[] = [];

      try {
        // Önce schema.org'dan dene
        if (schema.breadcrumb?.itemListElement) {
          categories = schema.breadcrumb.itemListElement
            .map((item: any) => {
              return item.item?.name || item.name;
            })
            .filter((name: string | null) => name && name !== "Trendyol");
        }

        // Schema.org'dan alınamadıysa DOM'dan dene
        if (categories.length === 0) {
          console.warn("Kategoriler schema.org'dan alınamadı, DOM'dan çekiliyor");

          // Ana kategori yolu
          categories = $("div.product-path span")
            .map((_, el) => $(el).text().trim())
            .get()
            .filter(cat => cat !== ">" && cat !== "Trendyol");

          // Alternatif breadcrumb
          if (categories.length === 0) {
            categories = $("div.breadcrumb-wrapper span")
              .map((_, el) => $(el).text().trim())
              .get()
              .filter(cat => cat !== ">" && cat !== "Trendyol");
          }
        }

        // Yine bulunamadıysa son bir deneme
        if (categories.length === 0) {
          const productType = schema.pattern || schema["@type"];
          if (productType) {
            categories = [productType];
          }
        }

        if (categories.length === 0) {
          throw new ProductDataError("Kategori bilgisi bulunamadı", "categories");
        }

        console.log("Bulunan kategoriler:", categories);

      } catch (error) {
        console.error("Kategori çekme hatası:", error);
        throw new ProductDataError("Kategori bilgisi işlenirken hata oluştu", "categories");
      }


      // Tüm ürün görselleri
      let images: string[] = [];
      if (schema.image?.contentUrl) {
        images = Array.isArray(schema.image.contentUrl)
          ? schema.image.contentUrl
          : [schema.image.contentUrl];
      }

      if (images.length === 0) {
        console.warn("Görseller schema'dan alınamadı, DOM'dan çekiliyor");
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
      }

      if (images.length === 0) {
        throw new ProductDataError("Ürün görselleri bulunamadı", "images");
      }

      // Beden ve renk varyantları
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
        console.warn("Beden bilgisi schema'dan alınamadı, DOM'dan çekiliyor");
        variants.sizes = $(".sp-itm:not(.so)")
          .map((_, el) => $(el).text().trim())
          .get();
      }

      if (variants.colors.length === 0) {
        console.warn("Renk bilgisi schema'dan alınamadı, DOM'dan çekiliyor");
        variants.colors = $(".slc-txt")
          .map((_, el) => $(el).text().trim())
          .get()
          .filter(Boolean);
      }

      // Debug için log
      console.log("Çekilen veriler:", {
        title,
        price,
        priceWithProfit,
        attributes: Object.keys(attributes).length,
        attributesList: attributes,
        categories,
        images: images.length,
        imageUrls: images,
        variants
      });

      const product: InsertProduct = {
        url,
        title,
        description,
        price: priceWithProfit.toString(), // Convert to string for schema
        basePrice: price.toString(), // Convert to string for schema
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
          {id: 'type', title: 'Type'},
          {id: 'tags', title: 'Tags'},
          {id: 'published', title: 'Published'},
          {id: 'variant_grams', title: 'Variant Grams'},
          {id: 'variant_inventory_tracker', title: 'Variant Inventory Tracker'},
          {id: 'variant_inventory_qty', title: 'Variant Inventory Qty'},
          {id: 'variant_inventory_policy', title: 'Variant Inventory Policy'},
          {id: 'variant_fulfillment_service', title: 'Variant Fulfillment Service'},
          {id: 'variant_price', title: 'Variant Price'},
          {id: 'variant_compare_at_price', title: 'Variant Compare At Price'},
          {id: 'variant_requires_shipping', title: 'Variant Requires Shipping'},
          {id: 'variant_taxable', title: 'Variant Taxable'},
          {id: 'variant_barcode', title: 'Variant Barcode'},
          {id: 'image_src', title: 'Image Src'},
          {id: 'image_position', title: 'Image Position'},
          {id: 'image_alt_text', title: 'Image Alt Text'},
          {id: 'gift_card', title: 'Gift Card'},
          {id: 'seo_title', title: 'SEO Title'},
          {id: 'seo_description', title: 'SEO Description'},
          {id: 'google_shopping_google_product_category', title: 'Google Shopping / Google Product Category'},
          {id: 'google_shopping_gender', title: 'Google Shopping / Gender'},
          {id: 'google_shopping_age_group', title: 'Google Shopping / Age Group'},
          {id: 'google_shopping_mpn', title: 'Google Shopping / MPN'},
          {id: 'google_shopping_adwords_grouping', title: 'Google Shopping / AdWords Grouping'},
          {id: 'google_shopping_adwords_labels', title: 'Google Shopping / AdWords Labels'},
          {id: 'google_shopping_condition', title: 'Google Shopping / Condition'},
          {id: 'google_shopping_custom_product', title: 'Google Shopping / Custom Product'},
          {id: 'variant_image', title: 'Variant Image'},
          {id: 'variant_weight_unit', title: 'Variant Weight Unit'},
          {id: 'variant_tax_code', title: 'Variant Tax Code'},
          {id: 'cost_per_item', title: 'Cost per item'},
          {id: 'status', title: 'Status'},
          {id: 'option1_name', title: 'Option1 Name'},
          {id: 'option1_value', title: 'Option1 Value'},
          {id: 'option2_name', title: 'Option2 Name'},
          {id: 'option2_value', title: 'Option2 Value'},
          {id: 'option3_name', title: 'Option3 Name'},
          {id: 'option3_value', title: 'Option3 Value'}
        ]
      });

      // Ana ürün kaydı
      const handle = product.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

      const mainRecord = {
        handle,
        title: product.title,
        body: `<div style="font-family: system-ui, sans-serif; max-width: 800px; margin: 0 auto;">
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
        </div>`,
        vendor: product.title.split(' ')[0],
        type: product.categories[0] || 'Giyim',
        tags: [...product.categories, ...product.tags].join(','),
        published: 'true',
        variant_grams: '500',
        variant_inventory_tracker: 'shopify',
        variant_inventory_qty: '10',
        variant_inventory_policy: 'deny',
        variant_fulfillment_service: 'manual',
        variant_price: product.price,
        variant_compare_at_price: product.basePrice,
        variant_requires_shipping: 'true',
        variant_taxable: 'true',
        variant_barcode: '',
        image_src: product.images[0] || '',
        image_position: '1',
        image_alt_text: product.title,
        gift_card: 'false',
        seo_title: product.title,
        seo_description: product.description.substring(0, 320),
        google_shopping_google_product_category: product.categories.join(' > '),
        google_shopping_gender: 'unisex',
        google_shopping_age_group: 'adult',
        google_shopping_mpn: handle,
        google_shopping_adwords_grouping: product.categories[0] || '',
        google_shopping_adwords_labels: product.categories.join(','),
        google_shopping_condition: 'new',
        google_shopping_custom_product: 'false',
        variant_image: product.images[0] || '',
        variant_weight_unit: 'g',
        variant_tax_code: '',
        cost_per_item: '',
        status: 'active',
        option1_name: product.variants.sizes.length > 0 ? 'Size' : '',
        option1_value: product.variants.sizes[0] || '',
        option2_name: product.variants.colors.length > 0 ? 'Color' : '',
        option2_value: product.variants.colors[0] || '',
        option3_name: '',
        option3_value: ''
      };

      const records = [mainRecord];

      // Varyantları ekle
      if (product.variants.sizes.length > 0 || product.variants.colors.length > 0) {
        const sizes = product.variants.sizes.length > 0 ? product.variants.sizes : [''];
        const colors = product.variants.colors.length > 0 ? product.variants.colors : [''];

        sizes.forEach((size, sIndex) => {
          colors.forEach((color, cIndex) => {
            if (sIndex === 0 && cIndex === 0) return; // Ana ürünü atla

            records.push({
              ...mainRecord,
              title: mainRecord.title,
              option1_value: size,
              option2_value: color,
              variant_image: product.images[cIndex] || product.images[0] || '',
              image_position: ''
            });
          });
        });
      }

      // Ek görselleri ekle
      product.images.slice(1).forEach((image, index) => {
        records.push({
          ...mainRecord,
          variant_inventory_qty: '',
          variant_price: '',
          variant_image: '',
          image_src: image,
          image_position: (index + 2).toString(),
          option1_value: '',
          option2_value: ''
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