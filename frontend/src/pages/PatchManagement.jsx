import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	AlertTriangle,
	BarChart3,
	Calendar,
	CheckCircle,
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
	RefreshCw,
	Search,
	Server,
	Shield,
	Trash2,
	TrendingUp,
	XCircle,
	Zap,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
	Area,
	AreaChart,
	Bar,
	BarChart,
	CartesianGrid,
	Cell,
	Legend,
	Pie,
	PieChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
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
// OVERVIEW TAB — Analytics Dashboard
// ============================================================================

const CHART_COLORS = {
	completed: "#22c55e",
	failed: "#ef4444",
	partial: "#f59e0b",
	cancelled: "#94a3b8",
	pending: "#eab308",
	running: "#3b82f6",
	skipped: "#6b7280",
	updated: "#22c55e",
	manual: "#3b82f6",
	schedule: "#8b5cf6",
};

const PIE_COLORS = [
	"#22c55e",
	"#ef4444",
	"#f59e0b",
	"#3b82f6",
	"#8b5cf6",
	"#6b7280",
	"#ec4899",
];

function OverviewTab({ stats, statsLoading, policies, triggerJob }) {
	if (statsLoading) {
		return (
			<div className="flex items-center justify-center py-20">
				<Loader2 className="h-8 w-8 animate-spin text-primary-600" />
			</div>
		);
	}

	const j30 = stats?.jobs?.last_30_days || {};
	const completed30 = (j30.completed || 0) + (j30.completed_with_errors || 0);
	const failed30 = j30.failed || 0;
	const total30 = completed30 + failed30 + (j30.cancelled || 0);
	const successRate =
		total30 > 0 ? Math.round((completed30 / total30) * 100) : null;
	const pkgs = stats?.packages_30d || {};

	return (
		<div className="space-y-6">
			{/* ── KPI Cards Row ────────────────────────────────────────── */}
			<div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
				<KpiCard
					label="Active Policies"
					value={stats?.policies?.active ?? 0}
					sub={`of ${stats?.policies?.total ?? 0}`}
					icon={Shield}
					color="primary"
				/>
				<KpiCard
					label="Patch-Enabled Hosts"
					value={stats?.hosts?.patch_enabled ?? 0}
					sub={`of ${stats?.hosts?.total ?? 0}`}
					icon={Server}
					color="blue"
				/>
				<KpiCard
					label="Running Jobs"
					value={stats?.jobs?.running ?? 0}
					sub={
						stats?.jobs?.pending > 0
							? `${stats.jobs.pending} pending`
							: "none pending"
					}
					icon={Play}
					color="green"
				/>
				<KpiCard
					label="Success Rate (30d)"
					value={successRate !== null ? `${successRate}%` : "—"}
					sub={`${completed30} of ${total30} jobs`}
					icon={TrendingUp}
					color={
						successRate !== null && successRate >= 90
							? "green"
							: successRate !== null && successRate >= 70
								? "amber"
								: "red"
					}
				/>
				<KpiCard
					label="Packages Updated (30d)"
					value={pkgs.updated ?? 0}
					sub={pkgs.failed > 0 ? `${pkgs.failed} failed` : "0 failed"}
					icon={Package}
					color="purple"
				/>
				<KpiCard
					label="Needs Reboot"
					value={stats?.hosts?.needs_reboot ?? 0}
					sub="hosts"
					icon={RefreshCw}
					color={stats?.hosts?.needs_reboot > 0 ? "amber" : "green"}
				/>
			</div>

			{/* ── Job Trend + Packages Trend (side by side) ───────────── */}
			<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
				<ChartCard title="Job Trend (30 Days)" icon={BarChart3}>
					{stats?.job_trend?.length > 0 ? (
						<ResponsiveContainer width="100%" height={240}>
							<AreaChart
								data={stats.job_trend}
								margin={{ top: 5, right: 10, left: -10, bottom: 0 }}
							>
								<defs>
									<linearGradient
										id="gradCompleted"
										x1="0"
										y1="0"
										x2="0"
										y2="1"
									>
										<stop
											offset="0%"
											stopColor={CHART_COLORS.completed}
											stopOpacity={0.3}
										/>
										<stop
											offset="100%"
											stopColor={CHART_COLORS.completed}
											stopOpacity={0}
										/>
									</linearGradient>
									<linearGradient id="gradFailed" x1="0" y1="0" x2="0" y2="1">
										<stop
											offset="0%"
											stopColor={CHART_COLORS.failed}
											stopOpacity={0.3}
										/>
										<stop
											offset="100%"
											stopColor={CHART_COLORS.failed}
											stopOpacity={0}
										/>
									</linearGradient>
								</defs>
								<CartesianGrid
									strokeDasharray="3 3"
									stroke="#374151"
									opacity={0.15}
								/>
								<XAxis
									dataKey="date"
									tick={{ fontSize: 10 }}
									tickFormatter={(d) => d.slice(5)}
									stroke="#9ca3af"
									interval="preserveStartEnd"
								/>
								<YAxis
									tick={{ fontSize: 10 }}
									stroke="#9ca3af"
									allowDecimals={false}
								/>
								<Tooltip
									contentStyle={{
										backgroundColor: "#1f2937",
										border: "1px solid #374151",
										borderRadius: 8,
										fontSize: 12,
									}}
									labelStyle={{ color: "#9ca3af" }}
									labelFormatter={(d) => d}
								/>
								<Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
								<Area
									type="monotone"
									dataKey="completed"
									stroke={CHART_COLORS.completed}
									fill="url(#gradCompleted)"
									name="Completed"
								/>
								<Area
									type="monotone"
									dataKey="failed"
									stroke={CHART_COLORS.failed}
									fill="url(#gradFailed)"
									name="Failed"
								/>
								<Area
									type="monotone"
									dataKey="partial"
									stroke={CHART_COLORS.partial}
									fill={CHART_COLORS.partial}
									fillOpacity={0.1}
									name="Partial"
								/>
							</AreaChart>
						</ResponsiveContainer>
					) : (
						<EmptyChart message="No job data in the last 30 days" />
					)}
				</ChartCard>

				<ChartCard title="Packages Updated (30 Days)" icon={Package}>
					{stats?.package_trend?.length > 0 ? (
						<ResponsiveContainer width="100%" height={240}>
							<BarChart
								data={stats.package_trend}
								margin={{ top: 5, right: 10, left: -10, bottom: 0 }}
							>
								<CartesianGrid
									strokeDasharray="3 3"
									stroke="#374151"
									opacity={0.15}
								/>
								<XAxis
									dataKey="date"
									tick={{ fontSize: 10 }}
									tickFormatter={(d) => d.slice(5)}
									stroke="#9ca3af"
									interval="preserveStartEnd"
								/>
								<YAxis
									tick={{ fontSize: 10 }}
									stroke="#9ca3af"
									allowDecimals={false}
								/>
								<Tooltip
									contentStyle={{
										backgroundColor: "#1f2937",
										border: "1px solid #374151",
										borderRadius: 8,
										fontSize: 12,
									}}
									labelStyle={{ color: "#9ca3af" }}
								/>
								<Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
								<Bar
									dataKey="updated"
									fill={CHART_COLORS.completed}
									name="Updated"
									radius={[2, 2, 0, 0]}
								/>
								<Bar
									dataKey="failed"
									fill={CHART_COLORS.failed}
									name="Failed"
									radius={[2, 2, 0, 0]}
								/>
							</BarChart>
						</ResponsiveContainer>
					) : (
						<EmptyChart message="No package data in the last 30 days" />
					)}
				</ChartCard>
			</div>

			{/* ── Host Status + Policy Breakdown + Trigger Breakdown ──── */}
			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
				{/* Host Patch Status */}
				<ChartCard title="Host Patch Status" icon={Server}>
					{stats?.hosts?.patch_status &&
					Object.keys(stats.hosts.patch_status).length > 0 ? (
						<div className="flex items-center gap-4">
							<ResponsiveContainer width="55%" height={180}>
								<PieChart>
									<Pie
										data={Object.entries(stats.hosts.patch_status).map(
											([k, v]) => ({
												name: k.replace(/_/g, " "),
												value: v,
											}),
										)}
										cx="50%"
										cy="50%"
										outerRadius={70}
										innerRadius={40}
										paddingAngle={2}
										dataKey="value"
									>
										{Object.entries(stats.hosts.patch_status).map(
											(_entry, i) => (
												<Cell
													key={`cell-${i}`}
													fill={PIE_COLORS[i % PIE_COLORS.length]}
												/>
											),
										)}
									</Pie>
									<Tooltip
										contentStyle={{
											backgroundColor: "#1f2937",
											border: "1px solid #374151",
											borderRadius: 8,
											fontSize: 12,
										}}
									/>
								</PieChart>
							</ResponsiveContainer>
							<div className="flex-1 space-y-1.5">
								{Object.entries(stats.hosts.patch_status).map(
									([status, count], i) => (
										<div
											key={status}
											className="flex items-center justify-between text-xs"
										>
											<div className="flex items-center gap-1.5">
												<span
													className="w-2.5 h-2.5 rounded-full flex-shrink-0"
													style={{
														backgroundColor: PIE_COLORS[i % PIE_COLORS.length],
													}}
												/>
												<span className="text-secondary-600 dark:text-secondary-300 capitalize">
													{status.replace(/_/g, " ")}
												</span>
											</div>
											<span className="font-semibold text-secondary-900 dark:text-white">
												{count}
											</span>
										</div>
									),
								)}
							</div>
						</div>
					) : (
						<EmptyChart message="No host patch data" />
					)}
				</ChartCard>

				{/* Policy Success Rates */}
				<ChartCard title="Policy Success Rates (90d)" icon={Shield}>
					{stats?.policy_breakdown?.length > 0 ? (
						<ResponsiveContainer width="100%" height={180}>
							<BarChart
								data={stats.policy_breakdown.slice(0, 6)}
								layout="vertical"
								margin={{ top: 0, right: 10, left: 0, bottom: 0 }}
							>
								<CartesianGrid
									strokeDasharray="3 3"
									stroke="#374151"
									opacity={0.15}
									horizontal={false}
								/>
								<XAxis
									type="number"
									tick={{ fontSize: 10 }}
									stroke="#9ca3af"
									allowDecimals={false}
								/>
								<YAxis
									dataKey="name"
									type="category"
									tick={{ fontSize: 10 }}
									stroke="#9ca3af"
									width={90}
									tickFormatter={(n) =>
										n.length > 14 ? `${n.slice(0, 12)}…` : n
									}
								/>
								<Tooltip
									contentStyle={{
										backgroundColor: "#1f2937",
										border: "1px solid #374151",
										borderRadius: 8,
										fontSize: 12,
									}}
								/>
								<Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
								<Bar
									dataKey="completed"
									stackId="a"
									fill={CHART_COLORS.completed}
									name="Completed"
								/>
								<Bar
									dataKey="partial"
									stackId="a"
									fill={CHART_COLORS.partial}
									name="Partial"
								/>
								<Bar
									dataKey="failed"
									stackId="a"
									fill={CHART_COLORS.failed}
									name="Failed"
								/>
							</BarChart>
						</ResponsiveContainer>
					) : (
						<EmptyChart message="No policy data" />
					)}
				</ChartCard>

				{/* Trigger Breakdown + Avg Duration */}
				<ChartCard title="Job Insights (30d)" icon={Zap}>
					<div className="space-y-4">
						{/* Trigger breakdown */}
						<div>
							<p className="text-xs text-secondary-500 dark:text-secondary-400 mb-2">
								Trigger Source
							</p>
							{stats?.trigger_breakdown &&
							Object.keys(stats.trigger_breakdown).length > 0 ? (
								<div className="flex gap-2">
									{Object.entries(stats.trigger_breakdown).map(([key, val]) => {
										const total = Object.values(stats.trigger_breakdown).reduce(
											(s, v) => s + v,
											0,
										);
										const pct = total > 0 ? Math.round((val / total) * 100) : 0;
										return (
											<div
												key={key}
												className="flex-1 bg-secondary-50 dark:bg-secondary-700/40 rounded-lg p-2 text-center"
											>
												<p className="text-lg font-bold text-secondary-900 dark:text-white">
													{val}
												</p>
												<p className="text-xs text-secondary-500 dark:text-secondary-400 capitalize">
													{key} ({pct}%)
												</p>
											</div>
										);
									})}
								</div>
							) : (
								<p className="text-xs text-secondary-400">No data</p>
							)}
						</div>

						{/* Avg Duration */}
						<div>
							<p className="text-xs text-secondary-500 dark:text-secondary-400 mb-1">
								Avg Job Duration
							</p>
							<p className="text-2xl font-bold text-secondary-900 dark:text-white">
								{stats?.avg_duration_minutes != null
									? stats.avg_duration_minutes < 60
										? `${stats.avg_duration_minutes}m`
										: `${Math.floor(stats.avg_duration_minutes / 60)}h ${stats.avg_duration_minutes % 60}m`
									: "—"}
							</p>
						</div>

						{/* Reboot stats */}
						<div>
							<p className="text-xs text-secondary-500 dark:text-secondary-400 mb-1">
								Reboots (30d)
							</p>
							<div className="flex items-center gap-3">
								<div className="flex items-center gap-1 text-sm">
									<RefreshCw className="h-3.5 w-3.5 text-amber-500" />
									<span className="font-medium text-secondary-900 dark:text-white">
										{stats?.reboot?.required_30d ?? 0}
									</span>
									<span className="text-secondary-500 dark:text-secondary-400">
										required
									</span>
								</div>
								<div className="flex items-center gap-1 text-sm">
									<CheckCircle className="h-3.5 w-3.5 text-green-500" />
									<span className="font-medium text-secondary-900 dark:text-white">
										{stats?.reboot?.completed_30d ?? 0}
									</span>
									<span className="text-secondary-500 dark:text-secondary-400">
										completed
									</span>
								</div>
							</div>
						</div>
					</div>
				</ChartCard>
			</div>

			{/* ── Top Failing Hosts + Recent Jobs + Upcoming Windows ───── */}
			<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
				{/* Top Failing Hosts */}
				<ChartCard title="Top Failing Hosts (30d)" icon={AlertTriangle}>
					{stats?.top_failing_hosts?.length > 0 ? (
						<div className="space-y-2">
							{stats.top_failing_hosts.map((h, i) => (
								<div
									key={h.host_id}
									className="flex items-center justify-between"
								>
									<div className="flex items-center gap-2 min-w-0">
										<span className="text-xs font-mono text-secondary-400 w-4">
											{i + 1}.
										</span>
										<span className="text-sm text-secondary-700 dark:text-secondary-300 truncate">
											{h.name}
										</span>
									</div>
									<span className="flex items-center gap-1 text-xs font-medium text-red-500">
										<XCircle className="h-3 w-3" />
										{h.failures} failures
									</span>
								</div>
							))}
						</div>
					) : (
						<div className="flex flex-col items-center justify-center py-6 text-secondary-400">
							<CheckCircle className="h-8 w-8 mb-2 text-green-500 opacity-50" />
							<p className="text-sm">No failures in the last 30 days</p>
						</div>
					)}
				</ChartCard>

				{/* Recent Jobs */}
				<ChartCard title="Recent Jobs" icon={History}>
					{stats?.jobs?.recent?.length > 0 ? (
						<div className="space-y-1.5">
							{stats.jobs.recent.map((job) => (
								<Link
									key={job.id}
									to={`/patch-management/jobs/${job.id}`}
									className="flex items-center justify-between p-1.5 rounded-md hover:bg-secondary-50 dark:hover:bg-secondary-700/50 transition-colors"
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
						<EmptyChart message="No recent jobs" />
					)}
				</ChartCard>

				{/* Upcoming Windows */}
				<ChartCard title="Upcoming Windows" icon={Calendar}>
					{stats?.upcoming_windows?.length > 0 ? (
						<div className="space-y-2">
							{stats.upcoming_windows.map((w) => (
								<div
									key={w.id}
									className="flex items-center justify-between p-1.5 rounded-md hover:bg-secondary-50 dark:hover:bg-secondary-700/50"
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
						<EmptyChart message="No upcoming windows" />
					)}
				</ChartCard>
			</div>

			{/* ── Quick Actions ────────────────────────────────────────── */}
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

// ─── Shared Sub-components ──────────────────────────────────────────────────

function KpiCard({ label, value, sub, icon: Icon, color }) {
	const colorMap = {
		primary:
			"bg-primary-100 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400",
		blue: "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400",
		green:
			"bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400",
		amber:
			"bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400",
		red: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400",
		purple:
			"bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400",
	};

	return (
		<div className="bg-white dark:bg-secondary-800 border border-secondary-200 dark:border-secondary-700 rounded-lg p-3">
			<div className="flex items-center gap-2.5">
				<div
					className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${colorMap[color] || colorMap.primary}`}
				>
					<Icon className="h-4 w-4" />
				</div>
				<div className="min-w-0">
					<p className="text-[10px] uppercase tracking-wider text-secondary-500 dark:text-secondary-400 truncate">
						{label}
					</p>
					<p className="text-lg font-bold text-secondary-900 dark:text-white leading-tight">
						{value}
					</p>
					{sub && (
						<p className="text-[10px] text-secondary-400 dark:text-secondary-500 truncate">
							{sub}
						</p>
					)}
				</div>
			</div>
		</div>
	);
}

function ChartCard({ title, icon: Icon, children }) {
	return (
		<div className="bg-white dark:bg-secondary-800 border border-secondary-200 dark:border-secondary-700 rounded-lg p-4">
			<h3 className="text-sm font-semibold text-secondary-900 dark:text-white mb-3 flex items-center gap-2">
				<Icon className="h-4 w-4 text-secondary-400" /> {title}
			</h3>
			{children}
		</div>
	);
}

function EmptyChart({ message }) {
	return (
		<div className="flex items-center justify-center h-40 text-secondary-400 dark:text-secondary-500 text-sm">
			{message}
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
