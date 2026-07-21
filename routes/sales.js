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

// ── Migration v2: НӨАТ-тэй үнэ + Замын хавтан нэгтгэл (нэг удаа) ──
// Жорлон бүхээг → 1,760,000 (НӨАТ-тэй), Замын хавтан → 22,000 (НӨАТ-тэй).
// "Явган замын хавтан" зэрэг зам+хавтан барааг (бараа + инвентар) "Замын
// хавтан" болгож нэгтгэнэ.
function ensurePricesVat(db) {
  if (db.fix_prices_vat_v1) return;
  if (!db.products) db.products = [];
  if (!db.inventory) db.inventory = [];
  // "Замын хавтан", "Явган замын хавтан", "Явган хавтан" — бүгд нэг бараа
  const isPav = s => /(зам|явган)/i.test(s || '') && /хавтан/i.test(s || '');
  // Бүх зам/явган хавтан барааг нэгтгэх: эхнийг үлдээж, бусдыг идэвхгүй болгох
  const pavs = db.products.filter(p => isPav(p.name));
  if (pavs.length) {
    pavs[0].name = 'Замын хавтан'; pavs[0].price = 22000; pavs[0].active = true;
    for (let i = 1; i < pavs.length; i++) pavs[i].active = false;
  } else {
    db.products.push({ id: 'pavement', name: 'Замын хавтан', price: 22000, active: true });
  }
  // Жорлон(гийн) бүхээг — НӨАТ-тэй 1,760,000
  const cab = db.products.find(p => /бүхээг/i.test(p.name || ''));
  if (cab) { cab.price = 1760000; cab.active = true; }
  // Инвентар дахь зам/явган хавтан барааг "Замын хавтан" болгож нэгтгэх
  db.inventory.forEach(i => { if (isPav(i.name)) i.name = 'Замын хавтан'; });
  db.fix_prices_vat_v1 = true;
}

// ── Migration: "Замын хавтан" суурь үнийг 16,000 (НӨАТ-гүй) болгох (нэг удаа) ──
// price талбар нь НӨАТ-ТЭЙ үнээр хадгалагддаг (sales.html ÷1.1-ээр суурь үнэ
// гаргадаг). Тиймээс НӨАТ-гүй суурь 16,000 = НӨАТ-тэй 16,000 × 1.1 = 17,600.
function ensurePavementPrice16k(db) {
  if (db.fix_pavement_price_16k_v2) return;
  if (!db.products) db.products = [];
  const isPav = s => /(зам|явган)/i.test(s || '') && /хавтан/i.test(s || '');
  db.products.forEach(p => { if (isPav(p.name)) p.price = 17600; });
  db.fix_pavement_price_16k_v2 = true;
}

// ── Migration: "Саарал суултуур" бараа нэмэх (нэг удаа) ──
// Үнэ нь Жорлон бүхээгтэй адил — 1,760,000 (НӨАТ-тэй).
function ensureSaaralSuultuur(db) {
  if (db.fix_saaral_suultuur_v1) return;
  if (!db.products) db.products = [];
  const exists = db.products.find(p => /суултуур/i.test(p.name || ''));
  if (exists) { exists.name = 'Саарал суултуур'; exists.price = 1760000; exists.active = true; }
  else db.products.push({ id: 'saaral_suultuur', name: 'Саарал суултуур', price: 1760000, active: true });
  db.fix_saaral_suultuur_v1 = true;
}

// ── Migration: буруу борлуулалтыг склад хоорондын шилжүүлэг болгож засах ──
// 2026-06-20-нд Нярав-Менежер "Жорлонгийн бүхээг"-ийг Төв складаас БОРЛУУЛАЛТ
// (SALES_OUT → customer) болгож хассан нь үнэндээ склад хоорондын ШИЛЖҮҮЛЭГ
// байх ёстой байсан: 2ш → 7 буудал (warehouse-4), 1ш → ТЭЦ 4 (plastic-center).
// Засвар: тухайн SALES_OUT-уудыг TRANSFER (out) болгож, очих складад кредит
// (TRANSFER in) олгож, харгалзах борлуулалтын бичлэгийг архивлана. Төв складын
// хасалт хэвээр (бараа Төв складаас гарсан нь зөв) — зөвхөн очих тал нэмэгдэнэ.
function fixBuheegSaleToTransfer(db) {
  if (db.fix_buheeg_transfer_v1) return;
  if (!db.inventory) db.inventory = [];
  if (!db.inventory_log) db.inventory_log = [];

  // Дэлгэц дээрх before/after-аар нарийн тааруулна (буруу бичлэг хальтрахаас сэргийлж).
  const targets = [
    { qty: 2, before: 15, after: 13, dest: 'warehouse-4'   }, // 7 буудал склад
    { qty: 1, before: 16, after: 15, dest: 'plastic-center' }, // ТЭЦ 4 склад
  ];
  const now = new Date();

  for (const t of targets) {
    const log = db.inventory_log.find(l =>
      l.source === 'SALES_OUT' &&
      /бүхээг/i.test(l.item_name || '') &&
      (l.location_from || 'central') === 'central' &&
      l.date === '2026-06-20' &&
      (l.qty || 0) === t.qty &&
      (l.before_qty || 0) === t.before &&
      (l.after_qty || 0) === t.after);
    if (!log) continue;

    // 1) SALES_OUT-ийг TRANSFER (out) болгож, чиглэлийг очих склад болгох
    log.source = 'TRANSFER';
    log.location_to = t.dest;
    log.note = 'Склад шилжүүлэг (борлуулалт→шилжүүлэг залруулсан)';

    // 2) Очих складад барааг нэмэх (байхгүй бол үүсгэх) + TRANSFER (in) лог
    const name    = (log.item_name || 'Жорлонгийн бүхээг').trim();
    const srcItem = db.inventory.find(i => i.id === log.item_id);
    let dest = db.inventory.find(i =>
      (i.location || 'central') === t.dest &&
      (i.name || '').trim().toLowerCase() === name.toLowerCase());
    if (!dest) {
      const newId = Math.max(0, ...db.inventory.map(i => i.id || 0)) + 1;
      dest = {
        id: newId, code: log.item_code || (srcItem ? srcItem.code : '') || '',
        name, category: srcItem ? srcItem.category : 'finished', status: 'available',
        unit: log.unit || (srcItem ? srcItem.unit : 'ш') || 'ш', location: t.dest,
        qty: 0, threshold: 0,
        cost_per_unit: srcItem && srcItem.cost_per_unit != null ? srcItem.cost_per_unit : null,
        active: true, has_manual_adjustment: false,
        created_at: now.toISOString(), created_by: 'migration (борлуулалт→шилжүүлэг)',
      };
      db.inventory.push(dest);
    }
    const before = dest.qty || 0;
    dest.qty = before + t.qty;
    dest.active = true;
    dest.updated_at = now.toISOString();
    const inLogId = Math.max(0, ...db.inventory_log.map(x => x.id || 0)) + 1;
    db.inventory_log.push({
      id: inLogId, item_id: dest.id, item_code: dest.code, item_name: dest.name,
      type: 'in', source: 'TRANSFER', source_id: 'LOG-' + log.id, qty: t.qty,
      unit: dest.unit, location_from: 'central', location_to: t.dest,
      reason: null, note: 'Шилжүүлэг (борлуулалт залруулсан)', by: 'system', by_role: 'system',
      before_qty: before, after_qty: dest.qty,
      date: now.toISOString().slice(0, 10), time: now.toTimeString().slice(0, 8),
      created_at: now.toISOString(),
    });

    // 3) Харгалзах борлуулалтын бичлэгийг архивлах (орлогоос хасна)
    const sale = (db.sales || []).find(s => String(s.id) === String(log.source_id));
    if (sale && !sale.archived) {
      sale.archived       = true;
      sale.archived_by    = 'system';
      sale.archived_at    = now.toISOString();
      sale.archive_reason = 'Буруу борлуулалт — склад хоорондын шилжүүлэг байх ёстой байсан (migration)';
    }
  }

  db.fix_buheeg_transfer_v1 = true;
}

// ── Складаас бараа хасах нийтлэг логик (POST/PUT/DELETE дундын) ──
const SALE_LOC_MAP = {
  'Төв склад': 'central', 'Үйлдвэр': 'factory',
  'ТЭЦ 4 склад': 'plastic-center', '7 буудал склад': 'warehouse-4',
  'Склад 3': 'warehouse-5', 'Үзүүлэн': 'exhibition',
};
// "Явган замын хавтан"/"Явган хавтан" = "Замын хавтан"; "Жорлон(гийн) бүхээг" — нэг бараа
const isPav = s => /(зам|явган)/.test(s) && /хавтан/.test(s);
const isCab = s => /бүхээг/.test(s);
// "Саарал суултуур" = складын "Vacuum Toilet Household" (Public/VIP-тэй андуурахгүй)
const isSuult = s => /суултуур/.test(s) || (/vacuum/.test(s) && /household/.test(s));

// Бараа id → нэр
function prodNameById(db, id) {
  const p = (db.products || []).find(x => x.id === id);
  return p ? p.name : '';
}

// Салбар(склад) + барааны нэрэнд тохирох инвентар мөрийг олох.
// itemId өгсөн бол эхлээд түүгээр (хуучин хасалтыг яг буцаахад) хайна.
function findSaleInvItem(db, branch, productName, itemId) {
  if (!db.inventory) db.inventory = [];
  if (itemId != null) {
    const byId = db.inventory.find(i => String(i.id) === String(itemId));
    if (byId) return byId;
  }
  const locCode = SALE_LOC_MAP[branch];
  const pn = (productName || '').trim().toLowerCase();
  if (!locCode || !pn) return null;
  return db.inventory.find(i => {
    const inName = (i.name || '').trim().toLowerCase();
    return (i.location || 'central') === locCode &&
      (inName === pn || (isPav(inName) && isPav(pn)) || (isCab(inName) && isCab(pn)) ||
       (isSuult(inName) && isSuult(pn)));
  });
}

// Инвентар хөдөлгөөн бичих. deltaOut>0 = складаас хасах (out),
// deltaOut<0 = складад буцаах (in). qty/лог автоматаар бодогдоно.
function logInvMove(db, item, deltaOut, { source, source_id, note, user, branch }) {
  if (!item || !deltaOut) return;
  if (!db.inventory_log) db.inventory_log = [];
  const now    = new Date();
  const before = item.qty || 0;
  item.qty     = before - deltaOut;       // оверселл бол сөрөг болж анхааруулна
  item.updated_at = now.toISOString();
  const out    = deltaOut > 0;
  const locCode = SALE_LOC_MAP[branch] || item.location || 'central';
  const logId  = Math.max(0, ...db.inventory_log.map(l => l.id || 0)) + 1;
  db.inventory_log.push({
    id: logId, item_id: item.id, item_code: item.code, item_name: item.name,
    type: out ? 'out' : 'in', source, source_id, qty: Math.abs(deltaOut),
    unit: item.unit,
    location_from: out ? locCode : 'customer',
    location_to:   out ? 'customer' : locCode,
    reason: null, note,
    by: user.name, by_role: user.role,
    before_qty: before, after_qty: item.qty,
    date: now.toISOString().slice(0, 10), time: now.toTimeString().slice(0, 8), created_at: now.toISOString(),
  });
}

// ── БОРЛУУЛАЛТ ──
router.get('/sales', (req, res) => {
  // Revenue is owner/sales data — factory engineers don't see it.
  if (req.user.role === 'engineer') return res.status(403).json({ error: 'Зөвшөөрөл хүрэлцэхгүй' });
  const db = load();
  ensureSaleProducts(db); ensurePricesVat(db); ensurePavementPrice16k(db); ensureSaaralSuultuur(db); fixBuheegSaleToTransfer(db); save(db);
  // Эх гүйлгээ (ангилахаас өмнөх банкны хуулга) — source_tx_id-тэй бичлэгт хавсаргана.
  const txById = new Map((db.transactions || []).map(t => [String(t.id), t]));
  const withTx = s => {
    if (s.source_tx_id == null) return s;
    const t = txById.get(String(s.source_tx_id));
    if (!t) return s;
    return { ...s, source_tx: {
      id: t.id, date: t.date,
      memo: t.note || t.description || t.raw_memo || '',
      amount: t.amount || 0,
    } };
  };
  // Exclude archived records from normal view
  const sales = (db.sales || []).filter(s => !s.archived).map(withTx);
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
  const noVat = req.body.vat_mode === 'without' || req.body.no_vat === true;
  let unit_price = (!productDef || productDef.price === 0)
    ? parseInt(req.body.unit_price) || 0
    : productDef.price;
  // Бараа НӨАТ-тэй үнэтэй. НӨАТ-гүй борлуулбал суурь үнэ (÷1.1).
  if (noVat && productDef && productDef.price > 0) unit_price = Math.round(productDef.price / 1.1);

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
    bank_account_name: bank_account === 'cash' ? 'Бэлэн (касс)' : (bankDef ? bankDef.name : (bank_account || '')), // snapshot
    customer_name:     customer_name || '',
    customer_phone:    customer_phone || '',
    note:              note || '',
    source_tx_id:      source_tx_id || null,   // банкны хуулгын гүйлгээтэй холбоо
    vat_included:      !noVat,                 // НӨАТ-тэй эсэх
    status,
    archived:          false,
    created_by:        req.user.name,
    created_at:        now,
  };

  db.sales.push(record);

  // ── Сонгосон складаас барааг хасах (SALES_OUT хөдөлгөөн) ──
  // branch = склад нэр → байршлын код руу хөрвүүлж, тухайн складын
  // ижил нэртэй бараанаас зарагдсан тоог хасна.
  let inventory_deducted = false;
  const invItem = findSaleInvItem(db, branch, productDef ? productDef.name : '');
  if (invItem && qty > 0) {
    logInvMove(db, invItem, qty, {
      source: 'SALES_OUT', source_id: record.id,
      note: 'Борлуулалт (' + (record.note || '') + ')', user: req.user, branch,
    });
    record.inventory_item_id = invItem.id;
    inventory_deducted = true;
  }

  save(db);
  res.json({ id: record.id, inventory_deducted });
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
  } else if (['admin', 'manager'].includes(req.user.role)) {
    // Хуучин утгууд (инвентар тааруулахад хэрэгтэй)
    const oldBranch = order.branch, oldProduct = order.product;
    const oldQty    = parseInt(order.quantity) || 0;
    const oldItemId = order.inventory_item_id;

    const updated = { ...order, ...req.body };
    updated.status = (parseInt(updated.remaining_amount) || 0) === 0 ? 'completed' : 'receivable';

    // ── Складыг засвартай дагуулж тааруулах ──
    // Хуучин хасалтыг буцааж, шинэ салбар/бараа/тоогоор дахин хасна.
    const newQty = parseInt(updated.quantity) || 0;
    // 1) хуучин хасалтыг буцаах (хасагдсан байсан бол)
    const oldItem = findSaleInvItem(db, oldBranch, prodNameById(db, oldProduct), oldItemId);
    if (oldItem && oldQty > 0 && oldItemId != null) {
      logInvMove(db, oldItem, -oldQty, {
        source: 'SALES_EDIT', source_id: order.id,
        note: 'Засвар: хуучин хасалт буцаасан', user: req.user, branch: oldBranch,
      });
    }
    // 2) шинэ утгаар хасах
    const newItem = findSaleInvItem(db, updated.branch, prodNameById(db, updated.product));
    if (newItem && newQty > 0) {
      logInvMove(db, newItem, newQty, {
        source: 'SALES_OUT', source_id: order.id,
        note: 'Засвар: шинэ хасалт', user: req.user, branch: updated.branch,
      });
      updated.inventory_item_id = newItem.id;
    } else {
      delete updated.inventory_item_id;
    }

    db.sales[idx] = updated;
  }

  save(db);
  res.json({ ok: true, status: db.sales[idx].status, remaining_amount: db.sales[idx].remaining_amount });
});

// Soft delete — never permanently removes accounting records
router.delete('/sales/:id', (req, res) => {
  if (!['admin', 'manager'].includes(req.user.role)) return res.status(403).json({ error: 'Зөвшөөрөл хүрэлцэхгүй' });
  const db  = load();
  const rec = (db.sales || []).find(s => String(s.id) === String(req.params.id));
  if (!rec) return res.status(404).json({ error: 'Олдсонгүй' });
  rec.archived        = true;
  rec.archived_by     = req.user.name;
  rec.archived_at     = new Date().toISOString();
  rec.archive_reason  = req.body.reason || '';

  // Устгахад складаас хасагдсан барааг буцаах (хасагдсан байсан бол)
  const q = parseInt(rec.quantity) || 0;
  if (rec.inventory_item_id != null && q > 0) {
    const item = findSaleInvItem(db, rec.branch, prodNameById(db, rec.product), rec.inventory_item_id);
    if (item) {
      logInvMove(db, item, -q, {
        source: 'SALES_DELETE', source_id: rec.id,
        note: 'Борлуулалт устгасан — складад буцаасан', user: req.user, branch: rec.branch,
      });
      rec.inventory_returned = true;
    }
  }

  save(db);
  res.json({ ok: true });
});

module.exports = router;
