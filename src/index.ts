import { Pool } from 'pg';
import Redis from 'ioredis';
import fs from 'fs';
import path from 'path';
import { PostgresProductRepository } from './infrastructure/database/postgres-product.repository';
import { RedisCacheAdapter } from './infrastructure/cache/redis-cache.adapter';
import { ProductService } from './services/product.service';
import { createApp } from './http/app';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/catalog';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const CACHE_TTL_SECONDS = process.env.CACHE_TTL ? parseInt(process.env.CACHE_TTL, 10) : 60;

async function bootstrap() {
  console.log('Connecting to PostgreSQL...');
  const pool = new Pool({ connectionString: DATABASE_URL });

  // Run schema migration
  const schemaPath = path.join(__dirname, 'infrastructure/database/schema.sql');
  if (fs.existsSync(schemaPath)) {
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    await pool.query(schemaSql);
    console.log('Database schema applied.');
  }

  console.log('Connecting to Redis...');
  const redis = new Redis(REDIS_URL);

  const repository = new PostgresProductRepository(pool);
  const cacheAdapter = new RedisCacheAdapter(redis);
  const productService = new ProductService(repository, cacheAdapter, {
    cacheTtlSeconds: CACHE_TTL_SECONDS,
  });

  const app = createApp({ productService });

  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

if (require.main === module) {
  bootstrap().catch((err) => {
    console.error('Fatal bootstrap error:', err);
    process.exit(1);
  });
}
