const { PrismaClient } = require('@prisma/client');

// Single shared instance — avoids exhausting DB connections in dev
// when a hot-reloader spawns multiple instances of the app.
const prisma = new PrismaClient();

module.exports = prisma;
