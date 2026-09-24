const express = require('express');
const router = express.Router();

const authenticate = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const { auditAttempt } = require('../middleware/auditLogger');
const {
  createOrder,
  updateOrderStatus,
  voidOrder,
  listActiveOrders,
  listMyOrders,
  listAllOrdersForDay,
  listCompletedToday,
} = require('../controllers/orderController');

// Every order route requires a valid, authenticated user
router.use(authenticate);

// Barista Display — active queue (barista/chef/manager — both kitchen
// displays share this endpoint and each filters to its own items
// client-side via the `station` tag on each order item)
router.get('/', roleGuard(['BARISTA', 'CHEF', 'MANAGER']), listActiveOrders);

// Barista/Chef Display — today's completed orders, so "Recent Completed" is
// still populated after a page refresh instead of resetting to empty
router.get('/completed', roleGuard(['BARISTA', 'CHEF', 'MANAGER']), listCompletedToday);

// Waiter screen — that waiter's own recent orders
router.get('/mine', roleGuard(['WAITER']), listMyOrders);

// Manager dashboard — every order for a given day, any status
router.get('/all', roleGuard(['MANAGER']), listAllOrdersForDay);

// Waiter submits an order — or the cashier (or a manager at the cashier
// screen) enters one on a waitress's behalf from her paper ticket; the
// controller then requires body.waiterId naming that waitress.
router.post('/', roleGuard(['WAITER', 'CASHIER', 'MANAGER']), createOrder);

// Barista/Chef/manager updates status — logged regardless of who calls it
router.patch(
  '/:id/status',
  auditAttempt('ORDER_STATUS_CHANGE'),
  roleGuard(['BARISTA', 'CHEF', 'MANAGER']),
  updateOrderStatus
);

// Security-critical: only MANAGER can void/cancel an order. The audit
// middleware runs FIRST — a waiter's forbidden attempt still lands in
// AuditLog with success: false, before roleGuard ever returns the 403.
router.delete(
  '/:id',
  auditAttempt('ORDER_DELETE_ATTEMPT'),
  roleGuard(['MANAGER']),
  voidOrder
);

module.exports = router;
