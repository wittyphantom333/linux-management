import { useQuery } from "@tanstack/react-query";
import {
	AlertTriangle,
	ArrowLeft,
	CheckCircle2,
	Clock,
	Loader2,
	Network,
	RefreshCw,
	Server,
	User,
	XCircle,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { configManagementAPI } from "../../utils/configManagementApi";

const STATUS_STYLES = {
	pending:
		"bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
	running: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
	completed:
		"bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
	completed_with_errors:
		"bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
	failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

const STATUS_ICONS = {
	pending: Clock,
	running: RefreshCw,
	completed: CheckCircle2,
	completed_with_errors: AlertTriangle,
	failed: XCircle,
};

function statusBadge(status) {
	const style = STATUS_STYLES[status] || STATUS_STYLES.pending;
	const Icon = STATUS_ICONS[status] || Clock;
	const label = (status || "pending")
		.replace(/_/g, " ")
		.replace(/\b\w/g, (c) => c.toUpperCase());
	return (
		<span
			className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${style}`}
		>
			<Icon
				className={`h-3.5 w-3.5 ${status === "running" ? "animate-spin" : ""}`}
			/>
			{label}
		</span>
	);
}

function timeAgo(dateStr) {
	if (!dateStr) return "—";
	const diff = Date.now() - new Date(dateStr).getTime();
	const mins = Math.floor(diff / 60000);
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins}m ago`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}

function formatDate(dateStr) {
	if (!dateStr) return "—";
	return new Date(dateStr).toLocaleString();
}

export default function JobDetail() {
	const { id } = useParams();

	const { data: jobData, isLoading } = useQuery({
		queryKey: ["configmgmt", "job", id],
		queryFn: () => configManagementAPI.getJob(id).then((r) => r.data),
		refetchInterval: (data) => {
			const status = data?.state?.data?.job?.status;
			return status === "running" || status === "pending" ? 5000 : false;
		},
	});

	const job = jobData?.job;
	const jobHosts = job?.cm_job_hosts || [];

	if (isLoading) {
		return (
			<div className="flex items-center justify-center h-64">
				<Loader2 className="h-8 w-8 animate-spin text-primary-500" />
			</div>
		);
	}

	if (!job) {
		return (
			<div className="p-4 bg-red-900/50 border border-red-700 rounded-lg text-red-200">
				Job not found
			</div>
		);
	}

	const done = job.completed_hosts + job.failed_hosts;
	const pct =
		job.total_hosts > 0 ? Math.round((done / job.total_hosts) * 100) : 100;

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex items-center gap-4">
				<Link
					to="/config-management"
					className="p-2 rounded-lg hover:bg-secondary-100 dark:hover:bg-secondary-800 transition-colors"
				>
					<ArrowLeft className="h-5 w-5 text-secondary-400" />
				</Link>
				<div className="flex-1">
					<h1 className="text-2xl font-semibold text-secondary-900 dark:text-white">
						Config Management Job
					</h1>
					<p className="text-sm text-secondary-500 dark:text-secondary-400 mt-0.5">
						{job.rule_name || "Unknown Rule"} — triggered{" "}
						{timeAgo(job.created_at)}
					</p>
				</div>
				{statusBadge(job.status)}
			</div>

			{/* Summary cards */}
			<div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
				<div className="card p-4">
					<div className="flex items-center gap-2 text-sm text-secondary-500 dark:text-secondary-400 mb-1">
						<Network className="h-4 w-4" />
						Rule
					</div>
					<p className="text-lg font-semibold text-secondary-900 dark:text-white truncate">
						{job.rule_name || "Unknown"}
					</p>
				</div>

				<div className="card p-4">
					<div className="flex items-center gap-2 text-sm text-secondary-500 dark:text-secondary-400 mb-1">
						<Server className="h-4 w-4" />
						Progress
					</div>
					<div className="flex items-center gap-2">
						<span className="text-lg font-semibold text-secondary-900 dark:text-white">
							{done}/{job.total_hosts}
						</span>
						<span className="text-xs text-secondary-400">({pct}%)</span>
					</div>
					<div className="h-1.5 bg-secondary-200 dark:bg-secondary-700 rounded-full overflow-hidden mt-2">
						<div
							className={`h-full rounded-full transition-all duration-500 ${
								job.failed_hosts > 0 ? "bg-orange-500" : "bg-green-500"
							}`}
							style={{ width: `${pct}%` }}
						/>
					</div>
				</div>

				<div className="card p-4">
					<div className="flex items-center gap-2 text-sm text-secondary-500 dark:text-secondary-400 mb-1">
						<User className="h-4 w-4" />
						Triggered By
					</div>
					<p className="text-lg font-semibold text-secondary-900 dark:text-white capitalize">
						{job.triggered_by}
					</p>
					{job.triggered_by_user && (
						<p className="text-xs text-secondary-400 mt-0.5">
							{job.triggered_by_user}
						</p>
					)}
				</div>

				<div className="card p-4">
					<div className="flex items-center gap-2 text-sm text-secondary-500 dark:text-secondary-400 mb-1">
						<Clock className="h-4 w-4" />
						Timing
					</div>
					<p className="text-sm text-secondary-900 dark:text-white">
						Started: {formatDate(job.started_at)}
					</p>
					{job.completed_at && (
						<p className="text-xs text-secondary-400 mt-0.5">
							Completed: {formatDate(job.completed_at)}
						</p>
					)}
				</div>
			</div>

			{/* Host list */}
			<div className="card overflow-hidden">
				<div className="px-4 py-3 bg-secondary-50 dark:bg-secondary-800 border-b border-secondary-200 dark:border-secondary-700">
					<h2 className="text-sm font-semibold text-secondary-700 dark:text-secondary-300">
						Hosts ({jobHosts.length})
					</h2>
				</div>
				{jobHosts.length === 0 ? (
					<div className="p-8 text-center text-sm text-secondary-500 dark:text-secondary-400">
						No hosts in this job
					</div>
				) : (
					<table className="min-w-full divide-y divide-secondary-200 dark:divide-secondary-700">
						<thead className="bg-secondary-50 dark:bg-secondary-800">
							<tr>
								<th className="px-4 py-3 text-left text-xs font-medium text-secondary-500 dark:text-secondary-400 uppercase tracking-wider">
									Host
								</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-secondary-500 dark:text-secondary-400 uppercase tracking-wider">
									Status
								</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-secondary-500 dark:text-secondary-400 uppercase tracking-wider">
									Completed At
								</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-secondary-500 dark:text-secondary-400 uppercase tracking-wider">
									Run
								</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-secondary-200 dark:divide-secondary-700">
							{jobHosts.map((jh) => (
								<tr
									key={jh.id}
									className="hover:bg-secondary-50 dark:hover:bg-secondary-800/50 transition-colors"
								>
									<td className="px-4 py-3 text-sm font-medium text-secondary-900 dark:text-secondary-100">
										<Link
											to={`/hosts/${jh.host?.id}`}
											className="hover:text-primary-500 transition-colors"
										>
											{jh.host?.friendly_name ||
												jh.host?.hostname ||
												jh.host_id}
										</Link>
									</td>
									<td className="px-4 py-3 text-sm">
										{statusBadge(jh.status)}
									</td>
									<td className="px-4 py-3 text-sm text-secondary-500 dark:text-secondary-400">
										{jh.completed_at ? formatDate(jh.completed_at) : "—"}
									</td>
									<td className="px-4 py-3 text-sm">
										{jh.run_id ? (
											<Link
												to={`/config-management/runs/${jh.run_id}`}
												className="text-primary-500 hover:underline text-xs"
											>
												View Run
											</Link>
										) : (
											<span className="text-xs text-secondary-400">
												{jh.status === "pending" ? "Waiting…" : "—"}
											</span>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</div>
		</div>
	);
}
