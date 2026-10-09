# PatchMon MCP Server

Connects to your PatchMon instance via API key authentication.

## Setup

1. Go to **https://updates.zedhosting.gg/settings/profile**
2. Navigate to the "API Keys" section
3. Create a new API key (or copy an existing one)
4. Paste it into `.env.mcp.patchmon` → `PATCHMON_API_KEY=your_key_here`

## Running

```bash
cd backend/src/mcp
node server.js
```

Or from the project root:

```bash
PATCHMON_URL=http://172.16.21.31:3380 PATCHMON_API_KEY=your_key node backend/src/mcp/server.js
```

## Available Tools

| Tool | Description |
|------|-------------|
| `patchmon_list_hosts` | List all hosts (filterable by OS type) |
| `patchmon_diagnose_windows_hosts` | Diagnose all Windows agents for auto-update issues |
| `patchmon_get_agent_version` | Simulate agent version check for a specific host |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PATCHMON_URL` | http://172.16.21.31:3380 | Base URL of your PatchMon server |
| `PATCHMON_API_KEY` | (required) | API key from settings page |
