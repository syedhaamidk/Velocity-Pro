# Velocity Pro — Live Sports Dashboard

Full-stack sports dashboard with real-time WebSocket updates, a normalized MySQL schema, and a modular Express backend.

```
velocity-pro/
├── backend/                 Node.js + Express API
│   ├── server.js            Thin entry point (wiring only)
│   ├── schema.sql           MySQL schema + seed data
│   ├── Dockerfile
│   └── src/
│       ├── routes/          health · leagues · scores · upcoming · stats · sync
│       ├── services/        footballApi  (external data fetch + upsert)
│       ├── middleware/      auth · rateLimiter · errorHandler
│       ├── db/              pool  (reconnect-safe MySQL pool)
│       ├── websocket/       liveUpdates  (Socket.io)
│       ├── cache.js         30-second in-memory TTL cache
│       └── utils/logger.js
├── frontend/
│   └── index.html           Single-file React app (CDN React, no build step)
├── nginx/
│   ├── nginx.conf           Main Nginx config
│   └── conf.d/
│       └── velocity-pro.conf  HTTPS, API proxy, WebSocket proxy
├── docker-compose.yml       MySQL + API + Nginx, one command
├── ecosystem.config.js      PM2 config (bare-metal alternative)
├── deploy.sh                One-command deploy script
└── .env.example             Copy → .env, fill in secrets
```

---

## Quick start (local dev, no Docker)

```bash
# 1. Clone / download
git clone https://github.com/you/velocity-pro.git
cd velocity-pro

# 2. Backend
cd backend
cp .env.example .env       # fill in DB creds + API keys
npm install
mysql -u root -p < schema.sql
npm run dev                # nodemon, auto-restarts on change

# 3. Frontend
# Open frontend/index.html in a browser — done.
# It auto-detects the backend on localhost:3001.
```

---

## Deploy — Option A: Docker (recommended)

Everything runs in containers. One command on any Linux server.

### Prerequisites
- Ubuntu 22.04 VPS (DigitalOcean, Hetzner, Vultr, etc.)
- A domain pointing to your server's IP

### Step 1 — Install Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # log out and back in after this
```

### Step 2 — Get the code onto the server

```bash
# Option A — git (recommended)
git clone https://github.com/you/velocity-pro.git
cd velocity-pro

# Option B — scp from your machine
scp -r velocity-pro/ user@YOUR_SERVER_IP:/opt/velocity-pro
ssh user@YOUR_SERVER_IP
cd /opt/velocity-pro
```

### Step 3 — Configure environment

```bash
cp .env.example .env
nano .env          # fill in DB_PASSWORD, SYNC_API_KEY, FOOTBALL_DATA_API_KEY
```

### Step 4 — Set your domain in Nginx config

```bash
nano nginx/conf.d/velocity-pro.conf
# Change: server_name yourdomain.com;
```

### Step 5 — First deploy + SSL

```bash
chmod +x deploy.sh
./deploy.sh --ssl    # issues cert, builds images, starts everything
```

### Step 6 — Update frontend API_BASE

Edit `frontend/index.html`, find this line near the top:

```js
const API_BASE = (() => { ... })();
```

The auto-detection logic will use the same origin in production. No change needed if frontend and API are on the same domain.

### Subsequent deploys

```bash
git pull
./deploy.sh          # rebuild + restart, zero downtime
```

### Useful Docker commands

```bash
docker compose logs -f api      # tail API logs
docker compose logs -f db       # tail MySQL logs
docker compose ps               # see all containers
docker compose restart api      # restart just the API
docker compose down             # stop everything
docker compose down -v          # stop + delete DB data (careful!)
```

---

## Deploy — Option B: Bare-metal (PM2)

No Docker. MySQL runs natively, PM2 manages Node.js.

### Step 1 — Install Node.js + MySQL on Ubuntu

```bash
# Node 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# MySQL 8
sudo apt-get install -y mysql-server
sudo mysql_secure_installation

# PM2
sudo npm install -g pm2
```

### Step 2 — Create DB user

```bash
sudo mysql -u root -p
```
```sql
CREATE DATABASE sports_dashboard CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'velocity'@'localhost' IDENTIFIED BY 'your_strong_password';
GRANT ALL PRIVILEGES ON sports_dashboard.* TO 'velocity'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

### Step 3 — Configure + deploy

```bash
cp .env.example .env    # fill in credentials
chmod +x deploy.sh
./deploy.sh --bare
```

### Step 4 — Install Nginx + SSL

```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx
sudo cp nginx/conf.d/velocity-pro.conf /etc/nginx/sites-available/velocity-pro
sudo ln -s /etc/nginx/sites-available/velocity-pro /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# Issue SSL cert
sudo certbot --nginx -d yourdomain.com
```

### Subsequent deploys

```bash
git pull && ./deploy.sh --bare
```

---

## Environment variables reference

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | API port (default 3001) |
| `NODE_ENV` | No | `production` or `development` |
| `CORS_ORIGIN` | No | Frontend domain (default `*`, restrict in prod) |
| `SYNC_API_KEY` | Yes | Secret for `X-API-Key` header on POST `/api/sync` |
| `DB_HOST` | Yes | MySQL host (use `db` inside Docker) |
| `DB_PORT` | No | MySQL port (default 3306) |
| `DB_USER` | Yes | MySQL user |
| `DB_PASSWORD` | Yes | MySQL password |
| `DB_NAME` | No | Database name (default `sports_dashboard`) |
| `FOOTBALL_DATA_API_KEY` | No | football-data.org API key (sync skipped if absent) |

---

## API endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/health` | None | DB status, WS client count, cache size |
| GET | `/api/leagues` | None | All leagues |
| GET | `/api/scores` | None | Completed + live matches (`?league=NBA&limit=50`) |
| GET | `/api/upcoming` | None | Scheduled fixtures (`?league=EPL&limit=30`) |
| GET | `/api/stats/high-scoring` | None | Top 10 highest-scoring matches |
| GET | `/api/stats/team-performance` | None | Win rates per team |
| POST | `/api/sync` | `X-API-Key` | Trigger external API sync |

### Trigger a sync manually

```bash
curl -X POST https://yourdomain.com/api/sync \
  -H "X-API-Key: your_sync_api_key"
```

---

## WebSocket events

Connect with Socket.io client at your domain root:

```js
import { io } from 'socket.io-client';
const socket = io('https://yourdomain.com');

socket.on('connected', (data) => console.log(data.msg));
socket.on('scores:update', (data) => {
  console.log(`${data.synced} matches synced at ${data.ts}`);
  // Re-fetch scores from API here
});
```

---

## Troubleshooting

**API returns 503 / DB disconnected**
```bash
docker compose logs db          # check MySQL startup
docker compose restart db api   # restart both
```

**WebSocket not connecting**
- Check your Nginx config has the `Upgrade` and `Connection` headers in the `/socket.io/` block
- Verify port 443 is open: `sudo ufw allow 443`

**SSL cert errors**
```bash
sudo certbot renew --dry-run    # test renewal
sudo certbot renew              # force renew
```

**Rate limit errors on /api/sync**
The sync endpoint allows 5 requests per 60 seconds per IP. Wait 60 seconds and retry.

**football-data.org not syncing**
- Check your API key is set in `.env`
- Free tier allows 10 requests/minute — the auto-sync runs every 60 seconds so this is fine
- Test directly: `curl -H "X-Auth-Token: YOUR_KEY" "https://api.football-data.org/v4/matches"`
