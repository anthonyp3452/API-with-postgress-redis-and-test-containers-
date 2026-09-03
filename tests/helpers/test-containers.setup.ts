import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { Pool } from 'pg';
import Redis from 'ioredis';
import fs from 'fs';
import path from 'path';

export interface TestEnvironment {
  pgContainer: StartedPostgreSqlContainer;
  redisContainer: StartedRedisContainer;
  pgPool: Pool;
  redisClient: Redis;
  cleanupData: () => Promise<void>;
  teardown: () => Promise<void>;
}

export async function setupTestEnvironment(): Promise<TestEnvironment> {
  // Start PostgreSQL container with disposable, isolated environment
  const pgContainer = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('test_catalog')
    .withUsername('test_user')
    .withPassword('test_pass')
    .start();

  // Start Redis container
  const redisContainer = await new RedisContainer('redis:7-alpine').start();

  // Build dynamic connections without fixed ports
  const pgPool = new Pool({
    connectionString: pgContainer.getConnectionUri(),
  });

  const redisClient = new Redis(redisContainer.getConnectionUrl());

  // Apply database migration schema automatically
  const schemaPath = path.join(__dirname, '../../src/infrastructure/database/schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  await pgPool.query(schemaSql);

  // Helper to clean data between tests to guarantee test isolation
  const cleanupData = async () => {
    await pgPool.query('TRUNCATE TABLE products RESTART IDENTITY CASCADE;');
    await redisClient.flushall();
  };

  // Helper to cleanly close all connections and dispose containers
  const teardown = async () => {
    try {
      await redisClient.quit();
    } catch (e) {
      console.error('Error closing Redis client:', e);
    }

    try {
      await pgPool.end();
    } catch (e) {
      console.error('Error closing Postgres pool:', e);
    }

    try {
      await redisContainer.stop();
    } catch (e) {
      console.error('Error stopping Redis container:', e);
    }

    try {
      await pgContainer.stop();
    } catch (e) {
      console.error('Error stopping Postgres container:', e);
    }
  };

  return {
    pgContainer,
    redisContainer,
    pgPool,
    redisClient,
    cleanupData,
    teardown,
  };
}
