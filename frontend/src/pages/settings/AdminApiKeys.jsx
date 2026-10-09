import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle, Copy, Search, Shield, Trash2, User, X } from "lucide-react";
import { useState } from "react";
import { apiKeysAPI } from "../../utils/api";

const AdminApiKeys = () => {
	const queryClient = useQueryClient();
	const [activeTab, setActiveTab] = useState("all"); // all | admin | user
	const [search, setSearch] = useState("");
	const [revokeId, setRevokeId] = useState(null);
	const [showCreateAdmin, setShowCreateAdmin] = useState(false);
	const [adminForm, setAdminForm] = useState({ username: "", email: "", name: "" });

	const { data: keys = [], isLoading } = useQuery({
		queryKey: ["admin-api-keys"],
		queryFn: () => apiKeysAPI.list().then((r) => r.data),
	});

	const allKeys = [
		...(keys.filter((k) => k.type === "user") || []),
		...(keys.filter((k) => k.type === "admin") || []),
	];

	const adminKeys = keys.filter((k) => k.type === "admin");
	const userKeys = keys.filter((k) => k.type === "user");

	const filteredKeys = allKeys.filter((k) => {
		if (activeTab === "all") return true;
		return k.type === activeTab;
	}).filter((k) => !search || k.name?.toLowerCase().includes(search.toLowerCase()));

	const revokeMutation = useMutation({
		mutationFn: (id) => apiKeysAPI.revoke(id).then((r) => r.data),
		onSuccess: () => queryClient.invalidateQueries(["admin-api-keys"]),
	});

	const createAdminMutation = useMutation({
		mutationFn: (data) => apiKeysAPI.createAdmin(data.username, data.email, data.name).then((r) => r.data),
		onSuccess: (data) => {
			queryClient.invalidateQueries(["admin-api-keys"]);
			setShowCreateAdmin(false);
			setAdminForm({ username: "", email: "", name: "" });
			// In production you'd show the key to copy — but that's handled by a modal in real usage
		},
	});

	return (
		<div className="space-y-6">
			{/* Header */}
			<div>
				<h1 className="text-xl font-semibold text-secondary-900 dark:text-white mb-1">
					API Keys Dashboard
				</h1>
				<p className="text-sm text-secondary-600 dark:text-secondary-300">
					System-wide view of all API keys for users and admin service accounts.
				</p>
			</div>

			{/* Stats */}
			<div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
				<div className="bg-white dark:bg-secondary-800 border border-secondary-200 dark:border-secondary-700 rounded-lg p-4">
					<p className="text-xs text-secondary-500 dark:text-secondary-400 uppercase tracking-wide">
						Total Active
					</p>
					<p className="text-2xl font-semibold text-primary-600 dark:text-primary-400 mt-1">
						{keys.filter((k) => k.is_active !== false).length}
					</p>
				</div>
				<div className="bg-white dark:bg-secondary-800 border border-secondary-200 dark:border-secondary-700 rounded-lg p-4">
					<p className="text-xs text-secondary-500 dark:text-secondary-400 uppercase tracking-wide">
						User Keys
					</p>
					<p className="text-2xl font-semibold text-blue-600 dark:text-blue-400 mt-1">
						{userKeys.filter((k) => k.is_active !== false).length}
					</p>
				</div>
				<div className="bg-white dark:bg-secondary-800 border border-secondary-200 dark:border-secondary-700 rounded-lg p-4">
					<p className="text-xs text-secondary-500 dark:text-secondary-400 uppercase tracking-wide">
						Admin Keys
					</p>
					<p className="text-2xl font-semibold text-amber-600 dark:text-amber-400 mt-1">
						{adminKeys.filter((k) => k.is_active !== false).length}
					</p>
				</div>
			</div>

			{/* Tabs + Search */}
			<div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
				<div className="flex bg-white dark:bg-secondary-800 border border-secondary-200 dark:border-secondary-700 rounded-lg p-1">
					{["all", "user", "admin"].map((tab) => (
						<button
							key={tab}
							type="button"
							onClick={() => setActiveTab(tab)}
							className={`px-4 py-2 text-sm font-medium rounded-md transition-colors capitalize ${
								activeTab === tab
									? "bg-primary-600 text-white"
									: "text-secondary-600 dark:text-secondary-400 hover:bg-secondary-100 dark:hover:bg-secondary-700"
							}`}
						>
							{tab}
						</button>
					))}
				</div>

				<div className="relative flex-1 sm:flex-none">
					<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-secondary-400" />
					<input
						type="text"
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						placeholder="Search keys..."
						className="w-full sm:w-64 pl-10 pr-4 py-2 border border-secondary-300 dark:border-secondary-600 rounded-md bg-white dark:bg-secondary-700 text-sm text-secondary-900 dark:text-white placeholder-secondary-400"
					/>
				</div>

				<button
					type="button"
					onClick={() => setShowCreateAdmin(true)}
					className="inline-flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-md text-sm font-medium transition-colors"
				>
					Create Admin Key
				</button>
			</div>

			{/* Keys table */}
			{isLoading ? (
				<div className="flex justify-center py-12">
					<div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
				</div>
			) : filteredKeys.length > 0 ? (
				<div className="bg-white dark:bg-secondary-800 border border-secondary-200 dark:border-secondary-700 rounded-lg overflow-hidden">
					<div className="overflow-x-auto">
						<table className="w-full text-sm">
							<thead className="bg-secondary-50 dark:bg-secondary-900/30 border-b border-secondary-200 dark:border-secondary-700">
								<tr>
									<th className="text-left px-4 py-3 font-medium text-secondary-600 dark:text-secondary-400">Name</th>
									<th className="text-left px-4 py-3 font-medium text-secondary-600 dark:text-secondary-400 hidden sm:table-cell">Type</th>
									<th className="text-left px-4 py-3 font-medium text-secondary-600 dark:text-secondary-400 hidden md:table-cell">Owner</th>
									<th className="text-left px-4 py-3 font-medium text-secondary-600 dark:text-secondary-400 hidden lg:table-cell">Masked Key</th>
									<th className="text-left px-4 py-3 font-medium text-secondary-600 dark:text-secondary-400 hidden sm:table-cell">Last Used</th>
									<th className="px-4 py-3"></th>
								</tr>
							</thead>
							<tbody className="divide-y divide-secondary-200 dark:divide-secondary-700">
								{filteredKeys.map((key) => (
									<tr key={key.id} className={`hover:bg-secondary-50 dark:hover:bg-secondary-900/20 ${key.is_active === false ? "opacity-50" : ""}`}>
										<td className="px-4 py-3">
											<div>
												<p className="font-medium text-secondary-900 dark:text-white truncate max-w-[200px]">
													{key.name || "Unnamed"}
												</p>
											</div>
										</td>
										<td className="px-4 py-3 hidden sm:table-cell">
											<span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
												key.type === "admin"
													? "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"
													: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
											}`}>
												{key.type === "admin" ? <Shield className="h-3 w-3 mr-1" /> : <User className="h-3 w-3 mr-1" />}
												{key.type}
											</span>
										</td>
										<td className="px-4 py-3 text-secondary-600 dark:text-secondary-400 hidden md:table-cell">
											{key.username || key.user_id || "—"}
										</td>
										<td className="px-4 py-3 hidden lg:table-cell">
											<code className="text-xs font-mono text-secondary-500 dark:text-secondary-400">
												{key.masked_key}
											</code>
										</td>
										<td className="px-4 py-3 text-secondary-500 dark:text-secondary-400 hidden sm:table-cell">
											{key.last_used_at ? new Date(key.last_used_at).toLocaleDateString() : "Never"}
										</td>
										<td className="px-4 py-3">
											{key.is_active !== false ? (
												<button
													type="button"
													onClick={() => setRevokeId(key.id)}
													className="text-red-500 hover:text-red-700 transition-colors p-1"
												>
													<Trash2 className="h-4 w-4" />
												</button>
											) : (
												<span className="text-xs text-secondary-400">Revoked</span>
											)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			) : (
				<div className="bg-secondary-50 dark:bg-secondary-900/30 border border-secondary-200 dark:border-secondary-700 rounded-lg p-8 text-center">
					<p className="text-sm text-secondary-500 dark:text-secondary-400">
						No keys found{search ? " matching your search" : ""}.
					</p>
				</div>
			)}

			{/* Revoke confirmation */}
			{revokeMutation.isSuccess && (
				<div className="bg-green-50 dark:bg-green-900/20 border border-green-300 dark:border-green-700 rounded-md p-4">
					<p className="text-sm text-green-800 dark:text-green-200">Key revoked.</p>
				</div>
			)}

			{/* Admin create modal */}
			{showCreateAdmin && (
				<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
					<div className="bg-white dark:bg-secondary-800 rounded-lg shadow-xl max-w-md w-full p-6">
						<div className="flex items-center justify-between mb-4">
							<h3 className="text-lg font-medium text-secondary-900 dark:text-white">
								Create Admin API Key
							</h3>
							<button onClick={() => setShowCreateAdmin(false)} className="text-secondary-400 hover:text-secondary-600">
								<X className="h-5 w-5" />
							</button>
						</div>
						<div className="space-y-4">
							<div>
								<label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">Username</label>
								<input type="text" value={adminForm.username} onChange={(e) => setAdminForm({...adminForm, username: e.target.value})}
									className="w-full border border-secondary-300 dark:border-secondary-600 rounded-md px-3 py-2 bg-white dark:bg-secondary-700 text-sm text-secondary-900 dark:text-white" />
							</div>
							<div>
								<label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">Email</label>
								<input type="email" value={adminForm.email} onChange={(e) => setAdminForm({...adminForm, email: e.target.value})}
									className="w-full border border-secondary-300 dark:border-secondary-600 rounded-md px-3 py-2 bg-white dark:bg-secondary-700 text-sm text-secondary-900 dark:text-white" />
							</div>
							<div>
								<label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">Key Name</label>
								<input type="text" value={adminForm.name} onChange={(e) => setAdminForm({...adminForm, name: e.target.value})}
									className="w-full border border-secondary-300 dark:border-secondary-600 rounded-md px-3 py-2 bg-white dark:bg-secondary-700 text-sm text-secondary-900 dark:text-white" />
							</div>
							<div className="flex justify-end gap-3">
								<button onClick={() => setShowCreateAdmin(false)}
									className="px-4 py-2 border border-secondary-300 dark:border-secondary-600 rounded-md text-sm text-secondary-700 dark:text-secondary-300 hover:bg-secondary-100 dark:hover:bg-secondary-700">
									Cancel
								</button>
								<button onClick={() => createAdminMutation.mutate(adminForm)}
									className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-md text-sm font-medium">
									Create Key
								</button>
							</div>
						</div>
					</div>
				</div>
			)}

			{/* Revocation confirmation */}
			{revokeId && (
				<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
					<div className="bg-white dark:bg-secondary-800 rounded-lg shadow-xl max-w-sm w-full p-6">
						<AlertCircle className="h-8 w-8 text-red-600 mx-auto mb-3" />
						<h3 className="text-lg font-medium text-secondary-900 dark:text-white text-center mb-2">
							Revoke API Key?
						</h3>
						<p className="text-sm text-secondary-600 dark:text-secondary-400 text-center mb-6">
							This will invalidate the key immediately. Any services using it will lose access.
						</p>
						<div className="flex justify-center gap-3">
							<button onClick={() => setRevokeId(null)}
								className="px-4 py-2 border border-secondary-300 dark:border-secondary-600 rounded-md text-sm text-secondary-700 dark:text-secondary-300 hover:bg-secondary-100 dark:hover:bg-secondary-700">
								Cancel
							</button>
							<button onClick={() => { revokeMutation.mutate(revokeId); setRevokeId(null); }}
								className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md text-sm font-medium">
								Revoke Key
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
};

export default AdminApiKeys;
