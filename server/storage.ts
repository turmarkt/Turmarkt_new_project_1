import { products, type Product, type InsertProduct } from "@shared/schema";

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
    const product: Product = { ...insertProduct, id };
    this.products.set(product.url, product);
    return product;
  }

  async getProduct(url: string): Promise<Product | undefined> {
    return this.products.get(url);
  }
}

export const storage = new MemStorage();
