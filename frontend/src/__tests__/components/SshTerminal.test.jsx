/**
 * Unit tests for SSH Terminal Component
 *
 * Covers the three connection modes (agent shell, direct SSH, proxy) and
 * the ticket-based WebSocket auth flow (fetch /api/v1/auth/ssh-ticket).
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SshTerminal from "../../components/SshTerminal";
import { AuthContext } from "../../contexts/AuthContext";
import SidebarContext from "../../contexts/SidebarContext";

// Mock xterm — must be constructable classes (the component does `new Terminal(...)`)
vi.mock("xterm", () => ({
	Terminal: class Terminal {
		loadAddon() {}
		open() {}
		write() {}
		writeln() {}
		onData() {
			return { dispose: () => {} };
		}
		dispose() {}
	},
}));

vi.mock("xterm-addon-fit", () => ({
	FitAddon: class FitAddon {
		fit() {}
		proposeDimensions() {
			return { cols: 80, rows: 24 };
		}
	},
}));

vi.mock("xterm/css/xterm.css", () => ({}));

// Mock API
vi.mock("../../utils/api", () => ({
	settingsAPI: {
		getServerUrl: vi.fn(() =>
			Promise.resolve({ data: { server_url: "http://localhost:3001" } }),
		),
		get: vi.fn(() =>
			Promise.resolve({
				data: { ignore_ssl_self_signed: false },
			}),
		),
	},
}));

// Constructable WebSocket mock. The class itself is the global — the
// component calls `new WebSocket(...)` and reads `WebSocket.OPEN`, so the
// mock must be constructable and carry the static readyState constants
// (a vi.fn-wrapped arrow function fails with "not a constructor").
class WebSocketMock {
	constructor(url) {
		WebSocketMock.instances.push(this);
		this.url = url;
		this.readyState = WebSocketMock.CONNECTING;
		this.onopen = null;
		this.onclose = null;
		this.onerror = null;
		this.onmessage = null;
		this.send = vi.fn();
		this.close = vi.fn(() => {
			this.readyState = WebSocketMock.CLOSED;
		});
	}

	_simulateOpen() {
		this.readyState = WebSocketMock.OPEN;
		if (this.onopen) this.onopen();
	}

	_simulateMessage(data) {
		if (this.onmessage) this.onmessage({ data });
	}

	_simulateError(error) {
		if (this.onerror) this.onerror(error);
	}
}
WebSocketMock.instances = [];
WebSocketMock.CONNECTING = 0;
WebSocketMock.OPEN = 1;
WebSocketMock.CLOSING = 2;
WebSocketMock.CLOSED = 3;

global.WebSocket = WebSocketMock;

// Mock fetch for the ssh-ticket auth flow
const mockFetch = vi.fn(() =>
	Promise.resolve({
		ok: true,
		json: async () => ({ ticket: "tkt-abc-123" }),
	}),
);
global.fetch = mockFetch;

describe("SshTerminal Component", () => {
	let queryClient;
	let mockHost;
	let mockOnClose;
	let mockSetSidebarCollapsed;

	beforeEach(() => {
		queryClient = new QueryClient({
			defaultOptions: {
				queries: { retry: false },
				mutations: { retry: false },
			},
		});

		mockHost = {
			id: "host-123",
			friendly_name: "Test Host",
			hostname: "test.example.com",
			ip: "192.168.1.100",
			api_id: "api-123",
			api_key: "api-key-123",
		};

		mockOnClose = vi.fn();
		mockSetSidebarCollapsed = vi.fn();

		WebSocketMock.instances.length = 0;
		mockFetch.mockClear();
		localStorage.getItem = vi.fn(() => null);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	const renderComponent = (props = {}) => {
		const defaultProps = {
			host: mockHost,
			isOpen: true,
			onClose: mockOnClose,
			embedded: false,
			...props,
		};

		return render(
			<QueryClientProvider client={queryClient}>
				<AuthContext.Provider value={{ token: "test-jwt-token" }}>
					<SidebarContext.Provider
						value={{
							sidebarCollapsed: false,
							setSidebarCollapsed: mockSetSidebarCollapsed,
						}}
					>
						<SshTerminal {...defaultProps} />
					</SidebarContext.Provider>
				</AuthContext.Provider>
			</QueryClientProvider>,
		);
	};

	// Agent shell mode is the default connection mode; tests that exercise
	// the SSH credential form must switch to Direct mode first.
	const switchToDirectMode = () => {
		fireEvent.click(screen.getByLabelText(/Direct/i));
	};

	// Fill direct-mode password credentials and click Connect
	const connectDirect = async () => {
		switchToDirectMode();
		fireEvent.change(screen.getByPlaceholderText(/root/i), {
			target: { value: "testuser" },
		});
		fireEvent.change(screen.getByPlaceholderText(/password/i), {
			target: { value: "testpass" },
		});
		fireEvent.click(screen.getByRole("button", { name: /^connect$/i }));

		await waitFor(() => {
			expect(WebSocketMock.instances.length).toBeGreaterThan(0);
		});
		const ws = WebSocketMock.instances[0];
		ws._simulateOpen();
		await waitFor(() => {
			expect(ws.send).toHaveBeenCalled();
		});
		return ws;
	};

	describe("Rendering", () => {
		it("should not render when isOpen is false", () => {
			const { container } = renderComponent({ isOpen: false });
			expect(container.firstChild).toBeNull();
		});

		it("should show agent shell panel by default (no credentials)", () => {
			renderComponent();
			expect(
				screen.getByText(/no SSH server or credentials/i),
			).toBeInTheDocument();
			expect(screen.getByLabelText(/Agent Shell/i)).toBeChecked();
		});

		it("should render SSH credential form in Direct mode", () => {
			renderComponent();
			switchToDirectMode();
			expect(screen.getByPlaceholderText(/root/i)).toBeInTheDocument();
			expect(screen.getByPlaceholderText(/password/i)).toBeInTheDocument();
		});

		it("should render modal mode by default", () => {
			renderComponent();
			expect(screen.getByText(/SSH Terminal/i)).toBeInTheDocument();
			expect(screen.getByText(/Test Host/i)).toBeInTheDocument();
		});

		it("should render embedded mode when embedded prop is true", () => {
			renderComponent({ embedded: true });
			expect(screen.getByText(/Test Host/i)).toBeInTheDocument();
		});
	});

	describe("Authentication Methods", () => {
		it("should show password authentication by default in Direct mode", () => {
			renderComponent({ embedded: true });
			switchToDirectMode();
			expect(screen.getByPlaceholderText(/password/i)).toBeInTheDocument();
		});

		it("should switch to key authentication when selected", () => {
			renderComponent({ embedded: true });
			switchToDirectMode();
			fireEvent.click(screen.getByLabelText(/SSH Key/i));

			expect(
				screen.getByPlaceholderText(/BEGIN OPENSSH PRIVATE KEY/i),
			).toBeInTheDocument();
		});

		it("should show passphrase field for key authentication", () => {
			renderComponent({ embedded: true });
			switchToDirectMode();
			fireEvent.click(screen.getByLabelText(/SSH Key/i));

			expect(screen.getByPlaceholderText(/Passphrase/i)).toBeInTheDocument();
		});
	});

	describe("Form Validation", () => {
		it("should disable connect button when username is empty", () => {
			renderComponent({ embedded: true });
			switchToDirectMode();
			const connectButton = screen.getByRole("button", {
				name: /^connect$/i,
			});
			expect(connectButton).toBeDisabled();
		});

		it("should disable connect button when password is empty (password auth)", () => {
			renderComponent({ embedded: true });
			switchToDirectMode();
			fireEvent.change(screen.getByPlaceholderText(/root/i), {
				target: { value: "testuser" },
			});

			const connectButton = screen.getByRole("button", {
				name: /^connect$/i,
			});
			expect(connectButton).toBeDisabled();
		});

		it("should disable connect button when private key is empty (key auth)", () => {
			renderComponent({ embedded: true });
			switchToDirectMode();
			fireEvent.click(screen.getByLabelText(/SSH Key/i));

			fireEvent.change(screen.getByPlaceholderText(/root/i), {
				target: { value: "testuser" },
			});

			const connectButton = screen.getByRole("button", {
				name: /^connect$/i,
			});
			expect(connectButton).toBeDisabled();
		});

		it("should enable connect button when all required fields are filled", () => {
			renderComponent({ embedded: true });
			switchToDirectMode();
			fireEvent.change(screen.getByPlaceholderText(/root/i), {
				target: { value: "testuser" },
			});
			fireEvent.change(screen.getByPlaceholderText(/password/i), {
				target: { value: "testpass" },
			});

			const connectButton = screen.getByRole("button", {
				name: /^connect$/i,
			});
			expect(connectButton).not.toBeDisabled();
		});

		it("should show agent shell Connect button when agent mode selected", () => {
			renderComponent({ embedded: true });
			// Agent mode is default — credential form hidden, one Connect shown
			expect(screen.queryByPlaceholderText(/root/i)).not.toBeInTheDocument();
			const connectButton = screen.getByRole("button", {
				name: /^connect$/i,
			});
			expect(connectButton).not.toBeDisabled();
		});
	});

	describe("WebSocket Connection", () => {
		it("should create WebSocket connection when connect is clicked", async () => {
			renderComponent({ embedded: true });
			await connectDirect();
			expect(WebSocketMock.instances.length).toBeGreaterThan(0);
		});

		it("should construct WebSocket URL with host ID and one-time ticket", async () => {
			renderComponent({ embedded: true });
			switchToDirectMode();

			fireEvent.change(screen.getByPlaceholderText(/root/i), {
				target: { value: "testuser" },
			});
			fireEvent.change(screen.getByPlaceholderText(/password/i), {
				target: { value: "testpass" },
			});
			fireEvent.click(screen.getByRole("button", { name: /^connect$/i }));

			await waitFor(() => {
				expect(WebSocketMock.instances.length).toBeGreaterThan(0);
			});

			const wsCall = WebSocketMock.instances[0].url;
			expect(wsCall).toContain(`/api/v1/ssh-terminal/${mockHost.id}`);
			expect(wsCall).toContain("ticket=tkt-abc-123");
		});

		it("should send direct-mode connect message with credentials", async () => {
			renderComponent({ embedded: true });
			const ws = await connectDirect();

			const connectMessage = JSON.parse(ws.send.mock.calls[0][0]);
			expect(connectMessage.type).toBe("connect");
			expect(connectMessage.connection_mode).toBe("direct");
			expect(connectMessage.username).toBe("testuser");
			expect(connectMessage.password).toBe("testpass");
		});

		it("should send agent-shell connect message without credentials", async () => {
			renderComponent({ embedded: true });

			fireEvent.click(screen.getByRole("button", { name: /^connect$/i }));

			await waitFor(() => {
				expect(WebSocketMock.instances.length).toBeGreaterThan(0);
			});
			const ws = WebSocketMock.instances[0];
			ws._simulateOpen();
			await waitFor(() => {
				expect(ws.send).toHaveBeenCalled();
			});

			const connectMessage = JSON.parse(ws.send.mock.calls[0][0]);
			expect(connectMessage.type).toBe("connect");
			expect(connectMessage.connection_mode).toBe("agent");
			// Agent mode sends no credential payload (empty string, never a password)
			expect(connectMessage.password || "").toBe("");
		});

		it("should handle WebSocket connection errors", async () => {
			renderComponent({ embedded: true });
			switchToDirectMode();

			fireEvent.change(screen.getByPlaceholderText(/root/i), {
				target: { value: "testuser" },
			});
			fireEvent.change(screen.getByPlaceholderText(/password/i), {
				target: { value: "testpass" },
			});
			fireEvent.click(screen.getByRole("button", { name: /^connect$/i }));

			await waitFor(() => {
				expect(WebSocketMock.instances.length).toBeGreaterThan(0);
			});

			WebSocketMock.instances[0]._simulateError(new Error("Connection failed"));

			await waitFor(() => {
				expect(screen.getByText(/error/i)).toBeInTheDocument();
			});
		});
	});

	describe("Ticket Validation", () => {
		it("should show error when ticket request fails", async () => {
			mockFetch.mockImplementationOnce(() =>
				Promise.resolve({
					ok: false,
					json: async () => ({ error: "Invalid session" }),
				}),
			);
			renderComponent({ embedded: true });
			switchToDirectMode();

			fireEvent.change(screen.getByPlaceholderText(/root/i), {
				target: { value: "testuser" },
			});
			fireEvent.change(screen.getByPlaceholderText(/password/i), {
				target: { value: "testpass" },
			});
			fireEvent.click(screen.getByRole("button", { name: /^connect$/i }));

			await waitFor(() => {
				expect(
					screen.getByText(/authentication required/i),
				).toBeInTheDocument();
			});
		});
	});

	describe("SSH Connection States", () => {
		it("should show connecting state", async () => {
			renderComponent({ embedded: true });
			switchToDirectMode();

			fireEvent.change(screen.getByPlaceholderText(/root/i), {
				target: { value: "testuser" },
			});
			fireEvent.change(screen.getByPlaceholderText(/password/i), {
				target: { value: "testpass" },
			});
			fireEvent.click(screen.getByRole("button", { name: /^connect$/i }));

			await waitFor(() => {
				// Matches both the header badge and the "Connecting to SSH
				// server..." panel
				expect(screen.getAllByText(/connecting/i).length).toBeGreaterThan(0);
			});
		});

		it("should show connected state when connection is established", async () => {
			renderComponent({ embedded: true });
			const ws = await connectDirect();

			ws._simulateMessage(JSON.stringify({ type: "connected" }));

			await waitFor(() => {
				expect(
					screen.getByRole("button", { name: /disconnect/i }),
				).toBeInTheDocument();
			});
		});
	});

	describe("Disconnect", () => {
		it("should close WebSocket when disconnect is clicked", async () => {
			renderComponent({ embedded: true });
			const ws = await connectDirect();

			ws._simulateMessage(JSON.stringify({ type: "connected" }));
			await waitFor(() => {
				expect(
					screen.getByRole("button", { name: /disconnect/i }),
				).toBeInTheDocument();
			});

			fireEvent.click(screen.getByRole("button", { name: /disconnect/i }));

			await waitFor(() => {
				expect(ws.close).toHaveBeenCalled();
			});
		});
	});

	describe("Sidebar Management", () => {
		it("should collapse sidebar when modal opens", () => {
			renderComponent({ embedded: false });
			expect(mockSetSidebarCollapsed).toHaveBeenCalledWith(true);
		});

		it("should not collapse sidebar in embedded mode", () => {
			renderComponent({ embedded: true });
			expect(mockSetSidebarCollapsed).not.toHaveBeenCalled();
		});
	});

	describe("Install Command", () => {
		it("should show install command when host has API credentials", async () => {
			renderComponent({ embedded: true });
			const ws = await connectDirect();

			ws._simulateMessage(JSON.stringify({ type: "connected" }));

			await waitFor(() => {
				expect(screen.getByText(/install agent/i)).toBeInTheDocument();
			});
		});
	});
});
