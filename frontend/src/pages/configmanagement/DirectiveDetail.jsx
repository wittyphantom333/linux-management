import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
	ArrowLeft,
	Save,
	ListChecks,
	Eye,
	Wrench,
	AlertTriangle,
	ArrowUpCircle,
} from "lucide-react";
import { useToast } from "../../contexts/ToastContext";
import { configManagementAPI } from "../../utils/configManagementApi";

export default function DirectiveDetail() {
	const { id } = useParams();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const toast = useToast();
	const isNew = id === "new";

	// Form state
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [techniqueId, setTechniqueId] = useState("");
	const [techniqueVersion, setTechniqueVersion] = useState("");
	const [policyMode, setPolicyMode] = useState("audit");
	const [priority, setPriority] = useState(50);
	const [parameters, setParameters] = useState({});
	const [enabled, setEnabled] = useState(true);

	// Load techniques list for selector
	const { data: techniques } = useQuery({
		queryKey: ["configmgmt", "techniques"],
		queryFn: () =>
			configManagementAPI.listTechniques().then((r) => r.data.techniques),
		staleTime: 60_000,
	});

	// Load existing directive
	const { data: directive, isLoading } = useQuery({
		queryKey: ["configmgmt", "directive", id],
		queryFn: () =>
			configManagementAPI.getDirective(id).then((r) => r.data.directive),
		enabled: !isNew,
	});

	useEffect(() => {
		if (directive) {
			setName(directive.name || "");
			setDescription(directive.description || "");
			setTechniqueId(directive.technique_id || "");
			setTechniqueVersion(directive.technique_version || directive.technique?.version || "");
			setPolicyMode(directive.policy_mode || "audit");
			setPriority(directive.priority ?? 50);
			setParameters(directive.parameters || {});
			setEnabled(directive.enabled ?? true);
		}
	}, [directive]);

	// Selected technique details (for showing its parameters)
	const selectedTechnique = techniques?.find((t) => t.id === techniqueId);

	// Load available versions when a technique is selected
	const { data: techniqueVersions } = useQuery({
		queryKey: ["configmgmt", "technique-versions", techniqueId],
		queryFn: () =>
			configManagementAPI.getTechniqueVersions(techniqueId).then((r) => r.data.versions),
		enabled: !!techniqueId,
		staleTime: 30_000,
	});

	// Determine if there's a newer version available
	const latestVersion = techniqueVersions?.[0];
	const currentTechniqueVersion = selectedTechnique?.version;
	const hasNewerVersion = techniqueVersion && currentTechniqueVersion && techniqueVersion !== currentTechniqueVersion;

	// Build parameter inputs from technique definition
	const techniqueParams = selectedTechnique?.parameters || [];

	const saveMutation = useMutation({
		mutationFn: (data) =>
			isNew
				? configManagementAPI.createDirective(data)
				: configManagementAPI.updateDirective(id, data),
		onSuccess: (res) => {
			queryClient.invalidateQueries(["configmgmt"]);
			toast.success(isNew ? "Directive created" : "Directive updated");
			if (isNew && res.data?.directive?.id) {
				navigate(`/config-management/directives/${res.data.directive.id}`, {
					replace: true,
				});
			}
		},
		onError: (err) =>
			toast.error(`Save failed: ${err.response?.data?.error || err.message}`),
	});

	function handleSave() {
		if (!name.trim()) {
			toast.error("Name is required");
			return;
		}
		if (!techniqueId) {
			toast.error("Please select a technique");
			return;
		}
		saveMutation.mutate({
			name: name.trim(),
			description: description.trim() || null,
			technique_id: techniqueId,
			technique_version: techniqueVersion || undefined,
			policy_mode: policyMode,
			priority,
			parameters: Object.keys(parameters).length > 0 ? parameters : null,
			enabled,
		});
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
						<ListChecks className="h-6 w-6 text-indigo-500" />
						<h1 className="text-xl font-semibold text-secondary-900 dark:text-white">
							{isNew ? "New Directive" : `Edit: ${directive?.name || ""}`}
						</h1>
					</div>
				</div>
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

			{/* Basic info */}
			<div className="card p-5 space-y-4">
				<h2 className="text-lg font-medium text-secondary-900 dark:text-white">
					Directive Settings
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
							placeholder="e.g. Production NTP servers"
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
							Technique <span className="text-red-500">*</span>
						</label>
						<select
							value={techniqueId}
							onChange={(e) => {
								const newId = e.target.value;
								setTechniqueId(newId);
								setParameters({});
								// Auto-pin to the selected technique's version
								const tech = techniques?.find((t) => t.id === newId);
								if (tech) setTechniqueVersion(tech.version);
							}}
							disabled={!isNew}
							className="w-full px-3 py-2 rounded-lg border border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-800 text-sm text-secondary-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60"
						>
							<option value="">Select a technique…</option>
							{(techniques || []).map((t) => (
								<option key={t.id} value={t.id}>
									{t.name} v{t.version}
									{t.category ? ` (${t.category})` : ""}
								</option>
							))}
						</select>
					</div>
					{/* Technique Version Selector */}
					{techniqueId && techniqueVersions && techniqueVersions.length > 0 && (
						<div>
							<label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
								Technique Version
							</label>
							<select
								value={techniqueVersion}
								onChange={(e) => {
									const newVersion = e.target.value;
									setTechniqueVersion(newVersion);
									// If the user picks a different version row, switch technique_id
									const versionRow = techniqueVersions.find((v) => v.version === newVersion);
									if (versionRow && versionRow.id !== techniqueId) {
										setTechniqueId(versionRow.id);
										// Re-load parameters from the new version's technique
										const tech = techniques?.find((t) => t.id === versionRow.id);
										if (tech) {
											// Keep any matching param values, clear the rest
											const newParams = {};
											for (const p of (tech.parameters || [])) {
												if (parameters[p.name] !== undefined) {
													newParams[p.name] = parameters[p.name];
												}
											}
											setParameters(newParams);
										}
									}
								}}
								className="w-full px-3 py-2 rounded-lg border border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-800 text-sm text-secondary-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
							>
								{techniqueVersions.map((v) => (
									<option key={v.id} value={v.version}>
										v{v.version}
										{v.id === latestVersion?.id ? " (latest)" : ""}
										{v._count?.cm_directives ? ` — ${v._count.cm_directives} directive(s)` : ""}
									</option>
								))}
							</select>
							{!isNew && hasNewerVersion && (
								<div className="mt-2 flex items-center gap-2 p-2 rounded-lg bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700">
									<AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" />
									<span className="text-xs text-amber-700 dark:text-amber-300">
										This directive is pinned to <strong>v{techniqueVersion}</strong> but the technique is now at <strong>v{currentTechniqueVersion}</strong>.
										New versions are not automatically applied.
									</span>
									<button
										type="button"
										onClick={() => {
											if (latestVersion) {
												setTechniqueVersion(latestVersion.version);
												setTechniqueId(latestVersion.id);
											}
										}}
										className="ml-auto flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-amber-100 dark:bg-amber-800/50 text-amber-700 dark:text-amber-200 hover:bg-amber-200 dark:hover:bg-amber-800 transition-colors"
									>
										<ArrowUpCircle className="h-3 w-3" />
										Upgrade
									</button>
								</div>
							)}
							<p className="text-xs text-secondary-400 mt-0.5">
								Directives are pinned to a specific technique version. Select a version to apply.
							</p>
						</div>
					)}
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
						<p className="text-xs text-secondary-400 mt-0.5">
							Lower = higher priority (0-100)
						</p>
					</div>
					<div>
						<label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
							Policy Mode
						</label>
						<div className="flex gap-3">
							<button
								type="button"
								onClick={() => setPolicyMode("audit")}
								className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
									policyMode === "audit"
										? "border-amber-500 bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300"
										: "border-secondary-300 dark:border-secondary-600 text-secondary-500 hover:bg-secondary-50 dark:hover:bg-secondary-800"
								}`}
							>
								<Eye className="h-4 w-4" />
								Audit
							</button>
							<button
								type="button"
								onClick={() => setPolicyMode("enforce")}
								className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
									policyMode === "enforce"
										? "border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
										: "border-secondary-300 dark:border-secondary-600 text-secondary-500 hover:bg-secondary-50 dark:hover:bg-secondary-800"
								}`}
							>
								<Wrench className="h-4 w-4" />
								Enforce
							</button>
						</div>
						<p className="text-xs text-secondary-400 mt-1">
							{policyMode === "audit"
								? "Audit mode: report drift without making changes"
								: "Enforce mode: automatically fix non-compliant configurations"}
						</p>
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

			{/* Technique parameters */}
			{techniqueParams.length > 0 && (
				<div className="card p-5 space-y-4">
					<h2 className="text-lg font-medium text-secondary-900 dark:text-white">
						Technique Parameters
					</h2>
					<p className="text-xs text-secondary-500 dark:text-secondary-400">
						Fill in the values that will be substituted into the technique&apos;s methods.
					</p>
					<div className="space-y-3">
						{techniqueParams.map((param) => (
							<div key={param.name}>
								<label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
									{param.name}
									{param.description && (
										<span className="font-normal text-secondary-400 ml-2">
											— {param.description}
										</span>
									)}
								</label>
								<input
									type="text"
									value={parameters[param.name] ?? param.default ?? ""}
									onChange={(e) =>
										setParameters({
											...parameters,
											[param.name]: e.target.value,
										})
									}
									placeholder={param.default || ""}
									className="w-full px-3 py-2 rounded-lg border border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-800 text-sm text-secondary-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
								/>
							</div>
						))}
					</div>
				</div>
			)}

			{/* Linked rules (read-only, for existing directives) */}
			{!isNew && directive?.cm_rule_directives?.length > 0 && (
				<div className="card p-5 space-y-3">
					<h2 className="text-lg font-medium text-secondary-900 dark:text-white">
						Used in Rules
					</h2>
					<div className="space-y-2">
						{directive.cm_rule_directives.map((rd) => (
							<Link
								key={rd.rule?.id}
								to={`/config-management/rules/${rd.rule?.id}`}
								className="block p-2 rounded hover:bg-secondary-50 dark:hover:bg-secondary-800 text-sm text-primary-600 dark:text-primary-400"
							>
								{rd.rule?.name || rd.rule?.id}
							</Link>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
