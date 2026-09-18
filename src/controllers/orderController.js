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
  if (cat.name === 'Snacks') return 'kitchen';
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
    // Category tree included here (not just for pricing) so stationOf()
    // can determine, right now at creation time, which station(s) this
    // order actually needs — that's what seeds kitchenStatus/barStatus
    // below, and what a mixed order gets split across in real time.
    const menuItems = await prisma.menuItem.findMany({
      where: { id: { in: menuItemIds } },
      include: MENU_ITEM_CATEGORY_TREE_INCLUDE,
    });

    if (menuItems.length !== menuItemIds.length) {
      return res.status(400).json({ error: 'One or more menuItemId values are invalid' });
    }

    const priceMap = Object.fromEntries(menuItems.map((m) => [m.id, m.price]));
    const menuItemMap = Object.fromEntries(menuItems.map((m) => [m.id, m]));

    const stationsNeeded = new Set(items.map((i) => stationOf(menuItemMap[i.menuItemId])));
    const hasKitchen = stationsNeeded.has('kitchen');
    const hasBar = stationsNeeded.has('bar');

    const order = await prisma.order.create({
      data: {
        tableId,
        waiterId,
        status: 'PENDING',
        kitchenStatus: hasKitchen ? 'PENDING' : null,
        barStatus: hasBar ? 'PENDING' : null,
        items: {
          // Customizations sent by the waiter — temperature,
          // removedIngredients, and extraNames — were being silently
          // dropped here before: only menuItemId/quantity/notes/unitPrice
          // ever made it into the create() call, so nothing was ever
          // saved to the database regardless of what the customize
          // modal collected. This is why every KDS "View Details" modal
          // showed "No customizations" even for genuinely modified
          // items — there was truly nothing there to show.
          create: items.map((i) => {
            const menuItem = menuItemMap[i.menuItemId];
            const extraNames = Array.isArray(i.extraNames) ? i.extraNames : [];
            // Resolve each requested extra's name against this menu
            // item's own extraOptions to snapshot its price at order
            // time (matches the schema's documented shape for
            // selectedExtras) — a bare name string isn't enough on its
            // own to know what it cost when this order was placed.
            const selectedExtras = extraNames
              .map((name) => {
                const opt = (menuItem.extraOptions || []).find((e) => e.name === name);
                return opt ? { name: opt.name, price: opt.price } : null;
              })
              .filter(Boolean);

            return {
              menuItemId: i.menuItemId,
              quantity: i.quantity || 1,
              notes: i.notes || null,
              unitPrice: priceMap[i.menuItemId],
              temperature: i.temperature || null,
              removedIngredients: Array.isArray(i.removedIngredients) ? i.removedIngredients : [],
              selectedExtras: selectedExtras.length > 0 ? selectedExtras : null,
            };
          }),
        },
        statusLogs: {
          create: { fromStatus: null, toStatus: 'PENDING', changedById: waiterId },
        },
      },
      include: { items: { include: { menuItem: { include: MENU_ITEM_CATEGORY_TREE_INCLUDE } } }, table: true, waiter: true },
    });

    withStations(order);

    await logOrderCreated(order, req);

    // Push to the barista/chef displays in real time — each station only
    // gets paged if this ticket actually has something for them; a
    // drinks-only order never pings the Chef Display, and vice versa.
    console.log('[orders] Backend creating order for date:', order.createdAt, '| id:', order.id, '| table:', order.table?.label);
    const baristaRoom = getIO().sockets.adapter.rooms.get('barista_channel');
    const chefRoom = getIO().sockets.adapter.rooms.get('chef_channel');
    console.log('[orders] barista_channel has', baristaRoom ? baristaRoom.size : 0, '| chef_channel has', chefRoom ? chefRoom.size : 0, 'connected socket(s)');

    if (hasBar) {
      getIO().to('barista_channel').emit('new_order', order);
    }
    if (hasKitchen) {
      getIO().to('chef_channel').emit('new_order', order);
    }
    // Managers watch everything — the dashboard's Orders tab live-inserts
    // this without a page refresh (see admin.js's socket.on('new_order')).
    getIO().to('manager_channel').emit('new_order', order);

    return res.status(201).json(order);
  } catch (err) {
    console.error('createOrder error:', err);
    return res.status(500).json({ error: 'Failed to create order' });
  }
}

// Each order tracks kitchenStatus/barStatus independently (null means
// "no items for that station on this order"). The overall `status` is
// derived from the two: PENDING until any relevant station has started,
// IN_PROGRESS once any relevant station has started or finished,
// COMPLETED only once EVERY relevant station reports COMPLETED. That
// derived COMPLETED is also exactly what makes an order show up in the
// Cashier's unpaid list (GET /api/payments/unpaid filters on
// status: 'COMPLETED') — a mixed food+drink order only reaches the
// cashier once both the kitchen and the bar have finished their half.
function deriveOverallStatus(kitchenStatus, barStatus) {
  const relevant = [kitchenStatus, barStatus].filter((s) => s != null);
  if (relevant.length === 0) return 'PENDING'; // shouldn't happen — every order needs at least one station
  if (relevant.every((s) => s === 'COMPLETED')) return 'COMPLETED';
  if (relevant.some((s) => s === 'IN_PROGRESS' || s === 'COMPLETED')) return 'IN_PROGRESS';
  return 'PENDING';
}

// PATCH /api/orders/:id/status — Barista/Chef/manager updates status for
// their OWN station only (body: { status: 'IN_PROGRESS' | 'COMPLETED',
// station: 'kitchen' | 'bar' }). Each station's queue is managed
// completely independently; the shared `status` field above is only
// ever written here as the derived result, never set directly by a
// station's PATCH.
async function updateOrderStatus(req, res) {
  const { id } = req.params;
  const { status, station } = req.body;
  const changedById = req.user.id;

  const allowedTransitions = ['IN_PROGRESS', 'COMPLETED'];
  if (!allowedTransitions.includes(status)) {
    return res.status(400).json({ error: `status must be one of ${allowedTransitions.join(', ')}` });
  }
  if (station !== 'kitchen' && station !== 'bar') {
    return res.status(400).json({ error: "station must be 'kitchen' or 'bar'" });
  }

  try {
    const existing = await prisma.order.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Order not found' });
    if (existing.isVoided) return res.status(409).json({ error: 'Cannot update a voided order' });

    const stationField = station === 'kitchen' ? 'kitchenStatus' : 'barStatus';
    if (existing[stationField] == null) {
      return res.status(400).json({ error: `This order has no items for the ${station} station` });
    }

    const newKitchenStatus = station === 'kitchen' ? status : existing.kitchenStatus;
    const newBarStatus = station === 'bar' ? status : existing.barStatus;
    const newOverallStatus = deriveOverallStatus(newKitchenStatus, newBarStatus);

    const updated = await prisma.order.update({
      where: { id },
      data: {
        [stationField]: status,
        status: newOverallStatus,
        statusLogs: { create: { fromStatus: existing.status, toStatus: newOverallStatus, changedById } },
      },
      include: { waiter: true, table: true, items: { include: { menuItem: true } } },
    });

    const payload = {
      orderId: updated.id,
      station,
      stationStatus: status,
      kitchenStatus: updated.kitchenStatus,
      barStatus: updated.barStatus,
      status: updated.status,
    };

    const justCompleted = existing.status !== 'COMPLETED' && updated.status === 'COMPLETED';

    // Managers always get the granular per-station payload — the
    // dashboard patches its own state off of it (see admin.js).
    getIO().to('manager_channel').emit('status_updated', payload);

    // The waiter gets exactly ONE event per update, never two for the
    // same underlying change: table_ready_for_checkout below is the
    // single, final signal once every station is done — emitting the
    // interim per-station status_updated to the waiter room AS WELL, on
    // that same completing update, was firing two toasts back-to-back
    // for what is, from the waiter's point of view, one event.
    if (!justCompleted) {
      getIO().to(`waiter_${updated.waiterId}`).emit('status_updated', payload);
    }

    // The order just became fully done across every station it needed —
    // hand it to the Cashier and let the waiter know the table can be
    // checked out. (justCompleted guards this so it only fires once, on
    // the actual transition, not on every later no-op re-save.)
    if (justCompleted) {
      const readyPayload = { orderId: updated.id, tableId: updated.tableId, tableLabel: updated.table.label };
      getIO().to(`waiter_${updated.waiterId}`).emit('table_ready_for_checkout', readyPayload);
      getIO().to('cashier_channel').emit('table_ready_for_checkout', readyPayload);
      getIO().to('manager_channel').emit('table_ready_for_checkout', readyPayload);
    }

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
    // Managers weren't in this list before — the dashboard needs it to
    // patch its Overview stats and Orders table live (see admin.js).
    getIO().to('manager_channel').emit('order_voided', { orderId: id });

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
      include: { items: { include: { menuItem: true } }, table: true, waiter: true, voidedBy: true, cashier: true },
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
    // Optional ?station=kitchen|bar — narrows to THAT station's own
    // completion (kitchenStatus/barStatus === 'COMPLETED') rather than
    // the whole order's derived status, so Chef's "Recent Completed" tab
    // shows a ticket the moment the kitchen finishes its half, even if
    // the bar side of that same order is still in progress (and vice
    // versa for Barista). Omitting it keeps the old whole-order behavior.
    const station = req.query.station;
    const dayStart = addisDayStart(dateParam);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const where = {
      isVoided: false,
      createdAt: { gte: dayStart, lt: dayEnd },
    };
    if (station === 'kitchen') where.kitchenStatus = 'COMPLETED';
    else if (station === 'bar') where.barStatus = 'COMPLETED';
    else where.status = 'COMPLETED';

    const orders = await prisma.order.findMany({
      where,
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
