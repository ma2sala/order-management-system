const bcrypt = require('bcrypt');
const prisma = require('../prisma/client');
const { disconnectUser } = require('../socket');

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

// GET /api/users/waiters — active waitresses (id + name only), for the
// cashier screen to pick whose paper ticket it's entering.
async function listActiveWaiters(req, res) {
  try {
    const waiters = await prisma.user.findMany({
      where: { role: 'WAITER', isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    res.json(waiters);
  } catch (err) {
    console.error('listActiveWaiters error:', err);
    res.status(500).json({ error: 'Failed to fetch waiters' });
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

// PATCH /api/users/:id — manager only
// Handles both the full Edit-modal save (name/email/isActive) and the
// quick Activate/Deactivate toggle (isActive only) — every field here is
// optional, only what's present in the body gets updated.
async function updateUser(req, res) {
  const { id } = req.params;
  const { name, email, isActive } = req.body;

  const data = {};

  if (name !== undefined) {
    if (!String(name).trim()) {
      return res.status(400).json({ error: 'name cannot be empty' });
    }
    data.name = name.trim();
  }

  if (email !== undefined) {
    if (!String(email).trim()) {
      return res.status(400).json({ error: 'email cannot be empty' });
    }
    data.email = email.trim();
  }

  if (isActive !== undefined) {
    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ error: 'isActive must be a boolean' });
    }
    if (id === req.user.id && isActive === false) {
      return res.status(400).json({ error: 'You cannot deactivate your own account' });
    }
    data.isActive = isActive;
  }

  if (Object.keys(data).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  try {
    const user = await prisma.user.update({
      where: { id },
      data,
      select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
    });
    if (user.isActive === false) disconnectUser(user.id);
    res.json(user);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'User not found' });
    if (err.code === 'P2002') return res.status(409).json({ error: 'A user with this email already exists' });
    console.error('updateUser error:', err);
    res.status(500).json({ error: 'Failed to update user' });
  }
}

module.exports = { listUsers, listActiveWaiters, createUser, updateUser };