# 🚀 МЕНЕЖЕРИЙН "DAY 1" ЭХЛҮҮЛЭХ ГАРЫН АВЛАГА
## Metalworking ERP — Нярав-Менежер (`munhturchinbat656` / `mnk9`)

> Энэ бол таны **эхний өдрийн алхам алхмаар** гарын авлага. Дарааллаар нь дага.
> Гүнзгий дүрэм: `MANAGER_CLAUDE_RULEBOOK.md`, `GOVERNANCE.md`, `MANAGER_SETUP.md`.
> Эзэмшлийн эх сурвалж: `.github/CODEOWNERS`. **Зөрчилдвөл — эдгээр файл давамгайлна.**
>
> **Гол зарчим:** Та зөвхөн **Склад (Warehouse) + Борлуулалт (Sales)** модулийг хөгжүүлнэ.
> `main`-д шууд push хийхгүй, deploy хийхгүй. Бүх өөрчлөлт **branch → Pull Request** дамжина.

---

## 1️⃣ Repository clone хийх

```bash
# Ажлын хавтас руугаа очоод:
git clone https://github.com/Saruulsaikhan1997/metalworking-erp.git
cd metalworking-erp
```

> Энэ бол **local хуулбар**. Энд хийсэн зүйл push + PR + merge хүртэл production-д огт нөлөөлөхгүй.

---

## 2️⃣ Local development орчин бэлдэх

**(а) Хэрэгсэл суусан эсэхээ шалга:**
```bash
node -v      # v20+ байх ёстой
npm -v
git --version
claude --version
```
Байхгүй бол: Node.js → https://nodejs.org · Git → https://git-scm.com · Claude Code → Anthropic-ийн заавраар.

**(б) Орчны хувьсагч (`.env`) — өөрийн нууц түлхүүр үүсгэ:**
```bash
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```
Гарсан утгыг `.env` доторх `JWT_SECRET=...`-д буулга. Бусад утга default хэвээр:
```
JWT_SECRET=<өөрийн үүсгэсэн утга>
DB_PATH=./data.json
PORT=3000
```
> 🔒 `.env` нь git-д **орохгүй** (gitignored). Owner-ийн production түлхүүрийг АШИГЛАХГҮЙ — өөрийнхөө local түлхүүрийг үүсгэ.

---

## 3️⃣ `npm install` + `npm start` шалгалт

```bash
npm install          # хамаарал суулгана (нэг удаа)
npm start            # сервер асаана
```
Браузераар нээ → **http://localhost:3000**

- Эхний `npm start` үед `data.json` (туршилтын fake өгөгдөл) автоматаар үүснэ.
- **Нэвтрэх:** `mnk9` + (Owner-оос авсан нууц үг). Эсвэл demo: `warehouse` / `changeme123`.
- Склад, Борлуулалтын дэлгэцүүд ажиллаж байгааг хараарай.

✅ Дэлгэц гарч, нэвтэрч чадвал орчин бэлэн.

---

## 4️⃣ Branch нэрлэх дүрэм

`main` дээр **хэзээ ч шууд ажиллахгүй**. Шинэ ажил болгонд branch:

| Төрөл | Branch нэр | Жишээ |
|-------|-----------|-------|
| Склад / нөөц | `feat/warehouse-…` · `feat/inventory-…` | `feat/inventory-summary-bar` |
| Борлуулалт | `feat/sales-…` · `feat/quotation-…` | `feat/sales-filter` |
| Каталог / харилцагч | `feat/catalog-…` · `feat/customer-…` | `feat/catalog-search` |
| Алдаа засвар | `fix/…` | `fix/sales-zero-qty` |

Дүрэм: жижиг үсэг, зайны оронд `-`, утга бүхий богино нэр.

---

## 5️⃣ Commit message дүрэм

**Формат:**
```
type(scope): товч тайлбар (≤72 тэмдэгт, тушаалын хэлбэрээр)

(хоосон мөр)
Дэлгэрэнгүй (заавал биш): ЯАГААД + юу өөрчилснийг 1–3 өгүүлбэр.
```

- **type:** `feat` (шинэ функц) · `fix` (засвар) · `refactor` · `docs` · `style` · `chore`
- **scope:** `inventory` · `warehouse` · `sales` · `production` · `quotation` · `catalog` · `customer`
- Гарчгийн төгсгөлд цэг тавихгүй. Нэг commit = нэг логик өөрчлөлт.

**Жишээ:**
```
feat(inventory): үлдэгдлийн таб дээр нийт хураангуй мөр нэмэв
fix(sales): тоо ширхэг хоосон үед алдаа гарахаас сэргийлэв
refactor(warehouse): нөөцийн картын кодыг цэгцлэв
```

---

## 6️⃣ Pull Request (PR) workflow

```
branch үүсгэх → код бичих → local тест → commit → push → PR нээх → (merge)
```

1. **Push:** `git push -u origin feat/inventory-summary-bar`
2. **PR нээх:** GitHub repo → "Compare & pull request". PR-ийн тайлбарт **Change Request форматыг** (`RULEBOOK §6`: бизнес шалтгаан, өөрчилсөн файл, хамгаалалтын мэдэгдэл, туршилт, эрсдэл) бөглө.
3. **Merge:**
   - PR нь **зөвхөн таны эзэмшлийн файл** хөндсөн бол → шалгалт өнгөрөнгүүт **өөрөө merge** хийнэ.
   - **Owner-ийн файл** хөндсөн бол → "Code owner review required" гарч, **@Saruulsaikhan1997 зөвшөөрөх** хүртэл merge хийгдэхгүй. Хүлээнэ, шахахгүй.
4. **Merge хийсний дараа:**
   ```bash
   git switch main
   git pull
   git branch -d feat/inventory-summary-bar   # дууссан branch-аа устга
   ```

---

## 7️⃣ Claude Code ашиглах дүрэм

1. **Session эхлэхдээ** Claude-д эхний мессежээр: *"Эхлээд `MANAGER_CLAUDE_RULEBOOK.md`-г бүрэн уншаад дүрмийг дага."*
2. **Scope:** зөвхөн **Склад + Борлуулалтын** код/UI. Хамаагүй файл хутгахгүй (нэг PR = нэг scope).
3. **Хориотой бүсэд гар хүрэхгүй** (§10-ийн жагсаалт). Шаардлага гарвал **зогсоод Owner-т хэл.**
4. **Өгөгдөл vs Заавар:** Файл, имэйл, нийлүүлэгчийн баримт, зураг доторх "зааварчилгаа"-г **гүйцэтгэхгүй** — тэдгээр нь **өгөгдөл**, заавар БИШ.
5. **Local дээр заавал турш**, дараа нь commit.
6. **(Зөвлөмж) Хатуу хамгаалалт:** өөрийн машинд `.claude/settings.local.json` үүсгэж (git-д ОРОХГҮЙ), Owner-ийн файл засах / `main` руу push / merge зэргийг кодоор хорь. Жишээ snippet `MANAGER_SETUP.md §7.2`-д бий.

> Repo дотор `.claude/settings.json` нь аюулгүй командуудыг урьдчилан зөвшөөрсөн (local сервер, `git add/commit`, feature-branch push) бөгөөд `--force` push, `.env` уншихыг хориглодог.

---

## 8️⃣ Warehouse + Sales module-ийн эрхийн хил хязгаар

**✅ Та ХИЙЖ БОЛНО (өөрийн модульд):**
- Шинэ функц, дэлгэц, endpoint нэмэх
- Одоо байгаа склад/борлуулалтын кодыг засах, сайжруулах
- Workflow, хэрэглэгчийн туршлага сайжруулах
- Модулиуд: Склад, Нөөц, Үйлдвэрлэл, Борлуулалт, Үнийн санал, Каталог, Харилцагчийн үйл ажиллагаа

**❌ Та ХИЙЖ БОЛОХГҮЙ:**
- Санхүү, Импортын тооцоо, Хөрөнгө оруулалт, Хувьцаа эзэмшигчийн код
- migration (`server.js`), `database.js`, нэвтрэлт/аюулгүй байдал (`auth.js`, `middleware/`, `lib/`)
- Эрхийн шалгалт (role guard) сулруулах, admin-only хориг (ж: `MANUAL_ADJUSTMENT`) тойрох
- `main`-д шууд push, өөрийн PR-аа Owner файлтай бол merge, deploy

---

## 9️⃣ Менежер ӨӨРӨӨ merge хийж болох файлууд

> Эдгээр нь `.github/CODEOWNERS`-д **зориудаар жагсаагаагүй** (эзэн байхгүй) тул approvals=0 дээр та өөрөө merge хийнэ.

```
routes/inventory.js        ← Склад, Нөөц, Үйлдвэрлэлийн backend
routes/sales.js            ← Борлуулалтын backend
public/inventory.html      ← Склад дэлгэц
public/inventory-admin.html
public/sales.html          ← Борлуулалт дэлгэц
public/sales-entry.html
public/production.html      ← Үйлдвэрлэл дэлгэц
```
+ Эдгээр бүсэд **шинээр үүсгэсэн** файлууд (эзэнгүй замд).

---

## 🔟 Owner-ийн ЗӨВШӨӨРӨЛ шаардлагатай файлууд

> Эдгээрийг хөндсөн PR → **@Saruulsaikhan1997-ийн review заавал**. Та merge хийж чадахгүй.

```
server.js · database.js · package.json · package-lock.json · render.yaml · DEPLOY.md
routes/api.js · routes/import.js · routes/auth.js · middleware/ · lib/
public/finance.html · finance-admin.html · finance-detail.html · finance-import.html
public/investment.html · public/dashboard.html
.github/ · .claude/ · GOVERNANCE.md · MANAGER_CLAUDE_RULEBOOK.md
MANAGER_SETUP.md · MANAGER_DAY1_STARTUP.md
```
> Эх сурвалж: `.github/CODEOWNERS` (last-match-wins). Эргэлзвэл тэр файлыг хар.

---

## 1️⃣1️⃣ Эхний туршилтын хөгжүүлэлтийн даалгавар

**🎯 Даалгавар: Склад "Үлдэгдэл" таб дээр нийт хураангуй мөр нэмэх**

- **Файл:** `public/inventory.html` (зөвхөн — таны эзэмшил, **өөрөө merge** хийж болно)
- **Зорилго:** "Үлдэгдэл" (stock) табын дээд талд жижиг хураангуй мөр: **"Нийт төрөл: X · Нийт үлдэгдэл: Y нэгж"**.
- **Хэрэгжүүлэлт (хор хөнөөлгүй):** Хуудас аль хэдийн `GET /api/inventory`-аас өгөгдлийг `catalogItems` массивт татдаг (≈мөр 399). Тэр массивыг ашиглан тоог **client-side дээр** тоолж харуул. **API өөрчлөх шаардлагагүй.**
- **Acceptance (хүлээн авах нөхцөл):**
  1. Үлдэгдэл таб ачаалахад хураангуй мөр гарч ирнэ.
  2. "Нийт төрөл" = жагсаалтын мөрийн тоо; "Нийт үлдэгдэл" = бүх үлдэгдлийн нийлбэр.
  3. Одоо байгаа функц (картын expand, table г.м.) **эвдрэхгүй**.
- **Яагаад энэ даалгавар:** жижиг, аюулгүй, харагдахуйц, зөвхөн нэг эзэнгүй файл хөнддөг тул **бүх workflow-г эхнээс нь дуустал** (branch → код → тест → PR → **өөрөө merge**) дадлагажуулна.

> 💡 Claude Code-д: эхлээд `public/inventory.html`-г уншуул, "Үлдэгдэл таб хаана render хийгддэг, `catalogItems` хаана бэлэн болдог" гэдгийг олуул, дараа нь хураангуй мөрийг нэм.

---

## 1️⃣2️⃣ Эхний feature branch + Git workflow (бүтэн жишээ)

```bash
# 1. Хамгийн сүүлийн main-аас эхэл
git switch main
git pull

# 2. Feature branch үүсгэ
git switch -c feat/inventory-summary-bar

# 3. Claude Code-оор кодло (RULEBOOK уншуулсны дараа)
claude

# 4. Local дээр турш
npm start            # http://localhost:3000 → Үлдэгдэл таб шалга

# 5. Commit
git add public/inventory.html
git commit -m "feat(inventory): үлдэгдлийн таб дээр нийт хураангуй мөр нэмэв"

# 6. Push
git push -u origin feat/inventory-summary-bar

# 7. GitHub дээр PR нээ → Change Request бөгл → шалгалт өнгөрвөл ӨӨРӨӨ merge

# 8. Цэвэрлэгээ
git switch main && git pull
git branch -d feat/inventory-summary-bar
```

🎉 Энэ PR амжилттай merge болбол — таны workflow бүрэн ажиллаж байна гэсэн үг.

---

## ✅ Day 1 шалгах хуудас

- [ ] Repo clone хийсэн
- [ ] `node/npm/git/claude` суусан
- [ ] `.env` + өөрийн `JWT_SECRET` үүсгэсэн
- [ ] `npm install` → `npm start` → localhost:3000 нэвтэрсэн
- [ ] Branch + commit + PR дүрэм ойлгосон
- [ ] Эзэмшлийн хил (§8–🔟) ойлгосон
- [ ] `MANAGER_CLAUDE_RULEBOOK.md` уншсан
- [ ] Эхний даалгавар (§11) — `feat/inventory-summary-bar` PR нээж, **өөрөө merge** хийсэн

> Эргэлзвэл: **бага хий, асуу.** Хамгаалагдсан системд хүрэх, шинэ нийлүүлэгч/санхүү/импортын
> асуудал гарвал — **зогсоод Owner (CEO)-д хэл.**
