const { PDFParse } = require('pdf-parse');

// ── Convert 12-hour time to 24-hour ──
function to24h(time12, ampm) {
  const [h, m, s] = time12.split(':');
  let hour = parseInt(h, 10);
  if (ampm === 'AM' && hour === 12) hour = 0;
  if (ampm === 'PM' && hour !== 12) hour += 12;
  return String(hour).padStart(2, '0') + ':' + m + ':' + s;
}

// ── Parse Khan Bank statement ──
// Format: № date time branch start_balance amount [or -amount] end_balance description counterparty
function parseKhanBank(text) {
  const transactions = [];
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // Find IBAN to get account number
  let accountNumber = '';
  for (const line of lines) {
    const m = line.match(/MN\d{16,20}/);
    if (m) { accountNumber = m[0]; break; }
  }

  // Find transaction rows. Format starts with: "N YYYY/MM/DD HH:MM ..."
  // Some descriptions span multiple lines, so we combine.
  const rows = [];
  let current = '';
  for (const line of lines) {
    if (/^\d+\s+20\d{2}\/\d{2}\/\d{2}\s+\d{2}:\d{2}/.test(line)) {
      if (current) rows.push(current);
      current = line;
    } else if (current && !line.startsWith('Нийт') && !line.includes('Хуудас') && !line.includes('Мэдээлсэн')) {
      current += ' ' + line;
    }
  }
  if (current) rows.push(current);

  for (const row of rows) {
    // Parse: № YYYY/MM/DD HH:MM branch <numbers> description
    // The numbers are: start_balance, credit_or_debit (negative for debit), end_balance
    const m = row.match(/^(\d+)\s+(20\d{2}\/\d{2}\/\d{2})\s+(\d{2}:\d{2})\s+(\d+)\s+(.+)$/);
    if (!m) continue;

    const [, num, date, time, branch, rest] = m;

    // Extract all number-like tokens with comma separators
    const numberPattern = /-?[\d,]+\.\d{2}/g;
    const numbers = rest.match(numberPattern) || [];
    if (numbers.length < 3) continue;

    const start_balance = parseFloat(numbers[0].replace(/,/g, ''));
    const amount        = parseFloat(numbers[1].replace(/,/g, ''));
    const end_balance   = parseFloat(numbers[2].replace(/,/g, ''));

    // Determine direction
    const direction = amount < 0 ? 'debit' : 'credit';
    const absAmount = Math.abs(amount);

    // Get description: everything after the 3 numbers
    let descPart = rest;
    for (const n of numbers.slice(0, 3)) {
      descPart = descPart.replace(n, '');
    }

    // Counterparty is usually the last number sequence (account number) at the end
    const counterpartyMatch = descPart.match(/\b(\d{9,20})\s*$/);
    let counterparty = '';
    let description = descPart;
    if (counterpartyMatch) {
      counterparty = counterpartyMatch[1];
      description = descPart.replace(counterpartyMatch[0], '');
    }

    description = description.replace(/--\s*\d+\s*of\s*\d+\s*--/gi, '').replace(/\s+/g, ' ').trim();

    transactions.push({
      account:        accountNumber,
      account_label:  'Хаан банк (Касс)',
      date:           date.replace(/\//g, '-'),
      time,
      direction,
      amount:         absAmount,
      balance_after:  end_balance,
      description,
      counterparty,
      seq:            parseInt(num),
    });
  }

  return { account: accountNumber, account_label: 'Хаан банк (Касс)', transactions };
}

// ── Parse TDB statement ──
// Multi-line format: date / time / AM-PM / teller / amount / balance / description / counterparty
function parseTDB(text) {
  const transactions = [];
  const lines = text.split('\n').map(l => l.trim());

  // Find IBAN
  let accountNumber = '';
  for (const line of lines) {
    const m = line.match(/MN\d{16,20}/);
    if (m) { accountNumber = m[0]; break; }
  }

  // Walk through lines looking for date pattern (YYYY/MM/DD)
  for (let i = 0; i < lines.length; i++) {
    const dateMatch = lines[i].match(/^(20\d{2}\/\d{2}\/\d{2})$/);
    if (!dateMatch) continue;

    const date = dateMatch[1].replace(/\//g, '-');
    // Next line should be time, then AM/PM
    if (i + 2 >= lines.length) continue;
    const time   = lines[i + 1];
    const ampm   = lines[i + 2];

    if (!/^\d{2}:\d{2}:\d{2}$/.test(time)) continue;
    if (!/^(AM|PM)$/.test(ampm)) continue;

    // Next line: teller code + amounts + description
    // e.g. "400 - 59 25,000.00 25,000.00 САРУУЛСАЙХАН-с\t103300328331\t1"
    // or "490 - 50 10,000,000.00 281,694,500.00 EB -5 сарын цалин\tMN950004000499218740\t1"
    // Description may span multiple lines
    const dataLine = lines[i + 3];
    if (!dataLine) continue;

    // Collect description continuation lines until next date or specific terminators
    let dataBlock = dataLine;
    let j = i + 4;
    while (j < lines.length) {
      const ln = lines[j];
      if (/^20\d{2}\/\d{2}\/\d{2}$/.test(ln)) break;
      if (ln === 'Нийт:' || ln.startsWith('Хуудас') || ln.startsWith('Дансны тодорхойлолт')) break;
      if (ln.startsWith('Баталгаажуулах')) break;
      dataBlock += ' ' + ln;
      j++;
    }

    // Parse the dataBlock
    // Format: "TELLER amount1 amount2 description [counterparty] [rate]"
    // or: "TELLER amount balance description counterparty rate"
    const m = dataBlock.match(/^(\d+)\s*-\s*(\d+)\s+(.+)$/);
    if (!m) { i = j - 1; continue; }
    const teller = m[1] + '-' + m[2];
    const rest = m[3];

    // Find all numbers in the rest
    const numberPattern = /[\d,]+\.\d{2}/g;
    const allNumbers = rest.match(numberPattern) || [];
    if (allNumbers.length < 2) { i = j - 1; continue; }

    // The TDB format has: Орлого, Зарлага, ... Үлдэгдэл
    // So we need to determine which is which.
    // Strategy: balance_after is always present (last currency before description usually)
    // But due to text extraction, balance comes BEFORE description typically.
    // Two amounts present means: either [income, balance] or [expense, balance]
    // We can tell by checking if balance increased or decreased from previous transaction.

    // Simpler: take first 2 numbers as the two values, larger context tells us direction
    const v1 = parseFloat(allNumbers[0].replace(/,/g, ''));
    const v2 = parseFloat(allNumbers[1].replace(/,/g, ''));

    // The smaller is usually the transaction amount, larger is the balance
    // But not always. Use previous transaction's balance to determine.
    const prevBalance = transactions.length > 0
      ? transactions[transactions.length - 1].balance_after
      : null;

    let amount, balance, direction;
    if (prevBalance !== null) {
      // Compare v2 (likely balance) with prev balance
      if (Math.abs(v2 - prevBalance - v1) < 0.01) {
        // v2 = prev + v1 → credit (income)
        amount = v1; balance = v2; direction = 'credit';
      } else if (Math.abs(prevBalance - v2 - v1) < 0.01) {
        // v2 = prev - v1 → debit (expense)
        amount = v1; balance = v2; direction = 'debit';
      } else if (Math.abs(v1 - prevBalance - v2) < 0.01) {
        amount = v2; balance = v1; direction = 'credit';
      } else if (Math.abs(prevBalance - v1 - v2) < 0.01) {
        amount = v2; balance = v1; direction = 'debit';
      } else {
        // Default: smaller = amount, larger = balance, guess credit if balance > prev else debit
        amount = Math.min(v1, v2);
        balance = Math.max(v1, v2);
        direction = balance > prevBalance ? 'credit' : 'debit';
      }
    } else {
      // First transaction — assume v1 = amount, v2 = balance
      amount = v1; balance = v2; direction = 'credit';
    }

    // Get description: text after the two numbers
    let desc = rest;
    for (const n of [allNumbers[0], allNumbers[1]]) {
      desc = desc.replace(n, '');
    }

    // Extract counterparty (account number or IBAN at end)
    let counterparty = '';
    const cpMatch = desc.match(/(MN\d{16,20}|\b\d{9,20}\b)/);
    if (cpMatch) {
      counterparty = cpMatch[1];
      desc = desc.replace(cpMatch[0], '');
    }

    // Remove trailing "1" (ханш = 1)
    desc = desc.replace(/\s+1\s*$/, '').replace(/--\s*\d+\s*of\s*\d+\s*--/gi, '').replace(/\s+/g, ' ').trim();

    // Override direction using memo code if present (more reliable than balance heuristic)
    const memo = parseMemo(desc);
    if (memo.code && MEMO_CODES[memo.code]) {
      const codeType = MEMO_CODES[memo.code].type;
      const codeDir = ['revenue','capital','asset_in','refund'].includes(codeType) ? 'credit' : 'debit';
      if (codeDir !== direction) {
        // Verify with balance: if code says debit, check prevBalance - amount ≈ balance
        const checkBal = codeDir === 'credit' ? (prevBalance||0) + amount : (prevBalance||0) - amount;
        if (prevBalance === null || Math.abs(checkBal - balance) < 0.01) {
          direction = codeDir;
        }
      }
    }

    transactions.push({
      account:        accountNumber,
      account_label:  'TDB (Компани)',
      date,
      time:           to24h(time, ampm),
      direction,
      amount,
      balance_after:  balance,
      description:    desc,
      counterparty,
      teller,
      seq:            transactions.length + 1,
    });

    i = j - 1;
  }

  return { account: accountNumber, account_label: 'TDB (Компани)', transactions };
}

// ── Auto-detect & parse ──
async function parsePDF(buffer) {
  const p = new PDFParse({ data: buffer });
  const data = await p.getText();
  const text = data.text;

  // Detect bank type
  if (text.includes('ХААН БАНК') || text.includes('Депозит дансны дэлгэрэнгүй хуулга')) {
    return { bank: 'khan', ...parseKhanBank(text) };
  } else if (text.includes('ХУДАЛДАА ХӨГЖЛИЙН БАНК') || text.includes('TDB') || text.includes('МЕТАЛВОРКИНГ ЦЕНТР ХХК')) {
    return { bank: 'tdb', ...parseTDB(text) };
  } else {
    throw new Error('Unknown bank format');
  }
}

// ── Memo code definitions ──
const MEMO_CODES = {
  SALE:     { type: 'revenue',    color: 'green',  label: 'Бүрэн төлсөн борлуулалт' },
  REC:      { type: 'revenue',    color: 'green',  label: 'Авлага үлдэгдэл орсон' },
  ADV:      { type: 'pending',    color: 'amber',  label: 'Урьдчилгаа (хүлээгдэж буй)' },
  INV:      { type: 'capital',    color: 'green',  label: 'Хөрөнгө оруулагчаас' },
  LOAN_IN:  { type: 'asset_in',   color: 'green',  label: 'Зээл буцаагдсан' },
  LOAN_OUT: { type: 'receivable', color: 'blue',   label: 'Зээл олгосон' },
  IMP:      { type: 'expense',    color: 'blue',   label: 'Импорт' },
  SAL:      { type: 'expense',    color: 'blue',   label: 'Цалин' },
  TRN:      { type: 'expense',    color: 'blue',   label: 'Тээвэр/логистик' },
  TRIP:     { type: 'expense',    color: 'blue',   label: 'Томилолт (тийз, орчуулагч, өдрийн зардал)' },
  EQP:      { type: 'expense',    color: 'blue',   label: 'Тоног төхөөрөмж' },
  ASSET:    { type: 'expense',    color: 'blue',   label: 'Компани эд хөрөнгө' },
  TAX:      { type: 'expense',    color: 'blue',   label: 'Татвар/даатгал' },
  OFF:      { type: 'expense',    color: 'blue',   label: 'Оффисын зардал' },
  UTIL:     { type: 'expense',    color: 'blue',   label: 'Тогтмол төлбөр' },
  MAT:      { type: 'expense',    color: 'blue',   label: 'Дотоод материал (хуучин — MAT_WH/MAT_PROD ашиглана уу)' },
  MAT_WH:   { type: 'expense',    color: 'blue',   label: 'Складын материал (дотоод худалдан авалт)',     module: 'warehouse' },
  MAT_PROD: { type: 'expense',    color: 'blue',   label: 'Үйлдвэрлэлийн материал (дотоод худалдан авалт)', module: 'production' },
  MAR:      { type: 'expense',    color: 'purple', label: 'Маркетинг (контент, борлуулалтын комисс)' },
  SUB:      { type: 'expense',    color: 'teal',   label: 'Захиалгат үйлчилгээ (Claude, GitHub, интернет)' },
  FEE:      { type: 'expense',    color: 'blue',   label: 'Банкны шимтгэл' },
  REFUND:   { type: 'refund',     color: 'amber',  label: 'Зардлын буцаалт (илүү төлсөн мөнгө буцсан)' },
  TRF:      { type: 'transfer',   color: 'gray',   label: 'Данс хооронд (дүнд орохгүй)' },
  OTHER:    { type: 'unknown',    color: 'blue',   label: 'Бусад' },
};

// ── Detect foreign currency transactions ──
function isForeignTx(desc) {
  return /payment of material|payment for|proforma|invoice|yongding|pingyun|metalwork|hs\s*code|гадаад/i.test(desc);
}

// ── Parse memo: extract code (CODE: description format) ──
// Required format: "КОД: тайлбар" — uppercase Latin code, then colon, then Cyrillic description
// Backward compat: also accepts "КОД тайлбар" (space only) for old entries
function parseMemo(rawDesc) {
  const desc = (rawDesc || '').trim();
  // Strip leading "EB -" prefix that TDB adds for online transfers
  const cleaned = desc.replace(/^EB\s*-?\s*/i, '').trim();

  // Preferred format: CODE: description (colon + optional space)
  const m1 = cleaned.match(/^([A-Z][A-Z_]{1,9})\s*:\s*(.*)$/);
  if (m1 && MEMO_CODES[m1[1]]) {
    return { code: m1[1], description: m1[2].trim(), needs_review: false };
  }

  // Backward compat: CODE description (just space)
  const m2 = cleaned.match(/^([A-Z][A-Z_]{1,9})\b\s+(.+)$/);
  if (m2 && MEMO_CODES[m2[1]]) {
    return { code: m2[1], description: m2[2].trim(), needs_review: false };
  }

  // Standalone code (no description)
  const m3 = cleaned.match(/^([A-Z][A-Z_]{1,9})\b$/);
  if (m3 && MEMO_CODES[m3[1]]) {
    return { code: m3[1], description: '', needs_review: false };
  }

  return { code: null, description: cleaned, needs_review: true };
}

// ── Auto-detect category for legacy transactions or unrecognized memos ──
function detectCategory(tx) {
  const desc = (tx.description || '').toLowerCase();

  // FEE is automatic regardless of memo
  if (/шимтгэл|хураамж/i.test(desc)) {
    return { code: 'FEE', needs_review: false };
  }

  // Try memo parse first
  const parsed = parseMemo(tx.description);
  if (parsed.code) return { code: parsed.code, needs_review: false };

  // Otherwise mark as needing review
  return { code: null, needs_review: true };
}

module.exports.MEMO_CODES = MEMO_CODES;
module.exports.isForeignTx = isForeignTx;
module.exports.parseMemo = parseMemo;

// Generate stable transaction ID for deduplication
function txId(tx) {
  const key = `${tx.account}_${tx.date}_${tx.time}_${tx.direction}_${tx.amount}_${tx.balance_after}`;
  return require('crypto').createHash('md5').update(key).digest('hex').slice(0, 16);
}

module.exports.parsePDF = parsePDF;
module.exports.parseKhanBank = parseKhanBank;
module.exports.parseTDB = parseTDB;
module.exports.detectCategory = detectCategory;
module.exports.txId = txId;
