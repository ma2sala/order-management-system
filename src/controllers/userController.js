const bcrypt = require('bcrypt');
const prisma = require('../prisma/client');

// GET /api/users — manager only
async function listUsers(req, res) {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    res.json(users);
  } catch (err) {
    console.error('listUsers error:', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
}

// POST /api/users — manager only, creates a new staff account
async function createUser(req, res) {
  const { name, email, password, role } = req.body;
  const allowedRoles = ['MANAGER', 'WAITER', 'BARISTA', 'CHEF', 'CASHIER'];

  if (!name || !email || !password || !allowedRoles.includes(role)) {
    return res.status(400).json({
      error: `name, email, password, and role are required (role must be one of ${allowedRoles.join(', ')})`,
    });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'A user with this email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { name, email, passwordHash, role },
      select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
    });

    res.status(201).json(user);
  } catch (err) {
    console.error('createUser error:', err);
    res.status(500).json({ error: 'Failed to create user' });
  }
}

// PATCH /api/users/:id — manager only, toggle active/inactive
// Deactivating an account is how you "remove" a waiter/barista without
// deleting their historical orders or audit trail.
async function setUserActive(req, res) {
  const { id } = req.params;
  const { isActive } = req.body;

  if (typeof isActive !== 'boolean') {
    return res.status(400).json({ error: 'isActive (boolean) is required' });
  }
  if (id === req.user.id && isActive === false) {
    return res.status(400).json({ error: 'You cannot deactivate your own account' });
  }

  try {
    const user = await prisma.user.update({
      where: { id },
      data: { isActive },
      select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
    });
    res.json(user);
  } catch (err) {
    console.error('setUserActive error:', err);
    res.status(500).json({ error: 'Failed to update user' });
  }
}

module.exports = { listUsers, createUser, setUserActive };
