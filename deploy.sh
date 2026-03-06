#!/bin/bash
# =============================================================================
# PatchMon Deployment Script (Build from Source)
# =============================================================================
# Deploys PatchMon on a Linux server by cloning the repository, building
# Docker images from source, and launching all services.
#
# Usage:
#   curl -fsSL <raw-url>/deploy.sh | sudo bash
#   # or
#   sudo bash deploy.sh
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

set -euo pipefail

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
    openssl rand -hex "$1" 2>/dev/null || head -c "$1" /dev/urandom | xxd -p | tr -d '\n'
}

prompt() {
    local var_name="$1" prompt_text="$2" default="$3"
    if $NON_INTERACTIVE; then
        eval "$var_name='$default'"
        return
    fi
    local input
    if [ -n "$default" ]; then
        printf "${BLUE}%s${NC} [${YELLOW}%s${NC}]: " "$prompt_text" "$default"
    else
        printf "${BLUE}%s${NC}: " "$prompt_text"
    fi
    read -r input
    eval "$var_name='${input:-$default}'"
}

prompt_yes_no() {
    local var_name="$1" prompt_text="$2" default="$3"
    if $NON_INTERACTIVE; then
        eval "$var_name='$default'"
        return
    fi
    local input
    while true; do
        printf "${BLUE}%s${NC} [${YELLOW}%s${NC}]: " "$prompt_text" "$default"
        read -r input
        input="${input:-$default}"
        case "$input" in
            [Yy]|[Yy][Ee][Ss]) eval "$var_name=yes"; return ;;
            [Nn]|[Nn][Oo])     eval "$var_name=no";  return ;;
            *) warn "Please enter yes or no." ;;
        esac
    done
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
            sed -n '2,/^$/s/^# \?//p' "$0"
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
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS_ID="${ID:-unknown}"
    info "Detected OS: ${PRETTY_NAME:-$OS_ID}"
else
    OS_ID="unknown"
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
            dnf install -y dnf-plugins-core || yum install -y yum-utils
            dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo 2>/dev/null \
                || yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
            dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin \
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
        *)             dnf install -y openssl || yum install -y openssl || true ;;
    esac
fi

# -----------------------------------------------------------------------------
# Interactive configuration
# -----------------------------------------------------------------------------
header "Configuration"

prompt "INSTALL_DIR"      "Installation directory"                 "$INSTALL_DIR"
prompt "REPO_URL"         "Git repository URL"                     "$REPO_URL"
prompt "BRANCH"           "Git branch to deploy"                   "$BRANCH"

# Auto-detect hostname
if [ -z "$SERVER_HOST" ]; then
    DETECTED_HOST=$(hostname -f 2>/dev/null || hostname 2>/dev/null || echo "localhost")
    # Try to get external IP as alternative
    DETECTED_IP=$(curl -s --max-time 3 https://ifconfig.me 2>/dev/null || echo "")
fi
prompt "SERVER_HOST"      "Server hostname or IP (for browser/agent access)" "${SERVER_HOST:-${DETECTED_IP:-$DETECTED_HOST}}"
prompt "SERVER_PROTOCOL"  "Protocol (http/https)"                  "$SERVER_PROTOCOL"
prompt "SERVER_PORT"      "Server port"                            "$SERVER_PORT"

prompt_yes_no "DO_BUILD_AGENT" "Also build Go agent binaries? (requires Go)" "no"
if [ "$DO_BUILD_AGENT" = "yes" ]; then
    BUILD_AGENT=true
fi

# Generate secrets
POSTGRES_PASSWORD=$(generate_secret 32)
REDIS_PASSWORD=$(generate_secret 32)
JWT_SECRET=$(generate_secret 64)

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
    prompt_yes_no "CONFIRM" "Proceed with deployment?" "yes"
    [ "$CONFIRM" != "yes" ] && { info "Aborted."; exit 0; }
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
