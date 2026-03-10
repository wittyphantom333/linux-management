import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Calendar, Clock, Globe, Loader2, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useToast } from "../../contexts/ToastContext";
import { patchManagementAPI } from "../../utils/patchManagementApi";

const TIMEZONES = [
	"UTC",
	"America/New_York",
	"America/Chicago",
	"America/Denver",
	"America/Los_Angeles",
	"America/Anchorage",
	"America/Sao_Paulo",
	"Europe/London",
	"Europe/Berlin",
	"Europe/Moscow",
	"Asia/Tokyo",
	"Asia/Shanghai",
	"Asia/Kolkata",
	"Australia/Sydney",
	"Pacific/Auckland",
];

const CRON_PRESETS = [
	{ label: "Every Sunday 2 AM", value: "0 2 * * 0" },
	{ label: "Every Wednesday 3 AM", value: "0 3 * * 3" },
	{ label: "First Sunday of month 1 AM", value: "0 1 1-7 * 0" },
	{ label: "Every Saturday 4 AM", value: "0 4 * * 6" },
	{ label: "Daily at midnight", value: "0 0 * * *" },
];

export default function WindowDetail() {
	const { id } = useParams();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const toast = useToast();
	const isNew = id === "new";

	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [policyId, setPolicyId] = useState("");
	const [scheduleType, setScheduleType] = useState("recurring");
	const [scheduleCron, setScheduleCron] = useState("0 2 * * 0");
	const [scheduleTimezone, setScheduleTimezone] = useState("UTC");
	const [durationMinutes, setDurationMinutes] = useState(120);
	const [enabled, setEnabled] = useState(true);

	// Load policies for the selector
	const { data: policiesData } = useQuery({
		queryKey: ["patchmgmt", "policies"],
		queryFn: () =>
			patchManagementAPI.listPolicies().then((r) => r.data?.policies || []),
	});
	const policies = policiesData || [];

	// Load existing window
	const { data: windowData, isLoading } = useQuery({
		queryKey: ["patchmgmt", "window", id],
		queryFn: () => patchManagementAPI.getWindow(id).then((r) => r.data),
		enabled: !isNew,
	});

	const window_ = windowData?.window;

	useEffect(() => {
		if (window_) {
			setName(window_.name || "");
			setDescription(window_.description || "");
			setPolicyId(window_.policy_id || "");
			setScheduleType(window_.schedule_type || "recurring");
			setScheduleCron(window_.schedule_cron || "0 2 * * 0");
			setScheduleTimezone(window_.schedule_timezone || "UTC");
			setDurationMinutes(window_.duration_minutes ?? 120);
			setEnabled(window_.enabled ?? true);
		}
	}, [window_]);

	const saveMutation = useMutation({
		mutationFn: (data) =>
			isNew
				? patchManagementAPI.createWindow(data)
				: patchManagementAPI.updateWindow(id, data),
		onSuccess: (res) => {
			queryClient.invalidateQueries(["patchmgmt"]);
			toast.success(isNew ? "Window created" : "Window updated");
			if (isNew && res.data?.window?.id) {
				navigate(`/patch-management/windows/${res.data.window.id}`, {
					replace: true,
				});
			}
		},
		onError: (err) =>
			toast.error(`Save failed: ${err.response?.data?.error || err.message}`),
	});

	function handleSave() {
		if (!name.trim()) {
			toast.error("Window name is required");
			return;
		}
		if (!policyId) {
			toast.error("Select a policy");
			return;
		}
		saveMutation.mutate({
			name: name.trim(),
			description: description.trim() || null,
			policy_id: policyId,
			schedule_type: scheduleType,
			schedule_cron: scheduleCron,
			schedule_timezone: scheduleTimezone,
			duration_minutes: durationMinutes,
			enabled,
		});
	}

	function applyPreset(value) {
		setScheduleCron(value);
	}

	if (!isNew && isLoading) {
		return (
			<div className="flex items-center justify-center py-20">
				<Loader2 className="h-8 w-8 animate-spin text-primary-600" />
			</div>
		);
	}

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
						<h1 className="text-xl font-bold text-secondary-900 dark:text-white">
							{isNew
								? "New Maintenance Window"
								: `Edit: ${window_?.name || ""}`}
						</h1>
						<p className="text-sm text-secondary-500 dark:text-secondary-400">
							{isNew
								? "Schedule when patching can occur"
								: "Modify window schedule"}
						</p>
					</div>
				</div>
				<button
					onClick={handleSave}
					disabled={saveMutation.isPending}
					className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
				>
					{saveMutation.isPending ? (
						<Loader2 className="h-4 w-4 animate-spin" />
					) : (
						<Save className="h-4 w-4" />
					)}
					{isNew ? "Create" : "Save"}
				</button>
			</div>

			<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
				{/* Main form */}
				<div className="lg:col-span-2 space-y-6">
					{/* Basic info */}
					<div className="bg-white dark:bg-secondary-800 border border-secondary-200 dark:border-secondary-700 rounded-lg p-5 space-y-4">
						<h3 className="text-sm font-semibold text-secondary-900 dark:text-white flex items-center gap-2">
							<Clock className="h-4 w-4 text-primary-600" /> Window Details
						</h3>
						<div>
							<label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
								Name *
							</label>
							<input
								type="text"
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="e.g. Sunday Maintenance Window"
								className="w-full px-3 py-2 text-sm border border-secondary-300 dark:border-secondary-600 rounded-lg bg-white dark:bg-secondary-900 text-secondary-900 dark:text-white"
							/>
						</div>
						<div>
							<label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
								Description
							</label>
							<textarea
								value={description}
								onChange={(e) => setDescription(e.target.value)}
								rows={2}
								className="w-full px-3 py-2 text-sm border border-secondary-300 dark:border-secondary-600 rounded-lg bg-white dark:bg-secondary-900 text-secondary-900 dark:text-white"
							/>
						</div>
						<div>
							<label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
								Patch Policy *
							</label>
							<select
								value={policyId}
								onChange={(e) => setPolicyId(e.target.value)}
								className="w-full px-3 py-2 text-sm border border-secondary-300 dark:border-secondary-600 rounded-lg bg-white dark:bg-secondary-900 text-secondary-900 dark:text-white"
							>
								<option value="">Select a policy...</option>
								{policies.map((p) => (
									<option key={p.id} value={p.id}>
										{p.name}
									</option>
								))}
							</select>
						</div>
						<div className="flex items-center gap-3">
							<label className="flex items-center gap-2 cursor-pointer">
								<input
									type="checkbox"
									checked={enabled}
									onChange={(e) => setEnabled(e.target.checked)}
									className="rounded border-secondary-300 text-primary-600 focus:ring-primary-500"
								/>
								<span className="text-sm text-secondary-700 dark:text-secondary-300">
									Enabled
								</span>
							</label>
						</div>
					</div>

					{/* Schedule */}
					<div className="bg-white dark:bg-secondary-800 border border-secondary-200 dark:border-secondary-700 rounded-lg p-5 space-y-4">
						<h3 className="text-sm font-semibold text-secondary-900 dark:text-white flex items-center gap-2">
							<Calendar className="h-4 w-4 text-primary-600" /> Schedule
						</h3>
						<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
							<div>
								<label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
									Schedule Type
								</label>
								<select
									value={scheduleType}
									onChange={(e) => setScheduleType(e.target.value)}
									className="w-full px-3 py-2 text-sm border border-secondary-300 dark:border-secondary-600 rounded-lg bg-white dark:bg-secondary-900 text-secondary-900 dark:text-white"
								>
									<option value="recurring">Recurring (cron)</option>
									<option value="once">One-time</option>
								</select>
							</div>
							<div>
								<label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
									Duration (minutes)
								</label>
								<input
									type="number"
									min={15}
									max={1440}
									value={durationMinutes}
									onChange={(e) =>
										setDurationMinutes(parseInt(e.target.value, 10) || 120)
									}
									className="w-full px-3 py-2 text-sm border border-secondary-300 dark:border-secondary-600 rounded-lg bg-white dark:bg-secondary-900 text-secondary-900 dark:text-white"
								/>
							</div>
						</div>

						<div>
							<label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
								Cron Expression
							</label>
							<input
								type="text"
								value={scheduleCron}
								onChange={(e) => setScheduleCron(e.target.value)}
								placeholder="0 2 * * 0"
								className="w-full px-3 py-2 text-sm font-mono border border-secondary-300 dark:border-secondary-600 rounded-lg bg-white dark:bg-secondary-900 text-secondary-900 dark:text-white"
							/>
							<p className="text-xs text-secondary-500 mt-1">
								Format: minute hour day-of-month month day-of-week
							</p>
						</div>

						<div>
							<p className="text-xs font-medium text-secondary-600 dark:text-secondary-400 mb-1.5">
								Presets
							</p>
							<div className="flex flex-wrap gap-1.5">
								{CRON_PRESETS.map((p) => (
									<button
										key={p.value}
										onClick={() => applyPreset(p.value)}
										className={`px-2 py-1 text-xs rounded-md border ${
											scheduleCron === p.value
												? "bg-primary-50 border-primary-300 text-primary-700 dark:bg-primary-900/30 dark:border-primary-700 dark:text-primary-300"
												: "bg-white dark:bg-secondary-900 border-secondary-300 dark:border-secondary-600 text-secondary-700 dark:text-secondary-300 hover:bg-secondary-50 dark:hover:bg-secondary-700"
										}`}
									>
										{p.label}
									</button>
								))}
							</div>
						</div>

						<div>
							<label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
								<Globe className="inline-block h-3.5 w-3.5 mr-1" />
								Timezone
							</label>
							<select
								value={scheduleTimezone}
								onChange={(e) => setScheduleTimezone(e.target.value)}
								className="w-full px-3 py-2 text-sm border border-secondary-300 dark:border-secondary-600 rounded-lg bg-white dark:bg-secondary-900 text-secondary-900 dark:text-white"
							>
								{TIMEZONES.map((tz) => (
									<option key={tz} value={tz}>
										{tz}
									</option>
								))}
							</select>
						</div>
					</div>
				</div>

				{/* Sidebar */}
				<div className="space-y-6">
					{!isNew && window_ && (
						<div className="bg-white dark:bg-secondary-800 border border-secondary-200 dark:border-secondary-700 rounded-lg p-5 space-y-3">
							<h3 className="text-sm font-semibold text-secondary-900 dark:text-white">
								Schedule Info
							</h3>
							<dl className="space-y-2 text-sm">
								<div>
									<dt className="text-secondary-500 dark:text-secondary-400">
										Next Run
									</dt>
									<dd className="text-secondary-900 dark:text-white font-medium">
										{window_.next_run_at
											? new Date(window_.next_run_at).toLocaleString()
											: "Not scheduled"}
									</dd>
								</div>
								<div>
									<dt className="text-secondary-500 dark:text-secondary-400">
										Policy
									</dt>
									<dd>
										{window_.patch_policy ? (
											<Link
												to={`/patch-management/policies/${window_.patch_policy.id}`}
												className="text-primary-600 hover:underline"
											>
												{window_.patch_policy.name}
											</Link>
										) : (
											<span className="text-secondary-400">—</span>
										)}
									</dd>
								</div>
								<div>
									<dt className="text-secondary-500 dark:text-secondary-400">
										Created
									</dt>
									<dd className="text-secondary-900 dark:text-white">
										{new Date(window_.created_at).toLocaleString()}
									</dd>
								</div>
							</dl>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
