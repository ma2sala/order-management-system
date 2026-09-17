const express = require('express');
const router = express.Router();

const authenticate = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const {
  listMenuItems,
  listCategoriesFlat,
  createMenuItem,
  updateMenuItem,
  deleteMenuItem,
} = require('../controllers/menuItemController');

// Menu management — manager only, same as /api/users, /api/reports, /api/stock.
router.use(authenticate, roleGuard(['MANAGER']));

// IMPORTANT: /categories must be registered before /:id so it isn't
// swallowed by the :id param route below.
router.get('/categories', listCategoriesFlat);

router.get('/', listMenuItems);
router.post('/', createMenuItem);
router.patch('/:id', updateMenuItem);
router.delete('/:id', deleteMenuItem);

module.exports = router;
