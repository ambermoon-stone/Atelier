import crypto from 'node:crypto';
import { config } from '../config.js';

const safeEqual=(a,b)=>{if(!a||!b||a.length!==b.length)return false;return crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));};
export function csrfToken(req,res) {
  const token=crypto.randomBytes(24).toString('hex');
  res.cookie('csrf',token,{httpOnly:false,sameSite:'lax',secure:config.production,maxAge:86400000});
  res.json({token});
}
export function csrfProtection(req,res,next) {
  if (['GET','HEAD','OPTIONS'].includes(req.method) || req.path.startsWith('/payments/')) return next();
  if (!safeEqual(req.get('x-csrf-token'),req.cookies.csrf)) return res.status(403).json({error:'CSRF_INVALID'});
  next();
}