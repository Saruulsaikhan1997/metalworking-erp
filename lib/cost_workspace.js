// ════════════════════════════════════════════════════════════════════════
//  Cost Workspace engine (freeze §10–12, §14)
//  Owner's per-good cost-determination surface. ADDITIVE: lives in its own
//  db.import_cost_workspaces array — never mutates import_lots / shipments /
//  inventory (warehouse model untouched). The deterministic allocation lives
//  here so it is auditable and repeatable; Claude's job is parsing packing
//  lists into structured lines, not doing the arithmetic.
//
//  Unit worlds (the "translation table"):
//    buy   — Chinese market unit (ton, ¥/ton)        → basis for splitting
//    basis — weight | value | qty                     → how shared cost splits
//    stock — catalog output unit (meter, piece, m²)   → final ₮/unit
// ════════════════════════════════════════════════════════════════════════
const crypto = require('crypto');
const rid = (p) => p + crypto.randomBytes(5).toString('hex');

// cost-type → management bucket (freeze §15)
function bucketOf(type) {
  const t = (type || '').toLowerCase();
  if (t === 'product' || t === 'product_adjustment') return 'product';
  if (t.startsWith('freight')) return 'freight';
  if (t.includes('vat') || t === 'tax' || t.includes('duty')) return 'tax';
  if (t.startsWith('customs')) return 'customs';
  return 'other';
}
// 🟢 capitalize (goods landed cost) vs ⚪ period (general/period cost)
function defaultTagOf(type) {
  const t = (type || '').toLowerCase();
  if (t.includes('bank') || t.includes('fee') || t.startsWith('fx') || t.includes('fx_loss')) return 'period';
  return 'capitalize';
}

// ── Derive the stock-side (dual unit) numbers for a legacy lot ──
function lotToLine(lot, pcodes) {
  const pcode = (pcodes || []).find(p => p.code === lot.product_code) || {};
  const buyUnit = lot.units?.primary?.unit || pcode.primary_unit || 'piece';
  const buyQty = lot.units?.primary?.qty || 0;
  const stockUnit = lot.business_unit || pcode.business_unit || buyUnit;
  const factor = lot.conversion_factor || pcode.conversion_factor || 1;
  // legacy stored stock = buy/factor (weight_per_length); fall back to buy qty
  const stockQty = (stockUnit !== buyUnit && factor > 0) ? buyQty / factor : buyQty;
  // weight in kg for weight-basis allocation
  let weightKg = null;
  if (buyUnit === 'ton') weightKg = buyQty * 1000;
  else if (buyUnit === 'kg') weightKg = buyQty;
  else if (lot.units?.secondary?.unit === 'kg') weightKg = lot.units.secondary.qty || null;
  return {
    id: rid('wl_'),
    product_code: lot.product_code || null,
    name: lot.product?.name || pcode.name || lot.product_code || 'Нэр төрөл',
    spec: lot.product?.spec || '',
    buy_qty: Math.round(buyQty * 1000) / 1000,
    buy_unit: buyUnit,
    stock_qty: Math.round(stockQty * 100) / 100,
    stock_unit: stockUnit,
    conversion_factor: factor,
    weight_kg: weightKg,
    source: 'derived',
    legacy_lot_id: lot.id,
    created_at: new Date().toISOString(),
    created_by: 'materialize'
  };
}

// ── Build a workspace by seeding from existing data (freeze §10) ──
//  - good WITH lots  → lines from lots, costs from cost_ledger
//  - good WITHOUT    → empty lines, costs seeded from linked IMP payments
function materialize(db, order, who) {
  db.import_cost_workspaces = db.import_cost_workspaces || [];
  let ws = db.import_cost_workspaces.find(w => w.order_id === order.id);
  if (ws) return ws;

  const pcodes = db.import_product_codes || [];
  const shipIds = (db.import_shipments || []).filter(s => s.project_id === order.id).map(s => s.id);
  const lots = (db.import_lots || []).filter(l => shipIds.includes(l.shipment_id) && !l.is_sample);
  const lines = lots.map(l => lotToLine(l, pcodes));
  const lotLineId = {}; lots.forEach((l, i) => { lotLineId[l.id] = lines[i].id; });

  let costs = [];
  const ledger = (db.import_cost_ledger || []).filter(c => c.project_id === order.id);
  if (ledger.length) {
    costs = ledger.map(c => ({
      id: rid('wc_'),
      type: c.type || 'other',
      tag: defaultTagOf(c.type),
      scope: c.lot_id ? 'direct' : 'shared',
      line_id: c.lot_id ? (lotLineId[c.lot_id] || null) : null,
      amount_mnt: c.amount_mnt || 0,
      transaction_id: c.transaction_id || null,
      note: c.description || '',
      source: 'derived',
      legacy_cost_id: c.id,
      created_at: new Date().toISOString(),
      created_by: 'materialize'
    }));
  } else {
    // new good: seed product costs from its linked IMP bank payments
    const ledgerProject = {};
    for (const c of (db.import_cost_ledger || [])) if (c.transaction_id && c.project_id && ledgerProject[c.transaction_id] == null) ledgerProject[c.transaction_id] = c.project_id;
    const pays = (db.transactions || []).filter(t => t.code === 'IMP' && !t.archived && !t.import_detached
      && (t.import_order_id === order.id || ledgerProject[t.id] === order.id));
    costs = pays.map(t => ({
      id: rid('wc_'),
      type: 'product',
      tag: 'capitalize',
      scope: 'shared',
      line_id: null,
      amount_mnt: t.amount || 0,
      transaction_id: t.id,
      note: t.note || t.description || t.raw_memo || '',
      source: 'derived',
      created_at: new Date().toISOString(),
      created_by: 'materialize'
    }));
  }

  ws = {
    order_id: order.id,
    status: 'draft',
    basis: 'weight',
    lines,
    costs,
    created_at: new Date().toISOString(),
    created_by: who || 'admin',
    updated_at: new Date().toISOString(),
    finalized_at: null,
    finalized_by: null
  };
  db.import_cost_workspaces.push(ws);
  return ws;
}

// ── Deterministic allocation (the app does the math, not AI) ──
function basisValue(line, basis, directProduct) {
  if (basis === 'qty') return line.stock_qty || 0;
  if (basis === 'value') return directProduct || line.buy_qty || 0;
  // weight (default)
  if (line.weight_kg != null) return line.weight_kg;
  const u = (line.buy_unit || '').toLowerCase();
  if (u === 'ton' || u === 'tonne' || u === 't') return (line.buy_qty || 0) * 1000;
  if (u === 'kg') return line.buy_qty || 0;
  return line.stock_qty || line.buy_qty || 0;
}

function computeAllocation(ws) {
  const lines = ws.lines || [];
  const costs = ws.costs || [];
  const capCosts = costs.filter(c => c.tag === 'capitalize');
  const perCosts = costs.filter(c => c.tag !== 'capitalize');

  // direct capitalize cost per line
  const directOf = {};
  for (const l of lines) directOf[l.id] = 0;
  for (const c of capCosts) if (c.scope === 'direct' && c.line_id && directOf[c.line_id] != null) directOf[c.line_id] += (c.amount_mnt || 0);

  // basis value per line
  const bval = {}; let totalBasis = 0;
  for (const l of lines) { const v = basisValue(l, ws.basis, directOf[l.id]); bval[l.id] = v; totalBasis += v; }

  const sharedCap = capCosts.filter(c => c.scope !== 'direct');
  const sharedTotal = sharedCap.reduce((s, c) => s + (c.amount_mnt || 0), 0);

  const outLines = lines.map(l => {
    const direct = directOf[l.id] || 0;
    const shared = (totalBasis > 0 && lines.length) ? sharedTotal * (bval[l.id] / totalBasis) : 0;
    const allocated = Math.round(direct + shared);
    const stockQty = l.stock_qty || 0;
    const breakdown = { product: 0, freight: 0, customs: 0, tax: 0, other: 0 };
    // direct buckets
    for (const c of capCosts) if (c.scope === 'direct' && c.line_id === l.id) breakdown[bucketOf(c.type)] += (c.amount_mnt || 0);
    // shared buckets by ratio
    if (totalBasis > 0) for (const c of sharedCap) breakdown[bucketOf(c.type)] += (c.amount_mnt || 0) * (bval[l.id] / totalBasis);
    Object.keys(breakdown).forEach(k => breakdown[k] = Math.round(breakdown[k]));
    return {
      lot_id: l.id,                 // line id (kept as lot_id so frontend renderer is unchanged)
      line_id: l.id,
      product_code: l.product_code || null,
      name: l.name, spec: l.spec || '',
      image: null,
      buy_unit: l.buy_unit, buy_qty: l.buy_qty,
      stock_unit: l.stock_unit, stock_qty: l.stock_qty,
      conversion_factor: l.conversion_factor,
      weight_kg: l.weight_kg != null ? l.weight_kg : null,
      same_unit: l.stock_unit === l.buy_unit || l.conversion_factor === 1,
      basis_value: Math.round((bval[l.id] || 0) * 100) / 100,
      allocated_mnt: allocated,
      unit_cost_stock: stockQty > 0 ? Math.round(allocated / stockQty) : 0,
      source: l.source || 'manual',
      breakdown
    };
  });

  const ledgerTotal = costs.reduce((s, c) => s + (c.amount_mnt || 0), 0);
  const capitalizeTotal = capCosts.reduce((s, c) => s + (c.amount_mnt || 0), 0);
  const periodTotal = perCosts.reduce((s, c) => s + (c.amount_mnt || 0), 0);
  const allocatedTotal = outLines.reduce((s, l) => s + l.allocated_mnt, 0);

  return { outLines, ledgerTotal, capitalizeTotal, periodTotal, allocatedTotal };
}

// ── Assemble the GET response from a materialized workspace ──
//  Same shape as the v1 read-only derive, plus editing fields.
function buildResponse(db, order, ws) {
  const txs = db.transactions || [];
  const txById = {}; for (const t of txs) txById[t.id] = t;
  const a = computeAllocation(ws);

  const costRows = (ws.costs || []).map(c => {
    const tx = c.transaction_id ? txById[c.transaction_id] : null;
    return {
      id: c.id, type: c.type, bucket: bucketOf(c.type), tag: c.tag,
      scope: c.scope || 'shared', line_id: c.line_id || null,
      amount_mnt: c.amount_mnt || 0, note: c.note || '', source: c.source || 'manual',
      payment: tx ? { date: tx.date, account_label: tx.account_label, memo: tx.note || tx.description || tx.raw_memo || '' } : null
    };
  });

  // linked bank payments (same derivation as orders-tracker)
  const ledgerProject = {};
  for (const c of (db.import_cost_ledger || [])) if (c.transaction_id && c.project_id && ledgerProject[c.transaction_id] == null) ledgerProject[c.transaction_id] = c.project_id;
  const payments = txs.filter(t => t.code === 'IMP' && !t.archived && !t.import_detached
      && (t.import_order_id === order.id || ledgerProject[t.id] === order.id))
    .map(t => ({ transaction_id: t.id, date: t.date, amount: t.amount, account_label: t.account_label,
      memo: t.note || t.description || t.raw_memo || '', is_final: t.import_final === true }))
    .sort((x, y) => (x.date || '').localeCompare(y.date || ''));

  return {
    order: { id: order.id, code: order.code, name: order.name, supplier: order.supplier?.name || '', currency: order.currency || 'USD' },
    editable: true, materialized: true, status: ws.status, basis: ws.basis,
    costs: costRows,
    ledger_total_mnt: a.ledgerTotal,
    capitalize_total_mnt: a.capitalizeTotal,
    period_total_mnt: a.periodTotal,
    lines: a.outLines,
    line_count: a.outLines.length,
    allocated_total_mnt: a.allocatedTotal,
    difference_mnt: a.ledgerTotal - a.allocatedTotal,
    basis_hint: ws.basis,
    payments,
    payment_total_mnt: payments.reduce((s, p) => s + (p.amount || 0), 0)
  };
}

module.exports = { bucketOf, defaultTagOf, materialize, computeAllocation, buildResponse, rid };
