import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const tempDir=await fs.mkdtemp(path.join(os.tmpdir(),'atelier-smoke-'));
const server=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,PORT:'0',APP_URL:'http://127.0.0.1:0',DATABASE_FILE:path.join(tempDir,'smoke.db'),JWT_SECRET:'smoke-secret-with-enough-entropy-123456',ADMIN_EMAIL:'admin@atelier.test',ADMIN_PASSWORD:'ChangeMe!123',NODE_ENV:'test'},stdio:['ignore','pipe','pipe']});
let output='',startupError='';
server.stdout.setEncoding('utf8');server.stderr.setEncoding('utf8');
server.stdout.on('data',chunk=>{output+=chunk;});server.stderr.on('data',chunk=>{startupError+=chunk;});
const waitForServer=async()=>{
  const start=Date.now();
  while(Date.now()-start<20000){
    const match=output.match(/ATELIER_READY http:\/\/127\.0\.0\.1:(\d+)/);
    if(match)return `http://127.0.0.1:${match[1]}`;
    if(server.exitCode!==null)throw new Error(`Server exited early.\n${startupError}\n${output}`);
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error(`Server startup timed out.\n${startupError}\n${output}`);
};
const makeClient=()=>{
  const jar=new Map();let csrf='';
  const request=async(url,options={})=>{
    const headers={...(options.headers||{})};if(jar.size)headers.Cookie=[...jar].map(([key,value])=>`${key}=${value}`).join('; ');
    if(options.method&&!['GET','HEAD'].includes(options.method))headers['X-CSRF-Token']=csrf;
    const response=await fetch(url,{...options,headers,redirect:options.redirect||'manual'});
    for(const entry of response.headers.getSetCookie?.()||[]){const pair=entry.split(';')[0],index=pair.indexOf('=');if(index>0)jar.set(pair.slice(0,index),pair.slice(index+1));}
    return response;
  };
  return {request,async init(base){const response=await request(`${base}/api/csrf`);assert.equal(response.status,200,'CSRF bootstrap');csrf=(await response.json()).token;}};
};
const expectStatus=async(response,status,label)=>{assert.equal(response.status,status,`${label}: got ${response.status}`);return response;};
let base='';
try{
  base=await waitForServer();
  const guest=makeClient();await guest.init(base);
  const bootstrap=await expectStatus(await guest.request(`${base}/api/bootstrap`),200,'bootstrap');
  const boot=await bootstrap.json();assert.equal(boot.categories.length,4,'seeded categories');
  const productsResponse=await expectStatus(await guest.request(`${base}/api/products`),200,'products');
  const products=await productsResponse.json();assert.ok(products.items.length>=8,'seeded products');
  const product=products.items[0];
  await expectStatus(await guest.request(`${base}/api/products/${encodeURIComponent(product.slug)}`),200,'product detail');
  await expectStatus(await guest.request(`${base}/api/cart/items`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({productId:product.id,variantId:product.variants[0].id,qty:1})}),200,'guest cart add');
  const coupon=await expectStatus(await guest.request(`${base}/api/cart/coupon`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:'WELCOME10'})}),200,'coupon applies');
  assert.ok((await coupon.json()).discount>0,'coupon discount is positive');
  const orderData={customer:{name:'Smoke Customer',email:'smoke@example.test',phone:'5550100'},shipping:{address1:'12 Test Lane',city:'Dhaka',country:'Bangladesh'},shippingMethod:'standard',paymentMethod:'cod',coupon:'WELCOME10'};
  const placed=await expectStatus(await guest.request(`${base}/api/orders`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(orderData)}),201,'COD checkout');
  const order=await placed.json();assert.ok(order.orderNo,'COD order number');
  const orderLookup=await expectStatus(await guest.request(`${base}/api/orders/${encodeURIComponent(order.orderNo)}?email=${encodeURIComponent(order.email)}`),200,'order lookup by email');
  assert.equal((await orderLookup.json()).status,'CONFIRMED','COD order is confirmed');
  await expectStatus(await guest.request(`${base}/api/orders/${encodeURIComponent(order.orderNo)}/invoice?email=${encodeURIComponent(order.email)}`),200,'invoice HTML');
  await expectStatus(await guest.request(`${base}/robots.txt`),200,'robots.txt');
  await expectStatus(await guest.request(`${base}/sitemap.xml`),200,'sitemap.xml');

  const customer=makeClient();await customer.init(base);
  await expectStatus(await customer.request(`${base}/api/auth/register`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Smoke Customer',email:'account@example.test',password:'CustomerPass123!'})}),201,'customer register');
  await expectStatus(await customer.request(`${base}/api/admin/overview`),403,'customer blocked from admin');
  const admin=makeClient();await admin.init(base);
  await expectStatus(await admin.request(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@atelier.test',password:'ChangeMe!123'})}),200,'admin login');
  for(const endpoint of ['/api/admin/overview','/api/admin/products','/api/admin/orders','/api/admin/customers','/api/admin/settings'])await expectStatus(await admin.request(`${base}${endpoint}`),200,endpoint);
  console.log('PASS bootstrap 200');
  console.log('PASS products 200; product detail 200');
  console.log('PASS guest cart add 200; coupon applies');
  console.log(`PASS COD checkout creates confirmed order ${order.orderNo}; email lookup 200`);
  console.log('PASS customer token receives 403 on /api/admin/overview');
  console.log('PASS admin login and overview/products/orders/customers/settings 200');
  console.log('PASS robots.txt 200; sitemap.xml 200; invoice HTML 200');
  console.log('SMOKE PASS');
}catch(error){
  console.error('SMOKE FAIL');console.error(error.stack||error);if(startupError)console.error(startupError);process.exitCode=1;
}finally{
  server.kill('SIGTERM');
  await new Promise(resolve=>{if(server.exitCode!==null)return resolve();server.once('exit',resolve);setTimeout(resolve,2500).unref();});
  await fs.rm(tempDir,{recursive:true,force:true});
}