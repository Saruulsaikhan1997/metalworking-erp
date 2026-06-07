/**
 * Internal Purchases — Phase B: Finance → Memo Code → Module routing
 * ------------------------------------------------------------------
 * Энэ модуль нь САНХҮҮГИЙН гүйлгээ (finance transaction) → ДОТООД ХУДАЛДАН
 * АВАЛТЫН бичлэг (internal purchase intake) автоматаар үүсгэх АНХНЫ pipeline.
 *
 * Архитектур (зөвхөн routing түвшин — Warehouse/Production-ийн дотоод workflow
 * логикийг ЭНД боловсруулахгүй; тэр нь хожмын Phase D, эзэн нь Manager/Engineer):
 *
 *   Finance tx (code=MAT_WH)  ──┐
 *                                ├─► internal_purchases (module='warehouse')
 *   Finance tx (code=MAT_PROD)──┘                       (module='production')
 *
 * `module` талбар нь MEMO_CODES (lib/pdf_parser.js)-аас уншигдана — нэг эх сурвалж.
 * MAT_WH → module:'warehouse', MAT_PROD → module:'production'. Бусад код module-гүй
 * тул intake үүсгэхгүй.
 *
 * syncInternalPurchases(db) нь ИДЕМПОТЕНТ бүрэн тооцоо (full reconcile):
 *   • Тохирох гүйлгээ бүрт pending intake байгаа эсэхийг баталгаажуулна (байхгүй бол үүсгэнэ).
 *   • Гүйлгээг өөр код руу засах / архивлахад → холбогдох pending intake-ийг 'cancelled' болгоно.
 *   • Буцааж MAT_WH/MAT_PROD болговол → cancelled intake-ийг дахин 'pending' болгоно.
 *   • source_tx_id-аар идемпотент — олон удаа дуудсан ч давхар бичлэг үүсгэхгүй.
 *
 * ⚠️ Зөвхөн source==='FINANCE_TX' status==='pending'/'cancelled' intake-уудыг л
 *    хөнддөг. Module эзэн (Warehouse/Production) ирээдүйд intake-ийг өөр статус руу
 *    (ж: 'received') шилжүүлбэл, энэ sync түүнийг ХӨНДӨХГҮЙ — зөвхөн pending-ийг л
 *    cancel/reactivate хийнэ.
 */

const { MEMO_CODES } = require('./pdf_parser');

// Код → модуль (warehouse/production). Module-гүй код бол null.
function moduleForCode(code) {
  return (code && MEMO_CODES[code] && MEMO_CODES[code].module) || null;
}

// Гүйлгээний өөрчлөгддөг талбаруудыг intake руу хуулах. Зөрсөн зүйл байвал true.
function applyTxFields(ip, t, mod, now) {
  let dirty = false;
  const set = (k, v) => { if (ip[k] !== v) { ip[k] = v; dirty = true; } };
  set('module', mod);
  set('code', t.code);
  set('amount', t.amount);
  set('date', t.date);
  set('description', t.description || '');
  set('counterparty', t.counterparty || '');
  set('account', t.account || '');
  set('account_label', t.account_label || '');
  if (dirty) ip.updated_at = now;
  return dirty;
}

/**
 * Finance гүйлгээнээс дотоод худалдан авалтын intake-уудыг бүрэн тооцоолж нийцүүлнэ.
 * @param {object} db - бүрэн DB объект (db.transactions, db.internal_purchases)
 * @returns {number} хийгдсэн өөрчлөлтийн тоо (0 бол юу ч өөрчлөгдөөгүй)
 */
function syncInternalPurchases(db) {
  if (!db.internal_purchases) db.internal_purchases = [];
  const intakes = db.internal_purchases;
  const txs = db.transactions || [];
  const now = new Date().toISOString();
  let changes = 0;

  // source_tx_id → FINANCE_TX intake индекс (нэг гүйлгээ = нэг intake)
  const bySrc = new Map();
  for (const ip of intakes) {
    if (ip.source === 'FINANCE_TX' && ip.source_tx_id) bySrc.set(ip.source_tx_id, ip);
  }

  // Идэвхтэй intake байх ёстой гүйлгээний id-ийн олонлог
  const shouldHave = new Set();

  // 1) Урагшаа: тохирох гүйлгээ бүрт intake үүсгэх / шинэчлэх / дахин идэвхжүүлэх
  for (const t of txs) {
    if (t.archived) continue;
    const mod = moduleForCode(t.code);
    if (!mod) continue;
    shouldHave.add(t.id);

    let ip = bySrc.get(t.id);
    if (!ip) {
      ip = {
        id: 'IP-' + t.id,
        source: 'FINANCE_TX',
        source_tx_id: t.id,
        module: mod,
        code: t.code,
        amount: t.amount,
        date: t.date,
        description: t.description || '',
        counterparty: t.counterparty || '',
        account: t.account || '',
        account_label: t.account_label || '',
        status: 'pending',
        created_at: now,
        updated_at: now,
      };
      intakes.push(ip);
      bySrc.set(t.id, ip);
      changes++;
    } else {
      let dirty = false;
      // Cancelled байсныг буцааж pending болгох (код буцаагдсан тохиолдол)
      if (ip.status === 'cancelled') {
        ip.status = 'pending';
        ip.cancelled_at = null;
        dirty = true;
      }
      if (applyTxFields(ip, t, mod, now)) dirty = true;
      if (dirty) { ip.updated_at = now; changes++; }
    }
  }

  // 2) Ухраа: эх гүйлгээ нь тохирохгүй болсон (архивлагдсан / өөр код руу
  //    засагдсан / устсан) pending intake-уудыг cancel хийх
  for (const ip of intakes) {
    if (ip.source !== 'FINANCE_TX' || ip.status !== 'pending') continue;
    if (!shouldHave.has(ip.source_tx_id)) {
      ip.status = 'cancelled';
      ip.cancelled_at = now;
      ip.updated_at = now;
      changes++;
    }
  }

  return changes;
}

module.exports = { syncInternalPurchases, moduleForCode };
