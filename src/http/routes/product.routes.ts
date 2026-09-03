import { Router } from 'express';
import { ProductController } from '../controllers/product.controller';

export function createProductRouter(controller: ProductController): Router {
  const router = Router();

  router.post('/products', controller.create);
  router.get('/products/:id', controller.getById);
  router.put('/products/:id', controller.update);

  return router;
}
