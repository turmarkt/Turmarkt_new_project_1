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
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const html = await response.text();
    debug("HTML içeriği başarıyla alındı");
    return cheerio.load(html);

  } catch (error: any) {
    debug("Veri çekme hatası");
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

async function scrapeProduct(url: string): Promise<InsertProduct> {
  debug("Scraping başlatıldı");

  try {
    const $ = await fetchProductPage(url);

    const brand = $('.pr-new-br span').first().text().trim() ||
                     $('h1.pr-new-br').first().text().trim();
    debug(`Marka: ${brand}`);

    const productName = $('.prdct-desc-cntnr-name').text().trim() ||
                       $('.pr-in-w').first().text().trim().replace(/\d+(\.\d+)?\s*TL.*$/, '');
    debug(`Ürün adı: ${productName}`);

    let title = '';
    if (brand && productName) {
      title = `${brand} ${productName}`;
    } else if (productName) {
      title = productName;
    } else {
      title = $('.pr-in-w').first().text().trim()
              .replace(/\d+(\.\d+)?\s*TL.*$/, '')
              .replace(/Tükeniyor!?/g, '')
              .trim();
    }

    debug(`Birleştirilmiş başlık: ${title}`);

    if (!title) {
      throw new ProductDataError("Ürün başlığı bulunamadı", "title");
    }

    const priceSelectors = [
      '.pr-in-w .prc-box-dscntd', 
      '.pr-in-w .prc-box-sllng',
      '.product-price-container .prc-dsc',
      '.pr-in-w .prc-dsc',
      '.prc-slg'
    ];
    let rawPrice = '';
    for (const selector of priceSelectors) {
      const priceElement = $(selector).first();
      if (priceElement.length > 0) {
        rawPrice = priceElement.text().trim();
        if (rawPrice) {
          debug(`Fiyat bulundu (${selector}): ${rawPrice}`);
          break;
        }
      }
    }

    // HTML'den fiyat bulunamadıysa initial state'den almayı dene
    if (!rawPrice) {
      $('script').each((_, element) => {
        const scriptContent = $(element).html() || '';
        if (scriptContent.includes('window.__PRODUCT_DETAIL_APP_INITIAL_STATE__')) {
          try {
            const match = scriptContent.match(/window\.__PRODUCT_DETAIL_APP_INITIAL_STATE__\s*=\s*({.*?});/s);
            if (match) {
              const data = JSON.parse(match[1]);
              if (data.product?.price?.discountedPrice?.text) {
                rawPrice = data.product.price.discountedPrice.text;
                debug(`Fiyat initial state'den alındı: ${rawPrice}`);
              } else if (data.product?.price?.sellingPrice?.text) {
                rawPrice = data.product.price.sellingPrice.text;
                debug(`Fiyat initial state'den alındı: ${rawPrice}`);
              }
            }
          } catch (error) {
            debug(`Fiyat parse hatası: ${error}`);
          }
        }
      });
    }

    if (!rawPrice) {
      throw new ProductDataError("Ürün fiyatı bulunamadı", "price");
    }

    const basePrice = cleanPrice(rawPrice);
    const price = (basePrice * 1.15).toFixed(2);
    debug(`İşlenmiş fiyat: ${price} (baz: ${basePrice})`);

    const images: Set<string> = new Set();
    debug("Görsel yakalama başlatıldı");

    // Varyant verilerini başlat
    const variants = {
      sizes: new Set<string>(),
      colors: new Set<string>(),
      stockInfo: new Map<string, {
        inStock: boolean,
        sellable: boolean,
        barcode?: string,
        itemNumber?: number,
        stock?: number,
        price?: {
          discounted: number,
          original: number
        }
      }>()
    };

    function addSizeVariant(variant: any, source: string) {
      if (!variant) {
        debug(`${source}: Varyant boş`);
        return;
      }

      debug(`${source} varyant işleniyor:`, variant);
      let sizeValue: string | null = null;

      // Kaynak tipine göre değeri al
      switch (source) {
        case 'allVariants':
          sizeValue = variant.value?.toString();
          break;
        case 'slicedAttributes':
          sizeValue = variant.value?.toString();
          break;
        case 'variants':
          sizeValue = (variant.attributeValue || variant.value)?.toString();
          break;
        default:
          debug(`Bilinmeyen varyant kaynağı: ${source}`);
          return;
      }

      if (!sizeValue) {
        debug(`${source}: Beden değeri bulunamadı`);
        return;
      }

      const sizeStr = sizeValue.trim();

      // Stok bilgilerini ekle
      variants.stockInfo.set(sizeStr, {
        inStock: variant.inStock || false,
        sellable: variant.sellable || false,
        barcode: variant.barcode,
        itemNumber: variant.itemNumber,
        stock: variant.stock || 0,
        price: variant.price ? {
          discounted: variant.price.discountedPrice?.value || variant.price,
          original: variant.price.sellingPrice?.value || variant.price
        } : undefined
      });

      // Stok kontrolü - sadece stokta olan ürünleri ekle
      const isInStock = source === 'allVariants' 
        ? variant.inStock === true  // allVariants için sadece inStock kontrolü
        : (variant.inStock === true || variant.sellable === true); // diğer kaynaklar için daha geniş kontrol

      if (isInStock) {
        variants.sizes.add(sizeStr);
        debug(`${source}: Stokta olan beden eklendi: ${sizeStr}, Stok: ${variant.stock || 'Belirtilmemiş'}`);
      } else {
        debug(`${source}: Stokta olmayan beden: ${sizeStr}`);
      }
    }

    // Initial state'den varyant bilgilerini al
    $('script').each((_, element) => {
      const scriptContent = $(element).html() || '';
      if (scriptContent.includes('window.__PRODUCT_DETAIL_APP_INITIAL_STATE__')) {
        try {
          const match = scriptContent.match(/window\.__PRODUCT_DETAIL_APP_INITIAL_STATE__\s*=\s*({.*?});/s);
          if (match) {
            const data = JSON.parse(match[1]);
            debug("Product detail state bulundu:", JSON.stringify(data.product, null, 2));

            // 1. allVariants yapısından kontrol et - en detaylı varyant bilgisi burada
            if (data.product?.allVariants) {
              debug("allVariants verisi:", JSON.stringify(data.product.allVariants, null, 2));
              data.product.allVariants.forEach((variant: any) => {
                addSizeVariant(variant, 'allVariants');
              });
            }

            // 2. Variants yapısından kontrol et - detaylı stok ve fiyat bilgileri burada
            if (data.product?.variants) {
              debug("Variants verisi:", JSON.stringify(data.product.variants, null, 2));
              data.product.variants.forEach((variant: any) => {
                if (variant.attributeName === "Beden" || variant.attributeName === "Numara") {
                  addSizeVariant(variant, 'variants');
                }
              });
            }

            // 3. slicedAttributes yapısından kontrol et - beden grupları burada
            if (data.product?.slicedAttributes) {
              debug("SlicedAttributes verisi:", JSON.stringify(data.product.slicedAttributes, null, 2));
              data.product.slicedAttributes.forEach((attr: any) => {
                if (attr.name === "Beden" || attr.name === "Numara") {
                  if (attr.attributes) {
                    attr.attributes.forEach((item: any) => {
                      addSizeVariant(item, 'slicedAttributes');
                    });
                  }
                }
              });
            }

            // Renk bilgisini al
            if (data.product?.color) {
              const color = data.product.color.split('-')[0].trim();
              if (color) {
                variants.colors.add(color);
                debug(`Renk bulundu: ${color}`);
              }
            }

            // Bulunan varyant bilgilerini yazdır
            debug("Bulunan bedenler:", Array.from(variants.sizes).join(', '));
            debug("Bulunan renkler:", Array.from(variants.colors).join(', '));
            debug("Stok bilgileri:");
            variants.stockInfo.forEach((info, size) => {
              debug(`${size} beden bilgileri:`, {
                stok: info.stock || 0,
                durum: info.inStock ? "Stokta var" : "Stokta yok",
                fiyat: info.price?.discounted || info.price?.original
              });
            });
          }
        } catch (error) {
          debug(`State parse hatası: ${error}`);
        }
      }
    });

    // Görsel bilgilerini al
    $('script').each((_, element) => {
      const scriptContent = $(element).html() || '';
      if (scriptContent.includes('window.__PRODUCT_DETAIL_APP_INITIAL_STATE__')) {
        try {
          const match = scriptContent.match(/window\.__PRODUCT_DETAIL_APP_INITIAL_STATE__\s*=\s*({.*?});/s);
          if (match) {
            const data = JSON.parse(match[1]);
            const productImages = data?.product?.images || [];
            debug(`JSON'dan ${productImages.length} adet görsel bulundu`);
            productImages.forEach((img: any) => {
              if (typeof img === 'string') {
                const imgUrl = normalizeImageUrl(img);
                if (imgUrl) images.add(imgUrl);
              } else if (img.url) {
                const imgUrl = normalizeImageUrl(img.url);
                if (imgUrl) images.add(imgUrl);
              }
            });
          }
        } catch (error: any) {
          debug(`JSON parse hatası: ${error.message}`);
        }
      }
    });

    // Ürün özelliklerini çek
    const attributes: Record<string, string> = {};

    // JSON-LD'den özellikleri çek
    $('script[type="application/ld+json"]').each((_, element) => {
      try {
        const data = JSON.parse($(element).html() || '');
        if (data.additionalProperty) {
          data.additionalProperty.forEach((prop: any) => {
            if (prop.name && prop.unitText) {
              attributes[prop.name] = prop.unitText;
              debug(`JSON-LD'den özellik bulundu: ${prop.name} = ${prop.unitText}`);
            }
          });
        }
      } catch (error) {
        debug(`JSON parse hatası: ${error}`);
      }
    });

    const categories: string[] = [];
    $('.breadcrumb li').each((_, el) => {
      const category = $(el).text().trim();
      if (category && !category.includes('>')) {
        categories.push(category);
      }
    });

    const uniqueImages = Array.from(images).filter((url, index, arr) => {
      try {
        new URL(url);
        return index < arr.length - 1;
      } catch {
        return false;
      }
    });


    const product: InsertProduct = {
      url,
      title,
      description: $('.product-description').text().trim() || "",
      price: price.toString(),
      basePrice: basePrice.toString(),
      images: uniqueImages,
      video: null,
      variants: {
        sizes: Array.from(variants.sizes),
        colors: Array.from(variants.colors),
        stockInfo: Object.fromEntries(variants.stockInfo)
      },
      attributes,
      categories: categories.length > 0 ? categories : ['Kozmetik'],
      fullCategoryPath: categories,
      tags: categories
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

      const categoryConfig = getCategoryConfig(product.categories);
      const categoryPath = parseCategoryPath(product.categories);

      // Shopify CSV başlıkları
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
          { id: 'variant_compare_at_price', title: 'Variant Compare At Price' },
          { id: 'variant_inventory_policy', title: 'Variant Inventory Policy' },
          { id: 'variant_inventory_quantity', title: 'Variant Inventory Quantity' },
          { id: 'variant_weight', title: 'Variant Weight' },
          { id: 'variant_weight_unit', title: 'Variant Weight Unit' },
          { id: 'status', title: 'Status' },
          { id: 'image_src', title: 'Image Src' },
          { id: 'image_position', title: 'Image Position' }
        ]
      });

      // Handle oluştur (URL'den)
      const handle = product.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

      // Temel ürün bilgileri
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
      };

      const csvRows = [];
      const variants = product.variants || {};
      const hasVariants = variants.sizes?.length > 0 || variants.colors?.length > 0;

      if (hasVariants) {
        // Beden ve renk varyantları için
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
              option2_value: color,
              variant_sku: `${handle}-${size}${color ? `-${color}` : ''}`,
              variant_price: product.price,
              variant_compare_at_price: product.basePrice,
              variant_inventory_policy: 'deny',
              variant_inventory_quantity: categoryConfig.variantConfig.defaultStock || 50,
              variant_weight: '0.5',
              variant_weight_unit: 'kg'
            };
            csvRows.push(variant);
          }
        }
      } else {
        // Varyantsız ürün
        csvRows.push({
          ...baseProduct,
          variant_sku: handle,
          variant_price: product.price,
          variant_compare_at_price: product.basePrice,
          variant_inventory_policy: 'deny',
          variant_inventory_quantity: categoryConfig.variantConfig.defaultStock || 50,
          variant_weight: '0.5',
          variant_weight_unit: 'kg'
        });
      }

      // Görselleri ekle
      for (let i = 0; i < product.images.length; i++) {
        if (i === 0) {
          csvRows[0].image_src = product.images[i];
          csvRows[0].image_position = 1;
        } else {
          csvRows.push({
            handle,
            image_src: product.images[i],
            image_position: i + 1
          });
        }
      }

      // CSV dosyasını oluştur
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