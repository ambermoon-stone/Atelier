import { Router } from 'express';
import { verifyPayment,confirmPayment,failPayment } from '../services/payments.js';

const router=Router();
router.post('/:provider/callback',async(req,res,next)=>{
  const {provider}=req.params;if(!['sslcommerz','bkash','nagad'].includes(provider))return res.status(400).json({error:'BAD_PROVIDER'});
  try{const result=await verifyPayment({...req.body,signature:req.get('x-payment-signature')||req.body?.signature},req.body||{},req.rawBody||Buffer.alloc(0));if(!result.ok){const orderNo=req.body?.order_no||req.body?.tran_id||req.body?.merchantInvoiceNumber;if(orderNo)failPayment(orderNo);return res.status(400).json({error:'PAYMENT_NOT_VERIFIED'});}confirmPayment(result.orderNo,result.reference);res.redirect(`/order/${encodeURIComponent(result.orderNo)}?verified=1`);}catch(error){next(error);}
});
router.post('/:provider/fail',(req,res)=>{const orderNo=req.body?.tran_id||req.body?.merchantInvoiceNumber||req.body?.order_no;if(orderNo)failPayment(orderNo,'Gateway reported failed or cancelled payment');res.redirect('/checkout?payment=failed');});
export default router;