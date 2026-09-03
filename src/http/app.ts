import express, { Express } from 'express';
import { ProductService } from '../services/product.service';
import { ProductController } from './controllers/product.controller';
import { createProductRouter } from './routes/product.routes';

export interface AppDependencies {
  productService: ProductService;
}

export function createApp(deps: AppDependencies): Express {
  const app = express();

  app.use(express.json());

  // Health check endpoint
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Product routes mounted under /api/v1
  const controller = new ProductController(deps.productService);
  const router = createProductRouter(controller);
  app.use('/api/v1', router);

  return app;
}
