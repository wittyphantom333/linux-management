import { useQuery } from "@tanstack/react-query";
import {
	AlertTriangle,
	CheckCircle2,
	Clock,
	Loader2,
	RefreshCw,
	Server,
	Settings2,
	X,
	XCircle,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { configManagementAPI } from "../utils/configManagementApi";

const HOST_STATUS_CONFIG = {
	pending: { icon: Clock, color: "text-yellow-500", label: "Pending" },
	running: { icon: RefreshCw, color: "text-blue-500", label: "Running" },
	completed: {
		icon: CheckCircle2,
		color: "text-green-500",
		label: "Completed",
	},
	failed: { icon: XCircle, color: "text-red-500", label: "Failed" },
};

export default function ActiveCMJobsPanel({ open, onClose }) {
	const panelRef = useRef(null);

	const { data, isLoading } = useQuery({
		queryKey: ["configmgmt", "active-jobs"],
		queryFn: () => configManagementAPI.getActiveJobs().then((r) => r.data),
		enabled: open,
		refetchInterval: open ? 5000 : false,
	});

	const jobs = data?.jobs || [];

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

	function getProgressPercent(job) {
		if (!job.total_hosts || job.total_hosts === 0) return 0;
		const done = (job.completed_hosts || 0) + (job.failed_hosts || 0);
		return Math.round((done / job.total_hosts) * 100);
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
						<Settings2 className="h-4 w-4 text-primary-600" />
						Active Config Jobs
						{jobs.length > 0 && (
							<span className="ml-1 inline-flex items-center justify-center px-1.5 py-0.5 text-xs rounded-full bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-200">
								{jobs.length}
							</span>
						)}
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
							<Loader2 className="h-6 w-6 animate-spin text-primary-600" />
						</div>
					) : jobs.length === 0 ? (
						<div className="text-center py-16 px-4">
							<CheckCircle2 className="h-8 w-8 text-green-400 mx-auto mb-3" />
							<p className="text-sm font-medium text-secondary-900 dark:text-white">
								No active jobs
							</p>
							<p className="text-xs text-secondary-500 dark:text-secondary-400 mt-1">
								All config management jobs have completed
							</p>
						</div>
					) : (
						<div className="divide-y divide-secondary-200 dark:divide-secondary-700">
							{jobs.map((job) => {
								const progress = getProgressPercent(job);
								const isRunning = job.status === "running";
								const hs = job.host_statuses || {};

								return (
									<div key={job.id} className="px-4 py-3 space-y-2.5">
										{/* Job header */}
										<div className="flex items-start justify-between gap-2">
											<div className="min-w-0 flex-1">
												<Link
													to={`/config-management/jobs/${job.id}`}
													onClick={onClose}
													className="text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline truncate block"
												>
													{job.rule_name || "Unknown Rule"}
												</Link>
												<div className="flex items-center gap-2 mt-0.5">
													<span
														className={`inline-flex items-center gap-1 text-xs font-medium ${
															isRunning
																? "text-blue-600 dark:text-blue-400"
																: "text-yellow-600 dark:text-yellow-400"
														}`}
													>
														{isRunning ? (
															<RefreshCw className="h-3 w-3 animate-spin" />
														) : (
															<Clock className="h-3 w-3" />
														)}
														{isRunning ? "Running" : "Pending"}
													</span>
													<span className="text-xs text-secondary-400">
														·
													</span>
													<span className="text-xs text-secondary-500 dark:text-secondary-400">
														{formatTime(job.created_at)}
													</span>
													{job.triggered_by_user && (
														<span className="text-xs bg-secondary-100 dark:bg-secondary-700 text-secondary-500 dark:text-secondary-400 px-1 py-0.5 rounded">
															{job.triggered_by_user}
														</span>
													)}
												</div>
											</div>
										</div>

										{/* Progress bar */}
										<div className="space-y-1">
											<div className="flex items-center justify-between text-xs text-secondary-500 dark:text-secondary-400">
												<span className="flex items-center gap-1">
													<Server className="h-3 w-3" />
													{job.total_hosts}{" "}
													{job.total_hosts === 1 ? "host" : "hosts"}
												</span>
												<span>{progress}%</span>
											</div>
											<div className="h-1.5 bg-secondary-100 dark:bg-secondary-700 rounded-full overflow-hidden">
												<div
													className={`h-full rounded-full transition-all duration-500 ${
														job.failed_hosts > 0
															? "bg-red-500"
															: isRunning
																? "bg-blue-500"
																: "bg-yellow-400"
													}`}
													style={{ width: `${progress}%` }}
												/>
											</div>
										</div>

										{/* Host status breakdown */}
										<div className="flex flex-wrap gap-x-3 gap-y-1">
											{Object.entries(hs)
												.filter(([, count]) => count > 0)
												.map(([status, count]) => {
													const cfg = HOST_STATUS_CONFIG[status];
													if (!cfg) return null;
													const Icon = cfg.icon;
													return (
														<span
															key={status}
															className={`inline-flex items-center gap-1 text-xs ${cfg.color}`}
														>
															<Icon className="h-3 w-3" />
															{count} {cfg.label.toLowerCase()}
														</span>
													);
												})}
										</div>
									</div>
								);
							})}
						</div>
					)}
				</div>

				{/* Footer */}
				<div className="border-t border-secondary-200 dark:border-secondary-700 px-4 py-2.5">
					<Link
						to="/config-management"
						onClick={onClose}
						className="text-xs font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300"
					>
						View all jobs →
					</Link>
				</div>
			</div>
		</>
	);
}
