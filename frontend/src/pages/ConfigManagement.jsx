import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
	Settings2,
	FileCode2,
	ListChecks,
	Network,
	History,
	BarChart3,
	Plus,
	Pencil,
	Trash2,
	ChevronRight,
	CheckCircle2,
	XCircle,
	AlertTriangle,
	ShieldCheck,
	ShieldAlert,
	Eye,
	Wrench,
	Search,
	RefreshCw,
} from "lucide-react";
import { useToast } from "../contexts/ToastContext";
import { configManagementAPI } from "../utils/configManagementApi";

// ─── Tab definitions ───────────────────────────────────────────────────────
const TABS = [
	{ id: "overview", label: "Overview", icon: BarChart3 },
	{ id: "techniques", label: "Techniques", icon: FileCode2 },
	{ id: "directives", label: "Directives", icon: ListChecks },
	{ id: "rules", label: "Rules", icon: Network },
	{ id: "runs", label: "Run History", icon: History },
];

// ─── Helpers ────────────────────────────────────────────────────────────────
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
		queryFn: () => configManagementAPI.getDashboard().then((r) => r.data.dashboard),
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

	// ─── Delete mutations ─────────────────────────────────────────────
	const deleteTechnique = useMutation({
		mutationFn: (id) => configManagementAPI.deleteTechnique(id),
		onSuccess: () => {
			queryClient.invalidateQueries(["configmgmt"]);
			toast.success("Technique deleted");
		},
		onError: (err) =>
			toast.error(
				`Delete failed: ${err.response?.data?.error || err.message}`,
			),
	});

	const deleteDirective = useMutation({
		mutationFn: (id) => configManagementAPI.deleteDirective(id),
		onSuccess: () => {
			queryClient.invalidateQueries(["configmgmt"]);
			toast.success("Directive deleted");
		},
		onError: (err) =>
			toast.error(
				`Delete failed: ${err.response?.data?.error || err.message}`,
			),
	});

	const deleteRule = useMutation({
		mutationFn: (id) => configManagementAPI.deleteRule(id),
		onSuccess: () => {
			queryClient.invalidateQueries(["configmgmt"]);
			toast.success("Rule deleted");
		},
		onError: (err) =>
			toast.error(
				`Delete failed: ${err.response?.data?.error || err.message}`,
			),
	});

	// ─── Filtered lists ───────────────────────────────────────────────
	const filteredTechniques = useMemo(() => {
		if (!techniques) return [];
		if (!techniqueSearch) return techniques;
		const q = techniqueSearch.toLowerCase();
		return techniques.filter(
			(t) =>
				t.name.toLowerCase().includes(q) ||
				(t.category && t.category.toLowerCase().includes(q)) ||
				(t.description && t.description.toLowerCase().includes(q)),
		);
	}, [techniques, techniqueSearch]);

	const filteredDirectives = useMemo(() => {
		if (!directives) return [];
		if (!directiveSearch) return directives;
		const q = directiveSearch.toLowerCase();
		return directives.filter(
			(d) =>
				d.name.toLowerCase().includes(q) ||
				(d.technique?.name && d.technique.name.toLowerCase().includes(q)),
		);
	}, [directives, directiveSearch]);

	const filteredRules = useMemo(() => {
		if (!rules) return [];
		if (!ruleSearch) return rules;
		const q = ruleSearch.toLowerCase();
		return rules.filter(
			(r) =>
				r.name.toLowerCase().includes(q) ||
				(r.description && r.description.toLowerCase().includes(q)),
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
							Define configuration policies and track compliance across your fleet
						</p>
					</div>
				</div>
			</div>

			{/* Stat cards */}
			{dashboard && (
				<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 mb-6">
					<StatCard
						label="Techniques"
						value={dashboard.techniques}
						icon={FileCode2}
						color="text-blue-500"
					/>
					<StatCard
						label="Directives"
						value={dashboard.directives}
						icon={ListChecks}
						color="text-indigo-500"
					/>
					<StatCard
						label="Rules"
						value={dashboard.rules}
						icon={Network}
						color="text-purple-500"
					/>
					<StatCard
						label="Managed Hosts"
						value={dashboard.enabled_hosts}
						icon={Settings2}
						color="text-teal-500"
					/>
					<StatCard
						label="Runs (24h)"
						value={dashboard.runs_24h}
						icon={History}
						color="text-cyan-500"
					/>
					<StatCard
						label="Avg Score (24h)"
						value={
							dashboard.avg_score_24h != null
								? `${dashboard.avg_score_24h}%`
								: "—"
						}
						icon={
							dashboard.avg_score_24h >= 90 ? ShieldCheck : ShieldAlert
						}
						color={
							dashboard.avg_score_24h != null
								? scoreColor(dashboard.avg_score_24h)
								: "text-secondary-400"
						}
					/>
				</div>
			)}

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
				<OverviewTab
					dashboard={dashboard}
					techniques={techniques}
					directives={directives}
					rules={rules}
					runs={runsData?.runs}
				/>
			)}
			{activeTab === "techniques" && (
				<TechniquesTab
					techniques={filteredTechniques}
					search={techniqueSearch}
					setSearch={setTechniqueSearch}
					onDelete={(id) => {
						if (window.confirm("Delete this technique? Related directives may break.")) {
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
					onDelete={(id) => {
						if (window.confirm("Delete this rule?")) {
							deleteRule.mutate(id);
						}
					}}
				/>
			)}
			{activeTab === "runs" && (
				<RunsTab runs={runsData?.runs} total={runsData?.total} />
			)}
		</div>
	);
}

// ─── Stat card ──────────────────────────────────────────────────────────────
function StatCard({ label, value, icon: Icon, color }) {
	return (
		<div className="card p-4 cursor-default text-left w-full">
			<div className="flex items-center justify-between">
				<Icon className={`h-5 w-5 ${color}`} />
			</div>
			<p className="mt-2 text-2xl font-semibold text-secondary-900 dark:text-white">
				{value ?? "—"}
			</p>
			<p className="text-xs text-secondary-500 dark:text-secondary-400 mt-1">
				{label}
			</p>
		</div>
	);
}

// ─── Overview tab ───────────────────────────────────────────────────────────
function OverviewTab({ dashboard, techniques, directives, rules, runs }) {
	return (
		<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
			{/* Recent runs */}
			<div className="card p-5">
				<h2 className="text-lg font-medium text-secondary-900 dark:text-white mb-4">
					Recent Policy Runs
				</h2>
				{(!runs || runs.length === 0) ? (
					<p className="text-sm text-secondary-500 dark:text-secondary-400">
						No policy runs yet. Enable config management on hosts and assign rules to get started.
					</p>
				) : (
					<div className="space-y-3">
						{runs.slice(0, 8).map((run) => (
							<Link
								key={run.id}
								to={`/config-management/runs/${run.id}`}
								className="flex items-center justify-between p-3 rounded-lg hover:bg-secondary-50 dark:hover:bg-secondary-800 transition-colors"
							>
								<div className="flex items-center gap-3">
									<div
										className={`h-2.5 w-2.5 rounded-full ${scoreBg(run.score)}`}
									/>
									<div>
										<p className="text-sm font-medium text-secondary-900 dark:text-white">
											{run.hosts?.friendly_name || run.hosts?.hostname || "Unknown Host"}
										</p>
										<p className="text-xs text-secondary-500 dark:text-secondary-400">
											{run.total_directives} directives · {timeAgo(run.evaluated_at)}
										</p>
									</div>
								</div>
								<div className="flex items-center gap-2">
									<span className={`text-sm font-semibold ${scoreColor(run.score)}`}>
										{Math.round(run.score)}%
									</span>
									<ChevronRight className="h-4 w-4 text-secondary-400" />
								</div>
							</Link>
						))}
					</div>
				)}
			</div>

			{/* Quick summary */}
			<div className="space-y-6">
				{/* Top techniques */}
				<div className="card p-5">
					<h2 className="text-lg font-medium text-secondary-900 dark:text-white mb-4">
						Techniques
					</h2>
					{(!techniques || techniques.length === 0) ? (
						<EmptyState message="No techniques defined yet" />
					) : (
						<div className="space-y-2">
							{techniques.slice(0, 5).map((t) => (
								<Link
									key={t.id}
									to={`/config-management/techniques/${t.id}`}
									className="flex items-center justify-between p-2 rounded hover:bg-secondary-50 dark:hover:bg-secondary-800"
								>
									<div>
										<p className="text-sm font-medium text-secondary-900 dark:text-white">
											{t.name}
										</p>
										{t.category && (
											<p className="text-xs text-secondary-500">
												{t.category}
											</p>
										)}
									</div>
									<span className="text-xs text-secondary-400">
										v{t.version} · {t._count?.cm_directives || 0} directives
									</span>
								</Link>
							))}
						</div>
					)}
				</div>

				{/* Active rules */}
				<div className="card p-5">
					<h2 className="text-lg font-medium text-secondary-900 dark:text-white mb-4">
						Active Rules
					</h2>
					{(!rules || rules.length === 0) ? (
						<EmptyState message="No rules defined yet" />
					) : (
						<div className="space-y-2">
							{rules.filter((r) => r.enabled).slice(0, 5).map((r) => (
								<Link
									key={r.id}
									to={`/config-management/rules/${r.id}`}
									className="flex items-center justify-between p-2 rounded hover:bg-secondary-50 dark:hover:bg-secondary-800"
								>
									<p className="text-sm font-medium text-secondary-900 dark:text-white">
										{r.name}
									</p>
									<span className="text-xs text-secondary-400">
										{r.cm_rule_directives?.length || 0} directives
										{" · "}
										{r.cm_rule_groups?.length || 0} groups
									</span>
								</Link>
							))}
						</div>
					)}
				</div>
			</div>
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
										{t.version}
									</td>
									<td className="px-4 py-3 text-sm text-secondary-600 dark:text-secondary-300">
										{Array.isArray(t.methods)
											? t.methods.length
											: "—"}
									</td>
									<td className="px-4 py-3 text-sm text-secondary-600 dark:text-secondary-300">
										{t._count?.cm_directives || 0}
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
function RulesTab({ rules, search, setSearch, onDelete }) {
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

// ─── Runs tab ───────────────────────────────────────────────────────────────
function RunsTab({ runs, total }) {
	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<p className="text-sm text-secondary-500 dark:text-secondary-400">
					{total != null ? `${total} total runs` : ""}
				</p>
			</div>

			{(!runs || runs.length === 0) ? (
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
								<th className="px-4 py-3 text-right text-xs font-medium text-secondary-500 dark:text-secondary-400 uppercase tracking-wider" />
							</tr>
						</thead>
						<tbody className="divide-y divide-secondary-200 dark:divide-secondary-700">
							{runs.map((run) => (
								<tr
									key={run.id}
									className="hover:bg-secondary-50 dark:hover:bg-secondary-800/50 transition-colors"
								>
									<td className="px-4 py-3 text-sm font-medium text-secondary-900 dark:text-white">
										{run.hosts?.friendly_name ||
											run.hosts?.hostname ||
											"Unknown"}
									</td>
									<td className="px-4 py-3">
										{modeBadge(run.global_mode)}
									</td>
									<td className="px-4 py-3 text-sm text-secondary-600 dark:text-secondary-300">
										{run.total_directives}
									</td>
									<td className="px-4 py-3">
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
									<td className="px-4 py-3 text-right">
										<Link
											to={`/config-management/runs/${run.id}`}
											className="p-1 rounded hover:bg-secondary-200 dark:hover:bg-secondary-700 inline-flex"
											title="View details"
										>
											<ChevronRight className="h-4 w-4 text-secondary-400" />
										</Link>
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
