import { Cluster } from 'puppeteer-cluster';
import { PuppeteerExtra } from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Express } from "express";
import { createServer } from "http";
import { storage } from "./storage";
import * as cheerio from "cheerio";
import { urlSchema, type InsertProduct, type Product } from "@shared/schema";
import { TrendyolScrapingError, ProductDataError, handleError } from "./errors";
import { createObjectCsvWriter } from "csv-writer";

// Stealth modu etkinleştir
const puppeteer = new PuppeteerExtra();
puppeteer.use(StealthPlugin());

// Gelişmiş veri çekme fonksiyonu
async function fetchProductPage(url: string, retryCount = 0): Promise<cheerio.CheerioAPI> {
  console.log(`Gelişmiş veri çekme denemesi ${retryCount + 1}/5 başlatıldı:`, url);

  try {
    // Cluster oluştur
    const cluster = await Cluster.launch({
      concurrency: Cluster.CONCURRENCY_PAGE,
      maxConcurrency: 2,
      puppeteer,
      puppeteerOptions: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-blink-features=AutomationControlled',
          '--disable-web-security',
          '--disable-features=IsolateOrigins,site-per-process',
          '--disable-site-isolation-trials',
          '--window-size=1920,1080',
          '--disable-gpu',
          '--hide-scrollbars',
          '--mute-audio'
        ],
        ignoreHTTPSErrors: true,
        defaultViewport: {
          width: 1920,
          height: 1080
        }
      }
    });

    // Cluster task tanımla
    const html = await cluster.execute(async ({ page, data: pageUrl }) => {
      // Gelişmiş browser fingerprint gizleme
      await page.evaluateOnNewDocument(() => {
        // WebGL fingerprint gizleme
        const originalGetParameter = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function(parameter) {
          if (parameter === 37445) {
            return 'Intel Inc.';
          }
          if (parameter === 37446) {
            return 'Intel Iris OpenGL Engine';
          }
          return originalGetParameter.apply(this, arguments);
        };

        // Canvas fingerprint gizleme
        const originalGetContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(...args) {
          const context = originalGetContext.apply(this, args);
          if (context && args[0] === '2d') {
            const originalGetImageData = context.getImageData;
            context.getImageData = function(...args) {
              const imageData = originalGetImageData.apply(this, args);
              const noise = () => Math.random() * 0.1;
              for (let i = 0; i < imageData.data.length; i += 4) {
                imageData.data[i] = imageData.data[i] + noise();
                imageData.data[i + 1] = imageData.data[i + 1] + noise();
                imageData.data[i + 2] = imageData.data[i + 2] + noise();
              }
              return imageData;
            };
          }
          return context;
        };

        // Navigator fingerprint gizleme
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'languages', { get: () => ['tr-TR', 'tr', 'en-US', 'en'] });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
        Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
        Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });

        // Chrome özelliklerini simüle et
        window.chrome = {
          app: {
            isInstalled: false,
            InstallState: {
              DISABLED: 'disabled',
              INSTALLED: 'installed',
              NOT_INSTALLED: 'not_installed'
            },
            RunningState: {
              CANNOT_RUN: 'cannot_run',
              READY_TO_RUN: 'ready_to_run',
              RUNNING: 'running'
            }
          },
          runtime: {
            OnInstalledReason: {
              CHROME_UPDATE: 'chrome_update',
              INSTALL: 'install',
              SHARED_MODULE_UPDATE: 'shared_module_update',
              UPDATE: 'update'
            },
            OnRestartRequiredReason: {
              APP_UPDATE: 'app_update',
              OS_UPDATE: 'os_update',
              PERIODIC: 'periodic'
            },
            PlatformArch: {
              ARM: 'arm',
              ARM64: 'arm64',
              MIPS: 'mips',
              MIPS64: 'mips64',
              X86_32: 'x86-32',
              X86_64: 'x86-64'
            },
            PlatformNaclArch: {
              ARM: 'arm',
              MIPS: 'mips',
              MIPS64: 'mips64',
              X86_32: 'x86-32',
              X86_64: 'x86-64'
            },
            PlatformOs: {
              ANDROID: 'android',
              CROS: 'cros',
              LINUX: 'linux',
              MAC: 'mac',
              OPENBSD: 'openbsd',
              WIN: 'win'
            },
            RequestUpdateCheckStatus: {
              NO_UPDATE: 'no_update',
              THROTTLED: 'throttled',
              UPDATE_AVAILABLE: 'update_available'
            }
          }
        };
      });

      // Headers ve diğer ayarlar
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Pragma': 'no-cache',
        'Cache-Control': 'no-cache',
        'Upgrade-Insecure-Requests': '1',
        'DNT': '1'
      });

      // Gelişmiş insan davranışı simülasyonu
      await simulateAdvancedHumanBehavior(page);

      // Sayfa yükleme
      console.log("Sayfa yükleniyor...");
      await page.goto(pageUrl, { 
        waitUntil: 'networkidle0',
        timeout: 30000 
      });

      // Sayfanın tam olarak yüklenmesini bekle
      await page.waitForFunction(() => {
        const readyState = document.readyState;
        return readyState === 'complete';
      });

      // Cloudflare kontrolü
      const cloudflareDetected = await page.evaluate(() => {
        return document.title.includes('Attention Required') || 
               document.body.textContent.includes('Checking your browser') ||
               document.querySelector('*:contains("Attention Required")') !== null;
      });

      if (cloudflareDetected) {
        throw new TrendyolScrapingError("Güvenlik kontrolü nedeniyle erişim engellendi", {
          status: 403,
          statusText: "Cloudflare Protection",
          details: "Cloudflare güvenlik kontrolü aşılamadı"
        });
      }

      // Ürün detay kontrolü
      await page.waitForSelector('.product-detail-container', { timeout: 10000 });

      // Son kontroller ve insan davranışı
      await simulateAdvancedHumanBehavior(page);

      // HTML içeriğini al
      return await page.content();
    }, url);

    await cluster.idle();
    await cluster.close();

    return cheerio.load(html);

  } catch (error) {
    console.error("Veri çekme hatası:", error);

    if (error instanceof TrendyolScrapingError) {
      if (retryCount < 4) {
        console.log(`Yeniden deneniyor (${retryCount + 1}/5)...`);
        await new Promise(resolve => setTimeout(resolve, Math.min(1000 * Math.pow(2, retryCount), 30000)));
        return fetchProductPage(url, retryCount + 1);
      }
      throw error;
    }

    throw new TrendyolScrapingError("Ürün verileri çekilirken bir hata oluştu", {
      status: 500,
      statusText: "Scraping Error",
      details: error.message
    });
  }
}

// Gelişmiş insan davranışı simülasyonu
async function simulateAdvancedHumanBehavior(page: any) {
  // Dinamik bekleme süresi
  const randomDelay = () => Math.floor(Math.random() * 500) + 200;

  // Mouse hareketi simülasyonu
  const viewportSize = await page.viewport();
  const points = generateNaturalMousePath(viewportSize.width, viewportSize.height);

  for (const point of points) {
    await page.mouse.move(point.x, point.y, {
      steps: Math.floor(Math.random() * 10) + 5
    });
    await page.waitForTimeout(randomDelay());
  }

  // Scroll davranışı
  await page.evaluate(async () => {
    const scroll = (amount: number) => new Promise(resolve => {
      window.scrollBy({
        top: amount,
        behavior: 'smooth'
      });
      setTimeout(resolve, Math.random() * 100 + 50);
    });

    const height = Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight
    );

    let position = 0;
    const scrollStep = Math.floor(Math.random() * 100) + 50;

    while (position < height) {
      position += scrollStep;
      await scroll(scrollStep);

      // Rastgele duraklamalar
      if (Math.random() > 0.7) {
        await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 500));
      }
    }
  });

  // Klavye ve fare etkileşimleri
  const interactionElements = await page.$$('a, button, img, input');
  for (const element of interactionElements) {
    if (Math.random() > 0.7) {
      const box = await element.boundingBox();
      if (box) {
        await page.mouse.move(
          box.x + box.width / 2,
          box.y + box.height / 2,
          { steps: 5 }
        );
        await page.waitForTimeout(randomDelay());

        if (Math.random() > 0.8) {
          await element.hover();
          await page.waitForTimeout(randomDelay());
        }
      }
    }
  }

  // Sayfada gezinme simülasyonu
  const keys = ['PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End'];
  for (let i = 0; i < Math.floor(Math.random() * 3) + 1; i++) {
    const key = keys[Math.floor(Math.random() * keys.length)];
    await page.keyboard.press(key);
    await page.waitForTimeout(randomDelay());
  }
}

// Doğal mouse hareketi için yol oluştur
function generateNaturalMousePath(width: number, height: number) {
  const points = [];
  const numPoints = Math.floor(Math.random() * 5) + 5;

  for (let i = 0; i < numPoints; i++) {
    points.push({
      x: Math.floor(Math.random() * width),
      y: Math.floor(Math.random() * height)
    });
  }

  // Bezier eğrisi noktaları ekle
  const smoothPoints = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];

    const cp1 = {
      x: p1.x + (Math.random() * 100 - 50),
      y: p1.y + (Math.random() * 100 - 50)
    };

    const cp2 = {
      x: p2.x + (Math.random() * 100 - 50),
      y: p2.y + (Math.random() * 100 - 50)
    };

    // Bezier noktalarını ekle
    for (let t = 0; t <= 1; t += 0.1) {
      const bx = Math.pow(1-t,3)*p1.x + 
                 3*Math.pow(1-t,2)*t*cp1.x + 
                 3*(1-t)*Math.pow(t,2)*cp2.x + 
                 Math.pow(t,3)*p2.x;

      const by = Math.pow(1-t,3)*p1.y + 
                 3*Math.pow(1-t,2)*t*cp1.y + 
                 3*(1-t)*Math.pow(t,2)*cp2.y + 
                 Math.pow(t,3)*p2.y;

      smoothPoints.push({x: bx, y: by});
    }
  }

  return smoothPoints;
}

// Schema.org verisi çekme
async function extractProductSchema($: cheerio.CheerioAPI) {
  const schemaScript = $('script[type="application/ld+json"]').first().html();
  if (!schemaScript) {
    throw new ProductDataError("Ürün şeması bulunamadı", "schema");
  }

  try {
    const schema = JSON.parse(schemaScript);
    if (!schema["@type"] || !schema.name) {
      throw new ProductDataError("Geçersiz ürün şeması", "schema");
    }
    return schema;
  } catch (error) {
    console.error("Schema parse hatası:", error);
    throw new ProductDataError("Ürün şeması geçersiz", "schema");
  }
}

// Temel ürün bilgilerini çekme
async function extractBasicInfo($: cheerio.CheerioAPI, schema: any) {
  const title = schema.name;
  const description = schema.description;
  const brand = schema.brand?.name || schema.manufacturer || title.split(' ')[0];

  if (!title || !description) {
    throw new ProductDataError("Temel ürün bilgileri eksik", "basicInfo");
  }

  return { title, description, brand };
}

// Fiyat çekme ve hesaplama
async function extractPrice($: cheerio.CheerioAPI, schema: any): Promise<{ price: string, basePrice: string }> {
  try {
    let basePrice = "";

    // 1. Schema.org'dan fiyat çekme
    if (schema.offers?.price) {
      basePrice = schema.offers.price.toString();
    }

    // 2. DOM'dan fiyat çekme
    if (!basePrice) {
      const priceEl = $('.prc-dsc, .product-price-container .current-price').first();
      if (priceEl.length > 0) {
        basePrice = priceEl.text().trim().replace('TL', '').trim();
      }
    }

    // 3. Alternatif fiyat selektörleri
    if (!basePrice) {
      const altPriceEl = $('.product-price, .discounted-price').first();
      if (altPriceEl.length > 0) {
        basePrice = altPriceEl.text().trim().replace('TL', '').trim();
      }
    }

    if (!basePrice) {
      throw new Error('Fiyat bilgisi bulunamadı');
    }

    // Fiyat hesaplama (%15 kar marjı)
    const price = (parseFloat(basePrice) * 1.15).toFixed(2);
    return { price, basePrice };

  } catch (error) {
    console.error('Fiyat çekme hatası:', error);
    throw error;
  }
}

// Görselleri çekme
async function extractImages($: cheerio.CheerioAPI, schema: any): Promise<string[]> {
  let images: string[] = [];

  try {
    // 1. Schema.org'dan görselleri çek
    if (schema.image?.contentUrl) {
      images = Array.isArray(schema.image.contentUrl)
        ? schema.image.contentUrl
        : [schema.image.contentUrl];
    }

    // 2. DOM'dan görselleri çek
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

    return images;

  } catch (error) {
    console.error("Görsel çekme hatası:", error);
    throw new ProductDataError("Görseller işlenirken hata oluştu", "images");
  }
}

// Varyantları çekme
async function extractVariants($: cheerio.CheerioAPI, schema: any): Promise<{ sizes: string[], colors: string[] }> {
  const variants = {
    sizes: [] as string[],
    colors: [] as string[]
  };

  try {
    // 1. Beden varyantlarını çek
    const sizeSelectors = [
      '.sp-itm:not(.so)',                    // Ana beden seçici
      '.variant-list-item:not(.disabled)',   // Alternatif beden seçici
      '.size-variant-wrapper:not(.disabled)', // Boyut varyant seçici
      '.v2-size-value'                       // v2 beden değeri seçici
    ];

    for (const selector of sizeSelectors) {
      let foundSizes = $(selector)
        .map((_, el) => $(el).text().trim())
        .get()
        .filter(Boolean);

      if (foundSizes.length > 0) {
        // Birleşik bedenleri filtrele
        const parsedSizes = foundSizes.reduce((acc: string[], size) => {
          // XSSMLXL2XL gibi birleşik bedenleri atla
          if (size.includes('XS') && size.includes('S') && size.includes('M')) {
            return acc;
          }
          // Tekil bedenleri ekle
          return [...acc, size];
        }, []);

        // Tekrar eden bedenleri kaldır ve sırala
        const uniqueSizes = [...new Set(parsedSizes)].sort((a, b) => {
          const sizeOrder = {
            'XXS': 1, 'XS': 2, 'S': 3, 'M': 4, 'L': 5, 'XL': 6,
            '2XL': 7, '3XL': 8, '4XL': 9, '5XL': 10, '6XL': 11
          };
          return (sizeOrder[a as keyof typeof sizeOrder] || 99) - (sizeOrder[b as keyof typeof sizeOrder] || 99);
        });

        if (uniqueSizes.length > 0) {
          console.log(`${selector} den bulunan bedenler:`, uniqueSizes);
          variants.sizes = uniqueSizes;
          break;
        }
      }
    }

    // 2. Renk varyantlarını çek
    const colorSelectors = [
      '.slc-txt',                         // Ana renk seçici
      '.color-variant-wrapper',           // Renk varyant seçici
      '.variant-property-list span',      // Varyant özellik listesi
      '[data-pk="color"] .variant-list-item' // Renk data attribute
    ];

    for (const selector of colorSelectors) {
      const colors = $(selector)
        .map((_, el) => $(el).text().trim())
        .get()
        .filter(Boolean);

      if (colors.length > 0) {
        console.log(`${selector} den bulunan renkler:`, colors);
        variants.colors = [...new Set(colors)]; // Tekrar eden renkleri kaldır
        break;
      }
    }

    return variants;

  } catch (error) {
    console.error("Varyant çekme hatası:", error);
    return variants;
  }
}

// Ürün özelliklerini çekme
async function extractAttributes($: cheerio.CheerioAPI): Promise<Record<string, string>> {
  const attributes: Record<string, string> = {};

  try {
    // 1. Schema.org verilerinden özellikleri al
    $('script[type="application/ld+json"]').each((_, script) => {
      try {
        const schema = JSON.parse($(script).html() || '{}');
        if (schema.additionalProperty) {
          schema.additionalProperty.forEach((prop: any) => {
            if (prop.name && prop.unitText) {
              attributes[prop.name] = prop.unitText;
            }
          });
        }
      } catch (e) {
        console.error('Schema parse error:', e);
      }
    });

    // 2. Öne Çıkan Özellikler bölümünü bul
    $('.detail-attr-container').each((_, container) => {
      $(container).find('tr').each((_, row) => {
        const label = $(row).find('th').text().trim();
        const value = $(row).find('td').text().trim();
        if (label && value) {
          attributes[label] = value;
        }
      });
    });

    // 3. Tüm olası özellik selektörleri
    const selectors = [
      '.product-feature-list li',
      '.detail-attr-item',
      '.product-properties li',
      '.detail-border-bottom tr',
      '.product-details tr',
      '.featured-attributes-item'
    ];

    // Her bir selektör için kontrol
    selectors.forEach(selector => {
      $(selector).each((_, element) => {
        let label, value;

        // Etiket-değer çiftlerini bul
        if ($(element).find('.detail-attr-label, .property-label').length > 0) {
          label = $(element).find('.detail-attr-label, .property-label').text().trim();
          value = $(element).find('.detail-attr-value, .property-value').text().trim();
        } else if ($(element).find('th, td').length > 0) {
          label = $(element).find('th, td:first-child').text().trim();
          value = $(element).find('td:last-child').text().trim();
        } else {
          const text = $(element).text().trim();
          [label, value] = text.split(':').map(s => s.trim());
        }

        if (label && value && !attributes[label]) {
          attributes[label] = value;
        }
      });
    });

    return attributes;

  } catch (error) {
    console.error("Özellik çekme hatası:", error);
    return {};
  }
}

// Ana veri çekme ve işleme fonksiyonu
async function scrapeProduct(url: string): Promise<InsertProduct> {
  console.log("Scraping başlatıldı:", url);

  const $ = await fetchProductPage(url);
  const schema = await extractProductSchema($);

  const basicInfo = await extractBasicInfo($, schema);
  const { price, basePrice } = await extractPrice($, schema);
  const images = await extractImages($, schema);
  const variants = await extractVariants($, schema);
  const attributes = await extractAttributes($);

  const categories = schema.category ?
    Array.isArray(schema.category) ? schema.category : [schema.category] :
    ['Giyim'];

  return {
    url,
    title: basicInfo.title,
    description: basicInfo.description,
    price,
    basePrice,
    images,
    variants,
    attributes,
    categories,
    tags: [...categories],
    brand: basicInfo.brand
  };
}

// Ana route'lar
export async function registerRoutes(app: Express) {
  const httpServer = createServer(app);

  // Scraping endpoint'i
  app.post("/api/scrape", async (req, res) => {
    try {
      const { url } = urlSchema.parse(req.body);

      // Cache kontrolü
      const existing = await storage.getProduct(url);
      if (existing) {
        console.log("Ürün cache'den alındı:", existing.id);
        return res.json(existing);
      }

      const product = await scrapeProduct(url);

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

  // Export endpoint'i
  app.post("/api/export", async (req, res) => {
    try {
      console.log("CSV export başlatıldı");
      const { product } = req.body;

      if (!product) {
        throw new ProductDataError("Ürün verisi bulunamadı", "product");
      }

      const handle = product.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

      // Ürün özelliklerini düzenli formatla
      const attributesHtml = Object.entries(product.attributes)
        .map(([key, value]) => `<strong>${key}:</strong> ${value}`)
        .join('<br>');

      // Ana ürün kaydı
      const mainRecord = {
        'Title': product.title,
        'Handle': handle,
        'Body (HTML)': `<div class="product-features">
          <h3>Ürün Özellikleri</h3>
          <div class="features-list">
            ${attributesHtml}
          </div>
        </div>`.replace(/"/g, '""'),
        'Vendor': product.brand || '',
        'Product Category': 'Apparel & Accessories > Clothing',
        'Type': 'Clothing',
        'Tags': product.categories.join(','),
        'Published': 'TRUE',
        'Status': 'active',
        'SKU': `${handle}-1`,
        'Price': product.price,
        'Inventory policy': 'deny',
        'Inventory quantity': '100',
        'Requires shipping': 'TRUE',
        'Weight': '500',
        'Weight unit': 'g',
        'Option1 Name': product.variants.sizes.length > 0 ? 'Size' : '',
        'Option1 Value': product.variants.sizes[0] || '',
        'Option2 Name': product.variants.colors.length > 0 ? 'Color' : '',
        'Option2 Value': product.variants.colors[0] || '',
        'Option3 Name': '',
        'Option3 Value': '',
        'Image Src': product.images[0] || '',
        'Image Position': '1',
        'Image alt text': product.title,
        'Variant Image': '',
        'SEO Title': product.title,
        'SEO Description': Object.entries(product.attributes)
          .map(([key, value]) => `${key}: ${value}`)
          .join('. ')
          .substring(0, 320)
          .replace(/"/g, '""')
      };

      const records = [mainRecord];

      // Varyant kayıtları
      if (product.variants.sizes.length > 0) {
        for (let i = 1; i < product.variants.sizes.length; i++) {
          records.push({
            'Handle': handle,
            'Title': '',
            'Body (HTML)': mainRecord['Body (HTML)'],
            'Vendor': mainRecord['Vendor'],
            'Product Category': mainRecord['Product Category'],
            'Type': mainRecord['Type'],
            'Tags': mainRecord['Tags'],
            'Published': mainRecord['Published'],
            'Status': mainRecord['Status'],
            'Option1 Name': 'Size',
            'Option1 Value': product.variants.sizes[i],
            'Option2 Name': mainRecord['Option2 Name'],
            'Option2 Value': mainRecord['Option2 Value'],
            'Option3 Name': '',
            'Option3 Value': '',
            'SKU': `${handle}-size-${i}`,
            'Price': product.price,
            'Inventory policy': 'deny',
            'Inventory quantity': '100',
            'Requires shipping': 'TRUE',
            'Weight': mainRecord['Weight'],
            'Weight unit': mainRecord['Weight unit']
          });
        }
      }

      if (product.variants.colors.length > 0) {
        for (let i = 1; i < product.variants.colors.length; i++) {
          const variantImage = product.images[i] || product.images[0];
          records.push({
            'Handle': handle,
            'Title': '',
            'Body (HTML)': mainRecord['Body (HTML)'],
            'Vendor': mainRecord['Vendor'],
            'Product Category': mainRecord['Product Category'],
            'Type': mainRecord['Type'],
            'Tags': mainRecord['Tags'],
            'Published': mainRecord['Published'],
            'Status': mainRecord['Status'],
            'Option1 Name': mainRecord['Option1 Name'],
            'Option1 Value': mainRecord['Option1 Value'],
            'Option2 Name': 'Color',
            'Option2 Value': product.variants.colors[i],
            'Option3 Name': '',
            'Option3 Value': '',
            'SKU': `${handle}-color-${i}`,
            'Price': product.price,
            'Inventory policy': 'deny',
            'Inventory quantity': '100',
            'Requires shipping': 'TRUE',
            'Weight': mainRecord['Weight'],
            'Weight unit': mainRecord['Weight unit'],
            'Image Src': variantImage,
            'Image Position': (i + 1).toString(),
            'Variant Image': variantImage
          });
        }
      }

      // CSV başlıkları
      const csvWriter = createObjectCsvWriter({
        path: 'products.csv',
        header: [
          {id: 'Title', title: 'Title'},
          {id: 'Handle', title: 'Handle'},
          {id: 'Body (HTML)', title: 'Body (HTML)'},
          {id: 'Vendor', title: 'Vendor'},
          {id: 'Product Category', title: 'Product Category'},
          {id: 'Type', title: 'Type'},
          {id: 'Tags', title: 'Tags'},
          {id: 'Published', title: 'Published'},
          {id: 'Status', title: 'Status'},
          {id: 'Option1 Name', title: 'Option1 Name'},
          {id: 'Option1 Value', title: 'Option1 Value'},
          {id: 'Option2 Name', title: 'Option2 Name'},
          {id: 'Option2 Value', title: 'Option2 Value'},
          {id: 'Option3 Name', title: 'Option3 Name'},
          {id: 'Option3 Value', title: 'Option3 Value'},
          {id: 'SKU', title: 'SKU'},
          {id: 'Price', title: 'Price'},
          {id: 'Inventory policy', title: 'Inventory policy'},
          {id: 'Inventory quantity', title: 'Inventory quantity'},
          {id: 'Requires shipping', title: 'Requires shipping'},
          {id: 'Weight', title: 'Weight'},
          {id: 'Weight unit', title: 'Weight unit'},
          {id: 'Image Src', title: 'Image Src'},
          {id: 'Image Position', title: 'Image Position'},
          {id: 'Image alt text', title: 'Image alt text'},
          {id: 'Variant Image', title: 'Variant Image'},
          {id: 'SEO Title', title: 'SEO Title'},
          {id: 'SEO Description', title: 'SEO Description'}
        ]
      });

      await csvWriter.writeRecords(records);
      res.download('products.csv');

    } catch (error) {
      console.error("CSV export hatası:", error);
      const { status, message, details } = handleError(error);
      res.status(status).json({ message, details });
    }
  });

  return httpServer;
}