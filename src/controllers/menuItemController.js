const prisma = require('../prisma/client');
const { getIO } = require('../socket');

// Every screen that shows the menu (Waiter, Cashier's New Order tab,
// other Manager Dashboards) reloads it on this — so a price change or an
// item marked Removed shows up everywhere without anyone refreshing.
function broadcastMenuChanged() {
  getIO().emit('menu_changed');
}

const VALID_TEMPERATURES = ['HOT', 'COLD', 'NORMAL', 'NORMAL_WITH_ICE'];

// Same 2-parent-hop include used in orderController.js's
// MENU_ITEM_CATEGORY_TREE_INCLUDE — categories are at most 3 levels deep
// in this schema, so this always reaches the root.
const CATEGORY_TREE_INCLUDE = {
  category: {
    include: {
      parent: {
        include: { parent: true },
      },
    },
  },
};

// Walks a menu item's category up to the root and joins the names into
// a display path, e.g. "Drinks > Alcohol > Red Wine".
function categoryPathOf(menuItem) {
  const names = [];
  let cat = menuItem.category;
  while (cat) {
    names.unshift(cat.name);
    cat = cat.parent;
  }
  return names.join(' > ');
}

function serializeMenuItem(m) {
  return {
    id: m.id,
    name: m.name,
    price: m.price,
    imageUrl: m.imageUrl,
    isAvailable: m.isAvailable,
    isFeatured: m.isFeatured,
    categoryId: m.categoryId,
    categoryPath: categoryPathOf(m),
    category: { id: m.category.id, name: m.category.name },
    hasTemperatureOption: m.hasTemperatureOption,
    temperatureOptions: m.temperatureOptions,
    customizableIngredients: m.customizableIngredients,
    extraOptions: m.extraOptions,
  };
}

// GET /api/menu-items — manager only, every item (available or not),
// with a display-ready categoryPath for the admin table/filters.
async function listMenuItems(req, res) {
  try {
    const items = await prisma.menuItem.findMany({
      include: CATEGORY_TREE_INCLUDE,
      orderBy: { name: 'asc' },
    });
    res.json(items.map(serializeMenuItem));
  } catch (err) {
    console.error('listMenuItems error:', err);
    res.status(500).json({ error: 'Failed to fetch menu items' });
  }
}

// GET /api/menu-items/categories — manager only, every category (any
// depth) flattened with a display path, for the Add/Edit Item modal's
// category picker. Registered before /:id in the router so it isn't
// swallowed by the :id param route.
async function listCategoriesFlat(req, res) {
  try {
    const categories = await prisma.category.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { menuItems: true, children: true } } },
    });
    const byId = new Map(categories.map((c) => [c.id, c]));

    function pathOf(cat) {
      const names = [];
      let cur = cat;
      while (cur) {
        names.unshift(cur.name);
        cur = cur.parentId ? byId.get(cur.parentId) : null;
      }
      return names;
    }

    res.json(
      categories.map((c) => {
        const names = pathOf(c);
        return {
          id: c.id,
          name: c.name,
          path: names.join(' > '),
          parentId: c.parentId,
          depth: names.length, // 1 = top level (Drinks/Meals/Snacks)
          itemCount: c._count.menuItems,
          childCount: c._count.children,
          isFixed: !c.parentId && FIXED_TOP_CATEGORIES.includes(c.name),
        };
      })
    );
  } catch (err) {
    console.error('listCategoriesFlat error:', err);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
}

// ---------------- Category management (Manager → Menu) ----------------
// The top-level categories decide which screen a ticket goes to (see
// stationOf() in orderController.js: Drinks → Barista, Meals/Snacks →
// Chef), so they're fixed — renaming or deleting one would misroute
// orders. Everything under them can be added, renamed and deleted.
//
// Categories go at most 3 levels deep (e.g. Drinks > Alcohol > Red Wine),
// which is what the Waiter/Cashier menus can display. And a category is
// either a container (has sub-categories) or holds items — never both:
// those screens only show the items of the deepest level, so an item
// sitting directly in a category that also has sub-categories would
// silently vanish from ordering.
const FIXED_TOP_CATEGORIES = ['Drinks', 'Meals', 'Snacks'];
const MAX_CATEGORY_DEPTH = 3;

async function categoryDepth(id) {
  let depth = 0;
  let cur = await prisma.category.findUnique({ where: { id } });
  while (cur) {
    depth += 1;
    cur = cur.parentId ? await prisma.category.findUnique({ where: { id: cur.parentId } }) : null;
  }
  return depth;
}

function cleanCategoryName(name) {
  return typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
}

// The database only rejects exact duplicates; "hot drinks" next to "Hot
// Drinks" would still make two confusing tabs, so compare ignoring case.
async function categoryNameTaken(name, exceptId) {
  const existing = await prisma.category.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
  return existing && existing.id !== exceptId ? existing : null;
}

// POST /api/menu-items/categories — { name, parentId }
async function createCategory(req, res) {
  const name = cleanCategoryName(req.body.name);
  const { parentId } = req.body;
  if (!name) return res.status(400).json({ error: 'Enter a category name' });
  if (name.length > 60) return res.status(400).json({ error: 'Category name is too long (60 characters max)' });
  if (!parentId) return res.status(400).json({ error: 'Pick where the new category goes (under Drinks, Meals or Snacks)' });

  try {
    const parent = await prisma.category.findUnique({
      where: { id: parentId },
      include: { _count: { select: { menuItems: true } } },
    });
    if (!parent) return res.status(404).json({ error: 'Parent category not found' });

    if ((await categoryDepth(parent.id)) >= MAX_CATEGORY_DEPTH) {
      return res.status(400).json({ error: `"${parent.name}" is already the deepest level — add the category one level up instead` });
    }
    if (parent._count.menuItems > 0) {
      return res.status(409).json({
        error: `"${parent.name}" has ${parent._count.menuItems} item(s) directly in it. Move them into a sub-category first — otherwise they'd disappear from the ordering screens.`,
      });
    }

    const taken = await categoryNameTaken(name);
    if (taken) return res.status(409).json({ error: `A category named "${taken.name}" already exists` });

    const category = await prisma.category.create({ data: { name, parentId: parent.id } });
    broadcastMenuChanged();
    res.status(201).json(category);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: `A category named "${name}" already exists` });
    console.error('createCategory error:', err);
    res.status(500).json({ error: 'Failed to create category' });
  }
}

// PATCH /api/menu-items/categories/:id — { name }
async function renameCategory(req, res) {
  const name = cleanCategoryName(req.body.name);
  if (!name) return res.status(400).json({ error: 'Enter a category name' });
  if (name.length > 60) return res.status(400).json({ error: 'Category name is too long (60 characters max)' });

  try {
    const category = await prisma.category.findUnique({ where: { id: req.params.id } });
    if (!category) return res.status(404).json({ error: 'Category not found' });
    if (!category.parentId && FIXED_TOP_CATEGORIES.includes(category.name)) {
      return res.status(400).json({ error: `"${category.name}" can't be renamed — it decides which screen (Chef or Barista) its orders go to` });
    }

    const taken = await categoryNameTaken(name, category.id);
    if (taken) return res.status(409).json({ error: `A category named "${taken.name}" already exists` });

    const updated = await prisma.category.update({ where: { id: category.id }, data: { name } });
    broadcastMenuChanged();
    res.json(updated);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: `A category named "${name}" already exists` });
    console.error('renameCategory error:', err);
    res.status(500).json({ error: 'Failed to rename category' });
  }
}

// DELETE /api/menu-items/categories/:id — only an EMPTY category (no
// items at all, including Removed ones, and no sub-categories), so a
// delete can never take menu items or order history with it.
async function deleteCategory(req, res) {
  try {
    const category = await prisma.category.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { menuItems: true, children: true } } },
    });
    if (!category) return res.status(404).json({ error: 'Category not found' });
    if (!category.parentId && FIXED_TOP_CATEGORIES.includes(category.name)) {
      return res.status(400).json({ error: `"${category.name}" can't be deleted — it decides which screen (Chef or Barista) its orders go to` });
    }
    if (category._count.children > 0) {
      return res.status(409).json({ error: `"${category.name}" still has ${category._count.children} sub-categor${category._count.children === 1 ? 'y' : 'ies'} — delete those first` });
    }
    if (category._count.menuItems > 0) {
      return res.status(409).json({
        error: `"${category.name}" still has ${category._count.menuItems} menu item(s) (including Removed ones) — move or delete them first`,
      });
    }

    await prisma.category.delete({ where: { id: category.id } });
    broadcastMenuChanged();
    res.status(204).end();
  } catch (err) {
    console.error('deleteCategory error:', err);
    res.status(500).json({ error: 'Failed to delete category' });
  }
}

function validatePayload(body, { partial }) {
  const {
    name,
    categoryId,
    price,
    imageUrl,
    isAvailable,
    isFeatured,
    hasTemperatureOption,
    temperatureOptions,
    customizableIngredients,
    extraOptions,
  } = body;

  const data = {};

  if (name !== undefined) {
    if (!String(name).trim()) return { error: 'name cannot be empty' };
    data.name = name;
  } else if (!partial) {
    return { error: 'name is required' };
  }

  if (categoryId !== undefined) {
    if (!categoryId) return { error: 'categoryId cannot be empty' };
    data.categoryId = categoryId;
  } else if (!partial) {
    return { error: 'categoryId is required' };
  }

  if (price !== undefined) {
    const p = Number(price);
    if (Number.isNaN(p) || p < 0) return { error: 'price must be a non-negative number' };
    data.price = p;
  } else if (!partial) {
    return { error: 'price is required' };
  }

  if (imageUrl !== undefined) data.imageUrl = imageUrl || null;
  if (isAvailable !== undefined) data.isAvailable = Boolean(isAvailable);
  if (isFeatured !== undefined) data.isFeatured = Boolean(isFeatured);
  if (hasTemperatureOption !== undefined) data.hasTemperatureOption = Boolean(hasTemperatureOption);

  if (temperatureOptions !== undefined) {
    if (!Array.isArray(temperatureOptions) || temperatureOptions.some((t) => !VALID_TEMPERATURES.includes(t))) {
      return { error: `temperatureOptions must be an array of ${VALID_TEMPERATURES.join(', ')}` };
    }
    data.temperatureOptions = temperatureOptions;
  }

  if (customizableIngredients !== undefined) {
    if (!Array.isArray(customizableIngredients) || customizableIngredients.some((i) => typeof i !== 'string')) {
      return { error: 'customizableIngredients must be an array of strings' };
    }
    data.customizableIngredients = customizableIngredients;
  }

  if (extraOptions !== undefined) {
    if (
      extraOptions !== null &&
      (!Array.isArray(extraOptions) || extraOptions.some((e) => typeof e?.name !== 'string' || typeof e?.price !== 'number' && typeof e?.price !== 'string'))
    ) {
      return { error: 'extraOptions must be an array of {name, price}' };
    }
    data.extraOptions = extraOptions;
  }

  return { data };
}

// An item has to sit in the deepest level of its branch — the Waiter and
// Cashier menus only show a category's own items when it has no
// sub-categories, so an item placed in e.g. "Drinks > Alcohol" while
// Alcohol has sub-categories would never appear for ordering.
async function categoryItemError(categoryId) {
  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    include: { _count: { select: { children: true } } },
  });
  if (!category) return 'Category not found';
  if (category._count.children > 0) {
    return `"${category.name}" has sub-categories — put the item in one of them so it shows up on the ordering screens`;
  }
  return null;
}

// POST /api/menu-items — manager only
async function createMenuItem(req, res) {
  const { error, data } = validatePayload(req.body, { partial: false });
  if (error) return res.status(400).json({ error });

  try {
    const categoryError = await categoryItemError(data.categoryId);
    if (categoryError) return res.status(400).json({ error: categoryError });

    const existing = await prisma.menuItem.findUnique({ where: { name: data.name } });
    if (existing) return res.status(409).json({ error: 'A menu item with this name already exists' });

    const item = await prisma.menuItem.create({ data, include: CATEGORY_TREE_INCLUDE });
    broadcastMenuChanged();
    res.status(201).json(serializeMenuItem(item));
  } catch (err) {
    console.error('createMenuItem error:', err);
    res.status(500).json({ error: 'Failed to create menu item' });
  }
}

// PATCH /api/menu-items/:id — manager only
// Covers both the full Edit-modal save and the quick inline toggles
// (price-only, isAvailable-only, isFeatured-only), so every field is
// optional here — only what's present in the body gets updated.
async function updateMenuItem(req, res) {
  const { id } = req.params;
  const { error, data } = validatePayload(req.body, { partial: true });
  if (error) return res.status(400).json({ error });

  if (Object.keys(data).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  try {
    if (data.categoryId) {
      const categoryError = await categoryItemError(data.categoryId);
      if (categoryError) return res.status(400).json({ error: categoryError });
    }

    const item = await prisma.menuItem.update({ where: { id }, data, include: CATEGORY_TREE_INCLUDE });
    broadcastMenuChanged();
    res.json(serializeMenuItem(item));
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Menu item not found' });
    if (err.code === 'P2002') return res.status(409).json({ error: 'A menu item with this name already exists' });
    console.error('updateMenuItem error:', err);
    res.status(500).json({ error: 'Failed to update menu item' });
  }
}

// DELETE /api/menu-items/:id — manager only
// If the item has ever appeared on an order, a hard delete would break
// that order's history, so we block it and point the manager at
// "Removed" (isAvailable: false) instead — matching the confirm dialog's
// wording in admin.js.
async function deleteMenuItem(req, res) {
  const { id } = req.params;

  try {
    const item = await prisma.menuItem.findUnique({ where: { id } });
    if (!item) return res.status(404).json({ error: 'Menu item not found' });

    const orderItemCount = await prisma.orderItem.count({ where: { menuItemId: id } });
    if (orderItemCount > 0) {
      return res.status(409).json({
        error: 'This item has past orders and can\'t be deleted — mark it Removed instead to keep it off the menu without breaking order history.',
      });
    }

    await prisma.menuItem.delete({ where: { id } });
    broadcastMenuChanged();
    res.status(204).end();
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Menu item not found' });
    console.error('deleteMenuItem error:', err);
    res.status(500).json({ error: 'Failed to delete menu item' });
  }
}

module.exports = {
  listMenuItems,
  listCategoriesFlat,
  createCategory,
  renameCategory,
  deleteCategory,
  createMenuItem,
  updateMenuItem,
  deleteMenuItem,
};
