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
// Module-separated routers (Нярав-Менежер эзэмшил): склад/үйлдвэрлэл + борлуулалт
app.use('/api', require('./routes/inventory'));
app.use('/api', require('./routes/sales'));

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

  // 2b. Recode old computer purchases EQP→ASSET (компани эд хөрөнгө).
  //     ASSET код байхаас өмнө MacBook болон Толгой компьютер EQP-ээр бүртгэгдсэн.
  //     Идэмпотент: нэг удаа ASSET болсон бол дахин ажиллахгүй (EQP шүүлтүүр).
  for (const t of txs) {
    if (t.code !== 'EQP' || t.archived) continue;
    const text = (t.description || '') + ' ' + (t.raw_memo || '');
    const isMac = t.amount === 4350000 && /macbook/i.test(text);
    const isPc  = t.amount === 1000000 && /толгой\s+компьютер/i.test(text);
    if (isMac || isPc) {
      t.code = 'ASSET';
      t.needs_review = false;
      changed++;
    }
  }

  // 2c. Fix duplicated "Аюурзана түр зээл" (2026-05-21).
  //     1,000,000₮ зээл OUT (TDB→Касс) хоёр удаа бичигдсэн — нэг нь буруугаар
  //     орлого (credit) болж TDB тэнцлийг эвдсэн. Зөв (debit) нэгийг үлдээж,
  //     үлдсэнийг архивлана. Идэмпотент: 1-ээс олон идэвхтэй байж л ажиллана.
  {
    const ayur = txs.filter(t => !t.archived
      && t.date === '2026-05-21'
      && t.amount === 1000000
      && /аюурзана/i.test((t.description || '') + ' ' + (t.raw_memo || '')));
    if (ayur.length > 1) {
      const keep = ayur.find(t => t.direction === 'debit') || ayur[0];
      for (const t of ayur) {
        if (t === keep) continue;
        t.archived = true;
        t.archived_at = new Date().toISOString();
        t.archived_by = 'system-migration';
        t.archive_reason = 'Давхардсан Аюурзана зээл (буруу чиглэл/давхардал) — автомат засвар';
        changed++;
      }
      if (keep.direction !== 'debit') { keep.direction = 'debit'; changed++; }
      if (keep.code !== 'LOAN_OUT') { keep.code = 'LOAN_OUT'; keep.needs_review = false; changed++; }
    }
  }

  // 2d. Direction integrity (ерөнхий хамгаалалт): balance_after нь банкны үнэн эх
  //     сурвалж. Гүйлгээний чиглэл балансын өөрчлөлттэй зөрвөл засна. ЗӨВХӨН баланс
  //     тодорхой нотолсон үед эргүүлнэ (таамаглахгүй) → аюулгүй. Дараагийн rehash (3)
  //     зөв id-г тооцож, үүссэн давхардлыг архивлана. Энэ нь буруу чиглэлтэй
  //     гүйлгээ дахин үүсэхээс сэргийлнэ.
  {
    const accts = [...new Set(txs.filter(t => !t.archived).map(t => t.account))];
    for (const acc of accts) {
      const chain = txs.filter(t => t.account === acc && !t.archived).sort((a, b) =>
        a.date !== b.date ? a.date.localeCompare(b.date)
        : (a.time || '') !== (b.time || '') ? (a.time || '').localeCompare(b.time || '')
        : (a.seq || 0) - (b.seq || 0));
      for (let i = 1; i < chain.length; i++) {
        const prev = chain[i - 1], curr = chain[i];
        if (prev.balance_after == null || curr.balance_after == null) continue;
        const isCredit = Math.abs((prev.balance_after + curr.amount) - curr.balance_after) < 0.01;
        const isDebit  = Math.abs((prev.balance_after - curr.amount) - curr.balance_after) < 0.01;
        if (isCredit && !isDebit && curr.direction !== 'credit') { curr.direction = 'credit'; changed++; }
        else if (isDebit && !isCredit && curr.direction !== 'debit') { curr.direction = 'debit'; changed++; }
      }
    }
  }

  // 2e. Recode pre-REFUND "борлуулалт" credit(s) as REFUND (зардлын буцаалт).
  //     Жинхэнэ борлуулалт хараахан эхлээгүй (хэрэглэгч баталгаажуулсан), гэтэл
  //     илүү төлсөн зардал дансанд буцаж орж ирээд SALE/REC/ADV-аар (борлуулалт)
  //     кодлогдсоноос "Борлуулалт" карт 315,000₮-ийг хуурамчаар харуулж байсан.
  //     REFUND болгоход борлуулалт/орлогоос хасагдаж, цэвэр зардлыг бууруулна.
  //     Нэг удаа ажиллана (флаг) → ирээдүйн ЖИНХЭНЭ борлуулалтыг хөндөхгүй.
  //     Код нь txId hash-д ороогүй тул rehash/dedup (3)-д нөлөөлөхгүй.
  if (!db._migrated_refund_315k) {
    const toRefund = txs.filter(t => !t.archived
      && ['SALE', 'REC', 'ADV'].includes(t.code)
      && t.direction === 'credit');
    for (const t of toRefund) {
      t.code = 'REFUND';
      t.needs_review = false;
      changed++;
    }
    db._migrated_refund_315k = true;
    changed++;
    if (toRefund.length) console.log(`Migration 2e: ${toRefund.length} борлуулалт→REFUND (зардлын буцаалт).`);
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

  // ── Reclassify PNEUM shipment → VACUUM TOILET product family ──
  // The single "Пневматик суултуур" lot was an inaccurate classification.
  // Supplier sales doc (2026.05.20) itemises 3 vacuum-toilet models:
  //   Household 2×¥650, Public 2×¥650, VIP 4×¥1600 = ¥9,000 (8 pcs).
  // We split the lot into 3 model lots + 3 inventory items, and KEEP the
  // historical bank-linked payment (cost_009) intact — only reclassifying it
  // to a shipment-level shared product cost so it allocates per model by value.
  // Idempotent, guarded. No freight/customs/tax exist on this shipment, so
  // landed cost per model = its supplier value (¥each × 530₮).
  if (db.import_lots && !db.import_vacuum_toilet_v1) {
    const ship = (db.import_shipments || []).find(s => s.code === 'PNEUM-2026-001');
    const oldLot = (db.import_lots || []).find(l => l.id === 'lot_009' || (l.shipment_id === ship?.id && l.product_code === 'PNEUM'));
    if (ship && oldLot) {
      const RATE = 530; // ₮/RMB (¥9,000 = 4,770,000₮)
      const MODELS = [
        { code: 'VACUUM-TOILET-HOUSEHOLD', name: 'Vacuum Toilet - Household', qty: 2, rmb_each: 650,
          spec: 'Айл өрхийн вакуум суултуур (гэр хороолол/айл өрх)',
          description: 'Residential vacuum toilet designed for ger district and household installations.' },
        { code: 'VACUUM-TOILET-PUBLIC', name: 'Vacuum Toilet - Public', qty: 2, rmb_each: 650,
          spec: 'Нийтийн ариун цэврийн вакуум суултуур',
          description: 'Vacuum toilet designed for public restroom installations.' },
        { code: 'VACUUM-TOILET-VIP', name: 'Vacuum Toilet - VIP', qty: 4, rmb_each: 1600,
          spec: 'VIP премиум вакуум суултуурын систем',
          description: 'Premium vacuum toilet system for high-end residential projects.' }
      ];

      // 1) Product codes (one per model, family = VACUUM-TOILET)
      db.import_product_codes = db.import_product_codes || [];
      for (const m of MODELS) {
        if (!db.import_product_codes.find(p => p.code === m.code)) {
          db.import_product_codes.push({
            code: m.code, name: m.name, category: 'finished_good',
            primary_unit: 'piece', secondary_unit: null, conversion: null,
            inventory_unit: 'piece', cost_method: 'lot_based',
            business_unit: 'piece', conversion_factor: 1, conversion_type: 'identity',
            family: 'VACUUM-TOILET', description: m.description
          });
        }
      }

      // 2) Inventory items — reuse placeholder item 5 (PNEUM-TOILET, qty 0) for
      //    the first model, create fresh items for the other two.
      db.inventory = db.inventory || [];
      let maxInvId = db.inventory.reduce((mx, i) => Math.max(mx, i.id || 0), 0);
      const nowIso = new Date().toISOString();
      const invIdFor = {};
      MODELS.forEach((m, idx) => {
        let item;
        if (idx === 0) {
          item = db.inventory.find(i => i.id === (oldLot.inventory_item_id || 5));
        }
        if (item) {
          item.code = m.code; item.name = m.name; item.category = 'finished';
          item.unit = 'ширхэг'; item.qty = 0; item.cost_per_unit = 0; item.total_value = 0;
          item.status = item.status || 'available'; item.active = item.active !== false;
          item.updated_at = nowIso;
        } else {
          item = {
            id: ++maxInvId, code: m.code, name: m.name, category: 'finished',
            status: 'available', unit: 'ширхэг', location: 'Пластик Центр үйлдвэр',
            qty: 0, threshold: 0, cost_per_unit: 0, active: true, has_manual_adjustment: false,
            created_at: nowIso, created_by: 'migration (vacuum-toilet reclassify)', total_value: 0
          };
          db.inventory.push(item);
        }
        invIdFor[m.code] = item.id;
      });

      // 3) Remove old lot, create 3 model lots
      db.import_lots = db.import_lots.filter(l => l.id !== oldLot.id);
      let maxLotId = (db.import_lots || []).reduce((mx, l) => {
        const n = parseInt((l.id || '').replace('lot_', ''), 10); return n > mx ? n : mx;
      }, 9); // keep ≥ 9 so we never reuse lot_009
      const newLots = MODELS.map(m => {
        const lot = {
          id: 'lot_' + String(++maxLotId).padStart(3, '0'),
          project_id: ship.project_id, shipment_id: ship.id, shipment_code: ship.code,
          product_code: m.code,
          product: { name: m.name, spec: m.spec, category: 'finished_good' },
          units: { primary: { unit: 'piece', qty: m.qty, landed_cost: 0 }, secondary: null },
          unit_price: m.rmb_each, currency: 'CNY', exchange_rate: RATE,
          product_cost: m.rmb_each * m.qty,
          product_cost_mnt: Math.round(m.rmb_each * m.qty * RATE),
          allocations: [], total_allocated_mnt: 0, total_cost_mnt: 0,
          is_sample: false, sample_purpose: null, sample_parent_lot: null,
          inventory_item_id: invIdFor[m.code],
          warehouse_status: 'not_received', received_qty: null, received_at: null, received_by: null,
          quality_check: null, quality_notes: null,
          created_at: oldLot.created_at || nowIso,
          reclassified_from: oldLot.id
        };
        db.import_lots.push(lot);
        return lot;
      });

      // 4) Reclassify the historical payment (cost_009): keep amount, bank-tx
      //    link and PAID status; move it from lot-level to shipment-level shared
      //    product cost so it allocates per model by value.
      const payCost = (db.import_cost_ledger || []).find(c => c.lot_id === oldLot.id && c.type === 'product')
        || (db.import_cost_ledger || []).find(c => c.shipment_id === ship.id && c.type === 'product');
      if (payCost) {
        payCost.lot_id = null;
        payCost.allocation_method = 'by_value';
        payCost.description = 'Vacuum Toilet 100% төлбөр (¥9,000) — 3 загвар (Household/Public/VIP)';
        payCost.paid = true; // PAID IN FULL — cash account, via agent/intermediary
        payCost.payment_account = payCost.payment_account || 'kass';
        payCost.payment_method = payCost.payment_method || 'agent';
        payCost.modification_log = payCost.modification_log || [];
        payCost.modification_log.push({
          at: nowIso, by: 'migration',
          note: 'PNEUM→VACUUM-TOILET reclassify: lot-level direct cost → shipment-level shared (by_value). Amount/tx/paid unchanged.'
        });
        payCost.modified_at = nowIso;
        payCost.modified_by = 'migration';
      }

      // 5) Allocate shared product cost across the 3 model lots by value
      const sharedCosts = (db.import_cost_ledger || []).filter(c => c.shipment_id === ship.id && !c.lot_id);
      const totalValue = newLots.reduce((s, l) => s + (l.product_cost_mnt || 0), 0);
      for (const cost of sharedCosts) {
        for (let i = 0; i < newLots.length; i++) {
          const lot = newLots[i];
          const ratio = totalValue > 0 ? (lot.product_cost_mnt || 0) / totalValue : 1 / newLots.length;
          let alloc = (lot.allocations || []).find(a => a.cost_ledger_id === cost.id);
          if (!alloc) { alloc = { cost_ledger_id: cost.id, cost_type: cost.type }; lot.allocations.push(alloc); }
          alloc.auto_method = 'by_value';
          alloc.auto_ratio = ratio;
          if (i === newLots.length - 1) {
            const others = newLots.slice(0, -1).reduce((s, ol) => {
              const a = (ol.allocations || []).find(a => a.cost_ledger_id === cost.id);
              return s + (a ? a.auto_value : 0);
            }, 0);
            alloc.auto_value = (cost.amount_mnt || 0) - others;
          } else {
            alloc.auto_value = Math.round((cost.amount_mnt || 0) * ratio);
          }
          alloc.manual_override = null; alloc.override_reason = null;
          alloc.overridden_by = null; alloc.overridden_at = null;
          alloc.final_value = alloc.auto_value;
          alloc.locked = false; alloc.locked_by = null; alloc.locked_at = null;
        }
      }

      // 6) Recompute landed cost per lot
      for (const lot of newLots) {
        const directCostsMnt = (db.import_cost_ledger || [])
          .filter(c => c.lot_id === lot.id).reduce((s, c) => s + (c.amount_mnt || 0), 0);
        lot.total_allocated_mnt = (lot.allocations || []).reduce((s, a) => s + (a.final_value || 0), 0);
        lot.total_cost_mnt = directCostsMnt + lot.total_allocated_mnt;
        const pQty = lot.units?.primary?.qty || 1;
        lot.units.primary.landed_cost = Math.round(lot.total_cost_mnt / pQty);
      }

      // 7) Update shipment description + activity log (keep code/status/dates intact)
      ship.description = 'Vacuum Toilet (Household / Public / VIP)';
      ship.activity_log = ship.activity_log || [];
      ship.activity_log.push({
        date: nowIso.slice(0, 10),
        event: 'Ангилал засвар: Vacuum Toilet 3 загвар болгон ангилав (Household/Public/VIP)',
        by: 'system'
      });
      ship.updated_at = nowIso;

      db.import_vacuum_toilet_v1 = true;
      save(db);
      console.log(`Migration: PNEUM reclassified → 3 VACUUM-TOILET model lots (${newLots.map(l => l.id).join(', ')})`);
    }
  }

  // ── Remove legacy PNEUM/Пневматик naming from all user-facing fields ──
  // Approved family: VACUUM TOILET. Approved models: Vacuum Toilet Household /
  // Public / VIP. Internal record IDs (ship_007, lot ids, inventory ids,
  // bank-tx links) are preserved; only display names + the human-readable
  // shipment code are normalized. Idempotent, guarded.
  if (db.import_product_codes && !db.import_vacuum_toilet_naming_v2) {
    const NAME = {
      'VACUUM-TOILET-HOUSEHOLD': 'Vacuum Toilet Household',
      'VACUUM-TOILET-PUBLIC': 'Vacuum Toilet Public',
      'VACUUM-TOILET-VIP': 'Vacuum Toilet VIP'
    };
    // product code display names + drop the now-unused legacy PNEUM code
    for (const pc of db.import_product_codes) if (NAME[pc.code]) pc.name = NAME[pc.code];
    db.import_product_codes = db.import_product_codes.filter(p => p.code !== 'PNEUM');
    // inventory item names
    for (const it of (db.inventory || [])) if (NAME[it.code]) it.name = NAME[it.code];
    // lot product names
    for (const l of (db.import_lots || [])) if (l.product && NAME[l.product_code]) l.product.name = NAME[l.product_code];
    // project + supplier name (shown as supplier_name on shipment list/detail)
    for (const pr of (db.import_projects || [])) {
      if (/пневмат/i.test(pr.name || '')) pr.name = 'Vacuum Toilet нийлүүлэгч';
      if (pr.supplier && /пневмат/i.test(pr.supplier.name || '')) pr.supplier.name = 'Vacuum Toilet нийлүүлэгч';
      if ((pr.code || '') === 'PROJ-PNEUM') pr.code = 'PROJ-VACUUM';
    }
    // rename the human-readable shipment code + propagate to denormalized refs
    const vship = (db.import_shipments || []).find(s => s.code === 'PNEUM-2026-001');
    if (vship) {
      const newCode = 'VACUUM-TOILET-2026-001';
      vship.code = newCode;
      if (/пневмат/i.test(vship.description || '')) vship.description = 'Vacuum Toilet (Household / Public / VIP)';
      for (const l of (db.import_lots || [])) if (l.shipment_id === vship.id) l.shipment_code = newCode;
      for (const c of (db.import_cost_ledger || [])) if (c.shipment_id === vship.id) c.shipment_code = newCode;
    }
    db.import_vacuum_toilet_naming_v2 = true;
    save(db);
    console.log('Migration: vacuum-toilet naming normalized + shipment code renamed');
  }

  // ── Scrub legacy term from the (user-visible) activity-log history ──
  // v2 cleaned display fields but the reclassification audit entry still
  // literally contained "Пневматик", which surfaces in the shipment "Түүх"
  // panel. Reword it to record the same correction without the legacy term.
  // The original "from" classification stays preserved in the cost-ledger
  // modification_log (internal) and git history. Idempotent, guarded.
  if (db.import_shipments && !db.import_vacuum_toilet_log_v3) {
    for (const s of db.import_shipments) {
      for (const l of (s.activity_log || [])) {
        if (l.event && /пневмат/i.test(l.event)) {
          l.event = 'Ангилал засвар: Vacuum Toilet 3 загвар болгон ангилав (Household/Public/VIP)';
        }
      }
    }
    db.import_vacuum_toilet_log_v3 = true;
    save(db);
    console.log('Migration: vacuum-toilet activity-log history scrubbed of legacy term');
  }

  // ── Attach approved supplier reference images to the vacuum-toilet shipment ──
  // Source: supplier sales sheet (2026.5.20 销售表). The full sheet is stored as
  // the shipment reference image; each model gets its cropped product visual.
  // Files committed under public/uploads/products/ (served at /uploads/...).
  // Idempotent, guarded.
  if (db.import_product_codes && !db.import_vacuum_toilet_images_v4) {
    const IMG = {
      'VACUUM-TOILET-HOUSEHOLD': '/uploads/products/vacuum-toilet-household.jpg',
      'VACUUM-TOILET-PUBLIC': '/uploads/products/vacuum-toilet-public.jpg',
      'VACUUM-TOILET-VIP': '/uploads/products/vacuum-toilet-vip.jpg'
    };
    const SHEET = '/uploads/products/vacuum-toilet-2026-001-sheet.jpg';
    // product code visuals
    for (const pc of db.import_product_codes) if (IMG[pc.code]) pc.image = IMG[pc.code];
    // inventory item visuals
    for (const it of (db.inventory || [])) if (IMG[it.code]) it.image = IMG[it.code];
    // lot product visuals
    for (const l of (db.import_lots || [])) {
      if (l.product && IMG[l.product_code]) l.product.image = IMG[l.product_code];
    }
    // shipment reference image (the full approved sales sheet)
    const vship = (db.import_shipments || []).find(s => s.code === 'VACUUM-TOILET-2026-001');
    if (vship) {
      vship.reference_image = SHEET;
      vship.activity_log = vship.activity_log || [];
      vship.activity_log.push({
        date: new Date().toISOString().slice(0, 10),
        event: 'Лавлах зураг нэмэгдсэн (нийлүүлэгчийн борлуулалтын хүснэгт + загвар тус бүрийн зураг)',
        by: 'system'
      });
      vship.updated_at = new Date().toISOString();
    }
    db.import_vacuum_toilet_images_v4 = true;
    save(db);
    console.log('Migration: vacuum-toilet supplier reference images attached');
  }

  // ── Create the warehouse-manager (нярав-менежер) staff login ──
  // One combined operational account: warehouse/inventory + sales input +
  // operational views. No finance access (finance stays admin/shareholder).
  // Password is stored as a bcrypt hash (same scheme as other users).
  // Idempotent — only creates the user if the username is not already present.
  if (db.users && !db.users.some(u => u.username === 'mnk9')) {
    const nextId = Math.max(0, ...db.users.map(u => u.id || 0)) + 1;
    db.users.push({
      id: nextId,
      username: 'mnk9',
      // bcrypt hash of the password chosen by the CEO
      password: '$2a$10$hOR1s7U89sKI3b/gHfNCSuV./AoZPMI/Ml/4FVjFDIpkd2fUWBM.m',
      role: 'manager',
      name: 'Нярав-Менежер'
    });
    save(db);
    console.log('Migration: warehouse-manager user (mnk9) created');
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
