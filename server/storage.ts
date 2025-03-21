import { products, type Product, type InsertProduct } from "@shared/schema";

export interface IStorage {
  saveProduct(product: InsertProduct): Promise<Product>;
  getProduct(url: string): Promise<Product | undefined>;
  reset(): void;
  addToHistory(url: string): void;
  getHistory(): string[];
}

export class MemStorage implements IStorage {
  private products: Map<string, Product>;
  private currentId: number;
  private urlHistory: string[];

  constructor() {
    this.products = new Map();
    this.currentId = 1;
    this.urlHistory = [];
  }

  async saveProduct(insertProduct: InsertProduct): Promise<Product> {
    const id = this.currentId++;
    const product: Product = { ...insertProduct, id };
    this.products.set(product.url, product);
    this.addToHistory(product.url);
    return product;
  }

  async getProduct(url: string): Promise<Product | undefined> {
    return this.products.get(url);
  }

  reset(): void {
    this.products.clear();
    this.currentId = 1;
  }

  addToHistory(url: string): void {
    // URL zaten varsa, onu listeden çıkar
    this.urlHistory = this.urlHistory.filter(u => u !== url);
    // URL'yi listenin başına ekle
    this.urlHistory.unshift(url);
    // Sadece son 3 URL'yi tut
    if (this.urlHistory.length > 3) {
      this.urlHistory = this.urlHistory.slice(0, 3);
    }
  }

  getHistory(): string[] {
    return this.urlHistory;
  }
}

export const storage = new MemStorage();