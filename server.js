require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
// Prevent stale HTML cache on mobile browsers (Safari aggressive caching)
app.use((req, res, next) => {
  if (req.url.endsWith('.html') || req.url === '/' || !req.url.includes('.')) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// Serve uploaded files from persistent storage (Render disk or local)
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'public', 'uploads');
app.use('/uploads', express.static(UPLOAD_DIR));

app.use('/api/auth', require('./routes/auth'));
app.use('/api', require('./routes/api'));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/sales',       (req, res) => res.sendFile(path.join(__dirname, 'public', 'sales.html')));
app.get('/sales-entry', (req, res) => res.sendFile(path.join(__dirname, 'public', 'sales-entry.html')));
app.get('/inventory', (req, res) => res.sendFile(path.join(__dirname, 'public', 'inventory.html')));
app.get('/production', (req, res) => res.sendFile(path.join(__dirname, 'public', 'production.html')));
app.get('/settings',   (req, res) => res.sendFile(path.join(__dirname, 'public', 'settings.html')));
app.get('/finance',        (req, res) => res.sendFile(path.join(__dirname, 'public', 'finance.html')));
app.get('/finance-detail', (req, res) => res.sendFile(path.join(__dirname, 'public', 'finance-detail.html')));
app.get('/more',       (req, res) => res.sendFile(path.join(__dirname, 'public', 'more.html')));
app.get('/news',       (req, res) => res.sendFile(path.join(__dirname, 'public', 'news.html')));
app.get('/imports',    (req, res) => res.sendFile(path.join(__dirname, 'public', 'imports.html')));
app.get('/income',     (req, res) => res.sendFile(path.join(__dirname, 'public', 'income.html')));
app.get('/expense',    (req, res) => res.sendFile(path.join(__dirname, 'public', 'expense.html')));
app.get('/loans',          (req, res) => res.sendFile(path.join(__dirname, 'public', 'loans.html')));
app.get('/finance-import', (req, res) => res.sendFile(path.join(__dirname, 'public', 'finance-import.html')));
app.get('/codes',          (req, res) => res.sendFile(path.join(__dirname, 'public', 'codes.html')));
app.get('/review',         (req, res) => res.sendFile(path.join(__dirname, 'public', 'review.html')));
app.get('/finance-admin',   (req, res) => res.sendFile(path.join(__dirname, 'public', 'finance-admin.html')));
app.get('/inventory-admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'inventory-admin.html')));

// ── One-time migration: convert 12-hour AM/PM times to 24-hour format ──
(function migrateTimeTo24h() {
  const { load, save } = require('./database');
  const db = load();
  const txs = db.transactions || [];
  let changed = 0;
  for (const t of txs) {
    if (!t.time) continue;
    const m = t.time.match(/^(\d{2}):(\d{2}):(\d{2})\s+(AM|PM)$/);
    if (!m) continue;
    let hour = parseInt(m[1], 10);
    if (m[4] === 'AM' && hour === 12) hour = 0;
    if (m[4] === 'PM' && hour !== 12) hour += 12;
    t.time = String(hour).padStart(2, '0') + ':' + m[2] + ':' + m[3];
    changed++;
  }
  // Fix known data issues
  for (const t of txs) {
    // Plastic Center 69M: wrong direction (credit→debit)
    if (t.id === '7fd71e81536ff61d' && t.direction === 'credit') {
      t.direction = 'debit';
      changed++;
    }
    // Plastic Center 69M phantom entry: archive it
    if (t.id === 'c505f6c2aaf151a4' && !t.archived) {
      t.archived = true;
      t.archived_at = new Date().toISOString();
      t.archived_by = 'system-migration';
      t.archive_reason = 'Phantom entry from PDF parser (header text mixed into description)';
      changed++;
    }
    // Plastic Center 7.32M loan: wrong direction (credit→debit)
    if (t.id === 'c3d904c0a0c4c9e0' && t.direction === 'credit') {
      t.direction = 'debit';
      changed++;
    }
  }
  if (changed > 0) {
    save(db);
    console.log(`Migration: fixed ${changed} transaction issues (time format + data corrections)`);
  }
})();

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  const os = require('os');
  const ifaces = os.networkInterfaces();
  const lanIps = [];
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) lanIps.push(iface.address);
    }
  }
  console.log(`\nMetalworking app running:`);
  console.log(`  Local:   http://localhost:${PORT}`);
  lanIps.forEach(ip => console.log(`  LAN:     http://${ip}:${PORT}`));
  console.log('');
});
