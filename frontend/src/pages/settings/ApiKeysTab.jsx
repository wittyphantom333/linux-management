import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	AlertCircle,
	CheckCircle,
	Copy,
	Key,
	Plus,
	Trash2,
	X,
} from "lucide-react";
import { useState } from "react";
import { apiKeysAPI } from "../../utils/api";

const ApiKeysTab = () => {
	const queryClient = useQueryClient();
	const [createdKey, setCreatedKey] = useState(null);
	const [createError, setCreateError] = useState(null);
	const [copiedId, setCopiedId] = useState(null);

	const { data: keys = [], isLoading } = useQuery({
		queryKey: ["api-keys"],
		queryFn: () => apiKeysAPI.list().then((r) => r.data.keys || []),
	});

	const createMutation = useMutation({
		mutationFn: () => apiKeysAPI.create("API").then((r) => r.data),
		onSuccess: (data) => {
			queryClient.invalidateQueries(["api-keys"]);
			setCreatedKey(data.apiKey || data.key || "");
			setCreateError(null);
		},
		onError: (err) => {
			setCreateError(
				err?.response?.data?.error || err.message || "Failed to create key",
			);
		},
	});

	const revokeMutation = useMutation({
		mutationFn: (id) => apiKeysAPI.revoke(id).then((r) => r.data),
		onSuccess: () => queryClient.invalidateQueries(["api-keys"]),
	});

	const copyToClipboard = async (text, id) => {
		try {
			await navigator.clipboard.writeText(text);
			setCopiedId(id);
			setTimeout(() => setCopiedId(null), 2000);
		} catch {}
	};

	return (
		<div className="space-y-6">
			{/* Header */}
			<div>
				<h3 className="text-lg font-medium text-secondary-900 dark:text-white mb-1">
					API Keys
				</h3>
				<p className="text-sm text-secondary-600 dark:text-secondary-300">
					Create and manage API keys for MCP server integration. Keys are shown
					once — copy them immediately.
				</p>
			</div>

			{/* Create button */}
			<button
				type="button"
				onClick={() => createMutation.mutate()}
				disabled={createMutation.isPending}
				className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white rounded-md text-sm font-medium transition-colors"
			>
				<Plus className="h-4 w-4" />
				{createMutation.isPending ? "Creating…" : "Create API Key"}
			</button>

			{createError && (
				<div className="bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-700 rounded-md p-3 flex items-center gap-2">
					<AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 flex-shrink-0" />
					<p className="text-sm text-red-800 dark:text-red-200">
						{createError}
					</p>
				</div>
			)}

			{/* Created key banner */}
			{createdKey && (
				<div className="bg-green-50 dark:bg-green-900/20 border border-green-300 dark:border-green-700 rounded-lg p-4">
					<div className="flex items-start gap-3">
						<CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5" />
						<div className="flex-1 min-w-0">
							<p className="text-sm font-medium text-green-800 dark:text-green-200 mb-2">
								Key created successfully — copy it now! It will not be shown
								again.
							</p>
							<div className="flex items-center gap-2">
								<code className="flex-1 bg-white dark:bg-secondary-800 border border-green-200 dark:border-green-800 rounded px-3 py-2 text-sm font-mono text-secondary-900 dark:text-secondary-100 break-all">
									{createdKey}
								</code>
								<button
									type="button"
									onClick={() => copyToClipboard(createdKey, "new")}
									className="flex-shrink-0 p-2 text-green-600 hover:text-green-800 dark:text-green-400 dark:hover:text-green-300 border border-green-200 dark:border-green-700 rounded-md bg-white dark:bg-secondary-800"
								>
									{copiedId === "new" ? (
										<CheckCircle className="h-4 w-4" />
									) : (
										<Copy className="h-4 w-4" />
									)}
								</button>
							</div>
						</div>
						<button
							onClick={() => setCreatedKey(null)}
							className="text-green-600 hover:text-green-800 dark:text-green-400"
						>
							<X className="h-4 w-4" />
						</button>
					</div>
				</div>
			)}

			{/* Active keys list */}
			{isLoading ? (
				<div className="flex justify-center py-8">
					<div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
				</div>
			) : keys && keys.length > 0 ? (
				<div className="space-y-3">
					<h4 className="text-sm font-medium text-secondary-700 dark:text-secondary-300">
						Active Keys
					</h4>
					{keys
						.filter((k) => k.isActive !== false)
						.map((key) => (
							<div
								key={key.id}
								className="bg-white dark:bg-secondary-800 border border-secondary-200 dark:border-secondary-700 rounded-lg p-4"
							>
								<div className="flex items-center justify-between gap-4">
									<div className="min-w-0 flex-1">
										<p className="text-sm font-medium text-secondary-900 dark:text-white truncate">
											{key.name || "Unnamed key"}
										</p>
										<div className="flex items-center gap-2 mt-1">
											<span className="font-mono text-xs text-secondary-500 dark:text-secondary-400 truncate max-w-[280px]">
												{key.maskedKey || key.masked_key || key.key}
											</span>
											<button
												type="button"
												onClick={() => copyToClipboard(key.key, key.id)}
												className="text-primary-600 hover:text-primary-700 dark:text-primary-400 flex-shrink-0"
											>
												{copiedId === key.id ? (
													<CheckCircle className="h-3.5 w-3.5" />
												) : (
													<Copy className="h-3.5 w-3.5" />
												)}
											</button>
										</div>
										{(key.lastUsedAt || key.last_used_at) && (
											<p className="text-xs text-secondary-400 dark:text-secondary-500 mt-1">
												Last used:{" "}
												{new Date(
													key.lastUsedAt || key.last_used_at,
												).toLocaleString()}
											</p>
										)}
									</div>
									<button
										type="button"
										onClick={() => revokeMutation.mutate(key.id)}
										className="flex-shrink-0 p-2 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors"
									>
										<Trash2 className="h-4 w-4" />
									</button>
								</div>
							</div>
						))}
				</div>
			) : (
				<div className="bg-secondary-50 dark:bg-secondary-900/30 border border-secondary-200 dark:border-secondary-700 rounded-lg p-6 text-center">
					<Key className="h-8 w-8 text-secondary-400 mx-auto mb-2" />
					<p className="text-sm text-secondary-500 dark:text-secondary-400">
						No API keys yet. Create one to connect with MCP tools.
					</p>
				</div>
			)}

			{/* Revoke confirmation modal */}
			{revokeMutation.isSuccess && (
				<div className="bg-green-50 dark:bg-green-900/20 border border-green-300 dark:border-green-700 rounded-md p-4">
					<p className="text-sm text-green-800 dark:text-green-200">
						Key revoked successfully.
					</p>
				</div>
			)}
		</div>
	);
};

export default ApiKeysTab;
