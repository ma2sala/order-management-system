const prisma = require('../prisma/client');
const { getIO } = require('../socket');
const { logOrderCreated } = require('../middleware/auditLogger');

// The restaurant operates in Addis Ababa (Ethiopia, UTC+3, no DST — the
// offset never changes across the year). "Today" and any ?date=YYYY-MM-DD
// filter from the Waiter/Barista/Manager screens are meant as the LOCAL
// calendar day there, but the server itself may run in a different
// timezone (e.g. Railway's containers default to UTC) or, on Matu's own
// machine, whatever the OS clock is set to. Computing day boundaries with
// setUTCHours/`...T00:00:00.000Z` silently assumes the server IS in UTC
// and treats "today" as the UTC calendar day — a 3-hour skew from Addis
// Ababa's actual midnight, meaning orders placed between local 00:00 and
// 03:00 could get filed under the wrong day. This constant makes day
// boundaries explicit and correct regardless of the server's own clock.
const ADDIS_ABABA_UTC_OFFSET_HOURS = 3;

// Returns the UTC instant that corresponds to 00:00:00 in Addis Ababa for
// the given YYYY-MM-DD string (or for "today" in Addis Ababa if omitted).
function addisDayStart(dateStr) {
  if (dateStr) {
    return new Date(`${dateStr}T00:00:00.000+03:00`);
  }
  // "Today" in Addis Ababa right now — shift the current UTC instant by
  // the offset to read off Addis Ababa's own calendar date, then convert
  // that date back into a real UTC instant for 00:00 Addis Ababa time.
  const nowInAddis = new Date(Date.now() + ADDIS_ABABA_UTC_OFFSET_HOURS * 60 * 60 * 1000);
  const y = nowInAddis.getUTCFullYear();
  const m = String(nowInAddis.getUTCMonth() + 1).padStart(2, '0');
  const d = String(nowInAddis.getUTCDate()).padStart(2, '0');
  return new Date(`${y}-${m}-${d}T00:00:00.000+03:00`);
}

// Menu items are assigned to a specific leaf category (e.g. "Food",
// "Alcohol", "Red Wine") which itself may sit under a parent and
// grandparent category. To route a ticket to the right kitchen display,
// we need to know which top-level branch an item's category ultimately
// belongs to: everything under "Meals" (Food, Snacks) is a kitchen/Chef
// item; everything under "Drinks" is a bar/Barista item. Categories are
// at most 3 levels deep in this schema, so 2 parent hops always reaches
// the root.
const MENU_ITEM_CATEGORY_TREE_INCLUDE = {
  category: {
    include: {
      parent: {
        include: { parent: true },
      },
    },
  },
};

// Walks a menu item's category up to its top-level ancestor and returns
// which display it belongs on. Falls back to 'bar' for anything that
// doesn't resolve cleanly (e.g. a category renamed away from "Meals"/
// "Drinks") so an item is never silently dropped from every display.
function stationOf(menuItem) {
  let cat = menuItem?.category;
  if (!cat) return 'bar';
  while (cat.parent) cat = cat.parent;
  if (cat.name === 'Meals') return 'kitchen';
  if (cat.name === 'Drinks') return 'bar';
  return 'bar';
}

// Attaches a `station` ('kitchen' | 'bar') to every item on an order, so
// the Barista and Chef displays can each show only the items meant for
// them within a shared ticket, without duplicating this tree-walk in
// three different frontend files.
function withStations(order) {
  if (!order?.items) return order;
  order.items = order.items.map((item) => ({ ...item, station: stationOf(item.menuItem) }));
  return order;
}

function withStationsMany(orders) {
  return orders.map(withStations);
}
async function createOrder(req, res) {
  const { tableId, items } = req.body; // items: [{ menuItemId, quantity, notes }]
  const waiterId = req.user.id;

  if (!tableId || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'tableId and at least one item are required' });
  }

  try {
    const menuItemIds = items.map((i) => i.menuItemId);
    const menuItems = await prisma.menuItem.findMany({
      where: { id: { in: menuItemIds } },
    });

    if (menuItems.length !== menuItemIds.length) {
      return res.status(400).json({ error: 'One or more menuItemId values are invalid' });
    }

    const priceMap = Object.fromEntries(menuItems.map((m) => [m.id, m.price]));

    const order = await prisma.order.create({
      data: {
        tableId,
        waiterId,
        status: 'PENDING',
        items: {
          create: items.map((i) => ({
            menuItemId: i.menuItemId,
            quantity: i.quantity || 1,
            notes: i.notes || null,
            unitPrice: priceMap[i.menuItemId],
          })),
        },
        statusLogs: {
          create: { fromStatus: null, toStatus: 'PENDING', changedById: waiterId },
        },
      },
      include: { items: { include: { menuItem: { include: MENU_ITEM_CATEGORY_TREE_INCLUDE } } }, table: true, waiter: true },
    });

    withStations(order);

    await logOrderCreated(order, req);

    // Push to the barista/manager display in real time
    console.log('[orders] Backend creating order for date:', order.createdAt, '| id:', order.id, '| table:', order.table?.label);
    const baristaRoom = getIO().sockets.adapter.rooms.get('barista_channel');
    const chefRoom = getIO().sockets.adapter.rooms.get('chef_channel');
    console.log('[orders] barista_channel has', baristaRoom ? baristaRoom.size : 0, '| chef_channel has', chefRoom ? chefRoom.size : 0, 'connected socket(s)');

    getIO().to('barista_channel').emit('new_order', order);

    // Only page the Chef Display if this ticket actually has a kitchen
    // item on it — a drinks-only order has nothing for the kitchen to do.
    if (order.items.some((i) => i.station === 'kitchen')) {
      getIO().to('chef_channel').emit('new_order', order);
    }

    return res.status(201).json(order);
  } catch (err) {
    console.error('createOrder error:', err);
    return res.status(500).json({ error: 'Failed to create order' });
  }
}

// PATCH /api/orders/:id/status — Barista/manager updates status
async function updateOrderStatus(req, res) {
  const { id } = req.params;
  const { status } = req.body; // 'IN_PROGRESS' | 'COMPLETED'
  const changedById = req.user.id;

  const allowedTransitions = ['IN_PROGRESS', 'COMPLETED'];
  if (!allowedTransitions.includes(status)) {
    return res.status(400).json({ error: `status must be one of ${allowedTransitions.join(', ')}` });
  }

  try {
    const existing = await prisma.order.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Order not found' });
    if (existing.isVoided) return res.status(409).json({ error: 'Cannot update a voided order' });

    const updated = await prisma.order.update({
      where: { id },
      data: {
        status,
        statusLogs: { create: { fromStatus: existing.status, toStatus: status, changedById } },
      },
      include: { waiter: true, items: { include: { menuItem: true } } },
    });

    // Notify only the waiter who owns this order
    getIO().to(`waiter_${updated.waiterId}`).emit('status_updated', {
      orderId: updated.id,
      status: updated.status,
    });
    // Managers watch everything for oversight
    getIO().to('manager_channel').emit('status_updated', {
      orderId: updated.id,
      status: updated.status,
    });

    return res.json(updated);
  } catch (err) {
    console.error('updateOrderStatus error:', err);
    return res.status(500).json({ error: 'Failed to update status' });
  }
}

// DELETE /api/orders/:id — Manager-only void (roleGuard blocks non-managers
// before this ever runs). This is a soft delete — nothing is erased.
async function voidOrder(req, res) {
  const { id } = req.params;
  const { reason } = req.body;
  const managerId = req.user.id;

  try {
    const existing = await prisma.order.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Order not found' });

    const voided = await prisma.order.update({
      where: { id },
      data: {
        isVoided: true,
        voidedById: managerId,
        voidReason: reason || 'No reason provided',
        voidedAt: new Date(),
        status: 'VOIDED',
        statusLogs: { create: { fromStatus: existing.status, toStatus: 'VOIDED', changedById: managerId } },
      },
    });

    getIO().to('barista_channel').emit('order_voided', { orderId: id });
    getIO().to('chef_channel').emit('order_voided', { orderId: id });
    getIO().to(`waiter_${existing.waiterId}`).emit('order_voided', { orderId: id });

    return res.json(voided);
  } catch (err) {
    console.error('voidOrder error:', err);
    return res.status(500).json({ error: 'Failed to void order' });
  }
}

// GET /api/orders — active queue for the Barista Display (barista/manager only)
async function listActiveOrders(req, res) {
  try {
    const orders = await prisma.order.findMany({
      where: { isVoided: false, status: { in: ['PENDING', 'IN_PROGRESS'] } },
      include: { items: { include: { menuItem: { include: MENU_ITEM_CATEGORY_TREE_INCLUDE } } }, table: true, waiter: true },
      orderBy: { createdAt: 'asc' },
    });
    return res.json(withStationsMany(orders));
  } catch (err) {
    console.error('listActiveOrders error:', err);
    return res.status(500).json({ error: 'Failed to fetch orders' });
  }
}

// GET /api/orders/mine — a waiter's own recent orders, for the waiter screen
async function listMyOrders(req, res) {
  try {
    // GET /api/orders/mine?date=YYYY-MM-DD — this waiter's orders for one
    // day only (defaults to today). Full day range: 00:00:00 up to, but
    // not including, the next day's 00:00:00 — same pattern as
    // listAllOrdersForDay below, so an order created at 11:59 PM still
    // counts for that day and nothing from the next day leaks in.
    const dateParam = req.query.date;
    const dayStart = addisDayStart(dateParam);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const orders = await prisma.order.findMany({
      where: {
        waiterId: req.user.id,
        createdAt: { gte: dayStart, lt: dayEnd },
      },
      include: { items: { include: { menuItem: true } }, table: true },
      orderBy: { createdAt: 'desc' },
    });
    return res.json(orders);
  } catch (err) {
    console.error('listMyOrders error:', err);
    return res.status(500).json({ error: 'Failed to fetch orders' });
  }
}

// GET /api/orders/all?date=YYYY-MM-DD — every order for a given day
// (pending, in progress, completed, and voided) — manager dashboard only.
async function listAllOrdersForDay(req, res) {
  try {
    const dateParam = req.query.date;
    const dayStart = addisDayStart(dateParam);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const orders = await prisma.order.findMany({
      where: { createdAt: { gte: dayStart, lt: dayEnd } },
      include: { items: { include: { menuItem: true } }, table: true, waiter: true, voidedBy: true },
      orderBy: { createdAt: 'desc' },
    });

    return res.json(orders);
  } catch (err) {
    console.error('listAllOrdersForDay error:', err);
    return res.status(500).json({ error: 'Failed to fetch orders' });
  }
}

// GET /api/orders/completed?date=YYYY-MM-DD — completed orders for one day
// (defaults to today), for the Barista Display's "Recent Completed" tab.
// Without a date filter this tab only ever showed today's completions —
// picking a past date on the display now re-queries that specific day.
async function listCompletedToday(req, res) {
  try {
    const dateParam = req.query.date;
    const dayStart = addisDayStart(dateParam);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const orders = await prisma.order.findMany({
      where: {
        status: 'COMPLETED',
        isVoided: false,
        createdAt: { gte: dayStart, lt: dayEnd },
      },
      include: { items: { include: { menuItem: { include: MENU_ITEM_CATEGORY_TREE_INCLUDE } } }, table: true, waiter: true },
      orderBy: { updatedAt: 'desc' },
      take: 30,
    });

    return res.json(withStationsMany(orders));
  } catch (err) {
    console.error('listCompletedToday error:', err);
    return res.status(500).json({ error: 'Failed to fetch completed orders' });
  }
}

module.exports = {
  createOrder,
  updateOrderStatus,
  voidOrder,
  listActiveOrders,
  listMyOrders,
  listAllOrdersForDay,
  listCompletedToday,
  addisDayStart,
};
