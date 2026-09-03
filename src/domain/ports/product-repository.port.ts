import { Product, CreateProductDTO, UpdateProductDTO } from '../entities/product.entity';

export interface IProductRepository {
  create(id: string, data: CreateProductDTO): Promise<Product>;
  findById(id: string): Promise<Product | null>;
  update(id: string, data: UpdateProductDTO): Promise<Product | null>;
  delete(id: string): Promise<boolean>;
}
