const express = require('express');
const router = express.Router();
const { load, save } = require('../database');
const cw = require('../lib/cost_workspace');

// Auth middleware
function authRequired(req, res, next) {
  const jwt = require('jsonwebtoken');
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'metalworking-secret-2026');
    next();
  } catch { res.status(401).json({ error: 'Нэвтрэх шаардлагатай' }); }
}
function adminOnly(req, res, next) {
  if (!['admin'].includes(req.user?.role)) return res.status(403).json({ error: 'Зөвхөн админ' });
  next();
}
function adminOrWarehouse(req, res, next) {
  if (!['admin', 'warehouse', 'manager'].includes(req.user?.role)) return res.status(403).json({ error: 'Эрх хүрэхгүй' });
  next();
}

router.use(authRequired);

// The whole import/cost surface is the owner's private section.
// Factory engineers must not see landed costs, supplier prices, or payments.
router.use((req, res, next) => {
  if (req.user?.role === 'engineer') return res.status(403).json({ error: 'Эрх хүрэхгүй' });
  next();
});

// ══════════════════════════════════════════
//  PRODUCT CODES
// ══════════════════════════════════════════
router.get('/product-codes', (req, res) => {
  const db = load();
  res.json(db.import_product_codes || []);
});

router.post('/product-codes', adminOnly, (req, res) => {
  const db = load();
  const b = req.body;
  if (!b.code || !b.name) return res.status(400).json({ error: 'code, name шаардлагатай' });
  db.import_product_codes = db.import_product_codes || [];
  if (db.import_product_codes.find(p => p.code === b.code)) return res.status(409).json({ error: 'Код давхцаж байна' });
  const pcode = {
    code: b.code.toUpperCase(),
    name: b.name,
    category: b.category || 'raw_material',
    primary_unit: b.primary_unit || 'piece',
    secondary_unit: b.secondary_unit || null,
    conversion: b.conversion || null,
    inventory_unit: b.inventory_unit || b.primary_unit || 'piece',
    cost_method: b.cost_method || 'weighted_average'
  };
  db.import_product_codes.push(pcode);
  save(db);
  res.json({ code: pcode.code });
});

// ══════════════════════════════════════════
//  PROJECTS
// ══════════════════════════════════════════
router.get('/projects', (req, res) => {
  const db = load();
  res.json(db.import_projects || []);
});

router.post('/projects', adminOnly, (req, res) => {
  const db = load();
  const b = req.body;
  if (!b.name || !b.supplier_name) return res.status(400).json({ error: 'name, supplier_name шаардлагатай' });

  db.import_projects = db.import_projects || [];
  const maxId = db.import_projects.reduce((m, p) => {
    const n = parseInt((p.id || '').replace('proj_', ''), 10);
    return n > m ? n : m;
  }, 0);

  const project = {
    id: 'proj_' + String(maxId + 1).padStart(3, '0'),
    code: b.code || ('PROJ-' + b.supplier_name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)),
    name: b.name,
    supplier: {
      name: b.supplier_name,
      country: b.supplier_country || 'CN',
      contact: b.supplier_contact || null
    },
    type: b.type || 'official',
    currency: b.currency || 'USD',
    status: 'active',
    created_at: new Date().toISOString()
  };
  db.import_projects.push(project);
  save(db);
  res.json({ id: project.id, code: project.code });
});

// ══════════════════════════════════════════
//  DASHBOARD
// ══════════════════════════════════════════
router.get('/dashboard', (req, res) => {
  const db = load();
  const shipments = db.import_shipments || [];
  const lots = db.import_lots || [];
  const costs = db.import_cost_ledger || [];

  const in_transit = shipments.filter(s => ['in_transit_cn', 'at_border', 'customs', 'in_transit_mn'].includes(s.status)).length;
  const manufacturing = shipments.filter(s => s.status === 'preparing').length;
  const delivered = shipments.filter(s => s.status === 'delivered').length;
  const total_cost_mnt = costs.reduce((s, c) => s + (c.amount_mnt || 0), 0);
  const unpaid = costs.filter(c => !c.paid);

  res.json({
    total_shipments: shipments.length,
    in_transit,
    manufacturing,
    delivered,
    total_cost_mnt,
    unpaid_count: unpaid.length,
    unpaid_mnt: unpaid.reduce((s, c) => s + (c.amount_mnt || 0), 0)
  });
});

// ══════════════════════════════════════════
//  UNASSIGNED IMPORT PAYMENTS  (derived, read-only)
//  Memo-first: an "IMP:" bank transaction is the source of truth for an
//  import payment. It is considered ASSIGNED once an import_cost_ledger row
//  references it via transaction_id. Until then it surfaces here so the CEO
//  can link it to an import order. Derive-don't-store: nothing new persisted.
// ══════════════════════════════════════════
router.get('/unassigned-payments', (req, res) => {
  const db = load();
  const txs = db.transactions || [];
  const ledger = db.import_cost_ledger || [];
  const projects = db.import_projects || [];

  const linked = new Set(ledger.map(c => c.transaction_id).filter(Boolean));
  // Cost Workspace-д хуваарилагдсан төлбөрийг ч "холбогдсон" гэж тооцно (derive-don't-store).
  for (const w of (db.import_cost_workspaces || [])) for (const c of (w.costs || [])) if (c.transaction_id) linked.add(c.transaction_id);

  const payments = txs
    .filter(t => t.code === 'IMP' && !t.archived && !linked.has(t.id))
    .map(t => ({
      transaction_id: t.id,
      date: t.date,
      amount: t.amount,
      direction: t.direction,
      account: t.account,
      account_label: t.account_label,
      memo: t.note || t.description || t.raw_memo || '',
      counterparty: t.counterparty || null,
      is_foreign: t.is_foreign || false
    }))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  res.json({
    count: payments.length,
    total_mnt: payments.reduce((s, p) => s + (p.amount || 0), 0),
    payments,
    // Import orders available to assign a payment into (for the dropdown)
    orders: projects.map(p => ({
      id: p.id,
      code: p.code,
      name: p.name,
      supplier: p.supplier?.name || '',
      currency: p.currency || 'MNT'
    }))
  });
});

// ══════════════════════════════════════════
//  PAYMENT-DRIVEN ORDER TRACKER
//  The import module is a MONEY tracker, not a physical-goods tracker.
//  • An import "order" (захиалсан бараа) = an import_project.
//  • Its payments = IMP bank transactions linked to it.
//  • A good becomes "Складад орсон" (done) the moment its FINAL payment is
//    made — i.e. a linked payment is flagged import_final. Until then the good
//    is "Идэвхтэй" (active). Nothing here touches physical receive/inventory.
//  Linkage precedence: explicit tag (import_order_id) wins; otherwise we fall
//  back to the existing cost-ledger link so historical payments appear at once.
//  import_detached lets an admin fully unlink a payment (overrides the ledger).
// ══════════════════════════════════════════
router.get('/orders-tracker', (req, res) => {
  const db = load();
  const projects = db.import_projects || [];
  const txs = db.transactions || [];
  const ledger = db.import_cost_ledger || [];

  // tx.id -> project_id, derived from the existing cost ledger (first link wins)
  const ledgerProject = {};
  for (const c of ledger) {
    if (c.transaction_id && c.project_id && ledgerProject[c.transaction_id] == null) {
      ledgerProject[c.transaction_id] = c.project_id;
    }
  }
  const orderOf = (t) => {
    if (t.import_detached) return null;
    return t.import_order_id || ledgerProject[t.id] || null;
  };

  const toPayment = (t) => ({
    transaction_id: t.id,
    date: t.date,
    amount: t.amount,
    direction: t.direction,
    account: t.account,
    account_label: t.account_label,
    memo: t.note || t.description || t.raw_memo || '',
    counterparty: t.counterparty || null,
    is_foreign: t.is_foreign || false,
    is_final: t.import_final === true
  });

  // Cost Workspace-д хуваарилагдсан төлбөрийг ч "хуваарилсан" гэж тооцно (derive-don't-store).
  const wsLinked = new Set();
  for (const w of (db.import_cost_workspaces || [])) for (const c of (w.costs || [])) if (c.transaction_id) wsLinked.add(c.transaction_id);

  // Cost Workspace баталгаажсан (status='finalized') бол захиалга "дууссан" → "Складад орсон барааны эцсийн өртөг" таб руу автоматаар шилжинэ.
  const wsFinalized = {};
  for (const w of (db.import_cost_workspaces || [])) if (w.status === 'finalized') wsFinalized[w.order_id] = w.finalized_at || true;

  const paymentsByOrder = {};
  const unassigned = [];
  for (const t of txs) {
    if (t.code !== 'IMP' || t.archived) continue;
    const oid = orderOf(t);
    if (oid) (paymentsByOrder[oid] = paymentsByOrder[oid] || []).push(toPayment(t));
    else if (!wsLinked.has(t.id)) unassigned.push(toPayment(t));
  }
  Object.values(paymentsByOrder).forEach(a => a.sort((x, y) => (x.date || '').localeCompare(y.date || '')));
  unassigned.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const mapOrder = (p) => {
    const pays = paymentsByOrder[p.id] || [];
    const finals = pays.filter(x => x.is_final);
    const wsFinal = wsFinalized[p.id];
    const done = finals.length > 0 || !!wsFinal;
    return {
      id: p.id,
      code: p.code,
      name: p.name,
      supplier: p.supplier?.name || '',
      currency: p.currency || 'USD',
      created_at: p.created_at || null,
      payments: pays,
      payment_count: pays.length,
      total_paid_mnt: pays.reduce((s, x) => s + (x.amount || 0), 0),
      done,
      done_at: done ? (finals.length ? finals.map(f => f.date).sort().slice(-1)[0] : (typeof wsFinal === 'string' ? wsFinal.slice(0, 10) : null)) : null
    };
  };

  const all = projects.map(mapOrder);
  const active = all.filter(o => !o.done)
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  const done = all.filter(o => o.done)
    .sort((a, b) => (b.done_at || '').localeCompare(a.done_at || ''));

  res.json({
    active,
    done,
    unassigned,
    unassigned_total_mnt: unassigned.reduce((s, p) => s + (p.amount || 0), 0),
    orders: projects.map(p => ({
      id: p.id, code: p.code, name: p.name,
      supplier: p.supplier?.name || '', currency: p.currency || 'USD'
    }))
  });
});

// Link an IMP payment to an import order (and optionally flag it as the FINAL
// payment, which moves the good into "Складад орсон").
router.post('/assign-payment', adminOnly, (req, res) => {
  const db = load();
  const { transaction_id, order_id, is_final } = req.body;
  if (!transaction_id || !order_id) return res.status(400).json({ error: 'transaction_id, order_id шаардлагатай' });

  const tx = (db.transactions || []).find(t => t.id === transaction_id);
  if (!tx) return res.status(404).json({ error: 'Гүйлгээ олдсонгүй' });
  if (tx.code !== 'IMP') return res.status(400).json({ error: 'Зөвхөн IMP гүйлгээ холбоно' });

  const proj = (db.import_projects || []).find(p => p.id === order_id);
  if (!proj) return res.status(404).json({ error: 'Захиалга олдсонгүй' });

  tx.import_order_id = order_id;
  tx.import_final = is_final === true;
  tx.import_detached = false;
  save(db);
  res.json({ ok: true, transaction_id, order_id, is_final: tx.import_final });
});

// Detach an IMP payment from its order (also overrides any cost-ledger link).
router.post('/unassign-payment', adminOnly, (req, res) => {
  const db = load();
  const { transaction_id } = req.body;
  if (!transaction_id) return res.status(400).json({ error: 'transaction_id шаардлагатай' });

  const tx = (db.transactions || []).find(t => t.id === transaction_id);
  if (!tx) return res.status(404).json({ error: 'Гүйлгээ олдсонгүй' });

  tx.import_order_id = null;
  tx.import_final = false;
  tx.import_detached = true;
  save(db);
  res.json({ ok: true, transaction_id });
});

// ══════════════════════════════════════════
//  COST WORKSPACE (per good / Import Order) — read-only v1
//  The central per-good surface (freeze §10): money in (costs + linked bank
//  payments), line items (profiles) with DUAL UNITS — buy-unit (basis) ↔
//  stock-unit (catalog output) + conversion — and LOOSE reconciliation
//  (Ledger / Allocated / Difference; warn-not-block, freeze §12).
//  Shown on each warehoused (складад орсон) good. No mutation here.
// ══════════════════════════════════════════
router.get('/cost-workspace/:orderId', (req, res) => {
  const db = load();
  const order = (db.import_projects || []).find(p => p.id === req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Захиалга олдсонгүй' });

  // If the owner has begun editing this good, a workspace has been materialized
  // into db.import_cost_workspaces — serve the editable, deterministic version.
  // Otherwise fall back to the read-only v1 derive (preserves the 5 legacy goods).
  const ws = (db.import_cost_workspaces || []).find(w => w.order_id === order.id);
  if (ws) return res.json(cw.buildResponse(db, order, ws));

  const shipments = (db.import_shipments || []).filter(s => s.project_id === order.id);
  const shipIds = shipments.map(s => s.id);
  const lots = (db.import_lots || []).filter(l => shipIds.includes(l.shipment_id) && !l.is_sample);
  const allCosts = db.import_cost_ledger || [];
  const pcodes = db.import_product_codes || [];
  const txs = db.transactions || [];

  // cost-type → management bucket / capitalize tag (freeze §15)
  const bucketOf = (type) => {
    const t = (type || '').toLowerCase();
    if (t === 'product' || t === 'product_adjustment') return 'product';
    if (t.startsWith('freight')) return 'freight';
    if (t.includes('vat') || t === 'tax' || t.includes('duty')) return 'tax';
    if (t.startsWith('customs')) return 'customs';
    return 'other';
  };
  // 🟢 capitalize (goods landed cost) vs ⚪ period (general/period cost)
  const tagOf = (type) => {
    const t = (type || '').toLowerCase();
    if (t.includes('bank') || t.includes('fee') || t.startsWith('fx') || t.includes('fx_loss')) return 'period';
    return 'capitalize';
  };

  // costs recorded against this good (project_id is reliably set on every row)
  const txById = {}; for (const t of txs) txById[t.id] = t;
  const costRows = allCosts.filter(c => c.project_id === order.id).map(c => {
    const tx = c.transaction_id ? txById[c.transaction_id] : null;
    return {
      id: c.id, type: c.type, bucket: bucketOf(c.type), tag: tagOf(c.type),
      amount_mnt: c.amount_mnt || 0,
      note: c.description || '',
      payment: tx ? { date: tx.date, account_label: tx.account_label, memo: tx.note || tx.description || tx.raw_memo || '' } : null
    };
  });
  const ledgerTotal = costRows.reduce((s, c) => s + c.amount_mnt, 0);
  const capitalizeTotal = costRows.filter(c => c.tag === 'capitalize').reduce((s, c) => s + c.amount_mnt, 0);
  const periodTotal = costRows.filter(c => c.tag === 'period').reduce((s, c) => s + c.amount_mnt, 0);

  // Per-lot business numbers (mirror /final-cost so the stock-side matches the
  // эцсийн өртөг page). buy side = primary purchase unit (e.g. ton); stock side
  // = business unit from catalog (e.g. meter), bridged by conversion_factor.
  const lineBusiness = (lot) => {
    const pcode = pcodes.find(p => p.code === lot.product_code) || {};
    const invUnit = pcode.inventory_unit || lot.units?.primary?.unit || 'piece';
    const invQty = (lot.units?.primary?.unit === invUnit) ? (lot.units.primary.qty || 0)
      : (lot.units?.secondary?.unit === invUnit) ? (lot.units.secondary.qty || 0)
      : (lot.units?.secondary?.qty || lot.units?.primary?.qty || 0);
    const bizUnit = lot.business_unit || pcode.business_unit || invUnit;
    const factor = lot.conversion_factor || pcode.conversion_factor || 1;
    const bizQty = factor > 0 ? invQty / factor : invQty;
    return {
      buyUnit: lot.units?.primary?.unit || invUnit,
      buyQty: lot.units?.primary?.qty || invQty,
      stockUnit: bizUnit,
      stockQty: bizQty,
      factor
    };
  };

  const lines = lots.map(lot => {
    const b = lineBusiness(lot);
    const breakdown = { product: 0, freight: 0, customs: 0, tax: 0, other: 0 };
    for (const c of allCosts.filter(c => c.lot_id === lot.id)) breakdown[bucketOf(c.type)] += (c.amount_mnt || 0);
    for (const a of (lot.allocations || [])) breakdown[bucketOf(a.cost_type)] += (a.final_value || 0);
    const pcode = pcodes.find(p => p.code === lot.product_code) || {};
    const allocated = lot.total_cost_mnt || 0;
    return {
      lot_id: lot.id,
      name: lot.product?.name || pcode.name || lot.product_code,
      spec: lot.product?.spec || '',
      image: lot.product?.image || pcode.image || null,
      buy_unit: b.buyUnit, buy_qty: Math.round(b.buyQty * 1000) / 1000,
      stock_unit: b.stockUnit, stock_qty: Math.round(b.stockQty * 100) / 100,
      conversion_factor: b.factor,
      same_unit: b.stockUnit === b.buyUnit || b.factor === 1,
      allocated_mnt: allocated,
      unit_cost_stock: b.stockQty > 0 ? Math.round(allocated / b.stockQty) : 0,
      breakdown
    };
  });
  const allocatedTotal = lines.reduce((s, l) => s + l.allocated_mnt, 0);

  // Linked bank payments (traceability — each good lists its IMP payments).
  // Same derivation as /orders-tracker: explicit tag, else cost-ledger derived.
  const ledgerProject = {};
  for (const c of allCosts) if (c.transaction_id && c.project_id && ledgerProject[c.transaction_id] == null) ledgerProject[c.transaction_id] = c.project_id;
  const payments = txs.filter(t => t.code === 'IMP' && !t.archived && !t.import_detached
      && (t.import_order_id === order.id || ledgerProject[t.id] === order.id))
    .map(t => ({ transaction_id: t.id, date: t.date, amount: t.amount,
      account_label: t.account_label, memo: t.note || t.description || t.raw_memo || '',
      is_final: t.import_final === true }))
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  res.json({
    order: { id: order.id, code: order.code, name: order.name, supplier: order.supplier?.name || '', currency: order.currency || 'USD' },
    costs: costRows,
    ledger_total_mnt: ledgerTotal,
    capitalize_total_mnt: capitalizeTotal,
    period_total_mnt: periodTotal,
    lines,
    line_count: lines.length,
    allocated_total_mnt: allocatedTotal,
    difference_mnt: ledgerTotal - allocatedTotal,
    basis_hint: 'weight',
    payments,
    payment_total_mnt: payments.reduce((s, p) => s + (p.amount || 0), 0)
  });
});

// ── Cost Workspace EDITING layer (additive — never mutates lots/inventory) ──
//  All writes live in db.import_cost_workspaces. The owner materializes a
//  workspace (seeded from legacy lots/ledger or linked IMP payments), then
//  edits нэр төрөл (lines) and costs; the app does the deterministic
//  allocation (lib/cost_workspace.js). Finalize freezes it (guard: ≥1 line,
//  every line stock_qty>0). Admin-only. Складыг хөндөхгүй.

function findOrder(db, id) { return (db.import_projects || []).find(p => p.id === id); }
function findWs(db, orderId) { return (db.import_cost_workspaces || []).find(w => w.order_id === orderId); }
function touch(ws, who) { ws.updated_at = new Date().toISOString(); ws.updated_by = who || 'admin'; }
function guardOpen(ws, res) {
  if (ws.status === 'finalized') { res.status(409).json({ error: 'Баталгаажсан — засахын тулд эхлээд нээнэ үү' }); return false; }
  return true;
}

// Materialize (idempotent): seed a workspace so it becomes editable.
router.post('/cost-workspace/:orderId/materialize', adminOnly, (req, res) => {
  const db = load();
  const order = findOrder(db, req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Захиалга олдсонгүй' });
  const ws = cw.materialize(db, order, req.user?.username || req.user?.name || 'admin');
  save(db);
  res.json(cw.buildResponse(db, order, ws));
});

// Basis (weight | value | qty)
router.put('/cost-workspace/:orderId/basis', adminOnly, (req, res) => {
  const db = load();
  const order = findOrder(db, req.params.orderId);
  const ws = findWs(db, req.params.orderId);
  if (!order || !ws) return res.status(404).json({ error: 'Workspace олдсонгүй' });
  if (!guardOpen(ws, res)) return;
  const basis = (req.body?.basis || '').toLowerCase();
  if (!['weight', 'value', 'qty'].includes(basis)) return res.status(400).json({ error: 'basis: weight|value|qty' });
  ws.basis = basis;
  touch(ws, req.user?.username);
  save(db);
  res.json(cw.buildResponse(db, order, ws));
});

// ── Lines (нэр төрөл) ──
router.post('/cost-workspace/:orderId/line', adminOnly, (req, res) => {
  const db = load();
  const order = findOrder(db, req.params.orderId);
  const ws = findWs(db, req.params.orderId);
  if (!order || !ws) return res.status(404).json({ error: 'Workspace олдсонгүй' });
  if (!guardOpen(ws, res)) return;
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'name шаардлагатай' });
  const buyUnit = b.buy_unit || 'piece';
  const stockUnit = b.stock_unit || buyUnit;
  const factor = Number(b.conversion_factor) || 1;
  const buyQty = Number(b.buy_qty) || 0;
  let weightKg = b.weight_kg != null ? Number(b.weight_kg) : null;
  if (weightKg == null) {
    if (buyUnit.toLowerCase() === 'ton') weightKg = buyQty * 1000;
    else if (buyUnit.toLowerCase() === 'kg') weightKg = buyQty;
  }
  const line = {
    id: cw.rid('wl_'),
    product_code: b.product_code || null,
    name: b.name,
    spec: b.spec || '',
    buy_qty: Math.round(buyQty * 1000) / 1000,
    buy_unit: buyUnit,
    stock_qty: Math.round((Number(b.stock_qty) || 0) * 100) / 100,
    stock_unit: stockUnit,
    conversion_factor: factor,
    weight_kg: weightKg,
    source: 'manual',
    created_at: new Date().toISOString(),
    created_by: req.user?.username || 'admin'
  };
  ws.lines = ws.lines || [];
  ws.lines.push(line);
  touch(ws, req.user?.username);
  save(db);
  res.json(cw.buildResponse(db, order, ws));
});

router.put('/cost-workspace/:orderId/line/:lineId', adminOnly, (req, res) => {
  const db = load();
  const order = findOrder(db, req.params.orderId);
  const ws = findWs(db, req.params.orderId);
  if (!order || !ws) return res.status(404).json({ error: 'Workspace олдсонгүй' });
  if (!guardOpen(ws, res)) return;
  const line = (ws.lines || []).find(l => l.id === req.params.lineId);
  if (!line) return res.status(404).json({ error: 'Нэр төрөл олдсонгүй' });
  const b = req.body || {};
  if (b.name != null) line.name = b.name;
  if (b.spec != null) line.spec = b.spec;
  if (b.product_code != null) line.product_code = b.product_code || null;
  if (b.buy_unit != null) line.buy_unit = b.buy_unit;
  if (b.stock_unit != null) line.stock_unit = b.stock_unit;
  if (b.buy_qty != null) line.buy_qty = Math.round((Number(b.buy_qty) || 0) * 1000) / 1000;
  if (b.stock_qty != null) line.stock_qty = Math.round((Number(b.stock_qty) || 0) * 100) / 100;
  if (b.conversion_factor != null) line.conversion_factor = Number(b.conversion_factor) || 1;
  if (b.weight_kg !== undefined) line.weight_kg = b.weight_kg === null || b.weight_kg === '' ? null : Number(b.weight_kg);
  else {
    // keep weight_kg in sync when buy side changes and no explicit override
    const u = (line.buy_unit || '').toLowerCase();
    if (u === 'ton') line.weight_kg = (line.buy_qty || 0) * 1000;
    else if (u === 'kg') line.weight_kg = line.buy_qty || 0;
  }
  touch(ws, req.user?.username);
  save(db);
  res.json(cw.buildResponse(db, order, ws));
});

router.delete('/cost-workspace/:orderId/line/:lineId', adminOnly, (req, res) => {
  const db = load();
  const order = findOrder(db, req.params.orderId);
  const ws = findWs(db, req.params.orderId);
  if (!order || !ws) return res.status(404).json({ error: 'Workspace олдсонгүй' });
  if (!guardOpen(ws, res)) return;
  const n = (ws.lines || []).length;
  ws.lines = (ws.lines || []).filter(l => l.id !== req.params.lineId);
  if (ws.lines.length === n) return res.status(404).json({ error: 'Нэр төрөл олдсонгүй' });
  // detach any direct costs that pointed at the removed line → become shared
  for (const c of (ws.costs || [])) if (c.line_id === req.params.lineId) { c.line_id = null; c.scope = 'shared'; }
  touch(ws, req.user?.username);
  save(db);
  res.json(cw.buildResponse(db, order, ws));
});

// ── Costs (🟢 capitalize / ⚪ period) ──
router.post('/cost-workspace/:orderId/cost', adminOnly, (req, res) => {
  const db = load();
  const order = findOrder(db, req.params.orderId);
  const ws = findWs(db, req.params.orderId);
  if (!order || !ws) return res.status(404).json({ error: 'Workspace олдсонгүй' });
  if (!guardOpen(ws, res)) return;
  const b = req.body || {};
  const type = b.type || 'other';
  const tag = (b.tag === 'capitalize' || b.tag === 'period') ? b.tag : cw.defaultTagOf(type);
  const scope = b.scope === 'direct' ? 'direct' : 'shared';
  const line_id = scope === 'direct' ? (b.line_id || null) : null;
  if (scope === 'direct' && !(ws.lines || []).some(l => l.id === line_id)) return res.status(400).json({ error: 'direct cost-д хүчинтэй line_id хэрэгтэй' });
  const cost = {
    id: cw.rid('wc_'),
    type,
    tag,
    scope,
    line_id,
    amount_mnt: Math.round(Number(b.amount_mnt) || 0),
    transaction_id: b.transaction_id || null,
    note: b.note || '',
    source: 'manual',
    created_at: new Date().toISOString(),
    created_by: req.user?.username || 'admin'
  };
  ws.costs = ws.costs || [];
  ws.costs.push(cost);
  touch(ws, req.user?.username);
  save(db);
  res.json(cw.buildResponse(db, order, ws));
});

router.put('/cost-workspace/:orderId/cost/:costId', adminOnly, (req, res) => {
  const db = load();
  const order = findOrder(db, req.params.orderId);
  const ws = findWs(db, req.params.orderId);
  if (!order || !ws) return res.status(404).json({ error: 'Workspace олдсонгүй' });
  if (!guardOpen(ws, res)) return;
  const cost = (ws.costs || []).find(c => c.id === req.params.costId);
  if (!cost) return res.status(404).json({ error: 'Зардал олдсонгүй' });
  const b = req.body || {};
  if (b.type != null) cost.type = b.type;
  if (b.tag === 'capitalize' || b.tag === 'period') cost.tag = b.tag;
  if (b.note != null) cost.note = b.note;
  if (b.amount_mnt != null) cost.amount_mnt = Math.round(Number(b.amount_mnt) || 0);
  if (b.scope != null) {
    cost.scope = b.scope === 'direct' ? 'direct' : 'shared';
    if (cost.scope === 'shared') cost.line_id = null;
  }
  if (b.line_id !== undefined && cost.scope === 'direct') {
    if (b.line_id && !(ws.lines || []).some(l => l.id === b.line_id)) return res.status(400).json({ error: 'Буруу line_id' });
    cost.line_id = b.line_id || null;
  }
  touch(ws, req.user?.username);
  save(db);
  res.json(cw.buildResponse(db, order, ws));
});

router.delete('/cost-workspace/:orderId/cost/:costId', adminOnly, (req, res) => {
  const db = load();
  const order = findOrder(db, req.params.orderId);
  const ws = findWs(db, req.params.orderId);
  if (!order || !ws) return res.status(404).json({ error: 'Workspace олдсонгүй' });
  if (!guardOpen(ws, res)) return;
  const n = (ws.costs || []).length;
  ws.costs = (ws.costs || []).filter(c => c.id !== req.params.costId);
  if (ws.costs.length === n) return res.status(404).json({ error: 'Зардал олдсонгүй' });
  touch(ws, req.user?.username);
  save(db);
  res.json(cw.buildResponse(db, order, ws));
});

// ── Finalize / Reopen (freeze §11 lifecycle) ──
router.post('/cost-workspace/:orderId/finalize', adminOnly, (req, res) => {
  const db = load();
  const order = findOrder(db, req.params.orderId);
  const ws = findWs(db, req.params.orderId);
  if (!order || !ws) return res.status(404).json({ error: 'Workspace олдсонгүй' });
  if (ws.status === 'finalized') return res.status(409).json({ error: 'Аль хэдийн баталгаажсан' });
  const lines = ws.lines || [];
  if (!lines.length) return res.status(400).json({ error: 'Дор хаяж 1 нэр төрөл хэрэгтэй' });
  const bad = lines.filter(l => !(Number(l.stock_qty) > 0));
  if (bad.length) return res.status(400).json({ error: 'Бүх нэр төрлийн склад тоо хэмжээ > 0 байх ёстой', lines: bad.map(l => l.name) });
  ws.status = 'finalized';
  ws.finalized_at = new Date().toISOString();
  ws.finalized_by = req.user?.username || 'admin';
  touch(ws, req.user?.username);
  save(db);
  res.json(cw.buildResponse(db, order, ws));
});

router.post('/cost-workspace/:orderId/reopen', adminOnly, (req, res) => {
  const db = load();
  const order = findOrder(db, req.params.orderId);
  const ws = findWs(db, req.params.orderId);
  if (!order || !ws) return res.status(404).json({ error: 'Workspace олдсонгүй' });
  ws.status = 'draft';
  ws.finalized_at = null;
  ws.finalized_by = null;
  touch(ws, req.user?.username);
  save(db);
  res.json(cw.buildResponse(db, order, ws));
});

// ══════════════════════════════════════════
//  SHIPMENTS
// ══════════════════════════════════════════
router.get('/shipments', (req, res) => {
  const db = load();
  const shipments = db.import_shipments || [];
  const projects = db.import_projects || [];
  const lots = db.import_lots || [];
  const costs = db.import_cost_ledger || [];

  // Enrich each shipment with project name and summary
  const result = shipments.map(s => {
    const proj = projects.find(p => p.id === s.project_id);
    const sLots = lots.filter(l => l.shipment_id === s.id);
    const sCosts = costs.filter(c => c.shipment_id === s.id);
    const totalPaid = sCosts.filter(c => c.paid).reduce((sum, c) => sum + (c.amount_mnt || 0), 0);
    const totalCost = sCosts.reduce((sum, c) => sum + (c.amount_mnt || 0), 0);

    return {
      ...s,
      project_name: proj?.name || '',
      supplier_name: proj?.supplier?.name || '',
      lot_count: sLots.length,
      total_cost_mnt: totalCost,
      total_paid_mnt: totalPaid,
      payment_pct: totalCost > 0 ? Math.round(totalPaid / totalCost * 100) : 0
    };
  });

  // Sort: in_transit first, then preparing, then delivered
  const priority = { in_transit_cn: 0, at_border: 1, customs: 2, in_transit_mn: 3, preparing: 4, delivered: 5 };
  result.sort((a, b) => (priority[a.status] ?? 9) - (priority[b.status] ?? 9));

  res.json(result);
});

// ══════════════════════════════════════════
//  COST ANALYSIS — management view (per product)
//  Inventory units remain source of truth; business unit is derived for display.
//  business_unit_cost = inventory_unit_cost × conversion_factor
// ══════════════════════════════════════════
router.get('/cost-analysis', (req, res) => {
  const db = load();
  const lots = (db.import_lots || []).filter(l => !l.is_sample);
  const shipments = db.import_shipments || [];
  const costs = db.import_cost_ledger || [];
  const pcodes = db.import_product_codes || [];

  // Bucket a cost-ledger type into management categories
  const bucketOf = (type) => {
    const t = (type || '').toLowerCase();
    if (t === 'product' || t === 'product_adjustment') return 'product';
    if (t.startsWith('freight')) return 'freight';
    if (t.includes('vat') || t === 'tax' || t.includes('duty')) return 'tax';
    if (t.startsWith('customs')) return 'customs';
    return 'other';
  };

  // Inventory-unit quantity of a lot (the unit warehouse/valuation uses)
  const invQtyOf = (l, invUnit) => {
    if (l.units?.primary?.unit === invUnit) return l.units.primary.qty || 0;
    if (l.units?.secondary?.unit === invUnit) return l.units.secondary.qty || 0;
    // fallback: prefer secondary (finer) then primary
    return l.units?.secondary?.qty || l.units?.primary?.qty || 0;
  };

  // Group lots by product code
  const groups = {};
  for (const l of lots) (groups[l.product_code] = groups[l.product_code] || []).push(l);

  const result = Object.entries(groups).map(([code, glots]) => {
    const pcode = pcodes.find(p => p.code === code) || {};
    const invUnit = pcode.inventory_unit || glots[0].units?.primary?.unit || 'piece';
    const bizUnit = pcode.business_unit || invUnit;
    const factor = pcode.conversion_factor || 1;
    const convType = pcode.conversion_type || 'identity';

    const totalLanded = glots.reduce((s, l) => s + (l.total_cost_mnt || 0), 0);
    const totalInvQty = glots.reduce((s, l) => s + invQtyOf(l, invUnit), 0);
    const invUnitCost = totalInvQty > 0 ? Math.round(totalLanded / totalInvQty) : 0;
    const bizQty = factor > 0 ? totalInvQty / factor : totalInvQty;
    const bizUnitCost = Math.round(invUnitCost * factor);

    // Cost breakdown across this product's shipments
    const shipIds = [...new Set(glots.map(l => l.shipment_id))];
    const gcosts = costs.filter(c => shipIds.includes(c.shipment_id));
    const breakdown = { product: 0, freight: 0, customs: 0, tax: 0, other: 0 };
    for (const c of gcosts) breakdown[bucketOf(c.type)] += (c.amount_mnt || 0);

    // Trend history — one point per shipment, chronological
    const trend = shipIds.map(sid => {
      const ship = shipments.find(s => s.id === sid) || {};
      const sLots = glots.filter(l => l.shipment_id === sid);
      const sLanded = sLots.reduce((s, l) => s + (l.total_cost_mnt || 0), 0);
      const sInvQty = sLots.reduce((s, l) => s + invQtyOf(l, invUnit), 0);
      const sInvCost = sInvQty > 0 ? Math.round(sLanded / sInvQty) : 0;
      return {
        shipment_code: ship.code || sid,
        date: ship.delivered_at || ship.shipped_at || ship.created_at || '',
        status: ship.status || '',
        total_landed_cost: sLanded,
        inventory_unit_cost: sInvCost,
        business_unit_cost: Math.round(sInvCost * factor)
      };
    }).sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    // Aggregate status
    const statuses = shipIds.map(sid => (shipments.find(s => s.id === sid) || {}).status);
    const status = statuses.length && statuses.every(s => s === 'delivered')
      ? 'delivered' : (trend[trend.length - 1]?.status || statuses[0] || '');

    return {
      product_code: code,
      product_name: pcode.name || code,
      category: pcode.category || '',
      lot_count: glots.length,
      shipment_count: shipIds.length,
      inventory_unit: invUnit,
      business_unit: bizUnit,
      conversion_factor: factor,
      conversion_type: convType,
      total_qty_inventory: Math.round(totalInvQty * 100) / 100,
      total_qty_business: Math.round(bizQty * 100) / 100,
      total_landed_cost: totalLanded,
      inventory_unit_cost: invUnitCost,
      business_unit_cost: bizUnitCost,
      breakdown,
      trend,
      status,
      allocated: totalLanded > 0
    };
  });

  result.sort((a, b) => b.total_landed_cost - a.total_landed_cost);
  res.json(result);
});

// ══════════════════════════════════════════
//  PRE-WAREHOUSE FINAL LANDED COST
//  Per shipment, one row per lot (= per profile/хийцлэл for steel).
//  Shows the final landed cost in business units BEFORE goods are received,
//  in the same profile→₮/meter table format management reviews.
// ══════════════════════════════════════════
router.get('/final-cost', (req, res) => {
  const db = load();
  // Per-good scope: ?order=<projectId> → only that good's shipments.
  // The all-goods list view was dropped (useless); callers pass an order.
  const orderFilter = req.query.order || null;
  const shipments = (db.import_shipments || []).filter(s => !orderFilter || s.project_id === orderFilter);
  const allLots = (db.import_lots || []).filter(l => !l.is_sample);
  const costs = db.import_cost_ledger || [];
  const pcodes = db.import_product_codes || [];
  const projects = db.import_projects || [];

  const bucketOf = (type) => {
    const t = (type || '').toLowerCase();
    if (t === 'product' || t === 'product_adjustment') return 'product';
    if (t.startsWith('freight')) return 'freight';
    if (t.includes('vat') || t === 'tax' || t.includes('duty')) return 'tax';
    if (t.startsWith('customs')) return 'customs';
    return 'other';
  };

  // Business numbers for a single lot. Per-lot business_unit/conversion_factor
  // (e.g. steel profile kg/m) override the product-code default when present.
  const lotBusiness = (lot) => {
    const pcode = pcodes.find(p => p.code === lot.product_code) || {};
    const invUnit = pcode.inventory_unit || lot.units?.primary?.unit || 'piece';
    const invQty = (lot.units?.primary?.unit === invUnit) ? (lot.units.primary.qty || 0)
      : (lot.units?.secondary?.unit === invUnit) ? (lot.units.secondary.qty || 0)
      : (lot.units?.secondary?.qty || lot.units?.primary?.qty || 0);
    const bizUnit = lot.business_unit || pcode.business_unit || invUnit;
    const factor = lot.conversion_factor || pcode.conversion_factor || 1;
    const bizQty = factor > 0 ? invQty / factor : invQty;
    const total = lot.total_cost_mnt || 0;
    return {
      invUnit, invQty, bizUnit, factor, bizQty,
      invCost: invQty > 0 ? Math.round(total / invQty) : 0,
      bizCost: bizQty > 0 ? Math.round(total / bizQty) : 0
    };
  };

  const shipRows = shipments.map(ship => {
    const lots = allLots.filter(l => l.shipment_id === ship.id);
    if (!lots.length) return null;
    const project = projects.find(p => p.id === ship.project_id) || {};

    const rows = lots.map(lot => {
      const b = lotBusiness(lot);
      const breakdown = { product: 0, freight: 0, customs: 0, tax: 0, other: 0 };
      for (const c of costs.filter(c => c.lot_id === lot.id)) breakdown[bucketOf(c.type)] += (c.amount_mnt || 0);
      for (const a of (lot.allocations || [])) breakdown[bucketOf(a.cost_type)] += (a.final_value || 0);
      const pcode = pcodes.find(p => p.code === lot.product_code) || {};
      return {
        lot_id: lot.id,
        name: lot.product?.name || lot.product_code,
        image: lot.product?.image || pcode.image || null,
        spec: lot.product?.spec || '',
        inventory_unit: b.invUnit,
        inventory_qty: Math.round(b.invQty * 100) / 100,
        business_unit: b.bizUnit,
        business_qty: Math.round(b.bizQty * 100) / 100,
        conversion_factor: b.factor,
        same_unit: b.bizUnit === b.invUnit || b.factor === 1,
        total_landed_cost: lot.total_cost_mnt || 0,
        inventory_unit_cost: b.invCost,
        business_unit_cost: b.bizCost,
        breakdown,
        warehouse_status: lot.warehouse_status || 'not_received',
        allocated: (lot.total_cost_mnt || 0) > 0
      };
    });

    const totalLanded = rows.reduce((s, r) => s + r.total_landed_cost, 0);
    const allReceived = lots.every(l => l.warehouse_status === 'received');
    const anyReceived = lots.some(l => l.warehouse_status === 'received');

    // Header name: single product code → its name; multiple models → family / shipment desc
    const distinctCodes = [...new Set(lots.map(l => l.product_code))];
    const headerName = distinctCodes.length === 1
      ? (pcodes.find(p => p.code === distinctCodes[0])?.name || distinctCodes[0])
      : (ship.description || (pcodes.find(p => p.code === distinctCodes[0])?.family) || 'Олон загвар');

    return {
      shipment_code: ship.code,
      project_id: ship.project_id || null,
      status: ship.status,
      reference_image: ship.reference_image || null,
      supplier: project.supplier?.name || '',
      product_code: distinctCodes.length === 1 ? distinctCodes[0] : (pcodes.find(p => p.code === distinctCodes[0])?.family || distinctCodes[0]),
      product_name: headerName,
      date: ship.delivered_at || ship.shipped_at || ship.created_at || '',
      lot_count: lots.length,
      total_landed_cost: totalLanded,
      all_allocated: rows.every(r => r.allocated),
      warehouse_state: allReceived ? 'received' : anyReceived ? 'partial' : 'pending',
      rows
    };
  }).filter(Boolean);

  shipRows.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  res.json(shipRows);
});

router.get('/shipment/:code', (req, res) => {
  const db = load();
  const shipment = (db.import_shipments || []).find(s => s.code === req.params.code);
  if (!shipment) return res.status(404).json({ error: 'Ачилт олдсонгүй' });

  const project = (db.import_projects || []).find(p => p.id === shipment.project_id);
  const lots = (db.import_lots || []).filter(l => l.shipment_id === shipment.id);
  const costs = (db.import_cost_ledger || []).filter(c => c.shipment_id === shipment.id);

  // Cost summary by type group
  const costGroups = {};
  for (const c of costs) {
    const group = c.type.startsWith('freight') ? 'freight'
      : c.type.startsWith('customs') ? 'customs'
      : c.type === 'product' || c.type === 'product_adjustment' ? 'product'
      : c.type.startsWith('bank') || c.type === 'fx_loss' ? 'bank'
      : 'other';
    costGroups[group] = (costGroups[group] || 0) + (c.amount_mnt || 0);
  }

  // Check allocation status
  const sharedCosts = costs.filter(c => !c.lot_id);
  const nonSampleLots = lots.filter(l => !l.is_sample);
  const totalAllocated = nonSampleLots.reduce((s, l) => s + (l.total_allocated_mnt || 0), 0);
  const directCostsMnt = costs.filter(c => c.lot_id).reduce((s, c) => s + (c.amount_mnt || 0), 0);
  const totalCostMnt = costs.reduce((s, c) => s + (c.amount_mnt || 0), 0);
  const sharedCostMnt = sharedCosts.reduce((s, c) => s + (c.amount_mnt || 0), 0);

  const unallocated = sharedCosts.filter(c => {
    const allocatedTotal = nonSampleLots.reduce((s, l) => {
      const alloc = (l.allocations || []).find(a => a.cost_ledger_id === c.id);
      return s + (alloc ? alloc.final_value : 0);
    }, 0);
    return Math.abs(allocatedTotal - (c.amount_mnt || 0)) > 1;
  });

  const balanced = unallocated.length === 0 && sharedCosts.length > 0
    ? Math.abs(totalAllocated - sharedCostMnt) <= 1
    : sharedCosts.length === 0;

  // Landed Cost Readiness checks
  const warnings = [];
  const paidCosts = costs.filter(c => c.paid);
  const unpaidCosts = costs.filter(c => !c.paid);
  if (unpaidCosts.length) warnings.push({ type: 'unpaid', msg: `${unpaidCosts.length} төлөөгүй зардал (${unpaidCosts.reduce((s,c)=>s+(c.amount_mnt||0),0).toLocaleString()}₮)` });
  if (unallocated.length) warnings.push({ type: 'unallocated', msg: `${unallocated.length} хуваарилаагүй зардал` });
  if (!nonSampleLots.length) warnings.push({ type: 'no_lots', msg: 'Lot бүртгэгдээгүй' });
  const hasFreight = costs.some(c => c.type.startsWith('freight'));
  if (!hasFreight && shipment.status !== 'preparing') warnings.push({ type: 'no_freight', msg: 'Тээврийн зардал бүртгэгдээгүй' });
  const hasCustoms = costs.some(c => c.type.startsWith('customs'));
  if (!hasCustoms && shipment.status === 'delivered') warnings.push({ type: 'no_customs', msg: 'Гаалийн зардал бүртгэгдээгүй' });
  const unreceived = nonSampleLots.filter(l => l.warehouse_status === 'not_received');
  const canReceive = warnings.length === 0 && nonSampleLots.length > 0 && balanced;

  // Enrich costs with linked bank transaction data
  const txs = db.transactions || [];
  const enrichedCosts = costs.map(c => {
    const linked = c.transaction_id ? txs.find(t => t.id === c.transaction_id) : null;
    return {
      ...c,
      linked_tx: linked ? {
        id: linked.id,
        date: linked.date,
        counterparty: linked.counterparty,
        amount: linked.amount,
        account: linked.account,
        category: linked.category,
        memo: linked.memo
      } : null
    };
  });

  // Product codes for display
  const productCodes = db.import_product_codes || [];

  res.json({
    shipment,
    project: project ? { id: project.id, code: project.code, name: project.name, supplier: project.supplier, type: project.type } : null,
    lots,
    costs: enrichedCosts,
    cost_summary: costGroups,
    total_cost_mnt: totalCostMnt,
    direct_cost_mnt: directCostsMnt,
    shared_cost_mnt: sharedCostMnt,
    total_allocated_mnt: totalAllocated,
    unallocated_count: unallocated.length,
    unallocated_ids: unallocated.map(c => c.id),
    all_allocated: unallocated.length === 0,
    balanced,
    readiness: {
      can_receive: canReceive,
      warnings,
      unreceived_lots: unreceived.length,
      total_lots: nonSampleLots.length,
      sample_lots: lots.filter(l => l.is_sample).length
    },
    product_codes: productCodes
  });
});

router.post('/shipments', adminOnly, (req, res) => {
  const db = load();
  const b = req.body;
  if (!b.project_id || !b.product_code) return res.status(400).json({ error: 'project_id, product_code шаардлагатай' });

  const project = (db.import_projects || []).find(p => p.id === b.project_id);
  if (!project) return res.status(404).json({ error: 'Төсөл олдсонгүй' });

  const pcode = (db.import_product_codes || []).find(p => p.code === b.product_code);
  if (!pcode) return res.status(404).json({ error: 'Бүтээгдэхүүний код олдсонгүй' });

  // Auto-generate shipment code: {PRODUCT_CODE}-{YEAR}-{SEQ}
  const year = new Date().getFullYear();
  const isSample = b.is_sample || false;
  const existing = (db.import_shipments || []).filter(s =>
    s.code.startsWith(b.product_code + '-' + year) && !s.code.endsWith('-S')
  );
  const seq = String(existing.length + 1).padStart(3, '0');
  let code = b.product_code + '-' + year + '-' + seq;
  if (isSample) code += '-S';

  // Auto-generate ID
  db.import_shipments = db.import_shipments || [];
  const maxId = db.import_shipments.reduce((m, s) => {
    const n = parseInt((s.id || '').replace('ship_', ''), 10);
    return n > m ? n : m;
  }, 0);

  const shipment = {
    id: 'ship_' + String(maxId + 1).padStart(3, '0'),
    code,
    project_id: project.id,
    description: b.description || '',
    status: b.status || 'preparing',
    route: b.route || '',
    shipped_at: b.shipped_at || null,
    delivered_at: null,
    freight_method: b.freight_method || null,
    freight_company: b.freight_company || null,
    total_weight_kg: b.total_weight_kg || null,
    notes: b.notes || '',
    activity_log: [{
      date: new Date().toISOString().slice(0, 10),
      event: 'Ачилт үүсгэсэн',
      by: req.user.name || req.user.username
    }],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  db.import_shipments.push(shipment);
  save(db);
  res.json({ id: shipment.id, code: shipment.code });
});

router.put('/shipments/:code', adminOnly, (req, res) => {
  const db = load();
  const idx = (db.import_shipments || []).findIndex(s => s.code === req.params.code);
  if (idx === -1) return res.status(404).json({ error: 'Олдсонгүй' });

  const allowed = ['status', 'route', 'shipped_at', 'delivered_at', 'freight_method', 'freight_company', 'total_weight_kg', 'notes'];
  for (const k of allowed) {
    if (req.body[k] !== undefined) db.import_shipments[idx][k] = req.body[k];
  }
  db.import_shipments[idx].updated_at = new Date().toISOString();

  if (req.body.activity_event) {
    db.import_shipments[idx].activity_log = db.import_shipments[idx].activity_log || [];
    db.import_shipments[idx].activity_log.push({
      date: new Date().toISOString().slice(0, 10),
      event: req.body.activity_event,
      by: req.user.name || req.user.username
    });
  }

  save(db);
  res.json({ ok: true });
});

// ══════════════════════════════════════════
//  LOTS
// ══════════════════════════════════════════
router.post('/lots', adminOnly, (req, res) => {
  const db = load();
  const b = req.body;
  if (!b.shipment_id || !b.product_code) return res.status(400).json({ error: 'shipment_id, product_code шаардлагатай' });

  const shipment = (db.import_shipments || []).find(s => s.id === b.shipment_id);
  if (!shipment) return res.status(404).json({ error: 'Ачилт олдсонгүй' });

  const pcode = (db.import_product_codes || []).find(p => p.code === b.product_code);

  // Auto-calculate secondary unit qty
  let secondaryUnit = null;
  if (pcode && pcode.secondary_unit) {
    secondaryUnit = {
      unit: pcode.secondary_unit,
      qty: pcode.conversion ? b.units_primary_qty * pcode.conversion : (b.units_secondary_qty || null),
      conversion: pcode.conversion || null,
      landed_cost: 0
    };
  }

  const maxId = (db.import_lots || []).reduce((m, l) => {
    const n = parseInt((l.id || '').replace('lot_', ''), 10);
    return n > m ? n : m;
  }, 0);

  const lot = {
    id: 'lot_' + String(maxId + 1).padStart(3, '0'),
    project_id: shipment.project_id,
    shipment_id: shipment.id,
    shipment_code: shipment.code,
    product_code: b.product_code,
    product: b.product || { name: '', hs_code: '', spec: '', category: 'raw_material' },
    units: {
      primary: { unit: pcode?.primary_unit || b.unit || 'piece', qty: b.units_primary_qty || b.qty || 0, landed_cost: 0 },
      secondary: secondaryUnit
    },
    unit_price: b.unit_price || 0,
    currency: b.currency || 'MNT',
    exchange_rate: b.exchange_rate || 1,
    product_cost: (b.unit_price || 0) * (b.units_primary_qty || b.qty || 0),
    product_cost_mnt: 0,
    allocations: [],
    total_allocated_mnt: 0,
    total_cost_mnt: 0,
    is_sample: b.is_sample || false,
    sample_purpose: b.sample_purpose || null,
    sample_parent_lot: b.sample_parent_lot || null,
    inventory_item_id: b.inventory_item_id || null,
    warehouse_status: 'not_received',
    received_qty: null,
    received_at: null,
    received_by: null,
    quality_check: null,
    quality_notes: null,
    created_at: new Date().toISOString()
  };
  lot.product_cost_mnt = Math.round(lot.product_cost * lot.exchange_rate);

  db.import_lots = db.import_lots || [];
  db.import_lots.push(lot);
  save(db);
  res.json({ id: lot.id });
});

router.put('/lots/:id', adminOnly, (req, res) => {
  const db = load();
  const idx = (db.import_lots || []).findIndex(l => l.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Lot олдсонгүй' });

  const allowed = ['product', 'units', 'unit_price', 'currency', 'exchange_rate',
    'product_cost', 'product_cost_mnt', 'is_sample', 'sample_purpose',
    'warehouse_status', 'received_qty', 'received_at', 'received_by',
    'quality_check', 'quality_notes', 'inventory_item_id'];
  for (const k of allowed) {
    if (req.body[k] !== undefined) db.import_lots[idx][k] = req.body[k];
  }
  save(db);
  res.json({ ok: true });
});

router.delete('/lots/:id', adminOnly, (req, res) => {
  const db = load();
  const idx = (db.import_lots || []).findIndex(l => l.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Lot олдсонгүй' });
  const lot = db.import_lots[idx];
  if (lot.warehouse_status === 'received') return res.status(400).json({ error: 'Хүлээн авсан lot устгах боломжгүй' });
  db.import_lots.splice(idx, 1);
  save(db);
  res.json({ ok: true });
});

// ══════════════════════════════════════════
//  COST LEDGER
// ══════════════════════════════════════════
router.post('/costs', adminOnly, (req, res) => {
  const db = load();
  const b = req.body;
  if (!b.project_id || !b.type) return res.status(400).json({ error: 'project_id, type шаардлагатай' });
  if (b.type === 'other' && !b.description) return res.status(400).json({ error: 'Тодорхойлолт шаардлагатай (other type)' });

  const maxId = (db.import_cost_ledger || []).reduce((m, c) => {
    const n = parseInt((c.id || '').replace('cost_', ''), 10);
    return n > m ? n : m;
  }, 0);

  const cost = {
    id: 'cost_' + String(maxId + 1).padStart(3, '0'),
    project_id: b.project_id,
    shipment_id: b.shipment_id || null,
    shipment_code: b.shipment_code || null,
    lot_id: b.lot_id || null,
    type: b.type,
    description: b.description || '',
    amount: b.amount || 0,
    currency: b.currency || 'MNT',
    exchange_rate: b.exchange_rate || null,
    amount_mnt: b.amount_mnt || Math.round((b.amount || 0) * (b.exchange_rate || 1)),
    payment_method: b.payment_method || 'bank_transfer',
    payment_account: b.payment_account || 'tdb',
    payment_reference: b.payment_reference || null,
    transaction_id: b.transaction_id || null,
    paid: b.paid !== undefined ? b.paid : true,
    paid_at: b.paid_at || (b.paid !== false ? new Date().toISOString().slice(0, 10) : null),
    due_date: b.due_date || null,
    allocation_method: b.allocation_method || (b.lot_id ? 'direct' : 'by_weight'),
    allocation_locked: false,
    created_at: new Date().toISOString(),
    created_by: req.user.name || req.user.username,
    modified_at: null,
    modified_by: null,
    modification_log: []
  };

  db.import_cost_ledger = db.import_cost_ledger || [];
  db.import_cost_ledger.push(cost);
  save(db);
  res.json({ id: cost.id });
});

router.put('/costs/:id', adminOnly, (req, res) => {
  const db = load();
  const idx = (db.import_cost_ledger || []).findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Зардал олдсонгүй' });
  const cost = db.import_cost_ledger[idx];

  if (cost.allocation_locked) return res.status(403).json({ error: 'Түгжигдсэн зардал засах боломжгүй' });

  const b = req.body;
  const logEntry = { date: new Date().toISOString(), by: req.user.name || req.user.username, changes: [] };

  const allowed = ['type', 'description', 'amount', 'currency', 'exchange_rate', 'amount_mnt',
    'payment_method', 'payment_account', 'payment_reference', 'transaction_id',
    'paid', 'paid_at', 'due_date', 'allocation_method'];
  for (const k of allowed) {
    if (b[k] !== undefined && b[k] !== cost[k]) {
      logEntry.changes.push({ field: k, old: cost[k], new: b[k] });
      cost[k] = b[k];
    }
  }
  if (logEntry.changes.length) {
    cost.modified_at = new Date().toISOString();
    cost.modified_by = req.user.name || req.user.username;
    cost.modification_log.push(logEntry);
  }
  save(db);
  res.json({ ok: true });
});

router.delete('/costs/:id', adminOnly, (req, res) => {
  const db = load();
  const idx = (db.import_cost_ledger || []).findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Зардал олдсонгүй' });
  const cost = db.import_cost_ledger[idx];
  if (cost.allocation_locked) return res.status(400).json({ error: 'Түгжигдсэн зардал устгах боломжгүй' });
  // Remove any allocations referencing this cost
  for (const lot of (db.import_lots || [])) {
    if (lot.allocations) {
      lot.allocations = lot.allocations.filter(a => a.cost_ledger_id !== cost.id);
    }
  }
  db.import_cost_ledger.splice(idx, 1);
  save(db);
  res.json({ ok: true });
});

// ══════════════════════════════════════════
//  ALLOCATION ENGINE
// ══════════════════════════════════════════
router.post('/allocate/:shipmentCode', adminOnly, (req, res) => {
  const db = load();
  const shipment = (db.import_shipments || []).find(s => s.code === req.params.shipmentCode);
  if (!shipment) return res.status(404).json({ error: 'Ачилт олдсонгүй' });

  const lots = (db.import_lots || []).filter(l => l.shipment_id === shipment.id && !l.is_sample);
  const allCosts = (db.import_cost_ledger || []).filter(c => c.shipment_id === shipment.id);
  const costs = allCosts.filter(c => !c.lot_id); // Shared costs to allocate

  if (!lots.length) return res.status(400).json({ error: 'Lot байхгүй' });

  // Calculate ratios
  const totalWeight = lots.reduce((s, l) => s + (l.units?.primary?.qty || 0), 0);
  const totalValue = lots.reduce((s, l) => s + (l.product_cost_mnt || 0), 0);
  const totalPieces = lots.reduce((s, l) => {
    const sec = l.units?.secondary;
    return s + (sec ? sec.qty || 0 : l.units?.primary?.qty || 0);
  }, 0);
  const lotCount = lots.length;

  function getRatios(method) {
    return lots.map((l, i) => {
      if (method === 'by_weight') return totalWeight > 0 ? (l.units?.primary?.qty || 0) / totalWeight : 1 / lotCount;
      if (method === 'by_value') return totalValue > 0 ? (l.product_cost_mnt || 0) / totalValue : 1 / lotCount;
      if (method === 'by_qty') return totalPieces > 0 ? ((l.units?.secondary?.qty || l.units?.primary?.qty || 0) / totalPieces) : 1 / lotCount;
      if (method === 'equal') return 1 / lotCount;
      return 1 / lotCount;
    });
  }

  const warnings = [];

  // For each shared cost, allocate across lots
  for (const cost of costs) {
    if (cost.allocation_locked) { warnings.push(`${cost.id} түгжигдсэн, алгассан`); continue; }

    const ratios = getRatios(cost.allocation_method || 'by_weight');
    let remaining = cost.amount_mnt || 0;

    for (let i = 0; i < lots.length; i++) {
      const lot = lots[i];
      lot.allocations = lot.allocations || [];

      // Find or create allocation record for this cost
      let alloc = lot.allocations.find(a => a.cost_ledger_id === cost.id);
      if (!alloc) {
        alloc = {
          cost_ledger_id: cost.id,
          cost_type: cost.type,
          auto_method: cost.allocation_method || 'by_weight',
          auto_ratio: 0,
          auto_value: 0,
          manual_override: null,
          override_reason: null,
          overridden_by: null,
          overridden_at: null,
          final_value: 0,
          locked: false,
          locked_by: null,
          locked_at: null
        };
        lot.allocations.push(alloc);
      }

      alloc.auto_method = cost.allocation_method || 'by_weight';
      alloc.auto_ratio = ratios[i];

      if (i === lots.length - 1) {
        // Last lot gets remainder (prevents rounding drift)
        const othersSum = lots.slice(0, -1).reduce((s, ol) => {
          const oa = (ol.allocations || []).find(a => a.cost_ledger_id === cost.id);
          return s + (oa ? oa.auto_value : 0);
        }, 0);
        alloc.auto_value = (cost.amount_mnt || 0) - othersSum;
      } else {
        alloc.auto_value = Math.round((cost.amount_mnt || 0) * ratios[i]);
      }

      alloc.final_value = alloc.manual_override !== null ? alloc.manual_override : alloc.auto_value;
    }

    // Balance check
    const allocSum = lots.reduce((s, l) => {
      const a = (l.allocations || []).find(a => a.cost_ledger_id === cost.id);
      return s + (a ? a.final_value : 0);
    }, 0);
    if (Math.abs(allocSum - (cost.amount_mnt || 0)) > 1) {
      warnings.push(`${cost.id}: тэнцэл зөрсөн (${allocSum} vs ${cost.amount_mnt})`);
    }
  }

  // Recalculate landed costs for each lot
  // total_cost = direct costs (lot_id set in cost_ledger) + allocated shared costs
  for (const lot of lots) {
    const directCostsMnt = allCosts.filter(c => c.lot_id === lot.id).reduce((s, c) => s + (c.amount_mnt || 0), 0);
    lot.total_allocated_mnt = (lot.allocations || []).reduce((s, a) => s + (a.final_value || 0), 0);
    lot.total_cost_mnt = directCostsMnt + lot.total_allocated_mnt;

    const pQty = lot.units?.primary?.qty || 1;
    if (lot.units?.primary) lot.units.primary.landed_cost = Math.round(lot.total_cost_mnt / pQty);
    if (lot.units?.secondary && lot.units.secondary.qty) {
      lot.units.secondary.landed_cost = Math.round(lot.total_cost_mnt / lot.units.secondary.qty);
    }
  }

  // Also allocate to sample lots
  const sampleLots = (db.import_lots || []).filter(l => l.shipment_id === shipment.id && l.is_sample);
  for (const sl of sampleLots) {
    const directCostsMnt = allCosts.filter(c => c.lot_id === sl.id).reduce((s, c) => s + (c.amount_mnt || 0), 0);
    sl.total_allocated_mnt = (sl.allocations || []).reduce((s, a) => s + (a.final_value || 0), 0);
    sl.total_cost_mnt = directCostsMnt + sl.total_allocated_mnt;
    const pQty = sl.units?.primary?.qty || 1;
    if (sl.units?.primary) sl.units.primary.landed_cost = Math.round(sl.total_cost_mnt / pQty);
    if (sl.units?.secondary && sl.units.secondary.qty) {
      sl.units.secondary.landed_cost = Math.round(sl.total_cost_mnt / sl.units.secondary.qty);
    }
  }

  save(db);

  const balanced = warnings.filter(w => w.includes('тэнцэл')).length === 0;
  res.json({
    ok: true,
    balanced,
    warnings,
    lots: lots.map(l => ({
      id: l.id,
      product_name: l.product?.name,
      total_cost_mnt: l.total_cost_mnt,
      primary: l.units?.primary,
      secondary: l.units?.secondary
    }))
  });
});

// Manual override
router.put('/allocate/override', adminOnly, (req, res) => {
  const db = load();
  const { lot_id, cost_ledger_id, manual_override, override_reason } = req.body;

  if (!lot_id || !cost_ledger_id) return res.status(400).json({ error: 'lot_id, cost_ledger_id шаардлагатай' });
  if (manual_override !== null && !override_reason) return res.status(400).json({ error: 'Шалтгаан оруулна уу' });

  const lot = (db.import_lots || []).find(l => l.id === lot_id);
  if (!lot) return res.status(404).json({ error: 'Lot олдсонгүй' });

  const alloc = (lot.allocations || []).find(a => a.cost_ledger_id === cost_ledger_id);
  if (!alloc) return res.status(404).json({ error: 'Allocation олдсонгүй' });
  if (alloc.locked) return res.status(403).json({ error: 'Түгжигдсэн' });

  alloc.manual_override = manual_override;
  alloc.override_reason = override_reason;
  alloc.overridden_by = req.user.name || req.user.username;
  alloc.overridden_at = new Date().toISOString();
  alloc.final_value = manual_override !== null ? manual_override : alloc.auto_value;

  // Recalculate lot landed cost
  const directCostsMnt = (db.import_cost_ledger || []).filter(c => c.lot_id === lot.id).reduce((s, c) => s + (c.amount_mnt || 0), 0);
  lot.total_allocated_mnt = (lot.allocations || []).reduce((s, a) => s + (a.final_value || 0), 0);
  lot.total_cost_mnt = directCostsMnt + lot.total_allocated_mnt;
  const pQty = lot.units?.primary?.qty || 1;
  if (lot.units?.primary) lot.units.primary.landed_cost = Math.round(lot.total_cost_mnt / pQty);
  if (lot.units?.secondary && lot.units.secondary.qty) {
    lot.units.secondary.landed_cost = Math.round(lot.total_cost_mnt / lot.units.secondary.qty);
  }

  // Check balance for this cost
  const cost = (db.import_cost_ledger || []).find(c => c.id === cost_ledger_id);
  const shipmentLots = (db.import_lots || []).filter(l => l.shipment_id === lot.shipment_id && !l.is_sample);
  const allocSum = shipmentLots.reduce((s, l) => {
    const a = (l.allocations || []).find(a => a.cost_ledger_id === cost_ledger_id);
    return s + (a ? a.final_value : 0);
  }, 0);
  const balanced = cost ? Math.abs(allocSum - (cost.amount_mnt || 0)) <= 1 : true;

  save(db);
  res.json({ ok: true, balanced, alloc_sum: allocSum, cost_total: cost?.amount_mnt });
});

// ══════════════════════════════════════════
//  WAREHOUSE RECEIVING
//  Value integrity rule: total_value is source of truth.
//  cost_per_unit is derived (display only). Never use qty × cpu for valuation.
// ══════════════════════════════════════════
router.post('/receive/:lotId', adminOrWarehouse, (req, res) => {
  const db = load();
  const lot = (db.import_lots || []).find(l => l.id === req.params.lotId);
  if (!lot) return res.status(404).json({ error: 'Lot олдсонгүй' });
  if (lot.warehouse_status === 'received') return res.status(400).json({ error: 'Аль хэдийн хүлээн авсан' });
  if (lot.is_sample) return res.status(400).json({ error: 'Загвар бараа склад бүртгэлд орохгүй' });
  if (!lot.total_cost_mnt || lot.total_cost_mnt === 0) return res.status(400).json({ error: 'Landed cost тооцоолоогүй — allocation хийнэ үү' });

  const { received_qty, received_unit, quality_check, quality_notes } = req.body;
  if (!received_qty || received_qty <= 0) return res.status(400).json({ error: 'Тоо хэмжээ оруулна уу' });

  // Determine inventory unit from product code
  const pcode = (db.import_product_codes || []).find(p => p.code === lot.product_code);
  const inventoryUnit = pcode?.inventory_unit || lot.units?.primary?.unit || 'piece';

  // Convert received_qty to inventory_unit
  let invQty = received_qty;
  const recUnit = received_unit || lot.units?.primary?.unit;
  if (recUnit !== inventoryUnit && pcode?.conversion) {
    if (recUnit === pcode.primary_unit && inventoryUnit === pcode.secondary_unit) {
      invQty = received_qty * pcode.conversion;
    } else if (recUnit === pcode.secondary_unit && inventoryUnit === pcode.primary_unit) {
      invQty = received_qty / pcode.conversion;
    }
  }

  // ── VALUE INTEGRITY: use exact lot cost, not rounded per-unit ──
  // lot.total_cost_mnt is the exact allocated cost from the cost ledger.
  // cost_per_unit is derived for display only.
  const exactTotalCost = lot.total_cost_mnt;
  const costPerUnit = invQty > 0 ? Math.round(exactTotalCost / invQty) : 0;

  // Update lot
  lot.warehouse_status = 'received';
  lot.received_qty = received_qty;
  lot.received_unit = recUnit;
  lot.received_at = new Date().toISOString();
  lot.received_by = req.user.name || req.user.username;
  lot.quality_check = quality_check || 'ok';
  lot.quality_notes = quality_notes || null;

  // Check variance
  const expectedPrimary = lot.units?.primary?.qty || 0;
  if (recUnit === lot.units?.primary?.unit && Math.abs(received_qty - expectedPrimary) > 0.001) {
    lot.warehouse_status = 'discrepancy';
    lot.quality_check = received_qty < expectedPrimary ? 'shortage' : 'excess';
  }

  // Create inventory_log entry
  db.inventory_log = db.inventory_log || [];
  const logId = db.inventory_log.length + 1;
  const invLogEntry = {
    id: logId,
    item_id: lot.inventory_item_id,
    item_code: lot.product_code,
    item_name: lot.product?.name || '',
    type: 'in',
    source: 'import',
    source_id: lot.id,
    shipment_code: lot.shipment_code,
    qty: invQty,
    unit: inventoryUnit,
    unit_cost: costPerUnit,
    total_cost: exactTotalCost,
    before_qty: 0,
    before_value: 0,
    after_qty: invQty,
    after_value: exactTotalCost,
    by: req.user.name || req.user.username,
    by_role: req.user.role,
    date: new Date().toISOString().slice(0, 10),
    created_at: new Date().toISOString()
  };

  // Update inventory item if linked
  if (lot.inventory_item_id) {
    const inv = (db.inventory || []).find(i => i.id === lot.inventory_item_id || i.code === lot.inventory_item_id);
    if (inv) {
      // Initialize total_value if missing (legacy items)
      if (inv.total_value === undefined) {
        inv.total_value = (inv.qty || 0) * (inv.cost_per_unit || 0);
      }

      const oldQty = inv.qty || 0;
      const oldValue = inv.total_value || 0;

      invLogEntry.before_qty = oldQty;
      invLogEntry.before_value = oldValue;

      // Exact value accumulation — no rounding drift
      inv.qty = oldQty + invQty;
      inv.total_value = oldValue + exactTotalCost;
      inv.cost_per_unit = inv.qty > 0 ? Math.round(inv.total_value / inv.qty) : 0;

      invLogEntry.after_qty = inv.qty;
      invLogEntry.after_value = inv.total_value;

      // ── INTEGRITY CHECK ──
      // Sum of all import log entries for this item must equal inv.total_value
      const importLogs = (db.inventory_log || []).filter(l =>
        l.source === 'import' && (l.item_id === inv.id || l.item_code === inv.code) && l.type === 'in'
      );
      const sumLogCosts = importLogs.reduce((s, l) => s + (l.total_cost || 0), 0) + exactTotalCost;
      // Only check if no other source types (manufacturing, transfer) exist yet
      const otherLogs = (db.inventory_log || []).filter(l =>
        (l.item_id === inv.id || l.item_code === inv.code) && l.source !== 'import'
      );
      if (otherLogs.length === 0 && sumLogCosts !== inv.total_value) {
        return res.status(500).json({
          error: 'Inventory Integrity Error',
          detail: `Sum(received lot costs) = ${sumLogCosts}₮ ≠ inventory.total_value = ${inv.total_value}₮`,
          diff: sumLogCosts - inv.total_value
        });
      }
    }
  }

  db.inventory_log.push(invLogEntry);
  save(db);

  res.json({
    ok: true,
    inventory_log_id: logId,
    inventory_unit: inventoryUnit,
    inventory_qty: invQty,
    cost_per_unit: costPerUnit,
    exact_total_cost: exactTotalCost,
    lot_status: lot.warehouse_status
  });
});

module.exports = router;
