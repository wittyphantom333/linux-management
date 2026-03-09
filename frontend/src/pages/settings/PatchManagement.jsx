import { Shield, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
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
							Manage patch policies, maintenance windows, and automated patching
						</p>
					</div>
				</div>

				{/* Redirect card */}
				<div className="bg-white dark:bg-secondary-800 border border-secondary-200 dark:border-secondary-600 rounded-lg p-6">
					<div className="flex items-center gap-4">
						<div className="flex-shrink-0">
							<div className="w-12 h-12 bg-primary-100 dark:bg-primary-900 rounded-lg flex items-center justify-center">
								<Shield className="h-6 w-6 text-primary-600 dark:text-primary-400" />
							</div>
						</div>
						<div className="flex-1">
							<h3 className="text-lg font-semibold text-secondary-900 dark:text-white">
								Patch Management Dashboard
							</h3>
							<p className="mt-1 text-sm text-secondary-600 dark:text-secondary-400">
								Configure patch policies, schedule maintenance windows, monitor
								jobs, and review patch history from the dedicated dashboard.
							</p>
							<div className="mt-3">
								<Link
									to="/patch-management"
									className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-primary-600 text-white hover:bg-primary-700"
								>
									Open Patch Management <ArrowRight className="h-4 w-4" />
								</Link>
							</div>
						</div>
					</div>
				</div>
			</div>
		</SettingsLayout>
	);
};

export default PatchManagement;
