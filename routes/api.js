const express = require('express');
const multer  = require('multer');
const fs      = require('fs');
const path    = require('path');
const { load, save, saveCritical } = require('../database');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { parsePDF, detectCategory, txId, MEMO_CODES, isForeignTx } = require('../lib/pdf_parser');

const router = express.Router();
router.use(authMiddleware);

// Multer setup for PDF upload (in-memory, 5MB max)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// PDF archive directory (persistent disk on Render, local in dev)
const PDF_ARCHIVE_DIR = path.join(process.env.UPLOAD_DIR || path.join(__dirname, '..', 'public', 'uploads'), 'statements');
if (!fs.existsSync(PDF_ARCHIVE_DIR)) fs.mkdirSync(PDF_ARCHIVE_DIR, { recursive: true });

// Multer setup for image uploads (disk, 8MB max, jpg/png/heic/webp)
// UPLOAD_DIR: persistent disk on Render, local folder in dev
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'public', 'uploads');
const NEWS_UPLOAD_DIR = path.join(UPLOAD_DIR, 'news');
if (!fs.existsSync(NEWS_UPLOAD_DIR)) fs.mkdirSync(NEWS_UPLOAD_DIR, { recursive: true });

const newsImageStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, NEWS_UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = (file.originalname.match(/\.[a-z0-9]+$/i) || ['.jpg'])[0].toLowerCase();
    const name = 'news_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + ext;
    cb(null, name);
  }
});
const newsUpload = multer({
  storage: newsImageStorage,
  limits: { fileSize: 8 * 1024 * 1024, files: 3 },
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype) || /\.(jpe?g|png|heic|webp)$/i.test(file.originalname)) cb(null, true);
    else cb(new Error('Зургийн файл л оруулна уу'));
  },
});

// ── DASHBOARD ──
router.get('/dashboard', (req, res) => {
  const db = load();
  res.json({
    finance:     db.finance,
    imports:     db.imports,
    alerts:      db.alerts.filter(a => !a.resolved),
    receivables: db.receivables.filter(r => !r.resolved),
    payables:    db.payables.filter(p => !p.resolved),
  });
});

router.put('/finance', adminOnly, (req, res) => {
  const db = load();
  db.finance = { ...db.finance, ...req.body, updated_at: new Date().toISOString().slice(0,10) };
  save(db); res.json({ ok: true });
});

// ── PRODUCTS ──
router.get('/products', (req, res) => {
  const db = load();
  if (!db.products) { db.products = DEFAULT_PRODUCTS; save(db); }
  res.json(db.products.filter(p => p.active !== false));
});

router.post('/products', adminOnly, (req, res) => {
  const db = load();
  if (!db.products) db.products = [];
  const id = 'prod_' + Date.now();
  db.products.push({ id, active: true, price: 0, ...req.body });
  save(db); res.json({ id });
});

router.put('/products/:id', adminOnly, (req, res) => {
  const db = load();
  if (!db.products) { db.products = DEFAULT_PRODUCTS; }
  const p = db.products.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Олдсонгүй' });
  Object.assign(p, req.body);
  save(db); res.json({ ok: true });
});

// ── BRANCHES ──
router.get('/branches', (req, res) => {
  const db = load();
  if (!db.branches || db.branches.length === 0) {
    db.branches = [{ id: 1, name: 'Пластик Центр — Үндсэн', active: true }];
    save(db);
  }
  res.json(db.branches.filter(b => b.active !== false));
});

router.post('/branches', adminOnly, (req, res) => {
  const db = load();
  if (!db.branches) db.branches = [];
  const id = Math.max(0, ...db.branches.map(b => b.id)) + 1;
  db.branches.push({ id, active: true, ...req.body });
  save(db); res.json({ id });
});

router.put('/branches/:id', adminOnly, (req, res) => {
  const db = load();
  const b = (db.branches || []).find(b => b.id === parseInt(req.params.id));
  if (!b) return res.status(404).json({ error: 'Олдсонгүй' });
  Object.assign(b, req.body);
  save(db); res.json({ ok: true });
});

// ── BANK ACCOUNTS ──
// Default: returns only active accounts (for selection dropdowns)
// ?all=true: admin-only, returns all including inactive (for finance-admin)
router.get('/bank-accounts', (req, res) => {
  const db = load();
  if (!db.bank_accounts || db.bank_accounts.length === 0) {
    db.bank_accounts = [
      { id: 'tdb',  name: 'TDB — Компани (803060739)',     active: true },
      { id: 'khan', name: 'Хаан банк — Касс (5304716376)', active: true },
    ];
    save(db);
  }
  if (req.query.all === 'true' && req.user.role === 'admin') {
    return res.json(db.bank_accounts);
  }
  res.json(db.bank_accounts.filter(a => a.active !== false));
});

router.post('/bank-accounts', adminOnly, (req, res) => {
  const db = load();
  if (!db.bank_accounts) db.bank_accounts = [];
  const id = 'bank_' + Date.now();
  db.bank_accounts.push({ id, active: true, ...req.body });
  save(db); res.json({ id });
});

router.put('/bank-accounts/:id', adminOnly, (req, res) => {
  const db = load();
  const a = (db.bank_accounts || []).find(a => a.id === req.params.id);
  if (!a) return res.status(404).json({ error: 'Олдсонгүй' });
  Object.assign(a, req.body);
  save(db); res.json({ ok: true });
});

// ── ИМПОРТ ──
router.get('/imports', (req, res) => {
  const db = load(); res.json(db.imports);
});

router.put('/imports/:id', adminOnly, (req, res) => {
  const db = load();
  const idx = db.imports.findIndex(i => i.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Олдсонгүй' });
  db.imports[idx] = { ...db.imports[idx], ...req.body };
  save(db); res.json({ ok: true });
});

router.post('/imports', adminOnly, (req, res) => {
  const db = load();
  const id = Math.max(0, ...db.imports.map(i => i.id)) + 1;
  db.imports.push({ id, ...req.body });
  save(db); res.json({ id });
});

// Bulk replace all imports (admin only)
router.put('/imports', adminOnly, (req, res) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ error: 'Array expected' });
  const db = load();
  db.imports = req.body;
  save(db); res.json({ ok: true, count: req.body.length });
});

// ── ALERTS ──
router.put('/alerts/:id/resolve', adminOnly, (req, res) => {
  const db = load();
  const a = db.alerts.find(a => a.id === parseInt(req.params.id));
  if (a) a.resolved = true;
  save(db); res.json({ ok: true });
});

router.post('/alerts', adminOnly, (req, res) => {
  const db = load();
  const id = Math.max(0, ...db.alerts.map(a => a.id)) + 1;
  db.alerts.push({ id, ...req.body, resolved: false });
  save(db); res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════
// ── СКЛАД / INVENTORY + БОРЛУУЛАЛТ / SALES — тусдаа router файлд шилжсэн ──
//   • routes/inventory.js  — Склад, Үйлдвэрлэл  (Нярав-Менежер эзэмшил)
//   • routes/sales.js      — Борлуулалт          (Нярав-Менежер эзэмшил)
// server.js дотор тус бүр '/api'-д mount хийгдсэн. Санхүү код энд хэвээр (Owner эзэмшил).
// ════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════
// ── САНХҮҮ (Finance) ──
// ════════════════════════════════════════════════════════════

// All authenticated users can VIEW (admin + shareholders)
// Only admin can IMPORT and EDIT

router.get('/finance/transactions', (req, res) => {
  if (!['admin', 'shareholder'].includes(req.user.role)) return res.status(403).json({ error: 'Зөвшөөрөл хүрэлцэхгүй' });
  const db = load();
  res.json((db.transactions || []).filter(t => !t.archived));
});

router.get('/finance/summary', (req, res) => {
  if (!['admin', 'shareholder'].includes(req.user.role)) return res.status(403).json({ error: 'Зөвшөөрөл хүрэлцэхгүй' });
  const db = load();
  const txs = (db.transactions || []).filter(t => !t.archived);

  const compare = (a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    if ((a.time || '') !== (b.time || '')) return (a.time || '').localeCompare(b.time || '');
    return (a.seq || 0) - (b.seq || 0);
  };

  // Latest balance per account
  const balances = {};
  const byAccount = {};
  for (const t of txs) {
    if (!byAccount[t.account]) byAccount[t.account] = [];
    byAccount[t.account].push(t);
  }
  for (const [account, list] of Object.entries(byAccount)) {
    list.sort(compare);
    const last = list[list.length - 1];
    balances[account] = { date: last.date, time: last.time, balance: last.balance_after, label: last.account_label };
  }

  // Counts by code
  const byCode = {};
  let needsReview = 0;
  let totalAmount = 0;
  for (const t of txs) {
    const c = t.code || 'NONE';
    byCode[c] = (byCode[c] || 0) + 1;
    if (t.needs_review) needsReview++;
    totalAmount += t.amount || 0;
  }

  // OTHER threshold (>10% of total amount)
  const otherAmount = txs.filter(t => t.code === 'OTHER').reduce((s,t) => s + t.amount, 0);
  const otherWarning = totalAmount > 0 && (otherAmount / totalAmount) > 0.10;

  res.json({
    count: txs.length,
    balances,
    by_code: byCode,
    needs_review: needsReview,
    other_warning: otherWarning,
    other_percent: totalAmount > 0 ? Math.round((otherAmount / totalAmount) * 100) : 0,
  });
});

// ════════════════════════════════════════════════════════════
// ── ЭД ХӨРӨНГӨ (Company assets) — finance-derived view ──
// ASSET зарлагын гүйлгээ бүр = нэг эд хөрөнгө. Өгөгдөл санхүүгээс
// гарна (single source of truth), складад давхар бичигдэхгүй.
// Хариуцагч/байршлын мэдээлэл db.asset_meta[tx_id]-д хадгалагдана
// (гүйлгээний бичлэгийг өөрчлөхгүй).
// ════════════════════════════════════════════════════════════

function cleanAssetName(desc) {
  let s = (desc || '').trim();
  s = s.replace(/^EB\s*-\s*/i, '');               // "EB -" угтвар
  s = s.replace(/^[A-Z][A-Z_]{1,9}\s*:\s*/, '');  // "CODE:" угтвар (EQP:, ASSET: г.м)
  return s.trim() || 'Нэргүй хөрөнгө';
}

// Хэн мөнгөн дүн харах вэ: зөвхөн санхүү (admin/shareholder).
// Менежер/склад эд хөрөнгийн жагсаалт + хариуцагчийг харна, дүнг харахгүй.
const ASSET_VIEW_ROLES = ['admin', 'shareholder', 'warehouse', 'manager'];
const ASSET_EDIT_ROLES = ['admin', 'manager', 'warehouse'];

router.get('/finance/assets', (req, res) => {
  if (!ASSET_VIEW_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Зөвшөөрөл хүрэлцэхгүй' });
  const seesMoney = ['admin', 'shareholder'].includes(req.user.role);
  const db = load();
  const meta = db.asset_meta || {};
  const assets = (db.transactions || [])
    .filter(t => !t.archived && t.code === 'ASSET')
    .map(t => {
      const m = meta[t.id] || {};
      const a = {
        tx_id: t.id,
        date: t.date,
        name: cleanAssetName(t.description),
        responsible_owner: m.responsible_owner || null,
        location: m.location || null,
        note: m.note || null,
        source: 'finance',
      };
      if (seesMoney) a.amount = t.amount;
      return a;
    })
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  res.json({ assets, sees_money: seesMoney });
});

router.put('/finance/assets/:tx_id', (req, res) => {
  if (!ASSET_EDIT_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Зөвшөөрөл хүрэлцэхгүй' });
  const db = load();
  const tx = (db.transactions || []).find(t => t.id === req.params.tx_id && !t.archived && t.code === 'ASSET');
  if (!tx) return res.status(404).json({ error: 'Эд хөрөнгө олдсонгүй' });

  const clip = (v) => (typeof v === 'string' ? v.trim().slice(0, 200) : '');
  db.asset_meta = db.asset_meta || {};
  db.asset_meta[tx.id] = {
    responsible_owner: clip(req.body.responsible_owner),
    location: clip(req.body.location),
    note: clip(req.body.note),
    updated_at: new Date().toISOString(),
    updated_by: req.user.username || req.user.role,
  };
  save(db);
  res.json({ ok: true, tx_id: tx.id, meta: db.asset_meta[tx.id] });
});

// ── 2-STEP IMPORT: Preview (parse PDF but don't save) ──
router.post('/finance/import/preview', adminOnly, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл хавсаргана уу' });

  try {
    // Save PDF to archive
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const safeName = (req.file.originalname || 'statement.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
    const archivePath = path.join(PDF_ARCHIVE_DIR, `${ts}_${safeName}`);
    fs.writeFileSync(archivePath, req.file.buffer);

    const parsed = await parsePDF(req.file.buffer);
    const db = load();
    const existingTxs = new Map((db.transactions || []).map(t => [t.id, t]));

    // Enrich each transaction with metadata for review
    const enriched = parsed.transactions.map(tx => {
      const id = txId(tx);
      const detected = detectCategory(tx);
      const existingTx = existingTxs.get(id);    // already in DB (carries saved code)
      return {
        ...tx,
        _temp_id:       id,                      // for review screen
        _is_duplicate:  !!existingTx,            // already in DB
        _existing_code: existingTx ? (existingTx.code || null) : null, // code assigned in an earlier import/review
        _auto_code:     detected.code,           // parser's guess
        _needs_review:  detected.needs_review,
        _is_foreign:    isForeignTx(tx.description),
        _raw_memo:      tx.description,
      };
    });

    const duplicates = enriched.filter(t => t._is_duplicate).length;
    const needsReview = enriched.filter(t => t._needs_review && !t._is_duplicate).length;
    const autoCategorized = enriched.filter(t => t._auto_code && !t._is_duplicate).length;

    res.json({
      ok: true,
      bank: parsed.bank,
      account: parsed.account,
      account_label: parsed.account_label,
      filename: req.file.originalname,
      total: enriched.length,
      duplicates,
      needs_review: needsReview,
      auto_categorized: autoCategorized,
      transactions: enriched,
    });
  } catch (e) {
    console.error('PDF preview error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── List saved PDF statements ──
router.get('/finance/statements', adminOnly, (req, res) => {
  try {
    const files = fs.readdirSync(PDF_ARCHIVE_DIR)
      .filter(f => f.endsWith('.pdf'))
      .sort().reverse()
      .map(f => ({
        filename: f,
        size: fs.statSync(path.join(PDF_ARCHIVE_DIR, f)).size,
        date: f.slice(0, 10),
      }));
    res.json(files);
  } catch (e) {
    res.json([]);
  }
});

// ── 2-STEP IMPORT: Confirm (save reviewed transactions) ──
router.post('/finance/import/confirm', adminOnly, (req, res) => {
  const { transactions, filename } = req.body || {};
  if (!Array.isArray(transactions)) return res.status(400).json({ error: 'Гүйлгээний жагсаалт буруу' });

  const db = load();
  if (!db.transactions) db.transactions = [];
  const existing = new Set(db.transactions.map(t => t.id));
  const now = new Date().toISOString();

  let added = 0, skipped = 0, rejected = 0;
  for (const tx of transactions) {
    // Skip explicitly rejected
    if (tx._rejected) { rejected++; continue; }

    const id = tx._temp_id || txId(tx);
    if (existing.has(id)) { skipped++; continue; }

    // Clean up temp fields and persist
    const code = tx.code || tx._auto_code || null;
    const record = {
      id,
      account:           tx.account,
      account_label:     tx.account_label,
      date:              tx.date,
      time:              tx.time,
      direction:         tx.direction,
      amount:            tx.amount,
      balance_after:     tx.balance_after,
      description:       tx.description,
      counterparty:      tx.counterparty || '',
      seq:               tx.seq,
      teller:            tx.teller,
      raw_memo:          tx._raw_memo || tx.description,
      code,
      needs_review:      !code,
      is_foreign:        !!tx._is_foreign,
      note:              tx.note || '',
      source_file:       filename || tx.source_file || '',
      imported_at:       now,
      imported_by:       req.user.name,
      reviewed_at:       now,
      reviewed_by:       req.user.name,
    };
    db.transactions.push(record);
    existing.add(id);
    added++;
  }

  db.transactions.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    if ((a.time || '') !== (b.time || '')) return (a.time || '').localeCompare(b.time || '');
    return (a.seq || 0) - (b.seq || 0);
  });

  save(db);
  res.json({ ok: true, added, skipped, rejected });
});

router.post('/finance/import', adminOnly, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл хавсаргана уу' });

  try {
    const parsed = await parsePDF(req.file.buffer);
    const db = load();
    if (!db.transactions) db.transactions = [];

    // Build dedup index of existing txIds
    const existing = new Set(db.transactions.map(t => t.id));

    let added = 0, skipped = 0;
    const now = new Date().toISOString();
    for (const tx of parsed.transactions) {
      const id = txId(tx);
      if (existing.has(id)) { skipped++; continue; }

      const detected = detectCategory(tx);
      db.transactions.push({
        id,
        ...tx,
        raw_memo:     tx.description,
        code:         detected.code,
        needs_review: detected.needs_review,
        is_foreign:   isForeignTx(tx.description),
        note:         '',
        source_file:  req.file.originalname,
        imported_at:  now,
        imported_by:  req.user.name,
      });
      added++;
    }

    // Sort by date+time
    db.transactions.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      if ((a.time || '') !== (b.time || '')) return (a.time || '').localeCompare(b.time || '');
      return (a.seq || 0) - (b.seq || 0);
    });

    save(db);
    res.json({ ok: true, bank: parsed.bank, account: parsed.account, added, skipped, total_in_pdf: parsed.transactions.length });
  } catch (e) {
    console.error('PDF import error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Auto-import: scan bank statement folders and import any new PDFs
router.post('/finance/auto-import', adminOnly, async (req, res) => {
  const FOLDERS = [
    process.env.BANK_STATEMENT_KASS,
    process.env.BANK_STATEMENT_TDB,
  ].filter(Boolean);

  const db = load();
  if (!db.transactions) db.transactions = [];
  const existing = new Set(db.transactions.map(t => t.id));

  let totalAdded = 0, totalSkipped = 0, filesProcessed = 0, errors = [];
  const now = new Date().toISOString();

  for (const folder of FOLDERS) {
    if (!fs.existsSync(folder)) continue;
    const files = fs.readdirSync(folder).filter(f => f.toLowerCase().endsWith('.pdf'));
    for (const file of files) {
      try {
        const buffer = fs.readFileSync(path.join(folder, file));
        const parsed = await parsePDF(buffer);
        filesProcessed++;

        for (const tx of parsed.transactions) {
          const id = txId(tx);
          if (existing.has(id)) { totalSkipped++; continue; }
          existing.add(id);
          const detected = detectCategory(tx);
          db.transactions.push({
            id, ...tx,
            raw_memo:     tx.description,
            code:         detected.code,
            needs_review: detected.needs_review,
            is_foreign:   isForeignTx(tx.description),
            note:         '',
            source_file:  file,
            imported_at:  now,
            imported_by:  req.user.name,
          });
          totalAdded++;
        }
      } catch (e) {
        errors.push({ file, error: e.message });
      }
    }
  }

  db.transactions.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return (a.time || '').localeCompare(b.time || '');
  });

  save(db);
  res.json({ ok: true, files_processed: filesProcessed, added: totalAdded, skipped: totalSkipped, errors });
});

// Update transaction code/note (admin marks reviewed)
router.put('/finance/transactions/:id', adminOnly, (req, res) => {
  const db = load();
  const tx = (db.transactions || []).find(t => t.id === req.params.id);
  if (!tx) return res.status(404).json({ error: 'Олдсонгүй' });
  if ('code' in req.body) {
    tx.code = req.body.code;
    tx.needs_review = !req.body.code || !MEMO_CODES[req.body.code];
  }
  if ('note' in req.body) tx.note = req.body.note;
  save(db);
  res.json({ ok: true, code: tx.code, needs_review: tx.needs_review });
});

// Archive a transaction (for phantom/duplicate entries)
router.put('/finance/transactions/:id/archive', adminOnly, (req, res) => {
  const db = load();
  const tx = (db.transactions || []).find(t => t.id === req.params.id);
  if (!tx) return res.status(404).json({ error: 'Олдсонгүй' });
  tx.archived = true;
  tx.archived_at = new Date().toISOString();
  tx.archived_by = req.user.name;
  tx.archive_reason = req.body.reason || '';
  save(db);
  res.json({ ok: true, id: tx.id, archived: true });
});

// Get memo codes spec
router.get('/finance/codes', (req, res) => {
  res.json(MEMO_CODES);
});

// ── RECONCILIATION: balance chain math check ──
// For each account: prev.balance_after ± amount = current.balance_after
// If mismatch → gap detected (missing tx or parser error)
function normalizeTime(t) {
  // Convert "HH:MM:SS AM/PM" or "HH:MM" to 24-hour string for proper sort
  if (!t) return '00:00:00';
  const m = String(t).match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!m) return String(t);
  let h = parseInt(m[1]);
  const min = m[2], sec = m[3] || '00';
  const ampm = (m[4] || '').toUpperCase();
  if (ampm === 'AM' && h === 12) h = 0;
  else if (ampm === 'PM' && h !== 12) h += 12;
  return `${String(h).padStart(2,'0')}:${min}:${sec}`;
}

function reconcileAccount(transactions, account) {
  const list = transactions
    .filter(t => t.account === account)
    .sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      const ta = normalizeTime(a.time), tb = normalizeTime(b.time);
      if (ta !== tb) return ta.localeCompare(tb);
      return (a.seq || 0) - (b.seq || 0);
    });

  if (!list.length) return { account, total: 0, gaps: [], ok: true };

  const gaps = [];
  for (let i = 1; i < list.length; i++) {
    const prev = list[i - 1];
    const curr = list[i];
    const sign = curr.direction === 'credit' ? 1 : -1;
    const expected = prev.balance_after + sign * curr.amount;
    const diff = curr.balance_after - expected;
    if (Math.abs(diff) > 0.01) {
      gaps.push({
        date: curr.date,
        time: curr.time,
        description: curr.description,
        expected,
        actual: curr.balance_after,
        diff,
      });
    }
  }

  return {
    account,
    label: list[0].account_label,
    total: list.length,
    gaps,
    ok: gaps.length === 0,
    first_balance: list[0].balance_after - (list[0].direction === 'credit' ? list[0].amount : -list[0].amount),
    latest_balance: list[list.length - 1].balance_after,
  };
}

router.get('/finance/reconcile', (req, res) => {
  if (!['admin', 'shareholder'].includes(req.user.role)) return res.status(403).json({ error: 'Зөвшөөрөл хүрэлцэхгүй' });
  const db = load();
  const txs = (db.transactions || []).filter(t => !t.archived);
  const accounts = [...new Set(txs.map(t => t.account))];
  const results = accounts.map(acc => reconcileAccount(txs, acc));
  const all_ok = results.every(r => r.ok);
  res.json({ all_ok, accounts: results });
});

// Loans we received (e.g. investor)
router.get('/finance/loans-received', (req, res) => {
  if (!['admin', 'shareholder'].includes(req.user.role)) return res.status(403).json({ error: 'Зөвшөөрөл хүрэлцэхгүй' });
  const db = load();
  res.json(db.loans_received || []);
});

// Mark a scheduled interest payment as paid (operational)
router.put('/finance/loans-received/:id/mark-paid', adminOnly, (req, res) => {
  const db = load();
  const loan = (db.loans_received || []).find(l => String(l.id) === String(req.params.id));
  if (!loan) return res.status(404).json({ error: 'Олдсонгүй' });

  const scheduleIdx = parseInt(req.body.schedule_index);
  if (isNaN(scheduleIdx) || !loan.interest_schedule || !loan.interest_schedule[scheduleIdx]) {
    return res.status(400).json({ error: 'Төлбөрийн график буруу' });
  }

  loan.interest_schedule[scheduleIdx].paid = true;
  loan.interest_schedule[scheduleIdx].paid_at = new Date().toISOString();
  loan.interest_schedule[scheduleIdx].paid_by = req.user.name;

  // Recalculate interest_paid total
  loan.interest_paid = loan.interest_schedule.filter(s => s.paid).reduce((sum, s) => sum + s.amount, 0);

  save(db);
  res.json({ ok: true, loan });
});

// Reverse: unmark interest payment (in case of mistake)
router.put('/finance/loans-received/:id/unmark-paid', adminOnly, (req, res) => {
  const db = load();
  const loan = (db.loans_received || []).find(l => String(l.id) === String(req.params.id));
  if (!loan) return res.status(404).json({ error: 'Олдсонгүй' });

  const scheduleIdx = parseInt(req.body.schedule_index);
  if (isNaN(scheduleIdx) || !loan.interest_schedule || !loan.interest_schedule[scheduleIdx]) {
    return res.status(400).json({ error: 'Төлбөрийн график буруу' });
  }

  loan.interest_schedule[scheduleIdx].paid = false;
  delete loan.interest_schedule[scheduleIdx].paid_at;
  delete loan.interest_schedule[scheduleIdx].paid_by;
  loan.interest_paid = loan.interest_schedule.filter(s => s.paid).reduce((sum, s) => sum + s.amount, 0);

  save(db);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════
// ── НИЙТЛЭЛ / NEWS ──
// ════════════════════════════════════════════════════════════

// List news (all authenticated users)
router.get('/news', (req, res) => {
  const db = load();
  const list = (db.news || []).filter(n => !n.archived);
  // Sort: urgent first, then by date desc
  const prio = { urgent: 3, important: 2, normal: 1 };
  list.sort((a, b) => {
    const pa = prio[a.priority] || 1;
    const pb = prio[b.priority] || 1;
    if (pa !== pb) return pb - pa;
    return (b.created_at || '').localeCompare(a.created_at || '');
  });
  res.json(list);
});

// Create news (admin)
// Accepts multipart/form-data with up to 3 image files (field "images") + JSON fields
router.post('/news', adminOnly, newsUpload.array('images', 3), (req, res) => {
  const db = load();
  if (!db.news) db.news = [];

  const { title, body, priority } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'Гарчиг оруулна уу' });

  const images = (req.files || []).map(f => '/uploads/news/' + f.filename);
  const validPriority = ['normal', 'important', 'urgent'].includes(priority) ? priority : 'normal';

  const record = {
    id:         require('crypto').randomUUID(),
    title:      title.trim(),
    body:       (body || '').trim(),
    images,
    priority:   validPriority,
    created_at: new Date().toISOString(),
    created_by: req.user.name,
    archived:   false,
  };

  db.news.push(record);
  save(db);
  res.json({ ok: true, id: record.id });
});

// Update news (admin) — text fields only; images via separate flow
router.put('/news/:id', adminOnly, (req, res) => {
  const db = load();
  const n = (db.news || []).find(x => x.id === req.params.id);
  if (!n) return res.status(404).json({ error: 'Олдсонгүй' });

  if ('title' in req.body)    n.title    = String(req.body.title || '').trim();
  if ('body' in req.body)     n.body     = String(req.body.body || '').trim();
  if ('priority' in req.body && ['normal', 'important', 'urgent'].includes(req.body.priority)) {
    n.priority = req.body.priority;
  }
  n.updated_at = new Date().toISOString();
  n.updated_by = req.user.name;
  save(db);
  res.json({ ok: true });
});

// Soft-delete news (admin)
router.delete('/news/:id', adminOnly, (req, res) => {
  const db = load();
  const n = (db.news || []).find(x => x.id === req.params.id);
  if (!n) return res.status(404).json({ error: 'Олдсонгүй' });
  n.archived = true;
  n.archived_at = new Date().toISOString();
  n.archived_by = req.user.name;
  save(db);
  res.json({ ok: true });
});

// ── Admin: Export full database (for local sync) ──
router.get('/admin/export', adminOnly, (req, res) => {
  const db = load();
  res.setHeader('Content-Disposition', 'attachment; filename="data.json"');
  res.json(db);
});

module.exports = router;
