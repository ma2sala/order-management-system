const express = require('express');
const router = express.Router();

const authenticate = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const { dailyReport } = require('../controllers/reportController');

// Reconciliation data is revenue + staff-attempt data — manager eyes only
router.get('/daily', authenticate, roleGuard(['MANAGER']), dailyReport);

module.exports = router;
