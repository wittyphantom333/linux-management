import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	AlertTriangle,
	BarChart3,
	Briefcase,
	CalendarClock,
	CheckCircle2,
	ChevronRight,
	CircleDot,
	Clock,
	Eye,
	FileCode2,
	History,
	ListChecks,
	Loader2,
	Network,
	Pencil,
	Play,
	Plus,
	RefreshCw,
	Search,
	Settings2,
	ShieldAlert,
	ShieldCheck,
	Stethoscope,
	Timer,
	Trash2,
	TrendingUp,
	Wrench,
	XCircle,
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
	Pie,
	PieChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { useToast } from "../contexts/ToastContext";
import { configManagementAPI } from "../utils/configManagementApi";

// ─── Tab definitions ───────────────────────────────────────────────────────
const TABS = [
	{ id: "overview", label: "Overview", icon: BarChart3 },
	{ id: "techniques", label: "Techniques", icon: FileCode2 },
	{ id: "directives", label: "Directives", icon: ListChecks },
	{ id: "rules", label: "Rules", icon: Network },
	{ id: "jobs", label: "Jobs", icon: Briefcase },
	{ id: "runs", label: "Run History", icon: History },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

const CHART_COLORS = {
	compliant: "#22c55e",
	non_compliant: "#ef4444",
	errors: "#f97316",
	repaired: "#3b82f6",
	not_applicable: "#94a3b8",
	audited: "#8b5cf6",
	audit: "#f59e0b",
	enforce: "#3b82f6",
};

const PIE_COLORS = [
	"#22c55e",
	"#ef4444",
	"#f97316",
	"#3b82f6",
	"#94a3b8",
	"#8b5cf6",
	"#ec4899",
];

const SCORE_DIST_COLORS = {
	"90-100": "#22c55e",
	"70-89": "#eab308",
	"50-69": "#f97316",
	"0-49": "#ef4444",
};

function scoreColor(score) {
	if (score >= 90) return "text-green-500";
	if (score >= 70) return "text-yellow-500";
	if (score >= 50) return "text-orange-500";
	return "text-red-500";
}

function scoreBg(score) {
	if (score >= 90) return "bg-green-500";
	if (score >= 70) return "bg-yellow-500";
	if (score >= 50) return "bg-orange-500";
	return "bg-red-500";
}

function modeBadge(mode) {
	if (mode === "enforce") {
		return (
			<span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200">
				<Wrench className="h-3 w-3" />
				Enforce
			</span>
		);
	}
	return (
		<span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-200">
			<Eye className="h-3 w-3" />
			Audit
		</span>
	);
}

function schedBadge(schedule, interval, cron) {
	switch (schedule) {
		case "once":
			return (
				<span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-200">
					<CircleDot className="h-3 w-3" />
					Run Once
				</span>
			);
		case "interval":
			return (
				<span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900 text-violet-700 dark:text-violet-200">
					<Timer className="h-3 w-3" />
					Every {interval >= 60 ? `${interval / 60}h` : `${interval}m`}
				</span>
			);
		case "cron":
			return (
				<span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-200">
					<CalendarClock className="h-3 w-3" />
					{cron || "cron"}
				</span>
			);
		default:
			return (
				<span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-secondary-100 dark:bg-secondary-800 text-secondary-600 dark:text-secondary-300">
					<Clock className="h-3 w-3" />
					Every Check-in
				</span>
			);
	}
}

function timeAgo(dateStr) {
	if (!dateStr) return "—";
	const diff = Date.now() - new Date(dateStr).getTime();
	const mins = Math.floor(diff / 60000);
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins}m ago`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}

// ─── Component ──────────────────────────────────────────────────────────────
export default function ConfigManagement() {
	const [activeTab, setActiveTab] = useState("overview");
	const [techniqueSearch, setTechniqueSearch] = useState("");
	const [directiveSearch, setDirectiveSearch] = useState("");
	const [ruleSearch, setRuleSearch] = useState("");

	const queryClient = useQueryClient();
	const toast = useToast();

	// ─── Queries ──────────────────────────────────────────────────────
	const {
		data: dashboard,
		isLoading,
		error,
	} = useQuery({
		queryKey: ["configmgmt", "dashboard"],
		queryFn: () =>
			configManagementAPI.getDashboard().then((r) => r.data.dashboard),
		staleTime: 60_000,
		refetchInterval: 120_000,
	});

	const { data: techniques } = useQuery({
		queryKey: ["configmgmt", "techniques"],
		queryFn: () =>
			configManagementAPI.listTechniques().then((r) => r.data.techniques),
		staleTime: 60_000,
		enabled: activeTab === "techniques" || activeTab === "overview",
	});

	const { data: directives } = useQuery({
		queryKey: ["configmgmt", "directives"],
		queryFn: () =>
			configManagementAPI.listDirectives().then((r) => r.data.directives),
		staleTime: 60_000,
		enabled: activeTab === "directives" || activeTab === "overview",
	});

	const { data: rules } = useQuery({
		queryKey: ["configmgmt", "rules"],
		queryFn: () => configManagementAPI.listRules().then((r) => r.data.rules),
		staleTime: 60_000,
		enabled: activeTab === "rules" || activeTab === "overview",
	});

	const { data: runsData } = useQuery({
		queryKey: ["configmgmt", "runs"],
		queryFn: () =>
			configManagementAPI.listRuns({ limit: 50 }).then((r) => r.data),
		staleTime: 30_000,
		enabled: activeTab === "runs" || activeTab === "overview",
	});

	const { data: jobsData } = useQuery({
		queryKey: ["configmgmt", "jobs"],
		queryFn: () =>
			configManagementAPI.listJobs({ limit: 50 }).then((r) => r.data),
		staleTime: 10_000,
		refetchInterval: activeTab === "jobs" ? 5_000 : false,
		enabled: activeTab === "jobs" || activeTab === "overview",
	});

	// ─── Delete mutations ─────────────────────────────────────────────
	const deleteTechnique = useMutation({
		mutationFn: (id) => configManagementAPI.deleteTechnique(id),
		onSuccess: () => {
			queryClient.invalidateQueries(["configmgmt"]);
			toast.success("Technique deleted");
		},
		onError: (err) =>
			toast.error(`Delete failed: ${err.response?.data?.error || err.message}`),
	});

	const deleteDirective = useMutation({
		mutationFn: (id) => configManagementAPI.deleteDirective(id),
		onSuccess: () => {
			queryClient.invalidateQueries(["configmgmt"]);
			toast.success("Directive deleted");
		},
		onError: (err) =>
			toast.error(`Delete failed: ${err.response?.data?.error || err.message}`),
	});

	const deleteRule = useMutation({
		mutationFn: (id) => configManagementAPI.deleteRule(id),
		onSuccess: () => {
			queryClient.invalidateQueries(["configmgmt"]);
			toast.success("Rule deleted");
		},
		onError: (err) =>
			toast.error(`Delete failed: ${err.response?.data?.error || err.message}`),
	});

	const runRule = useMutation({
		mutationFn: (id) => configManagementAPI.runRule(id),
		onSuccess: (res) => {
			const { notified, total, job } = res.data;
			queryClient.invalidateQueries({ queryKey: ["configmgmt", "jobs"] });
			queryClient.invalidateQueries({ queryKey: ["configmgmt-active-count"] });
			toast.success(
				notified > 0
					? `Run triggered — ${notified} of ${total} agent(s) notified`
					: `No connected agents to notify (${total} host(s) in groups)`,
			);
			if (job?.id) {
				setActiveTab("jobs");
			}
		},
		onError: (err) =>
			toast.error(`Run failed: ${err.response?.data?.error || err.message}`),
	});

	// ─── Filtered lists ───────────────────────────────────────────────
	const filteredTechniques = useMemo(() => {
		if (!techniques) return [];
		if (!techniqueSearch) return techniques;
		const q = techniqueSearch.toLowerCase();
		return techniques.filter(
			(t) =>
				t.name.toLowerCase().includes(q) ||
				t.category?.toLowerCase().includes(q) ||
				t.description?.toLowerCase().includes(q),
		);
	}, [techniques, techniqueSearch]);

	const filteredDirectives = useMemo(() => {
		if (!directives) return [];
		if (!directiveSearch) return directives;
		const q = directiveSearch.toLowerCase();
		return directives.filter(
			(d) =>
				d.name.toLowerCase().includes(q) ||
				d.technique?.name?.toLowerCase().includes(q),
		);
	}, [directives, directiveSearch]);

	const filteredRules = useMemo(() => {
		if (!rules) return [];
		if (!ruleSearch) return rules;
		const q = ruleSearch.toLowerCase();
		return rules.filter(
			(r) =>
				r.name.toLowerCase().includes(q) ||
				r.description?.toLowerCase().includes(q),
		);
	}, [rules, ruleSearch]);

	// ─── Loading / error states ───────────────────────────────────────
	if (isLoading) {
		return (
			<div className="flex items-center justify-center h-64">
				<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500" />
			</div>
		);
	}

	if (error) {
		return (
			<div className="p-4 bg-red-900/50 border border-red-700 rounded-lg">
				<p className="text-red-200">
					Failed to load config management dashboard. Is the feature enabled?
				</p>
			</div>
		);
	}

	// ─── Render ───────────────────────────────────────────────────────
	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="mb-6">
				<div className="flex items-center gap-3">
					<Settings2 className="h-7 w-7 text-primary-500" />
					<div>
						<h1 className="text-2xl font-semibold text-secondary-900 dark:text-white">
							Config Management
						</h1>
						<p className="text-sm text-secondary-600 dark:text-secondary-400 mt-1">
							Define configuration policies and track compliance across your
							fleet
						</p>
					</div>
				</div>
			</div>

			{/* Tab navigation */}
			<div className="border-b border-secondary-200 dark:border-secondary-600">
				<nav className="-mb-px flex space-x-8 px-4" aria-label="Tabs">
					{TABS.map((tab) => {
						const Icon = tab.icon;
						const active = activeTab === tab.id;
						return (
							<button
								key={tab.id}
								type="button"
								onClick={() => setActiveTab(tab.id)}
								className={`flex items-center gap-2 py-3 px-1 border-b-2 text-sm font-medium transition-colors ${
									active
										? "border-primary-500 text-primary-600 dark:text-primary-400"
										: "border-transparent text-secondary-500 dark:text-secondary-400 hover:text-secondary-700 dark:hover:text-secondary-300 hover:border-secondary-300"
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
				<OverviewTab dashboard={dashboard} dashboardLoading={isLoading} />
			)}
			{activeTab === "techniques" && (
				<TechniquesTab
					techniques={filteredTechniques}
					search={techniqueSearch}
					setSearch={setTechniqueSearch}
					onDelete={(id) => {
						if (
							window.confirm(
								"Delete this technique? Related directives may break.",
							)
						) {
							deleteTechnique.mutate(id);
						}
					}}
				/>
			)}
			{activeTab === "directives" && (
				<DirectivesTab
					directives={filteredDirectives}
					search={directiveSearch}
					setSearch={setDirectiveSearch}
					onDelete={(id) => {
						if (window.confirm("Delete this directive?")) {
							deleteDirective.mutate(id);
						}
					}}
				/>
			)}
			{activeTab === "rules" && (
				<RulesTab
					rules={filteredRules}
					search={ruleSearch}
					setSearch={setRuleSearch}
					onRun={(id, name) => {
						if (window.confirm(`Trigger an immediate run of "${name}"?`)) {
							runRule.mutate(id);
						}
					}}
					onDelete={(id) => {
						if (window.confirm("Delete this rule?")) {
							deleteRule.mutate(id);
						}
					}}
				/>
			)}
			{activeTab === "jobs" && (
				<JobsTab jobs={jobsData?.jobs} total={jobsData?.total} />
			)}
			{activeTab === "runs" && (
				<RunsTab runs={runsData?.runs} total={runsData?.total} />
			)}
		</div>
	);
}

// ─── Overview tab (analytics) ───────────────────────────────────────────────
function OverviewTab({ dashboard, dashboardLoading }) {
	if (dashboardLoading) {
		return (
			<div className="flex items-center justify-center py-20">
				<Loader2 className="h-8 w-8 animate-spin text-primary-600" />
			</div>
		);
	}

	const d = dashboard || {};
	const scoreTrend = d.score_trend || [];
	const compliance = d.compliance || {};
	const modeDist = d.mode_distribution || {};
	const catBreak = d.category_breakdown || [];
	const schedBreak = d.schedule_breakdown || {};
	const scoreDist = d.score_distribution || {};
	const topNonCompliant = d.top_non_compliant || [];
	const recentRuns = d.recent_runs || [];

	const complianceData = [
		{ name: "Compliant", value: compliance.compliant || 0 },
		{ name: "Non-Compliant", value: compliance.non_compliant || 0 },
		{ name: "Errors", value: compliance.errors || 0 },
		{ name: "Repaired", value: compliance.repaired || 0 },
		{ name: "N/A", value: compliance.not_applicable || 0 },
		{ name: "Audited", value: compliance.audited || 0 },
	].filter((c) => c.value > 0);

	const modeData = [
		{ name: "Audit", value: modeDist.audit || 0 },
		{ name: "Enforce", value: modeDist.enforce || 0 },
	].filter((c) => c.value > 0);

	const scoreDistData = Object.entries(scoreDist)
		.map(([range, count]) => ({ range, count }))
		.filter((c) => c.count > 0);

	const compTotal = complianceData.reduce((s, c) => s + c.value, 0) || 1;

	return (
		<div className="space-y-6">
			{/* ── Pipeline Diagnostics ─────────────────────────────────── */}
			<DiagnosticsPanel />

			{/* ── KPI Cards Row ────────────────────────────────────────── */}
			<div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
				<KpiCard
					label="Techniques"
					value={d.techniques ?? 0}
					icon={FileCode2}
					color="blue"
				/>
				<KpiCard
					label="Directives"
					value={d.directives ?? 0}
					icon={ListChecks}
					color="purple"
				/>
				<KpiCard
					label="Rules"
					value={d.rules ?? 0}
					icon={Network}
					color="primary"
				/>
				<KpiCard
					label="Managed Hosts"
					value={d.enabled_hosts ?? 0}
					icon={Settings2}
					color="green"
				/>
				<KpiCard
					label="Runs (24h)"
					value={d.runs_24h ?? 0}
					sub={d.total_runs_30d ? `${d.total_runs_30d} in 30d` : undefined}
					icon={History}
					color="blue"
				/>
				<KpiCard
					label="Avg Score (24h)"
					value={d.avg_score_24h != null ? `${d.avg_score_24h}%` : "—"}
					icon={d.avg_score_24h >= 90 ? ShieldCheck : ShieldAlert}
					color={
						d.avg_score_24h != null
							? d.avg_score_24h >= 90
								? "green"
								: d.avg_score_24h >= 70
									? "amber"
									: "red"
							: "primary"
					}
				/>
			</div>

			{/* ── Score Trend + Run Volume ─────────────────────────────── */}
			<div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
				<ChartCard title="Compliance Score Trend (30 Days)" icon={TrendingUp}>
					{scoreTrend.some((s) => s.avg_score !== null) ? (
						<ResponsiveContainer width="100%" height={220}>
							<AreaChart data={scoreTrend}>
								<defs>
									<linearGradient id="cmScoreGrad" x1="0" y1="0" x2="0" y2="1">
										<stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
										<stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
									</linearGradient>
								</defs>
								<CartesianGrid
									strokeDasharray="3 3"
									stroke="#374151"
									opacity={0.3}
								/>
								<XAxis
									dataKey="date"
									tickFormatter={(v) => v.slice(5)}
									tick={{ fontSize: 10, fill: "#9ca3af" }}
								/>
								<YAxis
									domain={[0, 100]}
									tick={{ fontSize: 10, fill: "#9ca3af" }}
									tickFormatter={(v) => `${v}%`}
								/>
								<Tooltip
									contentStyle={{
										backgroundColor: "#1f2937",
										border: "none",
										borderRadius: 8,
										fontSize: 12,
									}}
									formatter={(v) => [v != null ? `${v}%` : "—", "Avg Score"]}
									labelFormatter={(l) => l}
								/>
								<Area
									type="monotone"
									dataKey="avg_score"
									stroke="#22c55e"
									fill="url(#cmScoreGrad)"
									strokeWidth={2}
									connectNulls
									dot={false}
								/>
							</AreaChart>
						</ResponsiveContainer>
					) : (
						<EmptyChart message="No score data in the last 30 days" />
					)}
				</ChartCard>

				<ChartCard title="Run Volume (30 Days)" icon={BarChart3}>
					{scoreTrend.some((s) => s.runs > 0) ? (
						<ResponsiveContainer width="100%" height={220}>
							<BarChart data={scoreTrend}>
								<CartesianGrid
									strokeDasharray="3 3"
									stroke="#374151"
									opacity={0.3}
								/>
								<XAxis
									dataKey="date"
									tickFormatter={(v) => v.slice(5)}
									tick={{ fontSize: 10, fill: "#9ca3af" }}
								/>
								<YAxis
									allowDecimals={false}
									tick={{ fontSize: 10, fill: "#9ca3af" }}
								/>
								<Tooltip
									contentStyle={{
										backgroundColor: "#1f2937",
										border: "none",
										borderRadius: 8,
										fontSize: 12,
									}}
								/>
								<Bar
									dataKey="runs"
									name="Runs"
									fill="#3b82f6"
									radius={[3, 3, 0, 0]}
								/>
							</BarChart>
						</ResponsiveContainer>
					) : (
						<EmptyChart message="No runs in the last 30 days" />
					)}
				</ChartCard>
			</div>

			{/* ── Compliance Donut + Mode + Score Distribution ─────────── */}
			<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
				<ChartCard title="Compliance Breakdown (30d)" icon={CheckCircle2}>
					{complianceData.length > 0 ? (
						<div className="flex flex-col items-center">
							<ResponsiveContainer width="100%" height={180}>
								<PieChart>
									<Pie
										data={complianceData}
										cx="50%"
										cy="50%"
										innerRadius={50}
										outerRadius={75}
										paddingAngle={2}
										dataKey="value"
									>
										{complianceData.map((entry, i) => (
											<Cell
												key={entry.name}
												fill={PIE_COLORS[i % PIE_COLORS.length]}
											/>
										))}
									</Pie>
									<Tooltip
										contentStyle={{
											backgroundColor: "#1f2937",
											border: "none",
											borderRadius: 8,
											fontSize: 12,
										}}
									/>
								</PieChart>
							</ResponsiveContainer>
							<div className="flex flex-wrap justify-center gap-x-3 gap-y-1 mt-1">
								{complianceData.map((c, i) => (
									<span
										key={c.name}
										className="flex items-center gap-1 text-[10px] text-secondary-500 dark:text-secondary-400"
									>
										<span
											className="w-2 h-2 rounded-full inline-block"
											style={{
												backgroundColor: PIE_COLORS[i % PIE_COLORS.length],
											}}
										/>
										{c.name} ({Math.round((c.value / compTotal) * 100)}%)
									</span>
								))}
							</div>
						</div>
					) : (
						<EmptyChart message="No compliance data" />
					)}
				</ChartCard>

				<ChartCard title="Directive Mode Split" icon={Wrench}>
					{modeData.length > 0 ? (
						<div className="flex flex-col items-center">
							<ResponsiveContainer width="100%" height={180}>
								<PieChart>
									<Pie
										data={modeData}
										cx="50%"
										cy="50%"
										innerRadius={50}
										outerRadius={75}
										paddingAngle={2}
										dataKey="value"
									>
										<Cell fill={CHART_COLORS.audit} />
										<Cell fill={CHART_COLORS.enforce} />
									</Pie>
									<Tooltip
										contentStyle={{
											backgroundColor: "#1f2937",
											border: "none",
											borderRadius: 8,
											fontSize: 12,
										}}
									/>
								</PieChart>
							</ResponsiveContainer>
							<div className="flex justify-center gap-4 mt-1">
								{modeData.map((m) => (
									<span
										key={m.name}
										className="flex items-center gap-1 text-[10px] text-secondary-500 dark:text-secondary-400"
									>
										<span
											className="w-2 h-2 rounded-full inline-block"
											style={{
												backgroundColor:
													m.name === "Audit"
														? CHART_COLORS.audit
														: CHART_COLORS.enforce,
											}}
										/>
										{m.name} ({m.value})
									</span>
								))}
							</div>
						</div>
					) : (
						<EmptyChart message="No directives" />
					)}
				</ChartCard>

				<ChartCard title="Host Score Distribution" icon={ShieldCheck}>
					{scoreDistData.length > 0 ? (
						<div className="flex flex-col items-center">
							<ResponsiveContainer width="100%" height={180}>
								<BarChart data={scoreDistData} layout="vertical">
									<CartesianGrid
										strokeDasharray="3 3"
										stroke="#374151"
										opacity={0.3}
									/>
									<XAxis
										type="number"
										allowDecimals={false}
										tick={{ fontSize: 10, fill: "#9ca3af" }}
									/>
									<YAxis
										type="category"
										dataKey="range"
										tick={{ fontSize: 10, fill: "#9ca3af" }}
										width={55}
									/>
									<Tooltip
										contentStyle={{
											backgroundColor: "#1f2937",
											border: "none",
											borderRadius: 8,
											fontSize: 12,
										}}
									/>
									<Bar dataKey="count" name="Hosts" radius={[0, 3, 3, 0]}>
										{scoreDistData.map((entry) => (
											<Cell
												key={entry.range}
												fill={SCORE_DIST_COLORS[entry.range] || "#6b7280"}
											/>
										))}
									</Bar>
								</BarChart>
							</ResponsiveContainer>
						</div>
					) : (
						<EmptyChart message="No host score data" />
					)}
				</ChartCard>
			</div>

			{/* ── Category Breakdown + Schedule Breakdown ──────────────── */}
			{(catBreak.length > 0 || Object.keys(schedBreak).length > 0) && (
				<div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
					{catBreak.length > 0 && (
						<ChartCard title="Technique Categories" icon={FileCode2}>
							<ResponsiveContainer
								width="100%"
								height={Math.max(120, catBreak.length * 32)}
							>
								<BarChart data={catBreak} layout="vertical">
									<CartesianGrid
										strokeDasharray="3 3"
										stroke="#374151"
										opacity={0.3}
									/>
									<XAxis
										type="number"
										allowDecimals={false}
										tick={{ fontSize: 10, fill: "#9ca3af" }}
									/>
									<YAxis
										type="category"
										dataKey="category"
										tick={{ fontSize: 10, fill: "#9ca3af" }}
										width={90}
									/>
									<Tooltip
										contentStyle={{
											backgroundColor: "#1f2937",
											border: "none",
											borderRadius: 8,
											fontSize: 12,
										}}
									/>
									<Bar
										dataKey="count"
										name="Techniques"
										fill="#8b5cf6"
										radius={[0, 3, 3, 0]}
									/>
								</BarChart>
							</ResponsiveContainer>
						</ChartCard>
					)}

					<ChartCard title="Rule Schedule Types" icon={CalendarClock}>
						<div className="space-y-3 py-2">
							{(d.schedule_breakdown || []).map((s) => (
								<div
									key={s.schedule}
									className="flex items-center justify-between"
								>
									<div className="flex items-center gap-2">
										{schedBadge(s.schedule)}
									</div>
									<span className="text-sm font-semibold text-secondary-900 dark:text-white">
										{s.count}
									</span>
								</div>
							))}
							{(!d.schedule_breakdown || d.schedule_breakdown.length === 0) && (
								<p className="text-sm text-secondary-400">No rules defined</p>
							)}
						</div>
					</ChartCard>
				</div>
			)}

			{/* ── Top Non-Compliant + Recent Runs + Quick Links ────────── */}
			<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
				{/* Top non-compliant hosts */}
				<ChartCard title="Lowest Scoring Hosts (30d)" icon={ShieldAlert}>
					{topNonCompliant.length > 0 ? (
						<div className="space-y-2">
							{topNonCompliant.slice(0, 8).map((h, i) => (
								<div
									key={h.host_id}
									className="flex items-center justify-between p-2 rounded-lg hover:bg-secondary-50 dark:hover:bg-secondary-800/50"
								>
									<div className="flex items-center gap-2 min-w-0">
										<span className="text-xs font-mono text-secondary-400 w-4 text-right">
											{i + 1}.
										</span>
										<span className="text-sm font-medium text-secondary-900 dark:text-white truncate">
											{h.host_name}
										</span>
									</div>
									<div className="flex items-center gap-2 flex-shrink-0">
										<span className="text-xs text-secondary-400">
											{h.run_count} runs
										</span>
										<span
											className={`text-sm font-bold ${scoreColor(h.avg_score)}`}
										>
											{h.avg_score}%
										</span>
									</div>
								</div>
							))}
						</div>
					) : (
						<EmptyChart message="No host data in the last 30 days" />
					)}
				</ChartCard>

				{/* Recent runs */}
				<ChartCard title="Recent Policy Runs" icon={History}>
					{recentRuns.length > 0 ? (
						<div className="space-y-2">
							{recentRuns.slice(0, 8).map((run) => (
								<Link
									key={run.id}
									to={`/config-management/runs/${run.id}`}
									className="flex items-center justify-between p-2 rounded-lg hover:bg-secondary-50 dark:hover:bg-secondary-800 transition-colors"
								>
									<div className="flex items-center gap-2 min-w-0">
										<div
											className={`h-2 w-2 rounded-full flex-shrink-0 ${scoreBg(run.score)}`}
										/>
										<div className="min-w-0">
											<p className="text-sm font-medium text-secondary-900 dark:text-white truncate">
												{run.hosts?.friendly_name ||
													run.hosts?.hostname ||
													"Unknown"}
											</p>
											<p className="text-[10px] text-secondary-500">
												{run.total_directives} dir · {timeAgo(run.evaluated_at)}
											</p>
										</div>
									</div>
									<span
										className={`text-sm font-bold flex-shrink-0 ${scoreColor(run.score)}`}
									>
										{Math.round(run.score)}%
									</span>
								</Link>
							))}
						</div>
					) : (
						<EmptyChart message="No runs yet" />
					)}
				</ChartCard>

				{/* Active rules */}
				<ChartCard title="Active Rules" icon={Network}>
					{rules && rules.filter((r) => r.enabled).length > 0 ? (
						<div className="space-y-2">
							{rules
								.filter((r) => r.enabled)
								.slice(0, 8)
								.map((r) => (
									<Link
										key={r.id}
										to={`/config-management/rules/${r.id}`}
										className="flex items-center justify-between p-2 rounded-lg hover:bg-secondary-50 dark:hover:bg-secondary-800 transition-colors"
									>
										<p className="text-sm font-medium text-secondary-900 dark:text-white truncate">
											{r.name}
										</p>
										<span className="text-xs text-secondary-400 flex-shrink-0">
											{r.cm_rule_directives?.length || 0} dir
											{" · "}
											{r.cm_rule_groups?.length || 0} groups
										</span>
									</Link>
								))}
						</div>
					) : (
						<EmptyChart message="No active rules" />
					)}
				</ChartCard>
			</div>
		</div>
	);
}

// ─── Shared chart sub-components ────────────────────────────────────────────

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

// ─── Pipeline Diagnostics panel ─────────────────────────────────────────────
function DiagnosticsPanel() {
	const showDiagnostics =
		localStorage.getItem("patchmon_show_diagnostics") !== "false";

	if (!showDiagnostics) return null;

	return <DiagnosticsPanelInner />;
}

function DiagnosticsPanelInner() {
	const toast = useToast();
	const queryClient = useQueryClient();
	const [testRunningHost, setTestRunningHost] = useState(null);

	const {
		data: diagnostic,
		isLoading: diagLoading,
		refetch: refetchDiag,
		isFetching: diagFetching,
	} = useQuery({
		queryKey: ["configmgmt", "diagnose"],
		queryFn: () => configManagementAPI.diagnose().then((r) => r.data),
		staleTime: 30_000,
	});

	const testRunMutation = useMutation({
		mutationFn: (hostId) => configManagementAPI.testRun(hostId),
		onSuccess: (res) => {
			const data = res.data;
			toast.success(
				`Test run created: ${data.policy_summary?.directives || 0} directives evaluated`,
			);
			queryClient.invalidateQueries(["configmgmt", "runs"]);
			queryClient.invalidateQueries(["configmgmt", "dashboard"]);
			queryClient.invalidateQueries(["configmgmt", "diagnose"]);
			setTestRunningHost(null);
		},
		onError: (err) => {
			toast.error(
				`Test run failed: ${err.response?.data?.error || err.response?.data?.message || err.message}`,
			);
			setTestRunningHost(null);
		},
	});

	if (diagLoading) {
		return (
			<div className="card p-5">
				<div className="flex items-center gap-2 text-secondary-500">
					<Loader2 className="h-4 w-4 animate-spin" />
					Running diagnostics…
				</div>
			</div>
		);
	}

	if (!diagnostic) return null;

	const { pipeline_ok, issues, details } = diagnostic;
	const errors = issues?.filter((i) => i.severity === "error") || [];
	const warnings = issues?.filter((i) => i.severity === "warning") || [];

	return (
		<div className="card p-5">
			<div className="flex items-center justify-between mb-4">
				<div className="flex items-center gap-2">
					<Stethoscope className="h-5 w-5 text-primary-500" />
					<h2 className="text-lg font-medium text-secondary-900 dark:text-white">
						Pipeline Diagnostics
					</h2>
					{pipeline_ok ? (
						<span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
							<CheckCircle2 className="h-3 w-3" />
							Ready
						</span>
					) : (
						<span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
							<XCircle className="h-3 w-3" />
							Issues Found
						</span>
					)}
				</div>
				<button
					type="button"
					onClick={() => refetchDiag()}
					disabled={diagFetching}
					className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-secondary-100 dark:bg-secondary-700 text-secondary-700 dark:text-secondary-300 hover:bg-secondary-200 dark:hover:bg-secondary-600 transition-colors"
				>
					<RefreshCw
						className={`h-3.5 w-3.5 ${diagFetching ? "animate-spin" : ""}`}
					/>
					Re-check
				</button>
			</div>

			{/* Pipeline chain visualization */}
			<div className="flex items-center gap-2 mb-4 text-xs overflow-x-auto">
				{[
					{ label: "Techniques", count: details?.techniques?.total ?? 0 },
					{ label: "Directives", count: details?.directives?.total ?? 0 },
					{ label: "Rules", count: details?.rules?.total ?? 0 },
					{ label: "Enabled Hosts", count: details?.enabled_hosts?.total ?? 0 },
					{
						label: "With Policy",
						count:
							details?.host_policies?.filter((h) => h.has_policy).length ?? 0,
					},
				].map((step, i, arr) => (
					<div key={step.label} className="flex items-center gap-2">
						<div
							className={`flex flex-col items-center px-3 py-2 rounded-lg border ${
								step.count > 0
									? "border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/30"
									: "border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/30"
							}`}
						>
							<span
								className={`font-bold text-base ${step.count > 0 ? "text-green-700 dark:text-green-300" : "text-red-700 dark:text-red-300"}`}
							>
								{step.count}
							</span>
							<span className="text-secondary-600 dark:text-secondary-400 whitespace-nowrap">
								{step.label}
							</span>
						</div>
						{i < arr.length - 1 && (
							<ChevronRight className="h-4 w-4 text-secondary-400 flex-shrink-0" />
						)}
					</div>
				))}
			</div>

			{/* Issues list */}
			{errors.length > 0 && (
				<div className="space-y-2 mb-3">
					{errors.map((issue) => (
						<div
							key={issue.message}
							className="flex items-start gap-2 p-2 rounded-lg bg-red-50 dark:bg-red-900/20 text-sm"
						>
							<XCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
							<span className="text-red-700 dark:text-red-300">
								{issue.message}
							</span>
						</div>
					))}
				</div>
			)}
			{warnings.length > 0 && (
				<div className="space-y-2 mb-3">
					{warnings.map((issue) => (
						<div
							key={issue.message}
							className="flex items-start gap-2 p-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-sm"
						>
							<AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
							<span className="text-amber-700 dark:text-amber-300">
								{issue.message}
							</span>
						</div>
					))}
				</div>
			)}

			{/* Host policy table with test run buttons */}
			{details?.host_policies && details.host_policies.length > 0 && (
				<div className="mt-4">
					<h3 className="text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-2">
						Enabled Hosts
					</h3>
					<div className="border border-secondary-200 dark:border-secondary-700 rounded-lg overflow-hidden">
						<table className="min-w-full divide-y divide-secondary-200 dark:divide-secondary-700 text-sm">
							<thead className="bg-secondary-50 dark:bg-secondary-800">
								<tr>
									<th className="px-3 py-2 text-left text-xs font-medium text-secondary-500 uppercase">
										Host
									</th>
									<th className="px-3 py-2 text-left text-xs font-medium text-secondary-500 uppercase">
										Policy
									</th>
									<th className="px-3 py-2 text-left text-xs font-medium text-secondary-500 uppercase">
										Directives
									</th>
									<th className="px-3 py-2 text-right text-xs font-medium text-secondary-500 uppercase">
										Actions
									</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-secondary-200 dark:divide-secondary-700">
								{details.host_policies.map((hp) => (
									<tr
										key={hp.host_id}
										className="hover:bg-secondary-50 dark:hover:bg-secondary-800/50"
									>
										<td className="px-3 py-2 text-secondary-900 dark:text-white font-medium">
											{hp.host_name}
										</td>
										<td className="px-3 py-2">
											{hp.has_policy ? (
												<span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400">
													<CheckCircle2 className="h-3.5 w-3.5" />
													Available
												</span>
											) : (
												<span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400">
													<XCircle className="h-3.5 w-3.5" />
													None
												</span>
											)}
										</td>
										<td className="px-3 py-2 text-secondary-600 dark:text-secondary-400">
											{hp.directive_count}
										</td>
										<td className="px-3 py-2 text-right">
											{hp.has_policy && (
												<button
													type="button"
													onClick={() => {
														setTestRunningHost(hp.host_id);
														testRunMutation.mutate(hp.host_id);
													}}
													disabled={testRunMutation.isPending}
													className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300 hover:bg-primary-200 dark:hover:bg-primary-900/60 transition-colors disabled:opacity-50"
												>
													{testRunMutation.isPending &&
													testRunningHost === hp.host_id ? (
														<Loader2 className="h-3 w-3 animate-spin" />
													) : (
														<Play className="h-3 w-3" />
													)}
													Test Run
												</button>
											)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			)}

			{issues?.length === 0 && (
				<p className="text-sm text-green-600 dark:text-green-400 mt-2">
					Pipeline is fully configured. Agents will evaluate policies on their
					next report cycle (typically every 60 minutes).
				</p>
			)}
		</div>
	);
}

// ─── Techniques tab ─────────────────────────────────────────────────────────
function TechniquesTab({ techniques, search, setSearch, onDelete }) {
	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between gap-4">
				<SearchInput
					value={search}
					onChange={setSearch}
					placeholder="Search techniques…"
				/>
				<Link
					to="/config-management/techniques/new"
					className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 transition-colors shrink-0"
				>
					<Plus className="h-4 w-4" />
					New Technique
				</Link>
			</div>

			{techniques.length === 0 ? (
				<EmptyState message="No techniques found" />
			) : (
				<div className="card overflow-hidden">
					<table className="min-w-full divide-y divide-secondary-200 dark:divide-secondary-700">
						<thead className="bg-secondary-50 dark:bg-secondary-800">
							<tr>
								<th className="px-4 py-3 text-left text-xs font-medium text-secondary-500 dark:text-secondary-400 uppercase tracking-wider">
									Name
								</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-secondary-500 dark:text-secondary-400 uppercase tracking-wider">
									Category
								</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-secondary-500 dark:text-secondary-400 uppercase tracking-wider">
									Version
								</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-secondary-500 dark:text-secondary-400 uppercase tracking-wider">
									Methods
								</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-secondary-500 dark:text-secondary-400 uppercase tracking-wider">
									Directives
								</th>
								<th className="px-4 py-3 text-right text-xs font-medium text-secondary-500 dark:text-secondary-400 uppercase tracking-wider">
									Actions
								</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-secondary-200 dark:divide-secondary-700">
							{techniques.map((t) => (
								<tr
									key={t.id}
									className="hover:bg-secondary-50 dark:hover:bg-secondary-800/50 transition-colors"
								>
									<td className="px-4 py-3">
										<Link
											to={`/config-management/techniques/${t.id}`}
											className="text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline"
										>
											{t.name}
										</Link>
										{t.description && (
											<p className="text-xs text-secondary-500 mt-0.5 truncate max-w-xs">
												{t.description}
											</p>
										)}
									</td>
									<td className="px-4 py-3 text-sm text-secondary-600 dark:text-secondary-300">
										{t.category || "—"}
									</td>
									<td className="px-4 py-3 text-sm text-secondary-600 dark:text-secondary-300">
										<span>{t.version}</span>
										{t.version_count > 1 && (
											<span className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full bg-secondary-100 dark:bg-secondary-800 text-secondary-500">
												+{t.version_count - 1} older
											</span>
										)}
									</td>
									<td className="px-4 py-3 text-sm text-secondary-600 dark:text-secondary-300">
										{Array.isArray(t.methods) ? t.methods.length : "—"}
									</td>
									<td className="px-4 py-3 text-sm text-secondary-600 dark:text-secondary-300">
										{t.total_directives ?? t._count?.cm_directives ?? 0}
									</td>
									<td className="px-4 py-3 text-right">
										<div className="flex items-center justify-end gap-2">
											<Link
												to={`/config-management/techniques/${t.id}`}
												className="p-1 rounded hover:bg-secondary-200 dark:hover:bg-secondary-700"
												title="Edit"
											>
												<Pencil className="h-4 w-4 text-secondary-500" />
											</Link>
											<button
												type="button"
												onClick={() => onDelete(t.id)}
												className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30"
												title="Delete"
											>
												<Trash2 className="h-4 w-4 text-red-500" />
											</button>
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

// ─── Directives tab ─────────────────────────────────────────────────────────
function DirectivesTab({ directives, search, setSearch, onDelete }) {
	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between gap-4">
				<SearchInput
					value={search}
					onChange={setSearch}
					placeholder="Search directives…"
				/>
				<Link
					to="/config-management/directives/new"
					className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 transition-colors shrink-0"
				>
					<Plus className="h-4 w-4" />
					New Directive
				</Link>
			</div>

			{directives.length === 0 ? (
				<EmptyState message="No directives found" />
			) : (
				<div className="card overflow-hidden">
					<table className="min-w-full divide-y divide-secondary-200 dark:divide-secondary-700">
						<thead className="bg-secondary-50 dark:bg-secondary-800">
							<tr>
								<th className="px-4 py-3 text-left text-xs font-medium text-secondary-500 dark:text-secondary-400 uppercase tracking-wider">
									Name
								</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-secondary-500 dark:text-secondary-400 uppercase tracking-wider">
									Technique
								</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-secondary-500 dark:text-secondary-400 uppercase tracking-wider">
									Mode
								</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-secondary-500 dark:text-secondary-400 uppercase tracking-wider">
									Priority
								</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-secondary-500 dark:text-secondary-400 uppercase tracking-wider">
									Status
								</th>
								<th className="px-4 py-3 text-right text-xs font-medium text-secondary-500 dark:text-secondary-400 uppercase tracking-wider">
									Actions
								</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-secondary-200 dark:divide-secondary-700">
							{directives.map((d) => (
								<tr
									key={d.id}
									className="hover:bg-secondary-50 dark:hover:bg-secondary-800/50 transition-colors"
								>
									<td className="px-4 py-3">
										<Link
											to={`/config-management/directives/${d.id}`}
											className="text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline"
										>
											{d.name}
										</Link>
									</td>
									<td className="px-4 py-3 text-sm text-secondary-600 dark:text-secondary-300">
										{d.technique?.name || "—"}
										{d.technique_version && (
											<span
												className={`ml-1 text-xs ${
													d.technique &&
													d.technique_version !== d.technique.version
														? "text-amber-500 font-medium"
														: "text-secondary-400"
												}`}
											>
												v{d.technique_version}
												{d.technique &&
													d.technique_version !== d.technique.version &&
													" ⚠"}
											</span>
										)}
									</td>
									<td className="px-4 py-3">{modeBadge(d.policy_mode)}</td>
									<td className="px-4 py-3 text-sm text-secondary-600 dark:text-secondary-300">
										{d.priority}
									</td>
									<td className="px-4 py-3">
										{d.enabled ? (
											<span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
												<CheckCircle2 className="h-3.5 w-3.5" />
												Enabled
											</span>
										) : (
											<span className="inline-flex items-center gap-1 text-xs text-secondary-400">
												<XCircle className="h-3.5 w-3.5" />
												Disabled
											</span>
										)}
									</td>
									<td className="px-4 py-3 text-right">
										<div className="flex items-center justify-end gap-2">
											<Link
												to={`/config-management/directives/${d.id}`}
												className="p-1 rounded hover:bg-secondary-200 dark:hover:bg-secondary-700"
												title="Edit"
											>
												<Pencil className="h-4 w-4 text-secondary-500" />
											</Link>
											<button
												type="button"
												onClick={() => onDelete(d.id)}
												className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30"
												title="Delete"
											>
												<Trash2 className="h-4 w-4 text-red-500" />
											</button>
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

// ─── Rules tab ──────────────────────────────────────────────────────────────
function RulesTab({ rules, search, setSearch, onRun, onDelete }) {
	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between gap-4">
				<SearchInput
					value={search}
					onChange={setSearch}
					placeholder="Search rules…"
				/>
				<Link
					to="/config-management/rules/new"
					className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 transition-colors shrink-0"
				>
					<Plus className="h-4 w-4" />
					New Rule
				</Link>
			</div>

			{rules.length === 0 ? (
				<EmptyState message="No rules found" />
			) : (
				<div className="card overflow-hidden">
					<table className="min-w-full divide-y divide-secondary-200 dark:divide-secondary-700">
						<thead className="bg-secondary-50 dark:bg-secondary-800">
							<tr>
								<th className="px-4 py-3 text-left text-xs font-medium text-secondary-500 dark:text-secondary-400 uppercase tracking-wider">
									Name
								</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-secondary-500 dark:text-secondary-400 uppercase tracking-wider">
									Directives
								</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-secondary-500 dark:text-secondary-400 uppercase tracking-wider">
									Groups
								</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-secondary-500 dark:text-secondary-400 uppercase tracking-wider">
									Schedule
								</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-secondary-500 dark:text-secondary-400 uppercase tracking-wider">
									Priority
								</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-secondary-500 dark:text-secondary-400 uppercase tracking-wider">
									Status
								</th>
								<th className="px-4 py-3 text-right text-xs font-medium text-secondary-500 dark:text-secondary-400 uppercase tracking-wider">
									Actions
								</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-secondary-200 dark:divide-secondary-700">
							{rules.map((r) => (
								<tr
									key={r.id}
									className="hover:bg-secondary-50 dark:hover:bg-secondary-800/50 transition-colors"
								>
									<td className="px-4 py-3">
										<Link
											to={`/config-management/rules/${r.id}`}
											className="text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline"
										>
											{r.name}
										</Link>
										{r.description && (
											<p className="text-xs text-secondary-500 mt-0.5 truncate max-w-xs">
												{r.description}
											</p>
										)}
									</td>
									<td className="px-4 py-3 text-sm text-secondary-600 dark:text-secondary-300">
										{r.cm_rule_directives?.length || 0}
									</td>
									<td className="px-4 py-3 text-sm text-secondary-600 dark:text-secondary-300">
										{r.cm_rule_groups?.length || 0}
									</td>
									<td className="px-4 py-3">
										{schedBadge(
											r.run_schedule,
											r.schedule_interval,
											r.schedule_cron,
										)}
									</td>
									<td className="px-4 py-3 text-sm text-secondary-600 dark:text-secondary-300">
										{r.priority}
									</td>
									<td className="px-4 py-3">
										{r.enabled ? (
											<span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
												<CheckCircle2 className="h-3.5 w-3.5" />
												Enabled
											</span>
										) : (
											<span className="inline-flex items-center gap-1 text-xs text-secondary-400">
												<XCircle className="h-3.5 w-3.5" />
												Disabled
											</span>
										)}
									</td>
									<td className="px-4 py-3 text-right">
										<div className="flex items-center justify-end gap-2">
											<button
												type="button"
												onClick={() => onRun(r.id, r.name)}
												className="p-1 rounded hover:bg-green-100 dark:hover:bg-green-900/30"
												title="Run Now"
											>
												<Play className="h-4 w-4 text-green-600 dark:text-green-400" />
											</button>
											<Link
												to={`/config-management/rules/${r.id}`}
												className="p-1 rounded hover:bg-secondary-200 dark:hover:bg-secondary-700"
												title="Edit"
											>
												<Pencil className="h-4 w-4 text-secondary-500" />
											</Link>
											<button
												type="button"
												onClick={() => onDelete(r.id)}
												className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30"
												title="Delete"
											>
												<Trash2 className="h-4 w-4 text-red-500" />
											</button>
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

// ─── Jobs tab ───────────────────────────────────────────────────────────────

function jobStatusBadge(status) {
	const map = {
		pending: {
			bg: "bg-yellow-100 dark:bg-yellow-900/40",
			text: "text-yellow-700 dark:text-yellow-300",
			icon: Clock,
			label: "Pending",
		},
		running: {
			bg: "bg-blue-100 dark:bg-blue-900/40",
			text: "text-blue-700 dark:text-blue-300",
			icon: RefreshCw,
			label: "Running",
		},
		completed: {
			bg: "bg-green-100 dark:bg-green-900/40",
			text: "text-green-700 dark:text-green-300",
			icon: CheckCircle2,
			label: "Completed",
		},
		completed_with_errors: {
			bg: "bg-orange-100 dark:bg-orange-900/40",
			text: "text-orange-700 dark:text-orange-300",
			icon: AlertTriangle,
			label: "Errors",
		},
		failed: {
			bg: "bg-red-100 dark:bg-red-900/40",
			text: "text-red-700 dark:text-red-300",
			icon: XCircle,
			label: "Failed",
		},
	};
	const s = map[status] || map.pending;
	const Icon = s.icon;
	return (
		<span
			className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${s.bg} ${s.text}`}
		>
			<Icon
				className={`h-3 w-3 ${status === "running" ? "animate-spin" : ""}`}
			/>
			{s.label}
		</span>
	);
}

function JobsTab({ jobs, total }) {
	const navigate = useNavigate();
	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<p className="text-sm text-secondary-500 dark:text-secondary-400">
					{total != null ? `${total} total jobs` : ""}
				</p>
			</div>

			{!jobs || jobs.length === 0 ? (
				<EmptyState message="No config management jobs yet. Click 'Run Now' on a rule to trigger one." />
			) : (
				<div className="card overflow-hidden">
					<table className="min-w-full divide-y divide-secondary-200 dark:divide-secondary-700">
						<thead className="bg-secondary-50 dark:bg-secondary-800">
							<tr>
								<th className="px-4 py-3 text-left text-xs font-medium text-secondary-500 dark:text-secondary-400 uppercase tracking-wider">
									Rule
								</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-secondary-500 dark:text-secondary-400 uppercase tracking-wider">
									Status
								</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-secondary-500 dark:text-secondary-400 uppercase tracking-wider">
									Progress
								</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-secondary-500 dark:text-secondary-400 uppercase tracking-wider">
									Triggered By
								</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-secondary-500 dark:text-secondary-400 uppercase tracking-wider">
									When
								</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-secondary-200 dark:divide-secondary-700">
							{jobs.map((job) => {
								const done = job.completed_hosts + job.failed_hosts;
								const pct =
									job.total_hosts > 0
										? Math.round((done / job.total_hosts) * 100)
										: 0;
								return (
									<tr
										key={job.id}
										onClick={() =>
											navigate(`/config-management/jobs/${job.id}`)
										}
										className="hover:bg-secondary-50 dark:hover:bg-secondary-800/50 transition-colors cursor-pointer"
									>
										<td className="px-4 py-3 text-sm font-medium text-secondary-900 dark:text-secondary-100">
											{job.rule_name || "Unknown Rule"}
										</td>
										<td className="px-4 py-3 text-sm">
											{jobStatusBadge(job.status)}
										</td>
										<td className="px-4 py-3 text-sm">
											<div className="flex items-center gap-2">
												<div className="flex-1 h-2 bg-secondary-200 dark:bg-secondary-700 rounded-full overflow-hidden max-w-[120px]">
													<div
														className={`h-full rounded-full transition-all duration-500 ${
															job.failed_hosts > 0
																? "bg-orange-500"
																: "bg-green-500"
														}`}
														style={{ width: `${pct}%` }}
													/>
												</div>
												<span className="text-xs text-secondary-500 dark:text-secondary-400 whitespace-nowrap">
													{done}/{job.total_hosts}
												</span>
											</div>
										</td>
										<td className="px-4 py-3 text-sm text-secondary-600 dark:text-secondary-300">
											<span className="capitalize">{job.triggered_by}</span>
											{job.triggered_by_user && (
												<span className="text-xs text-secondary-400 ml-1">
													({job.triggered_by_user})
												</span>
											)}
										</td>
										<td className="px-4 py-3 text-sm text-secondary-500 dark:text-secondary-400">
											{timeAgo(job.created_at)}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}

// ─── Runs tab ───────────────────────────────────────────────────────────────
function RunsTab({ runs, total }) {
	const navigate = useNavigate();

	/** Derive a mode label from per-directive modes in directive_results. */
	function runModeLabel(run) {
		const dr = run.directive_results;
		if (!Array.isArray(dr) || dr.length === 0)
			return run.global_mode || "audit";
		const modes = [...new Set(dr.map((d) => d.policy_mode).filter(Boolean))];
		if (modes.length === 0) return run.global_mode || "audit";
		if (modes.length === 1) return modes[0];
		return "mixed";
	}

	function runModeBadge(run) {
		const mode = runModeLabel(run);
		if (mode === "mixed") {
			return (
				<span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-200">
					<Eye className="h-3 w-3" />
					Mixed
				</span>
			);
		}
		return modeBadge(mode);
	}

	/** Count directives that actually ran (have a real evaluated status). */
	function directivesRanCount(run) {
		const dr = run.directive_results;
		if (!Array.isArray(dr)) return 0;
		const excluded = new Set(["not_evaluated", "skipped"]);
		return dr.filter((d) => d.status && !excluded.has(d.status)).length;
	}

	const statusConfig = {
		compliant: {
			dot: "bg-green-500",
			label: "Compliant",
			text: "text-green-600 dark:text-green-400",
		},
		audit_compliant: {
			dot: "bg-green-500",
			label: "Compliant",
			text: "text-green-600 dark:text-green-400",
		},
		audited: {
			dot: "bg-green-500",
			label: "Audited",
			text: "text-green-600 dark:text-green-400",
		},
		repaired: {
			dot: "bg-blue-500",
			label: "Repaired",
			text: "text-blue-600 dark:text-blue-400",
		},
		non_compliant: {
			dot: "bg-red-500",
			label: "Non-compliant",
			text: "text-red-600 dark:text-red-400",
		},
		audit_non_compliant: {
			dot: "bg-red-500",
			label: "Non-compliant",
			text: "text-red-600 dark:text-red-400",
		},
		error: {
			dot: "bg-orange-500",
			label: "Error",
			text: "text-orange-600 dark:text-orange-400",
		},
		audit_error: {
			dot: "bg-orange-500",
			label: "Error",
			text: "text-orange-600 dark:text-orange-400",
		},
		not_applicable: {
			dot: "bg-secondary-400",
			label: "N/A",
			text: "text-secondary-500",
		},
		skipped: {
			dot: "bg-secondary-400",
			label: "Skipped",
			text: "text-secondary-500",
		},
	};
	const defaultStatus = {
		dot: "bg-secondary-400",
		label: "Unknown",
		text: "text-secondary-500",
	};

	/** Build a compact directive summary for the Results column. */
	function directiveSummary(run) {
		const dr = run.directive_results;
		if (!Array.isArray(dr) || dr.length === 0) return null;
		// Only show directives that actually ran (not skipped/not_evaluated)
		const ran = dr.filter(
			(d) => d.status && d.status !== "not_evaluated" && d.status !== "skipped",
		);
		if (ran.length === 0) return null;
		const shown = ran.slice(0, 3);
		const remaining = ran.length - shown.length;
		return (
			<div className="flex flex-col gap-0.5">
				{shown.map((d) => {
					const sc = statusConfig[d.status] || defaultStatus;
					return (
						<span
							key={d.directive_id}
							className="flex items-center gap-1.5 text-xs"
						>
							<span
								className={`inline-block h-1.5 w-1.5 rounded-full shrink-0 ${sc.dot}`}
							/>
							<span className="truncate max-w-[160px] text-secondary-700 dark:text-secondary-200">
								{d.directive_name || d.directive_id}
							</span>
							<span className={`shrink-0 ${sc.text}`}>{sc.label}</span>
						</span>
					);
				})}
				{remaining > 0 && (
					<span className="text-xs text-secondary-400">+{remaining} more</span>
				)}
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<p className="text-sm text-secondary-500 dark:text-secondary-400">
					{total != null ? `${total} total runs` : ""}
				</p>
			</div>

			{!runs || runs.length === 0 ? (
				<EmptyState message="No policy runs recorded yet" />
			) : (
				<div className="card overflow-hidden">
					<table className="min-w-full divide-y divide-secondary-200 dark:divide-secondary-700">
						<thead className="bg-secondary-50 dark:bg-secondary-800">
							<tr>
								<th className="px-4 py-3 text-left text-xs font-medium text-secondary-500 dark:text-secondary-400 uppercase tracking-wider">
									Host
								</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-secondary-500 dark:text-secondary-400 uppercase tracking-wider">
									Mode
								</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-secondary-500 dark:text-secondary-400 uppercase tracking-wider">
									Directives
								</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-secondary-500 dark:text-secondary-400 uppercase tracking-wider">
									Results
								</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-secondary-500 dark:text-secondary-400 uppercase tracking-wider">
									Score
								</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-secondary-500 dark:text-secondary-400 uppercase tracking-wider">
									When
								</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-secondary-200 dark:divide-secondary-700">
							{runs.map((run) => (
								<tr
									key={run.id}
									onClick={() => navigate(`/config-management/runs/${run.id}`)}
									className="hover:bg-secondary-50 dark:hover:bg-secondary-800/50 transition-colors cursor-pointer"
								>
									<td className="px-4 py-3 text-sm font-medium text-secondary-900 dark:text-white">
										{run.hosts?.friendly_name ||
											run.hosts?.hostname ||
											"Unknown"}
									</td>
									<td className="px-4 py-3">{runModeBadge(run)}</td>
									<td className="px-4 py-3 text-sm text-secondary-600 dark:text-secondary-300">
										<span className="font-medium">
											{directivesRanCount(run)}
										</span>
										<span className="text-secondary-400">
											/{run.total_directives}
										</span>
									</td>
									<td className="px-4 py-3">
										{directiveSummary(run) || (
											<div className="flex items-center gap-2 text-xs">
												<span className="text-green-600 dark:text-green-400">
													{run.compliant} ok
												</span>
												{run.repaired > 0 && (
													<span className="text-blue-600 dark:text-blue-400">
														{run.repaired} fixed
													</span>
												)}
												{run.non_compliant > 0 && (
													<span className="text-red-600 dark:text-red-400">
														{run.non_compliant} drift
													</span>
												)}
												{run.errors > 0 && (
													<span className="text-orange-600 dark:text-orange-400">
														{run.errors} err
													</span>
												)}
											</div>
										)}
									</td>
									<td className="px-4 py-3">
										<span
											className={`text-sm font-semibold ${scoreColor(run.score)}`}
										>
											{Math.round(run.score)}%
										</span>
									</td>
									<td className="px-4 py-3 text-sm text-secondary-500 dark:text-secondary-400">
										{timeAgo(run.evaluated_at)}
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

// ─── Shared small components ────────────────────────────────────────────────
function SearchInput({ value, onChange, placeholder }) {
	return (
		<div className="relative flex-1 max-w-sm">
			<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-secondary-400" />
			<input
				type="text"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder}
				className="w-full pl-9 pr-3 py-2 rounded-lg border border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-800 text-sm text-secondary-900 dark:text-white placeholder:text-secondary-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
			/>
		</div>
	);
}

function EmptyState({ message }) {
	return (
		<div className="text-center py-12">
			<Settings2 className="mx-auto h-10 w-10 text-secondary-300 dark:text-secondary-600" />
			<p className="mt-3 text-sm text-secondary-500 dark:text-secondary-400">
				{message}
			</p>
		</div>
	);
}
