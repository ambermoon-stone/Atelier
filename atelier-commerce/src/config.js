import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const number = (key, fallback) => Number.isFinite(Number(process.env[key])) ? Number(process.env[key]) : fallback;

export const config = {
  root,
  port: number('PORT', 3000),
  appUrl: process.env.APP_URL || `http://localhost:${number('PORT', 3000)}`,
  production: process.env.NODE_ENV === 'production',
  databaseFile: path.resolve(root, process.env.DATABASE_FILE || './data/atelier.db'),
  jwtSecret: process.env.JWT_SECRET || 'development-secret-change-before-deploy',
  currency: process.env.CURRENCY || 'BDT',
  taxRate: number('TAX_RATE', 0.05),
  freeShippingOver: number('FREE_SHIPPING_OVER', 8000),
  shippingStandard: number('SHIPPING_STANDARD', 120),
  shippingExpress: number('SHIPPING_EXPRESS', 300),
  uploadDir: path.join(root, 'public', 'uploads')
};