# 🌐 3-Hour Rotating AMD Deployment Orchestrator (Cloudflare Worker)

This Cloudflare Worker manages and orchestrates continuous 3-hour deployment rotations across **12 AMD server workflows** on GitHub Actions.

---

## ⚡ Key Features

1. **3-Hour Scheduled Cron (`0 */3 * * *`)**:
   * Fires every 3 hours (00:00, 03:00, 06:00, 09:00, 12:00, 15:00, 18:00, 21:00 UTC).
   * Randomly selects 1 of the 12 server deployment workflows (`Server 1` through `Server 12`).
   * Calls GitHub REST API to trigger the workflow.
2. **Auto-Recovery on Failure**:
   * If a workflow fails (or runner is rejected for not being AMD), GitHub Actions calls the `/callback` webhook with `status: "failed"`.
   * The Worker immediately chooses an alternative random server and triggers it.
3. **Clean Handover / Old Workflow Cancellation**:
   * When a new 3-hour workflow run succeeds, GitHub Actions calls the `/callback` webhook with `status: "success"`.
   * The Worker automatically cancels and cleans up the previous 3-hour workflow run via GitHub API.
4. **AMD Hardware Enforcement**:
   * Workflows automatically check `grep -i "AuthenticAMD" /proc/cpuinfo` to ensure they only run on AMD EPYC / Ryzen nodes.

---

## 🚀 Setup & Deployment

### Step 1: Deploy Worker using Cloudflare Wrangler

```bash
cd infra/cf-worker

# Install Wrangler CLI (if not already installed)
npm install -g wrangler

# Login to Cloudflare
wrangler login

# Deploy to Cloudflare Edge
wrangler deploy
```

---

### Step 2: Configure Environment Variables & Secrets

#### 1. In Cloudflare Worker Dashboard (or via Wrangler):
Set the following secrets on your Worker:
* `GH_PAT`: Your GitHub Personal Access Token (with `repo` and `actions:write` permissions).
* `GH_OWNER`: `gurujadhav` (or your GitHub username/organization).
* `GH_REPO`: `testifyMaps`.
* `CF_WEBHOOK_SECRET`: A secure random secret string (e.g. `cf_secret_abcdef123456`).

To set secrets via CLI:
```bash
wrangler secret put GH_PAT
wrangler secret put CF_WEBHOOK_SECRET
```

---

#### 2. In GitHub Repository Secrets (`Settings -> Secrets and variables -> Actions`):
Add the following secrets to your GitHub repository:
* `CF_WORKER_URL`: The public URL of your deployed worker (e.g., `https://testifymaps-orchestrator.your-account.workers.dev`).
* `CF_WEBHOOK_SECRET`: The same secret string set in Cloudflare Worker.
* `SERVER_SSH_KEY`: The SSH private key for accessing your servers.
* `SERVER_HOST`: The default fallback server IP/hostname.
* Optional per-server secrets: `SERVER_1_HOST`, `SERVER_2_HOST`, ..., `SERVER_12_HOST`.

---

## 📡 API Endpoints

### 1. View Current Status & Active Runs
```bash
curl "https://testifymaps-orchestrator.your-account.workers.dev/status"
```

### 2. Manually Trigger a Specific Server
```bash
curl -X POST "https://testifymaps-orchestrator.your-account.workers.dev/trigger" \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: YOUR_CF_WEBHOOK_SECRET" \
  -d '{"server_id": 5}'
```

### 3. Manually Trigger a Random Server
```bash
curl -X POST "https://testifymaps-orchestrator.your-account.workers.dev/trigger" \
  -H "X-Webhook-Secret: YOUR_CF_WEBHOOK_SECRET"
```
