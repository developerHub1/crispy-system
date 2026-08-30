# 🚀 TestifyMaps Deployment & Orchestration Guide

This document explains how the **3-Hour Rotating Multi-Server Deployment Infrastructure** works, how the **Cloudflare Worker Orchestrator** manages workflow lifecycles across **12 AMD servers**, and how to configure and deploy the system.

---

## 🏛️ System Architecture

```mermaid
sequenceDiagram
    autonumber
    participant Cron as Cloudflare Worker Cron (Every 3h)
    participant Worker as Cloudflare Worker API
    participant GH as GitHub Actions API
    participant Runner as GitHub AMD Runner (4-Core, 15GB RAM)
    participant Server as Target Server (1 of 12)

    Note over Cron,Worker: Step 1: 3-Hour Cycle Trigger
    Cron->>Worker: Trigger scheduled event (0 */3 * * *)
    Worker->>Worker: Select random Server ID (1 to 12)
    Worker->>GH: POST /actions/workflows/deploy-amd-server.yml/dispatches

    Note over GH,Runner: Step 2: AMD Runner Verification & Build
    GH->>Runner: Start Workflow Run
    Runner->>Runner: Verify CPU is AMD (AuthenticAMD)
    Runner->>Worker: Callback: status = "started" (with CPU metadata)
    Runner->>Runner: Allocate 16GB Swap & Compile Maps (Planetiler + OSRM)
    Runner->>Server: Rsync Map Data & Start Docker Stack

    Note over Runner,Worker: Step 3: Handover & Cancellation
    Runner->>Runner: Run 3-Hour Active Operation Loop
    Runner->>Worker: Callback: status = "success"
    Worker->>GH: Cancel previous running workflow run (Clean Handover)

    Note over Runner,Worker: Step 4: Auto-Recovery on Failure
    alt If Runner or Build Fails
        Runner->>Worker: Callback: status = "failed"
        Worker->>Worker: Pick alternative server (exclude failed server)
        Worker->>GH: Immediate auto-retry dispatch
    end
```

---

## ⚙️ How It Works (Core Mechanics)

### 1. 3-Hour Cron Trigger Rotation
* The Cloudflare Worker has a native Cron trigger configured for `0 */3 * * *` (firing at 00:00, 03:00, 06:00, 09:00, 12:00, 15:00, 18:00, 21:00 UTC).
* Every 3 hours, it initiates a new deployment cycle to ensure continuous fresh builds and zero-downtime rotation.

### 2. Random Selection Across 12 Servers
* In every rotation, the orchestrator randomly selects one server from the pool (`Server 1` through `Server 12`).
* You can also trigger a specific server manually at any time via the Worker API or GitHub Actions UI.

### 3. Hardware Enforcement (AMD Node Verification)
* Step 1 in [.github/workflows/deploy-amd-server.yml](file:///.github/workflows/deploy-amd-server.yml) inspects `/proc/cpuinfo` and `lscpu`.
* It verifies that the runner has an **AuthenticAMD processor** (e.g. AMD EPYC 9V74 / 7763) with 4 Cores and 15 GiB RAM.
* If a non-AMD runner is detected, the job immediately fails fast and alerts the Worker to re-queue.

### 4. Zero-Downtime Handover (Old Run Cancellation)
* When a new workflow finishes its compilation and health check, it sends a `status: "success"` callback to the Cloudflare Worker.
* The Worker looks up the previous 3-hour active workflow run and sends a `POST /actions/runs/{old_run_id}/cancel` request to GitHub API to gracefully stop the older run.

### 5. Instant Auto-Recovery on Failure
* If any step fails (network drop, compilation error, or invalid CPU), the workflow executes an `if: failure()` step.
* It sends a `status: "failed"` payload to the `/callback` webhook.
* The Cloudflare Worker immediately picks a **different server** from the pool and dispatches a new workflow instantly without waiting for the next 3-hour cron.

### 6. GitHub Actions Cache (`actions/cache@v4`)
* The workflow caches the processed map binaries (`infra/data/` containing `.mbtiles`, `.osrm`, and Photon search indices).
* On the first run, it builds the data (~5–8 minutes).
* On subsequent runs, it restores `infra/data` from cache, skipping compilation and **reducing preparation time to under 15 seconds**!

---

## 📂 Workflow Structure

| Workflow File | Purpose | Trigger Method |
| :--- | :--- | :--- |
| [.github/workflows/deploy-amd-server.yml](file:///.github/workflows/deploy-amd-server.yml) | **Core Parameterized Engine**: Handles CPU check, 16GB swap setup, map build, server sync, and Worker callbacks. | Dispatched by CF Worker with `server_id` input (1–12) |
| [.github/workflows/server-1.yml](file:///.github/workflows/server-1.yml) ... [server-12.yml](file:///.github/workflows/server-12.yml) | **1-Click Standalone Workflows**: Wrappers allowing developers to trigger any of the 12 servers directly from GitHub UI. | `workflow_dispatch` in Actions tab |
| [infra/cf-worker/worker.js](file:///infra/cf-worker/worker.js) | **Cloudflare Worker Orchestrator**: Handles cron scheduling, webhook callbacks, auto-recovery, and run cancellation. | Cron / HTTP Webhooks |

---

## 🔑 Required Secrets & Variables

### 1. GitHub Actions Secrets (`Repository Settings -> Secrets -> Actions`)

| Secret Name | Description | Example / Value |
| :--- | :--- | :--- |
| `TUNNEL_TOKEN` | **Cloudflare Tunnel Token** (connects container to Cloudflare for zero-port HTTPS routing) | `eyJhIjoiY2...` |
| `CF_WORKER_URL` | Public URL of your deployed Cloudflare Worker | `https://weathered-wind-5443.developershub.workers.dev` |
| `CF_WEBHOOK_SECRET` | Shared secret token to authenticate webhook calls | `TestifyMaps` |
| `SERVER_SSH_KEY` | *(Optional)* Private SSH key for remote VPS deployments | `-----BEGIN OPENSSH PRIVATE KEY----- ...` |
| `SERVER_HOST` | *(Optional)* Default fallback remote server IP | `192.0.2.1` |
| `SERVER_USER` | *(Optional)* SSH username on remote server | `ubuntu` |
| `SERVER_1_HOST` ... `SERVER_12_HOST` | *(Optional)* Individual IP addresses for each of the 12 servers | `10.0.0.1`, `10.0.0.2`, ... |

---

### 2. Cloudflare Worker Environment Variables & Secrets

Configure these in the Cloudflare Dashboard under **Workers & Pages -> Settings -> Variables** or via Wrangler CLI:

| Variable / Secret | Type | Description |
| :--- | :--- | :--- |
| `GH_PAT` | **Secret** | GitHub Personal Access Token (Permissions: `repo`, `actions:write`) |
| `CF_WEBHOOK_SECRET` | **Secret** | Same secret string as configured in GitHub Secrets |
| `GH_OWNER` | Environment Variable | GitHub username/organization (`gurujadhav`) |
| `GH_REPO` | Environment Variable | Repository name (`testifyMaps`) |
| `GH_BRANCH` | Environment Variable | Target git branch (`main`) |

---

## 🛠️ Step-by-Step Deployment Instructions

### Step 1: Deploy the Cloudflare Worker

```bash
# 1. Navigate to the worker directory
cd infra/cf-worker

# 2. Login to Cloudflare
npx wrangler login

# 3. Set the required secrets
npx wrangler secret put GH_PAT
# (Paste your GitHub Personal Access Token)

npx wrangler secret put CF_WEBHOOK_SECRET
# (Paste your shared webhook secret)

# 4. Deploy to Cloudflare Edge
npx wrangler deploy
```

---

### Step 2: Verify Worker Endpoints

Once deployed, test your worker:

#### 1. Check Orchestrator Status
```bash
curl "https://testifymaps-orchestrator.your-account.workers.dev/status"
```
*Expected output:*
```json
{
  "status": "online",
  "total_servers": 12,
  "timestamp": "2026-08-30T16:50:00.000Z"
}
```

#### 2. Test Manual Trigger (Random Server)
```bash
curl -X POST "https://testifymaps-orchestrator.your-account.workers.dev/trigger" \
  -H "X-Webhook-Secret: YOUR_CF_WEBHOOK_SECRET"
```

#### 3. Test Specific Server Trigger (e.g. Server 7)
```bash
curl -X POST "https://testifymaps-orchestrator.your-account.workers.dev/trigger" \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: YOUR_CF_WEBHOOK_SECRET" \
  -d '{"server_id": 7}'
```

---

### Step 3: Trigger via GitHub Actions UI

You can also trigger any of the 12 servers directly in your browser:
1. Go to your repository on GitHub: `https://github.com/gurujadhav/testifyMaps/actions`.
2. Select any workflow on the left (e.g., **"Deploy Server 5 (AMD)"**).
3. Click **"Run workflow"** ➔ **Run**.
