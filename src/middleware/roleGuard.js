// Generic factory: roleGuard(['MANAGER']) locks a route to managers only.
// This is the core defense against waiters cancelling/voiding orders —
// it runs BEFORE the controller ever touches the DB.
function roleGuard(allowedRoles = []) {
  return (req, res, next) => {
    if (!req.user) {
      // Should never happen if authenticate() ran first, but fail closed anyway
      return res.status(401).json({ error: 'Unauthenticated' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Forbidden: requires one of [${allowedRoles.join(', ')}]`,
      });
    }

    next();
  };
}

module.exports = roleGuard;
