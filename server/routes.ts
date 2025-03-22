import { ProductAttribute, type ProductAttributes } from "@shared/schema";
import { z } from "zod";
import type { Express } from "express";
import { createServer } from "http";
import { storage } from "./storage";
import * as cheerio from "cheerio";
import { urlSchema, type InsertProduct } from "@shared/schema";
import { TrendyolScrapingError, ProductDataError, handleError } from "./errors";
import fetch from "node-fetch";
import { createObjectCsvWriter } from 'csv-writer';
import { getCategoryConfig } from './category-mapping';
import { tmpdir } from 'os';
import { join } from 'path';

function debug(message: string, ...args: any[]) {
  console.log(`[DEBUG] ${message}`, ...args);
}

function cleanPrice(price: string): number {
  return parseFloat(price.replace(/[^\d,]/g, '').replace(',', '.'));
}

async function fetchProductPage(url: string): Promise<cheerio.CheerioAPI> {
  try {
    // URL'yi normalize et
    if (!url.startsWith('http')) {
      url = 'https://www.' + url.replace(/^www\./, '');
    }

    debug(`Fetching URL: ${url}`);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'cross-site',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
        'Referer': 'https://www.trendyol.com/',
        'Origin': 'https://www.trendyol.com',
        'Connection': 'keep-alive'
      },
      follow: 10,
      redirect: 'follow',
      timeout: 30000
    });

    if (!response.ok) {
      debug(`HTTP error! status: ${response.status}`);
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const html = await response.text();

    if (!html || html.length < 1000) {
      debug("Sayfa içeriği çok kısa veya boş");
      throw new Error("Sayfa içeriği geçersiz");
    }

    debug(`HTML içeriği başarıyla alındı (${html.length} bytes)`);

    // Ürün sayfası kontrolü ekle
    const $ = cheerio.load(html);
    const isProductPage = $('.pr-new-br').length > 0 || $('.product-detail-container').length > 0;

    if (!isProductPage) {
      debug("Geçerli bir ürün sayfası bulunamadı");
      throw new Error("Geçerli bir ürün sayfası değil");
    }

    return $;

  } catch (error: any) {
    debug(`Veri çekme hatası: ${error.message}`);
    debug(`URL: ${url}`);
    debug(`Stack trace: ${error.stack}`);
    throw new TrendyolScrapingError("Sayfa yüklenemedi", {
      status: 500,
      statusText: "Fetch Error",
      details: error.message
    });
  }
}

function normalizeImageUrl(url: string): string {
  try {
    url = url.split('?')[0];

    if (url.match(/\.(mp4|webm|ogg|mov)$/i)) {
      debug(`Video dosyası filtrelendi: ${url}`);
      return '';
    }

    if (!url.match(/\.(jpg|jpeg|png|webp)$/i)) {
      debug(`Desteklenmeyen dosya formatı: ${url}`);
      return '';
    }

    if (url.includes('/ty')) {
      url = `https://cdn.dsmcdn.com${url}`;
    }

    if (url.startsWith('//')) {
      url = 'https:' + url;
    } else if (!url.startsWith('http')) {
      url = 'https://' + url;
    }

    url = url.replace(/\/mnresize\/\d+\/\d+\//, '/');
    url = url.replace(/_\d+x\d+/, '');

    if (!url.includes('_org_zoom')) {
      url = url.replace(/\.(jpg|jpeg|png|webp)$/, '_org_zoom.$1');
    }

    debug(`Normalize edilmiş görsel URL: ${url}`);
    return url;
  } catch (error: any) {
    debug(`URL normalizasyon hatası: ${error.message}`);
    return '';
  }
}

// Kategori parse fonksiyonunu geliştir
function extractCategories($: cheerio.CheerioAPI): { categories: string[], fullPath: string[] } {
  const categories: string[] = [];
  const fullPath: string[] = [];

  // JavaScript state'den detaylı kategori yolunu al
  $('script').each((_, element) => {
    const scriptContent = $(element).html() || '';
    if (scriptContent.includes('window.__PRODUCT_DETAIL_APP_INITIAL_STATE__')) {
      try {
        const match = scriptContent.match(/window\.__PRODUCT_DETAIL_APP_INITIAL_STATE__\s*=\s*({.*?});/s);
        if (match) {
          const data = JSON.parse(match[1]);
          if (data.product?.category?.hierarchy) {
            data.product.category.hierarchy.forEach((cat: any) => {
              if (cat.name) {
                categories.push(cat.name);
                fullPath.push(cat.name);
              }
            });
            debug(`Detaylı kategori yolu bulundu: ${fullPath.join(' > ')}`);
          } else if (data.product?.category?.name) {
            // Ana kategori adını al
            categories.push(data.product.category.name);
            fullPath.push(data.product.category.name);
            debug(`Ana kategori bulundu: ${data.product.category.name}`);
          }
        }
      } catch (error) {
        debug(`State parse hatası: ${error}`);
      }
    }
  });

  // Eğer state'den kategori bulunamazsa breadcrumb'dan al
  if (categories.length === 0) {
    $('.breadcrumb-wrapper .breadcrumb li').each((_, el) => {
      const category = $(el).text().trim();
      if (category && !category.includes('>') && category !== 'Anasayfa') {
        categories.push(category);
        fullPath.push(category);
      }
    });
    debug(`Breadcrumb'dan kategoriler alındı: ${categories.join(', ')}`);
  }

  // Alternatif kategori çekme yöntemi
  if (categories.length === 0) {
    $('.product-container .product-detail-container [data-tracker-id="Category Info"]').each((_, el) => {
      const category = $(el).text().trim();
      if (category) {
        const parts = category.split('>').map(part => part.trim());
        categories.push(...parts);
        fullPath.push(...parts);
      }
    });
    debug(`Ürün detayından kategoriler alındı: ${categories.join(', ')}`);
  }

  // Son çare: Sayfa başlığından kategori çıkarımı
  if (categories.length === 0) {
    const pageTitle = $('title').text().trim();
    const titleMatch = pageTitle.match(/(?:in|de) ([^>]+?) (?:Modelleri|Fiyatları|Ürünleri)/i);
    if (titleMatch && titleMatch[1]) {
      categories.push(titleMatch[1].trim());
      fullPath.push(titleMatch[1].trim());
      debug(`Sayfa başlığından kategori çıkarıldı: ${titleMatch[1]}`);
    }
  }

  // Hala kategori bulunamadıysa, ürün başlığından ipucu ara
  if (categories.length === 0) {
    const productTitle = $('.pr-new-br').text().trim() || $('.prdct-desc-cntnr-name').text().trim();
    if (productTitle) {
      let defaultCategory = 'Diğer';
      if (productTitle.toLowerCase().includes('saat')) defaultCategory = 'Saat';
      else if (productTitle.toLowerCase().includes('ayakkabı')) defaultCategory = 'Ayakkabı';
      else if (productTitle.toLowerCase().includes('çanta')) defaultCategory = 'Çanta';
      categories.push(defaultCategory);
      fullPath.push(defaultCategory);
      debug(`Ürün başlığından varsayılan kategori belirlendi: ${defaultCategory}`);
    }
  }

  return {
    categories: categories.length > 0 ? categories : ['Diğer'],
    fullPath: fullPath.length > 0 ? fullPath : ['Diğer']
  };
}

async function scrapeProduct(url: string): Promise<InsertProduct> {
  debug("Scraping başlatıldı");

  try {
    const $ = await fetchProductPage(url);

    // Ürün verilerini parse et
    const productData = $('script').map((_, element) => {
      const content = $(element).html() || '';
      if (content.includes('window.__PRODUCT_DETAIL_APP_INITIAL_STATE__')) {
        try {
          const match = content.match(/window\.__PRODUCT_DETAIL_APP_INITIAL_STATE__\s*=\s*({.*?});/s);
          if (match) {
            return JSON.parse(match[1]);
          }
        } catch (error) {
          debug(`JSON parse hatası: ${error}`);
        }
      }
      return null;
    }).get().find(data => data !== null);

    if (!productData || !productData.product) {
      throw new Error("Ürün verisi bulunamadı");
    }

    const brand = productData.product.brand?.name || $('.pr-new-br span').first().text().trim() ||
                  $('h1.pr-new-br').first().text().trim();
    debug(`Marka: ${brand}`);

    const productName = productData.product.name || $('.prdct-desc-cntnr-name').text().trim() ||
                       $('.pr-in-w').first().text().trim()
                       .replace(/\d+(\.\d+)?\s*TL.*$/, '')
                       .replace(/\d+,\d+.*$/, '')
                       .replace(/\d+\.?\d*,?\d*\s*(TL)?/g, '')  // More comprehensive price removal
                       .replace(new RegExp(brand, 'gi'), '')
                       .trim();
    debug(`Ürün adı: ${productName}`);

    let title = '';
    if (brand && productName) {
      // Put brand at the start, clean up the title
      title = `${brand} ${productName}`
        .replace(/\d+\.?\d*,?\d*\s*(TL)?/g, '')  // Remove any remaining price
        .replace(/\s+/g, ' ')  // Normalize spaces
        .replace(new RegExp(`${brand}.*${brand}`, 'gi'), brand)  // Remove duplicate brand mentions
        .replace(/(.+?)\s+\1/gi, '$1')  // Remove duplicate phrases
        .replace(/\s*,\s*$/, '')  // Remove trailing comma
        .trim();
    } else {
      throw new ProductDataError("Ürün başlığı oluşturulamadı", "title");
    }

    if (!title) {
      throw new ProductDataError("Ürün başlığı bulunamadı", "title");
    }

    // Fiyat bilgisini al
    const price = productData.product.price?.discountedPrice?.value || 
                  productData.product.price?.sellingPrice?.value;

    if (!price) {
      throw new ProductDataError("Ürün fiyatı bulunamadı", "price");
    }

    const basePrice = price;
    const finalPrice = (basePrice * 1.15).toFixed(2);
    debug(`İşlenmiş fiyat: ${finalPrice} (baz: ${basePrice})`);

    // Kategori bilgisini güncelle
    const categoryInfo = extractCategories($);

    // Görselleri al
    const images = new Set<string>();
    if (productData.product.images) {
      productData.product.images.forEach((img: any) => {
        const imgUrl = normalizeImageUrl(typeof img === 'string' ? img : img.url);
        if (imgUrl) images.add(imgUrl);
      });
    }

    const uniqueImages = Array.from(images).filter((url, index) => {
      try {
        new URL(url);
        return index < 8; // Maksimum 8 görsel al
      } catch {
        return false;
      }
    });

    // Ürün özelliklerini çek
    const attributes: Record<string, string> = {};

    // Öne Çıkan Özellikler bölümünü çek
    $('.details-section').each((_, section) => {
      const $section = $(section);
      const title = $section.find('.details-section-title').text().trim();

      if (title === 'Öne Çıkan Özellikler') {
        $section.find('.details-property').each((_, property) => {
          const $property = $(property);
          const key = $property.find('.details-property-key').text().trim();
          const value = $property.find('.details-property-value').text().trim();
          if (key && value) {
            attributes[key] = value;
            debug(`Özellik bulundu: ${key} = ${value}`);
          }
        });
      }
    });

    // Ürün detaylarından özellik çek
    $('.product-feature-container .featured-item').each((_, item) => {
      const $item = $(item);
      const key = $item.find('.feature-name').text().trim();
      const value = $item.find('.feature-value').text().trim();
      if (key && value) {
        attributes[key] = value;
        debug(`Özellik bulundu: ${key} = ${value}`);
      }
    });

    // Alternatif özellik yapısını kontrol et
    $('.product-information-items li').each((_, item) => {
      const $item = $(item);
      const text = $item.text().trim();
      const [key, value] = text.split(':').map(part => part.trim());
      if (key && value) {
        attributes[key] = value;
        debug(`Özellik bulundu: ${key} = ${value}`);
      }
    });

    // JSON-LD'den özellikleri çek
    $('script[type="application/ld+json"]').each((_, element) => {
      try {
        const data = JSON.parse($(element).html() || '');
        if (data.additionalProperty) {
          data.additionalProperty.forEach((prop: any) => {
            if (prop.name && prop.value) {
              attributes[prop.name] = prop.value;
              debug(`JSON-LD'den özellik bulundu: ${prop.name} = ${prop.value}`);
            }
          });
        }
      } catch (error) {
        debug(`JSON parse hatası: ${error}`);
      }
    });

    const product: InsertProduct = {
      url,
      title,
      description: productData.product.description || $('.product-description').text().trim() || "",
      price: finalPrice.toString(),
      basePrice: basePrice.toString(),
      images: uniqueImages,
      video: null,
      variants: {
        sizes: [],
        colors: [],
        stockInfo: {}
      },
      attributes, // Güncellenmiş attributes objesini kullan
      categories: categoryInfo.categories,
      fullCategoryPath: categoryInfo.fullPath,
      tags: categoryInfo.categories
    };

    return product;

  } catch (error: any) {
    if (error instanceof ProductDataError) {
      throw error;
    }
    throw new TrendyolScrapingError("Ürün verisi işlenirken hata oluştu", {
      status: 500,
      statusText: "Processing Error",
      details: error.message
    });
  }
}

function parseCategoryPath(categories: string[]): string {
  return categories
    .map(cat => cat.trim())
    .filter(cat => cat && !cat.includes('>'))
    .join(' > ');
}

const urlSchema = z.object({
  url: z.string().transform(val => {
    if (!val.startsWith('http')) {
      return 'https://www.' + val.replace(/^www\./, '');
    }
    return val;
  })
});

export async function registerRoutes(app: Express) {
  const httpServer = createServer(app);

  app.post("/api/scrape", async (req, res) => {
    try {
      debug("Scrape isteği alındı");
      const { url } = urlSchema.parse(req.body);

      storage.reset();

      debug("Ürün verileri çekiliyor");
      const product = await scrapeProduct(url);
      debug("Ürün başarıyla çekildi, kaydediliyor");
      const saved = await storage.saveProduct(product);

      res.json(saved);

    } catch (error) {
      debug("API hatası");
      const { status, message, details } = handleError(error);
      res.status(status).json({ message, details });
    }
  });

  app.post("/api/export", async (req, res) => {
    try {
      const { product } = req.body;
      if (!product) {
        throw new Error("Ürün verisi bulunamadı");
      }

      // Ürün verilerini kontrol et
      if (!product.title || !product.price) {
        throw new Error("Gerekli ürün bilgileri eksik");
      }

      const categoryConfig = getCategoryConfig(product.categories);
      const categoryPath = parseCategoryPath(product.categories);

      // Handle oluştur (URL'den)
      const handle = product.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

      const csvRows = [];

      // Ana ürün bilgileri
      const baseProduct = {
        handle,
        title: product.title,
        body: `${product.description || ''}\n\n<h3>Ürün Özellikleri</h3>\n<ul>${
          Object.entries(product.attributes)
            .map(([key, value]) => `<li><strong>${key}:</strong> ${value}</li>`)
            .join('\n')
        }</ul>`,
        vendor: product.categories[0] || 'Trendyol',
        product_category: categoryConfig.shopifyCategory,
        custom_category: categoryPath,
        type: product.categories[product.categories.length - 1] || 'Giyim',
        tags: product.tags?.join(', ') || '',
        published: 'TRUE',
        status: 'active',
        option1_name: '',
        option1_value: '',
        option2_name: '',
        option2_value: '',
        variant_sku: '',
        variant_price: '',
        variant_inventory_policy: 'deny',
        variant_inventory_quantity: 0,
        variant_weight: '0.5',
        variant_weight_unit: 'kg',
        image_src: '',
        image_position: ''
      };

      const variants = product.variants || {};
      const hasVariants = variants.sizes?.length > 0 || variants.colors?.length > 0;

      if (hasVariants) {
        const sizes = variants.sizes || [];
        const colors = variants.colors || [];

        if (sizes.length > 0) baseProduct.option1_name = categoryConfig.variantConfig.sizeLabel || 'Beden';
        if (colors.length > 0) baseProduct.option2_name = categoryConfig.variantConfig.colorLabel || 'Renk';

        // Her beden için bir varyant oluştur
        for (const size of sizes) {
          for (const color of colors.length > 0 ? colors : [null]) {
            const variant = {
              ...baseProduct,
              option1_value: size,
              option2_value: color || '',
              variant_sku: `${handle}-${size}${color ? `-${color}` : ''}`,
              variant_price: product.price,
              variant_inventory_quantity: categoryConfig.variantConfig.defaultStock || 50
            };
            csvRows.push(variant);
          }
        }
      } else {
        // Varyantsız ürün için tek bir satır
        csvRows.push({
          ...baseProduct,
          variant_sku: handle,
          variant_price: product.price,
          variant_inventory_quantity: categoryConfig.variantConfig.defaultStock || 50
        });
      }

      // Görselleri ekle
      if (product.images && product.images.length > 0 && csvRows.length > 0) {
        // İlk görsel ana ürün varyantı için
        const firstRow = {
          ...csvRows[0],
          image_src: product.images[0],
          image_position: '1'
        };
        csvRows[0] = firstRow;

        // Diğer görseller için yeni satırlar
        for (let i = 1; i < product.images.length; i++) {
          csvRows.push({
            handle,
            image_src: product.images[i],
            image_position: (i + 1).toString()
          });
        }
      }

      // CSV başlıklarını oluştur
      const csvWriter = createObjectCsvWriter({
        path: join(tmpdir(), 'shopify_products.csv'),
        header: [
          { id: 'handle', title: 'Handle' },
          { id: 'title', title: 'Title' },
          { id: 'body', title: 'Body (HTML)' },
          { id: 'vendor', title: 'Vendor' },
          { id: 'product_category', title: 'Product Category' },
          { id: 'custom_category', title: 'Custom Category' },
          { id: 'type', title: 'Type' },
          { id: 'tags', title: 'Tags' },
          { id: 'published', title: 'Published' },
          { id: 'option1_name', title: 'Option1 Name' },
          { id: 'option1_value', title: 'Option1 Value' },
          { id: 'option2_name', title: 'Option2 Name' },
          { id: 'option2_value', title: 'Option2 Value' },
          { id: 'variant_sku', title: 'Variant SKU' },
          { id: 'variant_price', title: 'Variant Price' },
          { id: 'variant_inventory_policy', title: 'Variant Inventory Policy' },
          { id: 'variant_inventory_quantity', title: 'Variant Inventory Quantity' },
          { id: 'variant_weight', title: 'Variant Weight' },
          { id: 'variant_weight_unit', title: 'Variant Weight Unit' },
          { id: 'status', title: 'Status' },
          { id: 'image_src', title: 'Image Src' },
          { id: 'image_position', title: 'Image Position' }
        ]
      });

      // CSV dosyasını yaz
      await csvWriter.writeRecords(csvRows);

      // CSV dosyasını gönder
      res.download(join(tmpdir(), 'shopify_products.csv'), 'shopify_products.csv');

    } catch (error: any) {
      debug("CSV export hatası");
      const { status, message, details } = handleError(error);
      res.status(status).json({ message, details });
    }
  });

  return httpServer;
}