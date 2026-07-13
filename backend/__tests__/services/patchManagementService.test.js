jest.mock("../../src/config/prisma");
jest.mock("../../src/services/hostReportAlertEvaluator", () => ({
	evaluatePatchJobAlerts: jest.fn().mockResolvedValue(undefined),
}));

const { getPrismaClient } = require("../../src/config/prisma");
const {
	evaluatePatchJobAlerts,
} = require("../../src/services/hostReportAlertEvaluator");

const mockPrisma = {
	patch_jobs: {
		findMany: jest.fn(),
		updateMany: jest.fn(),
		update: jest.fn(),
	},
	patch_job_hosts: {
		findMany: jest.fn(),
		updateMany: jest.fn(),
	},
	$transaction: jest.fn(),
};

getPrismaClient.mockReturnValue(mockPrisma);

const {
	expireStalePatchJobs,
} = require("../../src/services/patchManagementService");

describe("expireStalePatchJobs", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		mockPrisma.$transaction.mockImplementation((callback) =>
			callback(mockPrisma),
		);
	});

	it("fails unfinished assignments after the maintenance-window duration", async () => {
		const now = new Date("2026-07-13T15:00:00.000Z");
		mockPrisma.patch_jobs.findMany.mockResolvedValue([
			{
				id: "stale-job",
				created_at: new Date("2026-07-13T12:00:00.000Z"),
				window: { duration_minutes: 120 },
			},
			{
				id: "current-job",
				created_at: new Date("2026-07-13T14:00:00.000Z"),
				window: { duration_minutes: 120 },
			},
		]);
		mockPrisma.patch_jobs.updateMany.mockResolvedValue({ count: 1 });
		mockPrisma.patch_job_hosts.updateMany.mockResolvedValue({ count: 1 });
		mockPrisma.patch_job_hosts.findMany.mockResolvedValue([
			{ status: "completed" },
			{ status: "failed" },
		]);
		mockPrisma.patch_jobs.update.mockResolvedValue({
			id: "stale-job",
			status: "completed_with_errors",
		});

		await expect(expireStalePatchJobs(now)).resolves.toBe(1);

		expect(mockPrisma.patch_job_hosts.updateMany).toHaveBeenCalledWith({
			where: {
				job_id: "stale-job",
				status: {
					in: ["pending", "downloading", "installing", "rebooting"],
				},
			},
			data: {
				status: "failed",
				completed_at: now,
				error_message: "Patch assignment timed out after 120 minutes",
			},
		});
		expect(mockPrisma.patch_jobs.update).toHaveBeenCalledWith({
			where: { id: "stale-job" },
			data: {
				status: "completed_with_errors",
				completed_at: now,
				completed_hosts: 1,
				failed_hosts: 1,
				skipped_hosts: 0,
			},
		});
		expect(evaluatePatchJobAlerts).toHaveBeenCalledWith(
			{ id: "stale-job", status: "completed_with_errors" },
			"completed_with_errors",
		);
	});

	it("does not overwrite a job that completed while expiry was running", async () => {
		const now = new Date("2026-07-13T15:00:00.000Z");
		mockPrisma.patch_jobs.findMany.mockResolvedValue([
			{
				id: "raced-job",
				created_at: new Date("2026-07-13T10:00:00.000Z"),
				window: null,
			},
		]);
		mockPrisma.patch_jobs.updateMany.mockResolvedValue({ count: 0 });

		await expect(expireStalePatchJobs(now)).resolves.toBe(0);
		expect(mockPrisma.patch_job_hosts.updateMany).not.toHaveBeenCalled();
		expect(mockPrisma.patch_jobs.update).not.toHaveBeenCalled();
	});
});
