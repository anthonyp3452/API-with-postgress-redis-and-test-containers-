import crypto from 'crypto';
import { Product, CreateProductDTO, UpdateProductDTO } from '../domain/entities/product.entity';
import { IProductRepository } from '../domain/ports/product-repository.port';
import { ICacheAdapter } from '../domain/ports/cache-adapter.port';
import { NotFoundError } from './errors/not-found.error';

export interface ProductResult {
  product: Product;
  source: 'cache' | 'database';
}

export interface ProductServiceOptions {
  cacheTtlSeconds?: number;
}

export class ProductService {
  private readonly cacheTtlSeconds: number;

  constructor(
    private readonly repository: IProductRepository,
    private readonly cache: ICacheAdapter,
    options: ProductServiceOptions = {}
  ) {
    this.cacheTtlSeconds = options.cacheTtlSeconds ?? 60;
  }

  private getCacheKey(id: string): string {
    return `product:${id}`;
  }

  async createProduct(data: CreateProductDTO): Promise<Product> {
    const id = crypto.randomUUID();
    const product = await this.repository.create(id, data);

    // Invalidate any stale entry for this key
    await this.cache.del(this.getCacheKey(id));

    return product;
  }

  async getProductById(id: string): Promise<ProductResult> {
    const cacheKey = this.getCacheKey(id);

    // 1. Try reading from cache first
    const cachedProduct = await this.cache.get<Product>(cacheKey);
    if (cachedProduct) {
      return {
        product: cachedProduct,
        source: 'cache',
      };
    }

    // 2. Cache miss: read from PostgreSQL repository
    const product = await this.repository.findById(id);
    if (!product) {
      throw new NotFoundError(`Product with id '${id}' not found`);
    }

    // 3. Store in Redis cache with configured TTL
    await this.cache.set(cacheKey, product, this.cacheTtlSeconds);

    return {
      product,
      source: 'database',
    };
  }

  async updateProduct(id: string, data: UpdateProductDTO): Promise<Product> {
    const cacheKey = this.getCacheKey(id);

    // 1. Update in PostgreSQL
    const updated = await this.repository.update(id, data);
    if (!updated) {
      throw new NotFoundError(`Product with id '${id}' not found`);
    }

    // 2. Invalidate cache to guarantee no stale data is served
    await this.cache.del(cacheKey);

    return updated;
  }

  async deleteProduct(id: string): Promise<void> {
    const cacheKey = this.getCacheKey(id);
    const deleted = await this.repository.delete(id);
    if (!deleted) {
      throw new NotFoundError(`Product with id '${id}' not found`);
    }
    await this.cache.del(cacheKey);
  }
}
