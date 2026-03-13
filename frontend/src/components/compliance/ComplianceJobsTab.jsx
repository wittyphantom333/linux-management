import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import {
	CheckCircle,
	ChevronLeft,
	ChevronRight,
	Clock,
	Filter,
	Play,
	RefreshCw,
	Search,
	ShieldCheck,
	StopCircle,
	XCircle,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useToast } from "../../contexts/ToastContext";
import { complianceAPI } from "../../utils/complianceApi";

const STATUS_CONFIG = {
	running: {
		icon: RefreshCw,
		label: "Running",
		colour: "text-blue-600 dark:text-blue-400",
		bg: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
	},
	completed: {
		icon: CheckCircle,
		label: "Completed",
		colour: "text-green-600 dark:text-green-400",
		bg: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
	},
	failed: {
		icon: XCircle,
		label: "Failed",
		colour: "text-red-600 dark:text-red-400",
		bg: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
	},
};

const PROFILE_TYPE_LABELS = {
	openscap: "OpenSCAP",
	"docker-bench": "Docker Bench",
};

const format_duration = (ms) => {
	if (ms == null) return "—";
	if (ms < 1000) return `${ms}ms`;
	const seconds = ms / 1000;
	if (seconds < 60) return `${seconds.toFixed(1)}s`;
	const minutes = Math.floor(seconds / 60);
	const remaining = Math.round(seconds % 60);
	return `${minutes}m ${remaining}s`;
};

const ComplianceJobsTab = ({ scannedHosts }) => {
	const queryClient = useQueryClient();
	const toast = useToast();
	const [page, setPage] = useState(0);
	const [statusFilter, setStatusFilter] = useState("");
	const [typeFilter, setTypeFilter] = useState("");
	const [hostFilter, setHostFilter] = useState("");
	const [search, setSearch] = useState("");
	const limit = 25;

	// Scan history (includes running scans from DB)
	const { data, isLoading } = useQuery({
		queryKey: ["compliance-jobs", page, statusFilter, typeFilter, hostFilter],
		queryFn: () => {
			const params = { limit, offset: page * limit };
			if (statusFilter) params.status = statusFilter;
			if (typeFilter) params.profile_type = typeFilter;
			if (hostFilter) params.host_id = hostFilter;
			return complianceAPI.getScanHistory(params);
		},
		refetchInterval: (query) => {
			// Auto-refresh every 10s when there are running scans
			const scans = query.state.data?.scans || [];
			return scans.some((s) => s.status === "running") ? 10_000 : false;
		},
		staleTime: 15_000,
		keepPreviousData: true,
	});

	const scans = data?.scans || [];
	const { total = 0, total_pages = 1 } = data?.pagination || {};
	const runningCount = scans.filter((s) => s.status === "running").length;

	const filteredScans = search.trim()
		? scans.filter(
				(s) =>
					s.host_name?.toLowerCase().includes(search.toLowerCase()) ||
					s.profile_name?.toLowerCase().includes(search.toLowerCase()),
			)
		: scans;

	// Cancel scan mutation
	const cancelScan = useMutation({
		mutationFn: (hostId) => complianceAPI.cancelScan(hostId),
		onSuccess: () => {
			toast.success("Scan cancellation requested");
			queryClient.invalidateQueries({ queryKey: ["compliance-jobs"] });
			queryClient.invalidateQueries({
				queryKey: ["compliance-active-count"],
			});
		},
		onError: () => {
			toast.error("Failed to cancel scan");
		},
	});

	const hostOptions = scannedHosts || [];

	return (
		<div className="space-y-4">
			{/* Header + Filters */}
			<div className="card p-4">
				<div className="flex flex-wrap items-center gap-3">
					<div className="relative flex-1 min-w-[200px] max-w-sm">
						<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-secondary-400" />
						<input
							type="text"
							placeholder="Search host or profile..."
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							className="w-full pl-9 pr-3 py-2 bg-secondary-50 dark:bg-secondary-700 border border-secondary-200 dark:border-secondary-600 rounded-lg text-sm text-secondary-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
						/>
					</div>

					<div className="flex items-center gap-2">
						<Filter className="h-4 w-4 text-secondary-400" />
						<select
							value={statusFilter}
							onChange={(e) => {
								setStatusFilter(e.target.value);
								setPage(0);
							}}
							className="px-3 py-2 bg-secondary-50 dark:bg-secondary-700 border border-secondary-200 dark:border-secondary-600 rounded-lg text-sm text-secondary-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
						>
							<option value="">All Statuses</option>
							<option value="running">Running</option>
							<option value="completed">Completed</option>
							<option value="failed">Failed</option>
						</select>
					</div>

					<select
						value={typeFilter}
						onChange={(e) => {
							setTypeFilter(e.target.value);
							setPage(0);
						}}
						className="px-3 py-2 bg-secondary-50 dark:bg-secondary-700 border border-secondary-200 dark:border-secondary-600 rounded-lg text-sm text-secondary-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
					>
						<option value="">All Types</option>
						<option value="openscap">OpenSCAP</option>
						<option value="docker-bench">Docker Bench</option>
					</select>

					{hostOptions.length > 0 && (
						<select
							value={hostFilter}
							onChange={(e) => {
								setHostFilter(e.target.value);
								setPage(0);
							}}
							className="px-3 py-2 bg-secondary-50 dark:bg-secondary-700 border border-secondary-200 dark:border-secondary-600 rounded-lg text-sm text-secondary-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 max-w-[220px] truncate"
						>
							<option value="">All Hosts</option>
							{hostOptions.map((h) => (
								<option key={h.host_id} value={h.host_id}>
									{h.friendly_name || h.hostname || h.host_id}
								</option>
							))}
						</select>
					)}

					{(statusFilter || typeFilter || hostFilter || search) && (
						<button
							type="button"
							onClick={() => {
								setStatusFilter("");
								setTypeFilter("");
								setHostFilter("");
								setSearch("");
								setPage(0);
							}}
							className="text-xs text-primary-600 hover:text-primary-800 dark:text-primary-400 dark:hover:text-primary-300"
						>
							Clear filters
						</button>
					)}

					<div className="ml-auto flex items-center gap-3">
						{runningCount > 0 && (
							<span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
								<span className="relative flex h-2 w-2">
									<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
									<span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
								</span>
								{runningCount} running
							</span>
						)}
						{total > 0 && (
							<span className="text-sm text-secondary-500 dark:text-secondary-400 whitespace-nowrap">
								{total} scan{total !== 1 ? "s" : ""}
							</span>
						)}
					</div>
				</div>
			</div>

			{/* Table */}
			<div className="card overflow-hidden">
				{isLoading ? (
					<div className="flex items-center justify-center py-16">
						<RefreshCw className="h-6 w-6 animate-spin text-secondary-400" />
					</div>
				) : filteredScans.length === 0 ? (
					<div className="text-center py-16 text-secondary-400 dark:text-secondary-500">
						<Play className="h-12 w-12 mx-auto mb-3 opacity-30" />
						<p className="font-medium text-secondary-700 dark:text-secondary-300">
							No scan jobs found
						</p>
						<p className="text-sm mt-1">
							Trigger scans from the Hosts tab to see them here.
						</p>
					</div>
				) : (
					<div className="overflow-x-auto">
						<table className="min-w-full divide-y divide-secondary-200 dark:divide-secondary-600">
							<thead className="bg-secondary-50 dark:bg-secondary-700">
								<tr>
									<th className="px-4 py-3 text-left text-xs font-medium text-secondary-500 dark:text-secondary-300 uppercase tracking-wider">
										Status
									</th>
									<th className="px-4 py-3 text-left text-xs font-medium text-secondary-500 dark:text-secondary-300 uppercase tracking-wider">
										Host
									</th>
									<th className="px-4 py-3 text-left text-xs font-medium text-secondary-500 dark:text-secondary-300 uppercase tracking-wider">
										Profile
									</th>
									<th className="px-4 py-3 text-left text-xs font-medium text-secondary-500 dark:text-secondary-300 uppercase tracking-wider">
										Outcome
									</th>
									<th className="px-4 py-3 text-left text-xs font-medium text-secondary-500 dark:text-secondary-300 uppercase tracking-wider">
										Duration
									</th>
									<th className="px-4 py-3 text-left text-xs font-medium text-secondary-500 dark:text-secondary-300 uppercase tracking-wider">
										Started
									</th>
									<th className="px-4 py-3 text-right text-xs font-medium text-secondary-500 dark:text-secondary-300 uppercase tracking-wider">
										Actions
									</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-secondary-200 dark:divide-secondary-700">
								{filteredScans.map((scan) => {
									const cfg =
										STATUS_CONFIG[scan.status] || STATUS_CONFIG.completed;
									const StatusIcon = cfg.icon;
									const scorePct =
										scan.score != null ? `${Math.round(scan.score)}%` : "—";

									return (
										<tr
											key={scan.id}
											className="hover:bg-secondary-50 dark:hover:bg-secondary-700/30 transition-colors"
										>
											{/* Status */}
											<td className="px-4 py-3 whitespace-nowrap">
												<span
													className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${cfg.bg}`}
												>
													<StatusIcon
														className={`h-3.5 w-3.5 ${scan.status === "running" ? "animate-spin" : ""}`}
													/>
													{cfg.label}
												</span>
											</td>

											{/* Host */}
											<td className="px-4 py-3 whitespace-nowrap">
												<Link
													to={`/compliance/hosts/${scan.host_id}`}
													className="text-sm font-medium text-primary-600 hover:text-primary-900 dark:text-primary-400 dark:hover:text-primary-300 hover:underline"
												>
													{scan.host_name}
												</Link>
											</td>

											{/* Profile */}
											<td className="px-4 py-3 whitespace-nowrap">
												<div className="flex items-center gap-2">
													<span
														className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
															scan.profile_type === "docker-bench"
																? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
																: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
														}`}
													>
														{PROFILE_TYPE_LABELS[scan.profile_type] ||
															scan.profile_type}
													</span>
													<span className="text-sm text-secondary-600 dark:text-secondary-400 truncate max-w-[180px]">
														{scan.profile_name}
													</span>
												</div>
											</td>

											{/* Outcome */}
											<td className="px-4 py-3 whitespace-nowrap">
												{scan.status === "completed" ? (
													<div className="flex items-center gap-2.5 text-sm">
														<span className="text-green-600 dark:text-green-400 font-medium">
															{scan.passed}P
														</span>
														{scan.failed > 0 && (
															<span className="text-red-600 dark:text-red-400 font-medium">
																{scan.failed}F
															</span>
														)}
														{scan.warnings > 0 && (
															<span className="text-yellow-600 dark:text-yellow-400 font-medium">
																{scan.warnings}W
															</span>
														)}
														<span className="text-secondary-400 font-medium">
															{scorePct}
														</span>
													</div>
												) : scan.status === "failed" ? (
													<span
														className="text-sm text-red-500 dark:text-red-400 max-w-[200px] truncate block"
														title={scan.error_message || ""}
													>
														{scan.error_message || "Scan failed"}
													</span>
												) : (
													<span className="text-sm text-secondary-400 italic">
														In progress…
													</span>
												)}
											</td>

											{/* Duration */}
											<td className="px-4 py-3 whitespace-nowrap text-sm text-secondary-500 dark:text-secondary-400">
												<div className="flex items-center gap-1.5">
													<Clock className="h-3.5 w-3.5" />
													{scan.status === "running"
														? formatDistanceToNow(new Date(scan.started_at), {
																addSuffix: false,
															})
														: format_duration(scan.duration_ms)}
												</div>
											</td>

											{/* Started */}
											<td
												className="px-4 py-3 whitespace-nowrap text-sm text-secondary-500 dark:text-secondary-400"
												title={
													scan.started_at
														? format(
																new Date(scan.started_at),
																"dd MMM yyyy HH:mm",
															)
														: ""
												}
											>
												{scan.started_at
													? formatDistanceToNow(new Date(scan.started_at), {
															addSuffix: true,
														})
													: "—"}
											</td>

											{/* Actions */}
											<td className="px-4 py-3 whitespace-nowrap text-right">
												<div className="flex items-center justify-end gap-1">
													<Link
														to={`/compliance/hosts/${scan.host_id}`}
														className="p-1.5 rounded text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
														title="View host compliance"
													>
														<ShieldCheck className="h-4 w-4" />
													</Link>
													{scan.status === "running" && (
														<button
															type="button"
															onClick={() => {
																if (
																	window.confirm(
																		`Cancel scan on ${scan.host_name}?`,
																	)
																)
																	cancelScan.mutate(scan.host_id);
															}}
															className="p-1.5 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
															title="Cancel scan"
														>
															<StopCircle className="h-4 w-4" />
														</button>
													)}
												</div>
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				)}
			</div>

			{/* Bottom pagination */}
			{total_pages > 1 && (
				<div className="flex justify-center">
					<Pagination page={page} totalPages={total_pages} setPage={setPage} />
				</div>
			)}
		</div>
	);
};

const Pagination = ({ page, totalPages, setPage }) => (
	<div className="flex items-center gap-2">
		<button
			type="button"
			disabled={page === 0}
			onClick={() => setPage(page - 1)}
			className="p-1.5 rounded-lg border border-secondary-200 dark:border-secondary-600 disabled:opacity-40 hover:bg-secondary-100 dark:hover:bg-secondary-700 transition-colors"
		>
			<ChevronLeft className="h-4 w-4" />
		</button>
		<span className="text-sm text-secondary-600 dark:text-secondary-400 tabular-nums">
			{page + 1} / {totalPages}
		</span>
		<button
			type="button"
			disabled={page + 1 >= totalPages}
			onClick={() => setPage(page + 1)}
			className="p-1.5 rounded-lg border border-secondary-200 dark:border-secondary-600 disabled:opacity-40 hover:bg-secondary-100 dark:hover:bg-secondary-700 transition-colors"
		>
			<ChevronRight className="h-4 w-4" />
		</button>
	</div>
);

export default ComplianceJobsTab;
