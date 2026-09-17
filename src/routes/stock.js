const express = require('express');
const router = express.Router();

const authenticate = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const {
  listStock,
  listMenuItemsForLinking,
  createStockItem,
  updateStockItem,
  deleteStockItem,
  createLink,
  deleteLink,
} = require('../controllers/stockController');

// Inventory data — manager only, same as /api/users and /api/reports.
router.use(authenticate, roleGuard(['MANAGER']));

// IMPORTANT: /menu-items must be registered before /:id so it isn't
// swallowed by the :id param route below.
router.get('/menu-items', listMenuItemsForLinking);

router.get('/', listStock);
router.post('/', createStockItem);
router.patch('/:id', updateStockItem);
router.delete('/:id', deleteStockItem);

router.post('/:id/links', createLink);
router.delete('/:id/links/:linkId', deleteLink);

module.exports = router;
