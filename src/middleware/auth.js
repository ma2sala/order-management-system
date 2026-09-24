const jwt = require('jsonwebtoken');
const prisma = require('../prisma/client');

// Verifies the JWT, then confirms the account is still active and uses
// its CURRENT role from the database. A token alone would keep working
// until it expires — and kitchen/bar logins now last 7 days (see
// authController.js) — so without this, deactivating a staff member or
// changing their role in the Staff tab wouldn't take effect for up to a
// week. Deactivated -> 401, which the screens show as "login expired".
async function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }

  const token = header.split(' ')[1];
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  try {
    const user = await verifyActiveUser(payload);
    if (!user) return res.status(401).json({ error: 'This account is no longer active' });
    req.user = user; // { id, name, role }
    next();
  } catch (err) {
    console.error('authenticate lookup error:', err);
    return res.status(500).json({ error: 'Failed to verify login' });
  }
}

// Shared with the Socket.io handshake (socket.js). Returns the user's
// current { id, name, role }, or null if the account no longer exists or
// was deactivated.
async function verifyActiveUser(payload) {
  const user = await prisma.user.findUnique({
    where: { id: payload.id },
    select: { id: true, name: true, role: true, isActive: true },
  });
  if (!user || !user.isActive) return null;
  return { id: user.id, name: user.name, role: user.role };
}

module.exports = authenticate;
module.exports.verifyActiveUser = verifyActiveUser;
