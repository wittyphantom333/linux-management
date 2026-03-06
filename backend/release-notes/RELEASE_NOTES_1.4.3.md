## 🎉 PatchMon 1.4.3

## 🔧 Configuration Management (New Integration)

- **Rudder-inspired Config Management**: A new integration that lets you define **Techniques** (individual checks/actions), group them into **Directives** (with parameters), and apply them to hosts via **Rules**. The agent evaluates policies on each report cycle and produces **Runs** with per-directive compliance status.
- **Techniques**: Create reusable configuration checks (e.g. file exists, service running, package installed). Each technique has a method, component, and expected value.
- **Directives**: Bundle one or more techniques with specific parameters and a priority/severity level.
- **Rules**: Assign directives to target hosts. Rules can be enabled/disabled and support targeting all hosts or specific ones.
- **Runs**: The agent fetches its policy from the server, evaluates each directive, and reports back a run with per-directive compliance results (compliant, non-compliant, error, not-applicable).
- **Full UI**: New Config Management section in the sidebar with dedicated pages for Techniques, Directives, Rules, and Runs with detail views.

---

## 🐛 Agent Bug Fixes

- **Config Management policy fetch**: The agent now correctly fetches its configuration policy from the server on each report cycle. Previously the policy was never retrieved, so no config management runs were produced.
- **Agent API endpoint URLs**: Fixed agent HTTP client URLs for config management endpoints to match the backend route structure (`/api/v1/configmanagement/agent/policy` and `/api/v1/configmanagement/agent/report`).

---

## Thank you

I appreciate the whole community for helping with PRs and help testing areas of PatchMon <3
