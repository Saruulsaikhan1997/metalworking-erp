#!/bin/bash
# Production data.json-ийг local-руу татах
# Ашиглалт: ./sync-prod.sh

PROD_URL="${PROD_URL:-https://metalworking-erp.onrender.com}"
LOCAL_DATA="$(dirname "$0")/data.json"

# Login to get token
echo "Нэвтэрч байна..."
read -s -p "Нууц үг: " PW
echo

RESP=$(curl -s "$PROD_URL/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$PW\"}")

TOKEN=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null)

if [ -z "$TOKEN" ]; then
  echo "❌ Нэвтрэх амжилтгүй"
  exit 1
fi

# Backup current local
if [ -f "$LOCAL_DATA" ]; then
  cp "$LOCAL_DATA" "${LOCAL_DATA}.bak"
  echo "📦 Local backup хийлээ → data.json.bak"
fi

# Download production data
echo "⬇️  Production data татаж байна..."
HTTP_CODE=$(curl -s -w "%{http_code}" -o "$LOCAL_DATA.tmp" \
  "$PROD_URL/api/admin/export" \
  -H "Authorization: Bearer $TOKEN")

if [ "$HTTP_CODE" = "200" ]; then
  mv "$LOCAL_DATA.tmp" "$LOCAL_DATA"
  TX_COUNT=$(python3 -c "import json; d=json.load(open('$LOCAL_DATA')); print(len([t for t in d.get('transactions',[]) if not t.get('archived')]))" 2>/dev/null)
  echo "✅ Амжилттай! $TX_COUNT идэвхтэй гүйлгээ татагдлаа."
else
  rm -f "$LOCAL_DATA.tmp"
  echo "❌ Татахад алдаа ($HTTP_CODE)"
  exit 1
fi
