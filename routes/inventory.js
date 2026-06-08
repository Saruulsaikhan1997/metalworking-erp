const express = require('express');
const { load, save } = require('../database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// ════════════════════════════════════════════════════════════
// ── СКЛАД / INVENTORY ──
// CORE PRINCIPLE: Quantity cannot silently change.
// Authoritative truth = inventory_log (movement ledger).
// item.qty = cached value, ONLY updated through validated movements.
// ════════════════════════════════════════════════════════════

const MOVEMENT_TYPES = {
  IMPORT_IN:         { dir: 'in',  label: 'Импортоос ирсэн' },
  PRODUCTION_IN:     { dir: 'in',  label: 'Үйлдвэрлэлээс гарсан' },
  PRODUCTION_OUT:    { dir: 'out', label: 'Үйлдвэрлэлд орсон' },
  SALES_OUT:         { dir: 'out', label: 'Зарагдсан' },
  MANUAL_ADJUSTMENT: { dir: 'any', label: 'Гар тохируулга' },
  TRANSFER:          { dir: 'any', label: 'Шилжүүлэг' },
};

const CATEGORIES = ['raw', 'wip', 'finished'];
const STATUSES = ['available', 'reserved', 'damaged', 'in_transit'];

// ── Catalog seed (pre-seed 4 materials with qty=0) ──
const SEED_MATERIALS = [
  { code: 'TEMR-YONGDING', name: 'Yongding төмрийн материал',  category: 'raw',      unit: 'кг',   location: 'central' },
  { code: 'UPVC-PINGYUN',  name: 'Pingyun UPVC хавтан',         category: 'raw',      unit: 'м²',   location: 'central' },
  { code: 'HAALGA-CABIN',  name: 'Жорлон бүхээгний хаалга',     category: 'raw',      unit: 'ширхэг', location: 'central' },
  { code: 'HAVTAN-WALK',   name: 'Явган замын хавтан',          category: 'finished', unit: 'ширхэг', location: 'central' },
];

function ensureInventorySeed(db) {
  if (!db.inventory) db.inventory = [];
  if (db.inventory.length > 0) return;
  for (const seed of SEED_MATERIALS) {
    db.inventory.push({
      id:          Math.max(0, ...db.inventory.map(i => i.id || 0)) + 1,
      code:        seed.code,
      name:        seed.name,
      category:    seed.category,
      status:      'available',
      unit:        seed.unit,
      location:    seed.location,
      qty:         0,
      threshold:   0,
      cost_per_unit: null,
      active:      true,
      has_manual_adjustment: false,
      created_at:  new Date().toISOString(),
      created_by:  'system (seed)',
    });
  }
}

// ── Migration: Зарлагын баримт (БМ-3)-аас засвар/эд хогшил бараа нэмэх ──
// Нэг удаа ажиллана (import_receipt_items_v1 флагаар хамгаалсан). data.json-д
// шууд бичдэг тул API-ийн категори шалгалтыг тойрно (maintenance/assets).
const RECEIPT_ITEMS = [
  // 🔧 Засварын бараа (maintenance)
  { code: 'SILICONE-GUN',       name: 'Силиконы гар (буу)',         category: 'maintenance', unit: 'ш', qty: 1,  cost_per_unit: 7000 },
  { code: 'SILICONE-WHITE',     name: 'Силикон цагаан',             category: 'maintenance', unit: 'ш', qty: 1,  cost_per_unit: 12000 },
  { code: 'METAL-SCREW',        name: 'Төмрийн шуруп',              category: 'maintenance', unit: 'ш', qty: 1,  cost_per_unit: 5000 },
  { code: 'BLADE-YELLOW-BIG',   name: 'Төмрийн шар ир том',         category: 'maintenance', unit: 'ш', qty: 5,  cost_per_unit: 20000 },
  { code: 'CHARGER-DIFF-2-4AH', name: '2Ah-4Ah цэнэглэгч зөрүү',    category: 'maintenance', unit: 'ш', qty: 1,  cost_per_unit: 40000 },
  { code: 'BLADE-125MM',        name: 'Төмрийн ир 125mm',           category: 'maintenance', unit: 'ш', qty: 50, cost_per_unit: 2000 },
  // 🪑 Эд хогшил (assets)
  { code: 'RB-4-SET',           name: 'RB-4 set',                   category: 'assets', unit: 'ш', qty: 1, cost_per_unit: 2000000 },
  { code: 'WELDER-220-280',     name: 'Гагнуурын аппарат 220w-280w', category: 'assets', unit: 'ш', qty: 1, cost_per_unit: 450000 },
  { code: 'BATTERY-DIFF-40-80', name: '4.0Ah-8.0Ah зөрүү',          category: 'assets', unit: 'ш', qty: 1, cost_per_unit: 110000 },
  { code: 'CUTTER-9925',        name: 'Кэн таслагч 9925 (том)',     category: 'assets', unit: 'ш', qty: 1, cost_per_unit: 220000 },
  { code: 'CUTTER-SMALL',       name: 'Кэн жижиг таслагч',          category: 'assets', unit: 'ш', qty: 1, cost_per_unit: 85000 },
  { code: 'CUTTER-MORI',        name: 'Кэн мори таслагч',           category: 'assets', unit: 'ш', qty: 1, cost_per_unit: 320000 },
  { code: 'WRENCH-SET-142',     name: 'Түлхүүр комплект 142ш',      category: 'assets', unit: 'ш', qty: 1, cost_per_unit: 380000 },
];

function ensureReceiptItems(db) {
  if (db.import_receipt_items_v1) return false;
  if (!db.inventory) db.inventory = [];
  let added = 0;
  for (const it of RECEIPT_ITEMS) {
    if (db.inventory.some(x => x.code === it.code)) continue; // давхардлаас сэргийлэх
    const id = Math.max(0, ...db.inventory.map(i => i.id || 0)) + 1;
    db.inventory.push({
      id,
      code:          it.code,
      name:          it.name,
      category:      it.category,
      status:        'available',
      unit:          it.unit,
      location:      'central',
      qty:           it.qty,
      threshold:     0,
      cost_per_unit: it.cost_per_unit,
      total_value:   it.qty * it.cost_per_unit,
      active:        true,
      has_manual_adjustment: false,
      created_at:    new Date().toISOString(),
      created_by:    'migration (Зарлагын баримт БМ-3)',
    });
    added++;
  }
  db.import_receipt_items_v1 = true;
  return added > 0;
}

// ── List items (enriched with received-lot breakdown for the warehouse view) ──
// Read-only, additive enrichment: each item gets a `lots` array (profile name +
// quantity in the item's OWN unit). NO cost/valuation fields are exposed here —
// inventory valuation logic is untouched. Spread (`...item`) avoids mutating the
// stored objects before save().
const _normUnit = (u) => {
  const s = String(u || '').toLowerCase().trim();
  if (['кг', 'kg', 'kgs'].includes(s)) return 'kg';
  if (['т', 'тн', 'тонн', 'ton', 'tonne', 'tons'].includes(s)) return 'ton';
  if (['ш', 'ширхэг', 'piece', 'pcs', 'pc'].includes(s)) return 'piece';
  if (['м', 'm', 'meter', 'metre'].includes(s)) return 'meter';
  if (['м²', 'm2', 'sqm'].includes(s)) return 'sqm';
  return s;
};

router.get('/inventory', (req, res) => {
  const db = load();
  ensureInventorySeed(db);
  ensureReceiptItems(db);
  save(db);

  // Sub-breakdown = received, non-sample import lots, grouped by inventory item.
  const recvLots = (db.import_lots || []).filter(
    l => !l.is_sample && l.warehouse_status === 'received' && l.inventory_item_id != null
  );
  const enriched = db.inventory.map(item => {
    const target = _normUnit(item.unit);
    const lots = recvLots
      .filter(l => l.inventory_item_id === item.id)
      .map(l => {
        const cands = [l.units?.primary, l.units?.secondary].filter(c => c && c.qty != null);
        const pick = cands.find(c => _normUnit(c.unit) === target);
        let qty, unit;
        if (pick) { qty = pick.qty; unit = item.unit || pick.unit; }
        else if (l.received_qty != null) { qty = l.received_qty; unit = l.received_unit || item.unit; }
        else if (cands.length) { qty = cands[cands.length - 1].qty; unit = cands[cands.length - 1].unit; }
        else { qty = 0; unit = item.unit; }
        return {
          name: l.product?.name || l.product_code || '—',
          spec: l.product?.spec || '',
          qty,
          unit,
          status: l.warehouse_status,
        };
      });
    return { ...item, lots };
  });

  res.json(enriched);
});

// ── Create item (catalog only — qty always starts at 0) ──
router.post('/inventory/item', (req, res) => {
  if (!['admin','warehouse','manager'].includes(req.user.role)) return res.status(403).json({ error: 'Зөвшөөрөл хүрэлцэхгүй' });
  const db = load();
  if (!db.inventory) db.inventory = [];

  const { code, name, category, unit, location, threshold, cost_per_unit } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Нэр оруулна уу' });
  if (category && !CATEGORIES.includes(category)) return res.status(400).json({ error: 'Категори буруу (raw / wip / finished)' });

  const id = Math.max(0, ...db.inventory.map(i => i.id || 0)) + 1;
  db.inventory.push({
    id,
    code:        (code || '').trim(),
    name:        name.trim(),
    category:    category || 'raw',
    status:      'available',
    unit:        unit || 'ширхэг',
    location:    location || 'central',
    qty:         0,                          // ALWAYS 0 at creation
    threshold:   parseInt(threshold) || 0,
    cost_per_unit: cost_per_unit != null ? parseFloat(cost_per_unit) : null,
    active:      true,
    has_manual_adjustment: false,
    created_at:  new Date().toISOString(),
    created_by:  req.user.name,
  });
  save(db);
  res.json({ id });
});

// ── Update item metadata — qty is FORBIDDEN here ──
router.put('/inventory/item/:id', (req, res) => {
  if (!['admin','warehouse','manager'].includes(req.user.role)) return res.status(403).json({ error: 'Зөвшөөрөл хүрэлцэхгүй' });
  if ('qty' in req.body) {
    return res.status(403).json({ error: 'qty талбар шууд өөрчилж болохгүй. inventory_log ашиглана уу.' });
  }
  const db = load();
  const item = (db.inventory || []).find(i => i.id === parseInt(req.params.id));
  if (!item) return res.status(404).json({ error: 'Бараа олдсонгүй' });

  const ALLOWED = ['code','name','category','status','unit','location','threshold','cost_per_unit','active'];
  for (const k of ALLOWED) {
    if (k in req.body) {
      if (k === 'category' && req.body[k] && !CATEGORIES.includes(req.body[k])) return res.status(400).json({ error: 'Категори буруу' });
      if (k === 'status'   && req.body[k] && !STATUSES.includes(req.body[k]))   return res.status(400).json({ error: 'Төлөв буруу' });
      item[k] = req.body[k];
    }
  }
  item.updated_at = new Date().toISOString();
  item.updated_by = req.user.name;
  save(db);
  res.json({ ok: true });
});

// ── Get movement log ──
router.get('/inventory/log', (req, res) => {
  const db = load();
  let logs = db.inventory_log || [];
  if (req.query.item_id) logs = logs.filter(l => l.item_id === parseInt(req.query.item_id));
  res.json(logs);
});

// ── Record movement (the ONLY way to change qty) ──
router.post('/inventory/log', (req, res) => {
  if (!['admin','warehouse','manager'].includes(req.user.role)) return res.status(403).json({ error: 'Зөвшөөрөл хүрэлцэхгүй' });
  const db = load();
  if (!db.inventory) db.inventory = [];
  if (!db.inventory_log) db.inventory_log = [];

  const { item_id, source, qty, source_id, location_from, location_to, reason, note, unit_cost } = req.body;

  // Validate source
  if (!source || !MOVEMENT_TYPES[source]) {
    return res.status(400).json({ error: 'source талбар буруу. Зөвшөөрөгдсөн: ' + Object.keys(MOVEMENT_TYPES).join(', ') });
  }

  // Validate item
  const item = db.inventory.find(i => i.id === parseInt(item_id));
  if (!item) return res.status(404).json({ error: 'Бараа олдсонгүй' });

  // Validate qty
  const q = parseInt(qty);
  if (!q || q <= 0) return res.status(400).json({ error: 'Тоо хэмжээ оруулна уу (> 0)' });

  // Determine direction
  let dir = MOVEMENT_TYPES[source].dir;
  if (dir === 'any') {
    // MANUAL_ADJUSTMENT and TRANSFER need explicit direction
    if (!['in','out'].includes(req.body.direction)) {
      return res.status(400).json({ error: 'direction талбар "in" эсвэл "out" байх ёстой' });
    }
    dir = req.body.direction;
  }

  // MANUAL_ADJUSTMENT special rules
  if (source === 'MANUAL_ADJUSTMENT') {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'MANUAL_ADJUSTMENT зөвхөн admin' });
    if (!reason || !reason.trim()) return res.status(400).json({ error: 'MANUAL_ADJUSTMENT хийхэд шалтгаан (reason) заавал' });
  }

  // Stock availability check for OUT movements
  if (dir === 'out' && item.qty < q) {
    return res.status(400).json({ error: `Нөөц хүрэлцэхгүй. Одоогийн нөөц: ${item.qty} ${item.unit || ''}` });
  }

  // Apply movement to cached qty (ledger is authoritative; this is just cache)
  const beforeQty = item.qty;
  item.qty = dir === 'in' ? item.qty + q : item.qty - q;
  if (source === 'MANUAL_ADJUSTMENT') item.has_manual_adjustment = true;
  item.updated_at = new Date().toISOString();

  // Record movement in ledger
  const now = new Date();
  const logId = Math.max(0, ...db.inventory_log.map(l => l.id || 0)) + 1;
  db.inventory_log.push({
    id:           logId,
    item_id:      item.id,
    item_code:    item.code,
    item_name:    item.name,
    type:         dir,                                 // 'in' | 'out'
    source,                                            // movement source enum
    source_id:    source_id || null,                   // link to import/production/sale id
    qty:          q,
    unit:         item.unit,
    unit_cost:    unit_cost != null ? parseFloat(unit_cost) : null,
    location_from: location_from || null,
    location_to:   location_to   || null,
    reason:       reason || null,                      // required for MANUAL_ADJUSTMENT
    note:         note || '',
    by:           req.user.name,
    by_role:      req.user.role,
    before_qty:   beforeQty,
    after_qty:    item.qty,
    date:         now.toISOString().slice(0,10),
    time:         now.toTimeString().slice(0,8),
    created_at:   now.toISOString(),
  });
  save(db);
  res.json({ ok: true, new_qty: item.qty, log_id: logId });
});

// ── Reconcile: item.qty vs ledger sum ──
router.get('/inventory/reconcile', (req, res) => {
  if (!['admin','warehouse','manager'].includes(req.user.role)) return res.status(403).json({ error: 'Зөвшөөрөл хүрэлцэхгүй' });
  const db = load();
  const items = db.inventory || [];
  const logs  = db.inventory_log || [];

  const results = items.map(item => {
    const itemLogs = logs.filter(l => l.item_id === item.id);
    const ledgerQty = itemLogs.reduce((s, l) => s + (l.type === 'in' ? l.qty : -l.qty), 0);
    const diff = item.qty - ledgerQty;
    return {
      id:          item.id,
      code:        item.code,
      name:        item.name,
      cached_qty:  item.qty,
      ledger_qty:  ledgerQty,
      diff,
      ok:          diff === 0,
      log_count:   itemLogs.length,
      has_manual_adjustment: !!item.has_manual_adjustment,
    };
  });

  const all_ok = results.every(r => r.ok);
  res.json({ all_ok, total_items: items.length, mismatches: results.filter(r => !r.ok), items: results });
});

// ── Movement types & enums (for UI) ──
router.get('/inventory/movement-types', (req, res) => {
  res.json({ types: MOVEMENT_TYPES, categories: CATEGORIES, statuses: STATUSES });
});

// ── ҮЙЛДВЭРЛЭЛ ──
router.get('/production', (req, res) => {
  const db = load(); res.json(db.production || []);
});

router.post('/production', (req, res) => {
  if (!['admin','warehouse','manager'].includes(req.user.role)) return res.status(403).json({ error: 'Зөвшөөрөл хүрэлцэхгүй' });
  const db = load();
  if (!db.production) db.production = [];
  const id = Math.max(0, ...db.production.map(p => p.id || 0)) + 1;
  db.production.push({ id, ...req.body, by: req.user.name, created_at: new Date().toISOString().slice(0,10) });
  save(db); res.json({ id });
});

module.exports = router;
