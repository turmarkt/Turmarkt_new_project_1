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

// Shopify standart kategori yapısı kullanılıyor
export const categoryMapping: CategoryMapping = {
  // Giyim Kategorileri
  "giyim": {
    shopifyCategory: "Apparel & Accessories > Clothing",
    variantConfig: {
      sizeLabel: "Beden",
      colorLabel: "Renk",
      defaultStock: 50,
      hasVariants: true
    },
    attributes: ["Kumaş", "Desen", "Yaka Tipi", "Kol Boyu"],
    inventoryTracking: true
  },
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
  "ayakkabı": {
    shopifyCategory: "Apparel & Accessories > Shoes",
    variantConfig: {
      sizeLabel: "Numara",
      colorLabel: "Renk",
      defaultStock: 30,
      hasVariants: true
    },
    attributes: ["Taban", "Materyal", "Bağcık", "Kullanım Alanı"],
    inventoryTracking: true
  },
  "sneaker": {
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
  "çanta": {
    shopifyCategory: "Apparel & Accessories > Handbags & Wallets > Handbags",
    variantConfig: {
      colorLabel: "Renk",
      materialLabel: "Materyal",
      defaultStock: 30,
      hasVariants: true
    },
    attributes: ["Malzeme", "Boyut", "Bölme Sayısı", "Kullanım Alanı"],
    inventoryTracking: true
  },
  "cüzdan": {
    shopifyCategory: "Apparel & Accessories > Handbags & Wallets > Wallets & Money Clips",
    variantConfig: {
      colorLabel: "Renk",
      materialLabel: "Materyal",
      defaultStock: 50,
      hasVariants: true
    },
    attributes: ["Malzeme", "Boyut", "Bölme Sayısı", "Kart Bölmesi"],
    inventoryTracking: true
  },
  "kartlık": {
    shopifyCategory: "Apparel & Accessories > Handbags & Wallets > Wallets & Money Clips",
    variantConfig: {
      colorLabel: "Renk",
      materialLabel: "Materyal",
      defaultStock: 50,
      hasVariants: true
    },
    attributes: ["Malzeme", "Boyut", "Kart Bölmesi"],
    inventoryTracking: true
  }
};

export function getCategoryConfig(categories: string[]): z.infer<typeof CategoryConfig> {
  const normalizedCategories = categories.map(c => c.toLowerCase().trim());

  // Her kategoriyi kontrol et
  for (const category of normalizedCategories) {
    for (const [key, config] of Object.entries(categoryMapping)) {
      if (category.includes(key)) {
        return config;
      }
    }
  }

  // Genel kategori kontrolü
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