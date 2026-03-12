import { useQuery } from "@tanstack/react-query";
import {
	AlertTriangle,
	CheckCircle2,
	Loader2,
	Settings2,
	Shield,
	ShieldAlert,
	Wrench,
	X,
	XCircle,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { configManagementAPI } from "../utils/configManagementApi";

export default function ActiveConfigRunsPanel({ open, onClose }) {
	const panelRef = useRef(null);

	const { data, isLoading } = useQuery({
		queryKey: ["configmgmt", "recent-runs"],
		queryFn: () => configManagementAPI.getRecentRuns().then((r) => r.data),
		enabled: open,
		refetchInterval: open ? 10000 : false,
	});

	const runs = data?.runs || [];

	// Close on Escape key
	useEffect(() => {
		if (!open) return;
		const handler = (e) => {
			if (e.key === "Escape") onClose();
		};
		document.addEventListener("keydown", handler);
		return () => document.removeEventListener("keydown", handler);
	}, [open, onClose]);

	// Close on click outside
	useEffect(() => {
		if (!open) return;
		const handler = (e) => {
			if (panelRef.current && !panelRef.current.contains(e.target)) {
				onClose();
			}
		};
		const timer = setTimeout(
			() => document.addEventListener("mousedown", handler),
			100,
		);
		return () => {
			clearTimeout(timer);
			document.removeEventListener("mousedown", handler);
		};
	}, [open, onClose]);

	if (!open) return null;

	function formatTime(dateStr) {
		if (!dateStr) return "—";
		const d = new Date(dateStr);
		const now = new Date();
		const diffMs = now - d;
		const diffMin = Math.floor(diffMs / 60000);
		if (diffMin < 1) return "just now";
		if (diffMin < 60) return `${diffMin}m ago`;
		const diffHr = Math.floor(diffMin / 60);
		if (diffHr < 24) return `${diffHr}h ago`;
		return d.toLocaleDateString();
	}

	function getScoreColor(score) {
		if (score >= 90) return "text-green-600 dark:text-green-400";
		if (score >= 70) return "text-yellow-600 dark:text-yellow-400";
		if (score >= 50) return "text-orange-600 dark:text-orange-400";
		return "text-red-600 dark:text-red-400";
	}

	function getScoreBarColor(score) {
		if (score >= 90) return "bg-green-500";
		if (score >= 70) return "bg-yellow-500";
		if (score >= 50) return "bg-orange-500";
		return "bg-red-500";
	}

	return (
		<>
			{/* Backdrop */}
			<div className="fixed inset-0 z-40 bg-black/30 transition-opacity" />

			{/* Panel */}
			<div
				ref={panelRef}
				className="fixed right-0 top-0 z-50 h-full w-full max-w-md bg-white dark:bg-secondary-800 shadow-2xl border-l border-secondary-200 dark:border-secondary-700 flex flex-col overflow-hidden"
			>
				{/* Header */}
				<div className="flex items-center justify-between px-4 py-3 border-b border-secondary-200 dark:border-secondary-700">
					<h2 className="text-sm font-semibold text-secondary-900 dark:text-white flex items-center gap-2">
						<Settings2 className="h-4 w-4 text-violet-600" />
						Recent Config Runs
						{runs.length > 0 && (
							<span className="ml-1 inline-flex items-center justify-center px-1.5 py-0.5 text-xs rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-200">
								{runs.length}
							</span>
						)}
						<span className="text-xs font-normal text-secondary-400">
							last hour
						</span>
					</h2>
					<button
						type="button"
						onClick={onClose}
						className="text-secondary-400 hover:text-secondary-600 dark:hover:text-secondary-300 transition-colors"
					>
						<X className="h-5 w-5" />
					</button>
				</div>

				{/* Content */}
				<div className="flex-1 overflow-y-auto">
					{isLoading ? (
						<div className="flex items-center justify-center py-16">
							<Loader2 className="h-6 w-6 animate-spin text-violet-600" />
						</div>
					) : runs.length === 0 ? (
						<div className="text-center py-16 px-4">
							<CheckCircle2 className="h-8 w-8 text-secondary-300 dark:text-secondary-600 mx-auto mb-3" />
							<p className="text-sm font-medium text-secondary-900 dark:text-white">
								No recent runs
							</p>
							<p className="text-xs text-secondary-500 dark:text-secondary-400 mt-1">
								No config management runs in the last hour
							</p>
						</div>
					) : (
						<div className="divide-y divide-secondary-200 dark:divide-secondary-700">
							{runs.map((run) => (
								<div key={run.id} className="px-4 py-3 space-y-2">
									{/* Run header */}
									<div className="flex items-start justify-between gap-2">
										<div className="min-w-0 flex-1">
											<Link
												to={`/config-management/runs/${run.id}`}
												onClick={onClose}
												className="text-sm font-medium text-violet-600 dark:text-violet-400 hover:underline truncate block"
											>
												{run.hostName}
											</Link>
											<div className="flex items-center gap-2 mt-0.5">
												<span
													className={`text-xs font-semibold ${getScoreColor(run.score)}`}
												>
													{Math.round(run.score)}%
												</span>
												<span className="text-xs text-secondary-400">·</span>
												<span className="text-xs text-secondary-500 dark:text-secondary-400">
													{formatTime(run.evaluatedAt)}
												</span>
												<span
													className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded font-medium ${
														run.globalMode === "enforce"
															? "bg-orange-100 dark:bg-orange-900 text-orange-600 dark:text-orange-300"
															: "bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300"
													}`}
												>
													{run.globalMode === "enforce" ? (
														<Shield className="h-3 w-3" />
													) : (
														<ShieldAlert className="h-3 w-3" />
													)}
													{run.globalMode}
												</span>
											</div>
										</div>
									</div>

									{/* Score bar */}
									<div className="space-y-1">
										<div className="h-1.5 bg-secondary-100 dark:bg-secondary-700 rounded-full overflow-hidden">
											<div
												className={`h-full rounded-full transition-all duration-500 ${getScoreBarColor(run.score)}`}
												style={{ width: `${run.score}%` }}
											/>
										</div>
									</div>

									{/* Directive breakdown */}
									<div className="flex flex-wrap gap-x-3 gap-y-1">
										{run.compliant > 0 && (
											<span className="inline-flex items-center gap-1 text-xs text-green-500">
												<CheckCircle2 className="h-3 w-3" />
												{run.compliant} compliant
											</span>
										)}
										{run.nonCompliant > 0 && (
											<span className="inline-flex items-center gap-1 text-xs text-red-500">
												<XCircle className="h-3 w-3" />
												{run.nonCompliant} non-compliant
											</span>
										)}
										{run.repaired > 0 && (
											<span className="inline-flex items-center gap-1 text-xs text-blue-500">
												<Wrench className="h-3 w-3" />
												{run.repaired} repaired
											</span>
										)}
										{run.errors > 0 && (
											<span className="inline-flex items-center gap-1 text-xs text-orange-500">
												<AlertTriangle className="h-3 w-3" />
												{run.errors} errors
											</span>
										)}
										<span className="inline-flex items-center gap-1 text-xs text-secondary-400">
											{run.totalDirectives} directives
										</span>
									</div>
								</div>
							))}
						</div>
					)}
				</div>

				{/* Footer */}
				<div className="border-t border-secondary-200 dark:border-secondary-700 px-4 py-2.5">
					<Link
						to="/config-management"
						onClick={onClose}
						className="text-xs font-medium text-violet-600 dark:text-violet-400 hover:text-violet-700 dark:hover:text-violet-300"
					>
						View all config management →
					</Link>
				</div>
			</div>
		</>
	);
}
