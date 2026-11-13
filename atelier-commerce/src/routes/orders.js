import { Router } from 'express';
import { db,get,all,run } from '../db.js';
import { z,validate } from '../middleware/validate.js';
import { id,now,roundMoney,escapeHtml } from '../utils/index.js';
import { cartFor,cartTotals,couponDiscount,getSettings } from '../services/pricing.js';
import { addOrderEvent,orderDto } from '../services/inventory.js';
import { availablePayments,createGatewaySession,failPayment } from '../services/payments.js';
import { config } from '../config.js';
import { requireUser } from '../middleware/auth.js';

const router=Router();
const checkoutSchema=z.object({customer:z.object({name:z.string().min(2).max(80),email:z.string().email(),phone:z.string().max(30).default('')}),shipping:z.object({address1:z.string().min(3).max(140),address2:z.string().max(140).default(''),city:z.string().min(2).max(80),region:z.string().max(80).default(''),postal:z.string().max(20).default(''),country:z.string().min(2).max(60).default('Bangladesh')}),shippingMethod:z.enum(['standard','express']).default('standard'),paymentMethod:z.enum(['cod','sslcommerz','bkash','nagad']),coupon:z.string().max(40).default('')});
router.post('/checkout/quote',validate(z.object({coupon:z.string().max(40).default(''),shippingMethod:z.enum(['standard','express']).default('standard')})),(req,res)=>{
  const cart=cartFor(req,res),data=req.validated;
  if(data.coupon){try{couponDiscount(data.coupon,cartTotals({...cart,coupon_code:null}).subtotal);}catch(error){return res.status(400).json({error:error.message});}}
  const totals=cartTotals({...cart,coupon_code:data.coupon||cart.coupon_code,shipping_method:data.shippingMethod});
  res.json({...totals,options:{standard:config.shippingStandard,express:config.shippingExpress,freeOver:config.freeShippingOver,taxRate:config.taxRate}});
});
router.post('/orders',validate(checkoutSchema),async(req,res,next)=>{
  try {
    const data=req.validated,provider=data.paymentMethod;
    if(!availablePayments()[provider])return res.status(503).json({error:'PAYMENT_PROVIDER_NOT_CONFIGURED',provider,message:'Configure sandbox credentials before using this payment method.'});
    const cart=cartFor(req,res);
    if(data.coupon){try{couponDiscount(data.coupon,cartTotals({...cart,coupon_code:null}).subtotal);}catch(error){return res.status(400).json({error:error.message});}}
    const totals=cartTotals({...cart,coupon_code:data.coupon||cart.coupon_code,shipping_method:data.shippingMethod});
    if(!totals.items.length)return res.status(400).json({error:'EMPTY_CART'});
    const orderNo=`AT-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`,orderId=id(),cod=provider==='cod';
    const tx=db.transaction(()=>{
      for(const item of totals.items){const inventory=get('SELECT stock FROM variants WHERE id=?',item.variant_id);if(!inventory||inventory.stock<item.qty)throw Object.assign(new Error(`Insufficient stock for ${item.name}.`),{status:409});}
      run(`INSERT INTO orders(id,order_no,user_id,guest_email,status,payment_method,payment_status,subtotal,discount,shipping,tax,total,currency,coupon_code,customer_name,email,phone,address_line1,address_line2,city,region,postal_code,country,tracking_no,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        orderId,orderNo,req.user?.id||null,data.customer.email.toLowerCase(),cod?'CONFIRMED':'AWAITING_PAYMENT',provider,cod?'PAY_ON_DELIVERY':'PENDING',totals.subtotal,totals.discount,totals.shipping,totals.tax,totals.total,totals.currency,data.coupon||cart.coupon_code||null,data.customer.name,data.customer.email.toLowerCase(),data.customer.phone,data.shipping.address1,data.shipping.address2,data.shipping.city,data.shipping.region,data.shipping.postal,data.shipping.country,cod?`AT-${orderNo.slice(-7)}`:null,now(),now());
      for(const item of totals.items){run('INSERT INTO order_items(id,order_id,product_id,variant_id,name,variant_label,sku,qty,unit_price,total) VALUES(?,?,?,?,?,?,?,?,?,?)',id(),orderId,item.product_id,item.variant_id,item.name,item.variant_label,item.sku,item.qty,item.unit_price,item.line_total);const changed=run('UPDATE variants SET stock=stock-? WHERE id=? AND stock>=?',item.qty,item.variant_id,item.qty);if(!changed.changes)throw Object.assign(new Error(`Insufficient stock for ${item.name}.`),{status:409});}
      if(data.coupon||cart.coupon_code)run('UPDATE coupons SET used=used+1 WHERE code=?',data.coupon||cart.coupon_code);
      addOrderEvent(orderId,cod?'CONFIRMED':'AWAITING_PAYMENT',cod?'Confirmed · Cash on Delivery':'Awaiting verified payment');run('DELETE FROM cart_items WHERE cart_id=?',cart.id);run('UPDATE carts SET coupon_code=NULL,updated_at=? WHERE id=?',now(),cart.id);
    });
    tx();
    if(cod)return res.status(201).json({orderNo,email:data.customer.email,redirect:`/order/${encodeURIComponent(orderNo)}`,payment:'cod'});
    try {const order=get('SELECT * FROM orders WHERE id=?',orderId),redirect=await createGatewaySession(provider,order);return res.status(201).json({orderNo,email:data.customer.email,redirect,payment:provider});}
    catch(error){failPayment(orderNo,error.message);return res.status(502).json({error:'PAYMENT_INIT_FAILED',message:error.message,orderNo});}
  } catch(error){next(error);}
});
router.get('/orders/mine',requireUser,(req,res)=>res.json(all('SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC',req.user.id).map(order=>({...order,items:[]}))));
function authorized(req,order){return req.user?.role==='admin'||req.user?.id===order.user_id||String(req.query.email||'').toLowerCase()===order.email.toLowerCase();}
router.get('/orders/:no/invoice',(req,res)=>{
  const order=get('SELECT * FROM orders WHERE order_no=?',req.params.no);if(!order)return res.status(404).type('html').send('<h1>Order not found</h1>');if(!authorized(req,order))return res.status(403).type('html').send('<h1>Access denied</h1>');
  const settings=getSettings(),items=all('SELECT * FROM order_items WHERE order_id=?',order.id).map(item=>`<tr><td>${escapeHtml(item.name)}<br><small>${escapeHtml(item.variant_label)}</small></td><td>${item.qty}</td><td>${item.unit_price}</td><td>${item.total}</td></tr>`).join('');
  res.type('html').send(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Invoice ${escapeHtml(order.order_no)}</title><style>body{font:15px system-ui;max-width:900px;margin:48px auto;padding:0 20px;color:#24221e}table{width:100%;border-collapse:collapse;margin:24px 0}td,th{padding:12px;border-bottom:1px solid #ddd;text-align:left}td:last-child,th:last-child{text-align:right}button{padding:10px 18px;background:#24221e;color:white;border:0;border-radius:20px}@media print{button{display:none}}</style><body><button onclick="print()">Print invoice</button><h1>${escapeHtml(settings.store_name||'ATELIER')}</h1><p>${escapeHtml(settings.address||'')} · ${escapeHtml(settings.contact_email||'')}</p><h2>Invoice ${escapeHtml(order.order_no)}</h2><p>${escapeHtml(order.customer_name)} · ${escapeHtml(order.email)}<br>${escapeHtml(order.address_line1)}, ${escapeHtml(order.city)}, ${escapeHtml(order.country)}</p><table><thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Total</th></tr></thead><tbody>${items}</tbody></table><table><tr><td>Subtotal</td><td>${order.subtotal}</td></tr><tr><td>Discount</td><td>-${order.discount}</td></tr><tr><td>Shipping</td><td>${order.shipping}</td></tr><tr><td>Tax</td><td>${order.tax}</td></tr><tr><th>Total</th><th>${order.total} ${escapeHtml(order.currency)}</th></tr></table><p>Payment: ${escapeHtml(order.payment_method)} · ${escapeHtml(order.payment_status)}</p></body></html>`);
});
router.get('/orders/:no',(req,res)=>{const order=get('SELECT * FROM orders WHERE order_no=?',req.params.no);if(!order)return res.status(404).json({error:'NOT_FOUND'});if(!authorized(req,order))return res.status(403).json({error:'EMAIL_REQUIRED'});res.json(orderDto(order));});
export default router;