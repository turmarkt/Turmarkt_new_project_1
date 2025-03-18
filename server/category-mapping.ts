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
  // Giyim Kategorileri
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
  "cüzdan": {
    shopifyCategory: "Apparel & Accessories > Handbags, Wallets & Cases > Wallets & Money Clips",
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
    shopifyCategory: "Apparel & Accessories > Handbags, Wallets & Cases > Wallets & Money Clips",
    variantConfig: {
      colorLabel: "Renk",
      materialLabel: "Materyal",
      defaultStock: 50,
      hasVariants: true
    },
    attributes: ["Malzeme", "Boyut", "Kart Bölmesi"],
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
  }
};

export function getCategoryConfig(categories: string[]): z.infer<typeof CategoryConfig> {
  const normalizedCategories = categories.map(c => c.toLowerCase().trim());

  // Önce tam eşleşme ara
  for (const category of normalizedCategories) {
    const exactMatch = Object.entries(categoryMapping).find(([key]) => 
      category === key || category.includes(key)
    );
    if (exactMatch) {
      return exactMatch[1];
    }
  }

  // Kısmi eşleşme ara
  for (const category of normalizedCategories) {
    for (const [key, config] of Object.entries(categoryMapping)) {
      if (category.includes(key)) {
        return config;
      }
    }
  }

  // Cinsiyet bazlı varsayılan kategori
  if (normalizedCategories.some(c => c.includes('erkek'))) {
    return categoryMapping['erkek'];
  }
  if (normalizedCategories.some(c => c.includes('kadın'))) {
    return categoryMapping['kadın'];
  }

  // Genel varsayılan kategori
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