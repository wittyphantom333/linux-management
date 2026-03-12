import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	CheckCircle2,
	Loader2,
	Monitor,
	RefreshCw,
	ShieldCheck,
	Wifi,
	WifiOff,
	X,
	XCircle,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { complianceAPI } from "../utils/complianceApi";

export default function ActiveCompliancePanel({ open, onClose }) {
	const queryClient = useQueryClient();
	const panelRef = useRef(null);

	const { data, isLoading } = useQuery({
		queryKey: ["compliance", "active-scans"],
		queryFn: () => complianceAPI.getActiveScans().then((r) => r.data),
		enabled: open,
		refetchInterval: open ? 5000 : false,
	});

	const scans = data?.activeScans || [];

	const cancelMutation = useMutation({
		mutationFn: (hostId) => complianceAPI.cancelScan(hostId),
		onSuccess: () => {
			queryClient.invalidateQueries(["compliance", "active-scans"]);
			queryClient.invalidateQueries(["compliance-active-count"]);
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
						<ShieldCheck className="h-4 w-4 text-emerald-600" />
						Active Compliance Scans
						{scans.length > 0 && (
							<span className="ml-1 inline-flex items-center justify-center px-1.5 py-0.5 text-xs rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200">
								{scans.length}
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
							<Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
						</div>
					) : scans.length === 0 ? (
						<div className="text-center py-16 px-4">
							<CheckCircle2 className="h-8 w-8 text-green-400 mx-auto mb-3" />
							<p className="text-sm font-medium text-secondary-900 dark:text-white">
								No active scans
							</p>
							<p className="text-xs text-secondary-500 dark:text-secondary-400 mt-1">
								All compliance scans have completed
							</p>
						</div>
					) : (
						<div className="divide-y divide-secondary-200 dark:divide-secondary-700">
							{scans.map((scan) => (
								<div key={scan.id} className="px-4 py-3 space-y-2">
									{/* Scan header */}
									<div className="flex items-start justify-between gap-2">
										<div className="min-w-0 flex-1">
											<Link
												to={`/compliance/hosts/${scan.hostId}`}
												onClick={onClose}
												className="text-sm font-medium text-emerald-600 dark:text-emerald-400 hover:underline truncate block"
											>
												{scan.hostName || "Unknown Host"}
											</Link>
											<div className="flex items-center gap-2 mt-0.5">
												<span className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400">
													<RefreshCw className="h-3 w-3 animate-spin" />
													Scanning
												</span>
												<span className="text-xs text-secondary-400">·</span>
												<span className="text-xs text-secondary-500 dark:text-secondary-400">
													{formatTime(scan.startedAt)}
												</span>
											</div>
										</div>
										<button
											type="button"
											onClick={() => cancelMutation.mutate(scan.hostId)}
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
									</div>

									{/* Details */}
									<div className="flex flex-wrap items-center gap-3 text-xs text-secondary-500 dark:text-secondary-400">
										<span className="inline-flex items-center gap-1">
											<Monitor className="h-3 w-3" />
											{scan.profileName || "Unknown Profile"}
										</span>
										<span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-secondary-100 dark:bg-secondary-700 text-secondary-600 dark:text-secondary-300">
											{scan.profileType === "openscap"
												? "OpenSCAP"
												: scan.profileType === "docker-bench"
													? "Docker Bench"
													: scan.profileType || "—"}
										</span>
										<span
											className={`inline-flex items-center gap-1 ${scan.connected ? "text-green-500" : "text-red-400"}`}
										>
											{scan.connected ? (
												<Wifi className="h-3 w-3" />
											) : (
												<WifiOff className="h-3 w-3" />
											)}
											{scan.connected ? "Connected" : "Disconnected"}
										</span>
									</div>

									{/* Animated progress indicator */}
									<div className="h-1.5 bg-secondary-100 dark:bg-secondary-700 rounded-full overflow-hidden">
										<div className="h-full bg-emerald-500 rounded-full animate-pulse w-full" />
									</div>
								</div>
							))}
						</div>
					)}
				</div>

				{/* Footer */}
				<div className="border-t border-secondary-200 dark:border-secondary-700 px-4 py-2.5">
					<Link
						to="/compliance"
						onClick={onClose}
						className="text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300"
					>
						View all compliance →
					</Link>
				</div>
			</div>
		</>
	);
}
