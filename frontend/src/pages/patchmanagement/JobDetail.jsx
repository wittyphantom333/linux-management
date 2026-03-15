import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	AlertTriangle,
	ArrowLeft,
	ArrowUpDown,
	Ban,
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	Clock,
	Diff,
	Loader2,
	Package,
	RefreshCw,
	RotateCcw,
	Server,
	XCircle,
} from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useToast } from "../../contexts/ToastContext";
import { patchManagementAPI } from "../../utils/patchManagementApi";

const STATUS_STYLES = {
	pending:
		"bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
	running: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
	downloading:
		"bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",
	installing:
		"bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
	rebooting:
		"bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
	completed:
		"bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
	completed_with_errors:
		"bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
	failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
	cancelled:
		"bg-secondary-100 text-secondary-600 dark:bg-secondary-700 dark:text-secondary-400",
	skipped:
		"bg-secondary-100 text-secondary-600 dark:bg-secondary-700 dark:text-secondary-400",
	updated:
		"bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
	held: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
};

const STATUS_ICONS = {
	pending: Clock,
	running: RefreshCw,
	downloading: ArrowUpDown,
	installing: Package,
	rebooting: RotateCcw,
	completed: CheckCircle2,
	completed_with_errors: AlertTriangle,
	failed: XCircle,
	cancelled: Ban,
	skipped: Ban,
};

export default function JobDetail() {
	const { id } = useParams();
	const queryClient = useQueryClient();
	const toast = useToast();
	const [expandedHosts, setExpandedHosts] = useState(new Set());
	const [diffData, setDiffData] = useState({});

	// Load job details
	const { data: jobData, isLoading } = useQuery({
		queryKey: ["patchmgmt", "job", id],
		queryFn: () => patchManagementAPI.getJob(id).then((r) => r.data),
		refetchInterval: (data) => {
			const status = data?.state?.data?.job?.status;
			return status === "running" || status === "pending" ? 5000 : false;
		},
	});

	const job = jobData?.job;
	const jobHosts = job?.patch_job_hosts || [];
	const policy = job?.patch_policy;

	// Cancel mutation
	const cancelMutation = useMutation({
		mutationFn: () => patchManagementAPI.cancelJob(id),
		onSuccess: () => {
			queryClient.invalidateQueries(["patchmgmt"]);
			toast.success("Job cancelled");
		},
		onError: (err) => toast.error(err.response?.data?.error || "Cancel failed"),
	});

	function toggleHost(hostId) {
		const next = new Set(expandedHosts);
		if (next.has(hostId)) {
			next.delete(hostId);
		} else {
			next.add(hostId);
		}
		setExpandedHosts(next);
	}

	async function loadDiff(jobHostId) {
		if (diffData[jobHostId]) return;
		try {
			const res = await patchManagementAPI.getJobHostDiff(id, jobHostId);
			setDiffData((prev) => ({ ...prev, [jobHostId]: res.data }));
		} catch {
			toast.error("Failed to load diff");
		}
	}

	if (isLoading) {
		return (
			<div className="flex items-center justify-center py-20">
				<Loader2 className="h-8 w-8 animate-spin text-primary-600" />
			</div>
		);
	}

	if (!job) {
		return (
			<div className="text-center py-20">
				<p className="text-secondary-500 dark:text-secondary-400">
					Job not found
				</p>
				<Link
					to="/patch-management"
					className="text-primary-600 hover:underline text-sm mt-2 inline-block"
				>
					Back to Patch Management
				</Link>
			</div>
		);
	}

	const isActive = job.status === "running" || job.status === "pending";

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-3">
					<Link
						to="/patch-management"
						className="p-1.5 rounded-md text-secondary-500 hover:bg-secondary-100 dark:hover:bg-secondary-700"
					>
						<ArrowLeft className="h-5 w-5" />
					</Link>
					<div>
						<div className="flex items-center gap-3">
							<h1 className="text-xl font-bold text-secondary-900 dark:text-white">
								Patch Job
							</h1>
							<StatusBadge status={job.status} />
						</div>
						<p className="text-sm text-secondary-500 dark:text-secondary-400">
							{policy?.name || "Unknown Policy"} &middot; Triggered{" "}
							{job.triggered_by}{" "}
							{job.triggered_by_user && `by ${job.triggered_by_user}`} &middot;{" "}
							{new Date(job.created_at).toLocaleString()}
						</p>
					</div>
				</div>
				{isActive && (
					<button
						onClick={() => {
							if (
								window.confirm(
									"Cancel this patch job? Pending hosts will be skipped.",
								)
							) {
								cancelMutation.mutate();
							}
						}}
						disabled={cancelMutation.isPending}
						className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
					>
						<Ban className="h-4 w-4" /> Cancel Job
					</button>
				)}
			</div>

			{/* Summary cards */}
			<div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
				<StatCard
					label="Total Hosts"
					value={job.total_hosts}
					color="secondary"
				/>
				<StatCard label="Completed" value={job.completed_hosts} color="green" />
				<StatCard label="Failed" value={job.failed_hosts} color="red" />
				<StatCard label="Skipped" value={job.skipped_hosts} color="yellow" />
				<StatCard
					label="Duration"
					value={
						job.started_at
							? formatDuration(
									job.started_at,
									job.completed_at || new Date().toISOString(),
								)
							: "—"
					}
					color="blue"
				/>
			</div>

			{/* Progress bar */}
			{isActive && job.total_hosts > 0 && (
				<div className="bg-white dark:bg-secondary-800 border border-secondary-200 dark:border-secondary-700 rounded-lg p-4">
					<div className="flex items-center justify-between text-sm mb-2">
						<span className="text-secondary-700 dark:text-secondary-300">
							Progress
						</span>
						<span className="text-secondary-900 dark:text-white font-medium">
							{job.completed_hosts + job.failed_hosts + job.skipped_hosts} /{" "}
							{job.total_hosts}
						</span>
					</div>
					<div className="w-full bg-secondary-200 dark:bg-secondary-700 rounded-full h-2">
						<div
							className="h-2 rounded-full bg-primary-600 transition-all duration-500"
							style={{
								width: `${((job.completed_hosts + job.failed_hosts + job.skipped_hosts) / job.total_hosts) * 100}%`,
							}}
						/>
					</div>
				</div>
			)}

			{/* Host list */}
			<div className="bg-white dark:bg-secondary-800 border border-secondary-200 dark:border-secondary-700 rounded-lg overflow-hidden">
				<div className="px-5 py-3 border-b border-secondary-200 dark:border-secondary-700">
					<h3 className="text-sm font-semibold text-secondary-900 dark:text-white flex items-center gap-2">
						<Server className="h-4 w-4" /> Host Results ({jobHosts.length})
					</h3>
				</div>
				<div className="divide-y divide-secondary-200 dark:divide-secondary-700">
					{jobHosts.length === 0 ? (
						<p className="p-5 text-sm text-secondary-500 dark:text-secondary-400 text-center">
							No host records yet.
						</p>
					) : (
						jobHosts.map((jh) => (
							<HostRow
								key={jh.id}
								jobHost={jh}
								jobId={id}
								isExpanded={expandedHosts.has(jh.id)}
								onToggle={() => toggleHost(jh.id)}
								diffData={diffData[jh.id]}
								onLoadDiff={() => loadDiff(jh.id)}
							/>
						))
					)}
				</div>
			</div>
		</div>
	);
}

function HostRow({ jobHost, isExpanded, onToggle, diffData, onLoadDiff }) {
	const host = jobHost.host;
	const packages = jobHost.patch_job_packages || [];
	const StatusIcon = STATUS_ICONS[jobHost.status] || Clock;

	return (
		<div>
			<button
				onClick={onToggle}
				className="w-full flex items-center justify-between px-5 py-3 hover:bg-secondary-50 dark:hover:bg-secondary-700/30 text-left"
			>
				<div className="flex items-center gap-3">
					{isExpanded ? (
						<ChevronDown className="h-4 w-4 text-secondary-400" />
					) : (
						<ChevronRight className="h-4 w-4 text-secondary-400" />
					)}
					<StatusIcon className="h-4 w-4 text-secondary-500" />
					<div>
						<p className="text-sm font-medium text-secondary-900 dark:text-white">
							{host?.friendly_name || host?.hostname || "Unknown Host"}
						</p>
						<p className="text-xs text-secondary-500 dark:text-secondary-400">
							{host?.os_type} {host?.os_version}
						</p>
					</div>
				</div>
				<div className="flex items-center gap-3">
					<div className="text-right text-xs">
						<span className="text-green-600 dark:text-green-400">
							{jobHost.packages_updated || 0} updated
						</span>
						{(jobHost.packages_failed || 0) > 0 && (
							<span className="text-red-500 ml-2">
								{jobHost.packages_failed} failed
							</span>
						)}
					</div>
					<StatusBadge status={jobHost.status} />
					{jobHost.reboot_required && (
						<span className="px-1.5 py-0.5 text-xs bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300 rounded">
							reboot {jobHost.reboot_completed ? "done" : "needed"}
						</span>
					)}
				</div>
			</button>

			{isExpanded && (
				<div className="px-5 pb-4 space-y-3 bg-secondary-50/50 dark:bg-secondary-900/30">
					{/* Error message */}
					{jobHost.error_message && (
						<div className="flex items-start gap-2 px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
							<AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
							<p className="text-xs text-red-700 dark:text-red-300">
								{jobHost.error_message}
							</p>
						</div>
					)}

					{/* Timing */}
					<div className="flex items-center gap-4 text-xs text-secondary-500 dark:text-secondary-400">
						{jobHost.started_at && (
							<span>
								Started: {new Date(jobHost.started_at).toLocaleTimeString()}
							</span>
						)}
						{jobHost.completed_at && (
							<span>
								Completed: {new Date(jobHost.completed_at).toLocaleTimeString()}
							</span>
						)}
						{jobHost.started_at && jobHost.completed_at && (
							<span>
								Duration:{" "}
								{formatDuration(jobHost.started_at, jobHost.completed_at)}
							</span>
						)}
					</div>

					{/* Package table */}
					{packages.length > 0 && (
						<div className="border border-secondary-200 dark:border-secondary-700 rounded-md overflow-hidden">
							<table className="w-full text-xs">
								<thead>
									<tr className="bg-secondary-100 dark:bg-secondary-800">
										<th className="text-left px-3 py-1.5 font-medium text-secondary-600 dark:text-secondary-400">
											Package
										</th>
										<th className="text-left px-3 py-1.5 font-medium text-secondary-600 dark:text-secondary-400">
											Previous
										</th>
										<th className="text-left px-3 py-1.5 font-medium text-secondary-600 dark:text-secondary-400">
											Target
										</th>
										<th className="text-left px-3 py-1.5 font-medium text-secondary-600 dark:text-secondary-400">
											Installed
										</th>
										<th className="text-left px-3 py-1.5 font-medium text-secondary-600 dark:text-secondary-400">
											Status
										</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-secondary-200 dark:divide-secondary-700">
									{packages.map((pkg) => (
										<tr
											key={pkg.id}
											className="bg-white dark:bg-secondary-800/50"
										>
											<td className="px-3 py-1.5 font-mono text-secondary-900 dark:text-white">
												{pkg.package_name}
											</td>
											<td className="px-3 py-1.5 text-secondary-500 dark:text-secondary-400 font-mono">
												{pkg.previous_version || "—"}
											</td>
											<td className="px-3 py-1.5 text-secondary-500 dark:text-secondary-400 font-mono">
												{pkg.target_version || "—"}
											</td>
											<td className="px-3 py-1.5 text-secondary-900 dark:text-white font-mono">
												{pkg.installed_version || "—"}
											</td>
											<td className="px-3 py-1.5">
												<span
													className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${
														STATUS_STYLES[pkg.status] || ""
													}`}
												>
													{pkg.status}
												</span>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}

					{/* Diff button */}
					{(jobHost.pre_snapshot || jobHost.post_snapshot) && (
						<div>
							<button
								onClick={onLoadDiff}
								className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md bg-secondary-100 dark:bg-secondary-700 text-secondary-700 dark:text-secondary-300 hover:bg-secondary-200 dark:hover:bg-secondary-600"
							>
								<Diff className="h-3 w-3" /> View Snapshot Diff
							</button>
							{diffData && (
								<div className="mt-2 border border-secondary-200 dark:border-secondary-700 rounded-md overflow-auto max-h-64">
									<DiffView diff={diffData} />
								</div>
							)}
						</div>
					)}
				</div>
			)}
		</div>
	);
}

function DiffView({ diff }) {
	if (!diff || !diff.diff) {
		return (
			<p className="p-3 text-xs text-secondary-500 dark:text-secondary-400">
				No diff data available.
			</p>
		);
	}
	const d = diff.diff;
	return (
		<div className="p-3 text-xs space-y-2">
			{d.updated?.length > 0 && (
				<div>
					<p className="font-medium text-green-700 dark:text-green-400 mb-1">
						Updated ({d.updated.length})
					</p>
					<div className="space-y-0.5">
						{d.updated.map((u) => (
							<div
								key={u.name}
								className="font-mono text-secondary-700 dark:text-secondary-300"
							>
								<span className="text-green-600 dark:text-green-400">+</span>{" "}
								{u.name}: {u.old_version} → {u.new_version}
							</div>
						))}
					</div>
				</div>
			)}
			{d.added?.length > 0 && (
				<div>
					<p className="font-medium text-blue-700 dark:text-blue-400 mb-1">
						Added ({d.added.length})
					</p>
					{d.added.map((a) => (
						<div
							key={a.name}
							className="font-mono text-secondary-700 dark:text-secondary-300"
						>
							<span className="text-blue-600 dark:text-blue-400">+</span>{" "}
							{a.name} {a.version}
						</div>
					))}
				</div>
			)}
			{d.removed?.length > 0 && (
				<div>
					<p className="font-medium text-red-700 dark:text-red-400 mb-1">
						Removed ({d.removed.length})
					</p>
					{d.removed.map((r) => (
						<div
							key={r.name}
							className="font-mono text-secondary-700 dark:text-secondary-300"
						>
							<span className="text-red-600 dark:text-red-400">-</span> {r.name}{" "}
							{r.version}
						</div>
					))}
				</div>
			)}
			{!d.updated?.length && !d.added?.length && !d.removed?.length && (
				<p className="text-secondary-500">No changes detected in snapshots.</p>
			)}
		</div>
	);
}

function StatCard({ label, value, color }) {
	const colorMap = {
		green: "text-green-600 dark:text-green-400",
		red: "text-red-600 dark:text-red-400",
		yellow: "text-yellow-600 dark:text-yellow-400",
		blue: "text-blue-600 dark:text-blue-400",
		secondary: "text-secondary-900 dark:text-white",
	};
	return (
		<div className="bg-white dark:bg-secondary-800 border border-secondary-200 dark:border-secondary-700 rounded-lg p-3 text-center">
			<p
				className={`text-lg font-bold ${colorMap[color] || colorMap.secondary}`}
			>
				{value}
			</p>
			<p className="text-xs text-secondary-500 dark:text-secondary-400">
				{label}
			</p>
		</div>
	);
}

function StatusBadge({ status }) {
	return (
		<span
			className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${
				STATUS_STYLES[status] || ""
			}`}
		>
			{status?.replace(/_/g, " ")}
		</span>
	);
}

function formatDuration(start, end) {
	const ms = new Date(end) - new Date(start);
	const secs = Math.floor(ms / 1000);
	if (secs < 60) return `${secs}s`;
	const mins = Math.floor(secs / 60);
	const remainSecs = secs % 60;
	if (mins < 60) return `${mins}m ${remainSecs}s`;
	const hours = Math.floor(mins / 60);
	const remainMins = mins % 60;
	return `${hours}h ${remainMins}m`;
}
