const express = require('express');
const { load, save } = require('../database');
const { authMiddleware, adminOnly } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// ── Migration: "Замын хавтан" бүтээгдэхүүнийг үнэ 20000-аар бэлдэх (нэг удаа) ──
function ensureSaleProducts(db) {
  if (db.fix_pavement_price_v1) return;
  if (!db.products) db.products = [];
  // "зам" ба "хавтан" хоёуланг агуулсан бараа (Замын/Явган замын хавтан)
  let p = db.products.find(x => /зам/i.test(x.name || '') && /хавтан/i.test(x.name || ''));
  if (p) {
    p.name  = 'Замын хавтан';
    p.price = 20000;
    p.active = true;
  } else {
    db.products.push({ id: 'pavement', name: 'Замын хавтан', price: 20000, active: true });
  }
  db.fix_pavement_price_v1 = true;
}

// ── БОРЛУУЛАЛТ ──
router.get('/sales', (req, res) => {
  // Revenue is owner/sales data — factory engineers don't see it.
  if (req.user.role === 'engineer') return res.status(403).json({ error: 'Зөвшөөрөл хүрэлцэхгүй' });
  const db = load();
  ensureSaleProducts(db); save(db);
  // Exclude archived records from normal view
  const sales = (db.sales || []).filter(s => !s.archived);
  if (req.user.role === 'sales') return res.json(sales.filter(s => s.created_by === req.user.name));
  res.json(sales);
});

// ── БАНКНЫ ХУУЛГЫН БОРЛУУЛАЛТЫН ОРЛОГО (зөвхөн УНШИХ жагсаалт) ──
// SALE: кодтой банкны гүйлгээ = "Бүрэн төлсөн борлуулалт" (revenue, lib/pdf_parser.js).
// Зорилго: борлуулалт хэрхэн явж буйг БҮХ хүн (engineer ч) ил тод харах.
// Зөвхөн SALE мөрийг буцаана — бусад санхүүгийн гүйлгээ ЗАДРАХГҮЙ.
// Энэ бол зөвхөн ТҮҮХИЙ ЖАГСААЛТ. Ангилал/боловсруулалт = МЕНЕЖЕРИЙН модуль (энд хийгдэхгүй).
router.get('/sales-income', (req, res) => {
  const db = load();
  // Аль хэдийн борлуулалт болгож ангилсан гүйлгээг хасна
  const classified = new Set(
    (db.sales || []).filter(s => !s.archived && s.source_tx_id != null).map(s => String(s.source_tx_id))
  );
  const list = (db.transactions || [])
    .filter(t => t.code === 'SALE' && !classified.has(String(t.id)))
    .map(t => ({
      id:     t.id,
      date:   t.date,                                      // огноо (он-сар-өдөр)
      memo:   t.note || t.description || t.raw_memo || '', // хүний бичсэн гүйлгээний утга
      amount: t.amount || 0,                               // дүн
    }))
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  res.json(list);
});

router.post('/sales', (req, res) => {
  if (!['admin', 'sales', 'manager'].includes(req.user.role)) return res.status(403).json({ error: 'Зөвшөөрөл хүрэлцэхгүй' });
  const db = load();
  if (!db.sales) db.sales = [];

  const { date, branch, product, quantity, advance_paid, customer_name, customer_phone, bank_account, note, source_tx_id } = req.body;

  // Load price from products master — preserves historical price at time of sale
  const productDef = (db.products || []).find(p => p.id === product);
  const unit_price = (!productDef || productDef.price === 0)
    ? parseInt(req.body.unit_price) || 0
    : productDef.price;

  if (!unit_price) return res.status(400).json({ error: 'Үнэ оруулна уу' });

  const qty              = parseInt(quantity) || 0;
  const adv              = parseInt(advance_paid) || 0;
  const total_amount     = qty * unit_price;
  const remaining_amount = Math.max(0, total_amount - adv);
  const status           = remaining_amount === 0 ? 'completed' : 'receivable';
  const now              = new Date().toISOString();

  // Snapshot bank account name at time of sale (preserves name even if admin renames later)
  const bankDef = (db.bank_accounts || []).find(a => a.id === bank_account);

  const record = {
    id:                require('crypto').randomUUID(),
    date:              date || now.slice(0, 10),
    branch:            branch || '',
    product,
    quantity:          qty,
    unit_price,                      // historical snapshot
    total_amount,
    advance_paid:      adv,
    remaining_amount,
    bank_account:      bank_account || '',
    bank_account_name: bankDef ? bankDef.name : (bank_account || ''), // snapshot
    customer_name:     customer_name || '',
    customer_phone:    customer_phone || '',
    note:              note || '',
    source_tx_id:      source_tx_id || null,   // банкны хуулгын гүйлгээтэй холбоо
    status,
    archived:          false,
    created_by:        req.user.name,
    created_at:        now,
  };

  db.sales.push(record);
  save(db);
  res.json({ id: record.id });
});

router.put('/sales/:id', (req, res) => {
  if (!['admin', 'sales', 'manager'].includes(req.user.role)) return res.status(403).json({ error: 'Зөвшөөрөл хүрэлцэхгүй' });
  const db  = load();
  const idx = (db.sales || []).findIndex(s => String(s.id) === String(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Олдсонгүй' });

  const order = db.sales[idx];

  if ('received_amount' in req.body) {
    // Accountant records a payment received against outstanding balance
    const received         = parseInt(req.body.received_amount) || 0;
    const newRemaining     = Math.max(0, (order.remaining_amount || 0) - received);
    order.advance_paid     = (order.advance_paid || 0) + received;
    order.remaining_amount = newRemaining;
    order.status           = newRemaining === 0 ? 'completed' : 'receivable';
  } else if (req.body.mark_completed) {
    order.remaining_amount = 0;
    order.status           = 'completed';
  } else if (req.user.role === 'admin') {
    const updated = { ...order, ...req.body };
    updated.status = (parseInt(updated.remaining_amount) || 0) === 0 ? 'completed' : 'receivable';
    db.sales[idx] = updated;
  }

  save(db);
  res.json({ ok: true, status: db.sales[idx].status, remaining_amount: db.sales[idx].remaining_amount });
});

// Soft delete — never permanently removes accounting records
router.delete('/sales/:id', adminOnly, (req, res) => {
  const db  = load();
  const rec = (db.sales || []).find(s => String(s.id) === String(req.params.id));
  if (!rec) return res.status(404).json({ error: 'Олдсонгүй' });
  rec.archived        = true;
  rec.archived_by     = req.user.name;
  rec.archived_at     = new Date().toISOString();
  rec.archive_reason  = req.body.reason || '';
  save(db);
  res.json({ ok: true });
});

module.exports = router;
