const express = require('express');
const router = express.Router();

const authenticate = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const { dailyReport } = require('../controllers/reportController');
const { downloadBackup } = require('../controllers/backupController');

// Reconciliation data is revenue + staff-attempt data — manager eyes only
router.get('/daily', authenticate, roleGuard(['MANAGER']), dailyReport);

// Full read-only database backup (JSON download) — manager only
router.get('/backup', authenticate, roleGuard(['MANAGER']), downloadBackup);

module.exports = router;
