import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
	ArrowLeft,
	Save,
	Shield,
	Plus,
	X,
	Server,
	Package,
	AlertTriangle,
	Play,
	Loader2,
	Trash2,
	Filter,
} from "lucide-react";
import { useToast } from "../../contexts/ToastContext";
import { patchManagementAPI } from "../../utils/patchManagementApi";
import { hostGroupsAPI } from "../../utils/api";

export default function PolicyDetail() {
	const { id } = useParams();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const toast = useToast();
	const isNew = id === "new";

	// Form state
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [policyType, setPolicyType] = useState("all");
	const [autoApprove, setAutoApprove] = useState(false);
	const [approvalTimeoutHours, setApprovalTimeoutHours] = useState(72);
	const [rebootPolicy, setRebootPolicy] = useState("if_needed");
	const [preSnapshot, setPreSnapshot] = useState(true);
	const [postSnapshot, setPostSnapshot] = useState(true);
	const [maxConcurrentHosts, setMaxConcurrentHosts] = useState(5);
	const [stopOnFailurePercent, setStopOnFailurePercent] = useState(30);
	const [blackoutStart, setBlackoutStart] = useState("");
	const [blackoutEnd, setBlackoutEnd] = useState("");
	const [enabled, setEnabled] = useState(true);
	const [selectedGroups, setSelectedGroups] = useState([]);
	const [filters, setFilters] = useState([]);

	// Available groups
	const { data: groups } = useQuery({
		queryKey: ["host-groups"],
		queryFn: () => hostGroupsAPI.list().then((r) => r.data?.data || r.data || []),
	});

	// Load existing policy
	const { data: policyData, isLoading } = useQuery({
		queryKey: ["patchmgmt", "policy", id],
		queryFn: () => patchManagementAPI.getPolicy(id).then((r) => r.data),
		enabled: !isNew,
	});

	const policy = policyData?.policy;
	const hostSummaries = policyData?.hosts || [];

	useEffect(() => {
		if (policy) {
			setName(policy.name || "");
			setDescription(policy.description || "");
			setPolicyType(policy.policy_type || "all");
			setAutoApprove(policy.auto_approve ?? false);
			setApprovalTimeoutHours(policy.approval_timeout_hours ?? 72);
			setRebootPolicy(policy.reboot_policy || "if_needed");
			setPreSnapshot(policy.pre_snapshot ?? true);
			setPostSnapshot(policy.post_snapshot ?? true);
			setMaxConcurrentHosts(policy.max_concurrent_hosts ?? 5);
			setStopOnFailurePercent(policy.stop_on_failure_percent ?? 30);
			setBlackoutStart(policy.blackout_start || "");
			setBlackoutEnd(policy.blackout_end || "");
			setEnabled(policy.enabled ?? true);
			setSelectedGroups((policy.patch_policy_groups || []).map((pg) => pg.host_group_id));
			setFilters(
				(policy.patch_policy_filters || []).map((f) => ({
					filter_type: f.filter_type,
					match_type: f.match_type,
					pattern: f.pattern,
				})),
			);
		}
	}, [policy]);

	const saveMutation = useMutation({
		mutationFn: (data) =>
			isNew
				? patchManagementAPI.createPolicy(data)
				: patchManagementAPI.updatePolicy(id, data),
		onSuccess: (res) => {
			queryClient.invalidateQueries(["patchmgmt"]);
			toast.success(isNew ? "Policy created" : "Policy updated");
			if (isNew && res.data?.policy?.id) {
				navigate(`/patch-management/policies/${res.data.policy.id}`, { replace: true });
			}
		},
		onError: (err) => toast.error(`Save failed: ${err.response?.data?.error || err.message}`),
	});

	const triggerJob = useMutation({
		mutationFn: () => patchManagementAPI.triggerJob({ policy_id: id }),
		onSuccess: (res) => {
			queryClient.invalidateQueries(["patchmgmt"]);
			toast.success(`Job created for ${res.data.hosts_count} hosts`);
			navigate(`/patch-management/jobs/${res.data.job.id}`);
		},
		onError: (err) => toast.error(err.response?.data?.error || "Failed to trigger job"),
	});

	function handleSave() {
		if (!name.trim()) {
			toast.error("Policy name is required");
			return;
		}
		if (selectedGroups.length === 0) {
			toast.error("At least one host group is required");
			return;
		}
		saveMutation.mutate({
			name: name.trim(),
			description: description.trim() || null,
			policy_type: policyType,
			auto_approve: autoApprove,
			approval_timeout_hours: approvalTimeoutHours,
			reboot_policy: rebootPolicy,
			pre_snapshot: preSnapshot,
			post_snapshot: postSnapshot,
			max_concurrent_hosts: maxConcurrentHosts,
			stop_on_failure_percent: stopOnFailurePercent,
			blackout_start: blackoutStart || null,
			blackout_end: blackoutEnd || null,
			enabled,
			group_ids: selectedGroups,
			filters,
		});
	}

	function addFilter() {
		setFilters([...filters, { filter_type: "exclude", match_type: "glob", pattern: "" }]);
	}

	function removeFilter(index) {
		setFilters(filters.filter((_, i) => i !== index));
	}

	function updateFilter(index, field, value) {
		const updated = [...filters];
		updated[index] = { ...updated[index], [field]: value };
		setFilters(updated);
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
							{isNew ? "New Patch Policy" : `Edit: ${policy?.name || ""}`}
						</h1>
						<p className="text-sm text-secondary-500 dark:text-secondary-400">
							{isNew ? "Define what to patch, where, and how" : "Modify policy settings"}
						</p>
					</div>
				</div>
				<div className="flex items-center gap-2">
					{!isNew && (
						<button
							onClick={() => {
								if (window.confirm(`Trigger a patch job for "${policy?.name}"?`)) {
									triggerJob.mutate();
								}
							}}
							disabled={triggerJob.isPending}
							className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
						>
							<Play className="h-4 w-4" /> Trigger Job
						</button>
					)}
					<button
						onClick={handleSave}
						disabled={saveMutation.isPending}
						className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
					>
						{saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
						{isNew ? "Create" : "Save"}
					</button>
				</div>
			</div>

			<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
				{/* Main form */}
				<div className="lg:col-span-2 space-y-6">
					{/* Basic info */}
					<div className="bg-white dark:bg-secondary-800 border border-secondary-200 dark:border-secondary-700 rounded-lg p-5 space-y-4">
						<h3 className="text-sm font-semibold text-secondary-900 dark:text-white flex items-center gap-2">
							<Shield className="h-4 w-4 text-primary-600" /> Basic Information
						</h3>
						<div>
							<label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
								Name *
							</label>
							<input
								type="text"
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="e.g. Security Patches - Production"
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
								placeholder="Describe the purpose of this policy"
								className="w-full px-3 py-2 text-sm border border-secondary-300 dark:border-secondary-600 rounded-lg bg-white dark:bg-secondary-900 text-secondary-900 dark:text-white"
							/>
						</div>
						<div className="flex items-center gap-3">
							<label className="flex items-center gap-2 cursor-pointer">
								<input
									type="checkbox"
									checked={enabled}
									onChange={(e) => setEnabled(e.target.checked)}
									className="rounded border-secondary-300 text-primary-600 focus:ring-primary-500"
								/>
								<span className="text-sm text-secondary-700 dark:text-secondary-300">Enabled</span>
							</label>
						</div>
					</div>

					{/* Policy type & reboot */}
					<div className="bg-white dark:bg-secondary-800 border border-secondary-200 dark:border-secondary-700 rounded-lg p-5 space-y-4">
						<h3 className="text-sm font-semibold text-secondary-900 dark:text-white">
							Update Scope & Behavior
						</h3>
						<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
							<div>
								<label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
									Policy Type
								</label>
								<select
									value={policyType}
									onChange={(e) => setPolicyType(e.target.value)}
									className="w-full px-3 py-2 text-sm border border-secondary-300 dark:border-secondary-600 rounded-lg bg-white dark:bg-secondary-900 text-secondary-900 dark:text-white"
								>
									<option value="all">All Available Updates</option>
									<option value="security_only">Security Updates Only</option>
									<option value="selected">Selected Packages (use filters)</option>
								</select>
							</div>
							<div>
								<label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
									Reboot Policy
								</label>
								<select
									value={rebootPolicy}
									onChange={(e) => setRebootPolicy(e.target.value)}
									className="w-full px-3 py-2 text-sm border border-secondary-300 dark:border-secondary-600 rounded-lg bg-white dark:bg-secondary-900 text-secondary-900 dark:text-white"
								>
									<option value="never">Never Reboot</option>
									<option value="if_needed">Reboot If Needed</option>
									<option value="always">Always Reboot</option>
								</select>
							</div>
							<div>
								<label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
									Max Concurrent Hosts
								</label>
								<input
									type="number"
									min={1}
									max={100}
									value={maxConcurrentHosts}
									onChange={(e) => setMaxConcurrentHosts(parseInt(e.target.value, 10) || 5)}
									className="w-full px-3 py-2 text-sm border border-secondary-300 dark:border-secondary-600 rounded-lg bg-white dark:bg-secondary-900 text-secondary-900 dark:text-white"
								/>
							</div>
							<div>
								<label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
									Stop on Failure %
								</label>
								<input
									type="number"
									min={0}
									max={100}
									value={stopOnFailurePercent}
									onChange={(e) => setStopOnFailurePercent(parseInt(e.target.value, 10) || 0)}
									className="w-full px-3 py-2 text-sm border border-secondary-300 dark:border-secondary-600 rounded-lg bg-white dark:bg-secondary-900 text-secondary-900 dark:text-white"
								/>
								<p className="text-xs text-secondary-500 mt-1">
									Stop job if this % of hosts fail (0 = never stop)
								</p>
							</div>
						</div>
						<div className="flex items-center gap-6">
							<label className="flex items-center gap-2 cursor-pointer">
								<input
									type="checkbox"
									checked={preSnapshot}
									onChange={(e) => setPreSnapshot(e.target.checked)}
									className="rounded border-secondary-300 text-primary-600 focus:ring-primary-500"
								/>
								<span className="text-sm text-secondary-700 dark:text-secondary-300">Pre-patch snapshot</span>
							</label>
							<label className="flex items-center gap-2 cursor-pointer">
								<input
									type="checkbox"
									checked={postSnapshot}
									onChange={(e) => setPostSnapshot(e.target.checked)}
									className="rounded border-secondary-300 text-primary-600 focus:ring-primary-500"
								/>
								<span className="text-sm text-secondary-700 dark:text-secondary-300">Post-patch snapshot</span>
							</label>
						</div>
					</div>

					{/* Package Filters */}
					<div className="bg-white dark:bg-secondary-800 border border-secondary-200 dark:border-secondary-700 rounded-lg p-5 space-y-4">
						<div className="flex items-center justify-between">
							<h3 className="text-sm font-semibold text-secondary-900 dark:text-white flex items-center gap-2">
								<Filter className="h-4 w-4" /> Package Filters
							</h3>
							<button
								onClick={addFilter}
								className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-secondary-100 dark:bg-secondary-700 text-secondary-700 dark:text-secondary-300 hover:bg-secondary-200 dark:hover:bg-secondary-600"
							>
								<Plus className="h-3 w-3" /> Add Filter
							</button>
						</div>

						{filters.length === 0 ? (
							<p className="text-sm text-secondary-500 dark:text-secondary-400">
								No filters — all matching packages will be included based on policy type.
							</p>
						) : (
							<div className="space-y-2">
								{filters.map((f, i) => (
									<div key={i} className="flex items-center gap-2">
										<select
											value={f.filter_type}
											onChange={(e) => updateFilter(i, "filter_type", e.target.value)}
											className="px-2 py-1.5 text-xs border border-secondary-300 dark:border-secondary-600 rounded-md bg-white dark:bg-secondary-900 text-secondary-900 dark:text-white"
										>
											<option value="exclude">Exclude</option>
											<option value="include">Include</option>
										</select>
										<select
											value={f.match_type}
											onChange={(e) => updateFilter(i, "match_type", e.target.value)}
											className="px-2 py-1.5 text-xs border border-secondary-300 dark:border-secondary-600 rounded-md bg-white dark:bg-secondary-900 text-secondary-900 dark:text-white"
										>
											<option value="glob">Glob</option>
											<option value="exact">Exact</option>
											<option value="regex">Regex</option>
										</select>
										<input
											type="text"
											value={f.pattern}
											onChange={(e) => updateFilter(i, "pattern", e.target.value)}
											placeholder="e.g. linux-image-* or ^nginx$"
											className="flex-1 px-2 py-1.5 text-xs border border-secondary-300 dark:border-secondary-600 rounded-md bg-white dark:bg-secondary-900 text-secondary-900 dark:text-white"
										/>
										<button
											onClick={() => removeFilter(i)}
											className="p-1 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
										>
											<X className="h-4 w-4" />
										</button>
									</div>
								))}
							</div>
						)}
					</div>
				</div>

				{/* Sidebar */}
				<div className="space-y-6">
					{/* Host Group selector */}
					<div className="bg-white dark:bg-secondary-800 border border-secondary-200 dark:border-secondary-700 rounded-lg p-5 space-y-3">
						<h3 className="text-sm font-semibold text-secondary-900 dark:text-white">
							Target Host Groups *
						</h3>
						{groups && groups.length > 0 ? (
							<div className="space-y-2 max-h-60 overflow-y-auto">
								{groups.map((g) => (
									<label key={g.id} className="flex items-center gap-2 cursor-pointer">
										<input
											type="checkbox"
											checked={selectedGroups.includes(g.id)}
											onChange={(e) => {
												if (e.target.checked) {
													setSelectedGroups([...selectedGroups, g.id]);
												} else {
													setSelectedGroups(selectedGroups.filter((x) => x !== g.id));
												}
											}}
											className="rounded border-secondary-300 text-primary-600 focus:ring-primary-500"
										/>
										<span
											className="inline-flex items-center px-2 py-0.5 rounded text-xs"
											style={{
												backgroundColor: `${g.color || "#3B82F6"}20`,
												color: g.color || "#3B82F6",
											}}
										>
											{g.name}
										</span>
									</label>
								))}
							</div>
						) : (
							<p className="text-sm text-secondary-500 dark:text-secondary-400">
								No host groups available.{" "}
								<Link to="/settings/host-groups" className="text-primary-600 hover:underline">
									Create one
								</Link>
							</p>
						)}
					</div>

					{/* Targeted hosts preview (only when editing) */}
					{!isNew && hostSummaries.length > 0 && (
						<div className="bg-white dark:bg-secondary-800 border border-secondary-200 dark:border-secondary-700 rounded-lg p-5 space-y-3">
							<h3 className="text-sm font-semibold text-secondary-900 dark:text-white flex items-center gap-2">
								<Server className="h-4 w-4" /> Targeted Hosts ({hostSummaries.length})
							</h3>
							<div className="space-y-2 max-h-80 overflow-y-auto">
								{hostSummaries.map((h) => (
									<div key={h.id} className="flex items-center justify-between text-xs p-2 rounded-md bg-secondary-50 dark:bg-secondary-900/50">
										<div>
											<p className="font-medium text-secondary-900 dark:text-white">
												{h.friendly_name || h.hostname}
											</p>
											<p className="text-secondary-500 dark:text-secondary-400">
												{h.os_type} {h.os_version}
											</p>
										</div>
										<div className="text-right">
											<p className="text-primary-600 dark:text-primary-400">
												{h.updatable_packages} updates
											</p>
											{h.security_updates > 0 && (
												<p className="text-red-500 flex items-center gap-1 justify-end">
													<AlertTriangle className="h-3 w-3" />
													{h.security_updates} security
												</p>
											)}
										</div>
									</div>
								))}
							</div>
						</div>
					)}

					{/* Recent jobs (only when editing) */}
					{!isNew && policy?.patch_jobs?.length > 0 && (
						<div className="bg-white dark:bg-secondary-800 border border-secondary-200 dark:border-secondary-700 rounded-lg p-5 space-y-3">
							<h3 className="text-sm font-semibold text-secondary-900 dark:text-white">
								Recent Jobs
							</h3>
							<div className="space-y-2">
								{policy.patch_jobs.map((j) => (
									<Link
										key={j.id}
										to={`/patch-management/jobs/${j.id}`}
										className="flex items-center justify-between text-xs p-2 rounded-md hover:bg-secondary-50 dark:hover:bg-secondary-700/50"
									>
										<StatusBadgeInline status={j.status} />
										<span className="text-secondary-500 dark:text-secondary-400">
											{new Date(j.created_at).toLocaleDateString()}
										</span>
									</Link>
								))}
							</div>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

function StatusBadgeInline({ status }) {
	const map = {
		pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
		running: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
		completed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
		completed_with_errors: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
		failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
		cancelled: "bg-secondary-100 text-secondary-600 dark:bg-secondary-700 dark:text-secondary-400",
	};
	return (
		<span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${map[status] || ""}`}>
			{status?.replace(/_/g, " ")}
		</span>
	);
}
