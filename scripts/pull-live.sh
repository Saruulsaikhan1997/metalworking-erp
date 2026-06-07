#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# pull-live.sh — Live ERP-ийн өгөгдлийн snapshot-ийг татах (зөвхөн унших)
# ─────────────────────────────────────────────────────────────────────────────
# Зорилго: автомат шинжилгээ (Claude/скрипт) live өгөгдлийг ӨӨРӨӨ татаж авах.
# Нэвтрэх нууц үг ОГТ хэрэглэхгүй — server.js дээрх /api/admin/snapshot эндпойнт
# зөвхөн EXPORT_API_KEY-ээр ажиллана. `users` (нууц үгийн hash) ХАСАГДАНА.
#
# API key-г ХОЁР эх сурвалжаас уншина (энэ скрипт дотор НУУЦ БАЙХГҮЙ):
#   1) $EXPORT_API_KEY орчны хувьсагч, эсвэл
#   2) ~/.metalworking-export-key файл (chmod 600, git-д ОРОХГҮЙ)
#
# Хэрэглээ:
#   bash scripts/pull-live.sh                      # → /tmp/metalworking-live.json
#   bash scripts/pull-live.sh /зам/output.json     # тодорхой зам руу
#   ERP_HOST=https://metalworking-erp.onrender.com bash scripts/pull-live.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

KEY="${EXPORT_API_KEY:-}"
if [ -z "$KEY" ] && [ -f "$HOME/.metalworking-export-key" ]; then
  KEY="$(cat "$HOME/.metalworking-export-key")"
fi
if [ -z "$KEY" ]; then
  echo "АЛДАА: EXPORT_API_KEY олдсонгүй (орчны хувьсагч ч, ~/.metalworking-export-key файл ч алга)." >&2
  exit 1
fi

HOST="${ERP_HOST:-https://metalworking.mn}"
OUT="${1:-/tmp/metalworking-live.json}"

echo "→ $HOST/api/admin/snapshot татаж байна ..."
HTTP=$(curl -fsS -H "X-API-Key: $KEY" "$HOST/api/admin/snapshot" -o "$OUT" -w "%{http_code}" || true)

if [ "$HTTP" != "200" ]; then
  echo "АЛДАА: HTTP $HTTP — татаж чадсангүй. (503=key тохируулаагүй, 403=key буруу)" >&2
  rm -f "$OUT"
  exit 1
fi

TXN=$(node -e 'try{const d=require(process.argv[1]);console.log((d.transactions||[]).length)}catch(e){console.log("?")}' "$OUT" 2>/dev/null || echo "?")
echo "✓ Хадгаллаа → $OUT  (гүйлгээ: $TXN)"
