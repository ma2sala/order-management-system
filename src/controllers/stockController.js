const prisma = require('../prisma/client');

// Shared include so every stock item we return has its linked menu items
// in the shape admin.js expects: link.id, link.qtyPerSale, link.menuItem.name
const withLinks = {
  links: {
    include: { menuItem: { select: { id: true, name: true } } },
    orderBy: { id: 'asc' },
  },
};

// GET /api/stock — manager only
async function listStock(req, res) {
  try {
    const stockItems = await prisma.stockItem.findMany({
      include: withLinks,
      orderBy: { name: 'asc' },
    });
    res.json(stockItems);
  } catch (err) {
    console.error('listStock error:', err);
    res.status(500).json({ error: 'Failed to fetch stock items' });
  }
}

// GET /api/stock/menu-items — manager only
// Flat list of menu items for the "link a menu item to this stock item"
// picker. Registered before /:id in the router so it isn't swallowed by
// the :id param route.
async function listMenuItemsForLinking(req, res) {
  try {
    const menuItems = await prisma.menuItem.findMany({
      select: { id: true, name: true, category: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });
    res.json(menuItems);
  } catch (err) {
    console.error('listMenuItemsForLinking error:', err);
    res.status(500).json({ error: 'Failed to fetch menu items' });
  }
}

// POST /api/stock — manager only, create a new stock item
async function createStockItem(req, res) {
  const { name, category, quantity, unit, threshold } = req.body;

  if (!name || !category) {
    return res.status(400).json({ error: 'name and category are required' });
  }
  const qty = quantity === undefined || quantity === null || quantity === '' ? 0 : Number(quantity);
  if (Number.isNaN(qty) || qty < 0) {
    return res.status(400).json({ error: 'quantity must be a non-negative number' });
  }
  let thresholdVal = null;
  if (threshold !== undefined && threshold !== null && threshold !== '') {
    thresholdVal = Number(threshold);
    if (Number.isNaN(thresholdVal) || thresholdVal < 0) {
      return res.status(400).json({ error: 'threshold must be a non-negative number' });
    }
  }

  try {
    const existing = await prisma.stockItem.findUnique({ where: { name } });
    if (existing) {
      return res.status(409).json({ error: 'A stock item with this name already exists' });
    }

    const stockItem = await prisma.stockItem.create({
      data: {
        name,
        category,
        quantity: qty,
        unit: unit || null,
        threshold: thresholdVal,
      },
      include: withLinks,
    });
    res.status(201).json(stockItem);
  } catch (err) {
    console.error('createStockItem error:', err);
    res.status(500).json({ error: 'Failed to create stock item' });
  }
}

// PATCH /api/stock/:id — manager only
// Used both for the quick "Save" quantity-only edit and the full
// Edit-modal save (name/category/quantity/unit/threshold), so every
// field is optional here — only what's present in the body gets updated.
async function updateStockItem(req, res) {
  const { id } = req.params;
  const { name, category, quantity, unit, threshold } = req.body;

  const data = {};

  if (name !== undefined) {
    if (!name.trim()) return res.status(400).json({ error: 'name cannot be empty' });
    data.name = name;
  }
  if (category !== undefined) {
    if (!category.trim()) return res.status(400).json({ error: 'category cannot be empty' });
    data.category = category;
  }
  if (quantity !== undefined) {
    const qty = Number(quantity);
    if (Number.isNaN(qty) || qty < 0) {
      return res.status(400).json({ error: 'quantity must be a non-negative number' });
    }
    data.quantity = qty;
  }
  if (unit !== undefined) {
    data.unit = unit === '' ? null : unit;
  }
  if (threshold !== undefined) {
    if (threshold === null || threshold === '') {
      data.threshold = null;
    } else {
      const thresholdVal = Number(threshold);
      if (Number.isNaN(thresholdVal) || thresholdVal < 0) {
        return res.status(400).json({ error: 'threshold must be a non-negative number' });
      }
      data.threshold = thresholdVal;
    }
  }

  if (Object.keys(data).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  try {
    const stockItem = await prisma.stockItem.update({
      where: { id },
      data,
      include: withLinks,
    });
    res.json(stockItem);
  } catch (err) {
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Stock item not found' });
    }
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'A stock item with this name already exists' });
    }
    console.error('updateStockItem error:', err);
    res.status(500).json({ error: 'Failed to update stock item' });
  }
}

// DELETE /api/stock/:id — manager only
// MenuItemStock links cascade-delete via the schema's onDelete: Cascade,
// so removing a stock item also removes its links automatically.
async function deleteStockItem(req, res) {
  const { id } = req.params;

  try {
    await prisma.stockItem.delete({ where: { id } });
    res.status(204).end();
  } catch (err) {
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Stock item not found' });
    }
    console.error('deleteStockItem error:', err);
    res.status(500).json({ error: 'Failed to delete stock item' });
  }
}

// POST /api/stock/:id/links — manager only, link a menu item to this stock item
async function createLink(req, res) {
  const { id: stockItemId } = req.params;
  const { menuItemId, qtyPerSale } = req.body;

  if (!menuItemId) {
    return res.status(400).json({ error: 'menuItemId is required' });
  }
  const qty = qtyPerSale === undefined || qtyPerSale === null || qtyPerSale === '' ? 1 : Number(qtyPerSale);
  if (Number.isNaN(qty) || qty <= 0) {
    return res.status(400).json({ error: 'qtyPerSale must be greater than 0' });
  }

  try {
    const [stockItem, menuItem] = await Promise.all([
      prisma.stockItem.findUnique({ where: { id: stockItemId } }),
      prisma.menuItem.findUnique({ where: { id: menuItemId } }),
    ]);
    if (!stockItem) return res.status(404).json({ error: 'Stock item not found' });
    if (!menuItem) return res.status(404).json({ error: 'Menu item not found' });

    const existing = await prisma.menuItemStock.findUnique({
      where: { menuItemId_stockItemId: { menuItemId, stockItemId } },
    });
    if (existing) {
      return res.status(409).json({ error: 'This menu item is already linked to this stock item' });
    }

    await prisma.menuItemStock.create({
      data: { menuItemId, stockItemId, qtyPerSale: qty },
    });

    const updated = await prisma.stockItem.findUnique({ where: { id: stockItemId }, include: withLinks });
    res.status(201).json(updated);
  } catch (err) {
    console.error('createLink error:', err);
    res.status(500).json({ error: 'Failed to link menu item' });
  }
}

// DELETE /api/stock/:id/links/:linkId — manager only, unlink a menu item
async function deleteLink(req, res) {
  const { id: stockItemId, linkId } = req.params;

  try {
    const link = await prisma.menuItemStock.findUnique({ where: { id: linkId } });
    if (!link || link.stockItemId !== stockItemId) {
      return res.status(404).json({ error: 'Link not found' });
    }

    await prisma.menuItemStock.delete({ where: { id: linkId } });
    res.status(204).end();
  } catch (err) {
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Link not found' });
    }
    console.error('deleteLink error:', err);
    res.status(500).json({ error: 'Failed to remove link' });
  }
}

module.exports = {
  listStock,
  listMenuItemsForLinking,
  createStockItem,
  updateStockItem,
  deleteStockItem,
  createLink,
  deleteLink,
};
