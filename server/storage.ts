import { products, type Product, type InsertProduct, ProductAttribute, type ProductAttributes } from "@shared/schema";

export interface IStorage {
  saveProduct(product: InsertProduct): Promise<Product>;
  getProduct(url: string): Promise<Product | undefined>;
}

export class MemStorage implements IStorage {
  private products: Map<string, Product>;
  private currentId: number;

  constructor() {
    this.products = new Map();
    this.currentId = 1;
  }

  async saveProduct(insertProduct: InsertProduct): Promise<Product> {
    const id = this.currentId++;

    // Sadece ProductAttribute'da tanımlı özellikleri ekle
    const filteredAttributes: ProductAttributes = {
      "Hacim": ProductAttribute.Hacim,
      "Mensei": ProductAttribute.Mensei,
      "Paket İçeriği": ProductAttribute.PaketIcerigi
    };

    // Ürünü güncelle
    const product: Product = { 
      ...insertProduct, 
      id,
      attributes: filteredAttributes
    };

    this.products.set(product.url, product);
    return product;
  }

  async getProduct(url: string): Promise<Product | undefined> {
    return this.products.get(url);
  }
}

export const storage = new MemStorage();