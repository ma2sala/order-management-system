const crypto = require('crypto');
const prisma = require('../prisma/client');

// One-way hash of the bearer token — for correlation ("same token used
// twice"), never for replay. The raw JWT is never persisted.
function hashToken(req) {
  const header = req.headers.authorization;
  if (!header) return null;
  const token = header.replace('Bearer ', '');
  return crypto.createHash('sha256').update(token).digest('hex');
}

function baseFields(req) {
  return {
    actorId: req.user?.id || null,
    authTokenHash: hashToken(req),
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'] || null,
  };
}

/**
 * Record a completed, successful action — used for order creation,
 * where there's no "attempt vs outcome" ambiguity.
 */
async function logOrderCreated(order, req) {
  try {
    const totalAmount = order.items.reduce(
      (sum, i) => sum + Number(i.unitPrice) * i.quantity,
      0
    );

    await prisma.auditLog.create({
      data: {
        action: 'ORDER_CREATED',
        orderId: order.id,
        tableId: order.tableId,
        totalAmount,
        success: true,
        ...baseFields(req),
      },
    });
  } catch (err) {
    // Audit logging must never crash the main request — log to stderr
    // and let ops alerting pick it up, but don't fail the order itself.
    console.error('AUDIT LOG FAILURE (order_created):', err);
  }
}

/**
 * Middleware factory for sensitive routes: edit, void, delete.
 *
 * This runs BEFORE roleGuard in the route chain on purpose. A blocked
 * attempt is exactly the event you want on record for fraud detection —
 * logging only after roleGuard passes would mean every unauthorized
 * attempt (e.g. a waiter hitting DELETE directly) leaves no trace.
 */
function auditAttempt(action) {
  return (req, res, next) => {
    const startFields = {
      action,
      orderId: req.params.id || null,
      ...baseFields(req),
    };

    res.on('finish', () => {
      const success = res.statusCode < 400;
      prisma.auditLog
        .create({
          data: {
            ...startFields,
            success,
            metadata: {
              statusCode: res.statusCode,
              path: req.originalUrl,
              method: req.method,
              reason: req.body?.reason || undefined,
            },
          },
        })
        .catch((err) => console.error('AUDIT LOG FAILURE (attempt):', err));
    });

    next();
  };
}

module.exports = { logOrderCreated, auditAttempt };
