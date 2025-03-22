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
  "erkek giyim": {
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
  "kadın giyim": {
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

  // Kozmetik ve Bakım
  "kozmetik": {
    shopifyCategory: "Health & Beauty > Personal Care",
    variantConfig: {
      defaultStock: 50,
      hasVariants: false
    },
    attributes: ["Etki", "Kullanım Alanı", "İçerik"],
    inventoryTracking: true
  },
  "kişisel bakım": {
    shopifyCategory: "Health & Beauty > Personal Care",
    variantConfig: {
      defaultStock: 50,
      hasVariants: false
    },
    attributes: ["Etki", "Kullanım Alanı", "İçerik"],
    inventoryTracking: true
  }
};

export function getCategoryConfig(categories: string[]): z.infer<typeof CategoryConfig> {
  if (!categories || categories.length === 0) {
    return {
      shopifyCategory: "Health & Beauty > Personal Care",
      variantConfig: {
        defaultStock: 50,
        hasVariants: false
      },
      attributes: [],
      inventoryTracking: true
    };
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

  // Her kategoriyi kontrol et
  for (const category of normalizedCategories) {
    for (const [key, value] of Object.entries(categoryMapping)) {
      if (category.includes(key)) {
        return value;
      }
    }
  }

  // Eğer hiçbir eşleşme bulunamazsa, kategoriye göre varsayılan değerler
  if (normalizedCategories.some(c => c.includes('kozmetik') || c.includes('bakim'))) {
    return categoryMapping['kozmetik'];
  }

  if (normalizedCategories.some(c => c.includes('erkek'))) {
    return categoryMapping['erkek'];
  }

  if (normalizedCategories.some(c => c.includes('kadin'))) {
    return categoryMapping['kadın'];
  }

  if (normalizedCategories.some(c => 
    c.includes('tisort') || 
    c.includes('tshirt') || 
    c.includes('t-shirt'))) {
    return categoryMapping['tişört'];
  }

  // En genel varsayılan kategori
  return {
    shopifyCategory: "Health & Beauty > Personal Care",
    variantConfig: {
      defaultStock: 50,
      hasVariants: false
    },
    attributes: [],
    inventoryTracking: true
  };
}