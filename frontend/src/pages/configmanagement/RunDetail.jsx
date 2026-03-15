import { useQuery } from "@tanstack/react-query";
import {
	Activity,
	AlertTriangle,
	ArrowLeft,
	Bug,
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	Clock,
	Eye,
	FileCode,
	FolderOpen,
	MinusCircle,
	Package,
	Settings,
	SkipForward,
	Terminal,
	User,
	Wrench,
	XCircle,
} from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { configManagementAPI } from "../../utils/configManagementApi";

function scoreColor(score) {
	if (score >= 90) return "text-green-500";
	if (score >= 70) return "text-yellow-500";
	if (score >= 50) return "text-orange-500";
	return "text-red-500";
}

function statusIcon(status) {
	switch (status) {
		case "compliant":
			return <CheckCircle2 className="h-4 w-4 text-green-500" />;
		case "repaired":
			return <Wrench className="h-4 w-4 text-blue-500" />;
		case "non_compliant":
			return <XCircle className="h-4 w-4 text-red-500" />;
		case "error":
			return <AlertTriangle className="h-4 w-4 text-orange-500" />;
		case "audited":
			return <Eye className="h-4 w-4 text-indigo-500" />;
		case "audit_compliant":
			return <Eye className="h-4 w-4 text-indigo-400" />;
		case "audit_non_compliant":
			return <Eye className="h-4 w-4 text-indigo-400" />;
		case "audit_error":
			return <AlertTriangle className="h-4 w-4 text-orange-500" />;
		case "not_applicable":
			return <MinusCircle className="h-4 w-4 text-secondary-400" />;
		case "skipped":
			return <SkipForward className="h-4 w-4 text-secondary-400" />;
		default:
			return <Clock className="h-4 w-4 text-secondary-400" />;
	}
}

function statusLabel(status) {
	switch (status) {
		case "compliant":
			return "Compliant";
		case "repaired":
			return "Repaired";
		case "non_compliant":
			return "Non-Compliant";
		case "error":
		case "audit_error":
			return "Error";
		case "audited":
			return "Audited";
		case "audit_compliant":
			return "State OK";
		case "audit_non_compliant":
			return "Drift Detected";
		case "not_applicable":
			return "N/A";
		case "skipped":
			return "Skipped";
		default:
			return status || "Unknown";
	}
}

export default function RunDetail() {
	const { id } = useParams();
	const [expandedDirectives, setExpandedDirectives] = useState(null);
	const [showRawJSON, setShowRawJSON] = useState(false);

	const {
		data: run,
		isLoading,
		error,
	} = useQuery({
		queryKey: ["configmgmt", "run", id],
		queryFn: () => configManagementAPI.getRun(id).then((r) => r.data.run),
	});

	// Auto-expand all directives on first load
	const directiveResults = run?.directive_results || [];
	const effectiveExpanded =
		expandedDirectives ??
		(() => {
			const initial = {};
			for (const dr of directiveResults) {
				initial[dr.directive_id] = true;
			}
			return initial;
		})();

	if (isLoading) {
		return (
			<div className="flex items-center justify-center h-64">
				<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500" />
			</div>
		);
	}

	if (error || !run) {
		return (
			<div className="p-4 bg-red-900/50 border border-red-700 rounded-lg">
				<p className="text-red-200">Failed to load run details</p>
			</div>
		);
	}

	return (
		<div className="space-y-6 max-w-4xl mx-auto">
			{/* Header */}
			<div className="flex items-center gap-3">
				<Link
					to="/config-management"
					className="p-2 rounded-lg hover:bg-secondary-100 dark:hover:bg-secondary-800"
				>
					<ArrowLeft className="h-5 w-5 text-secondary-500" />
				</Link>
				<div>
					<h1 className="text-xl font-semibold text-secondary-900 dark:text-white">
						Policy Run:{" "}
						{run.hosts?.friendly_name || run.hosts?.hostname || "Unknown Host"}
					</h1>
					<p className="text-sm text-secondary-500 dark:text-secondary-400">
						{new Date(run.evaluated_at).toLocaleString()} ·{" "}
						{run.global_mode === "enforce" ? "Enforce" : "Audit"} mode
					</p>
				</div>
			</div>

			{/* Summary cards */}
			<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
				<SummaryCard
					label="Score"
					value={`${Math.round(run.score)}%`}
					color={scoreColor(run.score)}
				/>
				<SummaryCard
					label="Total"
					value={run.total_directives}
					color="text-secondary-500"
				/>
				<SummaryCard
					label="Compliant"
					value={run.compliant}
					color="text-green-500"
				/>
				<SummaryCard
					label="Repaired"
					value={run.repaired}
					color="text-blue-500"
				/>
				<SummaryCard
					label="Non-Compliant"
					value={run.non_compliant}
					color="text-red-500"
				/>
				<SummaryCard
					label="Audited"
					value={run.audited || 0}
					color="text-indigo-500"
				/>
				<SummaryCard
					label="Errors"
					value={run.errors}
					color="text-orange-500"
				/>
			</div>

			{/* Directive results */}
			<div className="space-y-4">
				<h2 className="text-lg font-medium text-secondary-900 dark:text-white">
					Directive Results
				</h2>

				{/* Raw JSON debug toggle */}
				<button
					type="button"
					onClick={() => setShowRawJSON(!showRawJSON)}
					className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-secondary-100 dark:bg-secondary-800 text-secondary-600 dark:text-secondary-300 hover:bg-secondary-200 dark:hover:bg-secondary-700 transition-colors"
				>
					<Bug className="h-3 w-3" />
					{showRawJSON ? "Hide" : "Show"} Raw Data
				</button>

				{showRawJSON && (
					<div className="card p-4 overflow-auto max-h-96 border border-secondary-200 dark:border-secondary-700">
						<p className="text-xs text-secondary-400 mb-2">
							Raw directive_results JSON — {directiveResults.length}{" "}
							directive(s),{" "}
							{directiveResults.reduce(
								(sum, dr) => sum + (dr.methods?.length || 0),
								0,
							)}{" "}
							total method result(s)
						</p>
						<pre className="text-xs text-secondary-600 dark:text-secondary-300 font-mono whitespace-pre-wrap break-all">
							{JSON.stringify(directiveResults, null, 2)}
						</pre>
					</div>
				)}

				{directiveResults.length === 0 ? (
					<div className="card p-8 text-center">
						<MinusCircle className="h-10 w-10 text-secondary-300 dark:text-secondary-600 mx-auto mb-3" />
						<p className="text-sm text-secondary-400">
							No directive details available for this run.
						</p>
					</div>
				) : (
					<div className="space-y-4">
						{directiveResults.map((dr, idx) => {
							const isExpanded = effectiveExpanded[dr.directive_id || idx];
							const hasMethods = dr.methods && dr.methods.length > 0;
							const duration =
								dr.started_at && dr.completed_at
									? Math.round(
											((new Date(dr.completed_at) - new Date(dr.started_at)) /
												1000) *
												100,
										) / 100
									: null;

							return (
								<div
									key={dr.directive_id || idx}
									className="border border-secondary-200 dark:border-secondary-700 rounded-lg overflow-hidden"
								>
									{/* Directive header — clickable to expand/collapse */}
									<button
										type="button"
										onClick={() =>
											setExpandedDirectives({
												...effectiveExpanded,
												[dr.directive_id || idx]:
													!effectiveExpanded[dr.directive_id || idx],
											})
										}
										className="w-full flex items-center justify-between px-4 py-3 bg-secondary-50 dark:bg-secondary-800 hover:bg-secondary-100 dark:hover:bg-secondary-750 transition-colors text-left"
									>
										<div className="flex items-center gap-2.5 min-w-0">
											{hasMethods ? (
												isExpanded ? (
													<ChevronDown className="h-4 w-4 text-secondary-400 shrink-0" />
												) : (
													<ChevronRight className="h-4 w-4 text-secondary-400 shrink-0" />
												)
											) : (
												<span className="w-4" />
											)}
											{statusIcon(dr.status)}
											<span className="text-sm font-medium text-secondary-900 dark:text-white truncate">
												{dr.directive_name || dr.directive_id}
											</span>
											<span
												className={`text-xs px-1.5 py-0.5 rounded-full shrink-0 ${
													dr.policy_mode === "enforce"
														? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
														: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
												}`}
											>
												{dr.policy_mode === "enforce" ? "Enforce" : "Audit"}
											</span>
											{hasMethods && (
												<span className="text-xs text-secondary-400 shrink-0">
													{dr.methods.length} method
													{dr.methods.length !== 1 ? "s" : ""}
												</span>
											)}
										</div>
										<div className="flex items-center gap-3 shrink-0 ml-3">
											{duration !== null && (
												<span className="text-xs text-secondary-400">
													{duration < 1
														? `${Math.round(duration * 1000)}ms`
														: `${duration}s`}
												</span>
											)}
											<span
												className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusBadgeClass(dr.status)}`}
											>
												{statusLabel(dr.status)}
											</span>
										</div>
									</button>

									{/* Directive message (for skipped, etc.) */}
									{dr.message && (
										<div className="px-4 py-2 bg-secondary-50/50 dark:bg-secondary-800/50 border-t border-secondary-100 dark:border-secondary-700">
											<p className="text-xs text-secondary-500 dark:text-secondary-400 italic">
												{dr.message}
											</p>
										</div>
									)}

									{/* Expanded method results */}
									{isExpanded && hasMethods && (
										<div className="border-t border-secondary-200 dark:border-secondary-700">
											{dr.methods.map((mr, mIdx) => (
												<MethodResultCard
													key={mr.method_id || mIdx}
													mr={mr}
													index={mIdx}
													isLast={mIdx === dr.methods.length - 1}
												/>
											))}
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

function SummaryCard({ label, value, color }) {
	return (
		<div className="card p-3 text-center">
			<p className={`text-xl font-semibold ${color}`}>{value}</p>
			<p className="text-xs text-secondary-500 dark:text-secondary-400 mt-0.5">
				{label}
			</p>
		</div>
	);
}

// Returns background + text badge classes based on status
function statusBadgeClass(status) {
	switch (status) {
		case "compliant":
		case "success":
			return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
		case "repaired":
			return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
		case "non_compliant":
			return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
		case "error":
		case "audit_error":
			return "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400";
		case "audited":
			return "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400";
		case "audit_compliant":
			return "bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400";
		case "audit_non_compliant":
			return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
		case "skipped":
		case "not_applicable":
			return "bg-secondary-100 text-secondary-500 dark:bg-secondary-800 dark:text-secondary-400";
		default:
			return "bg-secondary-100 text-secondary-500 dark:bg-secondary-800 dark:text-secondary-400";
	}
}

// Returns an icon for the method type
function methodTypeIcon(type) {
	switch (type) {
		case "file_content":
		case "file_key_value":
			return <FileCode className="h-3.5 w-3.5" />;
		case "file_permissions":
			return <Settings className="h-3.5 w-3.5" />;
		case "package_present":
		case "package_absent":
			return <Package className="h-3.5 w-3.5" />;
		case "service_running":
		case "service_stopped":
		case "service_restart":
			return <Activity className="h-3.5 w-3.5" />;
		case "command_audit":
		case "command_exec":
		case "command_run":
			return <Terminal className="h-3.5 w-3.5" />;
		case "user_present":
		case "user_absent":
			return <User className="h-3.5 w-3.5" />;
		case "directory_present":
		case "directory_absent":
			return <FolderOpen className="h-3.5 w-3.5" />;
		case "file_absent":
		case "file_replace_lines":
			return <FileCode className="h-3.5 w-3.5" />;
		case "service_enabled":
		case "service_disabled":
			return <Activity className="h-3.5 w-3.5" />;
		case "sysctl_value":
			return <Settings className="h-3.5 w-3.5" />;
		default:
			return <Settings className="h-3.5 w-3.5" />;
	}
}

// Friendly label for method types
function methodTypeLabel(type) {
	const labels = {
		file_content: "File Content",
		file_key_value: "File Key/Value",
		file_permissions: "File Permissions",
		package_present: "Package Present",
		package_absent: "Package Absent",
		service_running: "Service Running",
		service_stopped: "Service Stopped",
		service_restart: "Service Restart",
		command_audit: "Command Audit",
		command_exec: "Command Execute",
		command_run: "Command Run",
		user_present: "User Present",
		user_absent: "User Absent",
		directory_present: "Directory Present",
		file_absent: "File Absent",
		directory_absent: "Directory Absent",
		service_enabled: "Service Enabled",
		service_disabled: "Service Disabled",
		file_replace_lines: "File Replace Lines",
		sysctl_value: "Sysctl Value",
	};
	return labels[type] || type;
}

// Method-level left border color based on status
function methodBorderClass(status) {
	switch (status) {
		case "success":
		case "compliant":
			return "border-l-green-500";
		case "repaired":
			return "border-l-blue-500";
		case "non_compliant":
			return "border-l-red-500";
		case "error":
		case "audit_error":
			return "border-l-orange-500";
		case "audit_compliant":
			return "border-l-indigo-300 dark:border-l-indigo-500";
		case "audit_non_compliant":
			return "border-l-amber-400 dark:border-l-amber-500";
		default:
			return "border-l-secondary-300 dark:border-l-secondary-600";
	}
}

// Full verbose method result card
function MethodResultCard({ mr, isLast }) {
	return (
		<div
			className={`border-l-4 ${methodBorderClass(mr.status)} ${!isLast ? "border-b border-secondary-100 dark:border-secondary-700" : ""}`}
		>
			<div className="px-4 py-3 space-y-2">
				{/* Method header row */}
				<div className="flex items-center justify-between gap-3">
					<div className="flex items-center gap-2 min-w-0">
						<span className="flex items-center justify-center h-5 w-5 rounded bg-secondary-100 dark:bg-secondary-700 text-secondary-500 dark:text-secondary-400 shrink-0">
							{methodTypeIcon(mr.method_type)}
						</span>
						<span className="text-sm font-medium text-secondary-900 dark:text-white">
							{mr.method_name || methodTypeLabel(mr.method_type)}
						</span>
						<span className="text-xs text-secondary-400 dark:text-secondary-500 font-mono">
							{methodTypeLabel(mr.method_type)}
						</span>
					</div>
					<div className="flex items-center gap-2 shrink-0">
						{statusIcon(mr.status)}
						<span
							className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusBadgeClass(mr.status)}`}
						>
							{statusLabel(mr.status)}
						</span>
					</div>
				</div>

				{/* Message */}
				{mr.message && (
					<p className="text-sm text-secondary-600 dark:text-secondary-300 pl-7">
						{mr.message}
					</p>
				)}

				{/* Actual vs Expected */}
				{(mr.actual || mr.expected) && (
					<div className="pl-7 grid grid-cols-1 sm:grid-cols-2 gap-2">
						{mr.expected && (
							<div className="rounded-md bg-secondary-50 dark:bg-secondary-900/50 border border-secondary-200 dark:border-secondary-700 px-3 py-2">
								<p className="text-[10px] font-semibold uppercase tracking-wider text-secondary-400 dark:text-secondary-500 mb-1">
									Expected
								</p>
								<pre className="text-xs text-secondary-700 dark:text-secondary-300 font-mono whitespace-pre-wrap break-all leading-relaxed">
									{mr.expected}
								</pre>
							</div>
						)}
						{mr.actual && (
							<div
								className={`rounded-md border px-3 py-2 ${
									mr.status === "audit_non_compliant" ||
									mr.status === "non_compliant"
										? "bg-red-50/50 dark:bg-red-900/10 border-red-200 dark:border-red-800"
										: mr.status === "audit_compliant" ||
												mr.status === "success" ||
												mr.status === "compliant"
											? "bg-green-50/50 dark:bg-green-900/10 border-green-200 dark:border-green-800"
											: "bg-secondary-50 dark:bg-secondary-900/50 border-secondary-200 dark:border-secondary-700"
								}`}
							>
								<p className="text-[10px] font-semibold uppercase tracking-wider text-secondary-400 dark:text-secondary-500 mb-1">
									Actual
								</p>
								<pre className="text-xs text-secondary-700 dark:text-secondary-300 font-mono whitespace-pre-wrap break-all leading-relaxed">
									{mr.actual}
								</pre>
							</div>
						)}
					</div>
				)}

				{/* Method ID (subtle, for debugging) */}
				{mr.method_id && (
					<p className="text-[10px] text-secondary-300 dark:text-secondary-600 pl-7 font-mono">
						ID: {mr.method_id}
					</p>
				)}
			</div>
		</div>
	);
}
