# PatchMon MCP Server

Connects to your PatchMon instance via API key authentication (`pmk_...` keys).

## Setup

1. Go to **https://updates.zedhosting.gg/settings/profile** → "API Keys" tab
2. Create a new API key (or use an existing one)
3. Paste it into the Vivus MCP config (`.vivus/mcp-config.json`) or export it:

```bash
export PATCHMON_URL=http://172.16.21.31:3380
export PATCHMON_API_KEY=pmk_xxxx
node backend/src/mcp/server.js
```

## Vivus

The ready-to-use config lives at `.vivus/mcp-config.json` (repo root) — copy its
`command`/`args`/`env` into your MCP client config and fill in `PATCHMON_API_KEY`.

## Available Tools

| Tool | Description |
|------|-------------|
| `patchmon_list_hosts` | List all hosts (filterable by OS type) |
| `patchmon_diagnose_windows_hosts` | Diagnose all Windows agents for auto-update issues |
| `patchmon_get_agent_version` | Global agent version info + host details |
| `patchmon_dashboard_stats` | Dashboard overview: totals, online/offline, OS breakdown |
| `patchmon_pending_updates` | Packages needing updates, with security flags |
| `patchmon_compliance_status` | CIS compliance dashboard: latest scan per host |
| `patchmon_trigger_compliance_scan` | Trigger a compliance scan on a host |
| `patchmon_get_host_logs` | Recent agent logs for a host |
| `patchmon_validate` | Validate the API key and show owner/role |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PATCHMON_URL` | https://updates.zedhosting.gg | Base URL of your PatchMon server |
| `PATCHMON_API_KEY` | (required) | `pmk_...` key from the API Keys tab |
