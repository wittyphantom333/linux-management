import { AlertCircle, BookOpen, Copy, Key, Server } from "lucide-react";
import { useState } from "react";

const McpInfoTab = () => {
	const [copied, setCopied] = useState(false);

	const copyText = async (text) => {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {}
	};

	return (
		<div className="space-y-6">
			<div>
				<h3 className="text-lg font-medium text-secondary-900 dark:text-white mb-1">
					MCP Server Configuration
				</h3>
				<p className="text-sm text-secondary-600 dark:text-secondary-300">
					Use PatchMon's MCP server to interact with your infrastructure via AI tools.
				</p>
			</div>

			{/* Available Tools */}
			<div className="bg-white dark:bg-secondary-800 border border-secondary-200 dark:border-secondary-700 rounded-lg p-4 md:p-6">
				<h4 className="text-sm font-medium text-secondary-900 dark:text-white mb-4 flex items-center gap-2">
					<BookOpen className="h-4 w-4 text-primary-600" />
					Available MCP Tools
				</h4>
				<div className="space-y-4">
					{[
						{
							name: "patchmon_list_hosts",
							desc: "List all monitored hosts with status, OS, and last check-in.",
						},
						{
							name: "patchmon_diagnose_windows_hosts",
							desc: "Diagnose Windows agents that haven't checked in recently.",
						},
						{
							name: "patchmon_get_agent_version",
							desc: "Get the latest agent version and compare against installed versions across all hosts.",
						},
						{
							name: "patchmon_get_binary_info",
							desc: "Query the binary download endpoint for version and architecture details.",
						},
					].map((tool) => (
						<div key={tool.name} className="flex items-start gap-3">
							<Server className="h-4 w-4 text-primary-500 mt-1 flex-shrink-0" />
							<div>
								<code className="text-sm font-mono text-primary-700 dark:text-primary-300 bg-primary-50 dark:bg-primary-900/20 px-2 py-0.5 rounded">
									{tool.name}
								</code>
								<p className="text-xs text-secondary-600 dark:text-secondary-400 mt-1">
									{tool.desc}
								</p>
							</div>
						</div>
					))}
				</div>
			</div>

			{/* Configuration */}
			<div className="bg-white dark:bg-secondary-800 border border-secondary-200 dark:border-secondary-700 rounded-lg p-4 md:p-6">
				<h4 className="text-sm font-medium text-secondary-900 dark:text-white mb-4 flex items-center gap-2">
					<Key className="h-4 w-4 text-primary-600" />
					Configuration (Vivus / Claude Code)
				</h4>

				<ol className="space-y-4">
					<li className="flex gap-3">
						<span className="flex-shrink-0 w-6 h-6 bg-primary-100 dark:bg-primary-900 text-primary-700 dark:text-primary-300 rounded-full flex items-center justify-center text-xs font-medium">
							1
						</span>
						<div className="flex-1">
							<p className="text-sm text-secondary-700 dark:text-secondary-300 mb-2">
								Create an API key from the "API Keys" tab above. Copy it — you
								won't see it again.
							</p>
						</div>
					</li>

					<li className="flex gap-3">
						<span className="flex-shrink-0 w-6 h-6 bg-primary-100 dark:bg-primary-900 text-primary-700 dark:text-primary-300 rounded-full flex items-center justify-center text-xs font-medium">
							2
						</span>
						<div className="flex-1">
							<p className="text-sm text-secondary-700 dark:text-secondary-300 mb-2">
								In Vivus, configure the MCP server with:
							</p>
							<div className="relative">
								<code className="block bg-secondary-900 dark:bg-secondary-950 text-secondary-100 p-3 rounded-md text-sm font-mono overflow-x-auto">
									{`{
  "mcpServers": {
    "patchmon": {
      "command": "/path/to/node",
      "args": ["/path/to/backend/src/mcp/server.js"],
      "env": {
        "PATCHMON_URL": "${window.location.origin}",
        "PATCHMON_API_KEY": "<your-api-key>"
      }
    }
  }
}`}
								</code>
								<button
									type="button"
									onClick={() =>
										copyText(`{
  "mcpServers": {
    "patchmon": {
      "command": "/path/to/node",
      "args": ["/path/to/backend/src/mcp/server.js"],
      "env": {
        "PATCHMON_URL": "${window.location.origin}",
        "PATCHMON_API_KEY": "<your-api-key>"
      }
    }
  }
}`)
									}
									className="absolute top-2 right-2 p-1.5 text-secondary-400 hover:text-secondary-200 bg-secondary-800 rounded"
								>
									{copied ? (
										<AlertCircle className="h-3.5 w-3.5" />
									) : (
										<Copy className="h-3.5 w-3.5" />
									)}
								</button>
							</div>
						</div>
					</li>

					<li className="flex gap-3">
						<span className="flex-shrink-0 w-6 h-6 bg-primary-100 dark:bg-primary-900 text-primary-700 dark:text-primary-300 rounded-full flex items-center justify-center text-xs font-medium">
							3
						</span>
						<div className="flex-1">
							<p className="text-sm text-secondary-700 dark:text-secondary-300 mb-2">
								Use the `!patchmon_` prefix in chat to invoke tools:
							</p>
							<div className="bg-secondary-900 dark:bg-secondary-950 text-secondary-100 p-3 rounded-md text-sm font-mono overflow-x-auto">
								<span className="text-green-400">!patchmon_list_hosts</span>
								<br />
								<span className="text-green-400">!patchmon_diagnose_windows_hosts --since 2d</span>
								<br />
								<span className="text-green-400">!patchmon_get_agent_version</span>
							</div>
						</div>
					</li>
				</ol>
			</div>

			{/* Authentication */}
			<div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
				<div className="flex gap-3">
					<AlertCircle className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
					<div>
						<p className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-1">
							Authentication
						</p>
						<p className="text-xs text-blue-700 dark:text-blue-300">
							MCP tools authenticate via the `PATCHMON_API_KEY` environment variable.
							The server validates it against the database using bcrypt, returns user info
							and role (user/admin). Admin keys can access all hosts; user keys are limited to
							hosts assigned to that user.
						</p>
					</div>
				</div>
			</div>
		</div>
	);
};

export default McpInfoTab;
