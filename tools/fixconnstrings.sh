#!/bin/bash

# Script to fix HTTP connection limit issue for hosts page
# This adds a bulk status endpoint and updates the frontend to use it

set -e

echo "🔧 Fixing HTTP connection limit issue..."

# Backup files first
echo "📦 Creating backups..."
cp backend/src/routes/wsRoutes.js backend/src/routes/wsRoutes.js.bak
cp frontend/src/pages/Hosts.jsx frontend/src/pages/Hosts.jsx.bak

# Add bulk status endpoint to wsRoutes.js
echo "➕ Adding bulk status endpoint to backend..."

cat > /tmp/ws_routes_addition.txt << 'EOF'
// Get WebSocket connection status for multiple hosts at once
router.get("/status", authenticateToken, async (req, res) => {
	try {
		const { apiIds } = req.query; // Comma-separated list of api_ids
		const idArray = apiIds ? apiIds.split(',').filter(id => id.trim()) : [];
		
		const statusMap = {};
		idArray.forEach(apiId => {
			statusMap[apiId] = getConnectionInfo(apiId);
		});
		
		res.json({
			success: true,
			data: statusMap,
		});
	} catch (error) {
		console.error("Error fetching bulk WebSocket status:", error);
		res.status(500).json({
			success: false,
			error: "Failed to fetch WebSocket status",
		});
	}
});
EOF

# Find the line number of the first router.get and insert after it
LINENUM=$(grep -n "router.get.*status.*apiId" backend/src/routes/wsRoutes.js | head -1 | cut -d: -f1)
sed -i "${LINENUM}r /tmp/ws_routes_addition.txt" backend/src/routes/wsRoutes.js

# Now update the frontend to use the bulk endpoint
echo "🔄 Updating frontend to use bulk endpoint..."

# Create a sed script to replace the fetchInitialStatus function
cat > /tmp/hosts_fix.sed << 'EOF'
/const fetchInitialStatus = async/,\}/c\
	const fetchInitialStatus = async () => {\
		const apiIds = hosts\
			.filter((host) => host.api_id)\
			.map(host => host.api_id);\
		\
		if (apiIds.length === 0) return;\
		\
		try {\
			const response = await fetch(`/api/v1/ws/status?apiIds=${apiIds.join(',')}`, {\
				headers: {\
					Authorization: `Bearer ${token}`,\
				},\
			});\
			if (response.ok) {\
				const result = await response.json();\
				setWsStatusMap(result.data);\
			}\
		} catch (_error) {\
			// Silently handle errors\
		}\
	};
EOF

# Apply the sed script (multiline replacement is tricky with sed, so we'll use a different approach)
echo "✨ Using awk for multi-line replacement..."

# Create a temporary awk script
cat > /tmp/update_hosts.awk << 'AWK_EOF'
BEGIN { in_function=0; brace_count=0 }
/store.fetchInitialStatus/ { printing=1 }
/const fetchInitialStatus = async/ { 
    print "			// Fetch initial WebSocket status for all hosts"; 
    print "			const fetchInitialStatus = async () => {"; 
    print "				const apiIds = hosts"; 
    print "					.filter((host) => host.api_id)"; 
    print "					.map(host => host.api_id);"; 
    print ""; 
    print "				if (apiIds.length === 0) return;"; 
    print ""; 
    print "				try {"; 
    print "					const response = await fetch(`/api/v1/ws/status?apiIds=${apiIds.join(',')}`, {"; 
    print "						headers: {"; 
    print "							Authorization: `Bearer ${token}`,"; 
    print "						},"; 
    print "					});"; 
    print "					if (response.ok) {"; 
    print "						const result = await response.json();"; 
    print "						setWsStatusMap(result.data);"; 
    print "					}"; 
    print "				} catch (_error) {"; 
    print "					// Silently handle errors"; 
    print "				}"; 
    print "			};"; 
    skipping=1; 
    next 
}
skipping && /^\t\t\}/ { skipping=0; next }
skipping { next }
{ print }
AWK_EOF

awk -f /tmp/update_hosts.awk frontend/src/pages/Hosts.jsx.bak > frontend/src/pages/Hosts.jsx

# Clean up temp files
rm /tmp/ws_routes_addition.txt /tmp/hosts_fix.sed /tmp/update_hosts.awk

echo "✅ Done! Files have been modified."
echo ""
echo "📝 Changes made:"
echo "   - backend/src/routes/wsRoutes.js: Added bulk status endpoint"
echo "   - frontend/src/pages/Hosts.jsx: Updated to use bulk endpoint"
echo ""
echo "💾 Backups saved as:"
echo "   - backend/src/routes/wsRoutes.js.bak"
echo "   - frontend/src/pages/Hosts.jsx.bak"
