/**
 * Cloudflare Worker: 3-Hour Rotating GitHub Actions Orchestrator for 12 AMD Servers
 * 
 * Features:
 * - 3-Hour Cron Trigger (0 * / 3 * * *): Selects a random server (1-12) and dispatches workflow
 * - Failure Webhook Callback: Auto-retries with a different server if a workflow run fails
 * - Success Webhook Callback: Cancels the previous 3-hour workflow run for clean handover
 * - Status Endpoint: Displays current active runs, execution history, and server status
 */

const TOTAL_SERVERS = 12;

export default {
  /**
   * 1. Cron Trigger Handler (Runs every 3 hours)
   */
  async scheduled(event, env, ctx) {
    console.log(`[Cron Trigger] Starting 3-hour rotation at ${new Date().toISOString()}`);
    ctx.waitUntil(triggerRandomServerWorkflow(env, "cron-3hr"));
  },

  /**
   * 2. HTTP Request Handler (Webhook & Management API)
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const method = request.method;

    // CORS headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Webhook-Secret",
    };

    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Status endpoint
    if (url.pathname === "/status" && method === "GET") {
      const state = await getOrchestratorState(env);
      return new Response(JSON.stringify(state, null, 2), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Manual trigger endpoint
    if (url.pathname === "/trigger" && method === "POST") {
      if (!isAuthorized(request, env)) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
      }
      
      let body = {};
      try {
        body = await request.json();
      } catch (e) {}

      const serverId = body.server_id ? parseInt(body.server_id, 10) : getRandomServerId();
      const result = await dispatchWorkflow(env, serverId, "manual-trigger");
      return new Response(JSON.stringify(result), {
        status: result.success ? 200 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Callback Webhook endpoint from GitHub Actions (Started, Success, Failed)
    if (url.pathname === "/callback" && method === "POST") {
      if (!isAuthorized(request, env)) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
      }

      try {
        const payload = await request.json();
        const { run_id, server_id, status, error, cpu_info } = payload;

        console.log(`[Callback Received] Status: ${status} | Server: ${server_id} | Run: ${run_id}`);

        if (status === "started") {
          await handleRunStarted(env, { run_id, server_id, cpu_info });
          return new Response(JSON.stringify({ message: "Started acknowledged" }), { status: 200, headers: corsHeaders });
        }

        if (status === "success") {
          await handleRunSuccess(env, { run_id, server_id });
          return new Response(JSON.stringify({ message: "Success acknowledged, older runs terminated" }), { status: 200, headers: corsHeaders });
        }

        if (status === "failed") {
          // Trigger auto-recovery on another server
          ctx.waitUntil(handleRunFailed(env, { run_id, server_id, error }));
          return new Response(JSON.stringify({ message: "Failure logged, auto-retry dispatched" }), { status: 200, headers: corsHeaders });
        }

        return new Response(JSON.stringify({ message: "Unhandled status" }), { status: 400, headers: corsHeaders });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
      }
    }

    return new Response("TestifyMaps Workflow Orchestrator Active", { status: 200, headers: corsHeaders });
  },
};

/**
 * Check if the request is authorized using CF_WEBHOOK_SECRET
 */
function isAuthorized(request, env) {
  const expectedSecret = env.CF_WEBHOOK_SECRET;
  if (!expectedSecret) return true; // If no secret configured, open
  const headerSecret = request.headers.get("X-Webhook-Secret") || request.headers.get("Authorization")?.replace("Bearer ", "");
  return headerSecret === expectedSecret;
}

/**
 * Returns a random server ID between 1 and TOTAL_SERVERS (12)
 */
function getRandomServerId(excludeId = null) {
  let available = [];
  for (let i = 1; i <= TOTAL_SERVERS; i++) {
    if (i !== excludeId) available.push(i);
  }
  const randomIndex = Math.floor(Math.random() * available.length);
  return available[randomIndex];
}

/**
 * Dispatches the GitHub Actions workflow for a specific server
 */
async function dispatchWorkflow(env, serverId, triggerSource = "orchestrator") {
  const owner = env.GH_OWNER || "developerHub1";
  const repo = env.GH_REPO || "crispy-system";
  const token = env.GH_PAT;
  const workflowFile = "deploy-amd-server.yml";

  if (!token) {
    console.error("Missing GH_PAT in environment");
    return { success: false, error: "Missing GitHub Personal Access Token (GH_PAT)" };
  }

  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowFile}/dispatches`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${token}`,
      "User-Agent": "TestifyMaps-CF-Worker",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      ref: env.GH_BRANCH || "main",
      inputs: {
        server_id: String(serverId),
        trigger_source: triggerSource,
      },
    }),
  });

  if (response.status === 204) {
    console.log(`[Dispatch OK] Successfully triggered workflow for Server ${serverId}`);
    return { success: true, server_id: serverId, triggerSource, timestamp: new Date().toISOString() };
  } else {
    const errorText = await response.text();
    console.error(`[Dispatch Error ${response.status}] ${errorText}`);
    return { success: false, status: response.status, error: errorText };
  }
}

/**
 * Helper to select and trigger a random server
 */
async function triggerRandomServerWorkflow(env, source = "cron") {
  const serverId = getRandomServerId();
  console.log(`[Orchestrator] Selected random Server ${serverId} for trigger source: ${source}`);
  return await dispatchWorkflow(env, serverId, source);
}

/**
 * Handles 'started' callback
 */
async function handleRunStarted(env, { run_id, server_id, cpu_info }) {
  if (env.STATE_KV) {
    const state = (await env.STATE_KV.get("state", { type: "json" })) || { active_runs: [], history: [] };
    state.active_runs.push({
      run_id,
      server_id,
      cpu_info,
      started_at: new Date().toISOString(),
      status: "running",
    });
    // Keep max 20 history entries
    if (state.history.length > 20) state.history = state.history.slice(-20);
    await env.STATE_KV.put("state", JSON.stringify(state));
  }
}

/**
 * Handles 'success' callback: Stops older workflow runs (>3h or previous active)
 */
async function handleRunSuccess(env, { run_id, server_id }) {
  console.log(`[Workflow Success] Server ${server_id} Run ${run_id} is running smoothly!`);
  
  if (env.STATE_KV) {
    const state = (await env.STATE_KV.get("state", { type: "json" })) || { active_runs: [], history: [] };
    
    // Identify older running runs to cancel
    const olderRuns = state.active_runs.filter(r => String(r.run_id) !== String(run_id) && r.status === "running");

    for (const oldRun of olderRuns) {
      console.log(`[Handover] Stopping older workflow run ID: ${oldRun.run_id} (Server ${oldRun.server_id})`);
      await cancelGitHubWorkflowRun(env, oldRun.run_id);
      oldRun.status = "superseded_and_cancelled";
    }

    state.history.push({
      run_id,
      server_id,
      completed_at: new Date().toISOString(),
      status: "success",
    });

    // Update active runs list
    state.active_runs = state.active_runs.filter(r => String(r.run_id) === String(run_id));
    await env.STATE_KV.put("state", JSON.stringify(state));
  }
}

/**
 * Handles 'failed' callback: Automatically picks another random server and triggers it
 */
async function handleRunFailed(env, { run_id, server_id, error }) {
  console.warn(`[Workflow Failed] Server ${server_id} Run ${run_id} failed with: ${error}`);

  if (env.STATE_KV) {
    const state = (await env.STATE_KV.get("state", { type: "json" })) || { active_runs: [], history: [] };
    state.active_runs = state.active_runs.filter(r => String(r.run_id) !== String(run_id));
    state.history.push({
      run_id,
      server_id,
      failed_at: new Date().toISOString(),
      error,
      status: "failed",
    });
    await env.STATE_KV.put("state", JSON.stringify(state));
  }

  // Choose a DIFFERENT server to retry immediately
  const retryServerId = getRandomServerId(server_id);
  console.log(`[Auto-Recovery] Retrying execution on alternative Server ${retryServerId}...`);
  await dispatchWorkflow(env, retryServerId, `auto-retry-after-failure-of-server-${server_id}`);
}

/**
 * Cancels a specific GitHub Actions workflow run
 */
async function cancelGitHubWorkflowRun(env, runId) {
  const owner = env.GH_OWNER || "developerHub1";
  const repo = env.GH_REPO || "crispy-system";
  const token = env.GH_PAT;

  if (!token || !runId) return;

  const url = `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}/cancel`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": `Bearer ${token}`,
        "User-Agent": "TestifyMaps-CF-Worker",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    console.log(`[Cancel Run ${runId}] Response status: ${response.status}`);
  } catch (e) {
    console.error(`[Cancel Run ${runId} Error]`, e);
  }
}

/**
 * Returns the current orchestrator state (Active runs & execution logs)
 */
async function getOrchestratorState(env) {
  if (env.STATE_KV) {
    const state = await env.STATE_KV.get("state", { type: "json" });
    if (state) return state;
  }
  return {
    status: "online",
    message: "No KV storage bound. Memory state active.",
    total_servers: TOTAL_SERVERS,
    timestamp: new Date().toISOString(),
  };
}
