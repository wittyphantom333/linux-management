import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
	ArrowLeft,
	Save,
	Plus,
	Trash2,
	GripVertical,
	FileCode2,
	ChevronDown,
	ChevronUp,
} from "lucide-react";
import { useToast } from "../../contexts/ToastContext";
import { configManagementAPI } from "../../utils/configManagementApi";

// Built-in method types the agent supports
const METHOD_TYPES = [
	{ value: "file_content", label: "File Content", description: "Ensure file contains specific content" },
	{ value: "file_key_value", label: "File Key-Value", description: "Manage key=value pairs in config files" },
	{ value: "file_permissions", label: "File Permissions", description: "Ensure file ownership and permissions" },
	{ value: "package_present", label: "Package Present", description: "Ensure a package is installed" },
	{ value: "package_absent", label: "Package Absent", description: "Ensure a package is not installed" },
	{ value: "service_running", label: "Service Running", description: "Ensure a service is running" },
	{ value: "service_stopped", label: "Service Stopped", description: "Ensure a service is stopped" },
	{ value: "service_restart", label: "Service Restart", description: "Restart a service" },
	{ value: "command_audit", label: "Command Audit", description: "Run a command and check exit code (read-only)" },
	{ value: "command_exec", label: "Command Execute", description: "Execute a command (enforce only)" },
	{ value: "user_present", label: "User Present", description: "Ensure a system user exists" },
	{ value: "user_absent", label: "User Absent", description: "Ensure a system user does not exist" },
	{ value: "directory_present", label: "Directory Present", description: "Ensure a directory exists" },
];

const CATEGORIES = [
	"File Management",
	"Package Management",
	"Service Management",
	"User Management",
	"Security",
	"Networking",
	"Monitoring",
	"Custom",
];

export default function TechniqueDetail() {
	const { id } = useParams();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const toast = useToast();
	const isNew = id === "new";

	// Form state
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [version, setVersion] = useState("1.0");
	const [category, setCategory] = useState("");
	const [parameters, setParameters] = useState([]);
	const [methods, setMethods] = useState([]);
	const [expandedMethod, setExpandedMethod] = useState(null);

	// Load existing technique
	const { data: technique, isLoading } = useQuery({
		queryKey: ["configmgmt", "technique", id],
		queryFn: () => configManagementAPI.getTechnique(id).then((r) => r.data.technique),
		enabled: !isNew,
	});

	useEffect(() => {
		if (technique) {
			setName(technique.name || "");
			setDescription(technique.description || "");
			setVersion(technique.version || "1.0");
			setCategory(technique.category || "");
			setParameters(technique.parameters || []);
			setMethods(technique.methods || []);
		}
	}, [technique]);

	// Save mutation
	const saveMutation = useMutation({
		mutationFn: (data) =>
			isNew
				? configManagementAPI.createTechnique(data)
				: configManagementAPI.updateTechnique(id, data),
		onSuccess: (res) => {
			queryClient.invalidateQueries(["configmgmt"]);
			toast.success(isNew ? "Technique created" : "Technique updated");
			if (isNew && res.data?.technique?.id) {
				navigate(`/config-management/techniques/${res.data.technique.id}`, { replace: true });
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
		if (methods.length === 0) {
			toast.error("At least one method is required");
			return;
		}
		saveMutation.mutate({
			name: name.trim(),
			description: description.trim() || null,
			version,
			category: category || null,
			parameters: parameters.length > 0 ? parameters : null,
			methods,
		});
	}

	// Parameter helpers
	function addParameter() {
		setParameters([
			...parameters,
			{ name: "", description: "", default: "", type: "string" },
		]);
	}

	function updateParameter(idx, field, value) {
		const updated = [...parameters];
		updated[idx] = { ...updated[idx], [field]: value };
		setParameters(updated);
	}

	function removeParameter(idx) {
		setParameters(parameters.filter((_, i) => i !== idx));
	}

	// Method helpers
	function addMethod() {
		const newMethod = {
			id: `method_${Date.now()}`,
			type: "file_content",
			description: "",
			args: {},
			condition: "",
		};
		setMethods([...methods, newMethod]);
		setExpandedMethod(methods.length);
	}

	function updateMethod(idx, field, value) {
		const updated = [...methods];
		updated[idx] = { ...updated[idx], [field]: value };
		setMethods(updated);
	}

	function updateMethodArg(idx, key, value) {
		const updated = [...methods];
		updated[idx] = {
			...updated[idx],
			args: { ...updated[idx].args, [key]: value },
		};
		setMethods(updated);
	}

	function removeMethod(idx) {
		setMethods(methods.filter((_, i) => i !== idx));
		setExpandedMethod(null);
	}

	function moveMethod(idx, direction) {
		const newIdx = idx + direction;
		if (newIdx < 0 || newIdx >= methods.length) return;
		const updated = [...methods];
		[updated[idx], updated[newIdx]] = [updated[newIdx], updated[idx]];
		setMethods(updated);
		setExpandedMethod(newIdx);
	}

	// Method arg fields depend on method type
	function getMethodArgs(type) {
		switch (type) {
			case "file_content":
				return [
					{ key: "path", label: "File Path", required: true },
					{ key: "content", label: "Content", type: "textarea", required: true },
					{ key: "enforce", label: "Create if missing", type: "checkbox" },
				];
			case "file_key_value":
				return [
					{ key: "path", label: "File Path", required: true },
					{ key: "key", label: "Key", required: true },
					{ key: "value", label: "Value", required: true },
					{ key: "separator", label: "Separator", placeholder: "=" },
				];
			case "file_permissions":
				return [
					{ key: "path", label: "File Path", required: true },
					{ key: "mode", label: "Mode", placeholder: "0644" },
					{ key: "owner", label: "Owner", placeholder: "root" },
					{ key: "group", label: "Group", placeholder: "root" },
				];
			case "package_present":
			case "package_absent":
				return [{ key: "name", label: "Package Name", required: true }];
			case "service_running":
			case "service_stopped":
			case "service_restart":
				return [{ key: "name", label: "Service Name", required: true }];
			case "command_audit":
				return [
					{ key: "command", label: "Command", required: true },
					{ key: "expected_code", label: "Expected Exit Code", placeholder: "0" },
				];
			case "command_exec":
				return [{ key: "command", label: "Command", required: true }];
			case "user_present":
				return [
					{ key: "name", label: "Username", required: true },
					{ key: "shell", label: "Shell", placeholder: "/bin/bash" },
					{ key: "home", label: "Home Directory" },
				];
			case "user_absent":
				return [{ key: "name", label: "Username", required: true }];
			case "directory_present":
				return [
					{ key: "path", label: "Directory Path", required: true },
					{ key: "mode", label: "Mode", placeholder: "0755" },
					{ key: "owner", label: "Owner", placeholder: "root" },
					{ key: "group", label: "Group", placeholder: "root" },
				];
			default:
				return [];
		}
	}

	if (isLoading) {
		return (
			<div className="flex items-center justify-center h-64">
				<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500" />
			</div>
		);
	}

	return (
		<div className="space-y-6 max-w-4xl mx-auto">
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
						<FileCode2 className="h-6 w-6 text-primary-500" />
						<h1 className="text-xl font-semibold text-secondary-900 dark:text-white">
							{isNew ? "New Technique" : `Edit: ${technique?.name || ""}`}
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
					Basic Information
				</h2>
				<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
					<div>
						<label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
							Name <span className="text-red-500">*</span>
						</label>
						<input
							type="text"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="e.g. NTP Configuration"
							className="w-full px-3 py-2 rounded-lg border border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-800 text-sm text-secondary-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
						/>
					</div>
					<div>
						<label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
							Version
						</label>
						<input
							type="text"
							value={version}
							onChange={(e) => setVersion(e.target.value)}
							className="w-full px-3 py-2 rounded-lg border border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-800 text-sm text-secondary-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
						/>
					</div>
					<div>
						<label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
							Category
						</label>
						<select
							value={category}
							onChange={(e) => setCategory(e.target.value)}
							className="w-full px-3 py-2 rounded-lg border border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-800 text-sm text-secondary-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
						>
							<option value="">Select category…</option>
							{CATEGORIES.map((c) => (
								<option key={c} value={c}>{c}</option>
							))}
						</select>
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
				</div>
			</div>

			{/* Parameters */}
			<div className="card p-5 space-y-4">
				<div className="flex items-center justify-between">
					<h2 className="text-lg font-medium text-secondary-900 dark:text-white">
						Parameters
					</h2>
					<button
						type="button"
						onClick={addParameter}
						className="inline-flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700"
					>
						<Plus className="h-4 w-4" />
						Add Parameter
					</button>
				</div>
				<p className="text-xs text-secondary-500 dark:text-secondary-400">
					Parameters allow directives to customise this technique. Use {"{{param_name}}"} in method args.
				</p>
				{parameters.length === 0 ? (
					<p className="text-sm text-secondary-400 py-2">No parameters defined</p>
				) : (
					<div className="space-y-3">
						{parameters.map((p, idx) => (
							<div
								key={idx}
								className="grid grid-cols-5 gap-2 items-start"
							>
								<input
									type="text"
									value={p.name}
									onChange={(e) => updateParameter(idx, "name", e.target.value)}
									placeholder="name"
									className="px-2 py-1.5 rounded border border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-800 text-sm"
								/>
								<input
									type="text"
									value={p.description || ""}
									onChange={(e) => updateParameter(idx, "description", e.target.value)}
									placeholder="description"
									className="px-2 py-1.5 rounded border border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-800 text-sm"
								/>
								<input
									type="text"
									value={p.default || ""}
									onChange={(e) => updateParameter(idx, "default", e.target.value)}
									placeholder="default value"
									className="px-2 py-1.5 rounded border border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-800 text-sm"
								/>
								<select
									value={p.type || "string"}
									onChange={(e) => updateParameter(idx, "type", e.target.value)}
									className="px-2 py-1.5 rounded border border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-800 text-sm"
								>
									<option value="string">String</option>
									<option value="integer">Integer</option>
									<option value="boolean">Boolean</option>
									<option value="select">Select</option>
								</select>
								<button
									type="button"
									onClick={() => removeParameter(idx)}
									className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 self-center justify-self-center"
								>
									<Trash2 className="h-4 w-4 text-red-500" />
								</button>
							</div>
						))}
					</div>
				)}
			</div>

			{/* Methods */}
			<div className="card p-5 space-y-4">
				<div className="flex items-center justify-between">
					<h2 className="text-lg font-medium text-secondary-900 dark:text-white">
						Methods <span className="text-red-500">*</span>
					</h2>
					<button
						type="button"
						onClick={addMethod}
						className="inline-flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700"
					>
						<Plus className="h-4 w-4" />
						Add Method
					</button>
				</div>
				<p className="text-xs text-secondary-500 dark:text-secondary-400">
					Methods are evaluated in order. Each method checks or enforces one aspect of the desired configuration.
				</p>

				{methods.length === 0 ? (
					<p className="text-sm text-secondary-400 py-4 text-center">
						No methods. Click &ldquo;Add Method&rdquo; to get started.
					</p>
				) : (
					<div className="space-y-3">
						{methods.map((m, idx) => {
							const isExpanded = expandedMethod === idx;
							const methodType = METHOD_TYPES.find((t) => t.value === m.type);
							const args = getMethodArgs(m.type);

							return (
								<div
									key={m.id || idx}
									className="border border-secondary-200 dark:border-secondary-700 rounded-lg overflow-hidden"
								>
									{/* Method header */}
									<div
										className="flex items-center gap-2 px-4 py-3 bg-secondary-50 dark:bg-secondary-800 cursor-pointer"
										onClick={() => setExpandedMethod(isExpanded ? null : idx)}
										onKeyDown={(e) => e.key === "Enter" && setExpandedMethod(isExpanded ? null : idx)}
										role="button"
										tabIndex={0}
									>
										<GripVertical className="h-4 w-4 text-secondary-400 shrink-0" />
										<span className="text-xs font-mono text-secondary-500 w-6">
											#{idx + 1}
										</span>
										<span className="text-sm font-medium text-secondary-900 dark:text-white flex-1">
											{methodType?.label || m.type}
											{m.description && (
												<span className="text-secondary-400 font-normal ml-2">
													— {m.description}
												</span>
											)}
										</span>
										<div className="flex items-center gap-1">
											<button
												type="button"
												onClick={(e) => { e.stopPropagation(); moveMethod(idx, -1); }}
												disabled={idx === 0}
												className="p-1 rounded hover:bg-secondary-200 dark:hover:bg-secondary-700 disabled:opacity-30"
												title="Move up"
											>
												<ChevronUp className="h-3.5 w-3.5" />
											</button>
											<button
												type="button"
												onClick={(e) => { e.stopPropagation(); moveMethod(idx, 1); }}
												disabled={idx === methods.length - 1}
												className="p-1 rounded hover:bg-secondary-200 dark:hover:bg-secondary-700 disabled:opacity-30"
												title="Move down"
											>
												<ChevronDown className="h-3.5 w-3.5" />
											</button>
											<button
												type="button"
												onClick={(e) => { e.stopPropagation(); removeMethod(idx); }}
												className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30"
												title="Remove"
											>
												<Trash2 className="h-3.5 w-3.5 text-red-500" />
											</button>
										</div>
										{isExpanded ? (
											<ChevronUp className="h-4 w-4 text-secondary-400" />
										) : (
											<ChevronDown className="h-4 w-4 text-secondary-400" />
										)}
									</div>

									{/* Method body */}
									{isExpanded && (
										<div className="px-4 py-4 space-y-3 bg-white dark:bg-secondary-900">
											<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
												<div>
													<label className="block text-xs font-medium text-secondary-600 dark:text-secondary-400 mb-1">
														Method Type
													</label>
													<select
														value={m.type}
														onChange={(e) => updateMethod(idx, "type", e.target.value)}
														className="w-full px-2 py-1.5 rounded border border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-800 text-sm"
													>
														{METHOD_TYPES.map((t) => (
															<option key={t.value} value={t.value}>
																{t.label}
															</option>
														))}
													</select>
													{methodType?.description && (
														<p className="text-xs text-secondary-400 mt-1">
															{methodType.description}
														</p>
													)}
												</div>
												<div>
													<label className="block text-xs font-medium text-secondary-600 dark:text-secondary-400 mb-1">
														Description
													</label>
													<input
														type="text"
														value={m.description || ""}
														onChange={(e) => updateMethod(idx, "description", e.target.value)}
														placeholder="Brief description of this step"
														className="w-full px-2 py-1.5 rounded border border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-800 text-sm"
													/>
												</div>
											</div>

											{/* Method-specific arguments */}
											{args.length > 0 && (
												<div className="space-y-2">
													<p className="text-xs font-medium text-secondary-600 dark:text-secondary-400">
														Arguments
													</p>
													{args.map((arg) => (
														<div key={arg.key}>
															<label className="block text-xs text-secondary-500 mb-0.5">
																{arg.label}
																{arg.required && (
																	<span className="text-red-500 ml-0.5">*</span>
																)}
															</label>
															{arg.type === "textarea" ? (
																<textarea
																	value={m.args?.[arg.key] || ""}
																	onChange={(e) =>
																		updateMethodArg(idx, arg.key, e.target.value)
																	}
																	rows={3}
																	placeholder={arg.placeholder}
																	className="w-full px-2 py-1.5 rounded border border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-800 text-sm font-mono"
																/>
															) : arg.type === "checkbox" ? (
																<input
																	type="checkbox"
																	checked={m.args?.[arg.key] || false}
																	onChange={(e) =>
																		updateMethodArg(idx, arg.key, e.target.checked)
																	}
																	className="rounded border-secondary-300"
																/>
															) : (
																<input
																	type="text"
																	value={m.args?.[arg.key] || ""}
																	onChange={(e) =>
																		updateMethodArg(idx, arg.key, e.target.value)
																	}
																	placeholder={arg.placeholder}
																	className="w-full px-2 py-1.5 rounded border border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-800 text-sm"
																/>
															)}
														</div>
													))}
												</div>
											)}

											{/* Condition */}
											<div>
												<label className="block text-xs font-medium text-secondary-600 dark:text-secondary-400 mb-1">
													Condition (optional)
												</label>
												<input
													type="text"
													value={m.condition || ""}
													onChange={(e) => updateMethod(idx, "condition", e.target.value)}
													placeholder="e.g. method_1.status == compliant"
													className="w-full px-2 py-1.5 rounded border border-secondary-300 dark:border-secondary-600 bg-white dark:bg-secondary-800 text-sm font-mono"
												/>
												<p className="text-xs text-secondary-400 mt-0.5">
													Reference earlier methods by their alias: method_N.status == compliant|non_compliant|error
												</p>
											</div>
										</div>
									)}
								</div>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
}
