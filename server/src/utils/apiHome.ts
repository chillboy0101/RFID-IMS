type ApiHomeOptions = {
  origin: string;
  dbReadyState: number;
  isProd: boolean;
  uptimeMs: number;
  requestCount: number;
  version: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const secs = seconds % 60;

  if (days > 0) return `${days}d ${hours}h ${minutes}m ${secs}s`;
  if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
  return `${minutes}m ${secs}s`;
}

function dbStateLabel(readyState: number): string {
  const labels: Record<number, string> = {
    0: "Disconnected",
    1: "Connected",
    2: "Connecting",
    3: "Disconnecting",
  };
  return labels[readyState] ?? "Unknown";
}

function endpointLink(label: string, path: string): string {
  return `<a class="endpoint" href="${escapeHtml(path)}"><span>${escapeHtml(label)}</span><code>${escapeHtml(path)}</code></a>`;
}

export function renderApiHome(options: ApiHomeOptions): string {
  const dbConnected = options.dbReadyState === 1;
  const dbState = dbStateLabel(options.dbReadyState);
  const environment = options.isProd ? "Production" : "Development";
  const uptime = formatDuration(options.uptimeMs);
  const statusLabel = dbConnected ? "Operational" : "Degraded";
  const statusTone = dbConnected ? "ok" : "warn";
  const logoUrl = "https://vdlfulfilment.com/wp-content/uploads/2023/05/cropped-VDL-Logo-compositions-15-300x141.png";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" type="image/png" href="/favicon.png" />
    <title>VDL Fulfilment Ops API</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f7f9fc;
        --card: #ffffff;
        --ink: #071225;
        --muted: #5f6f84;
        --line: #dce4ee;
        --soft: #f0f4f8;
        --green: #10a37f;
        --green-soft: #e7f8f2;
        --amber: #d97706;
        --amber-soft: #fff4de;
        --yellow: #ffdc38;
        --shadow: 0 18px 44px rgba(15, 23, 42, 0.08);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        background: var(--bg);
        color: var(--ink);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      a {
        color: inherit;
        text-decoration: none;
      }

      .shell {
        width: min(1080px, calc(100% - 32px));
        margin: 0 auto;
        padding: 40px 0;
      }

      .topbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 18px;
      }

      .brand {
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
      }

      .mark {
        display: flex;
        width: 76px;
        height: 42px;
        flex: 0 0 auto;
        align-items: center;
        justify-content: center;
      }

      .mark img {
        display: block;
        width: 76px;
        max-height: 38px;
        height: auto;
        object-fit: contain;
      }

      .brand-title {
        font-size: 18px;
        font-weight: 900;
        letter-spacing: -0.04em;
      }

      .brand-subtitle {
        margin-top: 2px;
        overflow: hidden;
        color: var(--muted);
        font-size: 13px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-height: 38px;
        padding: 0 14px;
        border: 1px solid var(--line);
        border-radius: 999px;
        background: var(--card);
        color: var(--muted);
        font-size: 13px;
        font-weight: 800;
        white-space: nowrap;
      }

      .pill.ok {
        border-color: #bdebdc;
        background: var(--green-soft);
        color: #057456;
      }

      .pill.warn {
        border-color: #f7d7a2;
        background: var(--amber-soft);
        color: var(--amber);
      }

      .pulse {
        position: relative;
        width: 9px;
        height: 9px;
        border-radius: 999px;
        background: currentColor;
      }

      .pulse::after {
        content: "";
        position: absolute;
        inset: -6px;
        border: 2px solid currentColor;
        border-radius: inherit;
        opacity: 0.24;
        animation: pulse 1.8s ease-out infinite;
      }

      @keyframes pulse {
        from {
          transform: scale(0.7);
          opacity: 0.42;
        }
        to {
          transform: scale(1.65);
          opacity: 0;
        }
      }

      .hero {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 280px;
        gap: 1px;
        overflow: hidden;
        border: 1px solid var(--line);
        border-radius: 28px;
        background: var(--line);
        box-shadow: var(--shadow);
      }

      .hero-main,
      .hero-side,
      .card {
        background: var(--card);
      }

      .hero-main {
        padding: 34px;
      }

      h1 {
        margin: 0;
        max-width: 720px;
        font-size: clamp(36px, 6vw, 64px);
        line-height: 0.96;
        letter-spacing: -0.065em;
      }

      .lead {
        max-width: 620px;
        margin: 16px 0 0;
        color: var(--muted);
        font-size: 16px;
        line-height: 1.65;
      }

      .hero-side {
        display: grid;
        align-content: center;
        gap: 10px;
        padding: 28px;
      }

      .timer-label {
        color: var(--muted);
        font-size: 12px;
        font-weight: 900;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .timer {
        font-variant-numeric: tabular-nums;
        font-size: 34px;
        font-weight: 900;
        letter-spacing: -0.05em;
      }

      .timer-note {
        color: var(--muted);
        font-size: 13px;
        line-height: 1.5;
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 14px;
        margin-top: 16px;
      }

      .card {
        min-height: 112px;
        padding: 18px;
        border: 1px solid var(--line);
        border-radius: 22px;
        box-shadow: 0 10px 26px rgba(15, 23, 42, 0.05);
      }

      .label {
        color: var(--muted);
        font-size: 12px;
        font-weight: 900;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .value {
        margin-top: 12px;
        overflow: hidden;
        font-size: 21px;
        font-weight: 900;
        letter-spacing: -0.04em;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .checks {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
        margin-top: 16px;
      }

      .endpoint {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        min-height: 56px;
        padding: 0 16px;
        border: 1px solid var(--line);
        border-radius: 18px;
        background: var(--card);
        box-shadow: 0 10px 26px rgba(15, 23, 42, 0.05);
      }

      .endpoint:hover {
        border-color: #bddbd5;
        background: #fbfefc;
      }

      .endpoint span {
        font-size: 14px;
        font-weight: 900;
      }

      .endpoint code {
        color: var(--muted);
        font-size: 12px;
      }

      .footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        margin-top: 18px;
        color: var(--muted);
        font-size: 13px;
      }

      .footer code {
        color: var(--ink);
        font-weight: 800;
      }

      @media (max-width: 820px) {
        .shell {
          width: min(100% - 22px, 620px);
          padding: 20px 0 28px;
        }

        .topbar,
        .footer {
          align-items: flex-start;
          flex-direction: column;
        }

        .hero,
        .grid,
        .checks {
          grid-template-columns: 1fr;
        }

        .hero-main,
        .hero-side {
          padding: 24px;
        }

        .mark,
        .mark img {
          width: 68px;
        }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <header class="topbar">
        <div class="brand">
          <div class="mark"><img src="${logoUrl}" alt="VDL Fulfilment" /></div>
          <div>
            <div class="brand-title">VDL Fulfilment Ops API</div>
            <div class="brand-subtitle">${escapeHtml(options.origin)}</div>
          </div>
        </div>
        <div class="pill ${statusTone}"><span class="pulse"></span>${escapeHtml(statusLabel)}</div>
      </header>

      <section class="hero">
        <div class="hero-main">
          <h1>Backend service is online.</h1>
          <p class="lead">A minimal status surface for uptime, health checks, database state, and runtime readiness.</p>
        </div>
        <aside class="hero-side">
          <div class="timer-label">Live uptime</div>
          <div id="uptime" class="timer" data-uptime-ms="${Math.max(0, Math.floor(options.uptimeMs))}">${escapeHtml(uptime)}</div>
          <div class="timer-note">Counting from the current process start.</div>
        </aside>
      </section>

      <section class="grid" aria-label="Service facts">
        <div class="card">
          <div class="label">Database</div>
          <div class="value">${escapeHtml(dbState)}</div>
        </div>
        <div class="card">
          <div class="label">Environment</div>
          <div class="value">${escapeHtml(environment)}</div>
        </div>
        <div class="card">
          <div class="label">Requests</div>
          <div class="value">${escapeHtml(String(options.requestCount))}</div>
        </div>
        <div class="card">
          <div class="label">Version</div>
          <div class="value">v${escapeHtml(options.version)}</div>
        </div>
      </section>

      <section class="checks" aria-label="Service checks">
        ${endpointLink("Health", "/health")}
        ${endpointLink("Status JSON", "/status.json")}
      </section>

      <footer class="footer">
        <span>Machine-readable checks stay on <code>/health</code>.</span>
        <span>VDL Fulfilment Ops</span>
      </footer>
    </main>

    <script>
      (function () {
        var node = document.getElementById("uptime");
        if (!node) return;
        var initial = Number(node.getAttribute("data-uptime-ms") || "0");
        var startedAt = Date.now() - initial;

        function pad(value) {
          return String(value).padStart(2, "0");
        }

        function label(ms) {
          var total = Math.max(0, Math.floor(ms / 1000));
          var days = Math.floor(total / 86400);
          var hours = Math.floor((total % 86400) / 3600);
          var minutes = Math.floor((total % 3600) / 60);
          var seconds = total % 60;
          if (days > 0) return days + "d " + pad(hours) + ":" + pad(minutes) + ":" + pad(seconds);
          return pad(hours) + ":" + pad(minutes) + ":" + pad(seconds);
        }

        function tick() {
          node.textContent = label(Date.now() - startedAt);
        }

        tick();
        setInterval(tick, 1000);
      })();
    </script>
  </body>
</html>`;
}
