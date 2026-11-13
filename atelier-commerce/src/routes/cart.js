import { Router } from 'express';
import { get,all,run } from '../db.js';
import { z,validate } from '../middleware/validate.js';
import { id,now } from '../utils/index.js';
import { cartFor,cartTotals,couponDiscount } from '../services/pricing.js';

const router=Router();
router.get('/cart',(req,res)=>res.json(cartTotals(cartFor(req,res))));
router.post('/cart/items',validate(z.object({productId:z.string().min(1),variantId:z.string().optional().default(''),qty:z.coerce.number().int().min(1).max(20).default(1)})),(req,res)=>{
  const {productId,variantId,qty}=req.validated,product=get("SELECT * FROM products WHERE id=? AND status='active'",productId);if(!product)return res.status(404).json({error:'PRODUCT_NOT_FOUND'});
  const variant=variantId?get('SELECT * FROM variants WHERE id=? AND product_id=?',variantId,product.id):get('SELECT * FROM variants WHERE product_id=? AND stock>0 ORDER BY color,size LIMIT 1',product.id);
  if(!variant)return res.status(400).json({error:'VARIANT_REQUIRED'});if(variant.stock<1)return res.status(409).json({error:'OUT_OF_STOCK'});
  const cart=cartFor(req,res),existing=get('SELECT * FROM cart_items WHERE cart_id=? AND product_id=? AND variant_id=?',cart.id,product.id,variant.id),price=product.price+variant.price_delta;
  if(existing)run('UPDATE cart_items SET qty=MIN(?,?),unit_price=? WHERE id=?',existing.qty+qty,variant.stock,price,existing.id);
  else run('INSERT INTO cart_items(id,cart_id,product_id,variant_id,qty,unit_price,created_at) VALUES(?,?,?,?,?,?,?)',id(),cart.id,product.id,variant.id,Math.min(qty,variant.stock),price,now());
  res.json(cartTotals(cart));
});
router.patch('/cart/items/:id',validate(z.object({qty:z.coerce.number().int().min(0).max(20)})),(req,res)=>{
  const cart=cartFor(req,res),item=get('SELECT * FROM cart_items WHERE id=? AND cart_id=?',req.params.id,cart.id);if(!item)return res.status(404).json({error:'NOT_FOUND'});
  const qty=req.validated.qty;if(!qty)run('DELETE FROM cart_items WHERE id=?',item.id);else {const variant=get('SELECT stock FROM variants WHERE id=?',item.variant_id);run('UPDATE cart_items SET qty=? WHERE id=?',Math.min(qty,variant?.stock||qty),item.id);}res.json(cartTotals(cart));
});
router.delete('/cart/items/:id',(req,res)=>{const cart=cartFor(req,res);run('DELETE FROM cart_items WHERE id=? AND cart_id=?',req.params.id,cart.id);res.json(cartTotals(cart));});
router.post('/cart/coupon',validate(z.object({code:z.string().max(40)})),(req,res)=>{const cart=cartFor(req,res),totals=cartTotals({...cart,coupon_code:null});try{couponDiscount(req.validated.code,totals.subtotal);const code=req.validated.code.toUpperCase()||null;run('UPDATE carts SET coupon_code=?,updated_at=? WHERE id=?',code,now(),cart.id);res.json(cartTotals({...cart,coupon_code:code}));}catch(error){res.status(400).json({error:error.message});}});
router.post('/cart/shipping',validate(z.object({method:z.enum(['standard','express'])})),(req,res)=>{const cart=cartFor(req,res);run('UPDATE carts SET shipping_method=?,updated_at=? WHERE id=?',req.validated.method,now(),cart.id);res.json(cartTotals(cart));});
router.get('/wishlist',(req,res)=>{const key=req.user?`u:${req.user.id}`:`g:${req.cookies.gid||''}`;res.json(all('SELECT p.* FROM wishlists w JOIN products p ON p.id=w.product_id WHERE w.owner_key=?',key));});
router.post('/wishlist/toggle',validate(z.object({productId:z.string()})),(req,res)=>{const key=req.user?`u:${req.user.id}`:`g:${req.cookies.gid||''}`,productId=req.validated.productId,exists=get('SELECT 1 FROM wishlists WHERE owner_key=? AND product_id=?',key,productId);if(exists)run('DELETE FROM wishlists WHERE owner_key=? AND product_id=?',key,productId);else run('INSERT OR IGNORE INTO wishlists(owner_key,product_id) VALUES(?,?)',key,productId);res.json({active:!exists});});
router.get('/recent',(req,res)=>{const key=req.user?`u:${req.user.id}`:`g:${req.cookies.gid||''}`;res.json(all('SELECT p.* FROM recently_viewed r JOIN products p ON p.id=r.product_id WHERE r.owner_key=? ORDER BY r.viewed_at DESC LIMIT 6',key));});
router.post('/recent',validate(z.object({productId:z.string()})),(req,res)=>{const key=req.user?`u:${req.user.id}`:`g:${req.cookies.gid||''}`;run('INSERT INTO recently_viewed(owner_key,product_id,viewed_at) VALUES(?,?,?) ON CONFLICT(owner_key,product_id) DO UPDATE SET viewed_at=excluded.viewed_at',key,req.validated.productId,now());res.json({ok:true});});
export default router;