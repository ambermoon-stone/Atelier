import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export function attachUser(req,res,next) {
  try { req.user = jwt.verify(req.cookies.token,config.jwtSecret); } catch { req.user = null; }
  next();
}
export function requireUser(req,res,next) { return req.user ? next() : res.status(401).json({error:'LOGIN_REQUIRED'}); }
export function requireAdmin(req,res,next) { return req.user?.role === 'admin' ? next() : res.status(403).json({error:'ADMIN_ONLY'}); }
export function setAuthCookie(res,user) {
  const token=jwt.sign({id:user.id,email:user.email,role:user.role,name:user.name},config.jwtSecret,{expiresIn:'7d'});
  res.cookie('token',token,{httpOnly:true,sameSite:'lax',secure:config.production,maxAge:7*86400000});
}
export const publicUser=user=>user?{id:user.id,email:user.email,name:user.name,role:user.role}:null;