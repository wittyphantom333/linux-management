import { useQuery } from "@tanstack/react-query";
import {
	AlertCircle,
	ArrowLeft,
	Eye,
	EyeOff,
	Lock,
	Mail,
	User,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { Link, useNavigate } from "react-router-dom";
import DiscordIcon from "../components/DiscordIcon";
import { useAuth } from "../contexts/AuthContext";
import { authAPI, isCorsError, settingsAPI } from "../utils/api";

const Login = () => {
	const usernameId = useId();
	const firstNameId = useId();
	const lastNameId = useId();
	const emailId = useId();
	const passwordId = useId();
	const tokenId = useId();
	const rememberMeId = useId();
	const { login, setAuthState } = useAuth();
	const [isSignupMode, setIsSignupMode] = useState(false);
	const [formData, setFormData] = useState({
		username: "",
		email: "",
		password: "",
		firstName: "",
		lastName: "",
	});
	const [tfaData, setTfaData] = useState({
		token: "",
		remember_me: false,
	});
	const [showPassword, setShowPassword] = useState(false);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState("");
	const [requiresTfa, setRequiresTfa] = useState(false);
	const [tfaUsername, setTfaUsername] = useState("");
	const [signupEnabled, setSignupEnabled] = useState(false);
	const [oidcConfig, setOidcConfig] = useState({
		enabled: false,
		buttonText: "Login with SSO",
		disableLocalAuth: false,
	});
	const [discordConfig, setDiscordConfig] = useState({
		enabled: false,
		buttonText: "Login with Discord",
	});
	const [oidcProcessed, setOidcProcessed] = useState(false);
	const canvasRef = useRef(null);
	const mouse = useRef({ x: -1000, y: -1000 });
	const raf = useRef(null);

	const navigate = useNavigate();

	// Fetch settings for favicon
	const { data: settings } = useQuery({
		queryKey: ["settings"],
		queryFn: () => settingsAPI.get().then((res) => res.data),
	});

	// Animated dot-grid canvas (matches landing page)
	const drawGrid = useCallback(() => {
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
		raf.current = requestAnimationFrame(drawGrid);
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
		raf.current = requestAnimationFrame(drawGrid);
		return () => {
			window.removeEventListener("pointermove", handleMove);
			cancelAnimationFrame(raf.current);
		};
	}, [drawGrid]);

	// Check login settings (signup enabled)
	useEffect(() => {
		const checkLoginSettings = async () => {
			try {
				const response = await fetch("/api/v1/settings/login-settings");
				if (response.ok) {
					const data = await response.json();
					setSignupEnabled(data.signup_enabled || false);
					if (data.discord) {
						setDiscordConfig(data.discord);
					}
				}
			} catch (error) {
				console.error("Failed to check login settings:", error);
				setSignupEnabled(false);
			}
		};
		checkLoginSettings();
	}, []);

	// Fetch OIDC configuration
	useEffect(() => {
		const fetchOidcConfig = async () => {
			try {
				const response = await fetch("/api/v1/auth/oidc/config");
				if (response.ok) {
					const config = await response.json();
					setOidcConfig(config);
				}
			} catch (error) {
				console.error("Failed to fetch OIDC config:", error);
			}
		};
		fetchOidcConfig();
	}, []);

	// Auto-redirect to OIDC if enabled and local auth is disabled
	useEffect(() => {
		// Don't auto-redirect if user explicitly logged out
		const explicitLogout = sessionStorage.getItem("explicit_logout");
		if (explicitLogout) {
			return;
		}

		if (oidcConfig.enabled && oidcConfig.disableLocalAuth) {
			window.location.href = "/api/v1/auth/oidc/login";
		}
	}, [oidcConfig]);

	// Handle OIDC callback (tokens are now in httpOnly cookies)
	useEffect(() => {
		// Prevent processing the same callback multiple times
		if (oidcProcessed) {
			return;
		}

		const urlParams = new URLSearchParams(window.location.search);
		const oidcSuccess = urlParams.get("oidc");
		const oidcError = urlParams.get("error");

		if (oidcError) {
			setError(decodeURIComponent(oidcError));
			window.history.replaceState({}, document.title, "/login");
			setOidcProcessed(true);
			return;
		}

		if (oidcSuccess === "success") {
			setOidcProcessed(true);
			sessionStorage.removeItem("explicit_logout");
			window.location.href = "/";
		}

		const discordSuccess = urlParams.get("discord");

		if (discordSuccess === "success") {
			setOidcProcessed(true);
			sessionStorage.removeItem("explicit_logout");
			window.location.href = "/";
		}
	}, [oidcProcessed]);

	const handleSubmit = async (e) => {
		e.preventDefault();
		setIsLoading(true);
		setError("");

		try {
			// Use the AuthContext login function which handles everything
			const result = await login(formData.username, formData.password);

			if (result.requiresTfa) {
				setRequiresTfa(true);
				setTfaUsername(formData.username);
				setError("");
			} else if (result.success) {
				navigate("/");
			} else {
				setError(result.error || "Login failed");
			}
		} catch (err) {
			// Check for CORS/network errors first
			if (isCorsError(err)) {
				setError(
					"CORS_ORIGIN mismatch - please set your URL in your environment variable",
				);
			} else if (
				err.name === "TypeError" &&
				err.message?.includes("Failed to fetch")
			) {
				setError(
					"CORS_ORIGIN mismatch - please set your URL in your environment variable",
				);
			} else {
				setError(err.response?.data?.error || "Login failed");
			}
		} finally {
			setIsLoading(false);
		}
	};

	const handleSignupSubmit = async (e) => {
		e.preventDefault();
		setIsLoading(true);
		setError("");

		try {
			const response = await authAPI.signup(
				formData.username,
				formData.email,
				formData.password,
				formData.firstName,
				formData.lastName,
			);
			if (response.data?.token) {
				// Update AuthContext state and localStorage
				setAuthState(response.data.token, response.data.user);

				// Redirect to dashboard
				navigate("/");
			} else {
				setError("Signup failed - invalid response");
			}
		} catch (err) {
			console.error("Signup error:", err);
			if (isCorsError(err)) {
				setError(
					"CORS_ORIGIN mismatch - please set your URL in your environment variable",
				);
			} else if (
				err.name === "TypeError" &&
				err.message?.includes("Failed to fetch")
			) {
				setError(
					"CORS_ORIGIN mismatch - please set your URL in your environment variable",
				);
			} else {
				const errorMessage =
					err.response?.data?.error ||
					(err.response?.data?.errors && err.response.data.errors.length > 0
						? err.response.data.errors.map((e) => e.msg).join(", ")
						: err.message || "Signup failed");
				setError(errorMessage);
			}
		} finally {
			setIsLoading(false);
		}
	};

	const handleTfaSubmit = async (e) => {
		e.preventDefault();
		setIsLoading(true);
		setError("");

		try {
			const response = await authAPI.verifyTfa(
				tfaUsername,
				tfaData.token,
				tfaData.remember_me,
			);

			if (response.data?.token) {
				// Update AuthContext with the new authentication state
				setAuthState(response.data.token, response.data.user);

				// Redirect to dashboard
				navigate("/");
			} else {
				setError("TFA verification failed - invalid response");
			}
		} catch (err) {
			console.error("TFA verification error:", err);
			if (isCorsError(err)) {
				setError(
					"CORS_ORIGIN mismatch - please set your URL in your environment variable",
				);
			} else if (
				err.name === "TypeError" &&
				err.message?.includes("Failed to fetch")
			) {
				setError(
					"CORS_ORIGIN mismatch - please set your URL in your environment variable",
				);
			} else {
				const errorMessage =
					err.response?.data?.error || err.message || "TFA verification failed";
				setError(errorMessage);
			}
			// Clear the token input for security (preserve remember_me preference)
			setTfaData((prev) => ({ ...prev, token: "" }));
		} finally {
			setIsLoading(false);
		}
	};

	const handleInputChange = (e) => {
		setFormData({
			...formData,
			[e.target.name]: e.target.value,
		});
	};

	const handleTfaInputChange = (e) => {
		const { name, value, type, checked } = e.target;
		setTfaData({
			...tfaData,
			[name]:
				type === "checkbox"
					? checked
					: value
							.toUpperCase()
							.replace(/[^A-Z0-9]/g, "")
							.slice(0, 6),
		});
		// Clear error when user starts typing
		if (error) {
			setError("");
		}
	};

	const handleBackToLogin = () => {
		setRequiresTfa(false);
		setTfaData({ token: "", remember_me: false });
		setError("");
	};

	const toggleMode = () => {
		// Only allow signup mode if signup is enabled
		if (!signupEnabled && !isSignupMode) {
			return; // Don't allow switching to signup if disabled
		}
		setIsSignupMode(!isSignupMode);
		setFormData({
			username: "",
			email: "",
			password: "",
			firstName: "",
			lastName: "",
		});
		setError("");
	};

	return (
		<div className="min-h-screen relative flex items-center justify-center bg-[#060a14]">
			{/* Background layers */}
			<div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(59,130,246,0.12),transparent)]" />
			<div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_40%_at_80%_100%,rgba(139,92,246,0.06),transparent)]" />
			<canvas
				ref={canvasRef}
				className="absolute inset-0 w-full h-full pointer-events-none"
			/>

			{/* Center glow */}
			<div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[300px] bg-primary-500/[0.06] rounded-full blur-[100px] pointer-events-none" />

			{/* Login card */}
			<div className="relative z-10 w-full max-w-md mx-4">
				{/* Back to home */}
				<Link
					to="/"
					className="inline-flex items-center gap-1.5 text-[13px] text-white/40 hover:text-white/70 transition-colors mb-8"
				>
					<ArrowLeft className="w-3.5 h-3.5" />
					Back to home
				</Link>

				{/* Glow behind card */}
				<div className="absolute -inset-3 top-12 bg-gradient-to-b from-primary-500/10 to-violet-500/5 rounded-3xl blur-xl pointer-events-none" />

				<div className="relative rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-md p-8 lg:p-10 shadow-2xl">
					{/* Logo & heading */}
					<div className="text-center mb-8">
						<div className="mx-auto h-14 w-14 flex items-center justify-center mb-4">
							<img
								src={
									settings?.favicon
										? `${(() => {
												const parts = settings.favicon.split("/");
												const filename = parts.pop();
												const directory = parts.join("/");
												const encodedPath = directory
													? `${directory}/${encodeURIComponent(filename)}`
													: encodeURIComponent(filename);
												return `${encodedPath}?v=${
													settings?.updated_at
														? new Date(settings.updated_at).getTime()
														: Date.now()
												}`;
											})()}`
										: "/assets/favicon.svg"
								}
								alt="Monux Logo"
								className="h-14 w-14"
								onError={(e) => {
									e.target.src = "/assets/favicon.svg";
								}}
							/>
						</div>
						<h2 className="text-2xl font-extrabold text-white tracking-tight">
							{isSignupMode ? "Create Account" : "Sign in to Monux"}
						</h2>
						<p className="mt-1.5 text-sm text-white/40">
							{isSignupMode
								? "Get started with fleet management"
								: "Monitor and manage your Linux fleet"}
						</p>
					</div>

					{!requiresTfa ? (
						<form
							className="space-y-5"
							onSubmit={isSignupMode ? handleSignupSubmit : handleSubmit}
						>
							{/* Only show form fields if local auth is not disabled */}
							{!oidcConfig.disableLocalAuth && (
								<div className="space-y-4">
									<div>
										<label
											htmlFor={usernameId}
											className="block text-[13px] font-medium text-white/60 mb-1.5"
										>
											{isSignupMode ? "Username" : "Username or Email"}
										</label>
										<div className="relative">
											<input
												id={usernameId}
												name="username"
												type="text"
												required
												value={formData.username}
												onChange={handleInputChange}
												className="w-full rounded-lg border border-white/[0.1] bg-white/[0.05] pl-10 pr-3 py-2.5 text-sm text-white placeholder-white/25 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500/50 transition-colors"
												placeholder={
													isSignupMode
														? "Enter your username"
														: "Enter your username or email"
												}
											/>
											<div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
												<User className="w-4 h-4 text-white/30" />
											</div>
										</div>
									</div>

									{isSignupMode && (
										<>
											<div className="grid grid-cols-2 gap-3">
												<div>
													<label
														htmlFor={firstNameId}
														className="block text-[13px] font-medium text-white/60 mb-1.5"
													>
														First Name
													</label>
													<div className="relative">
														<input
															id={firstNameId}
															name="firstName"
															type="text"
															required
															value={formData.firstName}
															onChange={handleInputChange}
															className="w-full rounded-lg border border-white/[0.1] bg-white/[0.05] pl-10 pr-3 py-2.5 text-sm text-white placeholder-white/25 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500/50 transition-colors"
															placeholder="First name"
														/>
														<div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
															<User className="w-4 h-4 text-white/30" />
														</div>
													</div>
												</div>
												<div>
													<label
														htmlFor={lastNameId}
														className="block text-[13px] font-medium text-white/60 mb-1.5"
													>
														Last Name
													</label>
													<div className="relative">
														<input
															id={lastNameId}
															name="lastName"
															type="text"
															required
															value={formData.lastName}
															onChange={handleInputChange}
															className="w-full rounded-lg border border-white/[0.1] bg-white/[0.05] pl-10 pr-3 py-2.5 text-sm text-white placeholder-white/25 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500/50 transition-colors"
															placeholder="Last name"
														/>
														<div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
															<User className="w-4 h-4 text-white/30" />
														</div>
													</div>
												</div>
											</div>
											<div>
												<label
													htmlFor={emailId}
													className="block text-[13px] font-medium text-white/60 mb-1.5"
												>
													Email
												</label>
												<div className="relative">
													<input
														id={emailId}
														name="email"
														type="email"
														required
														value={formData.email}
														onChange={handleInputChange}
														className="w-full rounded-lg border border-white/[0.1] bg-white/[0.05] pl-10 pr-3 py-2.5 text-sm text-white placeholder-white/25 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500/50 transition-colors"
														placeholder="Enter your email"
													/>
													<div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
														<Mail className="w-4 h-4 text-white/30" />
													</div>
												</div>
											</div>
										</>
									)}

									<div>
										<label
											htmlFor={passwordId}
											className="block text-[13px] font-medium text-white/60 mb-1.5"
										>
											Password
										</label>
										<div className="relative">
											<input
												id={passwordId}
												name="password"
												type={showPassword ? "text" : "password"}
												required
												value={formData.password}
												onChange={handleInputChange}
												className="w-full rounded-lg border border-white/[0.1] bg-white/[0.05] pl-10 pr-10 py-2.5 text-sm text-white placeholder-white/25 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500/50 transition-colors"
												placeholder="Enter your password"
											/>
											<div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
												<Lock className="w-4 h-4 text-white/30" />
											</div>
											<button
												type="button"
												onClick={() => setShowPassword(!showPassword)}
												className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 text-white/30 hover:text-white/60 transition-colors bg-transparent border-none cursor-pointer"
											>
												{showPassword ? (
													<EyeOff className="w-4 h-4" />
												) : (
													<Eye className="w-4 h-4" />
												)}
											</button>
										</div>
									</div>
								</div>
							)}

							{error && (
								<div className="flex items-start gap-2.5 p-3 rounded-lg border border-red-500/20 bg-red-500/10">
									<AlertCircle className="w-4 h-4 mt-0.5 text-red-400 flex-shrink-0" />
									<p className="text-sm text-red-300">{error}</p>
								</div>
							)}

							{/* Submit button */}
							{!oidcConfig.disableLocalAuth && (
								<button
									type="submit"
									disabled={isLoading}
									className="group w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-semibold text-white bg-gradient-to-b from-primary-500 to-primary-600 shadow-[0_0_20px_rgba(59,130,246,0.25)] hover:shadow-[0_0_28px_rgba(59,130,246,0.4)] transition-all hover:-translate-y-[1px] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-[0_0_20px_rgba(59,130,246,0.25)]"
								>
									{isLoading ? (
										<>
											<div className="animate-spin rounded-full h-4 w-4 border-2 border-white/30 border-t-white" />
											{isSignupMode ? "Creating account..." : "Signing in..."}
										</>
									) : isSignupMode ? (
										"Create Account"
									) : (
										"Sign in"
									)}
								</button>
							)}

							{/* SSO Login Button */}
							{oidcConfig.enabled && (
								<div className={oidcConfig.disableLocalAuth ? "" : "mt-2"}>
									{!oidcConfig.disableLocalAuth && (
										<div className="relative my-4">
											<div className="absolute inset-0 flex items-center">
												<div className="w-full border-t border-white/[0.08]" />
											</div>
											<div className="relative flex justify-center text-xs">
												<span className="px-3 bg-[#060a14] text-white/30">
													or
												</span>
											</div>
										</div>
									)}

									<button
										onClick={() => {
											sessionStorage.removeItem("explicit_logout");
											window.location.href = "/api/v1/auth/oidc/login";
										}}
										className="w-full flex justify-center py-2.5 px-4 rounded-lg border border-white/[0.1] text-sm font-medium text-white/70 bg-white/[0.04] hover:bg-white/[0.08] hover:text-white transition-all"
										type="button"
									>
										{oidcConfig.buttonText || "Login with SSO"}
									</button>
								</div>
							)}

							{discordConfig.enabled && (
								<div className="mt-2">
									<button
										onClick={() => {
											sessionStorage.removeItem("explicit_logout");
											window.location.href = "/api/v1/auth/discord/login";
										}}
										className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-medium text-white hover:opacity-90 transition-all"
										style={{ backgroundColor: "#5865F2" }}
										type="button"
									>
										<DiscordIcon className="h-4 w-4" />
										{discordConfig.buttonText || "Login with Discord"}
									</button>
								</div>
							)}

							{signupEnabled && !oidcConfig.disableLocalAuth && (
								<p className="text-center text-[13px] text-white/40 mt-4">
									{isSignupMode
										? "Already have an account?"
										: "Don't have an account?"}{" "}
									<button
										type="button"
										onClick={toggleMode}
										className="font-medium text-primary-400 hover:text-primary-300 transition-colors bg-transparent border-none cursor-pointer"
									>
										{isSignupMode ? "Sign in" : "Sign up"}
									</button>
								</p>
							)}
						</form>
					) : (
						/* TFA Form */
						<form className="space-y-5" onSubmit={handleTfaSubmit}>
							<div className="text-center mb-6">
								<div className="mx-auto w-12 h-12 rounded-xl bg-gradient-to-br from-primary-500/20 to-primary-600/10 border border-primary-500/20 flex items-center justify-center text-primary-400 mb-3">
									<Lock className="w-5 h-5" />
								</div>
								<h3 className="text-lg font-semibold text-white">
									Two-Factor Authentication
								</h3>
								<p className="mt-1.5 text-sm text-white/40">
									Enter the code from your authenticator app
								</p>
							</div>

							<div>
								<label
									htmlFor={tokenId}
									className="block text-[13px] font-medium text-white/60 mb-1.5"
								>
									Verification Code
								</label>
								<input
									id={tokenId}
									name="token"
									type="text"
									required
									value={tfaData.token}
									onChange={handleTfaInputChange}
									className="w-full rounded-lg border border-white/[0.1] bg-white/[0.05] px-3 py-2.5 text-lg text-white placeholder-white/25 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500/50 text-center font-mono tracking-[0.3em] uppercase transition-colors"
									placeholder="000000"
									maxLength="6"
									pattern="[A-Z0-9]{6}"
								/>
								<p className="mt-1.5 text-[11px] text-white/30">
									Enter a 6-digit TOTP code or a 6-character backup code
								</p>
							</div>

							<div className="flex items-center gap-2">
								<input
									id={rememberMeId}
									name="remember_me"
									type="checkbox"
									checked={tfaData.remember_me}
									onChange={handleTfaInputChange}
									className="h-3.5 w-3.5 rounded border-white/20 bg-white/[0.05] text-primary-500 focus:ring-primary-500/50"
								/>
								<label
									htmlFor={rememberMeId}
									className="text-[13px] text-white/50"
								>
									Remember me for 30 days
								</label>
							</div>

							{error && (
								<div className="flex items-start gap-2.5 p-3 rounded-lg border border-red-500/20 bg-red-500/10">
									<AlertCircle className="w-4 h-4 mt-0.5 text-red-400 flex-shrink-0" />
									<p className="text-sm text-red-300">{error}</p>
								</div>
							)}

							<div className="space-y-2.5">
								<button
									type="submit"
									disabled={isLoading || tfaData.token.length !== 6}
									className="group w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-semibold text-white bg-gradient-to-b from-primary-500 to-primary-600 shadow-[0_0_20px_rgba(59,130,246,0.25)] hover:shadow-[0_0_28px_rgba(59,130,246,0.4)] transition-all hover:-translate-y-[1px] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
								>
									{isLoading ? (
										<>
											<div className="animate-spin rounded-full h-4 w-4 border-2 border-white/30 border-t-white" />
											Verifying...
										</>
									) : (
										"Verify Code"
									)}
								</button>

								<button
									type="button"
									onClick={handleBackToLogin}
									className="w-full flex items-center justify-center gap-1.5 py-2.5 px-4 rounded-lg border border-white/[0.1] text-sm font-medium text-white/60 bg-white/[0.04] hover:bg-white/[0.08] hover:text-white transition-all"
								>
									<ArrowLeft className="w-3.5 h-3.5" />
									Back to Login
								</button>
							</div>
						</form>
					)}
				</div>

				{/* Footer */}
				<p className="text-center text-[11px] text-white/20 mt-6">
					&copy; {new Date().getFullYear()} Monux. All rights reserved.
				</p>
			</div>
		</div>
	);
};

export default Login;
