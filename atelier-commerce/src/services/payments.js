import crypto from 'node:crypto';
import { config } from '../config.js';
import { get,run } from '../db.js';
import { addOrderEvent,restoreStock } from './inventory.js';
import { roundMoney } from '../utils/index.js';

export function availablePayments(){const callbackSecret=Boolean(process.env.PAYMENT_WEBHOOK_SECRET),setting=key=>get('SELECT value FROM settings WHERE key=?',key)?.value!=='0';return {cod:setting('payment_cod_enabled'),sslcommerz:setting('payment_sslcommerz_enabled')&&Boolean(process.env.SSLCOMMERZ_STORE_ID&&process.env.SSLCOMMERZ_STORE_PASSWD),bkash:setting('payment_bkash_enabled')&&Boolean(callbackSecret&&process.env.BKASH_APP_KEY&&process.env.BKASH_APP_SECRET&&process.env.BKASH_USERNAME&&process.env.BKASH_PASSWORD),nagad:setting('payment_nagad_enabled')&&Boolean(callbackSecret&&process.env.NAGAD_MERCHANT_ID&&process.env.NAGAD_PUBLIC_KEY&&process.env.NAGAD_PRIVATE_KEY)};}
const timingSafe=(left,right)=>left&&right&&left.length===right.length&&crypto.timingSafeEqual(Buffer.from(left),Buffer.from(right));
export async function verifyPayment(provider,body,rawBody) {
  const orderNo=body.order_no||body.tran_id||body.merchantInvoiceNumber||body.orderNo;
  const order=get('SELECT * FROM orders WHERE order_no=?',orderNo);
  if(!order)return {ok:false};
  if(provider==='sslcommerz') {
    if(!body.val_id||!availablePayments().sslcommerz)return {ok:false};
    const url=new URL('/validator/api/validationserver/API.php',process.env.SSLCOMMERZ_API_URL||'https://sandbox.sslcommerz.com');
    url.search=new URLSearchParams({val_id:body.val_id,Store_Id:process.env.SSLCOMMERZ_STORE_ID,Store_Passwd:process.env.SSLCOMMERZ_STORE_PASSWD,v:'1',format:'json'});
    const response=await fetch(url),data=await response.json();
    return {ok:['VALID','VALIDATED'].includes(String(data.status).toUpperCase())&&roundMoney(data.amount)===roundMoney(order.total)&&data.currency===order.currency,orderNo,reference:body.val_id};
  }
  const signature=String(body.signature||'').replace(/^sha256=/,'');
  const secret=process.env.PAYMENT_WEBHOOK_SECRET||'';
  const expected=crypto.createHmac('sha256',secret).update(rawBody).digest('hex');
  const validStatus=['COMPLETED','SUCCESS','VALID','EXECUTED'].includes(String(body.status||'').toUpperCase());
  const validAmount=body.amount!==undefined&&roundMoney(body.amount)===roundMoney(order.total);
  return {ok:Boolean(order.payment_method===provider&&secret&&timingSafe(signature,expected)&&validStatus&&validAmount&&body.currency===order.currency),orderNo,reference:body.paymentID||body.reference||''};
}
export function failPayment(orderNo,reason='Payment verification failed') {
  const order=get('SELECT * FROM orders WHERE order_no=?',orderNo);if(!order)return;
  run('UPDATE orders SET status=?,payment_status=?,updated_at=? WHERE id=?','PAYMENT_FAILED','FAILED',new Date().toISOString(),order.id);
  addOrderEvent(order.id,'PAYMENT_FAILED',reason);restoreStock(orderNo);
}
export function confirmPayment(orderNo,reference) {
  const order=get('SELECT * FROM orders WHERE order_no=?',orderNo);if(!order)return false;
  if(order.payment_status==='PAID')return true;
  run('UPDATE orders SET status=?,payment_status=?,payment_ref=?,tracking_no=?,updated_at=? WHERE id=?','CONFIRMED','PAID',reference||null,`AT-${orderNo.slice(-7)}`,new Date().toISOString(),order.id);
  addOrderEvent(order.id,'CONFIRMED','Payment verified by the server');return true;
}
export async function createGatewaySession(provider,order) {
  if(provider==='sslcommerz') {
    const form=new URLSearchParams({store_id:process.env.SSLCOMMERZ_STORE_ID,store_passwd:process.env.SSLCOMMERZ_STORE_PASSWD,total_amount:String(order.total),currency:order.currency,tran_id:order.order_no,success_url:`${config.appUrl}/api/payments/sslcommerz/callback`,fail_url:`${config.appUrl}/api/payments/sslcommerz/fail`,cancel_url:`${config.appUrl}/api/payments/sslcommerz/fail`,cus_name:order.customer_name,cus_email:order.email,cus_phone:order.phone,cus_add1:order.address_line1,cus_city:order.city,cus_country:order.country,shipping_method:'NO',product_name:'ATELIER order',product_category:'Commerce',product_profile:'physical-goods'});
    const response=await fetch(`${process.env.SSLCOMMERZ_API_URL||'https://sandbox.sslcommerz.com'}/gwprocess/v4/api.php`,{method:'POST',body:form});const data=await response.json();
    if(data.status!=='SUCCESS'||!data.GatewayPageURL)throw new Error(data.failedreason||'Gateway initialization failed.');return data.GatewayPageURL;
  }
  if(provider==='bkash') {
    const base=process.env.BKASH_BASE_URL||'https://tokenized.sandbox.bka.sh/v1.2.0-beta';
    const tokenResponse=await fetch(`${base}/token/grant`,{method:'POST',headers:{'Content-Type':'application/json',username:process.env.BKASH_USERNAME,password:process.env.BKASH_PASSWORD},body:JSON.stringify({app_key:process.env.BKASH_APP_KEY,app_secret:process.env.BKASH_APP_SECRET})});
    const token=await tokenResponse.json();if(!tokenResponse.ok||!token.id_token)throw new Error(token.statusMessage||'bKash sandbox token request failed.');
    const paymentResponse=await fetch(`${base}/tokenized/checkout/payment/create`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:token.id_token,'X-APP-Key':process.env.BKASH_APP_KEY},body:JSON.stringify({mode:'0011',payerReference:'atelier',callbackURL:`${config.appUrl}/api/payments/bkash/callback`,amount:String(order.total),currency:order.currency,intent:'sale',merchantInvoiceNumber:order.order_no})});
    const payment=await paymentResponse.json();if(!paymentResponse.ok||!payment.bkashURL||!payment.paymentID)throw new Error(payment.statusMessage||'bKash sandbox checkout could not be initialized.');
    run('UPDATE orders SET payment_ref=? WHERE id=?',payment.paymentID,order.id);return payment.bkashURL;
  }
  if(provider==='nagad') {
    const base=process.env.NAGAD_BASE_URL||'http://sandbox.mynagad.com:10080/remote-payment-gateway-1.0/api/dfs';
    const response=await fetch(`${base}/check-out/initialize/${encodeURIComponent(process.env.NAGAD_MERCHANT_ID)}/${encodeURIComponent(order.order_no)}`,{method:'POST',headers:{'Content-Type':'application/json','X-KM-Api-Version':'v-0.2.0'},body:JSON.stringify({accountNumber:process.env.NAGAD_MERCHANT_ID,amount:String(order.total),currencyCode:order.currency,merchantCallbackURL:`${config.appUrl}/api/payments/nagad/callback`,orderId:order.order_no})});
    const result=await response.json();const redirect=result.callBackUrl||result.callbackURL;if(!response.ok||!redirect)throw new Error(result.message||'Nagad sandbox checkout could not be initialized.');return redirect;
  }
  throw new Error(`${provider} checkout initialization requires provider-specific merchant signing configuration. No payment was simulated.`);
}