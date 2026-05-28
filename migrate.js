// One-time migration: legacy sales records → new structure
// Run once: node migrate.js
// Safe to re-run: already-migrated records are skipped

const fs   = require('fs');
const path = require('path');

const DB_PATH    = path.join(__dirname, 'data.json');
const BACKUP_DIR = path.join(__dirname, 'backups');

const PRODUCT_MAP = {
  'toilet_cabin':   { id: 'toilet_cabin',   name: 'Жорлон бүхээг',        price: 850000 },
  'fence_m1':       { id: 'fence_m1',       name: 'Хашаа М-1',             price: 120000 },
  'fence_m2':       { id: 'fence_m2',       name: 'Хашаа М-2',             price: 180000 },
  'pavement':       { id: 'pavement',       name: 'Явган замын хавтан',    price: 25000  },
  'pneumatic_base': { id: 'pneumatic_base', name: 'Пневматик суулт суурь', price: 95000  },
  'other':          { id: 'other',          name: 'Бусад',                 price: 0      },
};

// Reverse map: Mongolian display name → product ID
const NAME_TO_ID = {
  'Жорлон бүхээг':        'toilet_cabin',
  'Хашаа М-1':            'fence_m1',
  'Хашаа М-2':            'fence_m2',
  'Явган замын хавтан':   'pavement',
  'Пневматик суулт суурь':'pneumatic_base',
  'Бусад':                'other',
};

const DEFAULT_PRODUCTS = Object.values(PRODUCT_MAP);

const DEFAULT_BRANCHES = [
  { id: 1, name: 'Пластик Центр — Үндсэн', active: true },
];

const DEFAULT_BANK_ACCOUNTS = [
  { id: 'tdb',  name: 'TDB — Компани (803060739)',     active: true },
  { id: 'khan', name: 'Хаан банк — Касс (5304716376)', active: true },
];

// ── Load ──
const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
const original = JSON.parse(JSON.stringify(db)); // deep clone for report

let migrated = 0;
let archived = 0;
let skipped  = 0;

// ── Migrate sales ──
db.sales = (db.sales || []).map(s => {

  // Already fully migrated
  if (s.status && s.total_amount && s.quantity && typeof s.id === 'string') {
    skipped++;
    return s;
  }

  // Integer-ID records are incomplete test data → archive
  if (typeof s.id === 'number') {
    archived++;
    return {
      ...s,
      archived:       true,
      archived_by:    'migration',
      archived_at:    new Date().toISOString(),
      archive_reason: 'Incomplete test record (integer ID, missing total_amount)',
    };
  }

  // ── Resolve product ID ──
  let productId = s.product || 'other';
  if (NAME_TO_ID[productId]) {
    productId = NAME_TO_ID[productId]; // convert display name → id
  }
  const productDef = PRODUCT_MAP[productId] || PRODUCT_MAP['other'];

  // ── Resolve quantity ──
  const quantity = parseInt(s.quantity || s.qty || 0);

  // ── Resolve unit_price ──
  const unit_price = s.unit_price || productDef.price || 0;

  // ── Resolve total_amount ──
  const total_amount = s.total_amount || (quantity * unit_price) || 0;

  // ── Resolve advance_paid ──
  const advance_paid = parseInt(s.advance_paid || 0);

  // ── Resolve remaining_amount ──
  let remaining_amount;
  if (s.remaining_amount != null) {
    remaining_amount = parseInt(s.remaining_amount);
  } else {
    remaining_amount = Math.max(0, total_amount - advance_paid);
  }

  // ── Resolve status ──
  let status;
  if (remaining_amount === 0) {
    status = 'completed';
  } else {
    status = 'receivable';
  }

  migrated++;

  return {
    id:              s.id,
    date:            s.date || new Date().toISOString().slice(0, 10),
    branch:          s.branch || '',
    product:         productId,
    quantity,
    unit_price,
    total_amount,
    advance_paid,
    remaining_amount,
    bank_account:      s.bank_account || '',
    bank_account_name: s.bank_account_name || s.bank_account || '',
    customer_name:   s.customer_name || s.customer || '',
    customer_phone:  s.customer_phone || s.phone || '',
    note:            s.note || '',
    status,
    archived:        false,
    created_by:      s.created_by || '',
    created_at:      s.created_at || s.date || new Date().toISOString(),
  };
});

// ── Seed master data (only if missing or empty) ──
if (!db.products || db.products.length === 0) {
  db.products = DEFAULT_PRODUCTS;
  console.log('✓ Products seeded:', DEFAULT_PRODUCTS.length);
} else {
  console.log('— Products already exist:', db.products.length, '(skipped seed)');
}

if (!db.branches || db.branches.length === 0) {
  db.branches = DEFAULT_BRANCHES;
  console.log('✓ Branches seeded:', DEFAULT_BRANCHES.length);
} else {
  console.log('— Branches already exist:', db.branches.length, '(skipped seed)');
}

if (!db.bank_accounts || db.bank_accounts.length === 0) {
  db.bank_accounts = DEFAULT_BANK_ACCOUNTS;
  console.log('✓ Bank accounts seeded:', DEFAULT_BANK_ACCOUNTS.length);
} else {
  console.log('— Bank accounts already exist:', db.bank_accounts.length, '(skipped seed)');
}

// ── Save ──
fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));

console.log('\n── Migration complete ──');
console.log('Migrated :', migrated);
console.log('Archived :', archived, '(incomplete test records)');
console.log('Skipped  :', skipped,  '(already migrated)');
console.log('Total    :', migrated + archived + skipped);

// ── Verify ──
console.log('\n── Verification ──');
const check = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
const active = check.sales.filter(s => !s.archived);
const completed  = active.filter(s => s.status === 'completed');
const receivable = active.filter(s => s.status === 'receivable');
const noStatus   = active.filter(s => !s.status);
console.log('Active records  :', active.length);
console.log('Completed       :', completed.length);
console.log('Receivable      :', receivable.length);
console.log('Missing status  :', noStatus.length, noStatus.length > 0 ? '← PROBLEM' : '✓');
