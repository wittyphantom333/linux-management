import {
	ArrowRight,
	BarChart3,
	Bot,
	CheckCircle2,
	ChevronRight,
	Cloud,
	Code2,
	Container,
	Globe,
	KeyRound,
	Layers,
	Lock,
	Monitor,
	Package,
	RefreshCw,
	Server,
	Settings,
	Shield,
	ShieldCheck,
	Sparkles,
	Users,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

/* ═══════════════════════════════════════════════════════════════════════════
   UTILITIES
   ═══════════════════════════════════════════════════════════════════════════ */

function FadeIn({ children, className = "", delay = 0 }) {
	const ref = useRef(null);
	const [v, setV] = useState(false);
	useEffect(() => {
		const obs = new IntersectionObserver(
			([e]) => e.isIntersecting && setV(true),
			{ threshold: 0.12 },
		);
		if (ref.current) obs.observe(ref.current);
		return () => obs.disconnect();
	}, []);
	return (
		<div
			ref={ref}
			className={`transition-all duration-700 ease-out ${v ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"} ${className}`}
			style={{ transitionDelay: `${delay}ms` }}
		>
			{children}
		</div>
	);
}

/** Animated dot-grid background rendered on <canvas> */
function GridCanvas() {
	const canvasRef = useRef(null);
	const mouse = useRef({ x: -1000, y: -1000 });
	const raf = useRef(null);

	const draw = useCallback(() => {
		const c = canvasRef.current;
		if (!c) return;
		const ctx = c.getContext("2d");
		const dpr = window.devicePixelRatio || 1;
		const w = c.clientWidth;
		const h = c.clientHeight;
		c.width = w * dpr;
		c.height = h * dpr;
		ctx.scale(dpr, dpr);
		ctx.clearRect(0, 0, w, h);

		const gap = 32;
		const radius = 1;
		const mx = mouse.current.x;
		const my = mouse.current.y;
		const influence = 120;

		for (let x = gap; x < w; x += gap) {
			for (let y = gap; y < h; y += gap) {
				const dx = x - mx;
				const dy = y - my;
				const dist = Math.sqrt(dx * dx + dy * dy);
				const t = Math.max(0, 1 - dist / influence);
				const r = radius + t * 2.5;
				const alpha = 0.08 + t * 0.35;
				ctx.beginPath();
				ctx.arc(x, y, r, 0, Math.PI * 2);
				ctx.fillStyle = `rgba(96,165,250,${alpha})`;
				ctx.fill();
			}
		}
		raf.current = requestAnimationFrame(draw);
	}, []);

	useEffect(() => {
		const handleMove = (e) => {
			const rect = canvasRef.current?.getBoundingClientRect();
			if (rect) {
				mouse.current = {
					x: e.clientX - rect.left,
					y: e.clientY - rect.top,
				};
			}
		};
		window.addEventListener("pointermove", handleMove, { passive: true });
		raf.current = requestAnimationFrame(draw);
		return () => {
			window.removeEventListener("pointermove", handleMove);
			cancelAnimationFrame(raf.current);
		};
	}, [draw]);

	return (
		<canvas
			ref={canvasRef}
			className="absolute inset-0 w-full h-full pointer-events-none"
		/>
	);
}

/* ═══════════════════════════════════════════════════════════════════════════
   NAVIGATION
   ═══════════════════════════════════════════════════════════════════════════ */

function Nav() {
	const [scrolled, setScrolled] = useState(false);
	const [open, setOpen] = useState(false);

	useEffect(() => {
		const fn = () => setScrolled(window.scrollY > 10);
		window.addEventListener("scroll", fn, { passive: true });
		return () => window.removeEventListener("scroll", fn);
	}, []);

	const links = [
		{ label: "Features", href: "#features" },
		{ label: "Platform", href: "#platform" },
		{ label: "Security", href: "#security" },
		{ label: "Integrations", href: "#integrations" },
		{ label: "Docs", href: "https://docs.patchmon.net", ext: true },
	];

	return (
		<nav
			className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${scrolled ? "bg-[#0a0e1a]/80 backdrop-blur-xl border-b border-white/[0.06]" : ""}`}
		>
			<div className="max-w-7xl mx-auto flex items-center justify-between h-16 px-5 lg:px-8">
				{/* Logo */}
				<Link to="/" className="flex items-center gap-2.5 group">
					<img src="/assets/logo_dark.png" alt="" className="h-7 w-auto" />
					<span className="text-[15px] font-semibold text-white tracking-tight">
						Monux
					</span>
				</Link>

				{/* Desktop links */}
				<div className="hidden md:flex items-center gap-1">
					{links.map((l) =>
						l.ext ? (
							<a
								key={l.label}
								href={l.href}
								target="_blank"
								rel="noopener noreferrer"
								className="px-3 py-1.5 text-[13px] text-white/50 hover:text-white transition-colors"
							>
								{l.label}
							</a>
						) : (
							<a
								key={l.label}
								href={l.href}
								className="px-3 py-1.5 text-[13px] text-white/50 hover:text-white transition-colors"
							>
								{l.label}
							</a>
						),
					)}
				</div>

				{/* Desktop CTA */}
				<div className="hidden md:flex items-center gap-3">
					<Link
						to="/login"
						className="text-[13px] text-white/60 hover:text-white transition-colors px-3 py-1.5"
					>
						Sign in
					</Link>
					<Link
						to="/login"
						className="relative group inline-flex items-center gap-1.5 text-[13px] font-medium text-white px-4 py-2 rounded-lg bg-white/[0.08] border border-white/[0.1] hover:bg-white/[0.14] hover:border-white/[0.18] transition-all"
					>
						Get Started
						<ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
					</Link>
				</div>

				{/* Mobile toggle */}
				<button
					type="button"
					onClick={() => setOpen(!open)}
					className="md:hidden text-white/60 p-1.5"
				>
					<svg
						className="w-5 h-5"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						strokeWidth={1.5}
					>
						{open ? (
							<path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
						) : (
							<path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />
						)}
					</svg>
				</button>
			</div>

			{/* Mobile dropdown */}
			{open && (
				<div className="md:hidden bg-[#0a0e1a]/95 backdrop-blur-xl border-t border-white/[0.06] px-5 pb-5 pt-3 space-y-1">
					{links.map((l) => (
						<a
							key={l.label}
							href={l.href}
							onClick={() => setOpen(false)}
							className="block py-2 text-sm text-white/60 hover:text-white"
						>
							{l.label}
						</a>
					))}
					<Link
						to="/login"
						onClick={() => setOpen(false)}
						className="block mt-3 text-center py-2.5 rounded-lg bg-white/10 text-sm font-medium text-white"
					>
						Get Started
					</Link>
				</div>
			)}
		</nav>
	);
}

/* ═══════════════════════════════════════════════════════════════════════════
   HERO
   ═══════════════════════════════════════════════════════════════════════════ */

function Hero() {
	return (
		<section className="relative min-h-[100dvh] flex items-center justify-center overflow-hidden">
			{/* Layered bg */}
			<div className="absolute inset-0 bg-[#060a14]" />
			<div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(59,130,246,0.15),transparent)]" />
			<div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_40%_at_80%_100%,rgba(139,92,246,0.08),transparent)]" />
			<GridCanvas />

			{/* Glow orbs */}
			<div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-primary-500/[0.07] rounded-full blur-[120px] pointer-events-none" />

			<div className="relative max-w-5xl mx-auto text-center px-5 pt-28 pb-20 lg:pt-36 lg:pb-28">
				<FadeIn>
					<div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full border border-white/[0.08] bg-white/[0.04] text-[13px] text-white/60 mb-8">
						<Sparkles className="w-3.5 h-3.5 text-primary-400" />
						<span>Now with AI Terminal Assistant</span>
						<ChevronRight className="w-3 h-3 text-white/30" />
					</div>
				</FadeIn>

				<FadeIn delay={80}>
					<h1 className="text-[clamp(2.25rem,6vw,4.5rem)] font-extrabold leading-[1.08] tracking-tight text-white">
						The command center for{" "}
						<span className="bg-gradient-to-r from-primary-400 via-blue-300 to-violet-400 bg-clip-text text-transparent">
							your Linux fleet
						</span>
					</h1>
				</FadeIn>

				<FadeIn delay={160}>
					<p className="mt-5 text-lg sm:text-xl text-white/45 max-w-2xl mx-auto leading-relaxed">
						Packages, patches, compliance, Docker, SSH — unified in one
						dashboard. Deploy in minutes, manage thousands of hosts.
					</p>
				</FadeIn>

				<FadeIn delay={240}>
					<div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
						<Link
							to="/login"
							className="group inline-flex items-center gap-2 px-7 py-3 rounded-xl text-[15px] font-semibold text-white bg-gradient-to-b from-primary-500 to-primary-600 shadow-[0_0_24px_rgba(59,130,246,0.35)] hover:shadow-[0_0_32px_rgba(59,130,246,0.5)] transition-all hover:-translate-y-0.5"
						>
							Start for Free
							<ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
						</Link>
						<a
							href="https://github.com/wittyphantom333/linux-management"
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex items-center gap-2 px-7 py-3 rounded-xl text-[15px] font-medium text-white/70 border border-white/[0.1] hover:bg-white/[0.06] hover:text-white transition-all"
						>
							<svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
								<path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
							</svg>
							Star on GitHub
						</a>
					</div>
				</FadeIn>

				{/* Hero dashboard mockup — glassmorphic */}
				<FadeIn delay={380}>
					<div className="mt-20 relative max-w-4xl mx-auto">
						{/* Glow behind card */}
						<div className="absolute -inset-4 bg-gradient-to-b from-primary-500/15 to-violet-500/10 rounded-3xl blur-2xl pointer-events-none" />
						<div className="relative rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-md overflow-hidden shadow-2xl">
							{/* Title bar */}
							<div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/[0.06]">
								<div className="flex gap-1.5">
									<div className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
									<div className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
									<div className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
								</div>
								<span className="ml-2 text-[11px] font-mono text-white/25">
									monux.yourcompany.com
								</span>
							</div>
							{/* Dashboard body */}
							<div className="p-5 lg:p-8">
								<div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
									<GlassCard
										icon={<Server className="w-4 h-4" />}
										label="Hosts"
										val="47"
										accent="from-blue-400 to-blue-600"
									/>
									<GlassCard
										icon={<Package className="w-4 h-4" />}
										label="Packages"
										val="3,284"
										accent="from-emerald-400 to-emerald-600"
									/>
									<GlassCard
										icon={<Shield className="w-4 h-4" />}
										label="Compliance"
										val="94%"
										accent="from-amber-400 to-amber-600"
									/>
									<GlassCard
										icon={<Container className="w-4 h-4" />}
										label="Containers"
										val="126"
										accent="from-violet-400 to-violet-600"
									/>
								</div>
								{/* Fake chart area */}
								<div className="mt-4 h-28 rounded-xl border border-white/[0.06] bg-white/[0.02] flex items-end px-6 pb-4 gap-[6px]">
									{[
										35, 42, 38, 55, 48, 62, 58, 70, 65, 78, 72, 85, 80, 90, 88,
										94, 91, 96,
									].map((h) => (
										<div
											key={`bar-${h}`}
											className="flex-1 rounded-sm bg-gradient-to-t from-primary-500/60 to-primary-400/30"
											style={{ height: `${h}%` }}
										/>
									))}
								</div>
							</div>
						</div>
					</div>
				</FadeIn>
			</div>
		</section>
	);
}

function GlassCard({ icon, label, val, accent }) {
	return (
		<div className="rounded-xl border border-white/[0.07] bg-white/[0.04] p-4 group hover:bg-white/[0.07] transition-colors">
			<div className="flex items-center gap-2 mb-2.5">
				<div
					className={`w-7 h-7 rounded-lg bg-gradient-to-br ${accent} flex items-center justify-center text-white shadow-lg`}
				>
					{icon}
				</div>
				<span className="text-[11px] font-medium text-white/40 uppercase tracking-wider">
					{label}
				</span>
			</div>
			<div className="text-2xl font-bold text-white">{val}</div>
		</div>
	);
}

/* ═══════════════════════════════════════════════════════════════════════════
   BENTO FEATURES
   ═══════════════════════════════════════════════════════════════════════════ */

function BentoFeatures() {
	return (
		<section id="features" className="relative py-28 lg:py-36 overflow-hidden">
			<div className="absolute inset-0 bg-[#060a14]" />
			<div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_40%_at_50%_0%,rgba(59,130,246,0.06),transparent)]" />

			<div className="relative max-w-7xl mx-auto px-5 lg:px-8">
				<FadeIn>
					<div className="text-center max-w-2xl mx-auto mb-16">
						<p className="text-primary-400 text-[13px] font-semibold uppercase tracking-widest mb-3">
							Features
						</p>
						<h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-white tracking-tight leading-[1.12]">
							Everything you need,
							<br className="hidden sm:block" /> nothing you don&apos;t
						</h2>
						<p className="mt-4 text-base text-white/40 leading-relaxed">
							A unified control plane for packages, patches, compliance,
							containers, and configuration.
						</p>
					</div>
				</FadeIn>

				{/* Bento grid */}
				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
					{/* Large card — Dashboard */}
					<FadeIn className="md:col-span-2 lg:col-span-2" delay={0}>
						<BentoCard className="h-full min-h-[280px]">
							<div className="flex flex-col h-full">
								<div className="flex items-center gap-3 mb-3">
									<IconBadge>
										<Monitor className="w-4 h-4" />
									</IconBadge>
									<h3 className="text-[15px] font-semibold text-white">
										Customizable Dashboard
									</h3>
								</div>
								<p className="text-sm text-white/40 leading-relaxed mb-5 max-w-md">
									Drag-and-drop widgets. Fleet health at a glance. Per-user
									layouts with real-time data.
								</p>
								{/* Mini dashboard mockup */}
								<div className="mt-auto grid grid-cols-4 gap-2">
									{["blue", "emerald", "amber", "violet"].map((c) => (
										<div
											key={c}
											className="h-16 rounded-lg border border-white/[0.06] bg-white/[0.03] animate-pulse"
											style={{
												animationDelay: `${Math.random() * 2}s`,
												animationDuration: "3s",
											}}
										/>
									))}
									<div className="col-span-4 h-14 rounded-lg border border-white/[0.06] bg-white/[0.02]" />
								</div>
							</div>
						</BentoCard>
					</FadeIn>

					{/* Packages */}
					<FadeIn delay={80}>
						<BentoCard>
							<IconBadge>
								<Package className="w-4 h-4" />
							</IconBadge>
							<h3 className="mt-3 text-[15px] font-semibold text-white">
								Package Management
							</h3>
							<p className="mt-2 text-sm text-white/40 leading-relaxed">
								Every installed package across your fleet. Filter outdated and
								security-critical instantly.
							</p>
						</BentoCard>
					</FadeIn>

					{/* Patch Mgmt */}
					<FadeIn delay={100}>
						<BentoCard>
							<IconBadge>
								<RefreshCw className="w-4 h-4" />
							</IconBadge>
							<h3 className="mt-3 text-[15px] font-semibold text-white">
								Patch Management
							</h3>
							<p className="mt-2 text-sm text-white/40 leading-relaxed">
								Policies, maintenance windows, and automated patch jobs across
								host groups.
							</p>
						</BentoCard>
					</FadeIn>

					{/* Compliance */}
					<FadeIn delay={120}>
						<BentoCard>
							<IconBadge>
								<ShieldCheck className="w-4 h-4" />
							</IconBadge>
							<h3 className="mt-3 text-[15px] font-semibold text-white">
								Compliance Scanning
							</h3>
							<p className="mt-2 text-sm text-white/40 leading-relaxed">
								CIS Benchmarks via OpenSCAP, Docker Bench for Security, with
								auto-remediation and trend tracking.
							</p>
						</BentoCard>
					</FadeIn>

					{/* Large card — Docker */}
					<FadeIn className="md:col-span-2 lg:col-span-2" delay={140}>
						<BentoCard className="h-full min-h-[240px]">
							<div className="flex flex-col h-full">
								<div className="flex items-center gap-3 mb-3">
									<IconBadge>
										<Container className="w-4 h-4" />
									</IconBadge>
									<h3 className="text-[15px] font-semibold text-white">
										Docker Monitoring
									</h3>
								</div>
								<p className="text-sm text-white/40 leading-relaxed max-w-md">
									Full visibility into containers, images, volumes, and
									networks. Real-time WebSocket status.
								</p>
								{/* Docker mockup */}
								<div className="mt-auto flex gap-2">
									{["nginx", "postgres", "redis", "app"].map((name) => (
										<div
											key={name}
											className="flex-1 rounded-lg border border-white/[0.06] bg-white/[0.03] p-3"
										>
											<div className="flex items-center gap-1.5 mb-1">
												<div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
												<span className="text-[10px] text-white/50 uppercase tracking-wider">
													{name}
												</span>
											</div>
											<span className="text-[10px] text-white/25 font-mono">
												running
											</span>
										</div>
									))}
								</div>
							</div>
						</BentoCard>
					</FadeIn>

					{/* Config Mgmt */}
					<FadeIn delay={160}>
						<BentoCard>
							<IconBadge>
								<Settings className="w-4 h-4" />
							</IconBadge>
							<h3 className="mt-3 text-[15px] font-semibold text-white">
								Config Management
							</h3>
							<p className="mt-2 text-sm text-white/40 leading-relaxed">
								Techniques, Directives, and Rules to enforce configurations
								fleet-wide with compliance tracking.
							</p>
						</BentoCard>
					</FadeIn>

					{/* Repos */}
					<FadeIn delay={180}>
						<BentoCard>
							<IconBadge>
								<Layers className="w-4 h-4" />
							</IconBadge>
							<h3 className="mt-3 text-[15px] font-semibold text-white">
								Repository Tracking
							</h3>
							<p className="mt-2 text-sm text-white/40 leading-relaxed">
								Monitor APT, YUM, and DNF repos across every host. Spot
								misconfigurations before trouble.
							</p>
						</BentoCard>
					</FadeIn>

					{/* Reporting */}
					<FadeIn delay={200}>
						<BentoCard>
							<IconBadge>
								<BarChart3 className="w-4 h-4" />
							</IconBadge>
							<h3 className="mt-3 text-[15px] font-semibold text-white">
								Reporting & Alerts
							</h3>
							<p className="mt-2 text-sm text-white/40 leading-relaxed">
								Severity-filtered reports. Alert channels for host-down, pending
								updates, and agent issues.
							</p>
						</BentoCard>
					</FadeIn>
				</div>
			</div>
		</section>
	);
}

function BentoCard({ children, className = "" }) {
	return (
		<div
			className={`group relative rounded-2xl border border-white/[0.06] bg-white/[0.025] p-6 hover:bg-white/[0.045] hover:border-white/[0.1] transition-all duration-300 ${className}`}
		>
			{/* Spotlight effect on hover */}
			<div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none bg-[radial-gradient(400px_circle_at_var(--mouse-x,50%)_var(--mouse-y,50%),rgba(59,130,246,0.06),transparent)]" />
			<div className="relative">{children}</div>
		</div>
	);
}

function IconBadge({ children }) {
	return (
		<div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-500/20 to-primary-600/10 border border-primary-500/20 flex items-center justify-center text-primary-400">
			{children}
		</div>
	);
}

/* ═══════════════════════════════════════════════════════════════════════════
   AI TERMINAL
   ═══════════════════════════════════════════════════════════════════════════ */

function AiTerminal() {
	const [typedLines, setTypedLines] = useState(0);

	const termRef = useRef(null);
	useEffect(() => {
		let id;
		const obs = new IntersectionObserver(
			([e]) => {
				if (e.isIntersecting) {
					id = setInterval(
						() => setTypedLines((p) => (p < 7 ? p + 1 : p)),
						400,
					);
				}
			},
			{ threshold: 0.3 },
		);
		if (termRef.current) obs.observe(termRef.current);
		return () => {
			obs.disconnect();
			clearInterval(id);
		};
	}, []);

	const lines = [
		{ type: "prompt", text: "admin@prod-web-01:~$" },
		{ type: "cmd", text: "apt list --upgradable" },
		{ type: "dim", text: "Listing... Done" },
		{
			type: "warn",
			text: "nginx/jammy-updates 1.24.0-2 [upgradable from: 1.22.1-1]",
		},
		{
			type: "warn",
			text: "openssl/jammy-security 3.0.14-1 [upgradable from: 3.0.2-0]",
		},
		{
			type: "ai",
			text: "Security patches available for nginx & openssl. Create a patch job?",
		},
		{ type: "cursor", text: "admin@prod-web-01:~$ " },
	];

	const lineColors = {
		prompt: "text-emerald-400",
		cmd: "text-white/70",
		dim: "text-white/30",
		warn: "text-amber-400/80",
		ai: "text-primary-400",
		cursor: "text-emerald-400",
	};

	return (
		<section className="relative py-28 lg:py-36 overflow-hidden">
			<div className="absolute inset-0 bg-[#060a14]" />
			<div className="absolute inset-0 bg-[radial-gradient(ellipse_50%_50%_at_20%_50%,rgba(59,130,246,0.06),transparent)]" />

			<div className="relative max-w-7xl mx-auto px-5 lg:px-8">
				<div className="grid lg:grid-cols-2 gap-16 items-center">
					{/* Terminal */}
					<FadeIn>
						<div ref={termRef} className="relative">
							<div className="absolute -inset-3 bg-gradient-to-br from-primary-500/10 to-violet-500/10 rounded-3xl blur-xl pointer-events-none" />
							<div className="relative rounded-2xl border border-white/[0.08] bg-[#0c1120] overflow-hidden shadow-2xl">
								<div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/[0.06]">
									<div className="flex gap-1.5">
										<div className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
										<div className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
										<div className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
									</div>
									<span className="ml-2 text-[11px] font-mono text-white/20">
										web-ssh - prod-web-01
									</span>
								</div>
								<div className="p-5 font-mono text-[13px] leading-relaxed min-h-[240px]">
									{lines.slice(0, typedLines).map((l, idx) => (
										<div
											key={`line-${l.type}-${l.text.slice(0, 12)}`}
											className={`${lineColors[l.type]} ${idx > 0 ? "mt-1" : ""}`}
										>
											{l.type === "ai" && (
												<span className="mr-1">
													<Bot className="w-3.5 h-3.5 inline -mt-0.5" />
												</span>
											)}
											{l.text}
											{l.type === "cursor" && (
												<span className="animate-pulse">▋</span>
											)}
										</div>
									))}
								</div>
							</div>
						</div>
					</FadeIn>

					{/* Copy */}
					<FadeIn delay={120}>
						<div>
							<p className="text-primary-400 text-[13px] font-semibold uppercase tracking-widest mb-3">
								AI-Powered
							</p>
							<h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight leading-tight">
								Your AI copilot,
								<br /> right in the terminal
							</h2>
							<p className="mt-4 text-base text-white/40 leading-relaxed max-w-md">
								Connect OpenRouter, Anthropic, OpenAI, or Gemini. Get
								context-aware help directly inside your web SSH sessions.
							</p>
							<ul className="mt-8 space-y-3">
								{[
									"Context-aware suggestions based on host state",
									"Natural language commands for complex ops",
									"Integrated with compliance and patch data",
								].map((t) => (
									<li
										key={t}
										className="flex items-start gap-3 text-sm text-white/50"
									>
										<CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-400/70 flex-shrink-0" />
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

/* ═══════════════════════════════════════════════════════════════════════════
   PLATFORM
   ═══════════════════════════════════════════════════════════════════════════ */

function Platform() {
	const items = [
		{
			icon: <Server className="w-5 h-5" />,
			title: "Lightweight Agent",
			desc: "Single Go binary. Linux & FreeBSD. Outbound-only connections — zero open ports on your hosts.",
		},
		{
			icon: <Globe className="w-5 h-5" />,
			title: "Beautiful Web UI",
			desc: "Responsive React dashboard with custom branding, themes, and per-user dark/light mode.",
		},
		{
			icon: <Code2 className="w-5 h-5" />,
			title: "Full REST API",
			desc: "Every feature via /api/v1 with JWT auth. Full Swagger/OpenAPI documentation included.",
		},
		{
			icon: <Cloud className="w-5 h-5" />,
			title: "Self-Hosted or Cloud",
			desc: "Docker Compose on your infra, or let us handle everything with Monux Cloud.",
		},
	];

	return (
		<section id="platform" className="relative py-28 lg:py-36 overflow-hidden">
			<div className="absolute inset-0 bg-[#060a14]" />
			<div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_100%,rgba(59,130,246,0.05),transparent)]" />

			<div className="relative max-w-7xl mx-auto px-5 lg:px-8">
				<FadeIn>
					<div className="text-center max-w-2xl mx-auto mb-16">
						<p className="text-primary-400 text-[13px] font-semibold uppercase tracking-widest mb-3">
							Platform
						</p>
						<h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-white tracking-tight leading-[1.12]">
							Built for the way you work
						</h2>
					</div>
				</FadeIn>

				<div className="grid md:grid-cols-2 gap-4">
					{items.map((it, i) => (
						<FadeIn key={it.title} delay={i * 80}>
							<div className="group rounded-2xl border border-white/[0.06] bg-white/[0.025] p-6 hover:bg-white/[0.045] hover:border-white/[0.1] transition-all duration-300">
								<div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500/20 to-primary-600/10 border border-primary-500/20 flex items-center justify-center text-primary-400 mb-4 group-hover:scale-105 transition-transform">
									{it.icon}
								</div>
								<h3 className="text-[15px] font-semibold text-white mb-2">
									{it.title}
								</h3>
								<p className="text-sm text-white/40 leading-relaxed">
									{it.desc}
								</p>
							</div>
						</FadeIn>
					))}
				</div>
			</div>
		</section>
	);
}

/* ═══════════════════════════════════════════════════════════════════════════
   SECURITY
   ═══════════════════════════════════════════════════════════════════════════ */

function Security() {
	const points = [
		{
			icon: <Lock className="w-4 h-4" />,
			text: "Outbound-only agent — zero inbound ports on managed hosts",
		},
		{
			icon: <KeyRound className="w-4 h-4" />,
			text: "OIDC SSO with Authentik, Keycloak, Okta, and any provider",
		},
		{
			icon: <Users className="w-4 h-4" />,
			text: "Granular RBAC with fully customizable roles and permissions",
		},
		{
			icon: <ShieldCheck className="w-4 h-4" />,
			text: "Two-factor auth with TOTP, QR codes, and backup recovery",
		},
		{
			icon: <Shield className="w-4 h-4" />,
			text: "httpOnly cookies, rate limiting, and IP allow-lists",
		},
		{
			icon: <Code2 className="w-4 h-4" />,
			text: "Scoped API credentials for integrations and automation",
		},
	];

	return (
		<section id="security" className="relative py-28 lg:py-36 overflow-hidden">
			<div className="absolute inset-0 bg-[#060a14]" />
			<div className="absolute inset-0 bg-[radial-gradient(ellipse_50%_50%_at_80%_50%,rgba(139,92,246,0.06),transparent)]" />

			<div className="relative max-w-7xl mx-auto px-5 lg:px-8">
				<div className="grid lg:grid-cols-2 gap-16 items-center">
					<FadeIn>
						<div>
							<p className="text-primary-400 text-[13px] font-semibold uppercase tracking-widest mb-3">
								Security
							</p>
							<h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight leading-tight">
								Security by design,
								<br /> not an afterthought
							</h2>
							<p className="mt-4 text-base text-white/40 leading-relaxed max-w-md">
								Every layer is built with security in mind — from the agent
								architecture to authentication.
							</p>
						</div>
					</FadeIn>

					<FadeIn delay={120}>
						<div className="space-y-2.5">
							{points.map((p) => (
								<div
									key={p.text}
									className="flex items-center gap-4 p-3.5 rounded-xl border border-white/[0.06] bg-white/[0.025] hover:bg-white/[0.04] transition-colors"
								>
									<div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 flex-shrink-0">
										{p.icon}
									</div>
									<span className="text-sm text-white/55">{p.text}</span>
								</div>
							))}
						</div>
					</FadeIn>
				</div>
			</div>
		</section>
	);
}

/* ═══════════════════════════════════════════════════════════════════════════
   INTEGRATIONS
   ═══════════════════════════════════════════════════════════════════════════ */

function Integrations() {
	const items = [
		{ name: "Proxmox", sub: "Auto-enroll LXC" },
		{ name: "Ansible", sub: "Dynamic inventory" },
		{ name: "Checkmk", sub: "Monitoring export" },
		{ name: "GetHomepage", sub: "Dashboard widget" },
		{ name: "Discord", sub: "OAuth2 & alerts" },
		{ name: "OIDC / SSO", sub: "Any OIDC provider" },
	];

	return (
		<section
			id="integrations"
			className="relative py-28 lg:py-36 overflow-hidden"
		>
			<div className="absolute inset-0 bg-[#060a14]" />
			<div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_40%_at_50%_0%,rgba(59,130,246,0.05),transparent)]" />

			<div className="relative max-w-7xl mx-auto px-5 lg:px-8">
				<FadeIn>
					<div className="text-center max-w-2xl mx-auto mb-14">
						<p className="text-primary-400 text-[13px] font-semibold uppercase tracking-widest mb-3">
							Integrations
						</p>
						<h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-white tracking-tight leading-[1.12]">
							Fits into your stack
						</h2>
						<p className="mt-4 text-base text-white/40">
							Seamless connections with the tools you already use.
						</p>
					</div>
				</FadeIn>

				<div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
					{items.map((it, i) => (
						<FadeIn key={it.name} delay={i * 60}>
							<div className="group rounded-2xl border border-white/[0.06] bg-white/[0.025] p-5 text-center hover:bg-white/[0.05] hover:border-white/[0.12] transition-all duration-300">
								<div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-gradient-to-br from-primary-500/15 to-violet-500/10 border border-white/[0.08] flex items-center justify-center text-primary-400 group-hover:scale-110 transition-transform">
									<Layers className="w-5 h-5" />
								</div>
								<h3 className="text-sm font-semibold text-white">{it.name}</h3>
								<p className="text-xs text-white/35 mt-0.5">{it.sub}</p>
							</div>
						</FadeIn>
					))}
				</div>
			</div>
		</section>
	);
}

/* ═══════════════════════════════════════════════════════════════════════════
   HOW IT WORKS
   ═══════════════════════════════════════════════════════════════════════════ */

function HowItWorks() {
	const steps = [
		{
			n: "01",
			title: "Deploy",
			desc: "docker compose up — backend, frontend, and database ready in under a minute.",
		},
		{
			n: "02",
			title: "Enroll",
			desc: "One shell command installs the Go agent. It auto-enrolls and starts reporting immediately.",
		},
		{
			n: "03",
			title: "Manage",
			desc: "Packages, patches, compliance, Docker — unified in one dashboard with full API access.",
		},
	];

	return (
		<section className="relative py-28 lg:py-36 overflow-hidden">
			<div className="absolute inset-0 bg-[#060a14]" />

			<div className="relative max-w-4xl mx-auto px-5 lg:px-8">
				<FadeIn>
					<div className="text-center mb-16">
						<p className="text-primary-400 text-[13px] font-semibold uppercase tracking-widest mb-3">
							Get Started
						</p>
						<h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-white tracking-tight">
							Up and running in minutes
						</h2>
					</div>
				</FadeIn>

				<div className="grid md:grid-cols-3 gap-8">
					{steps.map((s, i) => (
						<FadeIn key={s.n} delay={i * 100}>
							<div className="text-center">
								<div className="text-5xl font-black bg-gradient-to-b from-white/15 to-white/[0.03] bg-clip-text text-transparent mb-4">
									{s.n}
								</div>
								<h3 className="text-lg font-bold text-white mb-2">{s.title}</h3>
								<p className="text-sm text-white/40 leading-relaxed">
									{s.desc}
								</p>
							</div>
						</FadeIn>
					))}
				</div>
			</div>
		</section>
	);
}

/* ═══════════════════════════════════════════════════════════════════════════
   CTA
   ═══════════════════════════════════════════════════════════════════════════ */

function CTA() {
	return (
		<section className="relative py-28 lg:py-36 overflow-hidden">
			<div className="absolute inset-0 bg-[#060a14]" />
			<div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_50%,rgba(59,130,246,0.12),transparent)]" />

			<div className="relative max-w-3xl mx-auto text-center px-5">
				<FadeIn>
					<h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-white tracking-tight leading-tight">
						Ready to take control
						<br /> of your fleet?
					</h2>
					<p className="mt-5 text-lg text-white/40 max-w-xl mx-auto">
						Join teams using Monux to streamline Linux operations. Open-source,
						self-hosted, and free to start.
					</p>
					<div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
						<Link
							to="/login"
							className="group inline-flex items-center gap-2 px-8 py-3.5 rounded-xl text-[15px] font-semibold text-white bg-gradient-to-b from-primary-500 to-primary-600 shadow-[0_0_32px_rgba(59,130,246,0.3)] hover:shadow-[0_0_48px_rgba(59,130,246,0.45)] transition-all hover:-translate-y-0.5"
						>
							Get Started Now
							<ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
						</Link>
						<a
							href="https://github.com/wittyphantom333/linux-management"
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex items-center gap-2 px-8 py-3.5 rounded-xl text-[15px] font-medium text-white/60 border border-white/[0.1] hover:bg-white/[0.06] hover:text-white transition-all"
						>
							View on GitHub
						</a>
					</div>
				</FadeIn>
			</div>
		</section>
	);
}

/* ═══════════════════════════════════════════════════════════════════════════
   FOOTER
   ═══════════════════════════════════════════════════════════════════════════ */

function Footer() {
	const cols = [
		{
			title: "Product",
			links: [
				{ label: "Features", href: "#features" },
				{ label: "Security", href: "#security" },
				{ label: "Integrations", href: "#integrations" },
				{
					label: "Documentation",
					href: "https://docs.patchmon.net",
					ext: true,
				},
			],
		},
		{
			title: "Resources",
			links: [
				{
					label: "GitHub",
					href: "https://github.com/wittyphantom333/linux-management",
					ext: true,
				},
				{
					label: "API Reference",
					href: "https://docs.patchmon.net",
					ext: true,
				},
				{ label: "Website", href: "https://patchmon.net", ext: true },
			],
		},
		{
			title: "Community",
			links: [
				{ label: "Discord", href: "https://discord.gg/monux", ext: true },
				{
					label: "YouTube",
					href: "https://www.youtube.com/@monux",
					ext: true,
				},
				{
					label: "Contribute",
					href: "https://github.com/wittyphantom333/linux-management",
					ext: true,
				},
			],
		},
	];

	return (
		<footer className="relative border-t border-white/[0.06] bg-[#060a14]">
			<div className="max-w-7xl mx-auto px-5 lg:px-8 py-14 lg:py-20">
				<div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-10">
					{/* Brand */}
					<div>
						<div className="flex items-center gap-2.5 mb-4">
							<img src="/assets/logo_dark.png" alt="" className="h-7 w-auto" />
							<span className="text-sm font-semibold text-white">Monux</span>
						</div>
						<p className="text-[13px] text-white/30 leading-relaxed max-w-[220px]">
							Enterprise-grade Linux fleet management. Open-source, self-hosted,
							built for teams who demand visibility.
						</p>
					</div>

					{cols.map((c) => (
						<div key={c.title}>
							<h4 className="text-[11px] font-semibold text-white/50 uppercase tracking-widest mb-4">
								{c.title}
							</h4>
							<ul className="space-y-2.5">
								{c.links.map((l) => (
									<li key={l.label}>
										<a
											href={l.href}
											{...(l.ext
												? { target: "_blank", rel: "noopener noreferrer" }
												: {})}
											className="text-[13px] text-white/35 hover:text-white transition-colors"
										>
											{l.label}
										</a>
									</li>
								))}
							</ul>
						</div>
					))}
				</div>

				<div className="mt-14 pt-8 border-t border-white/[0.06] flex flex-col sm:flex-row items-center justify-between gap-4">
					<p className="text-[12px] text-white/20">
						&copy; {new Date().getFullYear()} Monux. All rights reserved.
					</p>
					<div className="flex items-center gap-5">
						<a
							href="https://github.com/wittyphantom333/linux-management"
							target="_blank"
							rel="noopener noreferrer"
							className="text-white/20 hover:text-white/60 transition-colors"
						>
							<svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
								<path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
							</svg>
						</a>
						<a
							href="https://discord.gg/monux"
							target="_blank"
							rel="noopener noreferrer"
							className="text-white/20 hover:text-white/60 transition-colors"
						>
							<svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
								<path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z" />
							</svg>
						</a>
					</div>
				</div>
			</div>
		</footer>
	);
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN
   ═══════════════════════════════════════════════════════════════════════════ */

const LandingPage = () => (
	<div className="min-h-screen bg-[#060a14] text-white antialiased">
		<Nav />
		<Hero />
		<BentoFeatures />
		<AiTerminal />
		<Platform />
		<Security />
		<HowItWorks />
		<Integrations />
		<CTA />
		<Footer />
	</div>
);

export default LandingPage;
