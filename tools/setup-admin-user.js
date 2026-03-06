const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const readline = require("node:readline");

const prisma = new PrismaClient();

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
});

const question = (query) =>
	new Promise((resolve) => rl.question(query, resolve));

async function setupAdminUser() {
	try {
		console.log("🔐 Setting up PatchMon Admin User");
		console.log("=====================================\n");

		// Check if any users exist
		const existingUsers = await prisma.users.count();
		if (existingUsers > 0) {
			console.log("⚠️  Users already exist in the database.");
			const overwrite = await question(
				"Do you want to create another admin user? (y/N): ",
			);
			if (
				overwrite.toLowerCase() !== "y" &&
				overwrite.toLowerCase() !== "yes"
			) {
				console.log("❌ Setup cancelled.");
				return;
			}
		}

		// Get user input
		const username = await question("Enter admin username: ");
		if (!username.trim()) {
			console.log("❌ Username is required.");
			return;
		}

		const email = await question("Enter admin email: ");
		if (!email.trim()) {
			console.log("❌ Email is required.");
			return;
		}

		const password = await question(
			"Enter admin password (min 6 characters): ",
		);
		if (password.length < 6) {
			console.log("❌ Password must be at least 6 characters.");
			return;
		}

		// Check if username or email already exists
		const existingUser = await prisma.users.findFirst({
			where: {
				OR: [{ username: username.trim() }, { email: email.trim() }],
			},
		});

		if (existingUser) {
			console.log("❌ Username or email already exists.");
			return;
		}

		// Hash password
		console.log("\n🔄 Creating admin user...");
		const passwordHash = await bcrypt.hash(password, 12);

		// Create admin user
		const user = await prisma.users.create({
			data: {
				id: require("node:crypto").randomUUID(),
				username: username.trim(),
				email: email.trim(),
				password_hash: passwordHash,
				role: "admin",
				is_active: true,
				created_at: new Date(),
				updated_at: new Date(),
			},
			select: {
				id: true,
				username: true,
				email: true,
				role: true,
				created_at: true,
			},
		});

		console.log("✅ Admin user created successfully!");
		console.log("\n📋 User Details:");
		console.log(`   Username: ${user.username}`);
		console.log(`   Email: ${user.email}`);
		console.log(`   Role: ${user.role}`);
		console.log(`   Created: ${user.created_at.toISOString()}`);

		console.log("\n🎉 Setup complete!");
		console.log("\nNext steps:");
		console.log(
			"1. The backend server is already running as a systemd service",
		);
		console.log("2. The frontend is already built and served by Nginx");
		console.log(
			"3. Visit https://" +
				process.env.FQDN +
				" and login with your credentials",
		);
		console.log(
			"4. Use the management script: ./manage.sh {status|restart|logs|update|backup|credentials|reset-admin}",
		);
	} catch (error) {
		console.error("❌ Error setting up admin user:", error);
	} finally {
		rl.close();
		await prisma.$disconnect();
	}
}

// Run the setup
setupAdminUser();
