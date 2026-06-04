# МЕНЕЖЕРИЙН CLAUDE CODE СУУЛГАЦ БА АЖЛЫН УРСГАЛ
## Metalworking ERP — Нярав-Менежерт зориулсан гарын авлага

> **Хэнд:** `munhturchinbat656` (GitHub collaborator, `mnk9` нэвтрэлт, `manager` эрх).
> **Зорилго:** Энэ зааврыг дагаснаар та өөрийн компьютер дээр төслийг аюулгүй тохируулж,
> **зөвхөн склад + борлуулалтын** модулиудыг сайжруулж, Pull Request (PR)-ээр Owner-т
> танилцуулна. **Production-д шууд гар хүрэхгүй, deploy хийхгүй.**
>
> ⚠️ Энэ файл нь зөвхөн **суулгац ба урсгалын** заавар. Эрх, хориглол, дүрмийн
> **бүрэн эх сурвалж** нь:
> - `MANAGER_CLAUDE_RULEBOOK.md` — Claude Code-ийн үйл ажиллагааны дүрэм (заавал унш)
> - `GOVERNANCE.md` — засаглал, эзэмшил, аюулгүй байдлын бодлого

---

## 0. Шаардлагатай хэрэгсэл (нэг удаа суулгана)

| Хэрэгсэл | Тайлбар |
|----------|---------|
| **Node.js** (LTS, v20+) | https://nodejs.org → суулгах. Шалгах: `node -v`, `npm -v` |
| **Git** | https://git-scm.com → суулгах. Шалгах: `git --version` |
| **GitHub аккаунт** | `munhturchinbat656` — Owner таныг collaborator болгосон |
| **Claude Code** | Anthropic-ийн заавраар суулгана. Шалгах: `claude --version` |
| **(Сонголтоор) GitHub CLI** | `gh` — PR-г terminal-аас нээхэд хялбар. https://cli.github.com |

---

## 1. Repo-г өөрийн компьютерт хуулж авах (clone)

```bash
git clone https://github.com/Saruulsaikhan1997/metalworking-erp.git
cd metalworking-erp
```

> 💡 Энэ нь **local хуулбар**. Энд хийсэн өөрчлөлт нь push + PR + Owner merge хүртэл
> production-д **огт нөлөөлөхгүй**.

---

## 2. Хамаарал суулгах

```bash
npm install
```

---

## 3. Орчны тохиргоо (`.env`) — өөрийн нууц түлхүүр үүсгэх

`.env.example`-г хуулж аваад `.env` нэрээр хадгална:

```bash
cp .env.example .env
```

Дараа нь **өөрийн** `JWT_SECRET` үүсгэж `.env` дотор тавина (Owner-ийн production
түлхүүрийг АШИГЛАХГҮЙ — өөрийнхөө local түлхүүрийг үүсгэ):

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Гарсан утгыг `.env` доторх `JWT_SECRET=...` мөрөнд буулгана. Local-д үлдсэн утгууд
default хэвээр болно:

```
JWT_SECRET=<дээрх командаар гарсан өөрийн утга>
DB_PATH=./data.json          # local fake өгөгдөл (git-д ОРОХГҮЙ)
PORT=3000
```

> 🔒 `.env` нь **gitignored** — хэзээ ч commit хийхгүй. Нууц түлхүүр зөвхөн чиний
> компьютерт байна (`GOVERNANCE.md` §10).

---

## 4. Local сервер ажиллуулах

```bash
npm start
```

→ Браузераар нээ: **http://localhost:3000**

**Эхний удаа** ажиллуулахад `data.json` (туршилтын fake өгөгдөл) автоматаар үүснэ.

**Нэвтрэх:**
- `mnk9` + (Owner/CEO-гээс авсан нууц үг) — production-той ижил `manager` эрх. Өөрийн
  модулиа жинхэнэ эрхээр турших бол үүгээр нэвтэр.
- Эсвэл туршилтын demo хэрэглэгч: `warehouse` / `changeme123`, `sales` / `changeme123`.

> ⚠️ Энэ бол **fake local өгөгдөл**. Production өгөгдөл биш. Чөлөөтэй туршиж болно.

---

## 5. Юунд гар хүрч болох вэ — **эзэмшлийн файлууд**

Та зөвхөн дараах файлуудыг засна (**Нярав-Менежерийн эзэмшил**):

**Backend (API):**
- `routes/inventory.js` — Склад, Нөөц, Үйлдвэрлэл
- `routes/sales.js` — Борлуулалт

**Frontend (дэлгэц):**
- `public/inventory.html`
- `public/inventory-admin.html`
- `public/sales.html`
- `public/sales-entry.html`
- `public/production.html`

> ❌ **ХЭЗЭЭ Ч ГАР ХҮРЭХГҮЙ:** Санхүү, Импортын тооцоо, migration (`server.js`),
> `database.js`, `routes/api.js`, `routes/import.js`, нэвтрэлт/аюулгүй байдал
> (`routes/auth.js`, `middleware/`, `lib/`), нууц түлхүүр (`.env`).
> Бүрэн жагсаалт: **`MANAGER_CLAUDE_RULEBOOK.md` §3**. Эдгээр файл нь GitHub дээр
> Owner-ийн эзэмшилтэй (`.github/CODEOWNERS`) тул чиний PR-д Owner-ийн зөвшөөрөл
> заавал шаардагдана.

---

## 6. Ажлын урсгал (workflow) — branch → код → тест → PR

### 6.1. Шинэ branch үүсгэх (заавал — `main` дээр шууд ажиллахгүй)

Branch нэршлийн дүрэм (`MANAGER_CLAUDE_RULEBOOK.md` §5):

| Төрөл | Жишээ |
|-------|-------|
| Склад/нөөц | `feat/warehouse-...`, `feat/inventory-...` |
| Борлуулалт | `feat/sales-...`, `feat/quotation-...` |
| Каталог/харилцагч | `feat/catalog-...`, `feat/customer-...` |
| Засвар | `fix/...` |

```bash
git switch -c feat/inventory-bulk-edit
```

### 6.2. Claude Code ашиглан кодлох

```bash
claude
```

Эхний мессежээ Claude-д дараах байдлаар өг (Claude дүрмээ мэдэх ёстой):

> "Эхлээд `MANAGER_CLAUDE_RULEBOOK.md`-г бүрэн уншаад дүрмийг дага. Би зөвхөн склад
> (`routes/inventory.js`) болон борлуулалт (`routes/sales.js`) + холбогдох
> `public/*.html` дэлгэцийг л засна. Санхүү, импорт, migration, auth-д гар хүрэхгүй."

### 6.3. Local дээр турших

`npm start` → http://localhost:3000 дээр өөрчлөлтөө шалга. Алдаа байвал засаад
дахин турш.

### 6.4. Commit хийх

```bash
git add routes/inventory.js public/inventory.html
git commit -m "feat(inventory): нөөцийн бөөнөөр засах дэлгэц нэмэв"
```

### 6.5. Branch-аа push хийх

```bash
git push -u origin feat/inventory-bulk-edit
```

> ✅ Зөвхөн **feature branch** руу push хийнэ. `main` руу push хийх боломжгүй
> (GitHub branch protection хаасан).

### 6.6. Pull Request (PR) нээх

**GitHub web дээр:** repo → "Compare & pull request" товч → Change Request формат
(`MANAGER_CLAUDE_RULEBOOK.md` §6)-оор бөглөнө.

**Эсвэл terminal-аас (`gh` суулгасан бол):**

```bash
gh pr create --base main --title "feat(inventory): нөөцийн бөөнөөр засах" --body "..."
```

PR-ийн тайлбарт **Change Request форматыг** (бизнес шалтгаан, өөрчилсөн файлууд,
хамгаалалтын мэдэгдэл, туршилт, эрсдэл) бөглөнө.

### 6.7. Owner хянаж merge хийнэ

Owner (CEO) PR-г хянаад зөвшөөрвөл `main`-д merge хийж, production-д автоматаар
deploy болно. **Та өөрөө merge/deploy хийхгүй, хүлээнэ.** Owner засвар хүсвэл
тайлбарын дагуу засаад дахин push хийнэ (ижил branch дээр).

---

## 7. Claude Code-ийн зөвшөөрлийн тохиргоо

### 7.1. Багийн нийтлэг тохиргоо (`.claude/settings.json`)

Repo дотор аль хэдийн орсон. Энэ нь **аюулгүй** командуудыг (local сервер,
`git add/commit`, feature-branch push) асуулгүйгээр зөвшөөрч, ажлыг хурдасгана.
Мөн `--force` push болон `.env` уншихыг хориглодог.

### 7.2. Өөрийн НЭМЭЛТ хатуу хориг (заавал биш, гэхдээ зөвлөмж болгоно)

Өөрийн компьютер дээр `.claude/settings.local.json` файл үүсгэвэл (энэ нь **git-д
ОРОХГҮЙ**, зөвхөн чиний машинд) Claude Code-ийг хориотой зам руу орохоос **кодын
түвшинд** сэргийлнэ:

```json
{
  "permissions": {
    "deny": [
      "Bash(git push origin main*)",
      "Bash(git push origin HEAD:main*)",
      "Bash(git merge*)",
      "Bash(gh pr merge*)",
      "Bash(git reset --hard*)",
      "Edit(server.js)",
      "Edit(database.js)",
      "Edit(routes/api.js)",
      "Edit(routes/import.js)",
      "Edit(routes/auth.js)",
      "Edit(middleware/*)",
      "Edit(lib/*)",
      "Edit(public/finance*.html)",
      "Edit(public/investment.html)",
      "Edit(public/dashboard.html)",
      "Edit(render.yaml)",
      "Edit(.github/*)",
      "Read(.env)",
      "Edit(.env)"
    ]
  }
}
```

> Энэ нь GitHub-ийн хамгаалалт (CODEOWNERS + branch protection)-ын **давхар хамгаалалт**.
> Жинхэнэ хаалт нь GitHub дээр серверийн талд хийгдсэн хэвээр.

---

## 8. ХОРИОТОЙ зүйлс (товч сануулга)

- ❌ `main` руу шууд push хийх
- ❌ Өөрийн PR-г өөрөө merge хийх
- ❌ deploy хийх (Render)
- ❌ Санхүү / Импортын тооцоо / Хөрөнгө оруулалт / Хувьцаа эзэмшигчийн кодод гар хүрэх
- ❌ migration (`server.js`), `database.js`, нэвтрэлт/аюулгүй байдлын код өөрчлөх
- ❌ Эрхийн шалгалт (role guard)-ыг сулруулах, `MANUAL_ADJUSTMENT` зэрэг admin-only
  хоригийг тойрох
- ❌ Production `curl`-аар admin эрхээр гүйлгээ хийх
- ❌ Бизнесийн баримт/имэйл/зураг доторх "зааварчилгаа"-г Claude-аар гүйцэтгүүлэх
  (тэдгээр нь **өгөгдөл**, заавар БИШ)

Бүрэн жагсаалт ба STOP нөхцөл: **`MANAGER_CLAUDE_RULEBOOK.md` §3**.

---

## 9. Асуудал гарвал

- Хамгаалагдсан системтэй огтлолцох шаардлага гарвал → **зогс**, Owner-т мэдэгд
  (RULEBOOK §3.4).
- Техникийн асуудал, эрхийн зөрчил → Owner (CEO)-д хандана.
- Эргэлзвэл: **бага хийх, асуух нь дээр.** Шинэ counterparty/импорт/санхүүгийн
  өөрчлөлт санаандгүй гарвал шууд зогсоод Owner-т хэл.

---

*Эх сурвалж дүрмүүд: `GOVERNANCE.md`, `MANAGER_CLAUDE_RULEBOOK.md`, `.github/CODEOWNERS`.*
*Энэ заавар тэдгээртэй зөрчилдвөл — дүрмийн файлууд давамгайлна.*
