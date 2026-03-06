import { Bell, Settings } from "lucide-react";

const Notifications = () => {
	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold text-secondary-900 dark:text-white">
						Notifications
					</h1>
					<p className="mt-1 text-sm text-secondary-600 dark:text-secondary-400">
						Configure notification preferences and alert rules
					</p>
				</div>
			</div>

			{/* Coming Soon Card */}
			<div className="bg-white dark:bg-secondary-800 border border-secondary-200 dark:border-secondary-600 rounded-lg p-6">
				<div className="flex items-center gap-4">
					<div className="flex-shrink-0">
						<div className="w-12 h-12 bg-primary-100 dark:bg-primary-900 rounded-lg flex items-center justify-center">
							<Bell className="h-6 w-6 text-primary-600 dark:text-primary-400" />
						</div>
					</div>
					<div className="flex-1">
						<h3 className="text-lg font-semibold text-secondary-900 dark:text-white">
							Notification Rules Coming Soon
						</h3>
						<p className="mt-1 text-sm text-secondary-600 dark:text-secondary-400">
							We're working on adding comprehensive notification rules including
							package updates, security alerts, system events, and custom
							triggers.
						</p>
						<div className="mt-3">
							<span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium bg-primary-100 text-primary-800 dark:bg-primary-900 dark:text-primary-200">
								In Development
							</span>
						</div>
					</div>
				</div>
			</div>

			{/* Notification Settings Preview */}
			<div className="grid grid-cols-1 md:grid-cols-1 gap-6">
				{/* Package Updates */}
				<div className="bg-white dark:bg-secondary-800 border border-secondary-200 dark:border-secondary-600 rounded-lg p-6">
					<div className="flex items-center gap-3 mb-4">
						<div className="w-8 h-8 bg-blue-100 dark:bg-blue-900 rounded-lg flex items-center justify-center">
							<Settings className="h-4 w-4 text-blue-600 dark:text-blue-400" />
						</div>
						<h3 className="text-lg font-medium text-secondary-900 dark:text-white">
							Package Updates
						</h3>
					</div>
					<p className="text-sm text-secondary-600 dark:text-secondary-400 mb-4">
						Get notified when packages are updated on your hosts
					</p>
					<div className="space-y-2">
						<div className="flex items-center justify-between">
							<span className="text-sm text-secondary-700 dark:text-secondary-300">
								Critical Updates
							</span>
							<span className="text-xs text-secondary-500 dark:text-secondary-400">
								Coming Soon
							</span>
						</div>
						<div className="flex items-center justify-between">
							<span className="text-sm text-secondary-700 dark:text-secondary-300">
								Security Patches
							</span>
							<span className="text-xs text-secondary-500 dark:text-secondary-400">
								Coming Soon
							</span>
						</div>
						<div className="flex items-center justify-between">
							<span className="text-sm text-secondary-700 dark:text-secondary-300">
								Major Updates
							</span>
							<span className="text-xs text-secondary-500 dark:text-secondary-400">
								Coming Soon
							</span>
						</div>
					</div>
				</div>
			</div>

			{/* Empty State */}
			<div className="bg-white dark:bg-secondary-800 border border-secondary-200 dark:border-secondary-600 rounded-lg">
				<div className="px-6 py-4 border-b border-secondary-200 dark:border-secondary-600">
					<h3 className="text-lg font-medium text-secondary-900 dark:text-white">
						Notification Rules
					</h3>
					<p className="mt-1 text-sm text-secondary-600 dark:text-secondary-400">
						No notification rules configured yet
					</p>
				</div>
				<div className="px-6 py-8 text-center">
					<Bell className="mx-auto h-12 w-12 text-secondary-400" />
					<h3 className="mt-2 text-sm font-medium text-secondary-900 dark:text-white">
						No rules
					</h3>
					<p className="mt-1 text-sm text-secondary-500 dark:text-secondary-400">
						Get started by creating your first notification rule.
					</p>
				</div>
			</div>
		</div>
	);
};

export default Notifications;
