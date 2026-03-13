import {
	ArrowRight,
	BarChart3,
	CheckCircle2,
	Cloud,
	Code2,
	Container,
	Globe,
	Layers,
	Lock,
	Monitor,
	Package,
	RefreshCw,
	Server,
	Settings,
	Shield,
	ShieldCheck,
	Terminal,
	Users,
	Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

// ─── Fade-in-on-scroll wrapper ───────────────────────────────────────────────
function FadeIn({ children, className = "", delay = 0 }) {
	const ref = useRef(null);
	const [visible, setVisible] = useState(false);

	useEffect(() => {
		const observer = new IntersectionObserver(
			([entry]) => {
				if (entry.isIntersecting) setVisible(true);
			},
			{ threshold: 0.15 },
		);
		if (ref.current) observer.observe(ref.current);
		return () => observer.disconnect();
	}, []);

	return (
		<div
			ref={ref}
			className={`transition-all duration-700 ease-out ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"} ${className}`}
			style={{ transitionDelay: `${delay}ms` }}
		>
			{children}
		</div>
	);
}

// ─── Navigation ──────────────────────────────────────────────────────────────
function Nav() {
	const [scrolled, setScrolled] = useState(false);
	const [mobileOpen, setMobileOpen] = useState(false);

	useEffect(() => {
		const onScroll = () => setScrolled(window.scrollY > 20);
		window.addEventListener("scroll", onScroll, { passive: true });
		return () => window.removeEventListener("scroll", onScroll);
	}, []);

	const links = [
		{ label: "Features", href: "#features" },
		{ label: "Platform", href: "#platform" },
		{ label: "Security", href: "#security" },
		{ label: "Integrations", href: "#integrations" },
	];

	return (
		<nav
			className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled ? "bg-white/90 dark:bg-secondary-900/90 backdrop-blur-lg shadow-lg" : "bg-transparent"}`}
		>
			<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
				<div className="flex items-center justify-between h-16 lg:h-20">
					<div className="flex items-center gap-3">
						<img
							src="/assets/logo_light.png"
							alt="Monux"
							className="h-8 w-auto dark:hidden"
						/>
						<img
							src="/assets/logo_dark.png"
							alt="Monux"
							className="h-8 w-auto hidden dark:block"
						/>
						<span className="text-xl font-bold text-secondary-900 dark:text-white tracking-tight">
							Monux
						</span>
					</div>

					{/* Desktop links */}
					<div className="hidden md:flex items-center gap-8">
						{links.map((l) => (
							<a
								key={l.href}
								href={l.href}
								className="text-sm font-medium text-secondary-600 hover:text-primary-600 dark:text-secondary-300 dark:hover:text-primary-400 transition-colors"
							>
								{l.label}
							</a>
						))}
						<a
							href="https://docs.patchmon.net"
							target="_blank"
							rel="noopener noreferrer"
							className="text-sm font-medium text-secondary-600 hover:text-primary-600 dark:text-secondary-300 dark:hover:text-primary-400 transition-colors"
						>
							Docs
						</a>
					</div>

					<div className="hidden md:flex items-center gap-3">
						<Link
							to="/login"
							className="text-sm font-medium text-secondary-700 dark:text-secondary-200 hover:text-primary-600 dark:hover:text-primary-400 transition-colors px-4 py-2"
						>
							Sign In
						</Link>
						<Link
							to="/login"
							className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 shadow-lg shadow-primary-600/25 transition-all hover:shadow-xl hover:shadow-primary-600/30 hover:-translate-y-0.5"
						>
							Get Started
							<ArrowRight className="w-4 h-4" />
						</Link>
					</div>

					{/* Mobile menu button */}
					<button
						type="button"
						onClick={() => setMobileOpen(!mobileOpen)}
						className="md:hidden p-2 text-secondary-600 dark:text-secondary-300"
					>
						<svg
							className="w-6 h-6"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
						>
							{mobileOpen ? (
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M6 18L18 6M6 6l12 12"
								/>
							) : (
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M4 6h16M4 12h16M4 18h16"
								/>
							)}
						</svg>
					</button>
				</div>

				{/* Mobile menu */}
				{mobileOpen && (
					<div className="md:hidden pb-4 border-t border-secondary-200 dark:border-secondary-700 mt-2 pt-4 space-y-2">
						{links.map((l) => (
							<a
								key={l.href}
								href={l.href}
								onClick={() => setMobileOpen(false)}
								className="block px-3 py-2 text-sm font-medium text-secondary-600 dark:text-secondary-300 hover:text-primary-600"
							>
								{l.label}
							</a>
						))}
						<div className="pt-2 flex flex-col gap-2">
							<Link to="/login" className="btn-primary text-center">
								Get Started
							</Link>
						</div>
					</div>
				)}
			</div>
		</nav>
	);
}

// ─── Hero ────────────────────────────────────────────────────────────────────
function Hero() {
	return (
		<section className="relative min-h-screen flex items-center overflow-hidden pt-20">
			{/* Background gradients */}
			<div className="absolute inset-0 bg-gradient-to-br from-primary-50 via-white to-secondary-50 dark:from-secondary-950 dark:via-secondary-900 dark:to-secondary-950" />
			<div className="absolute top-0 right-0 w-[600px] h-[600px] bg-primary-400/10 dark:bg-primary-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />
			<div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-primary-300/10 dark:bg-primary-600/5 rounded-full blur-3xl translate-y-1/3 -translate-x-1/4" />

			<div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 lg:py-32">
				<div className="text-center max-w-4xl mx-auto">
					<FadeIn>
						<div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300 text-sm font-medium mb-8 border border-primary-200 dark:border-primary-800">
							<Zap className="w-4 h-4" />
							Enterprise-Grade Linux Fleet Management
						</div>
					</FadeIn>

					<FadeIn delay={100}>
						<h1 className="text-4xl sm:text-5xl lg:text-7xl font-extrabold tracking-tight text-secondary-900 dark:text-white leading-[1.1]">
							Manage Your Entire
							<span className="block mt-2 bg-gradient-to-r from-primary-600 to-primary-400 bg-clip-text text-transparent">
								Linux Infrastructure
							</span>
						</h1>
					</FadeIn>

					<FadeIn delay={200}>
						<p className="mt-6 text-lg sm:text-xl text-secondary-600 dark:text-secondary-300 max-w-2xl mx-auto leading-relaxed">
							Monux gives you complete visibility into your Linux servers —
							packages, patches, compliance, Docker, and more — all from a
							single, beautiful dashboard.
						</p>
					</FadeIn>

					<FadeIn delay={300}>
						<div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
							<Link
								to="/login"
								className="inline-flex items-center gap-2 px-8 py-3.5 rounded-xl bg-primary-600 text-white font-semibold text-base hover:bg-primary-700 shadow-xl shadow-primary-600/25 transition-all hover:shadow-2xl hover:shadow-primary-600/30 hover:-translate-y-0.5"
							>
								Start for Free
								<ArrowRight className="w-5 h-5" />
							</Link>
							<a
								href="https://docs.patchmon.net"
								target="_blank"
								rel="noopener noreferrer"
								className="inline-flex items-center gap-2 px-8 py-3.5 rounded-xl border border-secondary-300 dark:border-secondary-600 text-secondary-700 dark:text-secondary-200 font-semibold text-base hover:bg-secondary-50 dark:hover:bg-secondary-800 transition-all"
							>
								Read the Docs
							</a>
						</div>
					</FadeIn>

					{/* Stats row */}
					<FadeIn delay={400}>
						<div className="mt-20 grid grid-cols-2 sm:grid-cols-4 gap-8 max-w-3xl mx-auto">
							<Stat label="Platforms" value="Linux, FreeBSD" />
							<Stat label="Open Source" value="100%" />
							<Stat label="Setup Time" value="< 5 min" />
							<Stat label="Self-Hosted" value="Full Control" />
						</div>
					</FadeIn>
				</div>

				{/* Hero visual — Dashboard mockup */}
				<FadeIn delay={500}>
					<div className="mt-20 relative max-w-5xl mx-auto">
						<div className="absolute inset-0 bg-gradient-to-t from-white dark:from-secondary-950 via-transparent to-transparent z-10 pointer-events-none" />
						<div className="rounded-2xl overflow-hidden border border-secondary-200 dark:border-secondary-700 shadow-2xl bg-white dark:bg-secondary-800">
							<div className="flex items-center gap-1.5 px-4 py-3 bg-secondary-100 dark:bg-secondary-900 border-b border-secondary-200 dark:border-secondary-700">
								<div className="w-3 h-3 rounded-full bg-danger-400" />
								<div className="w-3 h-3 rounded-full bg-warning-400" />
								<div className="w-3 h-3 rounded-full bg-success-400" />
								<span className="ml-3 text-xs text-secondary-400 font-mono">
									monux.yourcompany.com
								</span>
							</div>
							<div className="p-6 lg:p-10 grid grid-cols-2 lg:grid-cols-4 gap-4">
								<MockCard
									icon={<Server className="w-5 h-5" />}
									label="Hosts"
									value="47"
									color="primary"
								/>
								<MockCard
									icon={<Package className="w-5 h-5" />}
									label="Packages"
									value="3,284"
									color="success"
								/>
								<MockCard
									icon={<Shield className="w-5 h-5" />}
									label="Compliance"
									value="94%"
									color="warning"
								/>
								<MockCard
									icon={<Container className="w-5 h-5" />}
									label="Containers"
									value="126"
									color="primary"
								/>
								<div className="col-span-2 lg:col-span-4 h-32 rounded-xl bg-gradient-to-r from-primary-50 to-primary-100 dark:from-primary-900/20 dark:to-primary-800/20 border border-primary-200/50 dark:border-primary-700/30 flex items-center justify-center">
									<div className="flex items-center gap-3 text-primary-600 dark:text-primary-400">
										<BarChart3 className="w-6 h-6" />
										<span className="text-sm font-medium">
											Fleet Health Timeline
										</span>
									</div>
								</div>
							</div>
						</div>
					</div>
				</FadeIn>
			</div>
		</section>
	);
}

function Stat({ label, value }) {
	return (
		<div className="text-center">
			<div className="text-lg sm:text-xl font-bold text-secondary-900 dark:text-white">
				{value}
			</div>
			<div className="text-sm text-secondary-500 dark:text-secondary-400 mt-1">
				{label}
			</div>
		</div>
	);
}

function MockCard({ icon, label, value, color }) {
	const colors = {
		primary:
			"bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 border-primary-200/50 dark:border-primary-700/30",
		success:
			"bg-success-50 dark:bg-success-900/20 text-success-600 dark:text-success-400 border-success-200/50 dark:border-success-700/30",
		warning:
			"bg-warning-50 dark:bg-warning-900/20 text-warning-600 dark:text-warning-400 border-warning-200/50 dark:border-warning-700/30",
	};
	return (
		<div className={`rounded-xl p-4 border ${colors[color]}`}>
			<div className="flex items-center gap-2 mb-2">
				{icon}
				<span className="text-xs font-medium opacity-80">{label}</span>
			</div>
			<div className="text-2xl font-bold">{value}</div>
		</div>
	);
}

// ─── Features Grid ───────────────────────────────────────────────────────────
function Features() {
	const features = [
		{
			icon: <Monitor className="w-6 h-6" />,
			title: "Real-Time Dashboard",
			description:
				"Drag-and-drop widgets with at-a-glance fleet health, host status, update counts, and compliance scores.",
		},
		{
			icon: <Package className="w-6 h-6" />,
			title: "Package Management",
			description:
				"Track every installed package across your fleet. Filter outdated, security-critical, or custom packages instantly.",
		},
		{
			icon: <RefreshCw className="w-6 h-6" />,
			title: "Patch Management",
			description:
				"Create policies, define maintenance windows, and schedule automated patch jobs across host groups.",
		},
		{
			icon: <ShieldCheck className="w-6 h-6" />,
			title: "Compliance Scanning",
			description:
				"CIS Benchmarks via OpenSCAP and Docker Bench for Security with automated remediation and trend tracking.",
		},
		{
			icon: <Container className="w-6 h-6" />,
			title: "Docker Monitoring",
			description:
				"Full visibility into containers, images, volumes, and networks with real-time WebSocket status updates.",
		},
		{
			icon: <Terminal className="w-6 h-6" />,
			title: "Web SSH Terminal",
			description:
				"Browser-based SSH access with direct and proxy modes — no exposed SSH ports required on your hosts.",
		},
		{
			icon: <Settings className="w-6 h-6" />,
			title: "Configuration Management",
			description:
				"Define Techniques, Directives, and Rules to enforce configurations across your fleet with compliance tracking.",
		},
		{
			icon: <Layers className="w-6 h-6" />,
			title: "Repository Tracking",
			description:
				"Monitor APT, YUM, and DNF repositories across every host. Spot misconfigurations before they cause problems.",
		},
		{
			icon: <BarChart3 className="w-6 h-6" />,
			title: "Reporting & Alerts",
			description:
				"Comprehensive reports with severity filters. Alert on host-down events, pending updates, and agent issues.",
		},
	];

	return (
		<section
			id="features"
			className="py-24 lg:py-32 bg-white dark:bg-secondary-900"
		>
			<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
				<FadeIn>
					<div className="text-center max-w-3xl mx-auto mb-16">
						<p className="text-primary-600 dark:text-primary-400 font-semibold text-sm uppercase tracking-wider mb-3">
							Features
						</p>
						<h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-secondary-900 dark:text-white tracking-tight">
							Everything You Need to Manage Linux at Scale
						</h2>
						<p className="mt-4 text-lg text-secondary-600 dark:text-secondary-400">
							From package tracking to compliance scanning, Monux provides a
							unified control plane for your entire Linux infrastructure.
						</p>
					</div>
				</FadeIn>

				<div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
					{features.map((f, i) => (
						<FadeIn key={f.title} delay={i * 80}>
							<div className="group relative p-6 lg:p-8 rounded-2xl border border-secondary-200 dark:border-secondary-700 bg-white dark:bg-secondary-800 hover:border-primary-300 dark:hover:border-primary-600 hover:shadow-xl transition-all duration-300">
								<div className="w-12 h-12 rounded-xl bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center text-primary-600 dark:text-primary-400 mb-5 group-hover:scale-110 transition-transform">
									{f.icon}
								</div>
								<h3 className="text-lg font-bold text-secondary-900 dark:text-white mb-2">
									{f.title}
								</h3>
								<p className="text-secondary-600 dark:text-secondary-400 leading-relaxed">
									{f.description}
								</p>
							</div>
						</FadeIn>
					))}
				</div>
			</div>
		</section>
	);
}

// ─── Platform Section ────────────────────────────────────────────────────────
function Platform() {
	const items = [
		{
			icon: <Server className="w-8 h-8" />,
			title: "Lightweight Agent",
			description:
				"A single Go binary that runs on Linux and FreeBSD. Outbound-only connections mean zero open ports on your hosts. Auto-enrolls with a single command.",
		},
		{
			icon: <Globe className="w-8 h-8" />,
			title: "Beautiful Web UI",
			description:
				"A responsive React dashboard that works on desktop and mobile. Customizable branding, themes, and per-user dark/light mode preferences.",
		},
		{
			icon: <Code2 className="w-8 h-8" />,
			title: "Full REST API",
			description:
				"Every feature is accessible through the /api/v1 endpoints with JWT authentication and full Swagger/OpenAPI documentation.",
		},
		{
			icon: <Cloud className="w-8 h-8" />,
			title: "Self-Hosted or Cloud",
			description:
				"Deploy on your own infrastructure with Docker Compose, or let us handle everything with Monux Cloud — our fully managed SaaS option.",
		},
	];

	return (
		<section
			id="platform"
			className="py-24 lg:py-32 bg-secondary-50 dark:bg-secondary-950"
		>
			<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
				<FadeIn>
					<div className="text-center max-w-3xl mx-auto mb-16">
						<p className="text-primary-600 dark:text-primary-400 font-semibold text-sm uppercase tracking-wider mb-3">
							Platform
						</p>
						<h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-secondary-900 dark:text-white tracking-tight">
							Built for the Way You Work
						</h2>
						<p className="mt-4 text-lg text-secondary-600 dark:text-secondary-400">
							A modern architecture designed for reliability, security, and ease
							of deployment.
						</p>
					</div>
				</FadeIn>

				<div className="grid md:grid-cols-2 gap-8 lg:gap-12">
					{items.map((item, i) => (
						<FadeIn key={item.title} delay={i * 100}>
							<div className="flex gap-5">
								<div className="flex-shrink-0 w-16 h-16 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center text-white shadow-lg shadow-primary-600/20">
									{item.icon}
								</div>
								<div>
									<h3 className="text-xl font-bold text-secondary-900 dark:text-white mb-2">
										{item.title}
									</h3>
									<p className="text-secondary-600 dark:text-secondary-400 leading-relaxed">
										{item.description}
									</p>
								</div>
							</div>
						</FadeIn>
					))}
				</div>
			</div>
		</section>
	);
}

// ─── Security Section ────────────────────────────────────────────────────────
function Security() {
	const points = [
		{
			icon: <Lock className="w-5 h-5" />,
			text: "Outbound-only agent — no open inbound ports on managed hosts",
		},
		{
			icon: <ShieldCheck className="w-5 h-5" />,
			text: "OIDC Single Sign-On with Authentik, Keycloak, Okta, and more",
		},
		{
			icon: <Users className="w-5 h-5" />,
			text: "Granular role-based access control with custom permissions",
		},
		{
			icon: <Lock className="w-5 h-5" />,
			text: "Two-factor authentication with TOTP and backup codes",
		},
		{
			icon: <Shield className="w-5 h-5" />,
			text: "httpOnly cookie auth, rate limiting, and IP allow-lists",
		},
		{
			icon: <ShieldCheck className="w-5 h-5" />,
			text: "Scoped API credentials for integrations and automation",
		},
	];

	return (
		<section
			id="security"
			className="py-24 lg:py-32 bg-white dark:bg-secondary-900"
		>
			<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
				<div className="grid lg:grid-cols-2 gap-16 items-center">
					<FadeIn>
						<div>
							<p className="text-primary-600 dark:text-primary-400 font-semibold text-sm uppercase tracking-wider mb-3">
								Security
							</p>
							<h2 className="text-3xl sm:text-4xl font-extrabold text-secondary-900 dark:text-white tracking-tight">
								Security by Design, Not an Afterthought
							</h2>
							<p className="mt-4 text-lg text-secondary-600 dark:text-secondary-400 leading-relaxed">
								Every layer of Monux is built with security in mind — from the
								agent architecture to the authentication system.
							</p>
						</div>
					</FadeIn>

					<FadeIn delay={150}>
						<div className="space-y-4">
							{points.map((p) => (
								<div
									key={p.text}
									className="flex items-start gap-4 p-4 rounded-xl bg-secondary-50 dark:bg-secondary-800 border border-secondary-200 dark:border-secondary-700"
								>
									<div className="flex-shrink-0 w-10 h-10 rounded-lg bg-success-100 dark:bg-success-900/30 flex items-center justify-center text-success-600 dark:text-success-400">
										{p.icon}
									</div>
									<span className="text-secondary-700 dark:text-secondary-300 pt-2 leading-snug">
										{p.text}
									</span>
								</div>
							))}
						</div>
					</FadeIn>
				</div>
			</div>
		</section>
	);
}

// ─── AI & Terminal Section ───────────────────────────────────────────────────
function AiTerminal() {
	return (
		<section className="py-24 lg:py-32 bg-secondary-50 dark:bg-secondary-950">
			<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
				<div className="grid lg:grid-cols-2 gap-16 items-center">
					<FadeIn>
						<div className="order-2 lg:order-1">
							{/* Terminal mockup */}
							<div className="rounded-2xl overflow-hidden border border-secondary-200 dark:border-secondary-700 shadow-2xl bg-secondary-900">
								<div className="flex items-center gap-1.5 px-4 py-3 bg-secondary-800 border-b border-secondary-700">
									<div className="w-3 h-3 rounded-full bg-danger-400" />
									<div className="w-3 h-3 rounded-full bg-warning-400" />
									<div className="w-3 h-3 rounded-full bg-success-400" />
									<span className="ml-3 text-xs text-secondary-400 font-mono">
										web-ssh — prod-web-01
									</span>
								</div>
								<div className="p-5 font-mono text-sm leading-relaxed">
									<div className="text-success-400">admin@prod-web-01:~$</div>
									<div className="text-secondary-300 mt-1">
										apt list --upgradable
									</div>
									<div className="text-secondary-500 mt-2">Listing... Done</div>
									<div className="text-yellow-400 mt-1">
										nginx/jammy-updates 1.24.0-2 amd64 [upgradable from:
										1.22.1-1]
									</div>
									<div className="text-yellow-400">
										openssl/jammy-security 3.0.14-1 amd64 [upgradable from:
										3.0.2-0]
									</div>
									<div className="mt-3 text-primary-400">
										🤖 AI Assistant: These packages have security patches
										available. Shall I create a patch job for the nginx and
										openssl updates?
									</div>
									<div className="mt-2 text-success-400">
										admin@prod-web-01:~${" "}
										<span className="animate-pulse">▋</span>
									</div>
								</div>
							</div>
						</div>
					</FadeIn>

					<FadeIn delay={150}>
						<div className="order-1 lg:order-2">
							<p className="text-primary-600 dark:text-primary-400 font-semibold text-sm uppercase tracking-wider mb-3">
								AI-Powered
							</p>
							<h2 className="text-3xl sm:text-4xl font-extrabold text-secondary-900 dark:text-white tracking-tight">
								AI Terminal Assistant Built Right In
							</h2>
							<p className="mt-4 text-lg text-secondary-600 dark:text-secondary-400 leading-relaxed">
								Connect your preferred AI provider — OpenRouter, Anthropic,
								OpenAI, or Google Gemini — and get intelligent help directly in
								your web SSH sessions.
							</p>
							<ul className="mt-8 space-y-3">
								{[
									"Context-aware suggestions based on host state",
									"Natural language commands for complex operations",
									"Integrated with your compliance and patch data",
								].map((t) => (
									<li
										key={t}
										className="flex items-center gap-3 text-secondary-700 dark:text-secondary-300"
									>
										<CheckCircle2 className="w-5 h-5 text-success-500 flex-shrink-0" />
										{t}
									</li>
								))}
							</ul>
						</div>
					</FadeIn>
				</div>
			</div>
		</section>
	);
}

// ─── Integrations ────────────────────────────────────────────────────────────
function Integrations() {
	const integrations = [
		{ name: "Proxmox", description: "Auto-enroll LXC containers" },
		{ name: "Ansible", description: "Dynamic inventory plugin" },
		{ name: "Checkmk", description: "Monitoring export" },
		{ name: "GetHomepage", description: "Dashboard widget" },
		{ name: "Discord", description: "OAuth2 login & alerts" },
		{ name: "OIDC / SSO", description: "Authentik, Keycloak, Okta" },
	];

	return (
		<section
			id="integrations"
			className="py-24 lg:py-32 bg-white dark:bg-secondary-900"
		>
			<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
				<FadeIn>
					<div className="text-center max-w-3xl mx-auto mb-16">
						<p className="text-primary-600 dark:text-primary-400 font-semibold text-sm uppercase tracking-wider mb-3">
							Integrations
						</p>
						<h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-secondary-900 dark:text-white tracking-tight">
							Fits Into Your Stack
						</h2>
						<p className="mt-4 text-lg text-secondary-600 dark:text-secondary-400">
							Monux integrates with the tools you already use, making adoption
							seamless.
						</p>
					</div>
				</FadeIn>

				<div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
					{integrations.map((item, i) => (
						<FadeIn key={item.name} delay={i * 80}>
							<div className="p-6 rounded-2xl border border-secondary-200 dark:border-secondary-700 bg-secondary-50 dark:bg-secondary-800 text-center hover:border-primary-300 dark:hover:border-primary-600 transition-all hover:shadow-lg">
								<div className="w-14 h-14 mx-auto mb-4 rounded-xl bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center text-primary-600 dark:text-primary-400">
									<Layers className="w-7 h-7" />
								</div>
								<h3 className="text-lg font-bold text-secondary-900 dark:text-white">
									{item.name}
								</h3>
								<p className="text-sm text-secondary-500 dark:text-secondary-400 mt-1">
									{item.description}
								</p>
							</div>
						</FadeIn>
					))}
				</div>
			</div>
		</section>
	);
}

// ─── How It Works ────────────────────────────────────────────────────────────
function HowItWorks() {
	const steps = [
		{
			step: "01",
			title: "Deploy the Server",
			description:
				"Run a single docker compose up command. The Monux backend, frontend, and database are ready in under a minute.",
		},
		{
			step: "02",
			title: "Install the Agent",
			description:
				"A single shell command installs the lightweight Go agent on each host. It auto-enrolls and starts reporting immediately.",
		},
		{
			step: "03",
			title: "Monitor & Manage",
			description:
				"See packages, patches, compliance scores, Docker containers, and more — all in one unified dashboard with full API access.",
		},
	];

	return (
		<section className="py-24 lg:py-32 bg-secondary-50 dark:bg-secondary-950">
			<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
				<FadeIn>
					<div className="text-center max-w-3xl mx-auto mb-16">
						<p className="text-primary-600 dark:text-primary-400 font-semibold text-sm uppercase tracking-wider mb-3">
							Get Started
						</p>
						<h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-secondary-900 dark:text-white tracking-tight">
							Up and Running in Minutes
						</h2>
					</div>
				</FadeIn>

				<div className="grid md:grid-cols-3 gap-8 lg:gap-12">
					{steps.map((s, i) => (
						<FadeIn key={s.step} delay={i * 120}>
							<div className="relative text-center">
								<div className="text-6xl font-extrabold text-primary-100 dark:text-primary-900/40 mb-4">
									{s.step}
								</div>
								<h3 className="text-xl font-bold text-secondary-900 dark:text-white mb-3">
									{s.title}
								</h3>
								<p className="text-secondary-600 dark:text-secondary-400 leading-relaxed">
									{s.description}
								</p>
								{i < steps.length - 1 && (
									<div className="hidden md:block absolute top-8 right-0 translate-x-1/2 text-primary-300 dark:text-primary-700">
										<ArrowRight className="w-6 h-6" />
									</div>
								)}
							</div>
						</FadeIn>
					))}
				</div>
			</div>
		</section>
	);
}

// ─── CTA Section ─────────────────────────────────────────────────────────────
function CTA() {
	return (
		<section className="py-24 lg:py-32 bg-gradient-to-br from-primary-600 to-primary-800 dark:from-primary-700 dark:to-primary-900 relative overflow-hidden">
			<div className="absolute inset-0 opacity-10">
				<div className="absolute top-0 left-1/4 w-96 h-96 bg-white rounded-full blur-3xl" />
				<div className="absolute bottom-0 right-1/4 w-72 h-72 bg-white rounded-full blur-3xl" />
			</div>

			<div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
				<FadeIn>
					<h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-white tracking-tight">
						Ready to Take Control of Your Fleet?
					</h2>
					<p className="mt-6 text-xl text-primary-100 max-w-2xl mx-auto">
						Join teams using Monux to streamline Linux patch management,
						compliance, and server operations.
					</p>
					<div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
						<Link
							to="/login"
							className="inline-flex items-center gap-2 px-8 py-3.5 rounded-xl bg-white text-primary-700 font-semibold text-base hover:bg-primary-50 shadow-xl transition-all hover:-translate-y-0.5"
						>
							Get Started Now
							<ArrowRight className="w-5 h-5" />
						</Link>
						<a
							href="https://github.com/wittyphantom333/linux-management"
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex items-center gap-2 px-8 py-3.5 rounded-xl border-2 border-white/30 text-white font-semibold text-base hover:bg-white/10 transition-all"
						>
							View on GitHub
						</a>
					</div>
				</FadeIn>
			</div>
		</section>
	);
}

// ─── Footer ──────────────────────────────────────────────────────────────────
function Footer() {
	return (
		<footer className="bg-secondary-900 dark:bg-secondary-950 border-t border-secondary-800">
			<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
				<div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
					<div className="sm:col-span-2 lg:col-span-1">
						<div className="flex items-center gap-3 mb-4">
							<img
								src="/assets/logo_dark.png"
								alt="Monux"
								className="h-8 w-auto"
							/>
							<span className="text-lg font-bold text-white">Monux</span>
						</div>
						<p className="text-secondary-400 text-sm leading-relaxed">
							Enterprise-grade Linux fleet management. Open-source, self-hosted,
							and built for teams who value visibility and control.
						</p>
					</div>

					<div>
						<h4 className="text-sm font-semibold text-white uppercase tracking-wider mb-4">
							Product
						</h4>
						<ul className="space-y-2">
							<li>
								<a
									href="#features"
									className="text-sm text-secondary-400 hover:text-white transition-colors"
								>
									Features
								</a>
							</li>
							<li>
								<a
									href="#security"
									className="text-sm text-secondary-400 hover:text-white transition-colors"
								>
									Security
								</a>
							</li>
							<li>
								<a
									href="#integrations"
									className="text-sm text-secondary-400 hover:text-white transition-colors"
								>
									Integrations
								</a>
							</li>
							<li>
								<a
									href="https://docs.patchmon.net"
									target="_blank"
									rel="noopener noreferrer"
									className="text-sm text-secondary-400 hover:text-white transition-colors"
								>
									Documentation
								</a>
							</li>
						</ul>
					</div>

					<div>
						<h4 className="text-sm font-semibold text-white uppercase tracking-wider mb-4">
							Resources
						</h4>
						<ul className="space-y-2">
							<li>
								<a
									href="https://github.com/wittyphantom333/linux-management"
									target="_blank"
									rel="noopener noreferrer"
									className="text-sm text-secondary-400 hover:text-white transition-colors"
								>
									GitHub
								</a>
							</li>
							<li>
								<a
									href="https://docs.patchmon.net"
									target="_blank"
									rel="noopener noreferrer"
									className="text-sm text-secondary-400 hover:text-white transition-colors"
								>
									API Reference
								</a>
							</li>
							<li>
								<a
									href="https://patchmon.net"
									target="_blank"
									rel="noopener noreferrer"
									className="text-sm text-secondary-400 hover:text-white transition-colors"
								>
									Website
								</a>
							</li>
						</ul>
					</div>

					<div>
						<h4 className="text-sm font-semibold text-white uppercase tracking-wider mb-4">
							Community
						</h4>
						<ul className="space-y-2">
							<li>
								<a
									href="https://discord.gg/monux"
									target="_blank"
									rel="noopener noreferrer"
									className="text-sm text-secondary-400 hover:text-white transition-colors"
								>
									Discord
								</a>
							</li>
							<li>
								<a
									href="https://github.com/wittyphantom333/linux-management"
									target="_blank"
									rel="noopener noreferrer"
									className="text-sm text-secondary-400 hover:text-white transition-colors"
								>
									Contribute
								</a>
							</li>
							<li>
								<a
									href="https://www.youtube.com/@monux"
									target="_blank"
									rel="noopener noreferrer"
									className="text-sm text-secondary-400 hover:text-white transition-colors"
								>
									YouTube
								</a>
							</li>
						</ul>
					</div>
				</div>

				<div className="mt-12 pt-8 border-t border-secondary-800 flex flex-col sm:flex-row items-center justify-between gap-4">
					<p className="text-sm text-secondary-500">
						&copy; {new Date().getFullYear()} Monux. All rights reserved.
					</p>
					<div className="flex items-center gap-6">
						<a
							href="https://github.com/wittyphantom333/linux-management"
							target="_blank"
							rel="noopener noreferrer"
							className="text-secondary-500 hover:text-white transition-colors"
						>
							<svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
								<path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
							</svg>
						</a>
						<a
							href="https://discord.gg/monux"
							target="_blank"
							rel="noopener noreferrer"
							className="text-secondary-500 hover:text-white transition-colors"
						>
							<svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
								<path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z" />
							</svg>
						</a>
					</div>
				</div>
			</div>
		</footer>
	);
}

// ─── Main Landing Page ───────────────────────────────────────────────────────
const LandingPage = () => {
	return (
		<div className="min-h-screen bg-white dark:bg-secondary-900">
			<Nav />
			<Hero />
			<Features />
			<Platform />
			<Security />
			<AiTerminal />
			<HowItWorks />
			<Integrations />
			<CTA />
			<Footer />
		</div>
	);
};

export default LandingPage;
