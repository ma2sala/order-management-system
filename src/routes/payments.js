const express = require('express');
const router = express.Router();

const authenticate = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const uploadPaymentScreenshot = require('../middleware/upload');
const { listUnpaid, recordPayment, paymentHistory } = require('../controllers/paymentController');

// Bill/payment data — cashier or manager, matching cashier.js's own
// login check (it rejects any other role client-side too).
router.use(authenticate, roleGuard(['CASHIER', 'MANAGER']));

// IMPORTANT: /unpaid and /history must be registered before any /:id
// style route would be, so they're never at risk of being swallowed.
router.get('/unpaid', listUnpaid);
router.get('/history', paymentHistory);

// multer's fileFilter/limits errors land in Express's error-handling
// middleware (see app.js), not a normal try/catch in the controller.
router.post('/', uploadPaymentScreenshot.single('screenshot'), recordPayment);

module.exports = router;
