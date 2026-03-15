import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	AlertTriangle,
	ArrowUpDown,
	Ban,
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	Clock,
	Diff,
	Loader2,
	Package,
	Play,
	RefreshCw,
	RotateCcw,
	Server,
	XCircle,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
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

const PAGE_SIZE = 15;

export default function PatchResultsTab({ hostId }) {
	const queryClient = useQueryClient();
	const { canManagePatchManagement } = useAuth();
	const [page, setPage] = useState(0);
	const [expandedRows, setExpandedRows] = useState(new Set());
	const [diffData, setDiffData] = useState({});
	const [statusFilter, setStatusFilter] = useState("");
	const [triggerMsg, setTriggerMsg] = useState(null);
	const [showPolicyPicker, setShowPolicyPicker] = useState(false);
	const [selectedPolicies, setSelectedPolicies] = useState(new Set());

	const { data, isLoading, isError } = useQuery({
		queryKey: ["patchmgmt", "host-results", hostId, page, statusFilter],
		queryFn: () =>
			patchManagementAPI
				.getHostPatchResults(hostId, {
					limit: PAGE_SIZE,
					offset: page * PAGE_SIZE,
					...(statusFilter ? { status: statusFilter } : {}),
				})
				.then((r) => r.data),
		keepPreviousData: true,
	});

	// Fetch applicable policies when picker is open
	const { data: policiesData, isLoading: policiesLoading } = useQuery({
		queryKey: ["patchmgmt", "host-applicable-policies", hostId],
		queryFn: () =>
			patchManagementAPI.getHostApplicablePolicies(hostId).then((r) => r.data),
		enabled: showPolicyPicker,
	});
	const applicablePolicies = policiesData?.policies || [];

	const results = data?.results || [];
	const total = data?.total || 0;
	const summary = data?.summary || {};
	const totalPages = Math.ceil(total / PAGE_SIZE);

	// Run patches mutation — now sends selected policyIds
	const runPatchesMutation = useMutation({
		mutationFn: (policyIds) =>
			patchManagementAPI
				.triggerHostPatches(hostId, policyIds)
				.then((r) => r.data),
		onSuccess: (resp) => {
			queryClient.invalidateQueries(["patchmgmt", "host-results", hostId]);
			const jobs = resp.jobs || [];
			const totalPkgs = jobs.reduce(
				(sum, j) => sum + (j.packages_count ?? 0),
				0,
			);
			const names = jobs.map((j) => j.policy?.name).filter(Boolean);
			setTriggerMsg({
				type: "success",
				text: `${jobs.length} job(s) created — ${totalPkgs} package(s) via ${names.length ? `"${names.join('", "')}"` : "selected policies"}`,
			});
			setShowPolicyPicker(false);
			setSelectedPolicies(new Set());
			setTimeout(() => setTriggerMsg(null), 6000);
		},
		onError: (err) => {
			setTriggerMsg({
				type: "error",
				text: err.response?.data?.error || "Failed to trigger patches",
			});
			setTimeout(() => setTriggerMsg(null), 6000);
		},
	});

	function openPolicyPicker() {
		setSelectedPolicies(new Set());
		setShowPolicyPicker(true);
	}

	function togglePolicySelection(policyId) {
		setSelectedPolicies((prev) => {
			const next = new Set(prev);
			if (next.has(policyId)) next.delete(policyId);
			else next.add(policyId);
			return next;
		});
	}

	function toggleRow(id) {
		setExpandedRows((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	async function loadDiff(jobId, jobHostId) {
		if (diffData[jobHostId]) return;
		try {
			const res = await patchManagementAPI.getJobHostDiff(jobId, jobHostId);
			setDiffData((prev) => ({ ...prev, [jobHostId]: res.data }));
		} catch {
			// silently fail
		}
	}

	if (isLoading) {
		return (
			<div className="flex items-center justify-center py-16">
				<Loader2 className="h-8 w-8 animate-spin text-primary-600" />
			</div>
		);
	}

	if (isError) {
		return (
			<div className="text-center py-16">
				<XCircle className="h-8 w-8 text-red-400 mx-auto mb-2" />
				<p className="text-sm text-secondary-500 dark:text-secondary-400">
					Failed to load patch results
				</p>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			{/* Summary cards */}
			{summary.total_jobs > 0 && (
				<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
					<SummaryCard
						label="Total Jobs"
						value={summary.total_jobs}
						color="secondary"
					/>
					<SummaryCard
						label="Completed"
						value={summary.completed}
						color="green"
					/>
					<SummaryCard label="Failed" value={summary.failed} color="red" />
					<SummaryCard label="Skipped" value={summary.skipped} color="yellow" />
					<SummaryCard
						label="Pkgs Updated"
						value={summary.total_packages_updated}
						color="green"
					/>
					<SummaryCard
						label="Pkgs Failed"
						value={summary.total_packages_failed}
						color="red"
					/>
				</div>
			)}

			{/* Filter row */}
			<div className="flex items-center justify-between">
				<h3 className="text-sm font-semibold text-secondary-900 dark:text-white flex items-center gap-2">
					<Package className="h-4 w-4" />
					Patch Job Results ({total})
				</h3>
				<div className="flex items-center gap-2">
					{canManagePatchManagement && (
						<button
							type="button"
							onClick={openPolicyPicker}
							className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-primary-600 text-white hover:bg-primary-700 transition-colors"
						>
							<Play className="h-3 w-3" />
							Run Patches
						</button>
					)}
					<select
						value={statusFilter}
						onChange={(e) => {
							setStatusFilter(e.target.value);
							setPage(0);
						}}
						className="text-xs border border-secondary-300 dark:border-secondary-600 rounded-md px-2 py-1 bg-white dark:bg-secondary-800 text-secondary-700 dark:text-secondary-300"
					>
						<option value="">All statuses</option>
						<option value="completed">Completed</option>
						<option value="failed">Failed</option>
						<option value="skipped">Skipped</option>
						<option value="pending">Pending</option>
						<option value="running">Running</option>
					</select>
				</div>
			</div>

			{/* Policy picker modal */}
			{showPolicyPicker && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
					<div className="bg-white dark:bg-secondary-800 rounded-lg shadow-xl border border-secondary-200 dark:border-secondary-700 w-full max-w-md mx-4">
						<div className="flex items-center justify-between px-4 py-3 border-b border-secondary-200 dark:border-secondary-700">
							<h3 className="text-sm font-semibold text-secondary-900 dark:text-white">
								Select Policies to Run
							</h3>
							<button
								type="button"
								onClick={() => setShowPolicyPicker(false)}
								className="text-secondary-400 hover:text-secondary-600 dark:hover:text-secondary-300"
							>
								<XCircle className="h-4 w-4" />
							</button>
						</div>
						<div className="px-4 py-3 max-h-64 overflow-y-auto">
							{policiesLoading ? (
								<div className="flex items-center justify-center py-6">
									<Loader2 className="h-5 w-5 animate-spin text-primary-600" />
								</div>
							) : applicablePolicies.length === 0 ? (
								<p className="text-xs text-secondary-500 dark:text-secondary-400 text-center py-4">
									No applicable policies found for this host
								</p>
							) : (
								<div className="space-y-2">
									{applicablePolicies.map((policy) => (
										<label
											key={policy.id}
											className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-secondary-50 dark:hover:bg-secondary-700/50 cursor-pointer transition-colors"
										>
											<input
												type="checkbox"
												checked={selectedPolicies.has(policy.id)}
												onChange={() => togglePolicySelection(policy.id)}
												className="h-4 w-4 rounded border-secondary-300 text-primary-600 focus:ring-primary-500"
											/>
											<div className="flex-1 min-w-0">
												<p className="text-sm font-medium text-secondary-900 dark:text-white truncate">
													{policy.name}
												</p>
												{policy.description && (
													<p className="text-xs text-secondary-500 dark:text-secondary-400 truncate">
														{policy.description}
													</p>
												)}
											</div>
											<span className="text-xs font-medium text-secondary-500 dark:text-secondary-400 shrink-0">
												{policy.packages_count} pkg
												{policy.packages_count !== 1 ? "s" : ""}
											</span>
										</label>
									))}
								</div>
							)}
						</div>
						<div className="flex items-center justify-between px-4 py-3 border-t border-secondary-200 dark:border-secondary-700">
							<button
								type="button"
								onClick={() => {
									if (selectedPolicies.size === applicablePolicies.length) {
										setSelectedPolicies(new Set());
									} else {
										setSelectedPolicies(
											new Set(applicablePolicies.map((p) => p.id)),
										);
									}
								}}
								disabled={applicablePolicies.length === 0}
								className="text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 font-medium disabled:opacity-50"
							>
								{selectedPolicies.size === applicablePolicies.length &&
								applicablePolicies.length > 0
									? "Deselect All"
									: "Select All"}
							</button>
							<div className="flex items-center gap-2">
								<button
									type="button"
									onClick={() => setShowPolicyPicker(false)}
									className="px-3 py-1.5 text-xs font-medium rounded-md border border-secondary-300 dark:border-secondary-600 text-secondary-700 dark:text-secondary-300 hover:bg-secondary-50 dark:hover:bg-secondary-700 transition-colors"
								>
									Cancel
								</button>
								<button
									type="button"
									onClick={() =>
										runPatchesMutation.mutate([...selectedPolicies])
									}
									disabled={
										selectedPolicies.size === 0 || runPatchesMutation.isPending
									}
									className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
								>
									{runPatchesMutation.isPending ? (
										<Loader2 className="h-3 w-3 animate-spin" />
									) : (
										<Play className="h-3 w-3" />
									)}
									{runPatchesMutation.isPending
										? "Creating..."
										: `Run ${selectedPolicies.size} ${selectedPolicies.size === 1 ? "Policy" : "Policies"}`}
								</button>
							</div>
						</div>
					</div>
				</div>
			)}

			{/* Trigger feedback */}
			{triggerMsg && (
				<div
					className={`text-xs px-3 py-2 rounded-md ${
						triggerMsg.type === "success"
							? "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300 border border-green-200 dark:border-green-800"
							: "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300 border border-red-200 dark:border-red-800"
					}`}
				>
					{triggerMsg.type === "success" ? (
						<CheckCircle2 className="h-3.5 w-3.5 inline mr-1.5 -mt-0.5" />
					) : (
						<XCircle className="h-3.5 w-3.5 inline mr-1.5 -mt-0.5" />
					)}
					{triggerMsg.text}
				</div>
			)}

			{/* Results list */}
			{results.length === 0 ? (
				<div className="text-center py-12 bg-white dark:bg-secondary-800 border border-secondary-200 dark:border-secondary-700 rounded-lg">
					<Package className="h-8 w-8 text-secondary-400 mx-auto mb-2" />
					<p className="text-sm text-secondary-500 dark:text-secondary-400">
						No patch results found for this host
					</p>
					<p className="text-xs text-secondary-400 dark:text-secondary-500 mt-1">
						Patch jobs targeting this host will appear here
					</p>
				</div>
			) : (
				<div className="bg-white dark:bg-secondary-800 border border-secondary-200 dark:border-secondary-700 rounded-lg overflow-hidden">
					<div className="divide-y divide-secondary-200 dark:divide-secondary-700">
						{results.map((jh) => (
							<ResultRow
								key={jh.id}
								jobHost={jh}
								isExpanded={expandedRows.has(jh.id)}
								onToggle={() => toggleRow(jh.id)}
								diffData={diffData[jh.id]}
								onLoadDiff={() => loadDiff(jh.job?.id, jh.id)}
							/>
						))}
					</div>
				</div>
			)}

			{/* Pagination */}
			{totalPages > 1 && (
				<div className="flex items-center justify-between text-sm">
					<p className="text-secondary-500 dark:text-secondary-400">
						Showing {page * PAGE_SIZE + 1}–
						{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
					</p>
					<div className="flex gap-1">
						<button
							type="button"
							onClick={() => setPage((p) => Math.max(0, p - 1))}
							disabled={page === 0}
							className="px-2.5 py-1 rounded-md text-xs font-medium bg-secondary-100 dark:bg-secondary-700 text-secondary-700 dark:text-secondary-300 hover:bg-secondary-200 dark:hover:bg-secondary-600 disabled:opacity-40 disabled:cursor-not-allowed"
						>
							Prev
						</button>
						<button
							type="button"
							onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
							disabled={page >= totalPages - 1}
							className="px-2.5 py-1 rounded-md text-xs font-medium bg-secondary-100 dark:bg-secondary-700 text-secondary-700 dark:text-secondary-300 hover:bg-secondary-200 dark:hover:bg-secondary-600 disabled:opacity-40 disabled:cursor-not-allowed"
						>
							Next
						</button>
					</div>
				</div>
			)}
		</div>
	);
}

function ResultRow({ jobHost, isExpanded, onToggle, diffData, onLoadDiff }) {
	const job = jobHost.job;
	const packages = jobHost.patch_job_packages || [];
	const StatusIcon = STATUS_ICONS[jobHost.status] || Clock;

	return (
		<div>
			<button
				type="button"
				onClick={onToggle}
				className="w-full flex items-center justify-between px-4 py-3 hover:bg-secondary-50 dark:hover:bg-secondary-700/30 text-left"
			>
				<div className="flex items-center gap-3 min-w-0">
					{isExpanded ? (
						<ChevronDown className="h-4 w-4 text-secondary-400 flex-shrink-0" />
					) : (
						<ChevronRight className="h-4 w-4 text-secondary-400 flex-shrink-0" />
					)}
					<StatusIcon className="h-4 w-4 text-secondary-500 flex-shrink-0" />
					<div className="min-w-0">
						<p className="text-sm font-medium text-secondary-900 dark:text-white truncate">
							{job?.policy?.name || "Unknown Policy"}
						</p>
						<p className="text-xs text-secondary-500 dark:text-secondary-400">
							{job ? new Date(job.created_at).toLocaleString() : "Unknown date"}{" "}
							&middot; {job?.triggered_by || "manual"}
							{job?.window?.name && ` · ${job.window.name}`}
						</p>
					</div>
				</div>
				<div className="flex items-center gap-3 flex-shrink-0">
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
				<div className="px-4 pb-4 space-y-3 bg-secondary-50/50 dark:bg-secondary-900/30">
					{/* Error message */}
					{jobHost.error_message && (
						<div className="flex items-start gap-2 px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
							<AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
							<p className="text-xs text-red-700 dark:text-red-300">
								{jobHost.error_message}
							</p>
						</div>
					)}

					{/* Timing + link */}
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-4 text-xs text-secondary-500 dark:text-secondary-400">
							{jobHost.started_at && (
								<span>
									Started: {new Date(jobHost.started_at).toLocaleTimeString()}
								</span>
							)}
							{jobHost.completed_at && (
								<span>
									Completed:{" "}
									{new Date(jobHost.completed_at).toLocaleTimeString()}
								</span>
							)}
							{jobHost.started_at && jobHost.completed_at && (
								<span>
									Duration:{" "}
									{formatDuration(jobHost.started_at, jobHost.completed_at)}
								</span>
							)}
						</div>
						{job?.id && (
							<Link
								to={`/patch-management/jobs/${job.id}`}
								className="text-xs text-primary-600 dark:text-primary-400 hover:underline flex items-center gap-1"
							>
								<Server className="h-3 w-3" />
								View Full Job
							</Link>
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
								type="button"
								onClick={onLoadDiff}
								className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md bg-secondary-100 dark:bg-secondary-700 text-secondary-700 dark:text-secondary-300 hover:bg-secondary-200 dark:hover:bg-secondary-600"
							>
								<Diff className="h-3 w-3" /> View Snapshot Diff
							</button>
							{diffData && <DiffView diff={diffData} />}
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
			<p className="mt-2 p-3 text-xs text-secondary-500 dark:text-secondary-400 border border-secondary-200 dark:border-secondary-700 rounded-md">
				No diff data available.
			</p>
		);
	}
	const d = diff.diff;
	return (
		<div className="mt-2 border border-secondary-200 dark:border-secondary-700 rounded-md overflow-auto max-h-64 p-3 text-xs space-y-2">
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

function SummaryCard({ label, value, color }) {
	const colorMap = {
		green: "text-green-600 dark:text-green-400",
		red: "text-red-600 dark:text-red-400",
		yellow: "text-yellow-600 dark:text-yellow-400",
		secondary: "text-secondary-900 dark:text-white",
	};
	return (
		<div className="bg-white dark:bg-secondary-800 border border-secondary-200 dark:border-secondary-700 rounded-lg p-3 text-center">
			<p
				className={`text-lg font-bold ${colorMap[color] || colorMap.secondary}`}
			>
				{value ?? 0}
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
