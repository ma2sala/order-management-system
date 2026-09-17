const express = require('express');
const router = express.Router();

const authenticate = require('../middleware/auth');
const prisma = require('../prisma/client');

router.use(authenticate);

// GET /api/tables
router.get('/tables', async (req, res) => {
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
router.get('/categories', async (req, res) => {
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
