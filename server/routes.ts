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

// Routes kısmındaki kategori çekme bölümünü güncelle
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

      const categoryConfig = getCategoryConfig(categories);

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
        status: 'active',
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
        gift_card: 'FALSE'
      };

      const records = [mainRecord];

      // Varyant kayıtları
      if (product.variants.sizes.length > 0 || product.variants.colors.length > 0) {
        // Size varyantları
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

        // Renk varyantları
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
      product.images.slice(1).forEach((image, index) => {
        if (image) {
          records.push({
            handle,
            title: product.title,
            product_category: shopifyCategory,
            type: mainRecord.type,
            published: 'TRUE',
            status: 'active',
            image_src: image,
            image_position: (index + 2).toString(),
            image_alt_text: `${product.title} - Görsel ${index + 2}`
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

function mapToShopifyCategory(categories: string[]): string {
  // Shopify'ın resmi kategori taksonomisi
  const shopifyCategories = {
    // Giyim & Aksesuar
    "erkek": "Apparel & Accessories > Clothing > Men's Clothing",
    "kadın": "Apparel & Accessories > Clothing > Women's Clothing",
    "çocuk": "Apparel & Accessories > Clothing > Baby & Toddler Clothing",
    "tişört": "Apparel & Accessories > Clothing > Shirts & Tops",
    "gömlek": "Apparel & Accessories > Clothing > Shirts & Tops",
    "pantolon": "Apparel & Accessories > Clothing > Pants",
    "elbise": "Apparel & Accessories > Clothing > Dresses",
    "etek": "Apparel & Accessories > Clothing > Skirts",
    "ceket": "Apparel & Accessories > Clothing > Outerwear",
    "kazak": "Apparel & Accessories > Clothing > Sweaters",

    // Ayakkabı
    "ayakkabı": "Apparel & Accessories > Shoes",
    "spor ayakkabı": "Apparel & Accessories > Shoes > Athletic Shoes",
    "sneaker": "Apparel & Accessories > Shoes > Athletic Shoes",
    "bot": "Apparel & Accessories > Shoes > Boots",
    "sandalet": "Apparel & Accessories > Shoes > Sandals",

    // Çanta & Aksesuar
    "çanta": "Apparel & Accessories > Handbags, Wallets & Cases > Handbags",
    "cüzdan": "Apparel & Accessories > Handbags, Wallets & Cases > Wallets & Money Clips",
    "kartlık": "Apparel & Accessories > Handbags, Wallets & Cases > Wallets & Money Clips",
    "kemer": "Apparel & Accessories > Clothing Accessories > Belts",
    "şapka": "Apparel & Accessories > Clothing Accessories > Hats & Caps",

    // Takı & Saat
    "kolye": "Jewelry & Watches > Jewelry > Necklaces",
    "bileklik": "Jewelry & Watches > Jewelry > Bracelets",
    "yüzük": "Jewelry & Watches > Jewelry > Rings",
    "saat": "Jewelry & Watches > Watches",

    // Kozmetik & Bakım
    "parfüm": "Health & Beauty > Personal Care > Cosmetics > Fragrances",
    "makyaj": "Health & Beauty > Personal Care > Cosmetics",
    "cilt bakımı": "Health & Beauty > Personal Care > Skin Care",

    // Elektronik
    "telefon": "Electronics > Communications > Telephony > Mobile Phones",
    "tablet": "Electronics > Computers > Tablets",
    "laptop": "Electronics > Computers > Laptops",

    // Ev & Yaşam
    "nevresim": "Home & Garden > Linens > Bedding",
    "masa örtüsü": "Home & Garden > Linens > Table Linens",
    "havlu": "Home & Garden > Linens > Towels"
  };

  // Normalize kategorileri
  const normalizedCategories = categories.map(cat => cat.toLowerCase().trim());

  // Kategori eşleştirme
  for (const [key, value] of Object.entries(shopifyCategories)) {
    if (normalizedCategories.some(cat => cat.includes(key))) {
      return value;
    }
  }

  // Cinsiyet bazlı varsayılan kategori
  if (normalizedCategories.some(cat => cat.includes('erkek'))) {
    return "Apparel & Accessories > Clothing > Men's Clothing";
  }
  if (normalizedCategories.some(cat => cat.includes('kadın'))) {
    return "Apparel & Accessories > Clothing > Women's Clothing";
  }

  // Genel varsayılan kategori
  return "Apparel & Accessories > Clothing";
}

function getVariantConfig(categories: string[]): {
  sizeLabel: string;
  colorLabel: string;
  defaultStock: number;
  hasVariants: boolean;
} {
  const categoryType = categories.map(c => c.toLowerCase()).join(' ');

  // Kategori bazlı varyant yapılandırması
  if (categoryType.includes('ayakkabı') || categoryType.includes('sneaker')) {
    return {
      sizeLabel: 'Numara',
      colorLabel: 'Renk',
      defaultStock: 50,
      hasVariants: true
    };
  } else if (categoryType.includes('cüzdan') || categoryType.includes('çanta')) {
    return {
      sizeLabel: '',
      colorLabel: 'Renk',
      defaultStock: 100,
      hasVariants: true
    };
  } else {
    // Giyim için varsayılan
    return {
      sizeLabel: 'Beden',
      colorLabel: 'Renk',
      defaultStock: 75,
      hasVariants: true
    };
  }
}