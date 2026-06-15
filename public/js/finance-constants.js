/**
 * Finance Constants — Single Source of Truth
 * Бүх санхүүгийн код, ангилал, helper функцүүд энд байна.
 * Шинэ код нэмэхдээ ЭНД нэмнэ, бусад файлд hardcode хийхгүй.
 *
 * Backend-ийн canonical source: lib/pdf_parser.js MEMO_CODES
 * Frontend-ийн canonical source: энэ файл
 */

const FINANCE_CODES = {
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
  MAT_WH:   { type: 'expense',    color: 'blue',   label: 'Складын материал (дотоод худалдан авалт)',       module: 'warehouse' },
  MAT_PROD: { type: 'expense',    color: 'blue',   label: 'Үйлдвэрлэлийн материал (дотоод худалдан авалт)',  module: 'production' },
  MAR:      { type: 'expense',    color: 'purple', label: 'Маркетинг (контент, борлуулалтын комисс)' },
  SUB:      { type: 'expense',    color: 'teal',   label: 'Захиалгат үйлчилгээ (Claude, GitHub, интернет)' },
  FEE:      { type: 'expense',    color: 'blue',   label: 'Банкны шимтгэл' },
  REFUND:   { type: 'refund',     color: 'amber',  label: 'Зардлын буцаалт (илүү төлсөн мөнгө буцсан)' },
  TRF:      { type: 'transfer',   color: 'gray',   label: 'Данс хооронд (дүнд орохгүй)' },
  OTHER:    { type: 'unknown',    color: 'blue',   label: 'Бусад' },
  CLAUDE:   { type: 'expense',    color: 'purple', label: 'Хуваарилаагүй зардал (Claude задлах)' },
};

// Grouped for review screens
const CODE_GROUPS = [
  { label: '\u{1F7E2} Орлого',  codes: ['SALE','REC','ADV','INV'], cls: 'income' },
  { label: '\u{1F535} Зарлага', codes: ['IMP','SAL','TRN','TRIP','EQP','ASSET','TAX','OFF','UTIL','MAT_WH','MAT_PROD','MAR','SUB','FEE'], cls: 'expense' },
  { label: '\u{1F916} Claude задлах', codes: ['CLAUDE'], cls: 'special' },
  { label: '↩️ Буцаалт',   codes: ['REFUND'], cls: 'refund' },
  { label: '\u{1F504} Зээл',   codes: ['LOAN_IN','LOAN_OUT'], cls: 'loan' },
  { label: '⚪ Тусгай',     codes: ['TRF','OTHER'], cls: 'gray' },
];

// Derived arrays
const INCOME_CODES  = ['SALE','REC','ADV','INV'];
const EXPENSE_CODES = ['IMP','SAL','TRN','TRIP','EQP','ASSET','TAX','OFF','UTIL','MAT','MAT_WH','MAT_PROD','MAR','SUB','FEE','OTHER','CLAUDE'];
const LOAN_CODES    = ['LOAN_IN','LOAN_OUT'];
const SALES_CODES   = ['SALE','REC','ADV'];
const REFUND_CODES  = ['REFUND'];
const ALL_CODES     = Object.keys(FINANCE_CODES);

// Sorted for dropdowns/buttons (review UX order)
// Хуучин MAT-г picker-ээс хасна (зөвхөн legacy харуулалт/нэгтгэлд үлдэнэ) — шинэ бүртгэл MAT_WH/MAT_PROD сонгоно
const SORTED_CODES  = [...INCOME_CODES, ...EXPENSE_CODES.filter(c => c !== 'OTHER' && c !== 'MAT'), 'REFUND', 'TRF', 'OTHER'];

// Category labels for expense page
const CAT_LABELS = {
  IMP:      '\u{1F6A2} Импорт',
  SAL:      '\u{1F477} Цалин',
  TRN:      '\u{1F69A} Тээвэр',
  TRIP:     '✈️ Томилолт',
  EQP:      '\u{1F527} Тоног төхөөрөмж',
  ASSET:    '\u{1F3E2} Компани эд хөрөнгө',
  TAX:      '\u{1F3DB} Татвар',
  OFF:      '\u{1F5C2} Оффис',
  UTIL:     '\u{1F4A1} Тогтмол',
  MAT:      '\u{1F9F1} Материал (хуучин)',
  MAT_WH:   '\u{1F9F1} Материал → Склад',
  MAT_PROD: '\u{1F3ED} Материал → Үйлдвэр',
  MAR:      '\u{1F4E3} Маркетинг',
  SUB:      '\u{1F4BB} Захиалгат',
  FEE:      '\u{1F3E6} Шимтгэл',
  REFUND:   '↩️ Зардлын буцаалт',
  LOAN_OUT: '\u{1F4E4} Зээл өгсөн',
  OTHER:    '\u{1F4E6} Бусад',
  CLAUDE:   '\u{1F916} Claude задлах',
};

// Code examples for reference pages
const CODE_EXAMPLES = {
  SALE:     'SALE: жорлон бүхээг',
  REC:      'REC: хашаа М-1 үлдэгдэл',
  ADV:      'ADV: хашаа М-2 урьдчилгаа',
  INV:      'INV: Батцацралмаа',
  LOAN_IN:  'LOAN_IN: Энхбилэг буцаалт',
  LOAN_OUT: 'LOAN_OUT: Аюурзана зээл',
  IMP:      'IMP: Yongding төмөр',
  SAL:      'SAL: захирлын цалин',
  TRN:      'TRN: Эрээн УБ тээвэр',
  TRIP:     'TRIP: Хятад томилолт',
  EQP:      'EQP: CNC засвар',
  ASSET:    'ASSET: офисын тавилга',
  TAX:      'TAX: НДШ',
  OFF:      'OFF: принтер цаас',
  UTIL:     'UTIL: цахилгаан',
  MAT:      'MAT: (хуучин) remen, шкив',
  MAT_WH:   'MAT_WH: складад хадгалах материал',
  MAT_PROD: 'MAT_PROD: үйлдвэрт шууд хэрэглэх материал',
  MAR:      'MAR: Пластик Центр маркетинг',
  SUB:      'SUB: Claude AI, GitHub',
  TRF:      'TRF: Касс руу',
  FEE:      'FEE (автомат)',
  REFUND:   'REFUND: илүү төлсөн буцаалт',
  OTHER:    'OTHER: бусад',
  CLAUDE:   'CLAUDE: агент бөөн төлбөр (задлах)',
};

// Helper functions
function isExpenseCode(code) { return EXPENSE_CODES.includes(code); }
function isIncomeCode(code)  { return INCOME_CODES.includes(code); }
function isRevenueCode(code) { return ['SALE','REC'].includes(code); }
function isSalesCode(code)   { return SALES_CODES.includes(code); }
function isRefundCode(code)  { return code === 'REFUND'; }
function isAdvCode(code)     { return code === 'ADV'; }
function isTrfCode(code)     { return code === 'TRF'; }
function isCapitalCode(code) { return code === 'INV'; }
function isLoanInCode(code)  { return code === 'LOAN_IN'; }
function codeColor(code)     { return FINANCE_CODES[code]?.color || 'red'; }
function codeLabel(code)     { return FINANCE_CODES[code]?.label || code; }
function codeModule(code)    { return FINANCE_CODES[code]?.module || null; } // Phase B: код→модуль routing
