#!/bin/bash
# =============================================================================
# Monux Release Script
# =============================================================================
# Bumps version across all 4 files, runs Go tests, builds all 6 agent
# binaries, formats frontend with Biome, commits, and pushes.
#
# Usage:
#   ./tools/release.sh patch          # 1.5.7 → 1.5.8
#   ./tools/release.sh minor          # 1.5.7 → 1.6.0
#   ./tools/release.sh major          # 1.5.7 → 2.0.0
#   ./tools/release.sh 1.6.0          # explicit version
#   ./tools/release.sh                 # no version bump, just build + push
#
# Options:
#   --no-test      Skip Go tests
#   --no-push      Commit but don't push
#   --dry-run      Show what would happen without doing it
#   -m "message"   Custom commit message (appended after version info)
# =============================================================================

set -eo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

# Ensure we're in the repo root
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# ── Parse arguments ──────────────────────────────────────────────────────────
BUMP=""
NO_TEST=false
NO_PUSH=false
DRY_RUN=false
CUSTOM_MSG=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --no-test)  NO_TEST=true; shift ;;
        --no-push)  NO_PUSH=true; shift ;;
        --dry-run)  DRY_RUN=true; shift ;;
        -m)         CUSTOM_MSG="$2"; shift 2 ;;
        patch|minor|major)
            BUMP="$1"; shift ;;
        [0-9]*)
            BUMP="$1"; shift ;;
        -h|--help)
            sed -n '2,/^$/p' "$0" | sed 's/^# \?//'
            exit 0 ;;
        *)
            echo -e "${RED}Unknown argument: $1${NC}" >&2
            exit 1 ;;
    esac
done

# ── Helpers ──────────────────────────────────────────────────────────────────
info()  { echo -e "${BLUE}▸${NC} $*"; }
ok()    { echo -e "${GREEN}✔${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
fail()  { echo -e "${RED}✖ $*${NC}" >&2; exit 1; }

run() {
    if $DRY_RUN; then
        echo -e "${YELLOW}[dry-run]${NC} $*"
    else
        "$@"
    fi
}

# ── Read current version ────────────────────────────────────────────────────
CURRENT_VERSION=$(grep '"version"' package.json | head -1 | sed 's/.*"\([0-9]*\.[0-9]*\.[0-9]*\)".*/\1/')
if [[ -z "$CURRENT_VERSION" ]]; then
    fail "Could not read current version from package.json"
fi
info "Current version: ${BOLD}${CURRENT_VERSION}${NC}"

# ── Compute new version ─────────────────────────────────────────────────────
if [[ -n "$BUMP" ]]; then
    IFS='.' read -r V_MAJOR V_MINOR V_PATCH <<< "$CURRENT_VERSION"

    case "$BUMP" in
        patch) NEW_VERSION="${V_MAJOR}.${V_MINOR}.$((V_PATCH + 1))" ;;
        minor) NEW_VERSION="${V_MAJOR}.$((V_MINOR + 1)).0" ;;
        major) NEW_VERSION="$((V_MAJOR + 1)).0.0" ;;
        *)     NEW_VERSION="$BUMP" ;;  # explicit version
    esac

    if [[ "$NEW_VERSION" == "$CURRENT_VERSION" ]]; then
        warn "New version is the same as current ($CURRENT_VERSION), skipping bump"
        BUMP=""
    else
        info "New version: ${BOLD}${NEW_VERSION}${NC}"
    fi
fi

# ── Version files ────────────────────────────────────────────────────────────
VERSION_FILES=(
    "package.json"
    "backend/package.json"
    "frontend/package.json"
    "agent-source-code/internal/pkgversion/version.go"
)

if [[ -n "$BUMP" ]]; then
    info "Bumping version in ${#VERSION_FILES[@]} files…"

    for f in "${VERSION_FILES[@]}"; do
        if [[ ! -f "$f" ]]; then
            fail "Version file not found: $f"
        fi
    done

    if ! $DRY_RUN; then
        # JSON files: replace "version": "x.y.z"
        for f in package.json backend/package.json frontend/package.json; do
            sed -i '' "s/\"version\": \"${CURRENT_VERSION}\"/\"version\": \"${NEW_VERSION}\"/" "$f"
        done

        # Go file: replace var Version = "x.y.z"
        sed -i '' "s/var Version = \"${CURRENT_VERSION}\"/var Version = \"${NEW_VERSION}\"/" \
            agent-source-code/internal/pkgversion/version.go
    fi

    ok "Version bumped to ${NEW_VERSION}"
    EFFECTIVE_VERSION="$NEW_VERSION"
else
    EFFECTIVE_VERSION="$CURRENT_VERSION"
fi

# ── Dirty check ──────────────────────────────────────────────────────────────
if [[ -z "$BUMP" ]]; then
    STAGED=$(git diff --cached --name-only 2>/dev/null | wc -l | tr -d ' ')
    UNSTAGED=$(git diff --name-only 2>/dev/null | wc -l | tr -d ' ')
    UNTRACKED=$(git ls-files --others --exclude-standard 2>/dev/null | wc -l | tr -d ' ')
    TOTAL=$((STAGED + UNSTAGED + UNTRACKED))
    if [[ "$TOTAL" -eq 0 ]]; then
        warn "No version bump and no uncommitted changes — nothing to do"
        exit 0
    fi
fi

# ── Go tests ─────────────────────────────────────────────────────────────────
if ! $NO_TEST; then
    info "Running Go tests…"
    if ! $DRY_RUN; then
        pushd agent-source-code > /dev/null
        if ! go test ./... 2>&1; then
            fail "Go tests failed — aborting release"
        fi
        popd > /dev/null
    fi
    ok "Tests passed"
else
    warn "Skipping Go tests (--no-test)"
fi

# ── Build agent binaries ────────────────────────────────────────────────────
TARGETS=(
    "linux   amd64"
    "linux   arm64"
    "linux   386"
    "linux   arm"
    "freebsd amd64"
    "freebsd arm64"
)

info "Building ${#TARGETS[@]} agent binaries…"

if ! $DRY_RUN; then
    pushd agent-source-code > /dev/null
    for target in "${TARGETS[@]}"; do
        read -r goos goarch <<< "$target"
        outfile="../agents/patchmon-agent-${goos}-${goarch}"
        echo -e "  ${BLUE}→${NC} ${goos}/${goarch}"
        CGO_ENABLED=0 GOOS="$goos" GOARCH="$goarch" \
            go build -buildvcs=false -ldflags "-s -w" \
            -o "$outfile" ./cmd/patchmon-agent/
    done
    popd > /dev/null
fi

ok "All ${#TARGETS[@]} binaries built"

# ── Biome format ─────────────────────────────────────────────────────────────
info "Running Biome check…"
if ! $DRY_RUN; then
    npx biome check --write frontend/ backend/ 2>&1 | tail -3
fi
ok "Biome formatting done"

# ── Stage and commit ─────────────────────────────────────────────────────────
info "Staging changes…"
run git add -A

# Build commit message
if [[ -n "$BUMP" ]]; then
    COMMIT_MSG="chore: release v${EFFECTIVE_VERSION}"
    if [[ -n "$CUSTOM_MSG" ]]; then
        COMMIT_MSG="${COMMIT_MSG} — ${CUSTOM_MSG}"
    fi
else
    if [[ -n "$CUSTOM_MSG" ]]; then
        COMMIT_MSG="$CUSTOM_MSG"
    else
        # Summarize what changed
        CHANGED=$(git diff --cached --stat | tail -1)
        COMMIT_MSG="chore: rebuild agents and format (${CHANGED})"
    fi
fi

info "Committing: ${BOLD}${COMMIT_MSG}${NC}"
run git commit -m "$COMMIT_MSG"

# ── Push ─────────────────────────────────────────────────────────────────────
if ! $NO_PUSH; then
    info "Pushing to remote…"
    run git push
    ok "Pushed successfully"
else
    warn "Skipping push (--no-push)"
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}═══ Release complete ═══${NC}"
echo -e "  Version:  ${BOLD}${EFFECTIVE_VERSION}${NC}"
echo -e "  Binaries: ${#TARGETS[@]} built"
echo -e "  Branch:   $(git branch --show-current)"
echo -e "  Commit:   $(git log --oneline -1)"
