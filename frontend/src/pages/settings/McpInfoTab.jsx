import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle, Copy, Key, Plus, Server, Terminal, X } from "lucide-react";
import { useState } from "react";
import { apiKeysAPI } from "../../utils/api";

const MCP_TOOLS = [
	{
		name: "patchmon_list_hosts",
		desc: "List all managed hosts, filterable by OS type.",
	},
	{
		name: "patchmon_diagnose_windows_hosts",
		desc: "Diagnose Windows agents: version mismatch, auto-update off, stale pings.",
	},
	{
		name: "patchmon_get_agent_version",
		desc: "Simulate the agent version check for a host (hasUpdate, latest version, binary hash).",
	},
	{
		name: "patchmon_dashboard_stats",
		desc: "Dashboard overview: total/online/offline hosts, OS breakdown.",
	},
	{
		name: "patchmon_pending_updates",
		desc: "Packages needing updates across all hosts, with security flags.",
	},
	{
		name: "patchmon_compliance_status",
		desc: "CIS compliance dashboard: latest scan per host, pass/fail counts.",
	},
	{
		name: "patchmon_trigger_compliance_scan",
		desc: "Trigger a CIS compliance scan on a specific host.",
	},
	{
		name: "patchmon_get_host_logs",
		desc: "Recent agent logs for a host (patching, config management, etc.).",
	},
	{
		name: "patchmon_validate",
		desc: "Validate the current API key and show its owner and role.",
	},
];

const McpInfoTab = () => {
	const queryClient = useQueryClient();
	const [copied, setCopied] = useState(null);
	const [newKey, setNewKey] = useState(null);
	const [createError, setCreateError] = useState(null);

	const serverUrl = window.location.origin;
	const serverPath = "/opt/updates.zedhosting.gg/backend/src/mcp/server.js";

	const { data: keys = [], isLoading } = useQuery({
		queryKey: ["api-keys"],
		queryFn: () => apiKeysAPI.list().then((r) => r.data),
	});

	const activeKeys = (keys || []).filter((k) => k.is_active !== false);

	const createMutation = useMutation({
		mutationFn: () => apiKeysAPI.create("MCP").then((r) => r.data),
		onSuccess: (data) => {
			queryClient.invalidateQueries(["api-keys"]);
			setNewKey(data.key || data.api_key || "");
			setCreateError(null);
		},
		onError: (err) => {
			setCreateError(err?.response?.data?.error || err.message || "Failed to create key");
		},
	});

	const buildCommand = (key) =>
		`vivus mcp add patchmon -e PATCHMON_URL=${serverUrl} -e PATCHMON_API_KEY=${key} -- node ${serverPath}`;

	const copy = async (text, id) => {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(id);
			setTimeout(() => setCopied(null), 2000);
		} catch {}
	};

	const placeholderCmd = buildCommand("pmk_<YOUR_KEY>");
	const fullCmd = newKey ? buildCommand(newKey) : null;

	return (
		<div className="space-y-6">
			<div>
				<h3 className="text-lg font-medium text-secondary-900 dark:text-white mb-1">
					MCP Server Configuration
				</h3>
				<p className="text-sm text-secondary-600 dark:text-secondary-300">
					Connect PatchMon to Vivus (or any MCP client) to query your fleet
					directly from chat.
				</p>
			</div>

			{/* Step 1 — API key */}
			<div className="bg-white dark:bg-secondary-800 border border-secondary-200 dark:border-secondary-700 rounded-lg p-4 md:p-6">
				<h4 className="text-sm font-medium text-secondary-900 dark:text-white mb-4 flex items-center gap-2">
					<span className="flex-shrink-0 w-6 h-6 bg-primary-100 dark:bg-primary-900 text-primary-700 dark:text-primary-300 rounded-full flex items-center justify-center text-xs font-medium">
						1
					</span>
					API Key
				</h4>

				{createError && (
					<div className="mb-4 bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-700 rounded-md p-3 flex items-center gap-2">
						<AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 flex-shrink-0" />
						<p className="text-sm text-red-800 dark:text-red-200">{createError}</p>
					</div>
				)}

				{/* Newly created key — full command with key embedded */}
				{newKey ? (
					<div className="space-y-3">
						<div className="bg-green-50 dark:bg-green-900/20 border border-green-300 dark:border-green-700 rounded-lg p-4">
							<p className="text-sm font-medium text-green-800 dark:text-green-200 mb-2">
								Key created — copy the command now. The key is shown once.
							</p>
							<div className="flex items-center gap-2 mb-3">
								<code className="flex-1 bg-white dark:bg-secondary-800 border border-green-200 dark:border-green-800 rounded px-3 py-2 text-sm font-mono break-all text-secondary-900 dark:text-secondary-100">
									{newKey}
								</code>
								<button
									type="button"
									onClick={() => copy(newKey, "key")}
									className="flex-shrink-0 p-2 text-green-600 dark:text-green-400 border border-green-200 dark:border-green-700 rounded-md bg-white dark:bg-secondary-800 hover:text-green-800"
									title="Copy key"
								>
									{copied === "key" ? <CheckCircle className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
								</button>
							</div>
							<div className="flex items-start gap-2">
								<code className="flex-1 bg-secondary-900 dark:bg-secondary-950 text-secondary-100 rounded px-3 py-2 text-xs font-mono overflow-x-auto break-all">
									{fullCmd}
								</code>
								<button
									type="button"
									onClick={() => copy(fullCmd, "cmd")}
									className="flex-shrink-0 p-2 text-secondary-300 hover:text-white bg-secondary-800 rounded"
									title="Copy command"
								>
									{copied === "cmd" ? <CheckCircle className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
								</button>
							</div>
						</div>
						<button
							type="button"
							onClick={() => setNewKey(null)}
							className="inline-flex items-center gap-1 text-xs text-secondary-500 hover:text-secondary-700 dark:text-secondary-400"
						>
							<X className="h-3 w-3" /> Dismiss
						</button>
					</div>
				) : (
					<div className="flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
						<div>
							<p className="text-sm text-secondary-700 dark:text-secondary-300">
								You have {isLoading ? "…" : `${activeKeys.length} active key${activeKeys.length === 1 ? "" : "s"}`}
								{activeKeys.length > 0 && !isLoading && (
									<span className="text-secondary-500 dark:text-secondary-400">
										{" "}({activeKeys.map((k) => k.name || "unnamed").join(", ")})
									</span>
								)}
								. Keys are shown only once at creation.
							</p>
						</div>
						<button
							type="button"
							onClick={() => createMutation.mutate()}
							disabled={createMutation.isPending}
							className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white rounded-md text-sm font-medium transition-colors"
						>
							<Plus className="h-4 w-4" />
							{createMutation.isPending ? "Creating…" : "Create key & show command"}
						</button>
					</div>
				)}
			</div>

			{/* Step 2 — vivus mcp add command */}
			<div className="bg-white dark:bg-secondary-800 border border-secondary-200 dark:border-secondary-700 rounded-lg p-4 md:p-6">
				<h4 className="text-sm font-medium text-secondary-900 dark:text-white mb-4 flex items-center gap-2">
					<span className="flex-shrink-0 w-6 h-6 bg-primary-100 dark:bg-primary-900 text-primary-700 dark:text-primary-300 rounded-full flex items-center justify-center text-xs font-medium">
						2
					</span>
					Register with Vivus
				</h4>
				<p className="text-sm text-secondary-700 dark:text-secondary-300 mb-3">
					Run this in your terminal, replacing <code className="px-1 bg-secondary-100 dark:bg-secondary-700 rounded text-xs">pmk_&lt;YOUR_KEY&gt;</code>{" "}
					with your API key (or use the pre-filled command from step 1):
				</p>
				<div className="flex items-start gap-2">
					<code className="flex-1 bg-secondary-900 dark:bg-secondary-950 text-secondary-100 rounded px-3 py-2 text-xs font-mono overflow-x-auto break-all">
						{placeholderCmd}
					</code>
					<button
						type="button"
						onClick={() => copy(placeholderCmd, "placeholder")}
						className="flex-shrink-0 p-2 text-secondary-300 hover:text-white bg-secondary-800 rounded"
						title="Copy command"
					>
						{copied === "placeholder" ? <CheckCircle className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
					</button>
				</div>
				<p className="text-xs text-secondary-500 dark:text-secondary-400 mt-3">
					Requires <code className="px-1 bg-secondary-100 dark:bg-secondary-700 rounded">node</code> on PATH and the PatchMon repo at{" "}
					<code className="px-1 bg-secondary-100 dark:bg-secondary-700 rounded">{serverPath}</code>
					 (adjust the path if you installed elsewhere).
				</p>
			</div>

			{/* Step 3 — usage */}
			<div className="bg-white dark:bg-secondary-800 border border-secondary-200 dark:border-secondary-700 rounded-lg p-4 md:p-6">
				<h4 className="text-sm font-medium text-secondary-900 dark:text-white mb-4 flex items-center gap-2">
					<span className="flex-shrink-0 w-6 h-6 bg-primary-100 dark:bg-primary-900 text-primary-700 dark:text-primary-300 rounded-full flex items-center justify-center text-xs font-medium">
						3
					</span>
					Use it in chat
				</h4>
				<p className="text-sm text-secondary-700 dark:text-secondary-300 mb-3">
					Once registered, ask naturally — Vivus picks the right tool:
				</p>
				<div className="space-y-1.5">
					{[
						"List all Windows hosts and their agent versions",
						"Diagnose the Windows machines that stopped checking in",
						"Which packages need security updates right now?",
						"What do the agent logs say for host ps-dc1?",
						"Trigger a CIS scan on the domain controller",
					].map((ex) => (
						<p key={ex} className="text-sm text-secondary-600 dark:text-secondary-400 flex items-center gap-2">
							<Terminal className="h-3.5 w-3.5 text-primary-500 flex-shrink-0" />
							{ex}
						</p>
					))}
				</div>
			</div>

			{/* Tools list */}
			<div className="bg-white dark:bg-secondary-800 border border-secondary-200 dark:border-secondary-700 rounded-lg p-4 md:p-6">
				<h4 className="text-sm font-medium text-secondary-900 dark:text-white mb-4 flex items-center gap-2">
					<Server className="h-4 w-4 text-primary-600" />
					Available MCP Tools ({MCP_TOOLS.length})
				</h4>
				<div className="space-y-3">
					{MCP_TOOLS.map((tool) => (
						<div key={tool.name} className="flex items-start gap-3">
							<Key className="h-4 w-4 text-primary-500 mt-1 flex-shrink-0" />
							<div>
								<code className="text-xs font-mono text-primary-700 dark:text-primary-300 bg-primary-50 dark:bg-primary-900/20 px-2 py-0.5 rounded">
									{tool.name}
								</code>
								<p className="text-xs text-secondary-600 dark:text-secondary-400 mt-1">{tool.desc}</p>
							</div>
						</div>
					))}
				</div>
			</div>
		</div>
	);
};

export default McpInfoTab;
