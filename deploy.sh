#!/bin/bash
# =============================================================================
# PatchMon Deployment Script (Build from Source)
# =============================================================================
# Deploys PatchMon on a Linux server by cloning the repository, building
# Docker images from source, and launching all services.
#
# Usage:
#   sudo bash deploy.sh
#   # or (non-interactive):
#   sudo bash deploy.sh --non-interactive --host myserver.example.com
#
# Options:
#   --non-interactive    Use defaults and auto-generated secrets (no prompts)
#   --install-dir DIR    Installation directory (default: /opt/patchmon)
#   --branch BRANCH      Git branch to deploy (default: development)
#   --repo URL           Git repository URL
#   --host HOSTNAME      Server hostname/IP for CORS and agents
#   --protocol PROTO     http or https (default: http)
#   --port PORT          Server port (default: 3000)
#   --build-agent        Also cross-compile the Go agent binaries
# =============================================================================

set -eo pipefail

# -----------------------------------------------------------------------------
# Configuration defaults
# -----------------------------------------------------------------------------
REPO_URL="https://github.com/wittyphantom333/linux-management.git"
BRANCH="development"
INSTALL_DIR="/opt/patchmon"
SERVER_HOST=""
SERVER_PROTOCOL="http"
SERVER_PORT="3000"
NON_INTERACTIVE=false
BUILD_AGENT=false
DETECTED_HOST=""
DETECTED_IP=""
DO_BUILD_AGENT="no"
CONFIRM="yes"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# -----------------------------------------------------------------------------
# Helper functions
# -----------------------------------------------------------------------------
info()    { printf "${BLUE}[INFO]${NC}    %s\n" "$*"; }
success() { printf "${GREEN}[OK]${NC}      %s\n" "$*"; }
warn()    { printf "${YELLOW}[WARN]${NC}    %s\n" "$*"; }
error()   { printf "${RED}[ERROR]${NC}   %s\n" "$*"; }
header()  { printf "\n${BOLD}${CYAN}==> %s${NC}\n" "$*"; }

die() {
    error "$@"
    exit 1
}

generate_secret() {
    local len="$1"
    local secret=""
    # Try openssl first
    secret=$(openssl rand -hex "$len" 2>/dev/null) || true
    if [ -n "$secret" ]; then
        echo "$secret"
        return 0
    fi
    # Fallback: read from urandom and convert to hex
    secret=$(od -A n -t x1 -N "$len" /dev/urandom 2>/dev/null | tr -d ' \n') || true
    if [ -n "$secret" ]; then
        echo "$secret"
        return 0
    fi
    # Last resort: use $RANDOM (less secure but functional)
    local i
    for i in $(seq 1 "$len"); do
        secret="${secret}$(printf '%02x' $((RANDOM % 256)))"
    done
    echo "$secret"
}

# Read user input — reads from /dev/tty so it works even when script is piped
read_input() {
    local _input=""
    if [ -t 0 ]; then
        read -r _input
    elif [ -e /dev/tty ]; then
        read -r _input < /dev/tty
    fi
    echo "$_input"
}

# -----------------------------------------------------------------------------
# Parse arguments
# -----------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
    case "$1" in
        --non-interactive) NON_INTERACTIVE=true; shift ;;
        --install-dir)     INSTALL_DIR="$2";     shift 2 ;;
        --branch)          BRANCH="$2";          shift 2 ;;
        --repo)            REPO_URL="$2";        shift 2 ;;
        --host)            SERVER_HOST="$2";     shift 2 ;;
        --protocol)        SERVER_PROTOCOL="$2"; shift 2 ;;
        --port)            SERVER_PORT="$2";     shift 2 ;;
        --build-agent)     BUILD_AGENT=true;     shift ;;
        -h|--help)
            sed -n '2,/^$/s/^# \?//p' "$0" 2>/dev/null || true
            exit 0
            ;;
        *) die "Unknown option: $1. Use --help for usage." ;;
    esac
done

# -----------------------------------------------------------------------------
# Pre-flight checks
# -----------------------------------------------------------------------------
header "Pre-flight checks"

# Must be root
if [ "$(id -u)" -ne 0 ]; then
    die "This script must be run as root (or with sudo)."
fi

# Detect OS
OS_ID="unknown"
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS_ID="${ID:-unknown}"
    info "Detected OS: ${PRETTY_NAME:-$OS_ID}"
else
    warn "Could not detect OS — continuing anyway."
fi

# Check / install Docker
if command -v docker &>/dev/null; then
    success "Docker is installed ($(docker --version | head -1))"
else
    info "Docker not found — installing..."
    case "$OS_ID" in
        ubuntu|debian)
            apt-get update -qq
            apt-get install -y -qq ca-certificates curl gnupg lsb-release
            install -m 0755 -d /etc/apt/keyrings
            curl -fsSL "https://download.docker.com/linux/$OS_ID/gpg" \
                | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
            chmod a+r /etc/apt/keyrings/docker.gpg
            echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
                https://download.docker.com/linux/$OS_ID $(lsb_release -cs) stable" \
                > /etc/apt/sources.list.d/docker.list
            apt-get update -qq
            apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
            ;;
        centos|rhel|rocky|almalinux|fedora)
            dnf install -y dnf-plugins-core 2>/dev/null || yum install -y yum-utils 2>/dev/null || true
            dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo 2>/dev/null \
                || yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo 2>/dev/null || true
            dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin 2>/dev/null \
                || yum install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
            ;;
        *)
            die "Unsupported OS for auto-install. Please install Docker manually and re-run."
            ;;
    esac
    systemctl enable --now docker
    success "Docker installed successfully."
fi

# Verify docker compose plugin
if docker compose version &>/dev/null; then
    success "Docker Compose plugin available ($(docker compose version --short 2>/dev/null || echo 'ok'))"
else
    die "Docker Compose plugin not found. Install docker-compose-plugin and re-run."
fi

# Check / install git
if command -v git &>/dev/null; then
    success "Git is installed."
else
    info "Installing git..."
    case "$OS_ID" in
        ubuntu|debian)       apt-get install -y -qq git ;;
        centos|rhel|rocky|almalinux|fedora) dnf install -y git || yum install -y git ;;
        *) die "Please install git manually and re-run." ;;
    esac
    success "Git installed."
fi

# Check openssl (for secret generation)
if ! command -v openssl &>/dev/null; then
    warn "openssl not found — installing..."
    case "$OS_ID" in
        ubuntu|debian) apt-get install -y -qq openssl ;;
        *)             dnf install -y openssl 2>/dev/null || yum install -y openssl 2>/dev/null || true ;;
    esac
fi

# -----------------------------------------------------------------------------
# Interactive configuration
# -----------------------------------------------------------------------------
header "Configuration"

if ! $NON_INTERACTIVE; then
    printf "${BLUE}%s${NC} [${YELLOW}%s${NC}]: " "Installation directory" "$INSTALL_DIR"
    _input=$(read_input)
    INSTALL_DIR="${_input:-$INSTALL_DIR}"

    printf "${BLUE}%s${NC} [${YELLOW}%s${NC}]: " "Git repository URL" "$REPO_URL"
    _input=$(read_input)
    REPO_URL="${_input:-$REPO_URL}"

    printf "${BLUE}%s${NC} [${YELLOW}%s${NC}]: " "Git branch to deploy" "$BRANCH"
    _input=$(read_input)
    BRANCH="${_input:-$BRANCH}"

    # Auto-detect hostname
    if [ -z "$SERVER_HOST" ]; then
        DETECTED_HOST=$(hostname -f 2>/dev/null || hostname 2>/dev/null || echo "localhost")
        DETECTED_IP=$(curl -s --max-time 3 https://ifconfig.me 2>/dev/null || echo "")
    fi
    _host_default="${SERVER_HOST:-${DETECTED_IP:-$DETECTED_HOST}}"
    _host_default="${_host_default:-localhost}"
    printf "${BLUE}%s${NC} [${YELLOW}%s${NC}]: " "Server hostname or IP (for browser/agent access)" "$_host_default"
    _input=$(read_input)
    SERVER_HOST="${_input:-$_host_default}"

    printf "${BLUE}%s${NC} [${YELLOW}%s${NC}]: " "Protocol (http/https)" "$SERVER_PROTOCOL"
    _input=$(read_input)
    SERVER_PROTOCOL="${_input:-$SERVER_PROTOCOL}"

    printf "${BLUE}%s${NC} [${YELLOW}%s${NC}]: " "Server port" "$SERVER_PORT"
    _input=$(read_input)
    SERVER_PORT="${_input:-$SERVER_PORT}"

    printf "${BLUE}%s${NC} [${YELLOW}%s${NC}]: " "Also build Go agent binaries? (yes/no)" "no"
    _input=$(read_input)
    _input="${_input:-no}"
    case "$_input" in
        [Yy]|[Yy][Ee][Ss]) BUILD_AGENT=true ;;
    esac
else
    # Non-interactive: auto-detect hostname if not provided
    if [ -z "$SERVER_HOST" ]; then
        SERVER_HOST=$(hostname -f 2>/dev/null || hostname 2>/dev/null || echo "localhost")
    fi
fi

# Generate secrets
info "Generating secure passwords and tokens..."
POSTGRES_PASSWORD=$(generate_secret 32)
REDIS_PASSWORD=$(generate_secret 32)
JWT_SECRET=$(generate_secret 64)

if [ -z "$POSTGRES_PASSWORD" ] || [ -z "$REDIS_PASSWORD" ] || [ -z "$JWT_SECRET" ]; then
    die "Failed to generate secrets. Ensure openssl or /dev/urandom is available."
fi
success "Secrets generated."

# Build CORS origin
if [ "$SERVER_PROTOCOL" = "https" ] && [ "$SERVER_PORT" = "443" ]; then
    CORS_ORIGIN="${SERVER_PROTOCOL}://${SERVER_HOST}"
elif [ "$SERVER_PROTOCOL" = "http" ] && [ "$SERVER_PORT" = "80" ]; then
    CORS_ORIGIN="${SERVER_PROTOCOL}://${SERVER_HOST}"
else
    CORS_ORIGIN="${SERVER_PROTOCOL}://${SERVER_HOST}:${SERVER_PORT}"
fi

echo ""
info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
info "  Install directory : $INSTALL_DIR"
info "  Repository        : $REPO_URL"
info "  Branch            : $BRANCH"
info "  Server URL        : $CORS_ORIGIN"
info "  Build agent       : $BUILD_AGENT"
info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if ! $NON_INTERACTIVE; then
    printf "${BLUE}%s${NC} [${YELLOW}%s${NC}]: " "Proceed with deployment? (yes/no)" "yes"
    _input=$(read_input)
    _input="${_input:-yes}"
    case "$_input" in
        [Yy]|[Yy][Ee][Ss]) ;; # continue
        *) info "Aborted."; exit 0 ;;
    esac
fi

# -----------------------------------------------------------------------------
# Clone / update repository
# -----------------------------------------------------------------------------
header "Setting up repository"

if [ -d "$INSTALL_DIR/.git" ]; then
    info "Repository already exists at $INSTALL_DIR — pulling latest changes..."
    cd "$INSTALL_DIR"
    git fetch origin
    git checkout "$BRANCH"
    git pull origin "$BRANCH"
    success "Repository updated."
else
    info "Cloning $REPO_URL (branch: $BRANCH) into $INSTALL_DIR..."
    mkdir -p "$(dirname "$INSTALL_DIR")"
    git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
    success "Repository cloned."
fi

cd "$INSTALL_DIR/docker"

# -----------------------------------------------------------------------------
# Create .env file
# -----------------------------------------------------------------------------
header "Generating environment configuration"

ENV_FILE="$INSTALL_DIR/docker/.env"

if [ -f "$ENV_FILE" ]; then
    warn ".env file already exists — backing up to .env.bak"
    cp "$ENV_FILE" "${ENV_FILE}.bak.$(date +%Y%m%d_%H%M%S)"
fi

cat > "$ENV_FILE" <<EOF
# =============================================================================
# PatchMon Environment Configuration
# Generated by deploy.sh on $(date '+%Y-%m-%d %H:%M:%S')
# =============================================================================

# --- Required ---
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
REDIS_PASSWORD=${REDIS_PASSWORD}
JWT_SECRET=${JWT_SECRET}

# --- Server access ---
SERVER_PROTOCOL=${SERVER_PROTOCOL}
SERVER_HOST=${SERVER_HOST}
SERVER_PORT=${SERVER_PORT}
CORS_ORIGIN=${CORS_ORIGIN}

# --- Environment ---
NODE_ENV=production

# --- Logging ---
LOG_LEVEL=info
ENABLE_LOGGING=true

# --- Timezone ---
TZ=$(cat /etc/timezone 2>/dev/null || echo "UTC")
EOF

chmod 600 "$ENV_FILE"
success "Environment file created at $ENV_FILE"

# -----------------------------------------------------------------------------
# Build & launch containers
# -----------------------------------------------------------------------------
header "Building and starting PatchMon"

info "Building Docker images from source (this may take a few minutes)..."
docker compose -f docker-compose.yml -f docker-compose.build.yml build --no-cache

info "Starting services..."
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d

# Wait for backend to become healthy
info "Waiting for services to be ready..."
TRIES=0
MAX_TRIES=60
while [ $TRIES -lt $MAX_TRIES ]; do
    if docker compose -f docker-compose.yml -f docker-compose.build.yml ps --format json 2>/dev/null \
        | grep -q '"Health":"healthy"' 2>/dev/null; then
        break
    fi
    # Fallback: check via exec
    if docker compose -f docker-compose.yml -f docker-compose.build.yml exec -T backend \
        wget -q --spider http://localhost:3001/api/v1/health 2>/dev/null; then
        break
    fi
    TRIES=$((TRIES + 1))
    printf "."
    sleep 5
done
echo ""

if [ $TRIES -ge $MAX_TRIES ]; then
    warn "Services may not be fully ready yet. Check with: docker compose logs"
else
    success "All services are running!"
fi

# Show container status
echo ""
docker compose -f docker-compose.yml -f docker-compose.build.yml ps

# -----------------------------------------------------------------------------
# Optionally build Go agent
# -----------------------------------------------------------------------------
if $BUILD_AGENT; then
    header "Building Go agent binaries"

    if ! command -v go &>/dev/null; then
        info "Go not found — installing..."
        GO_VERSION="1.23.6"
        ARCH=$(uname -m)
        case "$ARCH" in
            x86_64)  GO_ARCH="amd64" ;;
            aarch64) GO_ARCH="arm64" ;;
            armv7l)  GO_ARCH="arm" ;;
            *)       die "Unsupported architecture: $ARCH" ;;
        esac
        curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-${GO_ARCH}.tar.gz" \
            | tar -C /usr/local -xz
        export PATH="/usr/local/go/bin:$PATH"
        success "Go ${GO_VERSION} installed."
    else
        success "Go is installed ($(go version))"
    fi

    cd "$INSTALL_DIR/agent-source-code"

    TARGETS=(
        "linux:amd64"
        "linux:arm64"
        "linux:arm"
        "linux:386"
        "freebsd:amd64"
        "freebsd:arm64"
    )

    for target in "${TARGETS[@]}"; do
        IFS=':' read -r os arch <<< "$target"
        BINARY_NAME="patchmon-agent-${os}-${arch}"
        info "Building ${BINARY_NAME}..."
        CGO_ENABLED=0 GOOS="$os" GOARCH="$arch" \
            go build -ldflags="-s -w" -o "$INSTALL_DIR/agents/${BINARY_NAME}" ./cmd/patchmon-agent/
        success "Built ${BINARY_NAME}"
    done

    chmod +x "$INSTALL_DIR/agents/patchmon-agent-"* 2>/dev/null || true
    info "Agent binaries saved to $INSTALL_DIR/agents/"
fi

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
header "Deployment complete!"

echo ""
printf "${GREEN}${BOLD}"
cat << 'BANNER'
  ____       _       _     __  __             
 |  _ \ __ _| |_ ___| |__ |  \/  | ___  _ __  
 | |_) / _` | __/ __| '_ \| |\/| |/ _ \| '_ \ 
 |  __/ (_| | || (__| | | | |  | | (_) | | | |
 |_|   \__,_|\__\___|_| |_|_|  |_|\___/|_| |_|
                                                
BANNER
printf "${NC}"

echo ""
info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
info "  PatchMon is running at: ${BOLD}${CORS_ORIGIN}${NC}"
info ""
info "  Install directory  : $INSTALL_DIR"
info "  Docker Compose dir : $INSTALL_DIR/docker"
info "  Environment file   : $INSTALL_DIR/docker/.env"
info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
info "Useful commands:"
echo "  cd $INSTALL_DIR/docker"
echo "  docker compose -f docker-compose.yml -f docker-compose.build.yml logs -f      # View logs"
echo "  docker compose -f docker-compose.yml -f docker-compose.build.yml restart       # Restart"
echo "  docker compose -f docker-compose.yml -f docker-compose.build.yml down          # Stop"
echo ""
info "To update after pulling new changes:"
echo "  cd $INSTALL_DIR && git pull"
echo "  cd docker && docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build"
echo ""

# Save credentials to a file readable only by root
CREDS_FILE="$INSTALL_DIR/.credentials"
cat > "$CREDS_FILE" <<EOF
# PatchMon Credentials — generated $(date '+%Y-%m-%d %H:%M:%S')
# KEEP THIS FILE SECURE — delete after noting the values.

POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
REDIS_PASSWORD=${REDIS_PASSWORD}
JWT_SECRET=${JWT_SECRET}
EOF
chmod 600 "$CREDS_FILE"

warn "Database and JWT secrets saved to ${CREDS_FILE} (root-only readable)."
warn "Store these credentials securely and consider deleting that file."
echo ""
