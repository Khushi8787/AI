'use strict';

// GLAMORA backend - zero external runtime dependencies.
// Uses Node 22's built-in SQLite support, the built-in crypto module for password hashing/JWT,
// and the built-in HTTP server to serve both the API and the existing frontend.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.GLAMORA_JWT_SECRET || 'change-this-glamora-secret-in-production';
const DB_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DB_DIR, 'glamora.db');
fs.mkdirSync(DB_DIR, { recursive: true });

const db = new DatabaseSync(DB_FILE);
db.exec(`
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer' CHECK(role IN ('customer','admin')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  brand TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  image TEXT,
  price INTEGER NOT NULL DEFAULT 0,
  rental_price INTEGER NOT NULL DEFAULT 0,
  deposit INTEGER NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0,
  condition TEXT NOT NULL DEFAULT 'New',
  listing_type TEXT NOT NULL DEFAULT 'buy',
  verified INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  rating REAL NOT NULL DEFAULT 4.5,
  reviews INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  brand TEXT NOT NULL,
  product_type TEXT NOT NULL,
  condition TEXT NOT NULL,
  expiry_date TEXT,
  price INTEGER NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  description TEXT,
  contact TEXT,
  image1 TEXT,
  image2 TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  order_number TEXT NOT NULL UNIQUE,
  total INTEGER NOT NULL,
  payment_method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Placed',
  shipping_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price INTEGER NOT NULL,
  mode TEXT NOT NULL DEFAULT 'buy',
  rental_start TEXT,
  rental_end TEXT,
  FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY(product_id) REFERENCES products(id)
);
`);

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  const [salt, expected] = String(stored).split(':');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}
function base64url(value) {
  return Buffer.from(value).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function signToken(payload) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}
function verifyToken(token) {
  try {
    const [header, body, signature] = String(token).split('.');
    if (!header || !body || !signature) return null;
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    return payload;
  } catch { return null; }
}
function issueToken(user) {
  return signToken({ sub: user.id, role: user.role, name: user.name, email: user.email, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 });
}

function seed() {
  const admin = db.prepare('SELECT id FROM users WHERE email=?').get('admin@glamora.in');
  if (!admin) db.prepare('INSERT INTO users(name,email,phone,password_hash,role) VALUES(?,?,?,?,?)').run('GLAMORA Admin','admin@glamora.in','',hashPassword('Admin@123'),'admin');
  const count = db.prepare('SELECT COUNT(*) AS count FROM products').get().count;
  if (count > 0) return;
  const products = [
    ['Rose Gold Lipstick Set','Luxe Beauty','Makeup','A luxurious set of three rose-gold inspired lipsticks with a creamy long-lasting formula.','https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=700&h=700&fit=crop',1299,0,0,45,'New','buy',1,4.5,128],
    ['Pearl Drop Earrings','Aura Jewels','Jewellery','Elegant pearl earrings suitable for parties and formal occasions.','https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=700&h=700&fit=crop',0,199,500,8,'Excellent','rent',1,5,86],
    ['Vitamin C Serum','Glow Lab','Skincare','Brightening vitamin C serum, lightly used and safely packaged.','https://images.unsplash.com/photo-1571781926291-c477ebfd024b?w=700&h=700&fit=crop',849,0,0,12,'Good','buy',1,4,54],
    ['Bridal Kundan Necklace Set','Royal Heritage','Jewellery Sets','Traditional kundan necklace set for bridal and festive events.','https://images.unsplash.com/photo-1611591437281-460bfbe1220a?w=700&h=700&fit=crop',0,599,2000,3,'Excellent','rent',1,4.5,203],
    ['Nude Eyeshadow Palette','Velvet Skin','Makeup','Neutral eyeshadow palette with versatile everyday shades.','https://images.unsplash.com/photo-1522335789203-aabd1fc54bc0?w=700&h=700&fit=crop',1899,0,0,20,'New','buy',1,5,312],
    ['18K Gold Statement Ring','Aura Jewels','Jewellery','Pre-owned statement ring in excellent condition.','https://images.unsplash.com/photo-1605100804763-247f67b3557e?w=700&h=700&fit=crop',4500,0,0,4,'Excellent','buy',1,4,41],
    ['Hair Serum','Glow Lab','Haircare','Nourishing hair serum for daily styling and care.','https://images.unsplash.com/photo-1596755389378-c31d21fd1273?w=700&h=700&fit=crop',699,0,0,16,'New','buy',1,4.2,73],
    ['Crystal Party Necklace','Royal Heritage','Jewellery','Sparkling party necklace available for short-term events.','https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?w=700&h=700&fit=crop',0,299,800,5,'Excellent','rent',1,5,156],
    ['Antique Gold Bangle Set','Aura Jewels','Jewellery','Classic bangle set with an antique finish.','https://images.unsplash.com/photo-1603561596112-db1d9d5f5f3b?w=700&h=700&fit=crop',0,349,1200,6,'Excellent','rent',1,4,72],
    ['Bridal Makeup Tool Kit','Event Glow','Beauty Tools','Reusable brushes and beauty tools for event makeup.','https://images.unsplash.com/photo-1522338242992-e1a54906a8da?w=700&h=700&fit=crop',0,249,1000,10,'Excellent','rent',1,4.5,45],
    ['Chandelier Bridal Earrings','Royal Heritage','Jewellery','Statement chandelier earrings for bridal looks.','https://images.unsplash.com/photo-1617038260897-41a1f14a8ca0?w=700&h=700&fit=crop',0,399,1500,4,'Excellent','rent',1,5,118],
    ['Silk Scrunchie Set','Velvet Skin','Haircare','Reusable silk scrunchies in a premium set.','https://images.unsplash.com/photo-1585488434733-96c56f1f4f7f?w=700&h=700&fit=crop',299,0,0,25,'New','buy',1,4.3,32]
  ];
  const stmt = db.prepare(`INSERT INTO products (name,brand,category,description,image,price,rental_price,deposit,stock,condition,listing_type,verified,rating,reviews) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const p of products) stmt.run(...p);
}
seed();

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function ok(res, data) { json(res, 200, data); }
function created(res, data) { json(res, 201, data); }
function error(res, status, message) { json(res, status, { error: message }); }
function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > -1) out[p.slice(0,i).trim()] = decodeURIComponent(p.slice(i+1)); });
  return out;
}
async function readBody(req) {
  return await new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; if (raw.length > 5_000_000) req.destroy(); });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}
function auth(req) {
  const h = String(req.headers.authorization || '');
  if (!h.startsWith('Bearer ')) return null;
  return verifyToken(h.slice(7));
}
function requireAuth(req, res) {
  const user = auth(req);
  if (!user) { error(res, 401, 'Please sign in first.'); return null; }
  return user;
}
function requireAdmin(req, res) {
  const user = requireAuth(req, res);
  if (!user) return null;
  if (user.role !== 'admin') { error(res, 403, 'Admin access required.'); return null; }
  return user;
}
function cleanProduct(p) {
  if (!p) return null;
  return { ...p, verified: !!p.verified, active: !!p.active };
}
function getUser(id) { return db.prepare('SELECT id,name,email,phone,role,created_at FROM users WHERE id=?').get(id); }
function orderNumber() {
  const year = new Date().getFullYear();
  return `GLM-${year}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
}

async function api(req, res, url) {
  const method = req.method;
  const p = url.pathname;
  if (method === 'GET' && p === '/api/health') return ok(res, { ok: true, database: 'sqlite' });

  if (method === 'POST' && p === '/api/auth/register') {
    const b = await readBody(req);
    if (!b.name || !b.email || !b.password) return error(res, 400, 'Name, email and password are required.');
    if (String(b.password).length < 6) return error(res, 400, 'Password must be at least 6 characters.');
    const email = String(b.email).trim().toLowerCase();
    try {
      const result = db.prepare('INSERT INTO users(name,email,phone,password_hash) VALUES(?,?,?,?)').run(String(b.name).trim(), email, b.phone || '', hashPassword(String(b.password)));
      const user = getUser(Number(result.lastInsertRowid));
      return created(res, { token: issueToken(user), user });
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) return error(res, 409, 'An account with this email already exists.');
      throw e;
    }
  }
  if (method === 'POST' && p === '/api/auth/login') {
    const b = await readBody(req);
    const email = String(b.email || '').trim().toLowerCase();
    const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
    if (!user || !verifyPassword(String(b.password || ''), user.password_hash)) return error(res, 401, 'Invalid email or password.');
    const safe = getUser(user.id);
    return ok(res, { token: issueToken(safe), user: safe });
  }
  if (method === 'GET' && p === '/api/auth/me') {
    const user = requireAuth(req, res); if (!user) return;
    return ok(res, { user: getUser(user.sub) });
  }

  if (method === 'GET' && p === '/api/products') {
    const q = String(url.searchParams.get('q') || '').trim();
    const type = String(url.searchParams.get('type') || '').trim();
    const category = String(url.searchParams.get('category') || '').trim();
    let sql = 'SELECT * FROM products WHERE active=1'; const args = [];
    if (q) { sql += ' AND (name LIKE ? OR brand LIKE ? OR category LIKE ?)'; const like = `%${q}%`; args.push(like,like,like); }
    if (type === 'buy') sql += " AND listing_type IN ('buy','both')";
    if (type === 'rent') sql += " AND listing_type IN ('rent','both') AND rental_price > 0";
    if (category) { sql += ' AND category=?'; args.push(category); }
    sql += ' ORDER BY created_at DESC, id DESC';
    return ok(res, { products: db.prepare(sql).all(...args).map(cleanProduct) });
  }
  const productMatch = p.match(/^\/api\/products\/(\d+)$/);
  if (method === 'GET' && productMatch) {
    const product = db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(Number(productMatch[1]));
    if (!product) return error(res, 404, 'Product not found.');
    return ok(res, { product: cleanProduct(product) });
  }
  if (method === 'POST' && p === '/api/products') {
    const user = requireAdmin(req, res); if (!user) return;
    const b = await readBody(req);
    if (!b.name || !b.brand || !b.category) return error(res, 400, 'Name, brand and category are required.');
    const r = db.prepare(`INSERT INTO products(name,brand,category,description,image,price,rental_price,deposit,stock,condition,listing_type,verified,rating,reviews) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      b.name,b.brand,b.category,b.description||'',b.image||'',Number(b.price||0),Number(b.rental_price||0),Number(b.deposit||0),Number(b.stock||0),b.condition||'New',b.listing_type||'buy',b.verified===false?0:1,Number(b.rating||4.5),Number(b.reviews||0));
    return created(res, { product: cleanProduct(db.prepare('SELECT * FROM products WHERE id=?').get(Number(r.lastInsertRowid))) });
  }
  if (method === 'PUT' && productMatch) {
    const user = requireAdmin(req, res); if (!user) return;
    const id = Number(productMatch[1]); const b = await readBody(req);
    const current = db.prepare('SELECT * FROM products WHERE id=?').get(id); if (!current) return error(res,404,'Product not found.');
    const fields = ['name','brand','category','description','image','price','rental_price','deposit','stock','condition','listing_type','verified','active'];
    const values = []; const sets = [];
    for (const f of fields) if (b[f] !== undefined) { sets.push(`${f}=?`); values.push(f === 'verified' || f === 'active' ? (b[f] ? 1 : 0) : b[f]); }
    if (!sets.length) return ok(res,{product:cleanProduct(current)});
    values.push(id); db.prepare(`UPDATE products SET ${sets.join(', ')} WHERE id=?`).run(...values);
    return ok(res,{product:cleanProduct(db.prepare('SELECT * FROM products WHERE id=?').get(id))});
  }
  if (method === 'DELETE' && productMatch) {
    const user = requireAdmin(req, res); if (!user) return;
    db.prepare('UPDATE products SET active=0 WHERE id=?').run(Number(productMatch[1])); return ok(res,{success:true});
  }

  if (method === 'POST' && p === '/api/orders') {
    const user = requireAuth(req, res); if (!user) return;
    const b = await readBody(req);
    if (!Array.isArray(b.items) || !b.items.length) return error(res,400,'Cart is empty.');
    if (!b.shipping || !b.shipping.name || !b.shipping.phone || !b.shipping.address || !b.shipping.city || !b.shipping.pincode) return error(res,400,'Complete shipping details are required.');
    const payment = b.paymentMethod || 'UPI';
    const tx = db.prepare('BEGIN');
    try {
      db.exec('BEGIN IMMEDIATE');
      let total = 0; const rows = [];
      for (const item of b.items) {
        const product = db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(Number(item.productId));
        if (!product) throw new Error('A product in your cart no longer exists.');
        const mode = item.mode === 'rent' ? 'rent' : 'buy';
        const qty = Math.max(1, Number(item.quantity || 1));
        if (product.stock < qty) throw new Error(`${product.name} has only ${product.stock} left in stock.`);
        const unit = mode === 'rent' ? product.rental_price : product.price;
        if (!unit) throw new Error(`${product.name} is not available for ${mode}.`);
        let rentalStart = null, rentalEnd = null, rentalDays = 1;
        if (mode === 'rent') {
          rentalStart = item.rentalStart || null; rentalEnd = item.rentalEnd || null;
          if (!rentalStart || !rentalEnd) throw new Error(`Select rental dates for ${product.name}.`);
          rentalDays = Math.max(1, Math.ceil((new Date(rentalEnd) - new Date(rentalStart)) / 86400000));
        }
        const line = unit * qty * rentalDays;
        total += line + (mode === 'rent' ? product.deposit * qty : 0);
        rows.push({product,qty,mode,unit,rentalStart,rentalEnd,rentalDays});
      }
      const shippingFee = total > 0 ? 49 : 0;
      total += shippingFee;
      const num = orderNumber();
      const r = db.prepare('INSERT INTO orders(user_id,order_number,total,payment_method,status,shipping_json) VALUES(?,?,?,?,?,?)').run(user.sub,num,total,payment,'Placed',JSON.stringify(b.shipping));
      const orderId = Number(r.lastInsertRowid);
      const oi = db.prepare('INSERT INTO order_items(order_id,product_id,product_name,quantity,unit_price,mode,rental_start,rental_end) VALUES(?,?,?,?,?,?,?,?)');
      for (const row of rows) {
        oi.run(orderId,row.product.id,row.product.name,row.qty,row.unit,row.mode,row.rentalStart,row.rentalEnd);
        db.prepare('UPDATE products SET stock=stock-? WHERE id=?').run(row.qty,row.product.id);
      }
      db.exec('COMMIT');
      return created(res,{order:getOrder(orderId)});
    } catch(e) {
      try { db.exec('ROLLBACK'); } catch {}
      return error(res,400,e.message || 'Could not place order.');
    }
  }
  if (method === 'GET' && p === '/api/orders/my') {
    const user = requireAuth(req, res); if (!user) return;
    return ok(res,{orders:getOrdersForUser(user.sub)});
  }
  if (method === 'GET' && p === '/api/orders') {
    const user = requireAdmin(req, res); if (!user) return;
    return ok(res,{orders:getAllOrders()});
  }
  const orderStatusMatch = p.match(/^\/api\/orders\/(\d+)\/status$/);
  if (method === 'PUT' && orderStatusMatch) {
    const user = requireAdmin(req,res); if(!user) return;
    const b=await readBody(req); const allowed=['Placed','Confirmed','Shipped','Delivered','Cancelled','Returned'];
    if(!allowed.includes(b.status)) return error(res,400,'Invalid order status.');
    const id=Number(orderStatusMatch[1]); db.prepare('UPDATE orders SET status=? WHERE id=?').run(b.status,id); return ok(res,{order:getOrder(id)});
  }

  if (method === 'POST' && p === '/api/listings') {
    const user = requireAuth(req,res); if(!user) return;
    const b=await readBody(req);
    const required=['name','category','brand','productType','condition','price','quantity','description','contact'];
    for(const k of required) if(b[k]===undefined || b[k]==='') return error(res,400,`Missing field: ${k}`);
    const r=db.prepare(`INSERT INTO listings(user_id,name,category,brand,product_type,condition,expiry_date,price,quantity,description,contact,image1,image2,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(user.sub,b.name,b.category,b.brand,b.productType,b.condition,b.expiryDate||null,Number(b.price),Number(b.quantity),b.description,b.contact,b.image1||null,b.image2||null,'pending');
    return created(res,{listing:db.prepare('SELECT * FROM listings WHERE id=?').get(Number(r.lastInsertRowid))});
  }
  if (method === 'GET' && p === '/api/listings/my') {
    const user=requireAuth(req,res); if(!user)return;
    return ok(res,{listings:db.prepare('SELECT * FROM listings WHERE user_id=? ORDER BY created_at DESC').all(user.sub)});
  }
  if (method === 'GET' && p === '/api/listings') {
    const user=requireAdmin(req,res); if(!user)return;
    return ok(res,{listings:db.prepare(`SELECT l.*,u.name AS seller_name,u.email AS seller_email FROM listings l JOIN users u ON u.id=l.user_id ORDER BY l.created_at DESC`).all()});
  }
  const listingStatusMatch=p.match(/^\/api\/listings\/(\d+)\/status$/);
  if(method==='PUT' && listingStatusMatch){
    const user=requireAdmin(req,res);if(!user)return;
    const b=await readBody(req); const allowed=['pending','approved','rejected','more_info']; if(!allowed.includes(b.status))return error(res,400,'Invalid listing status.');
    const id=Number(listingStatusMatch[1]); db.prepare('UPDATE listings SET status=? WHERE id=?').run(b.status,id);
    if(b.status==='approved'){
      const l=db.prepare('SELECT * FROM listings WHERE id=?').get(id);
      db.prepare(`INSERT INTO products(name,brand,category,description,image,price,stock,condition,listing_type,verified,rating,reviews) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(l.name,l.brand,l.category,l.description,l.image1||'',l.price,l.quantity,l.condition,'buy',1,5,0);
    }
    return ok(res,{listing:db.prepare('SELECT * FROM listings WHERE id=?').get(id)});
  }

  if (method === 'GET' && p === '/api/admin/stats') {
    const user=requireAdmin(req,res);if(!user)return;
    return ok(res,{stats:{users:db.prepare('SELECT COUNT(*) AS n FROM users WHERE role=\'customer\'').get().n,products:db.prepare('SELECT COUNT(*) AS n FROM products WHERE active=1').get().n,orders:db.prepare('SELECT COUNT(*) AS n FROM orders').get().n,revenue:db.prepare('SELECT COALESCE(SUM(total),0) AS n FROM orders WHERE status<>\'Cancelled\'').get().n,pendingListings:db.prepare("SELECT COUNT(*) AS n FROM listings WHERE status='pending'").get().n}});
  }

  return error(res,404,'API endpoint not found.');
}

function getOrder(id) {
  const o=db.prepare(`SELECT o.*,u.name AS customer_name,u.email AS customer_email FROM orders o JOIN users u ON u.id=o.user_id WHERE o.id=?`).get(id);
  if(!o)return null;
  o.shipping=JSON.parse(o.shipping_json||'{}'); delete o.shipping_json;
  o.items=db.prepare('SELECT * FROM order_items WHERE order_id=?').all(id);
  return o;
}
function getOrdersForUser(userId){ return db.prepare('SELECT id FROM orders WHERE user_id=? ORDER BY created_at DESC').all(userId).map(x=>getOrder(x.id)); }
function getAllOrders(){ return db.prepare('SELECT id FROM orders ORDER BY created_at DESC').all().map(x=>getOrder(x.id)); }

const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon'};
function serveStatic(req,res,url){
  let pathname=decodeURIComponent(url.pathname); if(pathname==='/'||pathname==='')pathname='/index.html';
  const file=path.normalize(path.join(ROOT,pathname));
  if(!file.startsWith(ROOT))return error(res,403,'Forbidden');
  fs.stat(file,(err,st)=>{
    if(err||!st.isFile())return error(res,404,'File not found.');
    const ext=path.extname(file).toLowerCase(); res.writeHead(200,{'Content-Type':mime[ext]||'application/octet-stream'}); fs.createReadStream(file).pipe(res);
  });
}

const server=http.createServer(async (req,res)=>{
  try{
    const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
    if(url.pathname.startsWith('/api/')) await api(req,res,url); else serveStatic(req,res,url);
  }catch(e){ console.error(e); if(!res.headersSent) error(res,500,'Server error.'); }
});

server.listen(PORT,()=>console.log(`GLAMORA running at http://localhost:${PORT}`));
