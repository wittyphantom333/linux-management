import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
	ArrowLeft,
	CheckCircle2,
	XCircle,
	AlertTriangle,
	Wrench,
	Eye,
	MinusCircle,
	Clock,
	SkipForward,
} from "lucide-react";
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
			return "Error";
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

	const { data: run, isLoading, error } = useQuery({
		queryKey: ["configmgmt", "run", id],
		queryFn: () => configManagementAPI.getRun(id).then((r) => r.data.run),
	});

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

	const directiveResults = run.directive_results || [];

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
						Policy Run: {run.hosts?.friendly_name || run.hosts?.hostname || "Unknown Host"}
					</h1>
					<p className="text-sm text-secondary-500 dark:text-secondary-400">
						{new Date(run.evaluated_at).toLocaleString()} ·{" "}
						{run.global_mode === "enforce" ? "Enforce" : "Audit"} mode
					</p>
				</div>
			</div>

			{/* Summary cards */}
			<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
				<SummaryCard label="Score" value={`${Math.round(run.score)}%`} color={scoreColor(run.score)} />
				<SummaryCard label="Total" value={run.total_directives} color="text-secondary-500" />
				<SummaryCard label="Compliant" value={run.compliant} color="text-green-500" />
				<SummaryCard label="Repaired" value={run.repaired} color="text-blue-500" />
				<SummaryCard label="Non-Compliant" value={run.non_compliant} color="text-red-500" />
				<SummaryCard label="Errors" value={run.errors} color="text-orange-500" />
			</div>

			{/* Directive results */}
			<div className="card p-5 space-y-4">
				<h2 className="text-lg font-medium text-secondary-900 dark:text-white">
					Directive Results
				</h2>

				{directiveResults.length === 0 ? (
					<p className="text-sm text-secondary-400">No directive details available for this run.</p>
				) : (
					<div className="space-y-4">
						{directiveResults.map((dr, idx) => (
							<div
								key={dr.directive_id || idx}
								className="border border-secondary-200 dark:border-secondary-700 rounded-lg overflow-hidden"
							>
								{/* Directive header */}
								<div className="flex items-center justify-between px-4 py-3 bg-secondary-50 dark:bg-secondary-800">
									<div className="flex items-center gap-2">
										{statusIcon(dr.status)}
										<span className="text-sm font-medium text-secondary-900 dark:text-white">
											{dr.directive_name || dr.directive_id}
										</span>
										{dr.mode && (
											<span className={`text-xs px-1.5 py-0.5 rounded-full ${
												dr.mode === "enforce"
													? "bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200"
													: "bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-200"
											}`}>
												{dr.mode === "enforce" ? "Enforce" : "Audit"}
											</span>
										)}
									</div>
									<span className={`text-sm font-medium ${
										dr.status === "compliant" ? "text-green-600" :
										dr.status === "repaired" ? "text-blue-600" :
										dr.status === "non_compliant" ? "text-red-600" :
										dr.status === "error" ? "text-orange-600" :
										dr.status === "skipped" ? "text-secondary-400 italic" :
										"text-secondary-400"
									}`}>
										{statusLabel(dr.status)}
									</span>
									{dr.status === "skipped" && dr.message && (
										<span className="text-xs text-secondary-400 italic ml-2">{dr.message}</span>
									)}
								</div>

								{/* Method results */}
								{dr.methods && dr.methods.length > 0 && (
									<div className="divide-y divide-secondary-100 dark:divide-secondary-700">
										{dr.methods.map((mr, mIdx) => (
											<div
												key={mr.method_id || mIdx}
												className="flex items-start gap-3 px-4 py-2.5"
											>
												{statusIcon(mr.status)}
												<div className="flex-1 min-w-0">
													<p className="text-sm text-secondary-900 dark:text-white">
														{mr.method_type || mr.method_id}
													</p>
													{mr.message && (
														<p className="text-xs text-secondary-500 dark:text-secondary-400 mt-0.5 truncate">
															{mr.message}
														</p>
													)}
												</div>
												<span
													className={`text-xs shrink-0 ${
														mr.status === "compliant" ? "text-green-600" :
														mr.status === "repaired" ? "text-blue-600" :
														mr.status === "non_compliant" ? "text-red-600" :
														mr.status === "error" ? "text-orange-600" :
														"text-secondary-400"
													}`}
												>
													{statusLabel(mr.status)}
												</span>
											</div>
										))}
									</div>
								)}
							</div>
						))}
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
