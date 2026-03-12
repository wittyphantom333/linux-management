import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Bell,
	Check,
	ChevronDown,
	ChevronUp,
	Edit2,
	Globe,
	Loader2,
	MessageSquare,
	Plus,
	Send,
	Trash2,
	X,
} from "lucide-react";
import { useState } from "react";
import { alertsAPI } from "../../utils/api";

// ─── Constants ───────────────────────────────────────────────────────────────

const CHANNEL_TYPES = [
	{
		value: "discord",
		label: "Discord",
		icon: MessageSquare,
		color: "text-indigo-500",
		bg: "bg-indigo-100 dark:bg-indigo-900",
		description: "Send rich embeds to a Discord channel via incoming webhook",
		urlPlaceholder: "https://discord.com/api/webhooks/...",
		configFields: [
			{
				key: "username",
				label: "Bot Username",
				placeholder: "PatchMon",
				type: "text",
			},
			{
				key: "avatar_url",
				label: "Avatar URL",
				placeholder: "https://example.com/avatar.png",
				type: "text",
			},
		],
	},
	{
		value: "teams",
		label: "Microsoft Teams",
		icon: MessageSquare,
		color: "text-blue-600",
		bg: "bg-blue-100 dark:bg-blue-900",
		description: "Post adaptive cards to a Teams channel via incoming webhook",
		urlPlaceholder:
			"https://outlook.office.com/webhook/... or https://...webhook.office.com/...",
		configFields: [],
	},
	{
		value: "webhook",
		label: "Generic Webhook",
		icon: Globe,
		color: "text-emerald-500",
		bg: "bg-emerald-100 dark:bg-emerald-900",
		description: "POST a JSON payload to any URL — supports HMAC signing",
		urlPlaceholder: "https://your-service.example.com/webhook",
		configFields: [
			{
				key: "secret",
				label: "HMAC Secret",
				placeholder: "Optional shared secret for X-PatchMon-Signature",
				type: "password",
			},
		],
	},
];

const SEVERITIES = ["critical", "warning", "informational", "low"];

const ALERT_TYPES = [
	{ value: "host_down", label: "Host Down" },
	{ value: "host_up", label: "Host Back Up" },
	{ value: "server_update", label: "Server Update" },
	{ value: "agent_update", label: "Agent Update" },
	{ value: "disk_space_warning", label: "Disk Space" },
	{ value: "high_load_average", label: "High Load" },
	{ value: "reboot_required", label: "Reboot Required" },
	{ value: "security_updates", label: "Security Updates" },
	{ value: "patch_job_failed", label: "Patch Job Failed" },
];

const SEVERITY_COLORS = {
	critical: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
	warning:
		"bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
	informational:
		"bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
	low: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function channelMeta(type) {
	return CHANNEL_TYPES.find((c) => c.value === type) || CHANNEL_TYPES[2];
}

const emptyForm = () => ({
	name: "",
	channel_type: "discord",
	webhook_url: "",
	enabled: true,
	severity_filter: null,
	type_filter: null,
	config: {},
});

// ─── Component ───────────────────────────────────────────────────────────────

const AlertChannels = () => {
	const queryClient = useQueryClient();
	const [showForm, setShowForm] = useState(false);
	const [editingId, setEditingId] = useState(null);
	const [form, setForm] = useState(emptyForm());
	const [expandedId, setExpandedId] = useState(null);
	const [testResult, setTestResult] = useState(null);
	const [showDelete, setShowDelete] = useState(null);

	// ── Queries ──────────────────────────────────────────────────────────────

	const {
		data: channels = [],
		isLoading,
		error,
	} = useQuery({
		queryKey: ["alert-channels"],
		queryFn: async () => {
			const res = await alertsAPI.getChannels();
			return res.data.data || [];
		},
	});

	// ── Mutations ────────────────────────────────────────────────────────────

	const saveMutation = useMutation({
		mutationFn: (data) =>
			editingId
				? alertsAPI.updateChannel(editingId, data)
				: alertsAPI.createChannel(data),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["alert-channels"] });
			resetForm();
		},
	});

	const deleteMutation = useMutation({
		mutationFn: (id) => alertsAPI.deleteChannel(id),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["alert-channels"] });
			setShowDelete(null);
		},
	});

	const testMutation = useMutation({
		mutationFn: (id) => alertsAPI.testChannel(id),
		onSuccess: () => setTestResult({ ok: true, msg: "Test sent!" }),
		onError: (err) =>
			setTestResult({
				ok: false,
				msg: err.response?.data?.error || err.message,
			}),
	});

	const testUnsavedMutation = useMutation({
		mutationFn: (data) => alertsAPI.testUnsavedChannel(data),
		onSuccess: () => setTestResult({ ok: true, msg: "Test sent!" }),
		onError: (err) =>
			setTestResult({
				ok: false,
				msg: err.response?.data?.error || err.message,
			}),
	});

	// ── Helpers ──────────────────────────────────────────────────────────────

	function resetForm() {
		setShowForm(false);
		setEditingId(null);
		setForm(emptyForm());
		setTestResult(null);
	}

	function openEdit(ch) {
		setEditingId(ch.id);
		setForm({
			name: ch.name,
			channel_type: ch.channel_type,
			webhook_url: ch.webhook_url,
			enabled: ch.enabled,
			severity_filter: ch.severity_filter,
			type_filter: ch.type_filter,
			config: ch.config || {},
		});
		setShowForm(true);
		setTestResult(null);
	}

	function openCreate() {
		resetForm();
		setShowForm(true);
	}

	function handleSubmit(e) {
		e.preventDefault();
		saveMutation.mutate({
			...form,
			severity_filter:
				form.severity_filter?.length > 0 ? form.severity_filter : null,
			type_filter: form.type_filter?.length > 0 ? form.type_filter : null,
			config: Object.keys(form.config || {}).length > 0 ? form.config : null,
		});
	}

	function toggleSeverity(sev) {
		const current = form.severity_filter || [];
		setForm({
			...form,
			severity_filter: current.includes(sev)
				? current.filter((s) => s !== sev)
				: [...current, sev],
		});
	}

	function toggleType(type) {
		const current = form.type_filter || [];
		setForm({
			...form,
			type_filter: current.includes(type)
				? current.filter((t) => t !== type)
				: [...current, type],
		});
	}

	function setConfig(key, value) {
		setForm({
			...form,
			config: { ...form.config, [key]: value || undefined },
		});
	}

	const meta = channelMeta(form.channel_type);

	// ── Render ───────────────────────────────────────────────────────────────

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold text-secondary-900 dark:text-white">
						Alert Channels
					</h1>
					<p className="mt-1 text-sm text-secondary-600 dark:text-secondary-400">
						Configure Discord, Teams, and webhook integrations for alert
						notifications
					</p>
				</div>
				<button
					type="button"
					onClick={openCreate}
					className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 transition-colors"
				>
					<Plus className="h-4 w-4" />
					Add Channel
				</button>
			</div>

			{/* ── Create / Edit Form ──────────────────────────────────────── */}
			{showForm && (
				<div className="bg-white dark:bg-secondary-800 border border-secondary-200 dark:border-secondary-600 rounded-lg p-6 space-y-5">
					<div className="flex items-center justify-between">
						<h2 className="text-lg font-semibold text-secondary-900 dark:text-white">
							{editingId ? "Edit Channel" : "New Channel"}
						</h2>
						<button type="button" onClick={resetForm}>
							<X className="h-5 w-5 text-secondary-400 hover:text-secondary-600" />
						</button>
					</div>

					<form onSubmit={handleSubmit} className="space-y-4">
						{/* Row 1: type + name */}
						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							<div>
								<label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
									Channel Type
								</label>
								<select
									value={form.channel_type}
									onChange={(e) =>
										setForm({
											...form,
											channel_type: e.target.value,
											config: {},
										})
									}
									className="w-full rounded-lg border border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-700 px-3 py-2 text-sm text-secondary-900 dark:text-white"
								>
									{CHANNEL_TYPES.map((ct) => (
										<option key={ct.value} value={ct.value}>
											{ct.label}
										</option>
									))}
								</select>
								<p className="mt-1 text-xs text-secondary-500 dark:text-secondary-400">
									{meta.description}
								</p>
							</div>

							<div>
								<label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
									Name
								</label>
								<input
									type="text"
									required
									value={form.name}
									onChange={(e) => setForm({ ...form, name: e.target.value })}
									placeholder='e.g. "Ops Discord" or "PagerDuty Webhook"'
									className="w-full rounded-lg border border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-700 px-3 py-2 text-sm text-secondary-900 dark:text-white placeholder-secondary-400"
								/>
							</div>
						</div>

						{/* Webhook URL */}
						<div>
							<label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
								Webhook URL
							</label>
							<input
								type="url"
								required
								value={form.webhook_url}
								onChange={(e) =>
									setForm({ ...form, webhook_url: e.target.value })
								}
								placeholder={meta.urlPlaceholder}
								className="w-full rounded-lg border border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-700 px-3 py-2 text-sm text-secondary-900 dark:text-white placeholder-secondary-400 font-mono"
							/>
						</div>

						{/* Per-type config fields */}
						{meta.configFields.length > 0 && (
							<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
								{meta.configFields.map((f) => (
									<div key={f.key}>
										<label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
											{f.label}
										</label>
										<input
											type={f.type || "text"}
											value={form.config?.[f.key] || ""}
											onChange={(e) => setConfig(f.key, e.target.value)}
											placeholder={f.placeholder}
											className="w-full rounded-lg border border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-700 px-3 py-2 text-sm text-secondary-900 dark:text-white placeholder-secondary-400"
										/>
									</div>
								))}
							</div>
						)}

						{/* Severity Filter */}
						<div>
							<label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
								Severity Filter{" "}
								<span className="font-normal text-secondary-400">
									(empty = all severities)
								</span>
							</label>
							<div className="flex flex-wrap gap-2">
								{SEVERITIES.map((sev) => {
									const active = (form.severity_filter || []).includes(sev);
									return (
										<button
											key={sev}
											type="button"
											onClick={() => toggleSeverity(sev)}
											className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
												active
													? `${SEVERITY_COLORS[sev]} border-transparent`
													: "bg-white dark:bg-secondary-700 text-secondary-500 dark:text-secondary-400 border-secondary-300 dark:border-secondary-600"
											}`}
										>
											{active && <Check className="h-3 w-3" />}
											{sev.charAt(0).toUpperCase() + sev.slice(1)}
										</button>
									);
								})}
							</div>
						</div>

						{/* Alert Type Filter */}
						<div>
							<label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
								Alert Type Filter{" "}
								<span className="font-normal text-secondary-400">
									(empty = all types)
								</span>
							</label>
							<div className="flex flex-wrap gap-2">
								{ALERT_TYPES.map((at) => {
									const active = (form.type_filter || []).includes(at.value);
									return (
										<button
											key={at.value}
											type="button"
											onClick={() => toggleType(at.value)}
											className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
												active
													? "bg-primary-100 text-primary-800 dark:bg-primary-900 dark:text-primary-200 border-transparent"
													: "bg-white dark:bg-secondary-700 text-secondary-500 dark:text-secondary-400 border-secondary-300 dark:border-secondary-600"
											}`}
										>
											{active && <Check className="h-3 w-3" />}
											{at.label}
										</button>
									);
								})}
							</div>
						</div>

						{/* Enabled toggle */}
						<div className="flex items-center gap-3">
							<button
								type="button"
								role="switch"
								aria-checked={form.enabled}
								onClick={() => setForm({ ...form, enabled: !form.enabled })}
								className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
									form.enabled
										? "bg-primary-600"
										: "bg-secondary-300 dark:bg-secondary-600"
								}`}
							>
								<span
									className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
										form.enabled ? "translate-x-5" : "translate-x-0"
									}`}
								/>
							</button>
							<span className="text-sm text-secondary-700 dark:text-secondary-300">
								{form.enabled ? "Enabled" : "Disabled"}
							</span>
						</div>

						{/* Test result banner */}
						{testResult && (
							<div
								className={`rounded-lg p-3 text-sm ${
									testResult.ok
										? "bg-green-50 dark:bg-green-900/30 text-green-800 dark:text-green-200"
										: "bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-200"
								}`}
							>
								{testResult.msg}
							</div>
						)}

						{/* Actions */}
						<div className="flex items-center gap-3 pt-2">
							<button
								type="submit"
								disabled={saveMutation.isPending}
								className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50 transition-colors"
							>
								{saveMutation.isPending && (
									<Loader2 className="h-4 w-4 animate-spin" />
								)}
								{editingId ? "Update Channel" : "Create Channel"}
							</button>

							<button
								type="button"
								disabled={
									!form.webhook_url ||
									!form.channel_type ||
									testUnsavedMutation.isPending
								}
								onClick={() => {
									setTestResult(null);
									testUnsavedMutation.mutate({
										channel_type: form.channel_type,
										webhook_url: form.webhook_url,
										config:
											Object.keys(form.config || {}).length > 0
												? form.config
												: null,
									});
								}}
								className="inline-flex items-center gap-2 rounded-lg border border-secondary-300 dark:border-secondary-600 px-4 py-2 text-sm font-medium text-secondary-700 dark:text-secondary-300 hover:bg-secondary-50 dark:hover:bg-secondary-700 disabled:opacity-50 transition-colors"
							>
								{testUnsavedMutation.isPending ? (
									<Loader2 className="h-4 w-4 animate-spin" />
								) : (
									<Send className="h-4 w-4" />
								)}
								Send Test
							</button>

							<button
								type="button"
								onClick={resetForm}
								className="text-sm text-secondary-500 hover:text-secondary-700 dark:hover:text-secondary-300"
							>
								Cancel
							</button>

							{saveMutation.isError && (
								<span className="text-sm text-red-600 dark:text-red-400">
									{saveMutation.error?.response?.data?.error ||
										saveMutation.error?.message}
								</span>
							)}
						</div>
					</form>
				</div>
			)}

			{/* ── Channel List ────────────────────────────────────────────── */}
			{isLoading && (
				<div className="flex items-center justify-center py-12">
					<Loader2 className="h-6 w-6 animate-spin text-primary-500" />
				</div>
			)}

			{error && (
				<div className="rounded-lg bg-red-50 dark:bg-red-900/30 p-4 text-sm text-red-800 dark:text-red-200">
					Failed to load channels: {error.message}
				</div>
			)}

			{!isLoading && !error && channels.length === 0 && !showForm && (
				<div className="bg-white dark:bg-secondary-800 border border-secondary-200 dark:border-secondary-600 rounded-lg px-6 py-12 text-center">
					<Bell className="mx-auto h-12 w-12 text-secondary-400" />
					<h3 className="mt-3 text-sm font-medium text-secondary-900 dark:text-white">
						No alert channels configured
					</h3>
					<p className="mt-1 text-sm text-secondary-500 dark:text-secondary-400">
						Add a Discord, Teams, or webhook channel to start receiving
						notifications.
					</p>
					<button
						type="button"
						onClick={openCreate}
						className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 transition-colors"
					>
						<Plus className="h-4 w-4" />
						Add Channel
					</button>
				</div>
			)}

			{!isLoading && channels.length > 0 && (
				<div className="space-y-3">
					{channels.map((ch) => {
						const m = channelMeta(ch.channel_type);
						const Icon = m.icon;
						const isExpanded = expandedId === ch.id;

						return (
							<div
								key={ch.id}
								className="bg-white dark:bg-secondary-800 border border-secondary-200 dark:border-secondary-600 rounded-lg overflow-hidden"
							>
								{/* Row */}
								<div className="flex items-center gap-4 px-5 py-4">
									{/* Icon */}
									<div
										className={`flex-shrink-0 h-10 w-10 rounded-lg flex items-center justify-center ${m.bg}`}
									>
										<Icon className={`h-5 w-5 ${m.color}`} />
									</div>

									{/* Info */}
									<div className="flex-1 min-w-0">
										<div className="flex items-center gap-2">
											<span className="font-medium text-secondary-900 dark:text-white truncate">
												{ch.name}
											</span>
											<span
												className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
													ch.enabled
														? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
														: "bg-secondary-100 text-secondary-600 dark:bg-secondary-700 dark:text-secondary-400"
												}`}
											>
												{ch.enabled ? "Active" : "Disabled"}
											</span>
										</div>
										<p className="text-xs text-secondary-500 dark:text-secondary-400 truncate mt-0.5">
											{m.label} &middot; {ch.webhook_url_preview || "—"}
										</p>
									</div>

									{/* Filters preview */}
									<div className="hidden lg:flex items-center gap-1 flex-wrap max-w-xs">
										{ch.severity_filter?.length > 0
											? ch.severity_filter.map((s) => (
													<span
														key={s}
														className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${SEVERITY_COLORS[s]}`}
													>
														{s}
													</span>
												))
											: null}
									</div>

									{/* Actions */}
									<div className="flex items-center gap-1">
										<button
											type="button"
											onClick={() => setExpandedId(isExpanded ? null : ch.id)}
											className="p-2 rounded-lg text-secondary-400 hover:text-secondary-600 hover:bg-secondary-100 dark:hover:bg-secondary-700 transition-colors"
											title="Details"
										>
											{isExpanded ? (
												<ChevronUp className="h-4 w-4" />
											) : (
												<ChevronDown className="h-4 w-4" />
											)}
										</button>
										<button
											type="button"
											onClick={() => {
												setTestResult(null);
												testMutation.mutate(ch.id);
											}}
											disabled={testMutation.isPending}
											className="p-2 rounded-lg text-secondary-400 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-colors"
											title="Send test notification"
										>
											{testMutation.isPending ? (
												<Loader2 className="h-4 w-4 animate-spin" />
											) : (
												<Send className="h-4 w-4" />
											)}
										</button>
										<button
											type="button"
											onClick={() => openEdit(ch)}
											className="p-2 rounded-lg text-secondary-400 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-colors"
											title="Edit"
										>
											<Edit2 className="h-4 w-4" />
										</button>
										<button
											type="button"
											onClick={() => setShowDelete(ch.id)}
											className="p-2 rounded-lg text-secondary-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
											title="Delete"
										>
											<Trash2 className="h-4 w-4" />
										</button>
									</div>
								</div>

								{/* Expanded details */}
								{isExpanded && (
									<div className="border-t border-secondary-200 dark:border-secondary-600 px-5 py-4 bg-secondary-50 dark:bg-secondary-900/40 space-y-3">
										<div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
											<div>
												<span className="font-medium text-secondary-700 dark:text-secondary-300">
													Severity Filter
												</span>
												<div className="mt-1 flex flex-wrap gap-1">
													{ch.severity_filter?.length > 0 ? (
														ch.severity_filter.map((s) => (
															<span
																key={s}
																className={`rounded-full px-2 py-0.5 text-xs font-medium ${SEVERITY_COLORS[s]}`}
															>
																{s}
															</span>
														))
													) : (
														<span className="text-secondary-400 text-xs">
															All severities
														</span>
													)}
												</div>
											</div>
											<div>
												<span className="font-medium text-secondary-700 dark:text-secondary-300">
													Type Filter
												</span>
												<div className="mt-1 flex flex-wrap gap-1">
													{ch.type_filter?.length > 0 ? (
														ch.type_filter.map((t) => {
															const atl = ALERT_TYPES.find(
																(a) => a.value === t,
															);
															return (
																<span
																	key={t}
																	className="rounded-full px-2 py-0.5 text-xs font-medium bg-primary-100 text-primary-800 dark:bg-primary-900 dark:text-primary-200"
																>
																	{atl?.label || t}
																</span>
															);
														})
													) : (
														<span className="text-secondary-400 text-xs">
															All types
														</span>
													)}
												</div>
											</div>
										</div>

										{ch.config && Object.keys(ch.config).length > 0 && (
											<div className="text-sm">
												<span className="font-medium text-secondary-700 dark:text-secondary-300">
													Config
												</span>
												<div className="mt-1 space-y-0.5 text-xs text-secondary-500 dark:text-secondary-400 font-mono">
													{Object.entries(ch.config).map(
														([k, v]) =>
															v && (
																<div key={k}>
																	{k}:{" "}
																	{k.toLowerCase().includes("secret")
																		? "••••••••"
																		: String(v)}
																</div>
															),
													)}
												</div>
											</div>
										)}

										{testResult && (
											<div
												className={`rounded-lg p-3 text-sm ${
													testResult.ok
														? "bg-green-50 dark:bg-green-900/30 text-green-800 dark:text-green-200"
														: "bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-200"
												}`}
											>
												{testResult.msg}
											</div>
										)}
									</div>
								)}
							</div>
						);
					})}
				</div>
			)}

			{/* ── Delete Confirmation ─────────────────────────────────────── */}
			{showDelete && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
					<div className="bg-white dark:bg-secondary-800 rounded-lg shadow-xl max-w-sm w-full mx-4 p-6 space-y-4">
						<h3 className="text-lg font-semibold text-secondary-900 dark:text-white">
							Delete Channel
						</h3>
						<p className="text-sm text-secondary-600 dark:text-secondary-400">
							Are you sure you want to delete this alert channel? This action
							cannot be undone.
						</p>
						<div className="flex justify-end gap-3">
							<button
								type="button"
								onClick={() => setShowDelete(null)}
								className="rounded-lg border border-secondary-300 dark:border-secondary-600 px-4 py-2 text-sm font-medium text-secondary-700 dark:text-secondary-300 hover:bg-secondary-50 dark:hover:bg-secondary-700"
							>
								Cancel
							</button>
							<button
								type="button"
								disabled={deleteMutation.isPending}
								onClick={() => deleteMutation.mutate(showDelete)}
								className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
							>
								{deleteMutation.isPending && (
									<Loader2 className="h-4 w-4 animate-spin" />
								)}
								Delete
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
};

export default AlertChannels;
