const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const prisma = require('../prisma/client');

// Kitchen/bar display tablets run all day, every day — a 12h login made
// them drop to the sign-in screen mid-shift. Those roles can only view
// tickets and mark them started/done, so they get a week; roles that
// handle money or staff (cashier, manager) and waiters keep 12h.
// Deactivating an account still takes effect immediately either way —
// see the isActive check in middleware/auth.js.
const LOGIN_DURATION_BY_ROLE = { CHEF: '7d', BARISTA: '7d' };
const DEFAULT_LOGIN_DURATION = '12h';

// POST /api/auth/login
async function login(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, name: user.name, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: LOGIN_DURATION_BY_ROLE[user.role] || DEFAULT_LOGIN_DURATION }
    );

    return res.json({
      token,
      user: { id: user.id, name: user.name, role: user.role },
    });
  } catch (err) {
    console.error('login error:', err);
    return res.status(500).json({ error: 'Login failed' });
  }
}

module.exports = { login };
