import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	AlertCircle,
	Bug,
	ChevronDown,
	ChevronRight,
	Filter,
	Info,
	RefreshCw,
	Search,
	Terminal,
	Trash2,
	XCircle,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { agentLogsAPI } from "../../utils/api";

const LEVEL_CONFIG = {
	error: {
		color: "text-red-600 dark:text-red-400",
		bg: "bg-red-50 dark:bg-red-900/20",
		badge: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
		icon: XCircle,
	},
	warn: {
		color: "text-amber-600 dark:text-amber-400",
		bg: "bg-amber-50 dark:bg-amber-900/20",
		badge:
			"bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
		icon: AlertCircle,
	},
	warning: {
		color: "text-amber-600 dark:text-amber-400",
		bg: "bg-amber-50 dark:bg-amber-900/20",
		badge:
			"bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
		icon: AlertCircle,
	},
	info: {
		color: "text-blue-600 dark:text-blue-400",
		bg: "",
		badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
		icon: Info,
	},
	debug: {
		color: "text-secondary-500 dark:text-secondary-400",
		bg: "",
		badge:
			"bg-secondary-100 text-secondary-600 dark:bg-secondary-800 dark:text-secondary-400",
		icon: Bug,
	},
};

const getLevelConfig = (level) =>
	LEVEL_CONFIG[level?.toLowerCase()] || LEVEL_CONFIG.info;

const formatTimestamp = (ts) => {
	try {
		const d = new Date(ts);
		return d.toLocaleString(undefined, {
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hour12: false,
		});
	} catch {
		return ts;
	}
};

const AgentLogsTab = ({ hostId }) => {
	const queryClient = useQueryClient();
	const [levelFilter, setLevelFilter] = useState([]);
	const [sourceFilter, setSourceFilter] = useState("");
	const [searchText, setSearchText] = useState("");
	const [debouncedSearch, setDebouncedSearch] = useState("");
	const [expandedRows, setExpandedRows] = useState(new Set());
	const [showFilters, setShowFilters] = useState(false);
	const [autoRefresh, setAutoRefresh] = useState(true);
	const searchTimeout = useRef(null);

	// Debounce search
	useEffect(() => {
		if (searchTimeout.current) clearTimeout(searchTimeout.current);
		searchTimeout.current = setTimeout(
			() => setDebouncedSearch(searchText),
			400,
		);
		return () => clearTimeout(searchTimeout.current);
	}, [searchText]);

	// Query params
	const queryParams = {};
	if (levelFilter.length > 0) queryParams.level = levelFilter.join(",");
	if (sourceFilter) queryParams.source = sourceFilter;
	if (debouncedSearch) queryParams.search = debouncedSearch;
	queryParams.limit = 300;

	// Fetch logs
	const {
		data: logsData,
		isLoading,
		error,
		refetch,
	} = useQuery({
		queryKey: ["agent-logs", hostId, queryParams],
		queryFn: () =>
			agentLogsAPI.getLogs(hostId, queryParams).then((r) => r.data),
		staleTime: 15_000,
		refetchInterval: autoRefresh ? 30_000 : false,
	});

	// Fetch stats
	const { data: statsData } = useQuery({
		queryKey: ["agent-logs-stats", hostId],
		queryFn: () => agentLogsAPI.getStats(hostId).then((r) => r.data),
		staleTime: 30_000,
		refetchInterval: autoRefresh ? 60_000 : false,
	});

	// Fetch sources for filter dropdown
	const { data: sourcesData } = useQuery({
		queryKey: ["agent-logs-sources", hostId],
		queryFn: () => agentLogsAPI.getSources(hostId).then((r) => r.data),
		staleTime: 60_000,
	});

	// Clear logs mutation
	const clearMutation = useMutation({
		mutationFn: () => agentLogsAPI.clearLogs(hostId),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: ["agent-logs", hostId],
			});
			queryClient.invalidateQueries({
				queryKey: ["agent-logs-stats", hostId],
			});
		},
	});

	const toggleRow = useCallback((id) => {
		setExpandedRows((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}, []);

	const toggleLevelFilter = useCallback((level) => {
		setLevelFilter((prev) =>
			prev.includes(level) ? prev.filter((l) => l !== level) : [...prev, level],
		);
	}, []);

	const entries = logsData?.entries || [];
	const total = logsData?.total || 0;

	if (isLoading) {
		return (
			<div className="flex items-center justify-center h-32">
				<RefreshCw className="h-6 w-6 animate-spin text-primary-600" />
			</div>
		);
	}

	if (error) {
		return (
			<div className="text-center py-8">
				<AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
				<p className="text-red-600 dark:text-red-400">
					Failed to load agent logs
				</p>
				<button
					type="button"
					onClick={() => refetch()}
					className="mt-2 px-4 py-2 text-sm bg-primary-600 text-white rounded-md hover:bg-primary-700"
				>
					Retry
				</button>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			{/* Header */}
			<div className="flex items-center justify-between flex-wrap gap-2">
				<div className="flex items-center gap-3">
					<Terminal className="h-5 w-5 text-primary-600 dark:text-primary-400" />
					<h3 className="text-lg font-medium text-secondary-900 dark:text-white">
						Agent Logs
					</h3>
					{total > 0 && (
						<span className="text-xs text-secondary-500 dark:text-secondary-400">
							{total.toLocaleString()} entries
						</span>
					)}
				</div>
				<div className="flex items-center gap-2">
					{/* Auto-refresh toggle */}
					<label className="flex items-center gap-1.5 text-xs text-secondary-500 cursor-pointer">
						<input
							type="checkbox"
							checked={autoRefresh}
							onChange={(e) => setAutoRefresh(e.target.checked)}
							className="rounded border-secondary-300 text-primary-600 focus:ring-primary-500 h-3.5 w-3.5"
						/>
						Auto-refresh
					</label>
					<button
						type="button"
						onClick={() => setShowFilters((p) => !p)}
						className={`p-1.5 rounded-md text-sm ${showFilters ? "bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-400" : "text-secondary-500 hover:text-secondary-700 dark:hover:text-secondary-300"}`}
						title="Toggle filters"
					>
						<Filter className="h-4 w-4" />
					</button>
					<button
						type="button"
						onClick={() => refetch()}
						className="p-1.5 rounded-md text-secondary-500 hover:text-secondary-700 dark:hover:text-secondary-300"
						title="Refresh"
					>
						<RefreshCw className="h-4 w-4" />
					</button>
					{total > 0 && (
						<button
							type="button"
							onClick={() => {
								if (window.confirm("Clear all agent logs for this host?")) {
									clearMutation.mutate();
								}
							}}
							className="p-1.5 rounded-md text-red-500 hover:text-red-700 dark:hover:text-red-400"
							title="Clear all logs"
						>
							<Trash2 className="h-4 w-4" />
						</button>
					)}
				</div>
			</div>

			{/* Stats bar */}
			{statsData && statsData.total > 0 && (
				<div className="flex gap-3 flex-wrap">
					{["error", "warn", "info", "debug"].map((level) => {
						const count = statsData.levels?.[level] || 0;
						if (count === 0 && level === "debug") return null;
						const cfg = getLevelConfig(level);
						return (
							<span
								key={level}
								className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.badge}`}
							>
								{level}: {count.toLocaleString()}
							</span>
						);
					})}
				</div>
			)}

			{/* Filters */}
			{showFilters && (
				<div className="p-3 bg-secondary-50 dark:bg-secondary-800/50 rounded-lg border border-secondary-200 dark:border-secondary-700 space-y-3">
					{/* Level filter chips */}
					<div className="flex items-center gap-2 flex-wrap">
						<span className="text-xs font-medium text-secondary-500 dark:text-secondary-400 w-12">
							Level:
						</span>
						{["error", "warn", "info", "debug"].map((level) => {
							const active = levelFilter.includes(level);
							const cfg = getLevelConfig(level);
							return (
								<button
									key={level}
									type="button"
									onClick={() => toggleLevelFilter(level)}
									className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${active ? `${cfg.badge} ring-2 ring-primary-400` : "bg-secondary-200 text-secondary-600 dark:bg-secondary-700 dark:text-secondary-400 hover:bg-secondary-300 dark:hover:bg-secondary-600"}`}
								>
									{level}
								</button>
							);
						})}
						{levelFilter.length > 0 && (
							<button
								type="button"
								onClick={() => setLevelFilter([])}
								className="text-xs text-secondary-400 hover:text-secondary-600 dark:hover:text-secondary-300"
							>
								clear
							</button>
						)}
					</div>

					{/* Source filter */}
					{sourcesData?.sources?.length > 0 && (
						<div className="flex items-center gap-2">
							<span className="text-xs font-medium text-secondary-500 dark:text-secondary-400 w-12">
								Source:
							</span>
							<select
								value={sourceFilter}
								onChange={(e) => setSourceFilter(e.target.value)}
								className="text-xs rounded-md border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-700 text-secondary-700 dark:text-secondary-300 px-2 py-1"
							>
								<option value="">All sources</option>
								{sourcesData.sources.map((s) => (
									<option key={s} value={s}>
										{s}
									</option>
								))}
							</select>
						</div>
					)}

					{/* Search */}
					<div className="flex items-center gap-2">
						<span className="text-xs font-medium text-secondary-500 dark:text-secondary-400 w-12">
							Search:
						</span>
						<div className="relative flex-1 max-w-md">
							<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-secondary-400" />
							<input
								type="text"
								value={searchText}
								onChange={(e) => setSearchText(e.target.value)}
								placeholder="Search log messages..."
								className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md border border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-700 text-secondary-700 dark:text-secondary-300 focus:ring-primary-500 focus:border-primary-500"
							/>
						</div>
					</div>
				</div>
			)}

			{/* Log entries */}
			{entries.length === 0 ? (
				<div className="text-center py-12">
					<Terminal className="h-12 w-12 text-secondary-300 dark:text-secondary-600 mx-auto mb-3" />
					<p className="text-secondary-500 dark:text-secondary-400 text-sm">
						No agent logs yet
					</p>
					<p className="text-secondary-400 dark:text-secondary-500 text-xs mt-1">
						Logs will appear here after the agent completes its next report
						cycle
					</p>
				</div>
			) : (
				<div className="border border-secondary-200 dark:border-secondary-700 rounded-lg overflow-hidden">
					{/* Monospace log list */}
					<div className="max-h-[600px] overflow-y-auto bg-secondary-950 dark:bg-secondary-950">
						{entries.map((entry) => {
							const cfg = getLevelConfig(entry.level);
							const LevelIcon = cfg.icon;
							const isExpanded = expandedRows.has(entry.id);
							const hasMetadata =
								entry.metadata && Object.keys(entry.metadata).length > 0;

							return (
								<div key={entry.id}>
									<button
										type="button"
										className={`w-full text-left px-3 py-1.5 font-mono text-xs border-b border-secondary-800 hover:bg-secondary-900 transition-colors flex items-start gap-2 ${isExpanded ? "bg-secondary-900" : ""}`}
										onClick={() => hasMetadata && toggleRow(entry.id)}
									>
										{/* Expand chevron */}
										<span className="mt-0.5 w-3 flex-shrink-0">
											{hasMetadata ? (
												isExpanded ? (
													<ChevronDown className="h-3 w-3 text-secondary-500" />
												) : (
													<ChevronRight className="h-3 w-3 text-secondary-500" />
												)
											) : null}
										</span>

										{/* Timestamp */}
										<span className="text-secondary-500 flex-shrink-0 w-36">
											{formatTimestamp(entry.timestamp)}
										</span>

										{/* Level */}
										<span
											className={`flex-shrink-0 w-14 flex items-center gap-1 ${cfg.color}`}
										>
											<LevelIcon className="h-3 w-3" />
											{entry.level?.toUpperCase()}
										</span>

										{/* Source */}
										{entry.source && (
											<span className="flex-shrink-0 text-purple-400 dark:text-purple-300 w-28 truncate">
												[{entry.source}]
											</span>
										)}

										{/* Message */}
										<span className="text-secondary-200 break-all flex-1">
											{entry.message}
										</span>
									</button>

									{/* Expanded metadata */}
									{isExpanded && hasMetadata && (
										<div className="px-3 py-2 bg-secondary-900/70 border-b border-secondary-800 ml-5">
											<div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1">
												{Object.entries(entry.metadata).map(([k, v]) => (
													<div key={k} className="font-mono text-xs">
														<span className="text-secondary-500">{k}:</span>{" "}
														<span className="text-green-400">{v}</span>
													</div>
												))}
											</div>
										</div>
									)}
								</div>
							);
						})}
					</div>
				</div>
			)}

			{/* Pagination info */}
			{total > entries.length && (
				<p className="text-xs text-secondary-500 dark:text-secondary-400 text-center">
					Showing {entries.length} of {total.toLocaleString()} entries
				</p>
			)}
		</div>
	);
};

export default AgentLogsTab;
