require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
// Prevent stale HTML cache on mobile browsers (Safari aggressive caching)
app.use((req, res, next) => {
  if (req.url.endsWith('.html') || req.url.endsWith('.js') || req.url === '/' || !req.url.includes('.')) {
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
app.use('/api/import', require('./routes/import'));
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
app.get('/imports/cost-analysis', (req, res) => res.sendFile(path.join(__dirname, 'public', 'import-cost-analysis.html')));
app.get('/imports/final-cost', (req, res) => res.sendFile(path.join(__dirname, 'public', 'import-final-cost.html')));
app.get('/imports/shipment/:code', (req, res) => res.sendFile(path.join(__dirname, 'public', 'import-shipment.html')));
app.get('/imports/new',            (req, res) => res.sendFile(path.join(__dirname, 'public', 'import-new.html')));
app.get('/income',     (req, res) => res.sendFile(path.join(__dirname, 'public', 'income.html')));
app.get('/expense',    (req, res) => res.sendFile(path.join(__dirname, 'public', 'expense.html')));
app.get('/loans',          (req, res) => res.sendFile(path.join(__dirname, 'public', 'loans.html')));
app.get('/finance-import', (req, res) => res.sendFile(path.join(__dirname, 'public', 'finance-import.html')));
app.get('/codes',          (req, res) => res.sendFile(path.join(__dirname, 'public', 'codes.html')));
app.get('/review',         (req, res) => res.sendFile(path.join(__dirname, 'public', 'review.html')));
app.get('/finance-admin',   (req, res) => res.sendFile(path.join(__dirname, 'public', 'finance-admin.html')));
app.get('/investment',      (req, res) => res.sendFile(path.join(__dirname, 'public', 'investment.html')));
app.get('/inventory-admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'inventory-admin.html')));

// ── Startup migration: fix data issues ──
(function runMigrations() {
  const { load, save } = require('./database');
  const crypto = require('crypto');
  const db = load();
  const txs = db.transactions || [];
  let changed = 0;

  // 1. Convert 12-hour AM/PM times to 24-hour
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

  // 2. Fix known direction issues
  for (const t of txs) {
    if (t.id === '7fd71e81536ff61d' && t.direction === 'credit') { t.direction = 'debit'; changed++; }
    if (t.id === 'c505f6c2aaf151a4' && !t.archived) {
      t.archived = true; t.archived_at = new Date().toISOString();
      t.archived_by = 'system-migration'; t.archive_reason = 'Phantom entry'; changed++;
    }
    if (t.id === 'c3d904c0a0c4c9e0' && t.direction === 'credit') { t.direction = 'debit'; changed++; }
  }

  // 3. Rehash txIds and remove duplicates caused by time format change
  function computeId(t) {
    const key = `${t.account}_${t.date}_${t.time}_${t.direction}_${t.amount}_${t.balance_after}`;
    return crypto.createHash('md5').update(key).digest('hex').slice(0, 16);
  }
  // Rehash all non-archived transactions
  for (const t of txs) {
    if (t.archived) continue;
    const newId = computeId(t);
    if (newId !== t.id) { t.id = newId; changed++; }
  }
  // Now find and archive duplicates (same id = same data)
  const seen = new Set();
  for (const t of txs) {
    if (t.archived) continue;
    if (seen.has(t.id)) {
      t.archived = true; t.archived_at = new Date().toISOString();
      t.archived_by = 'system-dedup'; t.archive_reason = 'Duplicate after txId rehash';
      changed++;
    } else {
      seen.add(t.id);
    }
  }

  if (changed > 0) {
    save(db);
    const active = txs.filter(t => !t.archived).length;
    console.log(`Migration: ${changed} fixes applied. ${active} active transactions.`);
  }

  // ── Import Module Migration ──
  if (!db.import_product_codes) {
    console.log('Import migration: starting...');

    // 1. Product Codes
    db.import_product_codes = [
      { code: 'STEEL', name: 'Төмрийн материал', category: 'raw_material', primary_unit: 'ton', secondary_unit: 'kg', conversion: 1000, inventory_unit: 'kg', cost_method: 'weighted_average', business_unit: 'meter', conversion_factor: 3.02, conversion_type: 'weight_per_length' },
      { code: 'UPVC', name: 'UPVC хавтан', category: 'raw_material', primary_unit: 'm2', secondary_unit: null, conversion: null, inventory_unit: 'm2', cost_method: 'lot_based', business_unit: 'm2', conversion_factor: 1, conversion_type: 'identity' },
      { code: 'DOOR', name: 'Кабины хаалга', category: 'component', primary_unit: 'piece', secondary_unit: null, conversion: null, inventory_unit: 'piece', cost_method: 'lot_based', business_unit: 'piece', conversion_factor: 1, conversion_type: 'identity' },
      { code: 'PAVING', name: 'Явган замын хавтан', category: 'finished_good', primary_unit: 'piece', secondary_unit: 'm2', conversion: null, inventory_unit: 'piece', cost_method: 'lot_based', business_unit: 'piece', conversion_factor: 1, conversion_type: 'identity' },
      { code: 'PNEUM', name: 'Пневматик суултуур', category: 'component', primary_unit: 'set', secondary_unit: 'piece', conversion: 8, inventory_unit: 'piece', cost_method: 'lot_based', business_unit: 'piece', conversion_factor: 1, conversion_type: 'identity' }
    ];

    // 2. Projects (one per supplier relationship)
    db.import_projects = [
      {
        id: 'proj_001', code: 'PROJ-YONGDING', name: 'Yongding — Төмрийн материал',
        supplier: { name: 'Shandong Yongding Metal Technology Co., Ltd.', country: 'CN', contact: null },
        type: 'official', currency: 'USD', status: 'active',
        created_at: '2026-05-08T00:00:00Z'
      },
      {
        id: 'proj_002', code: 'PROJ-PINGYUN', name: 'Pingyun — UPVC хавтан',
        supplier: { name: 'Pingyun Roof Co., Ltd.', country: 'CN', contact: null },
        type: 'official', currency: 'CNY', status: 'active',
        created_at: '2026-05-13T00:00:00Z'
      },
      {
        id: 'proj_003', code: 'PROJ-DOOR', name: 'Хаалганы нийлүүлэгч — Кабины хаалга',
        supplier: { name: 'Хаалганы нийлүүлэгч', country: 'CN', contact: null },
        type: 'agent', currency: 'CNY', status: 'active',
        created_at: '2026-05-18T00:00:00Z'
      },
      {
        id: 'proj_004', code: 'PROJ-LIYU', name: 'Liyu — Явган замын хавтан',
        supplier: { name: 'Liyu', country: 'CN', contact: null },
        type: 'agent', currency: 'CNY', status: 'active',
        created_at: '2026-05-20T00:00:00Z'
      },
      {
        id: 'proj_005', code: 'PROJ-PNEUM', name: 'Пневматик нийлүүлэгч',
        supplier: { name: 'Пневматик нийлүүлэгч', country: 'CN', contact: null },
        type: 'agent', currency: 'CNY', status: 'active',
        created_at: '2026-05-22T00:00:00Z'
      }
    ];

    // 3. Shipments
    db.import_shipments = [
      {
        id: 'ship_001', code: 'STEEL-2026-001', project_id: 'proj_001',
        description: 'Yongding 8т — хоолой + ган хавтан',
        status: 'delivered', route: 'factory_cn → erenhot → ub',
        shipped_at: '2026-05-20', delivered_at: '2026-05-27',
        freight_method: 'truck', total_weight_kg: 8000,
        notes: 'Пластик Центр шинэ үйлдвэрийн талбайд буулгасан',
        activity_log: [
          { date: '2026-05-14', event: '30% урьдчилгаа төлсөн ($1,113)', by: 'system' },
          { date: '2026-05-18', event: '70% үлдэгдэл төлсөн ($3,028.20)', by: 'system' },
          { date: '2026-05-20', event: 'Эрээнд ирсэн', by: 'system' },
          { date: '2026-05-23', event: 'Эрээн→УБ ачилт эхэлсэн', by: 'system' },
          { date: '2026-05-27', event: 'УБ хүргэгдсэн, үйлдвэрийн талбайд буулгасан', by: 'system' },
          { date: '2026-06-01', event: 'Агуулахын бүртгэл хүлээгдэж байна', by: 'system' }
        ],
        created_at: '2026-05-14T00:00:00Z', updated_at: '2026-06-01T00:00:00Z'
      },
      {
        id: 'ship_002', code: 'UPVC-2026-001', project_id: 'proj_002',
        description: 'Pingyun UPVC 2,441м²',
        status: 'in_transit_cn', route: 'factory_cn → erenhot → ub',
        shipped_at: '2026-06-01', delivered_at: null,
        freight_method: 'truck', total_weight_kg: null,
        notes: 'Эрээн рүү тээвэрлэгдэж байна',
        activity_log: [
          { date: '2026-05-14', event: '50% урьдчилгаа төлсөн (¥27,817)', by: 'system' },
          { date: '2026-05-30', event: 'Үйлдвэрлэл дуусав', by: 'system' },
          { date: '2026-05-31', event: '50% үлдэгдэл төлсөн (¥27,817). Бүрэн төлсөн.', by: 'system' },
          { date: '2026-05-31', event: 'Хятад дотоод тээвэр төлсөн', by: 'system' },
          { date: '2026-06-01', event: 'Эрээн рүү тээвэрлэгдэж байна', by: 'system' }
        ],
        created_at: '2026-05-14T00:00:00Z', updated_at: '2026-06-01T00:00:00Z'
      },
      {
        id: 'ship_003', code: 'DOOR-2026-001-S', project_id: 'proj_003',
        description: 'Загварын хаалга 5ш (sample)',
        status: 'in_transit_cn', route: 'factory_cn → erenhot_cargo → ub',
        shipped_at: '2026-05-23', delivered_at: null,
        freight_method: 'cargo', total_weight_kg: null,
        notes: 'Явган замын хавтангийн загвартай хамт карго-оор',
        activity_log: [
          { date: '2026-05-23', event: '5ш загвар карго-оор Эрээн рүү ачигдсан', by: 'system' },
          { date: '2026-06-01', event: 'Замд яваа, ETA 06-02', by: 'system' }
        ],
        created_at: '2026-05-23T00:00:00Z', updated_at: '2026-06-01T00:00:00Z'
      },
      {
        id: 'ship_004', code: 'DOOR-2026-001', project_id: 'proj_003',
        description: 'Кабины хаалга 100ш (үндсэн)',
        status: 'preparing', route: 'factory_cn → erenhot → ub',
        shipped_at: null, delivered_at: null,
        freight_method: 'truck', total_weight_kg: null,
        notes: 'Үйлдвэрлэл явагдаж байна',
        activity_log: [
          { date: '2026-05-18', event: '50% урьдчилгаа төлсөн (¥19,500)', by: 'system' },
          { date: '2026-05-23', event: '5ш загвар тусад нь ачигдсан', by: 'system' },
          { date: '2026-06-01', event: 'Үйлдвэрлэл үргэлжилж байна (100ш)', by: 'system' }
        ],
        created_at: '2026-05-18T00:00:00Z', updated_at: '2026-06-01T00:00:00Z'
      },
      {
        id: 'ship_005', code: 'PAVING-2026-001-S', project_id: 'proj_004',
        description: 'Загвар хавтан 40ш (sample)',
        status: 'in_transit_cn', route: 'factory_cn → erenhot_cargo → ub',
        shipped_at: '2026-05-23', delivered_at: null,
        freight_method: 'cargo', total_weight_kg: null,
        notes: 'Хаалганы загвартай хамт',
        activity_log: [
          { date: '2026-05-23', event: '40ш загвар карго-оор ачигдсан (хаалгатай хамт)', by: 'system' },
          { date: '2026-06-01', event: 'Замд яваа, ETA 06-02', by: 'system' }
        ],
        created_at: '2026-05-23T00:00:00Z', updated_at: '2026-06-01T00:00:00Z'
      },
      {
        id: 'ship_006', code: 'PAVING-2026-001', project_id: 'proj_004',
        description: 'Явган замын хавтан 7,300ш (бүтэн машин)',
        status: 'preparing', route: 'factory_cn → erenhot → ub',
        shipped_at: null, delivered_at: null,
        freight_method: 'truck', total_weight_kg: null,
        notes: 'Proforma Invoice хүлээгдэж байна',
        activity_log: [
          { date: '2026-06-01', event: 'Эхний бүтэн машин (7,300ш) үйлдвэрлэгдэж байна', by: 'system' },
          { date: '2026-06-01', event: 'Proforma Invoice 06-03 ~ 06-05-д ирнэ', by: 'system' }
        ],
        created_at: '2026-05-20T00:00:00Z', updated_at: '2026-06-01T00:00:00Z'
      },
      {
        id: 'ship_007', code: 'PNEUM-2026-001', project_id: 'proj_005',
        description: 'Пневматик суултуур (2 толгой + 2 суурь + 4 соруулагч)',
        status: 'in_transit_cn', route: 'factory_cn → erenhot_post → ub',
        shipped_at: '2026-05-22', delivered_at: null,
        freight_method: 'post', total_weight_kg: null,
        notes: 'Шуудангаар Эрээн рүү илгээсэн',
        activity_log: [
          { date: '2026-05-22', event: 'Бүрэн төлсөн (4,770,000₮)', by: 'system' },
          { date: '2026-05-22', event: 'Шуудангаар илгээгдсэн', by: 'system' }
        ],
        created_at: '2026-05-22T00:00:00Z', updated_at: '2026-06-01T00:00:00Z'
      }
    ];

    // 4. Lots
    db.import_lots = [
      // Yongding — 4 line items as lots
      {
        id: 'lot_001', project_id: 'proj_001', shipment_id: 'ship_001', shipment_code: 'STEEL-2026-001',
        product_code: 'STEEL',
        product: { name: '80×80×1.2×12000 хоолой', hs_code: '', spec: '80×80×1.2mm, 12m', category: 'raw_material' },
        units: { primary: { unit: 'ton', qty: 2.28, landed_cost: 0 }, secondary: { unit: 'kg', qty: 2280, conversion: 1000, landed_cost: 0 } },
        unit_price: 472, currency: 'USD', exchange_rate: 3577, product_cost: 1076.16, product_cost_mnt: 3849424,
        allocations: [], total_allocated_mnt: 0, total_cost_mnt: 0,
        is_sample: false, sample_purpose: null, sample_parent_lot: null,
        inventory_item_id: 1, warehouse_status: 'not_received',
        received_qty: null, received_at: null, received_by: null,
        quality_check: null, quality_notes: null,
        created_at: '2026-05-14T00:00:00Z'
      },
      {
        id: 'lot_002', project_id: 'proj_001', shipment_id: 'ship_001', shipment_code: 'STEEL-2026-001',
        product_code: 'STEEL',
        product: { name: '40×40×1×12000 хоолой', hs_code: '', spec: '40×40×1mm, 12m', category: 'raw_material' },
        units: { primary: { unit: 'ton', qty: 1.58, landed_cost: 0 }, secondary: { unit: 'kg', qty: 1580, conversion: 1000, landed_cost: 0 } },
        unit_price: 442, currency: 'USD', exchange_rate: 3577, product_cost: 698.36, product_cost_mnt: 2498232,
        allocations: [], total_allocated_mnt: 0, total_cost_mnt: 0,
        is_sample: false, sample_purpose: null, sample_parent_lot: null,
        inventory_item_id: 1, warehouse_status: 'not_received',
        received_qty: null, received_at: null, received_by: null,
        quality_check: null, quality_notes: null,
        created_at: '2026-05-14T00:00:00Z'
      },
      {
        id: 'lot_003', project_id: 'proj_001', shipment_id: 'ship_001', shipment_code: 'STEEL-2026-001',
        product_code: 'STEEL',
        product: { name: '40×20×1×12000 хоолой', hs_code: '', spec: '40×20×1mm, 12m', category: 'raw_material' },
        units: { primary: { unit: 'ton', qty: 3.68, landed_cost: 0 }, secondary: { unit: 'kg', qty: 3680, conversion: 1000, landed_cost: 0 } },
        unit_price: 455, currency: 'USD', exchange_rate: 3577, product_cost: 1674.40, product_cost_mnt: 5990149,
        allocations: [], total_allocated_mnt: 0, total_cost_mnt: 0,
        is_sample: false, sample_purpose: null, sample_parent_lot: null,
        inventory_item_id: 1, warehouse_status: 'not_received',
        received_qty: null, received_at: null, received_by: null,
        quality_check: null, quality_notes: null,
        created_at: '2026-05-14T00:00:00Z'
      },
      {
        id: 'lot_004', project_id: 'proj_001', shipment_id: 'ship_001', shipment_code: 'STEEL-2026-001',
        product_code: 'STEEL',
        product: { name: '25×2×6000 ган хавтан', hs_code: '', spec: '25×2mm, 6m', category: 'raw_material' },
        units: { primary: { unit: 'ton', qty: 0.46, landed_cost: 0 }, secondary: { unit: 'kg', qty: 460, conversion: 1000, landed_cost: 0 } },
        unit_price: 418, currency: 'USD', exchange_rate: 3577, product_cost: 192.28, product_cost_mnt: 687978,
        allocations: [], total_allocated_mnt: 0, total_cost_mnt: 0,
        is_sample: false, sample_purpose: null, sample_parent_lot: null,
        inventory_item_id: 1, warehouse_status: 'not_received',
        received_qty: null, received_at: null, received_by: null,
        quality_check: null, quality_notes: null,
        created_at: '2026-05-14T00:00:00Z'
      },
      // Pingyun — 1 lot
      {
        id: 'lot_005', project_id: 'proj_002', shipment_id: 'ship_002', shipment_code: 'UPVC-2026-001',
        product_code: 'UPVC',
        product: { name: '3 давхар UPVC хуванцар хавтан', hs_code: '39259000', spec: '3-layer UPVC', category: 'raw_material' },
        units: { primary: { unit: 'm2', qty: 2441, landed_cost: 0 }, secondary: null },
        unit_price: 22.79, currency: 'CNY', exchange_rate: 530, product_cost: 55634.40, product_cost_mnt: 29486232,
        allocations: [], total_allocated_mnt: 0, total_cost_mnt: 0,
        is_sample: false, sample_purpose: null, sample_parent_lot: null,
        inventory_item_id: 2, warehouse_status: 'not_received',
        received_qty: null, received_at: null, received_by: null,
        quality_check: null, quality_notes: null,
        created_at: '2026-05-14T00:00:00Z'
      },
      // Door sample — 5ш
      {
        id: 'lot_006', project_id: 'proj_003', shipment_id: 'ship_003', shipment_code: 'DOOR-2026-001-S',
        product_code: 'DOOR',
        product: { name: 'Кабины хаалга (загвар)', hs_code: '', spec: 'Portable cabin door', category: 'component' },
        units: { primary: { unit: 'piece', qty: 5, landed_cost: 0 }, secondary: null },
        unit_price: 390, currency: 'CNY', exchange_rate: 530, product_cost: 1950, product_cost_mnt: 1033500,
        allocations: [], total_allocated_mnt: 0, total_cost_mnt: 0,
        is_sample: true, sample_purpose: 'Загвар бүтээгдэхүүн хийх', sample_parent_lot: null,
        inventory_item_id: null, warehouse_status: 'not_received',
        received_qty: null, received_at: null, received_by: null,
        quality_check: null, quality_notes: null,
        created_at: '2026-05-23T00:00:00Z'
      },
      // Door main — 100ш
      {
        id: 'lot_007', project_id: 'proj_003', shipment_id: 'ship_004', shipment_code: 'DOOR-2026-001',
        product_code: 'DOOR',
        product: { name: 'Кабины хаалга (100ш)', hs_code: '', spec: 'Portable cabin door', category: 'component' },
        units: { primary: { unit: 'piece', qty: 100, landed_cost: 0 }, secondary: null },
        unit_price: 390, currency: 'CNY', exchange_rate: 530, product_cost: 39000, product_cost_mnt: 20670000,
        allocations: [], total_allocated_mnt: 0, total_cost_mnt: 0,
        is_sample: false, sample_purpose: null, sample_parent_lot: null,
        inventory_item_id: 3, warehouse_status: 'not_received',
        received_qty: null, received_at: null, received_by: null,
        quality_check: null, quality_notes: null,
        created_at: '2026-05-18T00:00:00Z'
      },
      // Paving sample — 40ш
      {
        id: 'lot_008', project_id: 'proj_004', shipment_id: 'ship_005', shipment_code: 'PAVING-2026-001-S',
        product_code: 'PAVING',
        product: { name: 'Явган замын хавтан (загвар)', hs_code: '', spec: 'Sidewalk paving block', category: 'finished_good' },
        units: { primary: { unit: 'piece', qty: 40, landed_cost: 0 }, secondary: { unit: 'm2', qty: null, conversion: null, landed_cost: 0 } },
        unit_price: 0, currency: 'CNY', exchange_rate: 530, product_cost: 0, product_cost_mnt: 0,
        allocations: [], total_allocated_mnt: 0, total_cost_mnt: 0,
        is_sample: true, sample_purpose: 'Загвар бүтээгдэхүүн хийх', sample_parent_lot: null,
        inventory_item_id: null, warehouse_status: 'not_received',
        received_qty: null, received_at: null, received_by: null,
        quality_check: null, quality_notes: null,
        created_at: '2026-05-23T00:00:00Z'
      },
      // Pneumatic — 1 set
      {
        id: 'lot_009', project_id: 'proj_005', shipment_id: 'ship_007', shipment_code: 'PNEUM-2026-001',
        product_code: 'PNEUM',
        product: { name: 'Пневматик суултуурын систем', hs_code: '', spec: '2 толгой + 2 суурь + 4 соруулагч', category: 'component' },
        units: { primary: { unit: 'set', qty: 1, landed_cost: 0 }, secondary: { unit: 'piece', qty: 8, conversion: 8, landed_cost: 0 } },
        unit_price: 9000, currency: 'CNY', exchange_rate: 530, product_cost: 9000, product_cost_mnt: 4770000,
        allocations: [], total_allocated_mnt: 0, total_cost_mnt: 0,
        is_sample: false, sample_purpose: null, sample_parent_lot: null,
        inventory_item_id: 5, warehouse_status: 'not_received',
        received_qty: null, received_at: null, received_by: null,
        quality_check: null, quality_notes: null,
        created_at: '2026-05-22T00:00:00Z'
      }
    ];

    // 5. Cost Ledger — known payments linked to bank transactions
    db.import_cost_ledger = [
      // Yongding 30% advance
      {
        id: 'cost_001', project_id: 'proj_001', shipment_id: 'ship_001', shipment_code: 'STEEL-2026-001', lot_id: null,
        type: 'product', description: 'Yongding 30% урьдчилгаа ($1,113)',
        amount: 1113, currency: 'USD', exchange_rate: 3577, amount_mnt: 3981201,
        payment_method: 'bank_transfer', payment_account: 'tdb', payment_reference: 'YD002-20260508-01',
        transaction_id: 'ef4929b916c0130a', paid: true, paid_at: '2026-05-14', due_date: null,
        allocation_method: 'by_weight', allocation_locked: false,
        created_at: '2026-05-14T00:00:00Z', created_by: 'migration', modified_at: null, modified_by: null, modification_log: []
      },
      // Yongding 70% balance
      {
        id: 'cost_002', project_id: 'proj_001', shipment_id: 'ship_001', shipment_code: 'STEEL-2026-001', lot_id: null,
        type: 'product', description: 'Yongding 70% үлдэгдэл ($3,028.20)',
        amount: 3028.20, currency: 'USD', exchange_rate: 3576.76, amount_mnt: 10831156,
        payment_method: 'bank_transfer', payment_account: 'tdb', payment_reference: 'YD002-20260508-01',
        transaction_id: 'dee3dd16f5ca173d', paid: true, paid_at: '2026-05-18', due_date: null,
        allocation_method: 'by_weight', allocation_locked: false,
        created_at: '2026-05-18T00:00:00Z', created_by: 'migration', modified_at: null, modified_by: null, modification_log: []
      },
      // Yongding bank fees (combined)
      {
        id: 'cost_003', project_id: 'proj_001', shipment_id: 'ship_001', shipment_code: 'STEEL-2026-001', lot_id: null,
        type: 'bank_fee', description: 'TDB гадаад шилжүүлгийн шимтгэл (4 гүйлгээ)',
        amount: 290321, currency: 'MNT', exchange_rate: 1, amount_mnt: 290321,
        payment_method: 'bank_transfer', payment_account: 'tdb', payment_reference: null,
        transaction_id: null, paid: true, paid_at: '2026-05-18', due_date: null,
        allocation_method: 'by_weight', allocation_locked: false,
        created_at: '2026-05-18T00:00:00Z', created_by: 'migration', modified_at: null, modified_by: null, modification_log: []
      },
      // Yongding Erenhot→UB freight (estimated ¥1,600/ton × 8t)
      {
        id: 'cost_004', project_id: 'proj_001', shipment_id: 'ship_001', shipment_code: 'STEEL-2026-001', lot_id: null,
        type: 'freight_border_to_ub', description: 'Эрээн→УБ тээвэр (8т × ¥1,600/т = ¥12,800)',
        amount: 12800, currency: 'CNY', exchange_rate: 530, amount_mnt: 6784000,
        payment_method: 'bank_transfer', payment_account: 'tdb', payment_reference: null,
        transaction_id: null, paid: true, paid_at: '2026-05-23', due_date: null,
        allocation_method: 'by_weight', allocation_locked: false,
        created_at: '2026-05-23T00:00:00Z', created_by: 'migration', modified_at: null, modified_by: null, modification_log: []
      },
      // Note: Yongding CN domestic freight ($500) is included in the invoice total ($4,141.20)
      // and is already captured within cost_001 + cost_002. No separate entry needed.
      // Pingyun 50% advance
      {
        id: 'cost_005', project_id: 'proj_002', shipment_id: 'ship_002', shipment_code: 'UPVC-2026-001', lot_id: 'lot_005',
        type: 'product', description: 'Pingyun 50% урьдчилгаа (¥27,817)',
        amount: 27817, currency: 'CNY', exchange_rate: 529.04, amount_mnt: 14715193,
        payment_method: 'bank_transfer', payment_account: 'tdb', payment_reference: 'WY26051301RYMG',
        transaction_id: '4d5eedbd919a5abb', paid: true, paid_at: '2026-05-14', due_date: null,
        allocation_method: 'direct', allocation_locked: false,
        created_at: '2026-05-14T00:00:00Z', created_by: 'migration', modified_at: null, modified_by: null, modification_log: []
      },
      // Pingyun 50% balance
      {
        id: 'cost_006', project_id: 'proj_002', shipment_id: 'ship_002', shipment_code: 'UPVC-2026-001', lot_id: 'lot_005',
        type: 'product', description: 'Pingyun 50% үлдэгдэл (¥27,817.40)',
        amount: 27817.40, currency: 'CNY', exchange_rate: 530, amount_mnt: 14743222,
        payment_method: 'bank_transfer', payment_account: 'tdb', payment_reference: 'WY26051301RYMG',
        transaction_id: null, paid: true, paid_at: '2026-05-31', due_date: null,
        allocation_method: 'direct', allocation_locked: false,
        created_at: '2026-05-31T00:00:00Z', created_by: 'migration', modified_at: null, modified_by: null, modification_log: []
      },
      // Door 50% advance
      {
        id: 'cost_007', project_id: 'proj_003', shipment_id: 'ship_004', shipment_code: 'DOOR-2026-001', lot_id: 'lot_007',
        type: 'product', description: 'Хаалга 50% урьдчилгаа (¥19,500)',
        amount: 19500, currency: 'CNY', exchange_rate: 533, amount_mnt: 10395000,
        payment_method: 'agent', payment_account: 'kass', payment_reference: null,
        transaction_id: '630048d85e65001f', paid: true, paid_at: '2026-05-18', due_date: null,
        allocation_method: 'direct', allocation_locked: false,
        created_at: '2026-05-18T00:00:00Z', created_by: 'migration', modified_at: null, modified_by: null, modification_log: []
      },
      // Door 50% remaining — unpaid
      {
        id: 'cost_008', project_id: 'proj_003', shipment_id: 'ship_004', shipment_code: 'DOOR-2026-001', lot_id: 'lot_007',
        type: 'product', description: 'Хаалга 50% үлдэгдэл (¥19,500)',
        amount: 19500, currency: 'CNY', exchange_rate: null, amount_mnt: 10335000,
        payment_method: 'agent', payment_account: 'kass', payment_reference: null,
        transaction_id: null, paid: false, paid_at: null, due_date: '2026-06-14',
        allocation_method: 'direct', allocation_locked: false,
        created_at: '2026-05-18T00:00:00Z', created_by: 'migration', modified_at: null, modified_by: null, modification_log: []
      },
      // Pneumatic full payment
      {
        id: 'cost_009', project_id: 'proj_005', shipment_id: 'ship_007', shipment_code: 'PNEUM-2026-001', lot_id: 'lot_009',
        type: 'product', description: 'Пневматик 100% төлбөр (¥9,000)',
        amount: 9000, currency: 'CNY', exchange_rate: 530, amount_mnt: 4770000,
        payment_method: 'agent', payment_account: 'kass', payment_reference: null,
        transaction_id: 'c29c494bf7015b89', paid: true, paid_at: '2026-05-22', due_date: null,
        allocation_method: 'direct', allocation_locked: false,
        created_at: '2026-05-22T00:00:00Z', created_by: 'migration', modified_at: null, modified_by: null, modification_log: []
      }
    ];

    // 6. Preserve legacy data
    db.import_legacy = db.imports ? JSON.parse(JSON.stringify(db.imports)) : [];

    // 7. Initialize inventory_log if needed
    db.inventory_log = db.inventory_log || [];

    // 8. Ensure PNEUM inventory item exists and all items have total_value
    if (db.inventory && !db.inventory.find(i => i.code === 'PNEUM-TOILET')) {
      const maxId = db.inventory.reduce((m, i) => Math.max(m, i.id || 0), 0);
      db.inventory.push({
        id: maxId + 1, code: 'PNEUM-TOILET', name: 'Пневматик суултуурын систем',
        category: 'component', qty: 0, unit: 'ширхэг', cost_per_unit: 0, total_value: 0,
        min_qty: 0, location: 'Пластик Центр үйлдвэр'
      });
    }
    for (const inv of (db.inventory || [])) {
      if (inv.total_value === undefined || inv.total_value === null) {
        inv.total_value = 0;
        inv.cost_per_unit = inv.cost_per_unit || 0;
      }
    }

    save(db);
    console.log(`Import migration: created ${db.import_product_codes.length} product codes, ${db.import_projects.length} projects, ${db.import_shipments.length} shipments, ${db.import_lots.length} lots, ${db.import_cost_ledger.length} costs`);
  }

  // ── Business-unit conversion layer (generic, metadata-driven) ──
  // Inventory stays the source of truth for receiving/valuation/stock.
  // business_unit + conversion_factor are display-only metadata for Cost Analysis.
  // Rule: business_unit_cost = inventory_unit_cost × conversion_factor
  //       (conversion_factor = inventory units per 1 business unit, e.g. 3.02 kg per meter)
  if (db.import_product_codes && !db.import_business_unit_v1) {
    const BU = {
      STEEL:  { business_unit: 'meter', conversion_factor: 3.02, conversion_type: 'weight_per_length' },
      UPVC:   { business_unit: 'm2',    conversion_factor: 1,    conversion_type: 'identity' },
      DOOR:   { business_unit: 'piece', conversion_factor: 1,    conversion_type: 'identity' },
      PAVING: { business_unit: 'piece', conversion_factor: 1,    conversion_type: 'identity' },
      PNEUM:  { business_unit: 'piece', conversion_factor: 1,    conversion_type: 'identity' }
    };
    for (const pc of db.import_product_codes) {
      const b = BU[pc.code];
      if (b) {
        pc.business_unit = b.business_unit;
        pc.conversion_factor = b.conversion_factor;
        pc.conversion_type = b.conversion_type;
      } else {
        // generic fallback: business unit = inventory unit, 1:1
        pc.business_unit = pc.business_unit || pc.inventory_unit;
        pc.conversion_factor = pc.conversion_factor || 1;
        pc.conversion_type = pc.conversion_type || 'identity';
      }
    }
    db.import_business_unit_v1 = true;
    save(db);
    console.log('Migration: business-unit conversion layer added to product codes');
  }

  // ── Per-lot business conversion for steel profiles (хийцлэл) ──
  // The product-code factor (3.02 kg/m) is a blended average and is misleading
  // per profile. Each steel lot is a single profile, so we derive that profile's
  // own kg/m from its spec and store it on the lot. business unit stays "meter".
  // kg/m = cross-section area (mm²) × 0.00785  (steel density 7.85 g/cm³)
  if (db.import_lots && !db.import_lot_business_unit_v1) {
    const steelKgPerM = (spec) => {
      const m = String(spec || '').match(/(\d+(?:\.\d+)?)\s*[×xX*]\s*(\d+(?:\.\d+)?)(?:\s*[×xX*]\s*(\d+(?:\.\d+)?))?/);
      if (!m) return null;
      const a = parseFloat(m[1]), b = parseFloat(m[2]);
      const t = m[3] !== undefined ? parseFloat(m[3]) : null;
      let areaMm2;
      if (t != null) {
        // hollow tube (square/rectangular): outer area − inner area
        areaMm2 = a * b - (a - 2 * t) * (b - 2 * t);
      } else {
        // flat bar: width × thickness
        areaMm2 = a * b;
      }
      if (!(areaMm2 > 0)) return null;
      return areaMm2 * 0.00785;
    };
    let n = 0;
    for (const lot of db.import_lots) {
      if (lot.product_code !== 'STEEL') continue;
      const kgm = steelKgPerM(lot.product?.spec || '');
      if (kgm) {
        lot.business_unit = 'meter';
        lot.conversion_factor = Math.round(kgm * 1000) / 1000; // kg per meter
        lot.conversion_type = 'weight_per_length';
        n++;
      }
    }
    db.import_lot_business_unit_v1 = true;
    save(db);
    console.log(`Migration: per-lot business conversion set on ${n} steel lots`);
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
