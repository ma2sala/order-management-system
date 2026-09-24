const express = require('express');
const router = express.Router();

const authenticate = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const { listUsers, listActiveWaiters, createUser, updateUser } = require('../controllers/userController');

// The cashier screen's waitress picker — registered before the
// manager-only guard below so cashiers can reach it (names only).
router.get('/waiters', authenticate, roleGuard(['CASHIER', 'MANAGER']), listActiveWaiters);

router.use(authenticate, roleGuard(['MANAGER']));

router.get('/', listUsers);
router.post('/', createUser);
router.patch('/:id', updateUser);

module.exports = router;