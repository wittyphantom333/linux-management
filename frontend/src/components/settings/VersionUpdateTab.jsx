import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	AlertCircle,
	CheckCircle,
	Clock,
	Code,
	Download,
	ExternalLink,
	RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { settingsAPI, versionAPI } from "../../utils/api";

const VersionUpdateTab = () => {
	const queryClient = useQueryClient();

	// Fetch current settings
	const { data: settings, isLoading: settingsLoading } = useQuery({
		queryKey: ["settings"],
		queryFn: () => settingsAPI.get().then((res) => res.data),
	});

	// GitHub repo URL editing state
	const [githubRepoUrl, setGithubRepoUrl] = useState("");
	const [savingRepoUrl, setSavingRepoUrl] = useState(false);

	useEffect(() => {
		if (settings?.github_repo_url) {
			setGithubRepoUrl(settings.github_repo_url);
		}
	}, [settings]);

	// Derive the GitHub repo base URL from the configured setting (for the
	// "Repository" link in Release Information).
	const repoBaseUrl = (() => {
		const raw = (githubRepoUrl || "").trim();
		if (!raw) return null;
		if (raw.startsWith("http")) {
			try {
				const parts = new URL(raw).pathname.split("/").filter(Boolean);
				if (parts.length >= 2) {
					return `https://github.com/${parts[0]}/${parts[1]}`;
				}
			} catch {
				return null;
			}
			return null;
		}
		const parts = raw.split("/").filter(Boolean);
		if (parts.length >= 2) {
			return `https://github.com/${parts[0]}/${parts[1]}`;
		}
		return null;
	})();

	const saveGithubRepoUrl = async () => {
		setSavingRepoUrl(true);
		try {
			await settingsAPI.update({ githubRepoUrl: githubRepoUrl });
		} catch (e) {
			console.error("Failed to save github repo URL:", e);
		} finally {
			setSavingRepoUrl(false);
		}
	};

	// Apply-update state
	const [applyState, setApplyState] = useState({
		active: false,
		jobId: null,
		status: null, // running | success | failed
		currentStep: null,
		log: "",
		error: null,
	});
	const pollRef = useRef(null);

	const stopPolling = useCallback(() => {
		if (pollRef.current) {
			clearInterval(pollRef.current);
			pollRef.current = null;
		}
	}, []);

	useEffect(() => {
		return () => stopPolling();
	}, [stopPolling]);

	const pollJob = useCallback(
		(jobId) => {
			pollRef.current = setInterval(async () => {
				try {
					const res = await versionAPI.getApplyUpdateStatus(jobId);
					const job = res.data;
					setApplyState({
						active: true,
						jobId,
						status: job.status,
						currentStep: job.currentStep,
						log: job.log,
						error: job.error,
					});
					if (job.status === "success" || job.status === "failed") {
						stopPolling();
						// Refresh settings + version after the deploy settles.
						queryClient.invalidateQueries(["settings"]);
					}
				} catch (err) {
					console.error("Failed to poll apply-update job:", err);
				}
			}, 2000);
		},
		[stopPolling, queryClient],
	);

	const startApplyUpdate = useCallback(async () => {
		const confirmed = window.confirm(
			"Apply the latest update now?\n\nThis pulls the latest code, rebuilds the frontend, and restarts the service. The UI will be briefly unavailable during the restart.",
		);
		if (!confirmed) return;
		setApplyState({
			active: true,
			jobId: null,
			status: "running",
			currentStep: "Starting…",
			log: "",
			error: null,
		});
		try {
			const res = await versionAPI.applyUpdate();
			const jobId = res.data.jobId;
			setApplyState((prev) => ({ ...prev, jobId }));
			pollJob(jobId);
		} catch (err) {
			setApplyState((prev) => ({
				...prev,
				status: "failed",
				currentStep: null,
				error: err.response?.data?.error || "Failed to start update",
			}));
		}
	}, [pollJob]);

	// Update settings mutation
	const updateSettingsMutation = useMutation({
		mutationFn: (data) => {
			return settingsAPI.update(data).then((res) => res.data);
		},
		onSuccess: () => {
			queryClient.invalidateQueries(["settings"]);
		},
		onError: (error) => {
			console.error("Failed to update settings:", error);
		},
	});

	// Version checking state
	const [versionInfo, setVersionInfo] = useState({
		currentVersion: null,
		latestVersion: null,
		isUpdateAvailable: false,
		checking: false,
		error: null,
		github: null,
	});

	// Version checking functions
	const checkForUpdates = useCallback(async () => {
		setVersionInfo((prev) => ({ ...prev, checking: true, error: null }));

		try {
			const response = await versionAPI.checkUpdates();
			const data = response.data;

			setVersionInfo({
				currentVersion: data.currentVersion,
				latestVersion: data.latestVersion,
				isUpdateAvailable: data.isUpdateAvailable,
				last_update_check: data.lastUpdateCheck || data.last_update_check,
				latestRelease: data.latestRelease,
				checking: false,
				error: null,
			});
		} catch (error) {
			console.error("Version check error:", error);
			setVersionInfo((prev) => ({
				...prev,
				checking: false,
				error: error.response?.data?.error || "Failed to check for updates",
			}));
		}
	}, []);

	// Load current version and automatically check for updates on component mount
	useEffect(() => {
		const loadAndCheckUpdates = async () => {
			try {
				// First, get current version info
				const response = await versionAPI.getCurrent();
				const data = response.data;
				setVersionInfo({
					currentVersion: data.version,
					latestVersion: data.latest_version || null,
					isUpdateAvailable: data.is_update_available || false,
					last_update_check: data.last_update_check || null,
					latestRelease: null,
					checking: false,
					error: null,
				});

				// Then automatically trigger a fresh update check
				await checkForUpdates();
			} catch (error) {
				console.error("Error loading version info:", error);
				setVersionInfo((prev) => ({
					...prev,
					error: "Failed to load version information",
				}));
			}
		};

		loadAndCheckUpdates();
	}, [checkForUpdates]); // Run when component mounts

	return (
		<div className="space-y-6">
			<div className="flex items-center mb-6">
				<Code className="h-6 w-6 text-primary-600 mr-3" />
				<h2 className="text-xl font-semibold text-secondary-900 dark:text-white">
					Server Version Information
				</h2>
			</div>

			<div className="bg-secondary-50 dark:bg-secondary-700 rounded-lg p-6">
				<h3 className="text-lg font-medium text-secondary-900 dark:text-white mb-4">
					Version Information
				</h3>
				<p className="text-sm text-secondary-600 dark:text-secondary-300 mb-6">
					Current server version and latest updates from GitHub repository.
					{versionInfo.checking && (
						<span className="ml-2 text-blue-600 dark:text-blue-400">
							🔄 Checking for updates...
						</span>
					)}
				</p>

				{/* Toggle for showing GitHub version on login */}
				<div className="bg-white dark:bg-secondary-800 rounded-lg p-4 border border-secondary-200 dark:border-secondary-600 mb-6">
					<div className="flex items-center justify-between">
						<div className="flex-1">
							<label
								htmlFor="show-github-version-toggle"
								className="text-sm font-medium text-secondary-900 dark:text-white cursor-pointer"
							>
								Show GitHub Version / Release Notes on Login Screen
							</label>
							<p className="text-xs text-secondary-500 dark:text-secondary-400 mt-1">
								When enabled, the login screen will display the latest GitHub
								release version and release notes information.
							</p>
						</div>
						<button
							type="button"
							id="show-github-version-toggle"
							onClick={() => {
								const newValue = !settings?.show_github_version_on_login;
								updateSettingsMutation.mutate({
									showGithubVersionOnLogin: newValue,
								});
							}}
							disabled={settingsLoading || updateSettingsMutation.isPending}
							className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${
								settings?.show_github_version_on_login !== false
									? "bg-primary-600"
									: "bg-secondary-300 dark:bg-secondary-600"
							} ${settingsLoading || updateSettingsMutation.isPending ? "opacity-50 cursor-not-allowed" : ""}`}
							role="switch"
							aria-checked={settings?.show_github_version_on_login !== false}
						>
							<span
								className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
									settings?.show_github_version_on_login !== false
										? "translate-x-5"
										: "translate-x-0"
								}`}
							/>
						</button>
					</div>
				</div>

				<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
					{/* My Version */}
					<div className="bg-white dark:bg-secondary-800 rounded-lg p-4 border border-secondary-200 dark:border-secondary-600">
						<div className="flex items-center gap-2 mb-2">
							<CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
							<span className="text-sm font-medium text-secondary-700 dark:text-secondary-300">
								My Version
							</span>
						</div>
						<span className="text-lg font-mono text-secondary-900 dark:text-white">
							{versionInfo.currentVersion}
						</span>
					</div>

					{/* Latest Release */}
					{versionInfo.latestRelease && (
						<div className="bg-white dark:bg-secondary-800 rounded-lg p-4 border border-secondary-200 dark:border-secondary-600">
							<div className="flex items-center gap-2 mb-2">
								<Download className="h-4 w-4 text-blue-600 dark:text-blue-400" />
								<span className="text-sm font-medium text-secondary-700 dark:text-secondary-300">
									Latest Release
								</span>
							</div>
							<div className="space-y-1">
								<span className="text-lg font-mono text-secondary-900 dark:text-white">
									{versionInfo.latestRelease.tagName}
								</span>
								{versionInfo.latestRelease.htmlUrl && (
									<div className="text-xs text-secondary-500 dark:text-secondary-400">
										<a
											href={versionInfo.latestRelease.htmlUrl}
											target="_blank"
											rel="noopener noreferrer"
											className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
										>
											View on GitHub{" "}
											<ExternalLink className="h-3 w-3 inline ml-1" />
										</a>
									</div>
								)}
							</div>
						</div>
					)}
				</div>

				{/* Release Information */}
				{versionInfo.latestRelease && (
					<div className="bg-white dark:bg-secondary-800 rounded-lg p-4 border border-secondary-200 dark:border-secondary-600 mt-4">
						<div className="flex items-center gap-2 mb-4">
							<Code className="h-4 w-4 text-purple-600 dark:text-purple-400" />
							<span className="text-sm font-medium text-secondary-700 dark:text-secondary-300">
								Release Information
							</span>
						</div>

						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							{/* Repository Link */}
							<div className="space-y-2">
								<span className="text-xs font-medium text-secondary-600 dark:text-secondary-400 uppercase tracking-wide">
									Repository
								</span>
								<div className="flex items-center gap-2">
									<a
										href={repoBaseUrl}
										target="_blank"
										rel="noopener noreferrer"
										className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 text-sm font-mono"
									>
										{(repoBaseUrl || "github.com").replace(
											"https://github.com/",
											"",
										)}{" "}
										<ExternalLink className="h-3 w-3 inline ml-1" />
									</a>
								</div>
							</div>

							{/* Latest Release Info */}
							{versionInfo.latestRelease.htmlUrl && (
								<div className="space-y-2">
									<span className="text-xs font-medium text-secondary-600 dark:text-secondary-400 uppercase tracking-wide">
										Release Link
									</span>
									<div className="flex items-center gap-2">
										<a
											href={versionInfo.latestRelease.htmlUrl}
											target="_blank"
											rel="noopener noreferrer"
											className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 text-sm"
										>
											View Release{" "}
											<ExternalLink className="h-3 w-3 inline ml-1" />
										</a>
									</div>
								</div>
							)}
						</div>
					</div>
				)}

				{/* Last Checked Time */}
				{versionInfo.last_update_check && (
					<div className="bg-white dark:bg-secondary-800 rounded-lg p-4 border border-secondary-200 dark:border-secondary-600 mt-4">
						<div className="flex items-center gap-2 mb-2">
							<Clock className="h-4 w-4 text-blue-600 dark:text-blue-400" />
							<span className="text-sm font-medium text-secondary-700 dark:text-secondary-300">
								Last Checked
							</span>
						</div>
						<span className="text-sm text-secondary-600 dark:text-secondary-400">
							{new Date(versionInfo.last_update_check).toLocaleString()}
						</span>
						<p className="text-xs text-secondary-500 dark:text-secondary-400 mt-1">
							Updates are checked automatically every 24 hours
						</p>
					</div>
				)}

				{/* GitHub Repo URL Configuration */}
				<div className="mt-6 bg-white dark:bg-secondary-800 rounded-lg p-4 border border-secondary-200 dark:border-secondary-600">
					<h3 className="text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-2">
						GitHub Repository URL
					</h3>
					<p className="text-xs text-secondary-500 dark:text-secondary-400 mb-3">
						The GitHub repo used for version checks and agent downloads. Enter
						any valid format: "owner/repo", full URL, or API URL.
					</p>
					<div className="flex gap-2 items-start">
						<input
							type="text"
							value={githubRepoUrl}
							onChange={(e) => setGithubRepoUrl(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") saveGithubRepoUrl();
							}}
							placeholder="https://github.com/owner/repo"
							className="flex-1 px-3 py-2 border border-secondary-300 dark:border-secondary-600 rounded-md bg-white dark:bg-secondary-700 text-sm text-secondary-900 dark:text-white placeholder-secondary-400 font-mono"
						/>
						<button
							type="button"
							onClick={saveGithubRepoUrl}
							disabled={savingRepoUrl || !githubRepoUrl.trim()}
							className="px-3 py-2 text-sm bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white rounded-md transition-colors whitespace-nowrap"
						>
							{savingRepoUrl ? "Saving…" : "Save"}
						</button>
					</div>
				</div>

				<div className="flex items-center gap-3 mt-6">
					<button
						type="button"
						onClick={checkForUpdates}
						disabled={versionInfo.checking || applyState.active}
						className="btn-primary flex items-center gap-2"
					>
						<Download className="h-4 w-4" />
						{versionInfo.checking ? "Checking..." : "Check for Updates"}
					</button>
					<button
						type="button"
						onClick={startApplyUpdate}
						disabled={applyState.active}
						className="btn-primary flex items-center gap-2 bg-green-600 hover:bg-green-700"
					>
						<CheckCircle className="h-4 w-4" />
						{applyState.active ? "Updating…" : "Apply Update"}
					</button>
				</div>

				{applyState.active && (
					<div className="mt-4 bg-white dark:bg-secondary-800 rounded-lg p-4 border border-secondary-200 dark:border-secondary-600">
						<div className="flex items-center gap-2 mb-2">
							{applyState.status === "success" ? (
								<CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
							) : applyState.status === "failed" ? (
								<AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
							) : (
								<RefreshCw className="h-4 w-4 text-blue-600 dark:text-blue-400 animate-spin" />
							)}
							<span className="text-sm font-medium text-secondary-700 dark:text-secondary-300">
								{applyState.status === "success"
									? "Update applied successfully"
									: applyState.status === "failed"
										? "Update failed"
										: `Applying update — ${applyState.currentStep || "starting"}`}
							</span>
						</div>
						{applyState.log && (
							<pre className="mt-2 text-xs font-mono whitespace-pre-wrap break-words text-secondary-600 dark:text-secondary-400 max-h-48 overflow-y-auto bg-secondary-50 dark:bg-secondary-700 rounded p-3">
								{applyState.log}
							</pre>
						)}
						{applyState.error && (
							<p className="mt-2 text-sm text-red-700 dark:text-red-300 whitespace-pre-wrap break-words">
								{applyState.error}
							</p>
						)}
					</div>
				)}

				{versionInfo.error && (
					<div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg p-4 mt-4">
						<div className="flex">
							<AlertCircle className="h-5 w-5 text-red-400 dark:text-red-300" />
							<div className="ml-3">
								<h3 className="text-sm font-medium text-red-800 dark:text-red-200">
									Version Check Failed
								</h3>
								<p className="mt-1 text-sm text-red-700 dark:text-red-300">
									{versionInfo.error}
								</p>
							</div>
						</div>
					</div>
				)}
			</div>
		</div>
	);
};

export default VersionUpdateTab;
