# FarmersMarketplace — Production Deployment Guide

Target OS: Ubuntu 22.04 LTS
Backend: Express.js on port **4000**
Frontend: React + Vite, built to `frontend/dist/`
Database: PostgreSQL (production) / SQLite (development fallback)

---

## Table of Contents

1. [Server Prerequisites](#1-server-prerequisites)
2. [App Deployment](#2-app-deployment)
3. [PM2 Setup](#3-pm2-setup)
4. [Nginx Setup](#4-nginx-setup)
5. [SSL with Let's Encrypt](#5-ssl-with-lets-encrypt)
6. [Environment Variables Reference](#6-environment-variables-reference)
7. [Rollback Instructions](#7-rollback-instructions)

---

## 1. Server Prerequisites

### Update system packages

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git build-essential
```

### Install Node.js via nvm (Node 20 LTS)

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20
nvm alias default 20
node -v    # should print v20.x.x
npm -v
```

### Install PM2 globally

```bash
npm install -g pm2
pm2 -v
```

### Install Nginx

```bash
sudo apt install -y nginx
sudo systemctl enable nginx
sudo systemctl start nginx
nginx -v
```

### Install PostgreSQL (if not using a managed database)

```bash
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable postgresql
sudo systemctl start postgresql

# Create database and user
sudo -u postgres psql -c "CREATE USER farmersmarket WITH PASSWORD 'your_db_password';"
sudo -u postgres psql -c "CREATE DATABASE farmersmarketplace OWNER farmersmarket;"
```

---

## 2. App Deployment

### Clone the repository

```bash
cd /var/www
sudo mkdir -p farmers-marketplace
sudo chown $USER:$USER farmers-marketplace
git clone https://github.com/your-org/FarmersMarketplace.git farmers-marketplace
cd farmers-marketplace
```

### Install backend dependencies

```bash
cd /var/www/farmers-marketplace/backend
npm install --omit=dev
```

### Install frontend dependencies and build

```bash
cd /var/www/farmers-marketplace/frontend
npm install --omit=dev
npm run build
# Built assets are output to /var/www/farmers-marketplace/frontend/dist/
```

### Set up environment variables

```bash
cd /var/www/farmers-marketplace/backend
cp .env.example .env
nano .env   # fill in all required values — see Section 6
```

Minimum required changes for production:

```bash
NODE_ENV=production
PORT=4000
DATABASE_URL=postgresql://farmersmarket:your_db_password@localhost:5432/farmersmarketplace
JWT_SECRET=<64-byte hex — generate with: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))">
REFRESH_TOKEN_SECRET=<64-byte hex — same method>
CLIENT_ORIGIN=https://yourdomain.com
FRONTEND_ORIGIN=https://yourdomain.com
FRONTEND_URL=https://yourdomain.com
BACKEND_URL=https://yourdomain.com
CORS_ORIGIN=https://yourdomain.com
FEDERATION_DOMAIN=yourdomain.com
STELLAR_NETWORK=mainnet
STELLAR_MAINNET_CONFIRMED=true
```

### Create the logs directory

```bash
mkdir -p /var/www/farmers-marketplace/logs
```

### Run database migrations

```bash
cd /var/www/farmers-marketplace/backend
node migrate.js
```

### (Optional) Seed the admin account

```bash
cd /var/www/farmers-marketplace/backend
node scripts/seed-admin.js
# Uses ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD from .env
# Change the admin password immediately after first login.
```

---

## 3. PM2 Setup

### Start the application

```bash
cd /var/www/farmers-marketplace
pm2 start ecosystem.config.js
pm2 list   # verify farmers-marketplace is online
pm2 logs farmers-marketplace --lines 50   # check for startup errors
```

### Configure PM2 to auto-start on server reboot

```bash
pm2 startup systemd
# PM2 prints a command — copy and run it, e.g.:
#   sudo env PATH=$PATH:/home/ubuntu/.nvm/versions/node/v20.x.x/bin \
#     /home/ubuntu/.nvm/versions/node/v20.x.x/lib/node_modules/pm2/bin/pm2 \
#     startup systemd -u ubuntu --hp /home/ubuntu

pm2 save   # persists the current process list
```

### Useful PM2 commands

```bash
pm2 status                          # overview of all processes
pm2 logs farmers-marketplace        # tail live logs
pm2 reload farmers-marketplace      # zero-downtime reload
pm2 restart farmers-marketplace     # full restart
pm2 stop farmers-marketplace        # stop without removing
pm2 monit                           # real-time dashboard
```

---

## 4. Nginx Setup

### Copy the config and enable the site

```bash
sudo cp /var/www/farmers-marketplace/nginx/farmers-marketplace.conf \
        /etc/nginx/sites-available/farmers-marketplace.conf

sudo ln -s /etc/nginx/sites-available/farmers-marketplace.conf \
           /etc/nginx/sites-enabled/farmers-marketplace.conf

# Remove the default site if present
sudo rm -f /etc/nginx/sites-enabled/default
```

### Test and reload Nginx

```bash
sudo nginx -t            # must print "syntax is ok" and "test is successful"
sudo systemctl reload nginx
```

### Verify the site is serving

```bash
curl -I http://yourdomain.com
# Expect HTTP 200 or 301 (after SSL)
```

---

## 5. SSL with Let's Encrypt

### Install Certbot and the Nginx plugin

```bash
sudo apt install -y certbot python3-certbot-nginx
```

### Obtain the certificate

Replace `yourdomain.com` and `www.yourdomain.com` with your actual domain(s).
Make sure DNS A records already point to this server before running this command.

```bash
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com \
  --non-interactive --agree-tos -m admin@yourdomain.com
```

Certbot will automatically edit `/etc/nginx/sites-available/farmers-marketplace.conf`
and add the HTTPS server block. The resulting config will look like:

```nginx
server {
    listen 443 ssl;
    server_name yourdomain.com www.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
    include             /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam         /etc/letsencrypt/ssl-dhparams.pem;

    # ... rest of the proxy/static config (same as port 80 block)
}

server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;
    return 301 https://$host$request_uri;
}
```

### Confirm auto-renewal

```bash
sudo certbot renew --dry-run
# Should print "Congratulations, all simulated renewals succeeded"
```

Certbot installs a systemd timer (`certbot.timer`) that runs renewal twice daily automatically.
To verify it is active:

```bash
sudo systemctl status certbot.timer
```

---

## 6. Environment Variables Reference

All variables are set in `/var/www/farmers-marketplace/backend/.env`.

### Core (Required)

| Variable | Example / Default | Notes |
|---|---|---|
| `NODE_ENV` | `production` | Must be `production` in prod — never `development` |
| `PORT` | `4000` | Port the Express server listens on |
| `DATABASE_URL` | `postgresql://user:pass@localhost:5432/farmersmarketplace` | Leave unset to use SQLite (not recommended for prod) |
| `JWT_SECRET` | _(64-byte random hex)_ | Generate: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` |
| `REFRESH_TOKEN_SECRET` | _(64-byte random hex)_ | Generate same way as `JWT_SECRET`; must differ |

### CORS / Origins (Required)

| Variable | Example | Notes |
|---|---|---|
| `CLIENT_ORIGIN` | `https://yourdomain.com` | Primary frontend URL used in CORS |
| `FRONTEND_ORIGIN` | `https://yourdomain.com` | Alternative frontend origin |
| `FRONTEND_URL` | `https://yourdomain.com` | Used in email links |
| `BACKEND_URL` | `https://yourdomain.com` | Used in API self-references |
| `CORS_ORIGIN` | `https://yourdomain.com` | Comma-separated allowed origins |
| `FEDERATION_DOMAIN` | `yourdomain.com` | Domain used in Stellar federation addresses (e.g. `farmer*yourdomain.com`) |

### Stellar / Soroban (Required for payments)

| Variable | Example | Notes |
|---|---|---|
| `STELLAR_NETWORK` | `mainnet` | `testnet` or `mainnet` — **change from testnet for real funds** |
| `STELLAR_MAINNET_CONFIRMED` | `true` | **Required** when `STELLAR_NETWORK=mainnet`; guards against accidental real-fund transactions |
| `STELLAR_HORIZON_URL` | `https://horizon.stellar.org` | Optional; defaults to the network's standard URL |
| `SOROBAN_RPC_URL` | `https://soroban-rpc.stellar.org` | Optional; Soroban RPC endpoint |
| `SOROBAN_ESCROW_CONTRACT_ID` | `CB...` | Optional; Soroban escrow contract address |
| `SOROBAN_XLM_TOKEN_CONTRACT_ID` | `CC...` | Optional; native XLM token contract on selected network |
| `SOROBAN_SIMULATION_SOURCE_PUBLIC_KEY` | `G...` | Optional; falls back to `PLATFORM_WALLET_PUBLIC_KEY` |
| `SOROBAN_ESCROW_TIMEOUT_DAYS` | `14` | Buyer refund window in days |

### Platform Fees (Optional)

| Variable | Example | Notes |
|---|---|---|
| `PLATFORM_FEE_PERCENT` | `2` | Platform fee percentage; 0 or unset to disable |
| `PLATFORM_WALLET_PUBLIC_KEY` | `GABC...XYZ` | Public key that receives platform fees |
| `PLATFORM_FEE_ACCOUNT_SECRET` | `SABC...XYZ` | **Keep secret.** Used for fee-bump transactions; disabled if unset |
| `FEE_BUMP_THRESHOLD_XLM` | `2` | XLM balance below which fee bumps are applied |

### Email Notifications (Optional)

| Variable | Example | Notes |
|---|---|---|
| `SMTP_HOST` | `smtp.sendgrid.net` | Leave blank to disable email entirely |
| `SMTP_PORT` | `587` | |
| `SMTP_SECURE` | `false` | `true` for port 465 (TLS), `false` for STARTTLS |
| `SMTP_USER` | `apikey` | SMTP username (e.g. `apikey` for SendGrid) |
| `SMTP_PASS` | _(SMTP password)_ | |
| `SMTP_FROM` | `noreply@yourdomain.com` | From address for outgoing emails |

### Web Push / VAPID (Optional)

| Variable | Notes |
|---|---|
| `WEB_PUSH_VAPID_PUBLIC_KEY` | Generate: `npx web-push generate-vapid-keys` |
| `WEB_PUSH_VAPID_PRIVATE_KEY` | Same command as above |
| `WEB_PUSH_VAPID_SUBJECT` | `mailto:admin@yourdomain.com` |

### Redis (Optional)

| Variable | Example | Notes |
|---|---|---|
| `REDIS_URL` | `redis://localhost:6379` | Leave unset to disable caching |

### Rate Limiting (Optional)

| Variable | Default | Notes |
|---|---|---|
| `RATE_LIMIT_AUTH_MAX` | `10` | Max auth requests per window |
| `RATE_LIMIT_GENERAL_MAX` | `100` | Max general requests per window |

### Logging (Optional)

| Variable | Default | Options |
|---|---|---|
| `LOG_LEVEL` | `info` | `error`, `warn`, `info`, `debug` |

### Admin Seed Script (Optional)

| Variable | Default | Notes |
|---|---|---|
| `ADMIN_NAME` | `Admin` | Used only by `node scripts/seed-admin.js` |
| `ADMIN_EMAIL` | `admin@farmersmarketplace.com` | Change before running seed script |
| `ADMIN_PASSWORD` | `ChangeMe1!` | **Change immediately after seeding** |

---

## 7. Rollback Instructions

Use these steps to roll back to a previously released Git tag (e.g. `v1.2.3`).

```bash
# 1. Navigate to the app root
cd /var/www/farmers-marketplace

# 2. Fetch the latest tags and branches from origin
git fetch --tags origin

# 3. List available tags to find the target version
git tag --sort=-version:refname | head -20

# 4. Check out the target tag
git checkout v1.2.3

# 5. Install backend dependencies for this version
cd /var/www/farmers-marketplace/backend
npm install --omit=dev

# 6. Run any pending (or rollback) migrations
node migrate.js rollback   # roll back the most recent migration batch
# Repeat if multiple migrations need to be reverted.
# Verify the schema is as expected before proceeding.

# 7. Rebuild the frontend
cd /var/www/farmers-marketplace/frontend
npm install --omit=dev
npm run build

# 8. Reload the backend with zero downtime
pm2 reload farmers-marketplace

# 9. Verify the application is healthy
pm2 status
pm2 logs farmers-marketplace --lines 50
curl -s https://yourdomain.com/api/health | head -5

# 10. If the reload fails, force a full restart
pm2 restart farmers-marketplace
```

> **Tip:** Tag every release with `git tag v1.x.x && git push origin v1.x.x` so
> rollback targets are always available without guessing commit hashes.
