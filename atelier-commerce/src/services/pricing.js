import { all,get,run } from '../db.js';
import { config } from '../config.js';
import { roundMoney } from '../utils/index.js';

export function getSettings(){return Object.fromEntries(all('SELECT key,value FROM settings').map(item=>[item.key,item.value]));}
export function couponDiscount(code,subtotal) {
  if(!code)return {coupon:null,discount:0};
  const coupon=get('SELECT * FROM coupons WHERE code=?',String(code).toUpperCase());
  if(!coupon||!coupon.active)throw Object.assign(new Error('Coupon not found.'),{status:400});
  const current=new Date().toISOString();
  if(coupon.starts_at&&current<coupon.starts_at)throw Object.assign(new Error('Coupon is not active yet.'),{status:400});
  if(coupon.ends_at&&current>coupon.ends_at)throw Object.assign(new Error('Coupon has expired.'),{status:400});
  if(coupon.used>=coupon.max_uses)throw Object.assign(new Error('Coupon usage limit reached.'),{status:400});
  if(subtotal<coupon.min_subtotal)throw Object.assign(new Error(`Minimum subtotal is ${coupon.min_subtotal}.`),{status:400});
  return {coupon,discount:roundMoney(Math.min(subtotal,coupon.type==='percent'?subtotal*coupon.value/100:coupon.value))};
}
export function cartFor(req,res) {
  let guestId=req.cookies.gid;
  if(!req.user&&!guestId){guestId=cryptoRandom();res.cookie('gid',guestId,{httpOnly:true,sameSite:'lax',secure:config.production,maxAge:31536000000});}
  let cart=req.user?get('SELECT * FROM carts WHERE user_id=?',req.user.id):get('SELECT * FROM carts WHERE guest_id=?',guestId);
  if(!cart){const id=cryptoRandom();run('INSERT INTO carts(id,user_id,guest_id,updated_at) VALUES(?,?,?,?)',id,req.user?.id||null,req.user?null:guestId,new Date().toISOString());cart=get('SELECT * FROM carts WHERE id=?',id);}
  return cart;
}
function cryptoRandom(){return globalThis.crypto.randomUUID();}
export function cartTotals(cart) {
  const rows=all(`SELECT ci.id,ci.product_id,ci.variant_id,ci.qty,p.slug,p.name,p.price,p.compare_at,v.color,v.size,v.sku,v.stock,v.price_delta,
    (SELECT url FROM product_images WHERE product_id=p.id ORDER BY position LIMIT 1) AS image
    FROM cart_items ci JOIN products p ON p.id=ci.product_id JOIN variants v ON v.id=ci.variant_id WHERE ci.cart_id=? ORDER BY ci.created_at`,cart.id);
  const items=rows.map(item=>({...item,unit_price:roundMoney(item.price+item.price_delta),line_total:roundMoney((item.price+item.price_delta)*item.qty),variant_label:[item.color,item.size].filter(Boolean).join(' / ')}));
  const subtotal=roundMoney(items.reduce((sum,item)=>sum+item.line_total,0));
  const {coupon,discount}=couponDiscount(cart.coupon_code,subtotal);
  const taxable=Math.max(0,subtotal-discount),settings=getSettings();
  const freeOver=Number(settings.free_shipping_over??config.freeShippingOver);
  const shipping=taxable===0||taxable>=freeOver?0:Number(cart.shipping_method==='express'?settings.shipping_express??config.shippingExpress:settings.shipping_standard??config.shippingStandard);
  const tax=roundMoney(taxable*Number(settings.tax_rate??config.taxRate));
  return {id:cart.id,items,count:items.reduce((sum,item)=>sum+item.qty,0),subtotal,discount,tax,shipping:roundMoney(shipping),total:roundMoney(taxable+tax+shipping),coupon:coupon?.code||'',shipping_method:cart.shipping_method,currency:settings.currency||config.currency};
}