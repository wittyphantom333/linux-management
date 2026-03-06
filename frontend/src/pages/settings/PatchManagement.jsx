import { Settings } from "lucide-react";
import SettingsLayout from "../../components/SettingsLayout";

const PatchManagement = () => {
	return (
		<SettingsLayout>
			<div className="space-y-6">
				{/* Header */}
				<div className="flex items-center justify-between">
					<div>
						<h1 className="text-2xl font-bold text-secondary-900 dark:text-white">
							Patch Management
						</h1>
						<p className="mt-1 text-sm text-secondary-600 dark:text-secondary-400">
							Define and enforce policies for applying and monitoring patches
						</p>
					</div>
				</div>

				{/* Coming Soon Card */}
				<div className="bg-white dark:bg-secondary-800 border border-secondary-200 dark:border-secondary-600 rounded-lg p-6">
					<div className="flex items-center gap-4">
						<div className="flex-shrink-0">
							<div className="w-12 h-12 bg-primary-100 dark:bg-primary-900 rounded-lg flex items-center justify-center">
								<Settings className="h-6 w-6 text-primary-600 dark:text-primary-400" />
							</div>
						</div>
						<div className="flex-1">
							<h3 className="text-lg font-semibold text-secondary-900 dark:text-white">
								Patch Management Coming Soon
							</h3>
							<p className="mt-1 text-sm text-secondary-600 dark:text-secondary-400">
								We are designing rule sets, approval workflows, and automated
								patch policies to give you granular control over updates.
							</p>
							<div className="mt-3">
								<span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium bg-primary-100 text-primary-800 dark:bg-primary-900 dark:text-primary-200">
									In Development
								</span>
							</div>
						</div>
					</div>
				</div>

				{/* Patch Policy */}
				<div className="bg-white dark:bg-secondary-800 border border-secondary-200 dark:border-secondary-600 rounded-lg p-6">
					<div className="flex items-center gap-3 mb-4">
						<div className="w-8 h-8 bg-blue-100 dark:bg-blue-900 rounded-lg flex items-center justify-center">
							<Settings className="h-4 w-4 text-blue-600 dark:text-blue-400" />
						</div>
						<h3 className="text-lg font-medium text-secondary-900 dark:text-white">
							Patch Policy
						</h3>
					</div>
					<p className="text-sm text-secondary-600 dark:text-secondary-400 mb-4">
						Configure rule sets for patch management and monitoring
					</p>
					<div className="space-y-2">
						<div className="flex items-center justify-between">
							<span className="text-sm text-secondary-700 dark:text-secondary-300">
								Rule Sets
							</span>
							<span className="text-xs text-secondary-500 dark:text-secondary-400">
								Coming Soon
							</span>
						</div>
						<div className="flex items-center justify-between">
							<span className="text-sm text-secondary-700 dark:text-secondary-300">
								Patch Approval Workflows
							</span>
							<span className="text-xs text-secondary-500 dark:text-secondary-400">
								Coming Soon
							</span>
						</div>
						<div className="flex items-center justify-between">
							<span className="text-sm text-secondary-700 dark:text-secondary-300">
								Security Patch Priority
							</span>
							<span className="text-xs text-secondary-500 dark:text-secondary-400">
								Coming Soon
							</span>
						</div>
						<div className="flex items-center justify-between">
							<span className="text-sm text-secondary-700 dark:text-secondary-300">
								Auto-Update Policies
							</span>
							<span className="text-xs text-secondary-500 dark:text-secondary-400">
								Coming Soon
							</span>
						</div>
					</div>
				</div>
			</div>
		</SettingsLayout>
	);
};

export default PatchManagement;
