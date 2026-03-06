const { getPrismaClient } = require("../../../config/prisma");

const prisma = getPrismaClient();

module.exports = { prisma };
