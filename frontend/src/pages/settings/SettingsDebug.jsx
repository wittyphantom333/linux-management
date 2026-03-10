import { Bug } from "lucide-react";
import { useState } from "react";
import SettingsLayout from "../../components/SettingsLayout";

const SettingsDebug = () => {
	const [showDiagnostics, setShowDiagnostics] = useState(() => {
		const stored = localStorage.getItem("patchmon_show_diagnostics");
		return stored === null ? true : stored === "true";
	});

	const handleToggle = (value) => {
		setShowDiagnostics(value);
		localStorage.setItem("patchmon_show_diagnostics", String(value));
	};

	return (
		<SettingsLayout>
			<div className="space-y-6">
				<div className="flex items-center gap-3 mb-6">
					<Bug className="h-6 w-6 text-primary-600" />
					<h1 className="text-xl font-semibold text-secondary-900 dark:text-white">
						Debug Settings
					</h1>
				</div>

				{/* Config Management */}
				<div className="bg-white dark:bg-secondary-800 shadow rounded-lg p-6">
					<h2 className="text-lg font-medium text-secondary-900 dark:text-white mb-4">
						Config Management
					</h2>
					<div className="space-y-4">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-sm font-medium text-secondary-900 dark:text-white">
									Show Pipeline Diagnostics
								</p>
								<p className="text-xs text-secondary-500 dark:text-secondary-400 mt-0.5">
									Display the Pipeline Diagnostics panel on the Config
									Management overview tab.
								</p>
							</div>
							<button
								type="button"
								onClick={() => handleToggle(!showDiagnostics)}
								className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${
									showDiagnostics
										? "bg-primary-600"
										: "bg-secondary-200 dark:bg-secondary-600"
								}`}
								role="switch"
								aria-checked={showDiagnostics}
							>
								<span
									className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
										showDiagnostics ? "translate-x-5" : "translate-x-0"
									}`}
								/>
							</button>
						</div>
					</div>
				</div>
			</div>
		</SettingsLayout>
	);
};

export default SettingsDebug;
