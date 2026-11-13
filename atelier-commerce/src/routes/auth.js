import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z,validate } from '../middleware/validate.js';
import { get,run,all } from '../db.js';
import { id,now } from '../utils/index.js';
import { publicUser,setAuthCookie } from '../middleware/auth.js';

const router=Router();
const registerSchema=z.object({name:z.string().min(2).max(80),email:z.string().email(),password:z.string().min(8).max(100)});
const loginSchema=z.object({email:z.string().email(),password:z.string().min(1).max(100)});
function mergeGuestCart(req,userId) {
  const guestId=req.cookies.gid;if(!guestId)return;
  const guest=get('SELECT * FROM carts WHERE guest_id=?',guestId);if(!guest)return;
  let userCart=get('SELECT * FROM carts WHERE user_id=?',userId);
  if(!userCart){run('UPDATE carts SET user_id=?,guest_id=NULL WHERE id=?',userId,guest.id);return;}
  const items=all('SELECT * FROM cart_items WHERE cart_id=?',guest.id);
  for(const item of items) {
    const existing=get('SELECT id,qty FROM cart_items WHERE cart_id=? AND product_id=? AND variant_id=?',userCart.id,item.product_id,item.variant_id);
    if(existing)run('UPDATE cart_items SET qty=MIN(20,qty+?) WHERE id=?',item.qty,existing.id);
    else run('UPDATE cart_items SET cart_id=? WHERE id=?',userCart.id,item.id);
  }
  run('DELETE FROM carts WHERE id=?',guest.id);
}
router.post('/register',validate(registerSchema),(req,res,next)=>{
  try {
    const {name,email,password}=req.validated,normalized=email.toLowerCase();
    if(get('SELECT id FROM users WHERE email=?',normalized))return res.status(409).json({error:'EMAIL_EXISTS'});
    const userId=id();run('INSERT INTO users(id,email,password_hash,name,role,created_at) VALUES(?,?,?,?,?,?)',userId,normalized,bcrypt.hashSync(password,10),name,'customer',now());
    mergeGuestCart(req,userId);const user=get('SELECT * FROM users WHERE id=?',userId);setAuthCookie(res,user);res.status(201).json({user:publicUser(user)});
  } catch(error){next(error);}
});
router.post('/login',validate(loginSchema),(req,res)=>{
  const {email,password}=req.validated,user=get('SELECT * FROM users WHERE email=?',email.toLowerCase());
  if(!user||!bcrypt.compareSync(password,user.password_hash))return res.status(401).json({error:'INVALID_CREDENTIALS'});
  mergeGuestCart(req,user.id);setAuthCookie(res,user);res.json({user:publicUser(user)});
});
router.post('/logout',(req,res)=>{res.clearCookie('token');res.json({ok:true});});
router.get('/me',(req,res)=>res.json({user:publicUser(req.user)}));
export default router;