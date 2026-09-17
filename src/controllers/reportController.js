const prisma = require('../prisma/client');

/**
 * GET /api/reports/daily?date=YYYY-MM-DD
 *
 * Compares two independent sources of truth for the same day, both scoped
 * to orders that are still valid (not voided):
 *   A) "Items ordered" — aggregated directly from Order/OrderItem
 *   B) "Revenue logged" — aggregated from AuditLog's ORDER_CREATED entries
 *
 * A voided order is excluded from both sides on purpose — voiding is a
 * manager-authorized, fully audited action (see voidOrder() and the
 * voidedOrders list below), not something this comparison should flag.
 * If the two numbers still don't match after excluding voids, that means
 * a still-valid order's total changed through some path that never called
 * logOrderCreated() — e.g. direct DB manipulation or a bypassed endpoint.
 * That remaining mismatch is the actual fraud signal this report exists
 * to surface.
 */
async function dailyReport(req, res) {
  try {
    const dateParam = req.query.date; // 'YYYY-MM-DD'
    const dayStart = dateParam ? new Date(`${dateParam}T00:00:00.000Z`) : startOfToday();
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    // ---- Source A: live order data ----
    const orders = await prisma.order.findMany({
      where: { createdAt: { gte: dayStart, lt: dayEnd } },
      include: { items: { include: { menuItem: true } } },
    });

    const nonVoided = orders.filter((o) => !o.isVoided);
    const voided = orders.filter((o) => o.isVoided);

    const itemTotals = {};
    let liveRevenue = 0;

    for (const order of nonVoided) {
      for (const item of order.items) {
        const key = item.menuItem.name;
        const lineTotal = Number(item.unitPrice) * item.quantity;
        liveRevenue += lineTotal;
        if (!itemTotals[key]) itemTotals[key] = { quantity: 0, revenue: 0 };
        itemTotals[key].quantity += item.quantity;
        itemTotals[key].revenue += lineTotal;
      }
    }

    // ---- Source B: audit log data ----
    // Excludes entries for orders that are now voided — a void is already
    // accounted for separately (see voidedOrders below) and shouldn't also
    // show up here as an unexplained gap.
    const creationLogs = await prisma.auditLog.findMany({
      where: {
        action: 'ORDER_CREATED',
        createdAt: { gte: dayStart, lt: dayEnd },
        success: true,
        order: { isVoided: false },
      },
    });
    const loggedRevenue = creationLogs.reduce((sum, log) => sum + Number(log.totalAmount || 0), 0);

    // ---- Sensitive attempts that day (void/delete/edit) ----
    const sensitiveAttempts = await prisma.auditLog.findMany({
      where: {
        action: { in: ['ORDER_VOID_ATTEMPT', 'ORDER_DELETE_ATTEMPT', 'ORDER_EDIT_ATTEMPT'] },
        createdAt: { gte: dayStart, lt: dayEnd },
      },
      include: { actor: { select: { name: true, role: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const failedAttempts = sensitiveAttempts.filter((a) => !a.success);

    const discrepancy = round2(liveRevenue - loggedRevenue);

    return res.json({
      date: dayStart.toISOString().slice(0, 10),
      summary: {
        ordersPlaced: orders.length,
        ordersVoided: voided.length,
        liveRevenue: round2(liveRevenue),
        loggedRevenue: round2(loggedRevenue),
        discrepancy,
        reconciled: discrepancy === 0,
      },
      itemsOrdered: Object.entries(itemTotals).map(([name, v]) => ({
        name,
        quantity: v.quantity,
        revenue: round2(v.revenue),
      })),
      voidedOrders: voided.map((o) => ({
        orderId: o.id,
        tableId: o.tableId,
        voidedById: o.voidedById,
        voidReason: o.voidReason,
        voidedAt: o.voidedAt,
      })),
      flaggedAttempts: {
        total: sensitiveAttempts.length,
        failed: failedAttempts.length,
        details: failedAttempts.map((a) => ({
          action: a.action,
          orderId: a.orderId,
          actor: a.actor?.name || 'unknown',
          role: a.actor?.role || 'unknown',
          at: a.createdAt,
          ip: a.ipAddress,
        })),
      },
    });
  } catch (err) {
    console.error('dailyReport error:', err);
    return res.status(500).json({ error: 'Failed to generate report' });
  }
}

function startOfToday() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = { dailyReport };
