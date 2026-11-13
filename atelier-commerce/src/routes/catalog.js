import { Router } from 'express';
import { get,all,run } from '../db.js';
import { z,validate } from '../middleware/validate.js';
import { id,now } from '../utils/index.js';
import { getSettings,couponDiscount } from '../services/pricing.js';
import { availablePayments } from '../services/payments.js';

const router=Router();
function productDto(product,full=false) {
  const images=all('SELECT url,alt FROM product_images WHERE product_id=? ORDER BY position',product.id);
  const variants=all('SELECT id,sku,color,size,stock,price_delta FROM variants WHERE product_id=? ORDER BY color,size',product.id);
  const category=get('SELECT name,slug FROM categories WHERE id=?',product.category_id);
  const result={...product,category:category?.name||'',category_slug:category?.slug||'',images,variants,image:images[0]?.url||'/assets/hero-fallback.svg',stock:variants.reduce((sum,item)=>sum+item.stock,0)};
  if(full){result.reviews=all('SELECT name,rating,title,body,verified,created_at FROM reviews WHERE product_id=? ORDER BY created_at DESC',product.id);result.related=all("SELECT * FROM products WHERE category_id=? AND id<>? AND status='active' LIMIT 4",product.category_id,product.id).map(item=>productDto(item));}
  return result;
}
router.get('/bootstrap',(req,res)=>{
  const home=flag=>all(`SELECT * FROM products WHERE status='active' AND ${flag}=1 ORDER BY created_at DESC LIMIT 4`).map(item=>productDto(item));
  res.json({settings:getSettings(),categories:all('SELECT * FROM categories ORDER BY position'),banners:all('SELECT * FROM banners WHERE active=1 ORDER BY rowid DESC'),payments:availablePayments(),home:{featured:home('featured'),trending:home('trending'),best:home('best_seller'),fresh:home('is_new')}});
});
router.get('/settings',(req,res)=>res.json(getSettings()));
router.get('/categories',(req,res)=>res.json(all('SELECT * FROM categories ORDER BY position')));
router.get('/products',(req,res)=>{
  const search=String(req.query.search||'').trim(),category=String(req.query.category||''),min=Number(req.query.min||0),max=Number(req.query.max||Number.MAX_SAFE_INTEGER);
  const page=Math.max(1,Number(req.query.page||1)),limit=Math.min(48,Math.max(1,Number(req.query.limit||12))),where=["p.status='active'"],params=[];
  if(search){where.push('(p.name LIKE ? OR p.description LIKE ?)');params.push(`%${search}%`,`%${search}%`);}
  if(category&&category!=='all'){where.push('c.slug=?');params.push(category);}
  for(const [query,column] of [['featured','featured'],['trending','trending'],['best','best_seller'],['new','is_new']])if(req.query[query])where.push(`p.${column}=1`);
  where.push('p.price BETWEEN ? AND ?');params.push(min,max);
  const sort={new:'p.created_at DESC',price_asc:'p.price ASC',price_desc:'p.price DESC',rating:'p.rating DESC',name:'p.name ASC',best:'p.best_seller DESC,p.rating DESC'}[req.query.sort]||'p.created_at DESC';
  const predicate=where.join(' AND '),items=all(`SELECT p.* FROM products p JOIN categories c ON c.id=p.category_id WHERE ${predicate} ORDER BY ${sort} LIMIT ? OFFSET ?`,...params,limit,(page-1)*limit).map(item=>productDto(item));
  const count=get(`SELECT COUNT(*) AS count FROM products p JOIN categories c ON c.id=p.category_id WHERE ${predicate}`,...params).count;
  res.json({items,count,page,limit,pages:Math.ceil(count/limit)});
});
router.get('/products/:slug',(req,res)=>{const product=get("SELECT * FROM products WHERE slug=? AND status='active'",req.params.slug);if(!product)return res.status(404).json({error:'NOT_FOUND'});res.json({product:productDto(product,true)});});
router.post('/products/:slug/reviews',validate(z.object({name:z.string().min(2).max(80),rating:z.coerce.number().int().min(1).max(5),title:z.string().max(100).default(''),body:z.string().min(8).max(1200)})),(req,res)=>{
  const product=get('SELECT id FROM products WHERE slug=?',req.params.slug);if(!product)return res.status(404).json({error:'NOT_FOUND'});const review=req.validated;
  run('INSERT INTO reviews(id,product_id,user_id,name,rating,title,body,verified,created_at) VALUES(?,?,?,?,?,?,?,?,?)',id(),product.id,req.user?.id||null,review.name,review.rating,review.title,review.body,req.user?1:0,now());
  const stats=get('SELECT AVG(rating) AS rating,COUNT(*) AS count FROM reviews WHERE product_id=?',product.id);run('UPDATE products SET rating=?,review_count=? WHERE id=?',stats.rating,stats.count,product.id);res.status(201).json({ok:true});
});
router.post('/newsletter',validate(z.object({email:z.string().email()})),(req,res)=>{run('INSERT INTO subscribers(id,email,created_at) VALUES(?,?,?) ON CONFLICT(email) DO UPDATE SET active=1',id(),req.validated.email.toLowerCase(),now());res.json({ok:true});});
router.get('/coupon',(req,res)=>{try{const result=couponDiscount(req.query.code,Number(req.query.subtotal||0));res.json({code:result.coupon?.code||'',discount:result.discount});}catch(error){res.status(400).json({error:error.message});}});
export { productDto };
export default router;