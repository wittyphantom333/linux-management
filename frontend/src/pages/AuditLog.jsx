import { useQuery } from "@tanstack/react-query";
import {
	AlertCircle,
	ChevronLeft,
	ChevronRight,
	ScrollText,
} from "lucide-react";
import { useMemo, useState } from "react";
import { auditAPI } from "../utils/api";

// Human-friendly labels for audit event types.
const EVENT_LABELS = {
	LOGIN_SUCCESS: "Login (success)",
	LOGIN_FAILED: "Login (failed)",
	LOGIN_LOCKED: "Login locked",
	LOGOUT: "Logout",
	PASSWORD_CHANGED: "Password changed",
	PASSWORD_RESET: "Password reset",
	TFA_ENABLED: "TFA enabled",
	TFA_DISABLED: "TFA disabled",
	USER_CREATED: "User created",
	USER_UPDATED: "User updated",
	USER_DELETED: "User deleted",
	HOST_CREATED: "Host created",
	HOST_DELETED: "Host deleted",
	API_KEY_REGENERATED: "API key regenerated",
	API_KEY_CREATED: "API key created",
	API_KEY_REVOKED: "API key revoked",
	MCP_TOOL_CALL: "MCP tool call",
	COMPLIANCE_SCAN_TRIGGERED: "Compliance scan triggered",
	SETTINGS_CHANGED: "Settings changed",
};

const eventLabel = (ev) =>
	EVENT_LABELS[ev] ||
	ev.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// Compact "which key / which tool" extraction for MCP + api-key events.
function summarizeDetails(details) {
	if (!details || typeof details !== "object") return null;
	if (details.tool) {
		return `tool: ${details.tool}${
			details.durationMs != null ? ` · ${details.durationMs}ms` : ""
		}`;
	}
	if (details.name) return `name: ${details.name}`;
	if (details.keyId) return `key: ${details.keyId}`;
	if (details.hostId) return `host: ${details.hostId}`;
	const keys = Object.keys(details);
	return keys.length ? keys.join(", ") : null;
}

const fmtTime = (ts) => {
	if (!ts) return "—";
	const d = new Date(ts);
	return Number.isNaN(d.getTime())
		? "—"
		: d.toLocaleString(undefined, {
				month: "short",
				day: "numeric",
				hour: "2-digit",
				minute: "2-digit",
				second: "2-digit",
			});
};

const AuditLog = () => {
	const [page, setPage] = useState(1);
	const [limit] = useState(50);
	const [eventFilter, setEventFilter] = useState("all");
	const [successFilter, setSuccessFilter] = useState("all");
	const [q, setQ] = useState("");

	const query = useMemo(() => {
		const params = { page, limit };
		if (eventFilter !== "all") params.event = eventFilter;
		if (successFilter !== "all") params.success = successFilter === "true";
		return params;
	}, [page, limit, eventFilter, successFilter]);

	const { data: summary, isLoading: summaryLoading } = useQuery({
		queryKey: ["audit", "summary"],
		queryFn: () => auditAPI.summary().then((r) => r.data),
	});

	const {
		data: listData,
		isLoading,
		isFetching,
		error,
	} = useQuery({
		queryKey: ["audit", "list", query],
		queryFn: () => auditAPI.list(query).then((r) => r.data),
		keepPreviousData: true,
	});

	const rows = listData?.data || [];
	const total = listData?.total ?? 0;
	const pages = listData?.pages ?? 1;

	const filtered = useMemo(() => {
		if (!q.trim()) return rows;
		const needle = q.toLowerCase();
		return rows.filter((r) => {
			const hay = [
				r.event,
				r.username,
				r.ipAddress,
				r.details?.tool,
				r.details?.name,
				r.details?.hostId,
			]
				.map((v) => (v == null ? "" : String(v).toLowerCase()))
				.join(" ");
			return hay.includes(needle);
		});
	}, [rows, q]);

	// Derive a compact list of distinct events present (for the filter dropdown)
	const distinctEvents = useMemo(() => {
		if (eventFilter === "all") {
			return [...new Set(rows.map((r) => r.event))].sort();
		}
		return [eventFilter];
	}, [rows, eventFilter]);

	const changeFilter = (key, value) => {
		setPage(1);
		if (key === "event") setEventFilter(value);
		if (key === "success") setSuccessFilter(value);
	};

	return (
		<div className="space-y-6">
			<div>
				<h3 className="text-lg font-medium text-secondary-900 dark:text-white mb-1">
					Usage &amp; Logs
				</h3>
				<p className="text-sm text-secondary-600 dark:text-secondary-300">
					Every API key, MCP tool call, login, and compliance scan across the
					server.
				</p>
			</div>

			{/* Summary cards */}
			<div className="grid grid-cols-2 md:grid-cols-4 gap-4">
				<SummaryCard
					label="Total events"
					value={summary ? summary.total : undefined}
					loading={summaryLoading}
				/>
				<SummaryCard
					label="Last 24h"
					value={summary ? summary.last24h : undefined}
					loading={summaryLoading}
				/>
				<SummaryCard
					label="MCP calls (7d)"
					value={summary?.breakdown?.mcp_calls}
					loading={summaryLoading}
				/>
				<SummaryCard
					label="Logins (7d)"
					value={summary?.breakdown?.logins}
					loading={summaryLoading}
				/>
			</div>

			{/* Filters */}
			<div className="flex flex-wrap gap-3 items-center">
				<input
					type="text"
					value={q}
					onChange={(e) => setQ(e.target.value)}
					placeholder="Search user, tool, IP, key…"
					className="px-3 py-2 border border-secondary-300 dark:border-secondary-600 rounded-md bg-white dark:bg-secondary-700 text-sm text-secondary-900 dark:text-white placeholder-secondary-400 max-w-xs"
				/>
				<select
					value={eventFilter}
					onChange={(e) => changeFilter("event", e.target.value)}
					className="px-3 py-2 border border-secondary-300 dark:border-secondary-600 rounded-md bg-white dark:bg-secondary-700 text-sm text-secondary-900 dark:text-white"
				>
					<option value="all">All events</option>
					{distinctEvents.map((ev) => (
						<option key={ev} value={ev}>
							{eventLabel(ev)}
						</option>
					))}
				</select>
				<select
					value={successFilter}
					onChange={(e) => changeFilter("success", e.target.value)}
					className="px-3 py-2 border border-secondary-300 dark:border-secondary-600 rounded-md bg-white dark:bg-secondary-700 text-sm text-secondary-900 dark:text-white"
				>
					<option value="all">Success + failure</option>
					<option value="true">Success only</option>
					<option value="false">Failures only</option>
				</select>
			</div>

			{/* Table */}
			<div className="bg-white dark:bg-secondary-800 border border-secondary-200 dark:border-secondary-700 rounded-lg overflow-hidden">
				{error ? (
					<div className="p-4 flex items-center gap-2 text-red-600 dark:text-red-400">
						<AlertCircle className="h-4 w-4" />
						<span className="text-sm">
							{error.message || "Failed to load logs"}
						</span>
					</div>
				) : isLoading ? (
					<div className="flex justify-center py-10">
						<div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
					</div>
				) : filtered.length === 0 ? (
					<div className="p-10 text-center text-sm text-secondary-500 dark:text-secondary-400">
						<div className="flex justify-center mb-2">
							<ScrollText className="h-8 w-8 opacity-40" />
						</div>
						No audit events match the current filters.
					</div>
				) : (
					<div className="overflow-x-auto">
						<table className="min-w-full text-sm">
							<thead>
								<tr className="border-b border-secondary-200 dark:border-secondary-700 text-left text-xs uppercase tracking-wide text-secondary-500 dark:text-secondary-400">
									<th className="px-4 py-3 font-medium">Time</th>
									<th className="px-4 py-3 font-medium">Event</th>
									<th className="px-4 py-3 font-medium">User</th>
									<th className="px-4 py-3 font-medium">IP</th>
									<th className="px-4 py-3 font-medium">Result</th>
									<th className="px-4 py-3 font-medium">Details</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-secondary-100 dark:divide-secondary-700">
								{filtered.map((r) => (
									<tr
										key={r.id}
										className="hover:bg-secondary-50 dark:hover:bg-secondary-700/40"
									>
										<td className="px-4 py-3 whitespace-nowrap text-secondary-600 dark:text-secondary-300">
											{fmtTime(r.createdAt)}
										</td>
										<td className="px-4 py-3 whitespace-nowrap">
											<span
												className={
													r.event === "MCP_TOOL_CALL"
														? "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-200"
														: "text-secondary-800 dark:text-secondary-100"
												}
											>
												{eventLabel(r.event)}
											</span>
										</td>
										<td className="px-4 py-3 whitespace-nowrap text-secondary-800 dark:text-secondary-100">
											{r.username || "anonymous"}
										</td>
										<td className="px-4 py-3 whitespace-nowrap text-secondary-500 dark:text-secondary-400 font-mono text-xs">
											{r.ipAddress || "—"}
										</td>
										<td className="px-4 py-3 whitespace-nowrap">
											{r.success ? (
												<span className="text-green-600 dark:text-green-400">
													ok
												</span>
											) : (
												<span className="text-red-600 dark:text-red-400">
													fail
												</span>
											)}
										</td>
										<td className="px-4 py-3 text-secondary-600 dark:text-secondary-300 max-w-[320px]">
											<span className="line-clamp-1">
												{summarizeDetails(r.details) || "—"}
											</span>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</div>

			{/* Pagination */}
			{!isLoading && total > limit && (
				<div className="flex items-center justify-between text-sm text-secondary-600 dark:text-secondary-300">
					<span>
						Page {listData?.page ?? page} of {pages} · {total} events
					</span>
					<div className="flex items-center gap-2">
						<button
							type="button"
							disabled={page <= 1 || isFetching}
							onClick={() => setPage((p) => Math.max(1, p - 1))}
							className="p-2 rounded-md border border-secondary-300 dark:border-secondary-600 disabled:opacity-40 hover:bg-secondary-50 dark:hover:bg-secondary-700"
						>
							<ChevronLeft className="h-4 w-4" />
						</button>
						<button
							type="button"
							disabled={page >= pages || isFetching}
							onClick={() => setPage((p) => Math.min(pages, p + 1))}
							className="p-2 rounded-md border border-secondary-300 dark:border-secondary-600 disabled:opacity-40 hover:bg-secondary-50 dark:hover:bg-secondary-700"
						>
							<ChevronRight className="h-4 w-4" />
						</button>
					</div>
				</div>
			)}
		</div>
	);
};

function SummaryCard({ label, value, loading }) {
	return (
		<div className="bg-white dark:bg-secondary-800 border border-secondary-200 dark:border-secondary-700 rounded-lg p-4">
			<p className="text-xs uppercase tracking-wide text-secondary-500 dark:text-secondary-400">
				{label}
			</p>
			<p className="text-2xl font-semibold text-secondary-900 dark:text-white mt-1">
				{loading ? (
					<span className="text-secondary-300 dark:text-secondary-500">…</span>
				) : (
					(value ?? 0)
				)}
			</p>
		</div>
	);
}

export default AuditLog;
