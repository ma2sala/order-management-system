const express = require('express');
const router = express.Router();

const authenticate = require('../middleware/auth');
const prisma = require('../prisma/client');

// Login is checked per route, not with router.use(): this router is
// mounted on all of /api (see app.js), so a router-wide check would also
// run for every other /api/* request — a second, redundant login lookup
// on top of those routers' own.

// GET /api/tables
router.get('/tables', authenticate, async (req, res) => {
  try {
    const tables = await prisma.restaurantTable.findMany({ orderBy: { label: 'asc' } });
    res.json(tables);
  } catch (err) {
    console.error('list tables error:', err);
    res.status(500).json({ error: 'Failed to fetch tables' });
  }
});

// GET /api/categories (top-level only, with children/grandchildren and
// their available menu items nested — the waiter UI needs this tree shape
// to render the main / sub / sub-sub tab rows separately)
router.get('/categories', authenticate, async (req, res) => {
  try {
    const categories = await prisma.category.findMany({
      where: { parentId: null },
      orderBy: { name: 'asc' },
      include: {
        menuItems: { where: { isAvailable: true }, orderBy: { name: 'asc' } },
        children: {
          orderBy: { name: 'asc' },
          include: {
            menuItems: { where: { isAvailable: true }, orderBy: { name: 'asc' } },
            children: {
              orderBy: { name: 'asc' },
              include: {
                menuItems: { where: { isAvailable: true }, orderBy: { name: 'asc' } },
              },
            },
          },
        },
      },
    });
    res.json(categories);
  } catch (err) {
    // Log the full stack server-side so the real cause shows up in the
    // terminal running `npm start`, not just a generic message.
    console.error('list categories error:', err.stack || err);
    res.status(500).json({ error: err.message || 'Failed to fetch categories' });
  }
});

module.exports = router;
