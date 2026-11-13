import bcrypt from 'bcryptjs';
import { id, now } from './utils/index.js';

const imageIds = ['photo-1490481651871-ab68de25d43d', 'photo-1529139574466-a303027c1d8b', 'photo-1483985988355-763728e1935b', 'photo-1515886657613-9f3515b0c78f', 'photo-1547949003-9792a18a2601', 'photo-1503602642458-232111445657', 'photo-1495474472287-4d71bcdd2085', 'photo-1542291026-7eec264c27ff', 'photo-1523275335684-37898b6baf30', 'photo-1596755094514-f87e34085b2c', 'photo-1434389677669-e08b4cac3105', 'photo-1553062407-98eeb64c6a62'];
const photo = (image, index) => `https://images.unsplash.com/${image}?auto=format&fit=crop&w=1100&q=85&crop=entropy&ixlib=rb-4.1.0&sat=${index % 2 ? '-5' : '0'}`;

const products = [
  ['cashmere-coat','Sculpted Cashmere Coat','women',24800,29500,'A double-faced cashmere coat with a soft shoulder and an easy, sculptural line.','Woven in a small Italian mill and finished by hand.',[1,1,0,1],['Sand','Ink'],['S','M','L'],8],
  ['ribbed-merino-knit','Ribbed Merino Knit','women',9200,null,'Extra-fine merino in a breathable rib, with a collar that holds its shape.','Spun for warmth without weight.',[0,1,1,0],['Oat','Clay'],['S','M','L'],10],
  ['leather-tote','Seamless Leather Tote','objects',16400,18900,'A single panel of vegetable-tanned leather, folded into a tote that softens with time.','No lining, no hardware, no compromise.',[1,0,1,0],['Cognac','Black'],['One size'],9],
  ['field-sneaker','Field Sneaker','men',11800,null,'A low-profile sneaker with a natural rubber sole and waxed canvas upper.','Made for city pavements and long detours.',[0,1,0,1],['Chalk','Forest'],['40','41','42','43'],10],
  ['arc-lounge-chair','Arc Lounge Chair','objects',38900,null,'A steam-bent oak frame with a suspended linen seat.','Assembled in small batches by a family workshop.',[1,0,0,1],['Oak / Flax','Walnut / Ink'],['One size'],5],
  ['morning-ceramic-set','Morning Ceramic Set','atelier',6400,7200,'Four hand-thrown vessels with a satin ash glaze. Each one is slightly different.','Fired twice and finished slowly.',[0,1,1,0],['Ash'],['Set of 4'],18],
  ['washed-linen-shirt','Washed Linen Shirt','men',7800,null,'Garment-washed European linen with a relaxed collar and an easy hem.','Designed to crease beautifully.',[0,0,1,1],['Chalk','Olive'],['M','L','XL'],12],
  ['brushed-brass-timepiece','Brushed Brass Timepiece','atelier',21500,null,'A restrained dial, brushed case, and sapphire crystal that disappears in the light.','Quiet precision, worn daily.',[1,1,0,0],['Brass / Cream','Steel / Ink'],['One size'],6]
];

export function seed(db, config) {
  if (db.prepare('SELECT COUNT(*) AS count FROM settings').get().count) return;
  const insert = db.transaction(() => {
    const categories = [['women','Women'],['men','Men'],['objects','Objects'],['atelier','Atelier']];
    categories.forEach(([slug,name], position) => db.prepare('INSERT INTO categories(id,name,slug,image,position) VALUES(?,?,?,?,?)').run(slug,name,slug,photo(imageIds[position],position),position));
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@atelier.test';
    const adminPassword = process.env.ADMIN_PASSWORD || 'ChangeMe!123';
    db.prepare('INSERT OR IGNORE INTO users(id,email,password_hash,name,role,created_at) VALUES(?,?,?,?,?,?)').run(id(),adminEmail.toLowerCase(),bcrypt.hashSync(adminPassword,10),'Store Admin','admin',now());
    const addProduct = db.prepare(`INSERT INTO products(id,slug,name,category_id,description,story,price,compare_at,currency,status,featured,trending,best_seller,is_new,rating,review_count,created_at) VALUES(?,?,?,?,?,?,?,?,?,'active',?,?,?,?,?,?,?)`);
    const addImage = db.prepare('INSERT INTO product_images(id,product_id,url,alt,position) VALUES(?,?,?,?,?)');
    const addVariant = db.prepare('INSERT INTO variants(id,product_id,sku,color,size,stock,price_delta) VALUES(?,?,?,?,?,?,0)');
    const addReview = db.prepare('INSERT INTO reviews(id,product_id,name,rating,title,body,verified,created_at) VALUES(?,?,?,?,?,?,1,?)');
    const names = [['Maya R.','Worth keeping','Beautifully finished and even better in person.'],['Jonas K.','Quietly excellent','Arrived carefully packed and has been used every day.'],['Amira S.','A considered piece','Exactly as described. The texture is lovely.']];
    products.forEach((p,index) => {
      const productId = id(), created = new Date(Date.now() - index * 86400000).toISOString();
      addProduct.run(productId,p[0],p[1],p[2],p[5],p[6],p[3],p[4],config.currency,...p[7],4.8,3,created);
      for (let imageIndex=0; imageIndex<3; imageIndex++) addImage.run(id(),productId,photo(imageIds[(index*3+imageIndex)%imageIds.length],imageIndex),`${p[1]} view ${imageIndex+1}`,imageIndex);
      let variantIndex=0;
      for (const color of p[8]) for (const size of p[9]) addVariant.run(id(),productId,`AT-${p[0].slice(0,5).toUpperCase()}-${++variantIndex}`,color,size,Math.max(1,p[10]-variantIndex%4));
      names.forEach((review,reviewIndex)=>addReview.run(id(),productId,review[0],reviewIndex===2?4:5,review[1],review[2],new Date(Date.now()-reviewIndex*86400000).toISOString()));
    });
    const settingValues = {
      store_name:'ATELIER',logo_text:'ATELIER',tagline:'Considered objects for modern living',announcement:'Complimentary shipping over ৳8,000 · The new edit is here',
      hero_kicker:'The considered edit',hero_title:'Objects made to be kept.',hero_sub:'Clothing and objects chosen for how they age, not just how they arrive.',hero_image:'/assets/hero-fallback.svg',
      contact_email:'hello@atelier.store',phone:'+880 1700 000 000',address:'12 Guild Street, Dhaka 1209',currency:config.currency,tax_rate:String(config.taxRate),
      free_shipping_over:String(config.freeShippingOver),shipping_standard:String(config.shippingStandard),shipping_express:String(config.shippingExpress),
      payment_cod_enabled:'1',payment_sslcommerz_enabled:'1',payment_bkash_enabled:'1',payment_nagad_enabled:'1',
      instagram:'https://instagram.com/',pinterest:'https://pinterest.com/',footer_note:'Made slowly. Shipped carefully. Kept for years.'
    };
    const addSetting = db.prepare('INSERT INTO settings(key,value) VALUES(?,?)');
    Object.entries(settingValues).forEach(entry=>addSetting.run(...entry));
    db.prepare('INSERT INTO coupons(code,type,value,min_subtotal,max_uses,starts_at,ends_at,active) VALUES(?,?,?,?,?,?,?,1)').run('WELCOME10','percent',10,0,9999,'2020-01-01','2035-01-01');
    db.prepare('INSERT INTO coupons(code,type,value,min_subtotal,max_uses,starts_at,ends_at,active) VALUES(?,?,?,?,?,?,?,1)').run('ATELIER1500','fixed',1500,15000,500,'2020-01-01','2035-01-01');
    db.prepare('INSERT INTO banners(id,title,subtitle,cta,link,image,position,active) VALUES(?,?,?,?,?,?,?,1)').run(id(),'The material study','Pieces chosen for texture, weight, and the way they wear in.','Explore the edit','/shop','/assets/hero-fallback.svg','home');
    db.prepare('INSERT INTO subscribers(id,email,active,created_at) VALUES(?,?,1,?)').run(id(),'editor@atelier.test',now());
  });
  insert();
}