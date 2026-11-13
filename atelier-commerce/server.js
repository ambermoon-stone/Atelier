import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import compression from 'compression';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { config } from './src/config.js';
import { all,get } from './src/db.js';
import { escapeHtml } from './src/utils/index.js';
import { csrfProtection,csrfToken } from './src/middleware/csrf.js';
import { attachUser } from './src/middleware/auth.js';
import authRoutes from './src/routes/auth.js';
import catalogRoutes from './src/routes/catalog.js';
import cartRoutes from './src/routes/cart.js';
import orderRoutes from './src/routes/orders.js';
import paymentRoutes from './src/routes/payments.js';
import adminRoutes from './src/routes/admin.js';
import seoRoutes from './src/routes/seo.js';

export const app=express();
app.disable('x-powered-by');
app.set('trust proxy',config.production?1:false);
app.use(helmet({contentSecurityPolicy:false,crossOriginResourcePolicy:{policy:'cross-origin'}}));
app.use(compression());
app.use(express.json({limit:'1mb',verify:(req,res,buffer)=>{req.rawBody=Buffer.from(buffer);}}));
app.use(express.urlencoded({extended:true,verify:(req,res,buffer)=>{req.rawBody=Buffer.from(buffer);}}));
app.use(cookieParser());
app.use('/api/auth',rateLimit({windowMs:15*60*1000,max:25,standardHeaders:true,legacyHeaders:false}));
app.use('/api',rateLimit({windowMs:60000,max:400,standardHeaders:true,legacyHeaders:false}));
app.get('/api/csrf',csrfToken);
app.use('/api',csrfProtection,attachUser);
app.use('/api/auth',authRoutes);
app.use('/api',catalogRoutes);
app.use('/api',cartRoutes);
app.use('/api',orderRoutes);
app.use('/api/payments',paymentRoutes);
app.use('/api/admin',adminRoutes);
app.use('/',seoRoutes);

const publicDir=path.join(config.root,'public');
app.use('/uploads',express.static(config.uploadDir,{maxAge:'7d'}));
app.use(express.static(publicDir,{index:false,maxAge:config.production?'1h':0}));
app.get('*',(req,res)=>{
  const settings=Object.fromEntries(all('SELECT key,value FROM settings').map(item=>[item.key,item.value]));
  let title=`${settings.store_name||'ATELIER'} — ${settings.tagline||'Considered objects for modern living'}`;
  let description=settings.hero_sub||'Clothing and objects chosen for how they age, not just how they arrive.';
  let image=settings.hero_image||'/assets/hero-fallback.svg';
  const productMatch=req.path.match(/^\/product\/([^/]+)$/);
  if(productMatch){const product=get('SELECT * FROM products WHERE slug=?',decodeURIComponent(productMatch[1]));if(product){title=`${product.name} — ${settings.store_name||'ATELIER'}`;description=product.description;image=get('SELECT url FROM product_images WHERE product_id=? ORDER BY position LIMIT 1',product.id)?.url||image;}}
  if(req.path==='/shop'){title=`Shop the collection — ${settings.store_name||'ATELIER'}`;description='Browse considered clothing, objects, and new arrivals.';}
  if(req.path.startsWith('/admin')){title=`Admin — ${settings.store_name||'ATELIER'}`;description='Protected store administration.';}
  const html=fs.readFileSync(path.join(publicDir,'index.html'),'utf8').replaceAll('{{TITLE}}',escapeHtml(title)).replaceAll('{{DESCRIPTION}}',escapeHtml(description)).replaceAll('{{OG_IMAGE}}',escapeHtml(image)).replace('/app.js"','/app.js?v='+Date.now()+'"');
  res.type('html').send(html);
});
app.use((error,req,res,next)=>{
  console.error(error);
  if(res.headersSent)return next(error);
  const status=Number(error.status)||500;
  res.status(status).json({error:status===500?'SERVER_ERROR':'REQUEST_ERROR',message:config.production&&status===500?'Unexpected server error.':error.message});
});

export function start(port=config.port) {
  const server=app.listen(port,()=>console.log(`ATELIER_READY http://127.0.0.1:${server.address().port}`));
  return server;
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(fileURLToPath(import.meta.url)))start();