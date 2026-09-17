const express = require('express');
const router = express.Router();

const authenticate = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const { listUsers, createUser, updateUser } = require('../controllers/userController');

router.use(authenticate, roleGuard(['MANAGER']));

router.get('/', listUsers);
router.post('/', createUser);
router.patch('/:id', updateUser);

module.exports = router;