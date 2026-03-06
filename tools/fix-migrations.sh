#!/bin/bash
# PatchMon Migration Fixer
# Standalone script to detect and fix failed Prisma migrations
# Usage: sudo bash fix-migrations.sh [instance-name]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print functions
print_status() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

# Check if running as root
if [[ $EUID -ne 0 ]]; then
    print_error "This script must be run as root"
    print_info "Please run: sudo bash $0"
    exit 1
fi

# Function to detect PatchMon installations
detect_installations() {
    local installations=()
    
    if [ -d "/opt" ]; then
        for dir in /opt/*/; do
            local dirname=$(basename "$dir")
            # Skip backup directories
            if [[ "$dirname" =~ \.backup\. ]]; then
                continue
            fi
            # Check if it's a PatchMon installation
            if [ -f "$dir/backend/package.json" ] && grep -q "patchmon" "$dir/backend/package.json" 2>/dev/null; then
                installations+=("$dirname")
            fi
        done
    fi
    
    echo "${installations[@]}"
}

# Function to select installation
select_installation() {
    local installations=($(detect_installations))
    
    if [ ${#installations[@]} -eq 0 ]; then
        print_error "No PatchMon installations found in /opt"
        exit 1
    fi
    
    if [ -n "$1" ]; then
        # Use provided instance name
        if [[ " ${installations[@]} " =~ " $1 " ]]; then
            echo "$1"
            return 0
        else
            print_error "Instance '$1' not found"
            exit 1
        fi
    fi
    
    print_info "Found ${#installations[@]} installation(s):"
    echo ""
    
    local i=1
    declare -A install_map
    for install in "${installations[@]}"; do
        printf "%2d. %s\n" "$i" "$install"
        install_map[$i]="$install"
        i=$((i + 1))
    done
    
    echo ""
    echo -n -e "${BLUE}Select installation number [1]: ${NC}"
    read -r selection
    
    selection=${selection:-1}
    
    if [[ "$selection" =~ ^[0-9]+$ ]] && [ -n "${install_map[$selection]}" ]; then
        echo "${install_map[$selection]}"
        return 0
    else
        print_error "Invalid selection"
        exit 1
    fi
}

# Function to check and fix failed migrations
fix_failed_migrations() {
    local db_name="$1"
    local db_user="$2"
    local db_pass="$3"
    local db_host="${4:-localhost}"
    
    print_info "Checking for failed migrations in database..."
    
    # Query for failed migrations
    local failed_migrations
    failed_migrations=$(PGPASSWORD="$db_pass" psql -h "$db_host" -U "$db_user" -d "$db_name" -t -A -c \
        "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NULL AND started_at IS NOT NULL;" 2>/dev/null || echo "")
    
    if [ -z "$failed_migrations" ]; then
        print_status "No failed migrations found"
        return 0
    fi
    
    print_warning "Found failed migration(s):"
    echo "$failed_migrations" | while read -r migration; do
        [ -n "$migration" ] && print_warning "  - $migration"
    done
    echo ""
    
    print_info "What would you like to do?"
    echo "  1. Clean and retry (delete failed records and re-run migration)"
    echo "  2. Mark as completed (if schema changes are already applied)"
    echo "  3. Show migration details only"
    echo "  4. Cancel"
    echo ""
    echo -n -e "${BLUE}Select option [1]: ${NC}"
    read -r option
    
    option=${option:-1}
    
    case $option in
        1)
            print_info "Cleaning failed migrations and preparing for retry..."
            echo "$failed_migrations" | while read -r migration; do
                if [ -n "$migration" ]; then
                    print_info "Processing: $migration"
                    
                    # Mark as rolled back
                    PGPASSWORD="$db_pass" psql -h "$db_host" -U "$db_user" -d "$db_name" -c \
                        "UPDATE _prisma_migrations SET rolled_back_at = NOW() WHERE migration_name = '$migration' AND finished_at IS NULL;" >/dev/null 2>&1
                    
                    # Delete the failed record
                    PGPASSWORD="$db_pass" psql -h "$db_host" -U "$db_user" -d "$db_name" -c \
                        "DELETE FROM _prisma_migrations WHERE migration_name = '$migration' AND finished_at IS NULL;" >/dev/null 2>&1
                    
                    print_status "Cleared: $migration"
                fi
            done
            print_status "Failed migrations cleared - ready to retry"
            return 0
            ;;
        2)
            print_info "Marking migrations as completed..."
            echo "$failed_migrations" | while read -r migration; do
                if [ -n "$migration" ]; then
                    print_info "Marking as complete: $migration"
                    
                    PGPASSWORD="$db_pass" psql -h "$db_host" -U "$db_user" -d "$db_name" -c \
                        "UPDATE _prisma_migrations SET finished_at = NOW(), logs = 'Manually resolved by fix-migrations.sh' WHERE migration_name = '$migration' AND finished_at IS NULL;" >/dev/null 2>&1
                    
                    print_status "Marked complete: $migration"
                fi
            done
            print_status "All migrations marked as completed"
            return 0
            ;;
        3)
            print_info "Migration details:"
            PGPASSWORD="$db_pass" psql -h "$db_host" -U "$db_user" -d "$db_name" -c \
                "SELECT migration_name, started_at, finished_at, rolled_back_at, logs FROM _prisma_migrations WHERE finished_at IS NULL AND started_at IS NOT NULL;"
            return 0
            ;;
        4)
            print_info "Cancelled"
            return 1
            ;;
        *)
            print_error "Invalid option"
            return 1
            ;;
    esac
}

# Main script
main() {
    echo -e "${BLUE}====================================================${NC}"
    echo -e "${BLUE}        PatchMon Migration Fixer${NC}"
    echo -e "${BLUE}====================================================${NC}"
    echo ""
    
    # Select instance
    instance_name=$(select_installation "$1")
    instance_dir="/opt/$instance_name"
    
    print_info "Selected instance: $instance_name"
    print_info "Directory: $instance_dir"
    echo ""
    
    # Load .env to get database credentials
    if [ ! -f "$instance_dir/backend/.env" ]; then
        print_error "Cannot find .env file at $instance_dir/backend/.env"
        exit 1
    fi
    
    # Source .env
    set -a
    source "$instance_dir/backend/.env"
    set +a
    
    # Parse DATABASE_URL
    if [ -z "$DATABASE_URL" ]; then
        print_error "DATABASE_URL not found in .env file"
        exit 1
    fi
    
    DB_USER=$(echo "$DATABASE_URL" | sed -n 's|postgresql://\([^:]*\):.*|\1|p')
    DB_PASS=$(echo "$DATABASE_URL" | sed -n 's|postgresql://[^:]*:\([^@]*\)@.*|\1|p')
    DB_HOST=$(echo "$DATABASE_URL" | sed -n 's|.*@\([^:]*\):.*|\1|p')
    DB_NAME=$(echo "$DATABASE_URL" | sed -n 's|.*/\([^?]*\).*|\1|p')
    
    print_info "Database: $DB_NAME"
    print_info "User: $DB_USER"
    print_info "Host: $DB_HOST"
    echo ""
    
    # Test database connection
    print_info "Testing database connection..."
    if ! PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1;" >/dev/null 2>&1; then
        print_error "Cannot connect to database"
        exit 1
    fi
    print_status "Database connection successful"
    echo ""
    
    # Check Prisma migration status
    print_info "Checking Prisma migration status..."
    cd "$instance_dir/backend"
    
    echo ""
    echo -e "${YELLOW}=== Prisma Migration Status ===${NC}"
    npx prisma migrate status 2>&1 || true
    echo -e "${YELLOW}==============================${NC}"
    echo ""
    
    # Check for failed migrations
    fix_failed_migrations "$DB_NAME" "$DB_USER" "$DB_PASS" "$DB_HOST"
    
    # Ask if user wants to run migrations now
    echo ""
    echo -n -e "${BLUE}Do you want to run 'npx prisma migrate deploy' now? [y/N]: ${NC}"
    read -r run_migrate
    
    if [[ "$run_migrate" =~ ^[Yy] ]]; then
        print_info "Running migrations..."
        cd "$instance_dir/backend"
        
        if npx prisma migrate deploy; then
            print_status "Migrations completed successfully!"
        else
            print_error "Migration failed"
            print_info "You may need to run this script again or investigate further"
            exit 1
        fi
    else
        print_info "Skipped migration deployment"
        print_info "Run manually: cd $instance_dir/backend && npx prisma migrate deploy"
    fi
    
    echo ""
    print_status "Done!"
}

# Run main function
main "$@"

