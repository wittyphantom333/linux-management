#!/bin/bash

# Script to update hardcoded connection pool values in prisma.js
# Usage: ./update_pool_values.sh [connection_limit] [pool_timeout] [connect_timeout] [idle_timeout] [max_lifetime]

set -e

FILE="${1:-backend/src/config/prisma.js}"

# Get values from arguments or use defaults
NEW_CONN_LIMIT="${2:-30}"
NEW_POOL_TIMEOUT="${3:-20}"
NEW_CONNECT_TIMEOUT="${4:-10}"
NEW_IDLE_TIMEOUT="${5:-300}"
NEW_MAX_LIFETIME="${6:-1800}"

if [ ! -f "$FILE" ]; then
    echo "Error: File not found: $FILE"
    exit 1
fi

# Create backup
BACKUP_FILE="${FILE}.backup.$(date +%Y%m%d_%H%M%S)"
cp "$FILE" "$BACKUP_FILE"
echo "Backup created: $BACKUP_FILE"

# Replace the hardcoded values
sed -i "s|url\.searchParams\.set(\"connection_limit\", \".*\");|url.searchParams.set(\"connection_limit\", \"$NEW_CONN_LIMIT\");|g" "$FILE"
sed -i "s|url\.searchParams\.set(\"pool_timeout\", \".*\");|url.searchParams.set(\"pool_timeout\", \"$NEW_POOL_TIMEOUT\");|g" "$FILE"
sed -i "s|url\.searchParams\.set(\"connect_timeout\", \".*\");|url.searchParams.set(\"connect_timeout\", \"$NEW_CONNECT_TIMEOUT\");|g" "$FILE"
sed -i "s|url\.searchParams\.set(\"idle_timeout\", \".*\");|url.searchParams.set(\"idle_timeout\", \"$NEW_IDLE_TIMEOUT\");|g" "$FILE"
sed -i "s|url\.searchParams\.set(\"max_lifetime\", \".*\");|url.searchParams.set(\"max_lifetime\", \"$NEW_MAX_LIFETIME\");|g" "$FILE"

echo "Updated values:"
echo "  connection_limit: $NEW_CONN_LIMIT"
echo "  pool_timeout: $NEW_POOL_TIMEOUT"
echo "  connect_timeout: $NEW_CONNECT_TIMEOUT"
echo "  idle_timeout: $NEW_IDLE_TIMEOUT"
echo "  max_lifetime: $NEW_MAX_LIFETIME"
echo ""
echo "Changes applied to $FILE"
