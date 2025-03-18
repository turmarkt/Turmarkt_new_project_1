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

export const categoryMapping: CategoryMapping = {
  // Giyim Kategorileri
  "tişört": {
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
  "pantolon": {
    shopifyCategory: "Apparel & Accessories > Clothing > Pants",
    variantConfig: {
      sizeLabel: "Beden",
      colorLabel: "Renk",
      defaultStock: 50,
      hasVariants: true
    },
    attributes: ["Kumaş", "Kalıp", "Bel", "Paça"],
    inventoryTracking: true
  },
  
  // Ayakkabı Kategorileri
  "spor ayakkabı": {
    shopifyCategory: "Apparel & Accessories > Shoes > Athletic Shoes",
    variantConfig: {
      sizeLabel: "Numara",
      colorLabel: "Renk",
      defaultStock: 30,
      hasVariants: true
    },
    attributes: ["Taban", "Materyal", "Bağcık", "Kullanım Alanı"],
    inventoryTracking: true
  },

  // Çanta & Cüzdan Kategorileri
  "cüzdan": {
    shopifyCategory: "Apparel & Accessories > Wallets & Money Clips",
    variantConfig: {
      colorLabel: "Renk",
      materialLabel: "Materyal",
      defaultStock: 100,
      hasVariants: true
    },
    attributes: ["Bölme Sayısı", "Materyal", "Boyut"],
    inventoryTracking: true
  },

  // Elektronik Kategorileri
  "telefon": {
    shopifyCategory: "Electronics > Phones & Accessories > Mobile Phones",
    variantConfig: {
      colorLabel: "Renk",
      defaultStock: 20,
      hasVariants: true
    },
    attributes: ["Hafıza", "RAM", "İşlemci", "Ekran Boyutu"],
    inventoryTracking: true
  },

  // Ev & Yaşam Kategorileri
  "nevresim takımı": {
    shopifyCategory: "Home & Garden > Linens > Bedding",
    variantConfig: {
      sizeLabel: "Boyut",
      colorLabel: "Renk",
      defaultStock: 40,
      hasVariants: true
    },
    attributes: ["Parça Sayısı", "Kumaş", "Yıkama Talimatı"],
    inventoryTracking: true
  },

  // Kozmetik Kategorileri
  "parfüm": {
    shopifyCategory: "Health & Beauty > Personal Care > Cosmetics > Fragrances",
    variantConfig: {
      sizeLabel: "Miktar",
      defaultStock: 60,
      hasVariants: true
    },
    attributes: ["Hacim", "Koku Ailesi", "Kalıcılık"],
    inventoryTracking: true
  },

  // Spor & Outdoor
  "yoga matı": {
    shopifyCategory: "Sporting Goods > Exercise & Fitness > Yoga & Pilates",
    variantConfig: {
      colorLabel: "Renk",
      defaultStock: 45,
      hasVariants: true
    },
    attributes: ["Kalınlık", "Materyal", "Boyut"],
    inventoryTracking: true
  }
};

export function getCategoryConfig(categories: string[]): z.infer<typeof CategoryConfig> {
  const normalizedCategories = categories.map(c => c.toLowerCase().trim());
  
  for (const [key, config] of Object.entries(categoryMapping)) {
    if (normalizedCategories.some(c => c.includes(key))) {
      return config;
    }
  }

  // Varsayılan konfigurasyon
  return {
    shopifyCategory: "Apparel & Accessories > Clothing",
    variantConfig: {
      sizeLabel: "Beden",
      colorLabel: "Renk",
      defaultStock: 50,
      hasVariants: true
    },
    attributes: [],
    inventoryTracking: true
  };
}
