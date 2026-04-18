#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
#  Velocity Pro — Deploy Script
#  Works for both first-time setup and subsequent updates.
#
#  Usage (on your server):
#    chmod +x deploy.sh
#    ./deploy.sh              # Docker mode (default)
#    ./deploy.sh --bare       # Bare-metal mode (PM2, no Docker)
#    ./deploy.sh --ssl        # First-time SSL certificate setup
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

# ── Colours ────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}[INFO]${RESET}  $*"; }
success() { echo -e "${GREEN}[OK]${RESET}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
error()   { echo -e "${RED}[ERROR]${RESET} $*" >&2; exit 1; }

# ── Mode flags ────────────────────────────────────────────────────────────
MODE="docker"
SSL=false
for arg in "$@"; do
  case $arg in
    --bare) MODE="bare" ;;
    --ssl)  SSL=true ;;
    --help) echo "Usage: ./deploy.sh [--bare] [--ssl]"; exit 0 ;;
  esac
done

echo -e "\n${BOLD}════════════════════════════════════════${RESET}"
echo -e "${BOLD}  Velocity Pro — Deploy  (${MODE} mode)${RESET}"
echo -e "${BOLD}════════════════════════════════════════${RESET}\n"

# ── 1. Preflight checks ───────────────────────────────────────────────────
info "Checking prerequisites…"

[ -f ".env" ] || error ".env not found. Copy .env.example → .env and fill in your values."

if [ "$MODE" = "docker" ]; then
  command -v docker        &>/dev/null || error "Docker not installed. Run: curl -fsSL https://get.docker.com | sh"
  command -v docker compose &>/dev/null || docker compose version &>/dev/null || \
    error "Docker Compose not found. Install: https://docs.docker.com/compose/install/"
else
  command -v node   &>/dev/null || error "Node.js not installed."
  command -v pm2    &>/dev/null || error "PM2 not installed. Run: npm install -g pm2"
  command -v mysql  &>/dev/null || warn  "mysql client not found — skipping schema init check."
fi

success "Prerequisites OK"

# ── 2. Create required directories ──────────────────────────────────────
info "Creating directories…"
mkdir -p logs nginx/ssl
success "Directories ready"

# ── 3. SSL certificate (first-time only, --ssl flag) ─────────────────────
if [ "$SSL" = true ]; then
  info "Setting up SSL with Certbot…"
  command -v certbot &>/dev/null || {
    warn "Certbot not found. Installing…"
    apt-get update -qq && apt-get install -y -qq certbot python3-certbot-nginx
  }
  # Pull domain from nginx config
  DOMAIN=$(grep -E "server_name [^_]" nginx/conf.d/velocity-pro.conf | awk '{print $2}' | tr -d ';' | head -1)
  [ -z "$DOMAIN" ] || [ "$DOMAIN" = "_" ] && error "Set your domain in nginx/conf.d/velocity-pro.conf first."
  info "Issuing certificate for ${DOMAIN}…"
  certbot certonly --standalone -d "$DOMAIN" --non-interactive --agree-tos \
    -m "admin@${DOMAIN}" --preferred-challenges http
  # Copy certs where Nginx expects them
  cp /etc/letsencrypt/live/"$DOMAIN"/fullchain.pem  nginx/ssl/fullchain.pem
  cp /etc/letsencrypt/live/"$DOMAIN"/privkey.pem    nginx/ssl/privkey.pem
  chmod 600 nginx/ssl/*.pem
  success "SSL certificate ready at nginx/ssl/"
fi

# ── 4a. Docker deploy ─────────────────────────────────────────────────────
if [ "$MODE" = "docker" ]; then
  info "Pulling/building images…"
  docker compose pull --quiet 2>/dev/null || true
  docker compose build --no-cache api

  info "Starting services (db → api → nginx)…"
  docker compose up -d --remove-orphans

  info "Waiting for API health check…"
  for i in $(seq 1 20); do
    if curl -sf http://localhost/api/health &>/dev/null; then
      success "API is healthy ✓"
      break
    fi
    [ "$i" -eq 20 ] && error "API did not become healthy after 60 s. Check: docker compose logs api"
    sleep 3
  done

  echo ""
  info "Container status:"
  docker compose ps

  success "Deployment complete! 🚀"
  echo -e "\n  ${BOLD}Frontend:${RESET} https://yourdomain.com"
  echo -e "  ${BOLD}API:${RESET}      https://yourdomain.com/api/health"
  echo -e "  ${BOLD}Logs:${RESET}     docker compose logs -f api\n"

# ── 4b. Bare-metal deploy (PM2) ───────────────────────────────────────────
else
  info "Installing backend dependencies…"
  cd backend
  npm install --omit=dev --no-audit --no-fund
  cd ..

  info "Initialising / migrating database…"
  if command -v mysql &>/dev/null; then
    set +e
    source .env 2>/dev/null || true
    mysql -h "${DB_HOST:-localhost}" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" \
      < backend/schema.sql 2>&1 | grep -v "already exists" || true
    set -e
    success "Schema applied"
  else
    warn "mysql client not found — skipping schema init. Run manually: mysql -u \$DB_USER -p \$DB_NAME < backend/schema.sql"
  fi

  info "Starting / reloading PM2 process…"
  if pm2 list | grep -q "velocity-pro"; then
    pm2 reload ecosystem.config.js --update-env
    success "PM2 process reloaded (zero-downtime)"
  else
    pm2 start ecosystem.config.js
    pm2 save
    success "PM2 process started"
  fi

  info "PM2 startup hook (auto-restart on server reboot)…"
  pm2 startup 2>&1 | tail -1 | bash 2>/dev/null || true

  echo ""
  pm2 list
  success "Deployment complete! 🚀"
  echo -e "\n  ${BOLD}API:${RESET}   http://localhost:3001/api/health"
  echo -e "  ${BOLD}Logs:${RESET}  pm2 logs velocity-pro\n"
fi
