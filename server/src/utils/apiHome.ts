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
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${Math.max(1, minutes)}m`;
}

export function renderApiHome(options: ApiHomeOptions): string {
  const dbConnected = options.dbReadyState === 1;
  const dbStateLabels: Record<number, string> = {
    0: "Disconnected",
    1: "Connected",
    2: "Connecting",
    3: "Disconnecting",
  };
  const dbState = dbStateLabels[options.dbReadyState] ?? "Unknown";
  const env = options.isProd ? "Production" : "Development";
  const uptime = formatDuration(options.uptimeMs);

  const endpointGroups = [
    {
      title: "System",
      links: [
        { label: "Health", path: "/health" },
        { label: "Metrics", path: "/metrics" },
        { label: "Auth", path: "/auth" },
      ],
    },
    {
      title: "Warehouse",
      links: [
        { label: "Inventory", path: "/inventory" },
        { label: "Orders", path: "/orders" },
        { label: "Dashboard", path: "/dashboard" },
        { label: "Audit", path: "/audit" },
      ],
    },
    {
      title: "Hardware",
      links: [
        { label: "RFID hub", path: "/rfid" },
        { label: "Readers", path: "/rfid/receiving-events" },
        { label: "Gates", path: "/rfid/gate-events" },
      ],
    },
  ];

  const endpointMarkup = endpointGroups
    .map(
      (group) => `
        <section class="endpoint-card">
          <h2>${escapeHtml(group.title)}</h2>
          <div class="endpoint-list">
            ${group.links
              .map(
                (link) => `
                  <a href="${escapeHtml(link.path)}">
                    <span>${escapeHtml(link.label)}</span>
                    <code>${escapeHtml(link.path)}</code>
                  </a>
                `
              )
              .join("")}
          </div>
        </section>
      `
    )
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>VDL Fulfilment Ops API</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f6f8fb;
        --ink: #071225;
        --muted: #536176;
        --line: #dce4ee;
        --soft: #eef3f8;
        --ok: #16a765;
        --warn: #e57b00;
        --shadow: 0 18px 45px rgba(15, 23, 42, 0.12);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        background:
          radial-gradient(circle at 16% 12%, rgba(15, 159, 143, 0.14), transparent 28%),
          radial-gradient(circle at 84% 6%, rgba(255, 220, 56, 0.2), transparent 24%),
          linear-gradient(180deg, #ffffff 0%, var(--bg) 48%, #edf3f8 100%);
        color: var(--ink);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      a {
        color: inherit;
        text-decoration: none;
      }

      .shell {
        width: min(1180px, calc(100% - 32px));
        margin: 0 auto;
        padding: 36px 0 32px;
      }

      .topbar,
      .hero,
      .endpoint-card,
      .startup-panel,
      .signal-card {
        border: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.86);
        box-shadow: var(--shadow);
        backdrop-filter: blur(14px);
      }

      .topbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        border-radius: 22px;
        padding: 14px 16px;
      }

      .brand {
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
      }

      .mark {
        display: grid;
        width: 44px;
        height: 44px;
        place-items: center;
        border-radius: 14px;
        background: #071225;
        color: #ffffff;
        font-size: 18px;
        font-weight: 900;
        letter-spacing: -0.04em;
      }

      .brand strong {
        display: block;
        font-size: 15px;
        line-height: 1.2;
      }

      .brand span {
        display: block;
        margin-top: 2px;
        color: var(--muted);
        font-size: 13px;
      }

      .status-pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-height: 36px;
        padding: 0 13px;
        border: 1px solid #bfe7d3;
        border-radius: 999px;
        background: #e8f8f0;
        color: #087044;
        font-size: 13px;
        font-weight: 800;
        white-space: nowrap;
      }

      .pulse {
        position: relative;
        width: 9px;
        height: 9px;
        border-radius: 99px;
        background: var(--ok);
      }

      .pulse::after {
        content: "";
        position: absolute;
        inset: -6px;
        border-radius: inherit;
        border: 2px solid rgba(22, 167, 101, 0.24);
        animation: ping 1.8s ease-out infinite;
      }

      @keyframes ping {
        0% {
          transform: scale(0.72);
          opacity: 1;
        }
        100% {
          transform: scale(1.5);
          opacity: 0;
        }
      }

      .hero-grid {
        display: grid;
        grid-template-columns: minmax(0, 1.6fr) minmax(320px, 0.9fr);
        gap: 20px;
        margin-top: 22px;
      }

      .hero {
        border-radius: 28px;
        padding: 34px;
        overflow: hidden;
      }

      .eyebrow {
        display: inline-flex;
        border: 1px solid #bfe3df;
        border-radius: 999px;
        background: #ecfbf8;
        color: #087568;
        padding: 8px 12px;
        font-size: 12px;
        font-weight: 900;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      h1 {
        max-width: 760px;
        margin: 18px 0 12px;
        font-size: clamp(36px, 6vw, 72px);
        line-height: 0.94;
        letter-spacing: -0.06em;
      }

      .hero p {
        max-width: 720px;
        margin: 0;
        color: var(--muted);
        font-size: 17px;
        line-height: 1.6;
      }

      .signals {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
        margin-top: 28px;
      }

      .signal-card {
        border-radius: 18px;
        padding: 16px;
        box-shadow: none;
      }

      .signal-card span {
        display: block;
        color: var(--muted);
        font-size: 12px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .signal-card strong {
        display: block;
        margin-top: 8px;
        overflow: hidden;
        font-size: 18px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .startup-panel {
        border-radius: 28px;
        padding: 24px;
      }

      .startup-panel h2,
      .endpoint-card h2 {
        margin: 0;
        font-size: 16px;
        letter-spacing: -0.02em;
      }

      .startup-list {
        display: grid;
        gap: 12px;
        margin-top: 22px;
      }

      .startup-row {
        display: grid;
        grid-template-columns: 20px 1fr auto;
        align-items: center;
        gap: 12px;
        padding: 13px;
        border: 1px solid var(--line);
        border-radius: 16px;
        background: var(--soft);
      }

      .dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: var(--ok);
        box-shadow: 0 0 0 5px rgba(22, 167, 101, 0.12);
      }

      .dot.warn {
        background: var(--warn);
        box-shadow: 0 0 0 5px rgba(229, 123, 0, 0.14);
      }

      .startup-row strong {
        display: block;
        font-size: 14px;
      }

      .startup-row small {
        color: var(--muted);
        font-size: 12px;
      }

      .startup-row code {
        color: var(--muted);
        font-size: 12px;
      }

      .endpoint-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 16px;
        margin-top: 20px;
      }

      .endpoint-card {
        border-radius: 24px;
        padding: 20px;
      }

      .endpoint-list {
        display: grid;
        gap: 9px;
        margin-top: 16px;
      }

      .endpoint-list a {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        min-height: 48px;
        padding: 10px 12px;
        border: 1px solid var(--line);
        border-radius: 15px;
        background: #f8fafc;
      }

      .endpoint-list a:hover {
        border-color: #a9d8d2;
        background: #eefbf8;
      }

      .endpoint-list span {
        font-weight: 800;
      }

      .endpoint-list code {
        color: var(--muted);
        font-size: 12px;
      }

      .footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        margin-top: 20px;
        color: var(--muted);
        font-size: 13px;
      }

      .footer code {
        color: var(--ink);
        font-weight: 800;
      }

      @media (max-width: 860px) {
        .shell {
          width: min(100% - 22px, 680px);
          padding-top: 18px;
        }

        .topbar,
        .footer {
          align-items: flex-start;
          flex-direction: column;
        }

        .hero-grid,
        .signals,
        .endpoint-grid {
          grid-template-columns: 1fr;
        }

        .hero,
        .startup-panel,
        .endpoint-card {
          border-radius: 22px;
        }

        .hero {
          padding: 24px;
        }

        .startup-row {
          grid-template-columns: 18px 1fr;
        }

        .startup-row code {
          grid-column: 2;
        }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <nav class="topbar" aria-label="Service summary">
        <div class="brand">
          <div class="mark">vdl</div>
          <div>
            <strong>VDL Fulfilment Ops</strong>
            <span>${escapeHtml(options.origin)}</span>
          </div>
        </div>
        <div class="status-pill"><span class="pulse"></span> API online</div>
      </nav>

      <section class="hero-grid">
        <div class="hero">
          <div class="eyebrow">Inventory Eye API</div>
          <h1>Warehouse service layer is running.</h1>
          <p>
            RFID intake, inventory control, order fulfilment, gate verification, auditing,
            and tenant operations are available from this backend.
          </p>

          <div class="signals">
            <div class="signal-card">
              <span>Environment</span>
              <strong>${escapeHtml(env)}</strong>
            </div>
            <div class="signal-card">
              <span>Database</span>
              <strong>${escapeHtml(dbState)}</strong>
            </div>
            <div class="signal-card">
              <span>Uptime</span>
              <strong>${escapeHtml(uptime)}</strong>
            </div>
          </div>
        </div>

        <aside class="startup-panel">
          <h2>Service startup</h2>
          <div class="startup-list">
            <div class="startup-row">
              <span class="dot"></span>
              <div>
                <strong>HTTP gateway</strong>
                <small>Express request pipeline active</small>
              </div>
              <code>v${escapeHtml(options.version)}</code>
            </div>
            <div class="startup-row">
              <span class="dot${dbConnected ? "" : " warn"}"></span>
              <div>
                <strong>MongoDB</strong>
                <small>${escapeHtml(dbConnected ? "Connected and accepting operations" : dbState)}</small>
              </div>
              <code>/health</code>
            </div>
            <div class="startup-row">
              <span class="dot"></span>
              <div>
                <strong>RFID gateway</strong>
                <small>Reader and gate event routes mounted</small>
              </div>
              <code>/rfid</code>
            </div>
            <div class="startup-row">
              <span class="dot"></span>
              <div>
                <strong>Audit trail</strong>
                <small>Protected API activity logging enabled</small>
              </div>
              <code>/audit</code>
            </div>
          </div>
        </aside>
      </section>

      <section class="endpoint-grid" aria-label="Endpoint groups">
        ${endpointMarkup}
      </section>

      <footer class="footer">
        <span>Machine-readable service status remains available at <code>/health</code>.</span>
        <span>Requests served since boot: ${escapeHtml(String(options.requestCount))}</span>
      </footer>
    </main>
  </body>
</html>`;
}
