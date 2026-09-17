const prisma = require('../prisma/client');
const { addisDayStart } = require('./orderController');

const VALID_PAYMENT_METHODS = ['CASH', 'CARD', 'MOBILE_MONEY', 'TELEBIRR', 'CBE', 'BOA'];

// Shared shape the Cashier frontend needs for both the Open Bills list
// and Payment History: enough to render the bill, print a receipt, and
// (for history) show who paid and how.
const ORDER_WITH_BILL_DETAILS = {
  table: true,
  waiter: { select: { id: true, name: true } },
  cashier: { select: { id: true, name: true } },
  items: { include: { menuItem: { select: { name: true } } } },
};

// GET /api/payments/unpaid — cashier or manager
// Completed, non-voided, not-yet-paid orders — these are the bills
// waiting to be collected. Grouping into a single table's visit happens
// client-side in cashier.js.
async function listUnpaid(req, res) {
  try {
    const orders = await prisma.order.findMany({
      where: { status: 'COMPLETED', isVoided: false, isPaid: false },
      include: ORDER_WITH_BILL_DETAILS,
      orderBy: { createdAt: 'asc' },
    });
    res.json(orders);
  } catch (err) {
    console.error('listUnpaid error:', err);
    res.status(500).json({ error: 'Failed to fetch unpaid orders' });
  }
}

// POST /api/payments — cashier or manager
// multipart/form-data: orderIds (JSON-stringified array of order ids),
// paymentMethod, and an optional screenshot file. All orders in the
// batch (a table's grouped bill) get marked paid together, with the
// same screenshot proof attached to each.
async function recordPayment(req, res) {
  let orderIds;
  try {
    orderIds = JSON.parse(req.body.orderIds || '[]');
  } catch {
    return res.status(400).json({ error: 'orderIds must be a JSON-encoded array of order ids' });
  }
  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return res.status(400).json({ error: 'orderIds must be a non-empty array' });
  }

  const { paymentMethod } = req.body;
  if (!VALID_PAYMENT_METHODS.includes(paymentMethod)) {
    return res.status(400).json({ error: `paymentMethod must be one of ${VALID_PAYMENT_METHODS.join(', ')}` });
  }

  const paymentScreenshotUrl = req.file ? `/uploads/payment-screenshots/${req.file.filename}` : null;

  try {
    const orders = await prisma.order.findMany({ where: { id: { in: orderIds } } });
    if (orders.length !== orderIds.length) {
      return res.status(404).json({ error: 'One or more orders were not found' });
    }
    const notPayable = orders.find((o) => o.status !== 'COMPLETED' || o.isVoided || o.isPaid);
    if (notPayable) {
      return res.status(409).json({
        error: `Order #${notPayable.id.slice(0, 6).toUpperCase()} is not payable (must be completed, not voided, and not already paid)`,
      });
    }

    await prisma.order.updateMany({
      where: { id: { in: orderIds } },
      data: {
        isPaid: true,
        paidAt: new Date(),
        paymentMethod,
        cashierId: req.user.id,
        paymentScreenshotUrl,
      },
    });

    const paidOrders = await prisma.order.findMany({
      where: { id: { in: orderIds } },
      include: ORDER_WITH_BILL_DETAILS,
    });
    res.json(paidOrders);
  } catch (err) {
    console.error('recordPayment error:', err);
    res.status(500).json({ error: 'Failed to record payment' });
  }
}

// GET /api/payments/history?date=YYYY-MM-DD — cashier or manager
// Defaults to "today" in Addis Ababa when no date is given, same
// day-boundary logic orderController.js uses for its own daily views.
async function paymentHistory(req, res) {
  try {
    const dayStart = addisDayStart(req.query.date);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const orders = await prisma.order.findMany({
      where: { isPaid: true, paidAt: { gte: dayStart, lt: dayEnd } },
      include: ORDER_WITH_BILL_DETAILS,
      orderBy: { paidAt: 'desc' },
    });
    res.json(orders);
  } catch (err) {
    console.error('paymentHistory error:', err);
    res.status(500).json({ error: 'Failed to fetch payment history' });
  }
}

module.exports = { listUnpaid, recordPayment, paymentHistory };
