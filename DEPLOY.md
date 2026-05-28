# Metalworking Center ERP — Deployment Guide

## Local Development

```bash
# 1. Install dependencies
npm install

# 2. Create .env from template
cp .env.example .env
# Edit .env — set JWT_SECRET (required)

# 3. Start server
npm start
# or: node server.js

# Server runs at http://localhost:3000
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | No | `development` | `development` or `production` |
| `PORT` | No | `3000` | Server port |
| `HOST` | No | `0.0.0.0` | Bind address |
| `JWT_SECRET` | **Yes** | — | JWT signing key (min 32 chars) |
| `DB_PATH` | No | `./data.json` | Database file path |
| `BACKUP_DIR` | No | `./backups` | Backup directory |
| `BANK_STATEMENT_KASS` | No | — | Khan Bank PDF folder |
| `BANK_STATEMENT_TDB` | No | — | TDB PDF folder |

### Generate JWT_SECRET
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## Production Deploy (Hetzner VPS)

### 1. Server Setup
```bash
# Ubuntu 24.04 LTS
apt update && apt upgrade -y

# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# PM2 + Nginx
npm install -g pm2
apt install -y nginx certbot python3-certbot-nginx

# Firewall
ufw allow 22
ufw allow 80
ufw allow 443
ufw enable
```

### 2. Deploy App
```bash
# Clone
git clone <repo-url> /var/www/metalworking
cd /var/www/metalworking
npm install --production

# Environment
cp .env.example .env
nano .env  # Set JWT_SECRET, NODE_ENV=production

# Create data directory
mkdir -p backups public/uploads/news

# Start with PM2
pm2 start server.js --name metalworking
pm2 save
pm2 startup
```

### 3. Nginx Config
```nginx
# /etc/nginx/sites-available/metalworking
server {
    server_name metalworking.mn www.metalworking.mn;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 10M;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/metalworking /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

### 4. SSL
```bash
certbot --nginx -d metalworking.mn -d www.metalworking.mn
# Auto-renew is configured automatically
```

### 5. DNS
Set A record: `metalworking.mn` → VPS IP address

## Update Deployment
```bash
cd /var/www/metalworking
git pull origin main
npm install --production
pm2 restart metalworking
```

## Backup
```bash
# Daily cron (add to crontab -e)
0 3 * * * cp /var/www/metalworking/data.json /var/www/metalworking/backups/data_$(date +\%Y-\%m-\%d).json
```

## Default Users

| Username | Role | Notes |
|----------|------|-------|
| `admin` | admin | Full access |
| `chinzorig` | shareholder | View only |
| `chinbat` | shareholder | View only |
| `warehouse` | warehouse | Inventory access |
| `sales` | sales | Sales entry |

## File Structure
```
metalworking-app/
├── server.js          # Express entry point
├── database.js        # JSON DB layer + backup
├── .env               # Secrets (NOT in git)
├── .env.example       # Template
├── data.json          # Database (NOT in git)
├── backups/           # Auto backups (NOT in git)
├── middleware/
│   └── auth.js        # JWT auth
├── routes/
│   ├── api.js         # All API endpoints
│   └── auth.js        # Login/logout
├── lib/
│   └── pdf_parser.js  # Bank statement parser
├── public/            # Frontend HTML/JS/CSS
│   ├── login.html
│   ├── dashboard.html
│   ├── inventory.html
│   ├── ...
│   └── uploads/       # User uploads (NOT in git)
└── DEPLOY.md          # This file
```
