import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { Express } from 'express';
import { setupTestEnvironment, TestEnvironment } from '../helpers/test-containers.setup';
import { PostgresProductRepository } from '../../src/infrastructure/database/postgres-product.repository';
import { RedisCacheAdapter } from '../../src/infrastructure/cache/redis-cache.adapter';
import { ProductService } from '../../src/services/product.service';
import { createApp } from '../../src/http/app';

describe('Product Catalog API Integration with Real PostgreSQL and Redis (Testcontainers)', () => {
  let testEnv: TestEnvironment;
  let repository: PostgresProductRepository;
  let cacheAdapter: RedisCacheAdapter;
  let productService: ProductService;
  let app: Express;
  const CACHE_TTL_SECONDS = 30;

  beforeAll(async () => {
    // 1. Start disposable containers and get dynamic connections
    testEnv = await setupTestEnvironment();

    // 2. Wire up real infrastructure adapters (NO MOCKS allowed)
    repository = new PostgresProductRepository(testEnv.pgPool);
    cacheAdapter = new RedisCacheAdapter(testEnv.redisClient);
    productService = new ProductService(repository, cacheAdapter, {
      cacheTtlSeconds: CACHE_TTL_SECONDS,
    });

    // 3. Instantiate Express HTTP app
    app = createApp({ productService });
  }, 120000);

  beforeEach(async () => {
    // Isolate every test: clean database table and flush Redis cache
    await testEnv.cleanupData();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    // Cleanly terminate clients, connections and stop containers
    if (testEnv) {
      await testEnv.teardown();
    }
  }, 60000);

  it('Scenario 1: Given product data, when creating a product, then it should be persisted directly in PostgreSQL and cache invalidated', async () => {
    // Arrange
    const newProductPayload = {
      name: 'Mechanical Keyboard RGB',
      description: 'Hot-swappable mechanical switches',
      price: 129.99,
      stock: 25,
    };

    // Act: Send POST to API
    const response = await request(app)
      .post('/api/v1/products')
      .send(newProductPayload);

    // Assert: HTTP Response
    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('id');
    expect(response.body.name).toBe(newProductPayload.name);
    expect(response.body.price).toBe(newProductPayload.price);
    expect(response.body.stock).toBe(newProductPayload.stock);

    const createdId = response.body.id;

    // Direct Verification in PostgreSQL: Query real database with raw SQL
    const dbResult = await testEnv.pgPool.query(
      'SELECT id, name, description, price, stock FROM products WHERE id = $1',
      [createdId]
    );

    expect(dbResult.rowCount).toBe(1);
    const dbRow = dbResult.rows[0];
    expect(dbRow.id).toBe(createdId);
    expect(dbRow.name).toBe(newProductPayload.name);
    expect(parseFloat(dbRow.price)).toBe(newProductPayload.price);
    expect(dbRow.stock).toBe(newProductPayload.stock);

    // Verify Redis has no stale data for this new product ID
    const cachedData = await testEnv.redisClient.get(`product:${createdId}`);
    expect(cachedData).toBeNull();
  });

  it('Scenario 2: Given an empty cache, when querying a product by ID, then it retrieves from PostgreSQL and populates Redis with TTL', async () => {
    // Arrange: Create product directly in PostgreSQL to simulate existing record
    const id = 'prod-test-cache-miss-1';
    await testEnv.pgPool.query(
      'INSERT INTO products (id, name, description, price, stock) VALUES ($1, $2, $3, $4, $5)',
      [id, 'Wireless Gaming Mouse', 'Ultra-lightweight sensor', 79.99, 50]
    );

    // Verify cache is completely empty before the request
    const cacheBefore = await testEnv.redisClient.get(`product:${id}`);
    expect(cacheBefore).toBeNull();

    // Act: Query product via API
    const response = await request(app).get(`/api/v1/products/${id}`);

    // Assert: Response indicates cache MISS and returns accurate data
    expect(response.status).toBe(200);
    expect(response.headers['x-cache']).toBe('MISS');
    expect(response.body.id).toBe(id);
    expect(response.body.name).toBe('Wireless Gaming Mouse');
    expect(response.body.price).toBe(79.99);

    // Direct Verification in Redis: Value must now be stored with configurable TTL
    const cacheAfterRaw = await testEnv.redisClient.get(`product:${id}`);
    expect(cacheAfterRaw).not.toBeNull();

    const cachedProduct = JSON.parse(cacheAfterRaw!);
    expect(cachedProduct.id).toBe(id);
    expect(cachedProduct.name).toBe('Wireless Gaming Mouse');
    expect(cachedProduct.price).toBe(79.99);

    // TTL check
    const ttl = await testEnv.redisClient.ttl(`product:${id}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(CACHE_TTL_SECONDS);
  });

  it('Scenario 3: Given a populated cache, when querying the same product again, then it demonstrates a Cache Hit without querying PostgreSQL', async () => {
    // Arrange: Seed product and trigger first request to populate cache
    const id = 'prod-test-cache-hit-1';
    await testEnv.pgPool.query(
      'INSERT INTO products (id, name, description, price, stock) VALUES ($1, $2, $3, $4, $5)',
      [id, 'Studio Headphones', 'High fidelity audio monitor', 199.50, 15]
    );

    // First request: Cache MISS (populates Redis)
    const firstResponse = await request(app).get(`/api/v1/products/${id}`);
    expect(firstResponse.status).toBe(200);
    expect(firstResponse.headers['x-cache']).toBe('MISS');

    // Spy on repository findById to prove database is NOT queried on subsequent read
    const repoSpy = vi.spyOn(repository, 'findById');

    // Act: Second request for the same product
    const secondResponse = await request(app).get(`/api/v1/products/${id}`);

    // Assert: Demonstrates Cache Hit
    expect(secondResponse.status).toBe(200);
    expect(secondResponse.headers['x-cache']).toBe('HIT');
    expect(secondResponse.body.id).toBe(id);
    expect(secondResponse.body.name).toBe('Studio Headphones');
    expect(secondResponse.body.price).toBe(199.50);

    // Crucial proof: Repository was NEVER called during cache hit
    expect(repoSpy).not.toHaveBeenCalled();
  });

  it('Scenario 4: Given an existing cached product, when updating the product, then PostgreSQL is updated and Redis cache is invalidated to avoid stale data', async () => {
    // Arrange: Create product and populate cache
    const id = 'prod-test-update-1';
    await testEnv.pgPool.query(
      'INSERT INTO products (id, name, description, price, stock) VALUES ($1, $2, $3, $4, $5)',
      [id, '4K IPS Monitor', '60Hz Office display', 299.99, 10]
    );

    // Warm the cache
    const warmRes = await request(app).get(`/api/v1/products/${id}`);
    expect(warmRes.headers['x-cache']).toBe('MISS');

    const cacheWarm = await testEnv.redisClient.get(`product:${id}`);
    expect(cacheWarm).not.toBeNull();

    // Act: Update product to a new price and new name
    const updatePayload = {
      name: '4K IPS Monitor 144Hz Gaming',
      price: 389.99,
      stock: 8,
    };

    const updateRes = await request(app)
      .put(`/api/v1/products/${id}`)
      .send(updatePayload);

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.name).toBe(updatePayload.name);
    expect(updateRes.body.price).toBe(updatePayload.price);
    expect(updateRes.body.stock).toBe(updatePayload.stock);

    // Direct Verification in PostgreSQL: The update is actually saved in DB
    const dbCheck = await testEnv.pgPool.query(
      'SELECT name, price, stock FROM products WHERE id = $1',
      [id]
    );
    expect(dbCheck.rows[0].name).toBe(updatePayload.name);
    expect(parseFloat(dbCheck.rows[0].price)).toBe(updatePayload.price);
    expect(dbCheck.rows[0].stock).toBe(updatePayload.stock);

    // Direct Verification in Redis: Cache key must be invalidated (deleted)
    const cacheAfterUpdate = await testEnv.redisClient.get(`product:${id}`);
    expect(cacheAfterUpdate).toBeNull();

    // Act 2: Subsequent GET must NOT return stale data; it should be a Cache MISS with the updated data
    const freshGetRes = await request(app).get(`/api/v1/products/${id}`);
    expect(freshGetRes.status).toBe(200);
    expect(freshGetRes.headers['x-cache']).toBe('MISS');
    expect(freshGetRes.body.name).toBe('4K IPS Monitor 144Hz Gaming');
    expect(freshGetRes.body.price).toBe(389.99);
  });

  it('Scenario 5: Given a non-existent product ID, when queried, then it produces an explicit 404 response without polluting Redis', async () => {
    // Arrange
    const nonExistentId = '00000000-non-existent-id-00000000';

    // Act
    const response = await request(app).get(`/api/v1/products/${nonExistentId}`);

    // Assert: Explicit and consistent 404 error
    expect(response.status).toBe(404);
    expect(response.body).toHaveProperty('error');
    expect(response.body.error).toContain(`Product with id '${nonExistentId}' not found`);

    // Verify Redis has no ghost/polluting entries
    const cached = await testEnv.redisClient.get(`product:${nonExistentId}`);
    expect(cached).toBeNull();
  });

  it('Scenario 6: Repeatability and order independence: multiple sequential operations maintain complete data isolation', async () => {
    // Demonstrate that tests can execute repeatedly without interference
    const id = 'prod-isolation-check';
    const payload = {
      name: 'Ergonomic Chair',
      description: 'Lumbar support',
      price: 249.0,
      stock: 12,
    };

    const postRes = await request(app).post('/api/v1/products').send(payload);
    expect(postRes.status).toBe(201);

    const getRes1 = await request(app).get(`/api/v1/products/${postRes.body.id}`);
    expect(getRes1.status).toBe(200);
    expect(getRes1.headers['x-cache']).toBe('MISS');

    const getRes2 = await request(app).get(`/api/v1/products/${postRes.body.id}`);
    expect(getRes2.status).toBe(200);
    expect(getRes2.headers['x-cache']).toBe('HIT');
  });
});
