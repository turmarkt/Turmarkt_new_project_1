import { z } from "zod";

export const CategoryConfig = z.object({
  shopifyCategory: z.string(),
  variantConfig: z.object({
    sizeLabel: z.string().optional(),
    colorLabel: z.string().optional(),
    materialLabel: z.string().optional(),
    defaultStock: z.number(),
    hasVariants: z.boolean()
  }),
  attributes: z.array(z.string()),
  inventoryTracking: z.boolean()
});

type CategoryMapping = Record<string, z.infer<typeof CategoryConfig>>;

// Shopify'ın resmi kategori yapısına göre eşleştirme
export const categoryMapping: CategoryMapping = {
  // Saat ve Aksesuar Kategorileri
  "saat": {
    shopifyCategory: "Apparel & Accessories > Jewelry > Watches",
    variantConfig: {
      defaultStock: 30,
      hasVariants: false
    },
    attributes: ["Kasa Çapı", "Su Geçirmezlik", "Kordon Tipi"],
    inventoryTracking: true
  },
  "akıllı saat": {
    shopifyCategory: "Electronics > Electronics Accessories > Wearable Technology",
    variantConfig: {
      defaultStock: 30,
      hasVariants: false
    },
    attributes: ["Ekran Boyutu", "Batarya Ömrü", "Sensörler"],
    inventoryTracking: true
  },

  // Erkek Kategorileri
  "erkek": {
    shopifyCategory: "Apparel & Accessories > Clothing > Men's Clothing",
    variantConfig: {
      sizeLabel: "Beden",
      colorLabel: "Renk",
      defaultStock: 50,
      hasVariants: true
    },
    attributes: ["Kumaş", "Desen", "Yaka Tipi", "Kol Boyu"],
    inventoryTracking: true
  },

  // Kadın Kategorileri
  "kadın": {
    shopifyCategory: "Apparel & Accessories > Clothing > Women's Clothing",
    variantConfig: {
      sizeLabel: "Beden",
      colorLabel: "Renk",
      defaultStock: 50,
      hasVariants: true
    },
    attributes: ["Kumaş", "Desen", "Yaka Tipi", "Kol Boyu"],
    inventoryTracking: true
  },

  // T-shirt ve Üst Giyim
  "t-shirt": {
    shopifyCategory: "Apparel & Accessories > Clothing > Shirts & Tops",
    variantConfig: {
      sizeLabel: "Beden",
      colorLabel: "Renk",
      defaultStock: 50,
      hasVariants: true
    },
    attributes: ["Kumaş", "Desen", "Yaka Tipi", "Kol Boyu"],
    inventoryTracking: true
  },

  // Elektronik Kategorileri
  "elektronik": {
    shopifyCategory: "Electronics",
    variantConfig: {
      defaultStock: 20,
      hasVariants: false
    },
    attributes: ["Marka", "Model", "Özellikler"],
    inventoryTracking: true
  },

  // Varsayılan kategori
  "diğer": {
    shopifyCategory: "Other",
    variantConfig: {
      defaultStock: 30,
      hasVariants: false
    },
    attributes: [],
    inventoryTracking: true
  }
};

export function getCategoryConfig(categories: string[]): z.infer<typeof CategoryConfig> {
  if (!categories || categories.length === 0) {
    return categoryMapping['diğer'];
  }

  const normalizedCategories = categories.map(c =>
    c.toLowerCase()
      .trim()
      .replace(/ı/g, 'i')
      .replace(/ğ/g, 'g')
      .replace(/ü/g, 'u')
      .replace(/ş/g, 's')
      .replace(/ö/g, 'o')
      .replace(/ç/g, 'c')
  );

  // Özel kategorileri kontrol et
  if (normalizedCategories.some(c => c.includes('saat'))) {
    if (normalizedCategories.some(c => c.includes('akilli') || c.includes('smart'))) {
      return categoryMapping['akıllı saat'];
    }
    return categoryMapping['saat'];
  }

  // Diğer kategori kontrolleri
  for (const category of normalizedCategories) {
    for (const [key, value] of Object.entries(categoryMapping)) {
      if (category.includes(key)) {
        return value;
      }
    }
  }

  // Varsayılan kategori
  return categoryMapping['diğer'];
}