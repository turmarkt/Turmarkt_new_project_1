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
  // Kozmetik Kategorileri
  "sampuan": {
    shopifyCategory: "Health & Beauty > Personal Care > Hair Care > Shampoo & Conditioner",
    variantConfig: {
      defaultStock: 50,
      hasVariants: false
    },
    attributes: ["Etki", "Hacim", "Saç Tipi", "İçerik"],
    inventoryTracking: true
  },
  "kozmetik": {
    shopifyCategory: "Health & Beauty > Personal Care",
    variantConfig: {
      defaultStock: 50,
      hasVariants: false
    },
    attributes: ["Etki", "Kullanım Alanı", "İçerik"],
    inventoryTracking: true
  },
  "bakim": {
    shopifyCategory: "Health & Beauty > Personal Care > Skin Care",
    variantConfig: {
      defaultStock: 50,
      hasVariants: false
    },
    attributes: ["Etki", "Cilt Tipi", "İçerik"],
    inventoryTracking: true
  },

  // Ayakkabı Kategorileri
  "babet": {
    shopifyCategory: "Apparel & Accessories > Shoes > Flats",
    variantConfig: {
      sizeLabel: "Numara",
      colorLabel: "Renk",
      defaultStock: 30,
      hasVariants: true
    },
    attributes: ["Taban", "Materyal", "Kullanım Alanı"],
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
  "ayakkabi": {
    shopifyCategory: "Apparel & Accessories > Shoes",
    variantConfig: {
      sizeLabel: "Numara",
      colorLabel: "Renk",
      defaultStock: 30,
      hasVariants: true
    },
    attributes: ["Taban", "Materyal", "Kullanım Alanı"],
    inventoryTracking: true
  },
  "bot": {
    shopifyCategory: "Apparel & Accessories > Shoes > Boots",
    variantConfig: {
      sizeLabel: "Numara",
      colorLabel: "Renk",
      defaultStock: 30,
      hasVariants: true
    },
    attributes: ["Taban", "Materyal", "Bağcık", "Kullanım Alanı"],
    inventoryTracking: true
  },

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
  }
};

export function getCategoryConfig(categories: string[]): z.infer<typeof CategoryConfig> {
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

  // Kozmetik kategorilerini kontrol et
  if (normalizedCategories.some(c => c.includes('sampuan') || c.includes('sac'))) {
    return categoryMapping['sampuan'];
  }
  if (normalizedCategories.some(c => c.includes('kozmetik') || c.includes('bakim'))) {
    return categoryMapping['kozmetik'];
  }

  // Spesifik ayakkabı kategorilerini kontrol et
  const specificShoeTypes = ['babet', 'sneaker', 'bot', 'cizme', 'sandalet', 'terlik'];
  for (const shoeType of specificShoeTypes) {
    if (normalizedCategories.some(c => c.includes(shoeType))) {
      return categoryMapping[shoeType] || categoryMapping['ayakkabi'];
    }
  }

  // Genel ayakkabı kategorisi kontrolü
  if (normalizedCategories.some(c => c.includes('ayakkabi'))) {
    return categoryMapping['ayakkabi'];
  }

  // Cinsiyet bazlı kategori kontrolü
  if (normalizedCategories.some(c => c.includes('erkek'))) {
    return categoryMapping['erkek'];
  }
  if (normalizedCategories.some(c => c.includes('kadin'))) {
    return categoryMapping['kadın'];
  }

  // Genel varsayılan kategori
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