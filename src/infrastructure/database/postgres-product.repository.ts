import { Pool } from 'pg';
import { Product, CreateProductDTO, UpdateProductDTO } from '../../domain/entities/product.entity';
import { IProductRepository } from '../../domain/ports/product-repository.port';

interface ProductRow {
  id: string;
  name: string;
  description: string;
  price: string | number;
  stock: number;
  created_at: Date;
  updated_at: Date;
}

export class PostgresProductRepository implements IProductRepository {
  constructor(private readonly pool: Pool) {}

  private mapRowToEntity(row: ProductRow): Product {
    return {
      id: row.id,
      name: row.name,
      description: row.description || '',
      price: typeof row.price === 'string' ? parseFloat(row.price) : Number(row.price),
      stock: Number(row.stock),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  async create(id: string, data: CreateProductDTO): Promise<Product> {
    const query = `
      INSERT INTO products (id, name, description, price, stock, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      RETURNING *;
    `;
    const values = [
      id,
      data.name,
      data.description ?? '',
      data.price,
      data.stock ?? 0,
    ];

    const result = await this.pool.query<ProductRow>(query, values);
    return this.mapRowToEntity(result.rows[0]);
  }

  async findById(id: string): Promise<Product | null> {
    const query = `SELECT * FROM products WHERE id = $1 LIMIT 1;`;
    const result = await this.pool.query<ProductRow>(query, [id]);

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToEntity(result.rows[0]);
  }

  async update(id: string, data: UpdateProductDTO): Promise<Product | null> {
    const current = await this.findById(id);
    if (!current) {
      return null;
    }

    const updatedName = data.name !== undefined ? data.name : current.name;
    const updatedDescription = data.description !== undefined ? data.description : current.description;
    const updatedPrice = data.price !== undefined ? data.price : current.price;
    const updatedStock = data.stock !== undefined ? data.stock : current.stock;

    const query = `
      UPDATE products
      SET name = $1, description = $2, price = $3, stock = $4, updated_at = NOW()
      WHERE id = $5
      RETURNING *;
    `;
    const values = [updatedName, updatedDescription, updatedPrice, updatedStock, id];

    const result = await this.pool.query<ProductRow>(query, values);
    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToEntity(result.rows[0]);
  }

  async delete(id: string): Promise<boolean> {
    const query = `DELETE FROM products WHERE id = $1;`;
    const result = await this.pool.query(query, [id]);
    return (result.rowCount ?? 0) > 0;
  }
}
