import { Router } from 'express';
import { db,get,all,run } from '../db.js';
import { requireAdmin } from '../middleware/auth.js';
import { uploadImage,processUpload } from '../middleware/upload.js';
import { z,validate } from '../middleware/validate.js';
import { id,now,slugify } from '../utils/index.js';
import { addOrderEvent,orderDto,restoreStock } from '../services/inventory.js';
import { productDto } from './catalog.js';

const router=Router();router.use(requireAdmin);
router.get('/overview',(req,res)=>{
  const revenue=get("SELECT COALESCE(SUM(total),0) AS value FROM orders WHERE payment_status IN ('PAID','PAY_ON_DELIVERY') AND status NOT IN ('REFUNDED','CANCELLED','PAYMENT_FAILED')").value;
  const stats={revenue,orders:get('SELECT COUNT(*) AS value FROM orders').value,products:get('SELECT COUNT(*) AS value FROM products').value,customers:get("SELECT COUNT(*) AS value FROM users WHERE role='customer'").value};
  const chart=Array.from({length:7},(_,index)=>{const date=new Date(Date.now()-(6-index)*86400000).toISOString().slice(0,10);return {date,value:get("SELECT COALESCE(SUM(total),0) AS value FROM orders WHERE substr(created_at,1,10)=? AND payment_status IN ('PAID','PAY_ON_DELIVERY') AND status NOT IN ('REFUNDED','CANCELLED','PAYMENT_FAILED')",date).value};});
  res.json({stats,chart,recent:all('SELECT * FROM orders ORDER BY created_at DESC LIMIT 8'),lowStock:all('SELECT v.id,v.stock,v.color,v.size,p.name,p.slug FROM variants v JOIN products p ON p.id=v.product_id WHERE v.stock<5 ORDER BY v.stock LIMIT 10')});
});
const productSchema=z.object({name:z.string().min(2).max(140),slug:z.string().max(90).optional().default(''),category_id:z.string().min(1),description:z.string().min(4).max(4000),story:z.string().max(2000).default(''),price:z.coerce.number().min(0),compare_at:z.coerce.number().min(0).nullable().optional(),status:z.enum(['active','draft']).default('active'),featured:z.coerce.boolean().default(false),trending:z.coerce.boolean().default(false),best_seller:z.coerce.boolean().default(false),is_new:z.coerce.boolean().default(false),images:z.array(z.string().max(500)).default([]),variants:z.array(z.object({color:z.string().max(40).default(''),size:z.string().max(40).default(''),stock:z.coerce.number().int().min(0),priceDelta:z.coerce.number().default(0),sku:z.string().max(60).default('')})).default([])});
function saveProduct(data,productId) {
  const save=db.transaction(()=>{
    const slug=data.slug?slugify(data.slug):`${slugify(data.name)}-${id().slice(0,5)}`;
    if(productId)run('UPDATE products SET name=?,slug=?,category_id=?,description=?,story=?,price=?,compare_at=?,status=?,featured=?,trending=?,best_seller=?,is_new=? WHERE id=?',data.name,slug,data.category_id,data.description,data.story,data.price,data.compare_at||null,data.status,+data.featured,+data.trending,+data.best_seller,+data.is_new,productId);
    else {productId=id();run("INSERT INTO products(id,slug,name,category_id,description,story,price,compare_at,currency,status,featured,trending,best_seller,is_new,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",productId,slug,data.name,data.category_id,data.description,data.story,data.price,data.compare_at||null,get("SELECT value FROM settings WHERE key='currency'")?.value||'BDT',data.status,+data.featured,+data.trending,+data.best_seller,+data.is_new,now());}
    run('DELETE FROM product_images WHERE product_id=?',productId);run('DELETE FROM variants WHERE product_id=?',productId);
    data.images.forEach((url,index)=>run('INSERT INTO product_images(id,product_id,url,alt,position) VALUES(?,?,?,?,?)',id(),productId,url,data.name,index));
    data.variants.forEach((variant,index)=>run('INSERT INTO variants(id,product_id,sku,color,size,stock,price_delta) VALUES(?,?,?,?,?,?,?)',id(),productId,variant.sku||`AT-${slug.slice(0,8).toUpperCase()}-${index+1}`,variant.color,variant.size,variant.stock,variant.priceDelta));return productId;
  });return save();
}
router.get('/products',(req,res)=>res.json(all('SELECT * FROM products ORDER BY created_at DESC').map(product=>productDto(product))));
router.post('/products',validate(productSchema),(req,res)=>{if(!get('SELECT id FROM categories WHERE id=?',req.validated.category_id))return res.status(400).json({error:'CATEGORY_NOT_FOUND'});res.status(201).json(productDto(get('SELECT * FROM products WHERE id=?',saveProduct(req.validated))));});
router.patch('/products/:id',validate(productSchema),(req,res)=>{if(!get('SELECT id FROM products WHERE id=?',req.params.id))return res.status(404).json({error:'NOT_FOUND'});saveProduct(req.validated,req.params.id);res.json(productDto(get('SELECT * FROM products WHERE id=?',req.params.id)));});
router.delete('/products/:id',(req,res)=>{run('DELETE FROM products WHERE id=?',req.params.id);res.json({ok:true});});
router.post('/upload',uploadImage,processUpload);

router.get('/orders',(req,res)=>{const query=String(req.query.q||''),status=String(req.query.status||''),where=['1=1'],params=[];if(query){where.push('(order_no LIKE ? OR customer_name LIKE ? OR email LIKE ?)');params.push(...Array(3).fill(`%${query}%`));}if(status){where.push('status=?');params.push(status);}res.json(all(`SELECT * FROM orders WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 200`,...params));});
router.get('/orders/:id',(req,res)=>{const order=get('SELECT * FROM orders WHERE id=?',req.params.id);if(!order)return res.status(404).json({error:'NOT_FOUND'});res.json(orderDto(order));});
router.patch('/orders/:id',validate(z.object({status:z.enum(['CONFIRMED','PROCESSING','SHIPPED','DELIVERED','CANCELLED','REFUNDED']),note:z.string().max(300).default('')})),(req,res)=>{
  const order=get('SELECT * FROM orders WHERE id=?',req.params.id);if(!order)return res.status(404).json({error:'NOT_FOUND'});const {status,note}=req.validated;
  run('UPDATE orders SET status=?,updated_at=? WHERE id=?',status,now(),order.id);if(status==='CANCELLED'||status==='REFUNDED')restoreStock(order.order_no);if(status==='DELIVERED'&&order.payment_method==='cod')run("UPDATE orders SET payment_status='PAID' WHERE id=?",order.id);addOrderEvent(order.id,status,note||`Status updated to ${status}`);res.json(orderDto(get('SELECT * FROM orders WHERE id=?',order.id)));
});
router.post('/orders/:id/refund',validate(z.object({amount:z.coerce.number().min(0).optional(),reason:z.string().max(300).default('Admin refund')})),(req,res)=>{
  const order=get('SELECT * FROM orders WHERE id=?',req.params.id);if(!order)return res.status(404).json({error:'NOT_FOUND'});const amount=Math.min(req.validated.amount??order.total,order.total);
  run('INSERT INTO refunds(id,order_id,amount,reason,created_at) VALUES(?,?,?,?,?)',id(),order.id,amount,req.validated.reason,now());run("UPDATE orders SET status='REFUNDED',payment_status='REFUNDED',updated_at=? WHERE id=?",now(),order.id);restoreStock(order.order_no);addOrderEvent(order.id,'REFUNDED',`Refund ${amount}: ${req.validated.reason}`);res.json(orderDto(get('SELECT * FROM orders WHERE id=?',order.id)));
});
router.get('/customers',(req,res)=>{const query=String(req.query.q||''),params=query?[`%${query}%`,`%${query}%`]:[];res.json(all(`SELECT u.id,u.name,u.email,u.created_at,COUNT(o.id) AS orders,COALESCE(SUM(o.total),0) AS spent FROM users u LEFT JOIN orders o ON o.user_id=u.id WHERE u.role='customer' ${query?'AND (u.name LIKE ? OR u.email LIKE ?)':''} GROUP BY u.id ORDER BY u.created_at DESC`,...params));});
router.get('/customers/:id',(req,res)=>{const customer=get("SELECT id,name,email,created_at FROM users WHERE id=? AND role='customer'",req.params.id);if(!customer)return res.status(404).json({error:'NOT_FOUND'});res.json({...customer,orders:all('SELECT * FROM orders WHERE user_id=? OR email=? ORDER BY created_at DESC',customer.id,customer.email)});});
router.get('/settings',(req,res)=>res.json({settings:Object.fromEntries(all('SELECT key,value FROM settings').map(item=>[item.key,item.value]))}));
router.post('/settings',validate(z.object({items:z.array(z.object({key:z.string().regex(/^[a-z0-9_]+$/),value:z.string().max(4000)}))})),(req,res)=>{const save=db.transaction(()=>req.validated.items.forEach(item=>run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',item.key,item.value)));save();res.json({settings:Object.fromEntries(all('SELECT key,value FROM settings').map(item=>[item.key,item.value]))});});

const resources={categories:{table:'categories',pk:'id',fields:['name','slug','image','position']},coupons:{table:'coupons',pk:'code',fields:['code','type','value','min_subtotal','max_uses','starts_at','ends_at','active']},banners:{table:'banners',pk:'id',fields:['title','subtitle','cta','link','image','position','active']},subscribers:{table:'subscribers',pk:'id',fields:['email','active']}};
function resource(name,res){const definition=resources[name];if(!definition)res.status(404).json({error:'UNKNOWN_RESOURCE'});return definition;}
function resourceValues(name,input){const allowed=resources[name].fields,result={};for(const key of allowed)if(input[key]!==undefined)result[key]=input[key];if(name==='categories'&&!result.slug&&result.name)result.slug=slugify(result.name);if(name==='coupons'&&result.code)result.code=String(result.code).toUpperCase();if(name==='subscribers'&&result.email)result.email=String(result.email).toLowerCase();if('active'in result)result.active=Number(result.active===true||result.active===1||result.active==='1'||result.active==='true');return result;}
router.get('/:resource',(req,res)=>{const definition=resource(req.params.resource,res);if(definition)res.json(all(`SELECT * FROM ${definition.table} ORDER BY rowid DESC`));});
router.post('/:resource',(req,res)=>{const definition=resource(req.params.resource,res);if(!definition)return;const values=resourceValues(req.params.resource,req.body||{});if(definition.pk==='id')values.id=id();const columns=Object.keys(values);if(!columns.length)return res.status(400).json({error:'EMPTY_RESOURCE'});try{run(`INSERT INTO ${definition.table}(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`,...columns.map(key=>values[key]));res.status(201).json(values);}catch(error){res.status(400).json({error:'RESOURCE_SAVE_FAILED',message:error.message});}});
router.patch('/:resource/:id',(req,res)=>{const definition=resource(req.params.resource,res);if(!definition)return;const values=resourceValues(req.params.resource,req.body||{}),columns=Object.keys(values);if(!columns.length)return res.status(400).json({error:'EMPTY_RESOURCE'});run(`UPDATE ${definition.table} SET ${columns.map(key=>`${key}=?`).join(',')} WHERE ${definition.pk}=?`,...columns.map(key=>values[key]),req.params.id);res.json({ok:true});});
router.delete('/:resource/:id',(req,res)=>{const definition=resource(req.params.resource,res);if(!definition)return;run(`DELETE FROM ${definition.table} WHERE ${definition.pk}=?`,req.params.id);res.json({ok:true});});
export default router;