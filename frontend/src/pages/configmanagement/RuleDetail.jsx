import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ArrowLeft,
	CalendarClock,
	Clock,
	Network,
	Play,
	RefreshCw,
	Save,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useToast } from "../../contexts/ToastContext";
import { hostGroupsAPI } from "../../utils/api";
import { configManagementAPI } from "../../utils/configManagementApi";

export default function RuleDetail() {
	const { id } = useParams();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const toast = useToast();
	const isNew = id === "new";

	// Form state
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [priority, setPriority] = useState(50);
	const [enabled, setEnabled] = useState(true);
	const [selectedDirectives, setSelectedDirectives] = useState([]);
	const [selectedGroups, setSelectedGroups] = useState([]);
	// Schedule state
	const [runSchedule, setRunSchedule] = useState("always");
	const [scheduleInterval, setScheduleInterval] = useState(60);
	const [scheduleCron, setScheduleCron] = useState("0 2 * * *");
	const [scheduleTimezone, setScheduleTimezone] = useState("UTC");

	// Available directives and groups
	const { data: directives } = useQuery({
		queryKey: ["configmgmt", "directives"],
		queryFn: () =>
			configManagementAPI.listDirectives().then((r) => r.data.directives),
		staleTime: 60_000,
	});

	const { data: groups } = useQuery({
		queryKey: ["host-groups"],
		queryFn: () =>
			hostGroupsAPI.list().then((r) => r.data?.data || r.data || []),
		staleTime: 60_000,
	});

	// Load existing rule
	const { data: rule, isLoading } = useQuery({
		queryKey: ["configmgmt", "rule", id],
		queryFn: () => configManagementAPI.getRule(id).then((r) => r.data.rule),
		enabled: !isNew,
	});

	useEffect(() => {
		if (rule) {
			setName(rule.name || "");
			setDescription(rule.description || "");
			setPriority(rule.priority ?? 50);
			setEnabled(rule.enabled ?? true);
			setSelectedDirectives(
				(rule.cm_rule_directives || []).map(
					(rd) => rd.directive_id || rd.directive?.id,
				),
			);
			setSelectedGroups(
				(rule.cm_rule_groups || []).map((rg) => rg.host_group_id),
			);
			setRunSchedule(rule.run_schedule || "always");
			setScheduleInterval(rule.schedule_interval || 60);
			setScheduleCron(rule.schedule_cron || "0 2 * * *");
			setScheduleTimezone(rule.schedule_timezone || "UTC");
		}
	}, [rule]);

	const saveMutation = useMutation({
		mutationFn: (data) =>
			isNew
				? configManagementAPI.createRule(data)
				: configManagementAPI.updateRule(id, data),
		onSuccess: (res) => {
			queryClient.invalidateQueries(["configmgmt"]);
			toast.success(isNew ? "Rule created" : "Rule updated");
			if (isNew && res.data?.rule?.id) {
				navigate(`/config-management/rules/${res.data.rule.id}`, {
					replace: true,
				});
			}
		},
		onError: (err) =>
			toast.error(`Save failed: ${err.response?.data?.error || err.message}`),
	});

	const runMutation = useMutation({
		mutationFn: () => configManagementAPI.runRule(id),
		onSuccess: (res) => {
			const { notified, total } = res.data;
			toast.success(
				notified > 0
					? `Run triggered — ${notified} of ${total} agent(s) notified`
					: `No connected agents to notify (${total} host(s) in groups)`,
			);
		},
		onError: (err) =>
			toast.error(`Run failed: ${err.response?.data?.error || err.message}`),
	});

	function handleSave() {
		if (!name.trim()) {
			toast.error("Name is required");
			return;
		}
		saveMutation.mutate({
			name: name.trim(),
			description: description.trim() || null,
			priority,
			enabled,
			directive_ids: selectedDirectives,
			group_ids: selectedGroups,
			run_schedule: runSchedule,
			schedule_interval: runSchedule === "interval" ? scheduleInterval : null,
			schedule_cron: runSchedule === "cron" ? scheduleCron : null,
			schedule_timezone: scheduleTimezone,
		});
	}

	function toggleDirective(id) {
		setSelectedDirectives((prev) =>
			prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id],
		);
	}

	function toggleGroup(id) {
		setSelectedGroups((prev) =>
			prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id],
		);
	}

	if (isLoading) {
		return (
			<div className="flex items-center justify-center h-64">
				<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500" />
			</div>
		);
	}

	return (
		<div className="space-y-6 max-w-3xl mx-auto">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-3">
					<Link
						to="/config-management"
						className="p-2 rounded-lg hover:bg-secondary-100 dark:hover:bg-secondary-800"
					>
						<ArrowLeft className="h-5 w-5 text-secondary-500" />
					</Link>
					<div className="flex items-center gap-2">
						<Network className="h-6 w-6 text-purple-500" />
						<h1 className="text-xl font-semibold text-secondary-900 dark:text-white">
							{isNew ? "New Rule" : `Edit: ${rule?.name || ""}`}
						</h1>
					</div>
				</div>
				<div className="flex items-center gap-2">
					{!isNew && (
						<button
							type="button"
							onClick={() => {
								if (
									window.confirm(
										`Trigger an immediate run of "${rule?.name || name}"?\n\nThis will push report_now to all agents in the rule's host groups.`,
									)
								) {
									runMutation.mutate();
								}
							}}
							disabled={runMutation.isPending}
							className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
						>
							<Play className="h-4 w-4" />
							{runMutation.isPending ? "Running…" : "Run Now"}
						</button>
					)}
					<button
						type="button"
						onClick={handleSave}
						disabled={saveMutation.isPending}
						className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50 transition-colors"
					>
						<Save className="h-4 w-4" />
						{saveMutation.isPending ? "Saving…" : "Save"}
					</button>
				</div>
			</div>

			{/* Basic info */}
			<div className="card p-5 space-y-4">
				<h2 className="text-lg font-medium text-secondary-900 dark:text-white">
					Rule Settings
				</h2>
				<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
					<div className="md:col-span-2">
						<label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
							Name <span className="text-red-500">*</span>
						</label>
						<input
							type="text"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="e.g. Production Web Servers"
							className="w-full px-3 py-2 rounded-lg border border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-800 text-sm text-secondary-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
						/>
					</div>
					<div className="md:col-span-2">
						<label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
							Description
						</label>
						<textarea
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							rows={2}
							className="w-full px-3 py-2 rounded-lg border border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-800 text-sm text-secondary-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
						/>
					</div>
					<div>
						<label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
							Priority
						</label>
						<input
							type="number"
							value={priority}
							onChange={(e) => setPriority(Number.parseInt(e.target.value, 10))}
							min={0}
							max={100}
							className="w-full px-3 py-2 rounded-lg border border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-800 text-sm text-secondary-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
						/>
					</div>
					<div className="flex items-center gap-3">
						<label className="relative inline-flex items-center cursor-pointer">
							<input
								type="checkbox"
								checked={enabled}
								onChange={(e) => setEnabled(e.target.checked)}
								className="sr-only peer"
							/>
							<div className="w-9 h-5 bg-secondary-300 peer-focus:ring-2 peer-focus:ring-primary-500 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary-600" />
						</label>
						<span className="text-sm text-secondary-700 dark:text-secondary-300">
							Enabled
						</span>
					</div>
				</div>
			</div>

			{/* Directives selector */}
			<div className="card p-5 space-y-4">
				<h2 className="text-lg font-medium text-secondary-900 dark:text-white flex items-center gap-2">
					<Clock className="h-5 w-5 text-indigo-500" />
					Run Schedule
				</h2>
				<p className="text-xs text-secondary-500 dark:text-secondary-400">
					Control when and how often the directives in this rule are evaluated
					by agents.
				</p>
				<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
					{[
						{
							value: "always",
							label: "Every Check-in",
							icon: RefreshCw,
							desc: "Run every time the agent checks in",
						},
						{
							value: "once",
							label: "Run Once",
							icon: Play,
							desc: "Run once per directive version",
						},
						{
							value: "interval",
							label: "Fixed Interval",
							icon: Clock,
							desc: "Run every N minutes/hours",
						},
						{
							value: "cron",
							label: "Cron Schedule",
							icon: CalendarClock,
							desc: "Run on a cron expression",
						},
					].map((opt) => {
						const Icon = opt.icon;
						return (
							<button
								key={opt.value}
								type="button"
								onClick={() => setRunSchedule(opt.value)}
								className={`flex items-start gap-3 p-3 rounded-lg border text-left transition-colors ${
									runSchedule === opt.value
										? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20"
										: "border-secondary-200 dark:border-secondary-700 hover:bg-secondary-50 dark:hover:bg-secondary-800"
								}`}
							>
								<Icon
									className={`h-5 w-5 mt-0.5 flex-shrink-0 ${
										runSchedule === opt.value
											? "text-indigo-600 dark:text-indigo-400"
											: "text-secondary-400"
									}`}
								/>
								<div>
									<p
										className={`text-sm font-medium ${
											runSchedule === opt.value
												? "text-indigo-700 dark:text-indigo-300"
												: "text-secondary-700 dark:text-secondary-300"
										}`}
									>
										{opt.label}
									</p>
									<p className="text-xs text-secondary-400 mt-0.5">
										{opt.desc}
									</p>
								</div>
							</button>
						);
					})}
				</div>

				{/* Interval settings */}
				{runSchedule === "interval" && (
					<div className="mt-3 p-3 rounded-lg bg-secondary-50 dark:bg-secondary-800/50 border border-secondary-200 dark:border-secondary-700">
						<label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-2">
							Run every
						</label>
						<div className="flex items-center gap-2">
							<input
								type="number"
								value={scheduleInterval}
								onChange={(e) =>
									setScheduleInterval(
										Math.max(1, Number.parseInt(e.target.value, 10) || 1),
									)
								}
								min={1}
								className="w-24 px-3 py-2 rounded-lg border border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-800 text-sm text-secondary-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
							/>
							<span className="text-sm text-secondary-600 dark:text-secondary-400">
								minutes
							</span>
							{scheduleInterval >= 60 && (
								<span className="text-xs text-secondary-400 ml-2">
									({Math.floor(scheduleInterval / 60)}h{" "}
									{scheduleInterval % 60 > 0 ? `${scheduleInterval % 60}m` : ""}
									)
								</span>
							)}
						</div>
						<div className="flex flex-wrap gap-2 mt-2">
							{[
								{ label: "15 min", val: 15 },
								{ label: "30 min", val: 30 },
								{ label: "1 hour", val: 60 },
								{ label: "6 hours", val: 360 },
								{ label: "12 hours", val: 720 },
								{ label: "24 hours", val: 1440 },
							].map((preset) => (
								<button
									key={preset.val}
									type="button"
									onClick={() => setScheduleInterval(preset.val)}
									className={`px-2 py-1 text-xs rounded border transition-colors ${
										scheduleInterval === preset.val
											? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300"
											: "border-secondary-300 dark:border-secondary-600 text-secondary-500 hover:bg-secondary-50 dark:hover:bg-secondary-800"
									}`}
								>
									{preset.label}
								</button>
							))}
						</div>
					</div>
				)}

				{/* Cron settings */}
				{runSchedule === "cron" && (
					<div className="mt-3 p-3 rounded-lg bg-secondary-50 dark:bg-secondary-800/50 border border-secondary-200 dark:border-secondary-700 space-y-3">
						<div>
							<label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
								Cron Expression
							</label>
							<input
								type="text"
								value={scheduleCron}
								onChange={(e) => setScheduleCron(e.target.value)}
								placeholder="0 2 * * *"
								className="w-full px-3 py-2 rounded-lg border border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-800 text-sm font-mono text-secondary-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
							/>
							<p className="text-xs text-secondary-400 mt-1">
								Format: minute hour day-of-month month day-of-week (5 fields)
							</p>
						</div>
						<div className="flex flex-wrap gap-2">
							{[
								{ label: "Daily at 2 AM", val: "0 2 * * *" },
								{ label: "Daily at midnight", val: "0 0 * * *" },
								{ label: "Sundays at midnight", val: "0 0 * * 0" },
								{ label: "Mon-Fri at 6 AM", val: "0 6 * * 1-5" },
								{ label: "Every 6 hours", val: "0 */6 * * *" },
								{ label: "1st of month", val: "0 0 1 * *" },
							].map((preset) => (
								<button
									key={preset.val}
									type="button"
									onClick={() => setScheduleCron(preset.val)}
									className={`px-2 py-1 text-xs rounded border transition-colors ${
										scheduleCron === preset.val
											? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300"
											: "border-secondary-300 dark:border-secondary-600 text-secondary-500 hover:bg-secondary-50 dark:hover:bg-secondary-800"
									}`}
								>
									{preset.label}
								</button>
							))}
						</div>
						<div>
							<label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
								Timezone
							</label>
							<select
								value={scheduleTimezone}
								onChange={(e) => setScheduleTimezone(e.target.value)}
								className="w-full px-3 py-2 rounded-lg border border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-800 text-sm text-secondary-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
							>
								{[
									"UTC",
									"America/New_York",
									"America/Chicago",
									"America/Denver",
									"America/Los_Angeles",
									"America/Phoenix",
									"Europe/London",
									"Europe/Berlin",
									"Europe/Paris",
									"Asia/Tokyo",
									"Asia/Shanghai",
									"Australia/Sydney",
								].map((tz) => (
									<option key={tz} value={tz}>
										{tz}
									</option>
								))}
							</select>
						</div>
					</div>
				)}

				{/* Once mode explanation */}
				{runSchedule === "once" && (
					<div className="mt-3 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
						<p className="text-xs text-blue-700 dark:text-blue-300">
							<strong>Run Once</strong> evaluates each directive exactly once.
							When you update a directive&apos;s version, the agent will re-run
							it. This is ideal for one-time setup tasks like initial
							provisioning.
						</p>
					</div>
				)}
			</div>

			{/* Directives selector */}
			<div className="card p-5 space-y-4">
				<h2 className="text-lg font-medium text-secondary-900 dark:text-white">
					Directives
				</h2>
				<p className="text-xs text-secondary-500 dark:text-secondary-400">
					Select which directives this rule applies. The agent will evaluate all
					selected directives on matching hosts.
				</p>
				{!directives || directives.length === 0 ? (
					<p className="text-sm text-secondary-400 py-2">
						No directives available.{" "}
						<Link
							to="/config-management/directives/new"
							className="text-primary-600 hover:underline"
						>
							Create one first
						</Link>
						.
					</p>
				) : (
					<div className="space-y-2 max-h-64 overflow-y-auto">
						{directives.map((d) => {
							const selected = selectedDirectives.includes(d.id);
							return (
								<button
									key={d.id}
									type="button"
									onClick={() => toggleDirective(d.id)}
									className={`w-full flex items-center justify-between p-3 rounded-lg border text-left transition-colors ${
										selected
											? "border-primary-500 bg-primary-50 dark:bg-primary-900/20"
											: "border-secondary-200 dark:border-secondary-700 hover:bg-secondary-50 dark:hover:bg-secondary-800"
									}`}
								>
									<div>
										<p className="text-sm font-medium text-secondary-900 dark:text-white">
											{d.name}
										</p>
										<p className="text-xs text-secondary-500">
											{d.technique?.name || "—"} ·{" "}
											{d.policy_mode === "enforce" ? "Enforce" : "Audit"}
										</p>
									</div>
									{selected && (
										<span className="text-xs bg-primary-100 dark:bg-primary-800 text-primary-700 dark:text-primary-200 px-2 py-0.5 rounded-full">
											Selected
										</span>
									)}
								</button>
							);
						})}
					</div>
				)}
			</div>

			{/* Host groups selector */}
			<div className="card p-5 space-y-4">
				<h2 className="text-lg font-medium text-secondary-900 dark:text-white">
					Host Groups
				</h2>
				<p className="text-xs text-secondary-500 dark:text-secondary-400">
					Select which host groups this rule targets. Hosts in these groups will
					receive the selected directives.
				</p>
				{!groups || groups.length === 0 ? (
					<p className="text-sm text-secondary-400 py-2">
						No host groups available. Create groups in the Hosts section first.
					</p>
				) : (
					<div className="space-y-2 max-h-64 overflow-y-auto">
						{groups.map((g) => {
							const selected = selectedGroups.includes(g.id);
							return (
								<button
									key={g.id}
									type="button"
									onClick={() => toggleGroup(g.id)}
									className={`w-full flex items-center justify-between p-3 rounded-lg border text-left transition-colors ${
										selected
											? "border-primary-500 bg-primary-50 dark:bg-primary-900/20"
											: "border-secondary-200 dark:border-secondary-700 hover:bg-secondary-50 dark:hover:bg-secondary-800"
									}`}
								>
									<div>
										<p className="text-sm font-medium text-secondary-900 dark:text-white">
											{g.name}
										</p>
										{g.description && (
											<p className="text-xs text-secondary-500">
												{g.description}
											</p>
										)}
									</div>
									{selected && (
										<span className="text-xs bg-primary-100 dark:bg-primary-800 text-primary-700 dark:text-primary-200 px-2 py-0.5 rounded-full">
											Selected
										</span>
									)}
								</button>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
}
