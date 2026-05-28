const fs   = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH     = process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.join(__dirname, 'data.json');
const BACKUP_DIR  = process.env.BACKUP_DIR ? path.resolve(process.env.BACKUP_DIR) : path.join(__dirname, 'backups');

// ── Ensure backup directory exists ──
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR);

// Default seed passwords — only used when data.json doesn't exist (first install).
// CHANGE these passwords immediately after first login in production.
const SEED_PW = process.env.SEED_ADMIN_PW || 'changeme123';
const DEFAULT = {
  users: [
    { id: 1, name: 'Сүхээ Саруулсайхан', username: 'admin',     password: bcrypt.hashSync(SEED_PW, 10), role: 'admin' },
    { id: 2, name: 'Чинзориг',            username: 'chinzorig', password: bcrypt.hashSync(SEED_PW, 10), role: 'shareholder' },
    { id: 3, name: 'Чинбат',              username: 'chinbat',   password: bcrypt.hashSync(SEED_PW, 10), role: 'shareholder' },
    { id: 4, name: 'Склад менежер',       username: 'warehouse', password: bcrypt.hashSync(SEED_PW, 10), role: 'warehouse' },
    { id: 5, name: 'Борлуулагч',          username: 'sales',     password: bcrypt.hashSync(SEED_PW, 10), role: 'sales' },
  ],
  finance: {
    tdb_balance:  116252300,
    kass_balance: 36989900,
    updated_at:   '2026-05-20'
  },
  products: [
    { id: 'toilet_cabin',   name: 'Жорлон бүхээг',        price: 850000, active: true },
    { id: 'fence_m1',       name: 'Хашаа М-1',             price: 120000, active: true },
    { id: 'fence_m2',       name: 'Хашаа М-2',             price: 180000, active: true },
    { id: 'pavement',       name: 'Явган замын хавтан',    price: 25000,  active: true },
    { id: 'pneumatic_base', name: 'Пневматик суулт суурь', price: 95000,  active: true },
    { id: 'other',          name: 'Бусад',                 price: 0,      active: true },
  ],
  branches: [
    { id: 1, name: 'Пластик Центр — Үндсэн', active: true },
  ],
  bank_accounts: [
    { id: 'tdb',  name: 'TDB — Компани (803060739)',    active: true },
    { id: 'khan', name: 'Хаан банк — Касс (5304716376)', active: true },
  ],
  imports: [
    { id: 1, supplier: 'Yongding', product: 'Төмрийн хоолой (8т)', total: '$4,141.20', currency: 'USD', paid: '$4,141.20', remaining: '$0', status: 'transit', eta: '~2026.05.27', note: 'Эрээнд 05/20 ирсэн' },
    { id: 2, supplier: 'Pingyun', product: 'UPVC хавтан (2,441м²)', total: '¥55,634.40', currency: 'CNY', paid: '¥27,817', remaining: '¥27,817', status: 'partial', eta: '~2026.06.10–06.12', note: 'Үйлдвэрлэл 05/30–31 дуусна' },
    { id: 3, supplier: 'Хаалганы нийлүүлэгч', product: 'Хаалга (100ш)', total: '¥39,000', currency: 'CNY', paid: '¥19,500', remaining: '¥19,500', status: 'partial', eta: '~2026.06.12–06.14', note: 'Загварын 5ш карго ~05/30' },
    { id: 4, supplier: 'Явган замын хавтан', product: 'Хавтан (7,300ш)', total: '—', currency: 'CNY', paid: '0', remaining: 'Бүтэн дүн', status: 'pending', eta: '~2026.06.12–06.14', note: '05/22-нд 100% төлнө' },
  ],
  alerts: [
    { id: 1, title: 'Пластик Центр зээл', description: '69,050,000₮ буцаан төлнө', due_date: '2026-05-25', level: 'warning', resolved: false },
    { id: 2, title: 'Pingyun үлдэгдэл', description: '¥27,817 — үйлдвэрлэл дуусмагц', due_date: '2026-05-31', level: 'warning', resolved: false },
    { id: 3, title: 'Явган замын хавтан төлбөр', description: '100% нэг дор төлнө', due_date: '2026-05-22', level: 'warning', resolved: false },
    { id: 4, title: 'Батцацралмаа 1-р төлбөр', description: '50,000,000₮', due_date: '2026-09-01', level: 'info', resolved: false },
    { id: 5, title: 'Батцацралмаа 2-р төлбөр', description: '47,000,000₮', due_date: '2026-12-15', level: 'info', resolved: false },
  ],
  receivables: [
    { id: 1, name: 'Пластик Центр ХХК', amount: 69050000, due_date: '2026-05-25', note: 'Тур зээл', resolved: false },
    { id: 2, name: 'Өлзийбат Энхбилэгт', amount: 7000000, due_date: null, note: '5M + 2M зээл', resolved: false },
  ],
  payables: [
    { id: 1, name: 'Pingyun үлдэгдэл', amount_cny: 27817, note: 'Үйлдвэрлэл дуусмагц', resolved: false },
    { id: 2, name: 'Хаалга үлдэгдэл', amount_cny: 19500, note: 'Бараа ирэхэд', resolved: false },
    { id: 3, name: 'Батцацралмаа 1-р төлбөр', amount: 50000000, due_date: '2026-09-01', note: '', resolved: false },
    { id: 4, name: 'Батцацралмаа 2-р төлбөр', amount: 47000000, due_date: '2026-12-15', note: '', resolved: false },
  ],
  sales: [],
  expenses: []
};

// ── Backup helpers ──
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function dailyBackupPath() {
  return path.join(BACKUP_DIR, `data_${todayStr()}.json`);
}

function timestampedBackupPath() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return path.join(BACKUP_DIR, `data_${ts}.json`);
}

// Creates a daily backup (once per day) before first write of the day
function ensureDailyBackup(data) {
  const daily = dailyBackupPath();
  if (!fs.existsSync(daily)) {
    fs.writeFileSync(daily, JSON.stringify(data, null, 2));
  }
}

// Creates a timestamped backup before overwriting (for critical ops)
function createTimestampedBackup(data) {
  fs.writeFileSync(timestampedBackupPath(), JSON.stringify(data, null, 2));
}

// Prune backups older than 30 days (keep storage clean)
function pruneOldBackups() {
  try {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    fs.readdirSync(BACKUP_DIR).forEach(f => {
      const fp = path.join(BACKUP_DIR, f);
      if (fs.statSync(fp).mtimeMs < cutoff) fs.unlinkSync(fp);
    });
  } catch (_) {}
}

// ── Core functions ──
function load() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(DEFAULT, null, 2));
    return JSON.parse(JSON.stringify(DEFAULT));
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function save(data) {
  // Always take daily backup before first write of the day
  if (fs.existsSync(DB_PATH)) {
    const current = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    ensureDailyBackup(current);
  }
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// Critical save: timestamped backup before overwrite (for bulk operations)
function saveCritical(data) {
  if (fs.existsSync(DB_PATH)) {
    const current = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    createTimestampedBackup(current);
  }
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// Run pruning weekly (rough check)
try { pruneOldBackups(); } catch (_) {}

module.exports = { load, save, saveCritical };
