const express = require('express');
const router = express.Router();

const authenticate = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const { dailyReport } = require('../controllers/reportController');
const { downloadBackup, listBackups, createBackupNow, downloadSavedBackup } = require('../controllers/backupController');

// Reconciliation data is revenue + staff-attempt data — manager eyes only
router.get('/daily', authenticate, roleGuard(['MANAGER']), dailyReport);

// Backups — manager only. /backup = fresh copy straight to the browser;
// /backups = the ones saved on the server (nightly + "Back up now").
const managerOnly = [authenticate, roleGuard(['MANAGER'])];
router.get('/backup', managerOnly, downloadBackup);
router.get('/backups', managerOnly, listBackups);
router.post('/backups', managerOnly, createBackupNow);
router.get('/backups/:name', managerOnly, downloadSavedBackup);

module.exports = router;
