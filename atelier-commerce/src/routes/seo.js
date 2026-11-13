import { Router } from 'express';
import { all } from '../db.js';
import { config } from '../config.js';
import { escapeHtml,now } from '../utils/index.js';

const router=Router();
router.get('/robots.txt',(req,res)=>res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api\nSitemap: ${config.appUrl}/sitemap.xml\n`));
router.get('/sitemap.xml',(req,res)=>{
  const urls=[['/',1],['/shop',0.9],...all('SELECT slug FROM categories').map(item=>[`/shop?category=${encodeURIComponent(item.slug)}`,0.6]),...all("SELECT slug FROM products WHERE status='active'").map(item=>[`/product/${encodeURIComponent(item.slug)}`,0.8])];
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(([url,priority])=>`<url><loc>${escapeHtml(config.appUrl+url)}</loc><lastmod>${now().slice(0,10)}</lastmod><priority>${priority}</priority></url>`).join('')}</urlset>`);
});
export default router;