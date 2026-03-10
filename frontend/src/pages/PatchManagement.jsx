import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	BarChart3,
	Calendar,
	ChevronRight,
	Clock,
	Filter,
	History,
	Loader2,
	Package,
	Pause,
	Pencil,
	Play,
	Plus,
	Search,
	Server,
	Shield,
	Trash2,
	XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useToast } from "../contexts/ToastContext";
import { patchManagementAPI } from "../utils/patchManagementApi";

// ─── Tab definitions ───────────────────────────────────────────────────────
const TABS = [
	{ id: "overview", label: "Overview", icon: BarChart3 },
	{ id: "policies", label: "Policies", icon: Shield },
	{ id: "windows", label: "Windows", icon: Calendar },
	{ id: "jobs", label: "Jobs", icon: Play },
	{ id: "history", label: "History", icon: History },
];

// ─── Helpers ────────────────────────────────────────────────────────────────
function statusBadge(status) {
	const map = {
		pending: {
			color:
				"bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
			label: "Pending",
		},
		running: {
			color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
			label: "Running",
		},
		completed: {
			color:
				"bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
			label: "Completed",
		},
		completed_with_errors: {
			color:
				"bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
			label: "Partial",
		},
		failed: {
			color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
			label: "Failed",
		},
		cancelled: {
			color:
				"bg-secondary-100 text-secondary-800 dark:bg-secondary-700 dark:text-secondary-300",
			label: "Cancelled",
		},
		skipped: {
			color:
				"bg-secondary-100 text-secondary-600 dark:bg-secondary-700 dark:text-secondary-400",
			label: "Skipped",
		},
	};
	const s = map[status] || {
		color: "bg-secondary-100 text-secondary-800",
		label: status,
	};
	return (
		<span
			className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${s.color}`}
		>
			{s.label}
		</span>
	);
}

function policyTypeBadge(type) {
	const map = {
		all: {
			color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
			label: "All Updates",
		},
		security_only: {
			color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
			label: "Security Only",
		},
		selected: {
			color:
				"bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
			label: "Selected",
		},
	};
	const s = map[type] || {
		color: "bg-secondary-100 text-secondary-800",
		label: type,
	};
	return (
		<span
			className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${s.color}`}
		>
			{s.label}
		</span>
	);
}

function timeAgo(dateStr) {
	if (!dateStr) return "Never";
	const diff = Date.now() - new Date(dateStr).getTime();
	const mins = Math.floor(diff / 60000);
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins}m ago`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}

function formatDate(dateStr) {
	if (!dateStr) return "—";
	return new Date(dateStr).toLocaleString();
}

// ─── Component ──────────────────────────────────────────────────────────────
export default function PatchManagementPage() {
	const [activeTab, setActiveTab] = useState("overview");
	const [policySearch, setPolicySearch] = useState("");
	const [jobFilter, setJobFilter] = useState("");

	const queryClient = useQueryClient();
	const toast = useToast();
	const navigate = useNavigate();

	// ─── Queries ────────────────────────────────────────────────────
	const { data: stats, isLoading: statsLoading } = useQuery({
		queryKey: ["patchmgmt", "stats"],
		queryFn: () => patchManagementAPI.getStats().then((r) => r.data.stats),
		staleTime: 30_000,
		refetchInterval: 60_000,
	});

	const { data: policies } = useQuery({
		queryKey: ["patchmgmt", "policies"],
		queryFn: () =>
			patchManagementAPI.listPolicies().then((r) => r.data.policies),
		enabled: activeTab === "policies" || activeTab === "overview",
	});

	const { data: windows } = useQuery({
		queryKey: ["patchmgmt", "windows"],
		queryFn: () => patchManagementAPI.listWindows().then((r) => r.data.windows),
		enabled: activeTab === "windows" || activeTab === "overview",
	});

	const { data: jobsData } = useQuery({
		queryKey: ["patchmgmt", "jobs", jobFilter],
		queryFn: () =>
			patchManagementAPI
				.listJobs({ status: jobFilter || undefined, limit: 50 })
				.then((r) => r.data),
		enabled: activeTab === "jobs" || activeTab === "overview",
	});

	const { data: historyData } = useQuery({
		queryKey: ["patchmgmt", "history"],
		queryFn: () =>
			patchManagementAPI.getHistory({ limit: 50 }).then((r) => r.data),
		enabled: activeTab === "history",
	});

	// ─── Mutations ──────────────────────────────────────────────────
	const deletePolicy = useMutation({
		mutationFn: (id) => patchManagementAPI.deletePolicy(id),
		onSuccess: () => {
			queryClient.invalidateQueries(["patchmgmt"]);
			toast.success("Policy deleted");
		},
		onError: (err) => toast.error(err.response?.data?.error || "Delete failed"),
	});

	const deleteWindow = useMutation({
		mutationFn: (id) => patchManagementAPI.deleteWindow(id),
		onSuccess: () => {
			queryClient.invalidateQueries(["patchmgmt"]);
			toast.success("Window deleted");
		},
		onError: (err) => toast.error(err.response?.data?.error || "Delete failed"),
	});

	const triggerJob = useMutation({
		mutationFn: (policyId) =>
			patchManagementAPI.triggerJob({ policy_id: policyId }),
		onSuccess: (res) => {
			queryClient.invalidateQueries(["patchmgmt"]);
			toast.success(`Job created for ${res.data.hosts_count} hosts`);
		},
		onError: (err) =>
			toast.error(err.response?.data?.error || "Failed to trigger job"),
	});

	const cancelJob = useMutation({
		mutationFn: (id) => patchManagementAPI.cancelJob(id),
		onSuccess: () => {
			queryClient.invalidateQueries(["patchmgmt"]);
			toast.success("Job cancelled");
		},
		onError: (err) => toast.error(err.response?.data?.error || "Cancel failed"),
	});

	// ─── Filtered data ──────────────────────────────────────────────
	const filteredPolicies = useMemo(() => {
		if (!policies) return [];
		if (!policySearch) return policies;
		const q = policySearch.toLowerCase();
		return policies.filter(
			(p) =>
				p.name.toLowerCase().includes(q) ||
				(p.description || "").toLowerCase().includes(q),
		);
	}, [policies, policySearch]);

	// ─── Render ─────────────────────────────────────────────────────
	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold text-secondary-900 dark:text-white flex items-center gap-2">
						<Shield className="h-7 w-7 text-primary-600" />
						Patch Management
					</h1>
					<p className="mt-1 text-sm text-secondary-600 dark:text-secondary-400">
						Define policies, schedule maintenance windows, and track patch
						deployments across your infrastructure
					</p>
				</div>
			</div>

			{/* Tabs */}
			<div className="border-b border-secondary-200 dark:border-secondary-700">
				<nav className="flex space-x-6 -mb-px">
					{TABS.map((tab) => {
						const Icon = tab.icon;
						return (
							<button
								key={tab.id}
								onClick={() => setActiveTab(tab.id)}
								className={`flex items-center gap-2 py-3 px-1 border-b-2 text-sm font-medium transition-colors ${
									activeTab === tab.id
										? "border-primary-600 text-primary-600 dark:text-primary-400 dark:border-primary-400"
										: "border-transparent text-secondary-500 hover:text-secondary-700 hover:border-secondary-300 dark:text-secondary-400 dark:hover:text-secondary-200"
								}`}
							>
								<Icon className="h-4 w-4" />
								{tab.label}
							</button>
						);
					})}
				</nav>
			</div>

			{/* Tab content */}
			{activeTab === "overview" && (
				<OverviewTab
					stats={stats}
					statsLoading={statsLoading}
					policies={policies}
					navigate={navigate}
					triggerJob={triggerJob}
				/>
			)}
			{activeTab === "policies" && (
				<PoliciesTab
					policies={filteredPolicies}
					search={policySearch}
					setSearch={setPolicySearch}
					deletePolicy={deletePolicy}
					triggerJob={triggerJob}
					navigate={navigate}
				/>
			)}
			{activeTab === "windows" && (
				<WindowsTab
					windows={windows}
					deleteWindow={deleteWindow}
					navigate={navigate}
				/>
			)}
			{activeTab === "jobs" && (
				<JobsTab
					jobs={jobsData?.jobs}
					total={jobsData?.total}
					filter={jobFilter}
					setFilter={setJobFilter}
					cancelJob={cancelJob}
				/>
			)}
			{activeTab === "history" && (
				<HistoryTab jobs={historyData?.jobs} total={historyData?.total} />
			)}
		</div>
	);
}

// ============================================================================
// OVERVIEW TAB
// ============================================================================
function OverviewTab({ stats, statsLoading, policies, navigate, triggerJob }) {
	if (statsLoading) {
		return (
			<div className="flex items-center justify-center py-20">
				<Loader2 className="h-8 w-8 animate-spin text-primary-600" />
			</div>
		);
	}

	return (
		<div className="space-y-6">
			{/* Stat cards */}
			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
				<StatCard
					title="Active Policies"
					value={stats?.policies?.active ?? 0}
					total={stats?.policies?.total}
					icon={Shield}
					color="primary"
				/>
				<StatCard
					title="Active Windows"
					value={stats?.windows?.active ?? 0}
					total={stats?.windows?.total}
					icon={Calendar}
					color="blue"
				/>
				<StatCard
					title="Running Jobs"
					value={stats?.jobs?.running ?? 0}
					icon={Play}
					color="green"
					subtitle={
						stats?.jobs?.pending > 0 ? `${stats.jobs.pending} pending` : null
					}
				/>
				<StatCard
					title="Success Rate (30d)"
					value={(() => {
						const j = stats?.jobs?.last_30_days || {};
						const completed =
							(j.completed || 0) + (j.completed_with_errors || 0);
						const total = completed + (j.failed || 0);
						return total > 0
							? `${Math.round((completed / total) * 100)}%`
							: "—";
					})()}
					icon={BarChart3}
					color="amber"
				/>
			</div>

			{/* Two-column layout: recent jobs + upcoming windows */}
			<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
				{/* Recent Jobs */}
				<div className="bg-white dark:bg-secondary-800 border border-secondary-200 dark:border-secondary-700 rounded-lg p-4">
					<h3 className="text-sm font-semibold text-secondary-900 dark:text-white mb-3 flex items-center gap-2">
						<History className="h-4 w-4" /> Recent Jobs
					</h3>
					{stats?.jobs?.recent?.length > 0 ? (
						<div className="space-y-2">
							{stats.jobs.recent.map((job) => (
								<Link
									key={job.id}
									to={`/patch-management/jobs/${job.id}`}
									className="flex items-center justify-between p-2 rounded-md hover:bg-secondary-50 dark:hover:bg-secondary-700/50 transition-colors"
								>
									<div className="flex items-center gap-2 min-w-0">
										{statusBadge(job.status)}
										<span className="text-sm text-secondary-700 dark:text-secondary-300 truncate">
											{job.policy?.name}
										</span>
									</div>
									<span className="text-xs text-secondary-500 dark:text-secondary-400 flex-shrink-0">
										{timeAgo(job.created_at)}
									</span>
								</Link>
							))}
						</div>
					) : (
						<p className="text-sm text-secondary-500 dark:text-secondary-400">
							No recent jobs
						</p>
					)}
				</div>

				{/* Upcoming Windows */}
				<div className="bg-white dark:bg-secondary-800 border border-secondary-200 dark:border-secondary-700 rounded-lg p-4">
					<h3 className="text-sm font-semibold text-secondary-900 dark:text-white mb-3 flex items-center gap-2">
						<Calendar className="h-4 w-4" /> Upcoming Windows
					</h3>
					{stats?.upcoming_windows?.length > 0 ? (
						<div className="space-y-2">
							{stats.upcoming_windows.map((w) => (
								<div
									key={w.id}
									className="flex items-center justify-between p-2 rounded-md hover:bg-secondary-50 dark:hover:bg-secondary-700/50"
								>
									<div className="min-w-0">
										<p className="text-sm font-medium text-secondary-900 dark:text-white truncate">
											{w.name}
										</p>
										<p className="text-xs text-secondary-500 dark:text-secondary-400">
											{w.policy?.name}
										</p>
									</div>
									<span className="text-xs text-secondary-500 dark:text-secondary-400 flex-shrink-0">
										{formatDate(w.next_run_at)}
									</span>
								</div>
							))}
						</div>
					) : (
						<p className="text-sm text-secondary-500 dark:text-secondary-400">
							No upcoming windows
						</p>
					)}
				</div>
			</div>

			{/* Quick-trigger from policies */}
			{policies?.length > 0 && (
				<div className="bg-white dark:bg-secondary-800 border border-secondary-200 dark:border-secondary-700 rounded-lg p-4">
					<h3 className="text-sm font-semibold text-secondary-900 dark:text-white mb-3 flex items-center gap-2">
						<Play className="h-4 w-4" /> Quick Actions
					</h3>
					<div className="flex flex-wrap gap-2">
						{policies
							.filter((p) => p.enabled)
							.slice(0, 6)
							.map((p) => (
								<button
									key={p.id}
									onClick={() => {
										if (
											window.confirm(`Trigger a patch job for "${p.name}"?`)
										) {
											triggerJob.mutate(p.id);
										}
									}}
									disabled={triggerJob.isPending}
									className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-primary-50 text-primary-700 hover:bg-primary-100 dark:bg-primary-900/30 dark:text-primary-300 dark:hover:bg-primary-900/50 transition-colors disabled:opacity-50"
								>
									<Play className="h-3 w-3" />
									{p.name}
								</button>
							))}
					</div>
				</div>
			)}
		</div>
	);
}

function StatCard({ title, value, total, icon: Icon, color, subtitle }) {
	const colorMap = {
		primary:
			"bg-primary-100 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400",
		blue: "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400",
		green:
			"bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400",
		amber:
			"bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400",
	};

	return (
		<div className="bg-white dark:bg-secondary-800 border border-secondary-200 dark:border-secondary-700 rounded-lg p-4">
			<div className="flex items-center gap-3">
				<div
					className={`w-10 h-10 rounded-lg flex items-center justify-center ${colorMap[color]}`}
				>
					<Icon className="h-5 w-5" />
				</div>
				<div>
					<p className="text-xs text-secondary-500 dark:text-secondary-400">
						{title}
					</p>
					<p className="text-xl font-bold text-secondary-900 dark:text-white">
						{value}
						{total !== undefined && (
							<span className="text-sm font-normal text-secondary-400 dark:text-secondary-500">
								/{total}
							</span>
						)}
					</p>
					{subtitle && (
						<p className="text-xs text-secondary-500 dark:text-secondary-400">
							{subtitle}
						</p>
					)}
				</div>
			</div>
		</div>
	);
}

// ============================================================================
// POLICIES TAB
// ============================================================================
function PoliciesTab({
	policies,
	search,
	setSearch,
	deletePolicy,
	triggerJob,
	navigate,
}) {
	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between gap-4">
				<div className="relative flex-1 max-w-md">
					<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-secondary-400" />
					<input
						type="text"
						placeholder="Search policies..."
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						className="w-full pl-10 pr-3 py-2 text-sm border border-secondary-300 dark:border-secondary-600 rounded-lg bg-white dark:bg-secondary-800 text-secondary-900 dark:text-white placeholder-secondary-400"
					/>
				</div>
				<Link
					to="/patch-management/policies/new"
					className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-primary-600 text-white hover:bg-primary-700 transition-colors"
				>
					<Plus className="h-4 w-4" /> New Policy
				</Link>
			</div>

			{!policies || policies.length === 0 ? (
				<div className="text-center py-12 text-secondary-500 dark:text-secondary-400">
					<Shield className="h-12 w-12 mx-auto mb-3 opacity-30" />
					<p className="font-medium">No policies found</p>
					<p className="text-sm mt-1">Create a patch policy to get started</p>
				</div>
			) : (
				<div className="grid gap-3">
					{policies.map((p) => (
						<div
							key={p.id}
							className="bg-white dark:bg-secondary-800 border border-secondary-200 dark:border-secondary-700 rounded-lg p-4 hover:border-primary-300 dark:hover:border-primary-600 transition-colors"
						>
							<div className="flex items-start justify-between">
								<div className="min-w-0 flex-1">
									<div className="flex items-center gap-2 mb-1">
										<Link
											to={`/patch-management/policies/${p.id}`}
											className="text-sm font-semibold text-secondary-900 dark:text-white hover:text-primary-600 dark:hover:text-primary-400"
										>
											{p.name}
										</Link>
										{policyTypeBadge(p.policy_type)}
										{!p.enabled && (
											<span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-secondary-100 text-secondary-600 dark:bg-secondary-700 dark:text-secondary-400">
												Disabled
											</span>
										)}
									</div>
									{p.description && (
										<p className="text-xs text-secondary-500 dark:text-secondary-400 mb-2 truncate">
											{p.description}
										</p>
									)}
									<div className="flex items-center gap-4 text-xs text-secondary-500 dark:text-secondary-400">
										<span className="flex items-center gap-1">
											<Server className="h-3 w-3" />
											{p.host_count} hosts
										</span>
										<span className="flex items-center gap-1">
											<Calendar className="h-3 w-3" />
											{p._count?.patch_windows || 0} windows
										</span>
										<span className="flex items-center gap-1">
											<Play className="h-3 w-3" />
											{p._count?.patch_jobs || 0} jobs
										</span>
										{p.patch_policy_groups?.length > 0 && (
											<span className="flex items-center gap-1">
												{p.patch_policy_groups.map((pg) => (
													<span
														key={pg.host_group_id}
														className="inline-flex items-center px-1.5 py-0.5 rounded text-xs"
														style={{
															backgroundColor: `${pg.host_groups?.color || "#3B82F6"}20`,
															color: pg.host_groups?.color || "#3B82F6",
														}}
													>
														{pg.host_groups?.name}
													</span>
												))}
											</span>
										)}
									</div>
								</div>
								<div className="flex items-center gap-1 ml-4">
									<button
										onClick={() => {
											if (
												window.confirm(`Trigger a patch job for "${p.name}"?`)
											) {
												triggerJob.mutate(p.id);
											}
										}}
										disabled={!p.enabled || triggerJob.isPending}
										className="p-1.5 rounded-md text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 disabled:opacity-30"
										title="Trigger job"
									>
										<Play className="h-4 w-4" />
									</button>
									<Link
										to={`/patch-management/policies/${p.id}`}
										className="p-1.5 rounded-md text-secondary-500 hover:bg-secondary-100 dark:hover:bg-secondary-700"
										title="Edit"
									>
										<Pencil className="h-4 w-4" />
									</Link>
									<button
										onClick={() => {
											if (
												window.confirm(
													`Delete policy "${p.name}"? This will also delete all associated windows and jobs.`,
												)
											) {
												deletePolicy.mutate(p.id);
											}
										}}
										className="p-1.5 rounded-md text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
										title="Delete"
									>
										<Trash2 className="h-4 w-4" />
									</button>
								</div>
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

// ============================================================================
// WINDOWS TAB
// ============================================================================
function WindowsTab({ windows, deleteWindow, navigate }) {
	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<h2 className="text-lg font-semibold text-secondary-900 dark:text-white">
					Maintenance Windows
				</h2>
				<Link
					to="/patch-management/windows/new"
					className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-primary-600 text-white hover:bg-primary-700 transition-colors"
				>
					<Plus className="h-4 w-4" /> New Window
				</Link>
			</div>

			{!windows || windows.length === 0 ? (
				<div className="text-center py-12 text-secondary-500 dark:text-secondary-400">
					<Calendar className="h-12 w-12 mx-auto mb-3 opacity-30" />
					<p className="font-medium">No maintenance windows</p>
					<p className="text-sm mt-1">
						Create a maintenance window to schedule automatic patching
					</p>
				</div>
			) : (
				<div className="grid gap-3">
					{windows.map((w) => (
						<div
							key={w.id}
							className="bg-white dark:bg-secondary-800 border border-secondary-200 dark:border-secondary-700 rounded-lg p-4"
						>
							<div className="flex items-start justify-between">
								<div>
									<div className="flex items-center gap-2 mb-1">
										<Link
											to={`/patch-management/windows/${w.id}`}
											className="text-sm font-semibold text-secondary-900 dark:text-white hover:text-primary-600 dark:hover:text-primary-400"
										>
											{w.name}
										</Link>
										{!w.enabled && (
											<span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-secondary-100 text-secondary-600 dark:bg-secondary-700 dark:text-secondary-400">
												Disabled
											</span>
										)}
										<span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
											{w.schedule_type}
										</span>
									</div>
									<div className="flex items-center gap-4 text-xs text-secondary-500 dark:text-secondary-400 mt-1">
										<span>Policy: {w.policy?.name}</span>
										{w.schedule_cron && <span>Cron: {w.schedule_cron}</span>}
										<span>Duration: {w.duration_minutes}m</span>
										<span>{w._count?.patch_jobs || 0} jobs</span>
									</div>
									{w.next_run_at && (
										<p className="text-xs text-primary-600 dark:text-primary-400 mt-1 flex items-center gap-1">
											<Clock className="h-3 w-3" />
											Next run: {formatDate(w.next_run_at)}
										</p>
									)}
								</div>
								<div className="flex items-center gap-1 ml-4">
									<Link
										to={`/patch-management/windows/${w.id}`}
										className="p-1.5 rounded-md text-secondary-500 hover:bg-secondary-100 dark:hover:bg-secondary-700"
									>
										<Pencil className="h-4 w-4" />
									</Link>
									<button
										onClick={() => {
											if (window.confirm(`Delete window "${w.name}"?`))
												deleteWindow.mutate(w.id);
										}}
										className="p-1.5 rounded-md text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
									>
										<Trash2 className="h-4 w-4" />
									</button>
								</div>
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

// ============================================================================
// JOBS TAB
// ============================================================================
function JobsTab({ jobs, total, filter, setFilter, cancelJob }) {
	const statusFilters = [
		"",
		"pending",
		"running",
		"completed",
		"completed_with_errors",
		"failed",
		"cancelled",
	];

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<h2 className="text-lg font-semibold text-secondary-900 dark:text-white">
					Patch Jobs{" "}
					{total > 0 && (
						<span className="text-sm font-normal text-secondary-500 dark:text-secondary-400">
							({total})
						</span>
					)}
				</h2>
				<div className="flex items-center gap-2">
					<Filter className="h-4 w-4 text-secondary-400" />
					<select
						value={filter}
						onChange={(e) => setFilter(e.target.value)}
						className="text-sm border border-secondary-300 dark:border-secondary-600 rounded-md bg-white dark:bg-secondary-800 text-secondary-900 dark:text-white px-2 py-1"
					>
						<option value="">All statuses</option>
						{statusFilters.filter(Boolean).map((s) => (
							<option key={s} value={s}>
								{s.replace(/_/g, " ")}
							</option>
						))}
					</select>
				</div>
			</div>

			{!jobs || jobs.length === 0 ? (
				<div className="text-center py-12 text-secondary-500 dark:text-secondary-400">
					<Play className="h-12 w-12 mx-auto mb-3 opacity-30" />
					<p className="font-medium">No jobs found</p>
				</div>
			) : (
				<div className="bg-white dark:bg-secondary-800 border border-secondary-200 dark:border-secondary-700 rounded-lg overflow-hidden">
					<table className="min-w-full divide-y divide-secondary-200 dark:divide-secondary-700">
						<thead className="bg-secondary-50 dark:bg-secondary-800/50">
							<tr>
								<th className="px-4 py-3 text-left text-xs font-medium text-secondary-500 dark:text-secondary-400 uppercase">
									Status
								</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-secondary-500 dark:text-secondary-400 uppercase">
									Policy
								</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-secondary-500 dark:text-secondary-400 uppercase">
									Triggered
								</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-secondary-500 dark:text-secondary-400 uppercase">
									Hosts
								</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-secondary-500 dark:text-secondary-400 uppercase">
									Created
								</th>
								<th className="px-4 py-3 text-right text-xs font-medium text-secondary-500 dark:text-secondary-400 uppercase">
									Actions
								</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-secondary-200 dark:divide-secondary-700">
							{jobs.map((job) => (
								<tr
									key={job.id}
									className="hover:bg-secondary-50 dark:hover:bg-secondary-700/30"
								>
									<td className="px-4 py-3">{statusBadge(job.status)}</td>
									<td className="px-4 py-3 text-sm text-secondary-900 dark:text-white">
										{job.policy?.name}
									</td>
									<td className="px-4 py-3 text-xs text-secondary-500 dark:text-secondary-400">
										{job.triggered_by}
									</td>
									<td className="px-4 py-3 text-sm text-secondary-700 dark:text-secondary-300">
										<span className="text-green-600">
											{job.completed_hosts}
										</span>
										{job.failed_hosts > 0 && (
											<span className="text-red-500">/{job.failed_hosts}F</span>
										)}
										<span className="text-secondary-400">
											/{job.total_hosts}
										</span>
									</td>
									<td className="px-4 py-3 text-xs text-secondary-500 dark:text-secondary-400">
										{timeAgo(job.created_at)}
									</td>
									<td className="px-4 py-3 text-right">
										<div className="flex items-center justify-end gap-1">
											<Link
												to={`/patch-management/jobs/${job.id}`}
												className="p-1 rounded text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/20"
											>
												<ChevronRight className="h-4 w-4" />
											</Link>
											{["pending", "running"].includes(job.status) && (
												<button
													onClick={() => {
														if (window.confirm("Cancel this job?"))
															cancelJob.mutate(job.id);
													}}
													className="p-1 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
												>
													<Pause className="h-4 w-4" />
												</button>
											)}
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}

// ============================================================================
// HISTORY TAB
// ============================================================================
function HistoryTab({ jobs, total }) {
	if (!jobs || jobs.length === 0) {
		return (
			<div className="text-center py-12 text-secondary-500 dark:text-secondary-400">
				<History className="h-12 w-12 mx-auto mb-3 opacity-30" />
				<p className="font-medium">No patch history yet</p>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<h2 className="text-lg font-semibold text-secondary-900 dark:text-white">
				Patch History{" "}
				{total > 0 && (
					<span className="text-sm font-normal text-secondary-500">
						({total})
					</span>
				)}
			</h2>

			<div className="space-y-3">
				{jobs.map((job) => {
					const totalPkgsUpdated = (job.patch_job_hosts || []).reduce(
						(s, h) => s + h.packages_updated,
						0,
					);
					const totalPkgsFailed = (job.patch_job_hosts || []).reduce(
						(s, h) => s + h.packages_failed,
						0,
					);

					return (
						<Link
							key={job.id}
							to={`/patch-management/jobs/${job.id}`}
							className="block bg-white dark:bg-secondary-800 border border-secondary-200 dark:border-secondary-700 rounded-lg p-4 hover:border-primary-300 dark:hover:border-primary-600 transition-colors"
						>
							<div className="flex items-center justify-between mb-2">
								<div className="flex items-center gap-2">
									{statusBadge(job.status)}
									<span className="text-sm font-medium text-secondary-900 dark:text-white">
										{job.policy?.name}
									</span>
								</div>
								<span className="text-xs text-secondary-500 dark:text-secondary-400">
									{formatDate(job.created_at)}
								</span>
							</div>
							<div className="flex items-center gap-4 text-xs text-secondary-500 dark:text-secondary-400">
								<span className="flex items-center gap-1">
									<Server className="h-3 w-3" />
									{job.completed_hosts}/{job.total_hosts} hosts
								</span>
								<span className="flex items-center gap-1">
									<Package className="h-3 w-3" />
									{totalPkgsUpdated} updated
								</span>
								{totalPkgsFailed > 0 && (
									<span className="flex items-center gap-1 text-red-500">
										<XCircle className="h-3 w-3" />
										{totalPkgsFailed} failed
									</span>
								)}
								{job.window && (
									<span className="flex items-center gap-1">
										<Calendar className="h-3 w-3" />
										{job.window.name}
									</span>
								)}
								<span>Triggered: {job.triggered_by}</span>
							</div>
						</Link>
					);
				})}
			</div>
		</div>
	);
}
