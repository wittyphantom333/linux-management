import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	AlertTriangle,
	ArrowUpDown,
	CheckCircle2,
	Clock,
	Loader2,
	Package,
	Play,
	RefreshCw,
	RotateCcw,
	Server,
	X,
	XCircle,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { patchManagementAPI } from "../utils/patchManagementApi";
import { useAuth } from "../contexts/AuthContext";

const HOST_STATUS_CONFIG = {
	pending: { icon: Clock, color: "text-yellow-500", label: "Pending" },
	downloading: {
		icon: ArrowUpDown,
		color: "text-indigo-500",
		label: "Downloading",
	},
	installing: { icon: Package, color: "text-violet-500", label: "Installing" },
	rebooting: { icon: RotateCcw, color: "text-orange-500", label: "Rebooting" },
	completed: {
		icon: CheckCircle2,
		color: "text-green-500",
		label: "Completed",
	},
	failed: { icon: XCircle, color: "text-red-500", label: "Failed" },
	skipped: { icon: X, color: "text-secondary-400", label: "Skipped" },
};

export default function ActiveJobsPanel({ open, onClose }) {
	const queryClient = useQueryClient();
	const { canManagePatchManagement } = useAuth();
	const panelRef = useRef(null);

	const { data, isLoading } = useQuery({
		queryKey: ["patchmgmt", "active-jobs"],
		queryFn: () => patchManagementAPI.getActiveJobs().then((r) => r.data),
		enabled: open,
		refetchInterval: open ? 5000 : false,
	});

	const jobs = data?.jobs || [];

	const cancelMutation = useMutation({
		mutationFn: (jobId) => patchManagementAPI.cancelJob(jobId),
		onSuccess: () => {
			queryClient.invalidateQueries(["patchmgmt", "active-jobs"]);
			queryClient.invalidateQueries(["patchmgmt-active-count"]);
		},
	});

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
		// Delay to prevent the click that opened the panel from immediately closing it
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
		const done =
			(job.completed_hosts || 0) +
			(job.failed_hosts || 0) +
			(job.skipped_hosts || 0);
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
						<Play className="h-4 w-4 text-primary-600" />
						Active Patch Jobs
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
								All patch jobs have completed
							</p>
						</div>
					) : (
						<div className="divide-y divide-secondary-200 dark:divide-secondary-700">
							{jobs.map((job) => {
								const progress = getProgressPercent(job);
								const isRunning = job.status === "running";
								const isPending = job.status === "pending";
								const hs = job.host_statuses || {};

								return (
									<div key={job.id} className="px-4 py-3 space-y-2.5">
										{/* Job header */}
										<div className="flex items-start justify-between gap-2">
											<div className="min-w-0 flex-1">
												<Link
													to={`/patch-management?tab=jobs&job=${job.id}`}
													onClick={onClose}
													className="text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline truncate block"
												>
													{job.policy?.name || "Unknown Policy"}
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
													{job.triggered_by === "manual" && (
														<span className="text-xs bg-secondary-100 dark:bg-secondary-700 text-secondary-500 dark:text-secondary-400 px-1 py-0.5 rounded">
															manual
														</span>
													)}
												</div>
											</div>
											{canManagePatchManagement && (
												<button
													type="button"
													onClick={() => cancelMutation.mutate(job.id)}
													disabled={cancelMutation.isPending}
													className="shrink-0 flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-50 transition-colors"
												>
													{cancelMutation.isPending ? (
														<Loader2 className="h-3 w-3 animate-spin" />
													) : (
														<XCircle className="h-3 w-3" />
													)}
													Cancel
												</button>
											)}
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
						to="/patch-management?tab=jobs"
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
