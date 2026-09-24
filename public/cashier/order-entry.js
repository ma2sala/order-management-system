// New Order tab on the Cashier screen. The waitresses take orders with pen
// and paper and hand the ticket to the cashier, who enters it here on
// their behalf, in the same 3 steps as the waiter screen: (1) waitress +
// table, (2) food & drinks, (3) order summary -> Accept Order.
// The order is filed under the waitress (so per-waitress reports still
// work) and goes to the Chef/Barista displays exactly like a waiter-sent
// one — see createOrder in src/controllers/orderController.js.
//
// The menu browsing and customize modal mirror public/waiter/waiter.js
// (same /api/categories tree, same "Top Items" pseudo-category, same
// temperature/ingredient/extra options) so an order entered here is
// indistinguishable from one a waiter sent from her phone.
//
// Loaded before cashier.js, which calls window.CashierOrderEntry(shared)
// from its boot() once the cashier is logged in.
window.CashierOrderEntry = function mountOrderEntry({ api, showToast, escapeHtml, customizationSummary }) {
  const CATEGORY_ICONS = { 'Top Items': '⭐', Drinks: '🥤', Meals: '🍽️', Snacks: '🍿' };
  const TEMPERATURE_LABELS = { HOT: '🔥 Hot', COLD: '🥶 Cold', NORMAL: '🌡 Normal', NORMAL_WITH_ICE: '🧊 Normal + Ice' };
  const LEGACY_TEMPERATURE_OPTIONS = ['HOT', 'COLD', 'NORMAL'];

  let waiters = [];
  let tables = [];
  let categories = [];
  let activeCategory = null;
  let activeSubCategory = null;
  let activeSubSubCategory = null;
  let selectedWaiterId = null;
  let selectedTableId = null;
  let step = 1;

  // basket line shape (same as waiter.js):
  // { key, menuItemId, name, unitPrice, quantity, temperature,
  //   removedIngredients: [], selectedExtras: [{name, price}] }
  let basket = [];

  let customizing = null;
  let customizeTemperature = null;
  let customizeRemoved = new Set();
  let customizeExtras = new Set();
  let customizeQty = 1;

  // ---------------- DOM refs ----------------
  const waiterChips = document.getElementById('waiterChips');
  const tableChips = document.getElementById('tableChips');
  const categoryTabs = document.getElementById('categoryTabs');
  const subCategoryTabs = document.getElementById('subCategoryTabs');
  const subSubCategoryTabs = document.getElementById('subSubCategoryTabs');
  const menuGrid = document.getElementById('menuGrid');
  const basketItemsEl = document.getElementById('basketItems');
  const basketTotalEl = document.getElementById('basketTotal');
  const orderHint = document.getElementById('orderHint');

  const STEP_SECTIONS = {
    1: document.getElementById('orderStepWho'),
    2: document.getElementById('orderStepMenu'),
    3: document.getElementById('orderStepCheckout'),
  };
  const backToWhoBtn = document.getElementById('backToWhoBtn');
  const backToMenuBtn = document.getElementById('backToMenuBtn');
  const orderingForMenu = document.getElementById('orderingForMenu');
  const orderingForCheckout = document.getElementById('orderingForCheckout');
  const checkoutSummary = document.getElementById('checkoutSummary');
  const viewOrderBtn = document.getElementById('viewOrderBtn');
  const acceptOrderBtn = document.getElementById('acceptOrderBtn');

  const customizeModal = document.getElementById('customizeModal');
  const customizeItemName = document.getElementById('customizeItemName');
  const customizeItemPrice = document.getElementById('customizeItemPrice');
  const customizeCloseBtn = document.getElementById('customizeCloseBtn');
  const temperatureSection = document.getElementById('temperatureSection');
  const temperatureOptions = document.getElementById('temperatureOptions');
  const ingredientGridSection = document.getElementById('ingredientGridSection');
  const ingredientGrid = document.getElementById('ingredientGrid');
  const customizeQtyValue = document.getElementById('customizeQtyValue');
  const customizeQtyMinus = document.getElementById('customizeQtyMinus');
  const customizeQtyPlus = document.getElementById('customizeQtyPlus');
  const customizeAddTotal = document.getElementById('customizeAddTotal');
  const customizeAddBtn = document.getElementById('customizeAddBtn');
  const customizeError = document.getElementById('customizeError');

  // ---------------- Pricing helpers ----------------
  function extrasSum(extras) {
    return (extras || []).reduce((s, e) => s + Number(e.price), 0);
  }
  function lineUnitPrice(line) {
    return Number(line.unitPrice) + extrasSum(line.selectedExtras);
  }
  function basketTotal() {
    return basket.reduce((s, b) => s + b.quantity * lineUnitPrice(b), 0);
  }

  // ---------------- Step navigation ----------------
  function goToStep(next) {
    step = next;
    Object.entries(STEP_SECTIONS).forEach(([key, section]) => {
      section.classList.toggle('hidden', Number(key) !== next);
    });
    window.scrollTo(0, 0);
  }

  function whoLabel() {
    const waiter = waiters.find((w) => w.id === selectedWaiterId);
    const table = tables.find((t) => t.id === selectedTableId);
    return `Table <strong>${escapeHtml(table ? table.label : '')}</strong> · ${escapeHtml(waiter ? waiter.name : '')}`;
  }

  // Step 1 -> 2 as soon as both the waitress and the table are picked,
  // in either order — same "no extra confirm" feel as the waiter screen,
  // where tapping a table goes straight to the menu.
  function afterPick() {
    renderWaiterChips();
    renderTableChips();
    if (!selectedWaiterId) {
      orderHint.textContent = 'Now choose the waitress';
      return;
    }
    if (!selectedTableId) {
      orderHint.textContent = 'Now choose the table';
      return;
    }
    orderHint.textContent = '';
    orderingForMenu.innerHTML = whoLabel();
    goToStep(2);
  }

  backToWhoBtn.addEventListener('click', () => goToStep(1));
  backToMenuBtn.addEventListener('click', () => goToStep(2));

  // ---------------- Waitress + table pickers ----------------
  async function loadWaiters() {
    waiters = await api('/api/users/waiters');
    // A waitress deactivated since she was picked can't be sent anymore
    if (!waiters.some((w) => w.id === selectedWaiterId)) selectedWaiterId = null;
    renderWaiterChips();
  }

  function renderWaiterChips() {
    if (waiters.length === 0) {
      waiterChips.innerHTML = '<p class="order-hint">No active waitress accounts — add one in the Manager Dashboard\'s Staff tab.</p>';
      return;
    }
    waiterChips.innerHTML = waiters
      .map((w) => `<button type="button" class="pick-chip${w.id === selectedWaiterId ? ' selected' : ''}" data-id="${w.id}">${escapeHtml(w.name)}</button>`)
      .join('');
    waiterChips.querySelectorAll('.pick-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        selectedWaiterId = chip.dataset.id;
        afterPick();
      });
    });
  }

  async function loadTables() {
    tables = await api('/api/tables');
    // Natural sort so T2 < T10
    tables.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }));
    renderTableChips();
  }

  function renderTableChips() {
    tableChips.innerHTML = tables
      .map((t) => `<button type="button" class="pick-chip mono${t.id === selectedTableId ? ' selected' : ''}" data-id="${t.id}">${escapeHtml(t.label)}</button>`)
      .join('');
    tableChips.querySelectorAll('.pick-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        selectedTableId = chip.dataset.id;
        afterPick();
      });
    });
  }

  // ---------------- Menu ----------------
  // "Top Items" is a client-side pseudo-category of every isFeatured item,
  // exactly as on the waiter screen.
  function collectFeaturedItems(nodes) {
    let found = [];
    for (const node of nodes) {
      if (node.menuItems) found = found.concat(node.menuItems.filter((i) => i.isFeatured));
      if (node.children && node.children.length > 0) found = found.concat(collectFeaturedItems(node.children));
    }
    return found;
  }

  async function loadCategories() {
    let realCategories;
    try {
      realCategories = await api('/api/categories');
    } catch (err) {
      console.error('Failed to load categories:', err);
      categoryTabs.innerHTML = `
        <div class="category-load-error">
          Couldn't load the menu (${escapeHtml(err.message || 'unknown error')}).
          <button type="button" id="retryCategoriesBtn">Retry</button>
        </div>`;
      document.getElementById('retryCategoriesBtn').addEventListener('click', () => loadCategories());
      return;
    }

    realCategories = (realCategories || []).map((c) => ({ ...c, children: c.children || [] }));
    const topItemsCategory = { id: '__top_items__', name: 'Top Items', menuItems: collectFeaturedItems(realCategories), children: [] };
    categories = [topItemsCategory, ...realCategories];

    // Keep the cashier's place in the menu across a refresh when possible
    const keep = categories.some((c) => c.id === activeCategory);
    if (!keep && categories.length > 0) selectCategory(categories[0].id, { skipRender: true });

    categoryTabs.innerHTML = categories
      .map((c) => {
        const icon = CATEGORY_ICONS[c.name] || '';
        return `<button type="button" class="category-pill" data-id="${c.id}">${icon ? icon + ' ' : ''}${escapeHtml(c.name)}</button>`;
      })
      .join('');
    categoryTabs.querySelectorAll('.category-pill').forEach((pill) => {
      pill.addEventListener('click', () => selectCategory(pill.dataset.id));
    });
    highlightActiveCategory();
    renderSubCategoryTabs();
    renderSubSubCategoryTabs();
    renderMenuGrid();
  }

  function selectCategory(categoryId, { skipRender = false } = {}) {
    activeCategory = categoryId;
    const cat = categories.find((c) => c.id === categoryId);
    const children = cat && cat.children ? cat.children : [];
    activeSubCategory = children.length > 0 ? children[0].id : null;
    refreshSubSubForActiveSub();
    if (!skipRender) {
      highlightActiveCategory();
      renderSubCategoryTabs();
      renderSubSubCategoryTabs();
      renderMenuGrid();
    }
  }

  function findActiveSubNode() {
    const cat = categories.find((c) => c.id === activeCategory);
    if (!cat || !cat.children) return null;
    return cat.children.find((c) => c.id === activeSubCategory) || null;
  }

  function refreshSubSubForActiveSub() {
    const subNode = findActiveSubNode();
    const grandchildren = subNode && subNode.children ? subNode.children : [];
    activeSubSubCategory = grandchildren.length > 0 ? grandchildren[0].id : null;
  }

  function highlightActiveCategory() {
    categoryTabs.querySelectorAll('.category-pill').forEach((pill) => {
      pill.classList.toggle('active', pill.dataset.id === activeCategory);
    });
  }

  function renderSubCategoryTabs() {
    const cat = categories.find((c) => c.id === activeCategory);
    const children = cat && cat.children ? cat.children : [];
    subCategoryTabs.classList.toggle('hidden', children.length === 0);
    subCategoryTabs.innerHTML = children
      .map((c) => `<button type="button" class="subcategory-pill${c.id === activeSubCategory ? ' active' : ''}" data-id="${c.id}">${escapeHtml(c.name)}</button>`)
      .join('');
    subCategoryTabs.querySelectorAll('.subcategory-pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        activeSubCategory = pill.dataset.id;
        refreshSubSubForActiveSub();
        renderSubCategoryTabs();
        renderSubSubCategoryTabs();
        renderMenuGrid();
      });
    });
  }

  function renderSubSubCategoryTabs() {
    const subNode = findActiveSubNode();
    const grandchildren = subNode && subNode.children ? subNode.children : [];
    subSubCategoryTabs.classList.toggle('hidden', grandchildren.length === 0);
    subSubCategoryTabs.innerHTML = grandchildren
      .map((c) => `<button type="button" class="subcategory-pill subsubcategory-pill${c.id === activeSubSubCategory ? ' active' : ''}" data-id="${c.id}">${escapeHtml(c.name)}</button>`)
      .join('');
    subSubCategoryTabs.querySelectorAll('.subsubcategory-pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        activeSubSubCategory = pill.dataset.id;
        renderSubSubCategoryTabs();
        renderMenuGrid();
      });
    });
  }

  function itemHasCustomization(item) {
    return item.hasTemperatureOption
      || (item.customizableIngredients && item.customizableIngredients.length > 0)
      || (item.extraOptions && item.extraOptions.length > 0);
  }

  function activeMenuItems() {
    const cat = categories.find((c) => c.id === activeCategory);
    if (!cat) return [];
    if (!cat.children || cat.children.length === 0) return cat.menuItems;
    const subCat = cat.children.find((c) => c.id === activeSubCategory) || cat.children[0];
    if (subCat.children && subCat.children.length > 0) {
      const subSubCat = subCat.children.find((c) => c.id === activeSubSubCategory) || subCat.children[0];
      return subSubCat.menuItems;
    }
    return subCat.menuItems;
  }

  // The whole card is the tap target (not just a small "+"), since the
  // cashier is working quickly from a handwritten list.
  function renderMenuGrid() {
    const items = activeMenuItems();
    if (items.length === 0) {
      menuGrid.innerHTML = '<div class="empty-state">No items in this category.</div>';
      return;
    }
    menuGrid.innerHTML = items
      .map(
        (item) => `
        <button type="button" class="menu-card" data-id="${item.id}">
          <span class="name">${escapeHtml(item.name)}</span>
          <span class="price mono">$${Number(item.price).toFixed(2)}</span>
        </button>`
      )
      .join('');
    menuGrid.querySelectorAll('.menu-card').forEach((card) => {
      card.addEventListener('click', () => {
        const item = items.find((i) => i.id === card.dataset.id);
        if (itemHasCustomization(item)) {
          openCustomizeModal(item);
        } else {
          addToBasket({
            key: item.id,
            menuItemId: item.id,
            name: item.name,
            unitPrice: Number(item.price),
            quantity: 1,
            temperature: null,
            removedIngredients: [],
            selectedExtras: [],
          });
        }
      });
    });
  }

  // ---------------- Customize modal ----------------
  function openCustomizeModal(item) {
    customizing = item;
    customizeTemperature = null;
    customizeRemoved = new Set();
    customizeExtras = new Set();
    customizeQty = 1;
    customizeError.textContent = '';

    customizeItemName.textContent = item.name;
    customizeItemPrice.textContent = `$${Number(item.price).toFixed(2)} base`;

    if (item.hasTemperatureOption) {
      temperatureSection.classList.remove('hidden');
      const allowedTemps = (item.temperatureOptions && item.temperatureOptions.length > 0)
        ? item.temperatureOptions
        : LEGACY_TEMPERATURE_OPTIONS;
      temperatureOptions.innerHTML = allowedTemps
        .map((key) => `<button type="button" class="option-chip" data-temp="${key}">${TEMPERATURE_LABELS[key] || key}</button>`)
        .join('');
      temperatureOptions.querySelectorAll('.option-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
          customizeTemperature = chip.dataset.temp;
          temperatureOptions.querySelectorAll('.option-chip').forEach((c) => c.classList.toggle('selected', c === chip));
          customizeError.textContent = '';
        });
      });
    } else {
      temperatureSection.classList.add('hidden');
    }

    // Removable base ingredients (on by default) and paid extras (off by
    // default) share one grid of toggle cards, as on the waiter screen.
    const removable = Array.isArray(item.customizableIngredients) ? item.customizableIngredients : [];
    const extras = Array.isArray(item.extraOptions) ? item.extraOptions : [];
    if (removable.length > 0 || extras.length > 0) {
      ingredientGridSection.classList.remove('hidden');
      ingredientGrid.innerHTML =
        removable
          .map(
            (ing) => `
          <button type="button" class="ingredient-card remove-type included" data-kind="remove" data-name="${escapeHtml(ing)}">
            <span class="ingredient-toggle-icon">−</span>
            <span class="ingredient-card-name">${escapeHtml(ing)}</span>
          </button>`
          )
          .join('') +
        extras
          .map(
            (ex) => `
          <button type="button" class="ingredient-card extra-type" data-kind="extra" data-name="${escapeHtml(ex.name)}">
            <span class="ingredient-toggle-icon">+</span>
            <span class="ingredient-card-name">${escapeHtml(ex.name)} <span class="extra-price mono">+$${Number(ex.price).toFixed(2)}</span></span>
          </button>`
          )
          .join('');

      ingredientGrid.querySelectorAll('.ingredient-card[data-kind="remove"]').forEach((card) => {
        card.addEventListener('click', () => {
          const ing = card.dataset.name;
          if (customizeRemoved.has(ing)) customizeRemoved.delete(ing);
          else customizeRemoved.add(ing);
          card.classList.toggle('included', !customizeRemoved.has(ing));
        });
      });
      ingredientGrid.querySelectorAll('.ingredient-card[data-kind="extra"]').forEach((card) => {
        card.addEventListener('click', () => {
          const name = card.dataset.name;
          if (customizeExtras.has(name)) customizeExtras.delete(name);
          else customizeExtras.add(name);
          card.classList.toggle('selected', customizeExtras.has(name));
          updateCustomizeTotal();
        });
      });
    } else {
      ingredientGridSection.classList.add('hidden');
    }

    customizeQtyValue.textContent = customizeQty;
    updateCustomizeTotal();
    customizeModal.classList.remove('hidden');
  }

  function currentCustomizeExtrasPriced() {
    const extras = Array.isArray(customizing.extraOptions) ? customizing.extraOptions : [];
    return extras.filter((e) => customizeExtras.has(e.name));
  }

  function updateCustomizeTotal() {
    const unit = Number(customizing.price) + extrasSum(currentCustomizeExtrasPriced());
    customizeAddTotal.textContent = `$${(unit * customizeQty).toFixed(2)}`;
  }

  customizeQtyMinus.addEventListener('click', () => {
    if (customizeQty > 1) {
      customizeQty -= 1;
      customizeQtyValue.textContent = customizeQty;
      updateCustomizeTotal();
    }
  });
  customizeQtyPlus.addEventListener('click', () => {
    customizeQty += 1;
    customizeQtyValue.textContent = customizeQty;
    updateCustomizeTotal();
  });

  function closeCustomizeModal() {
    customizeModal.classList.add('hidden');
  }
  customizeCloseBtn.addEventListener('click', closeCustomizeModal);
  customizeModal.addEventListener('click', (e) => {
    if (e.target === customizeModal) closeCustomizeModal();
  });

  customizeAddBtn.addEventListener('click', () => {
    if (customizing.hasTemperatureOption && !customizeTemperature) {
      customizeError.textContent = 'Please select a temperature first';
      return;
    }
    const removedIngredients = Array.from(customizeRemoved);
    const selectedExtras = currentCustomizeExtrasPriced();
    const key = [
      customizing.id,
      customizeTemperature || '',
      removedIngredients.slice().sort().join(','),
      selectedExtras.map((e) => e.name).sort().join(','),
    ].join('|');

    addToBasket({
      key,
      menuItemId: customizing.id,
      name: customizing.name,
      unitPrice: Number(customizing.price),
      quantity: customizeQty,
      temperature: customizeTemperature,
      removedIngredients,
      selectedExtras,
    });
    closeCustomizeModal();
  });

  // ---------------- Basket / ticket panel ----------------
  function addToBasket(line) {
    const existing = basket.find((b) => b.key === line.key);
    if (existing) existing.quantity += line.quantity;
    else basket.push(line);
    updateTicket();
  }

  function changeQty(key, delta) {
    const line = basket.find((b) => b.key === key);
    if (!line) return;
    line.quantity += delta;
    if (line.quantity <= 0) basket = basket.filter((b) => b.key !== key);
    updateTicket();
  }

  // Refreshes whatever basket UI is showing: the Step 2 checkout bar
  // always, and the Step 3 summary when that's the page on screen (e.g.
  // after a quantity change made right there on the summary).
  function updateTicket() {
    const count = basket.reduce((s, b) => s + b.quantity, 0);
    const total = basketTotal();
    checkoutSummary.textContent = `${count} item${count === 1 ? '' : 's'} · $${total.toFixed(2)}`;
    viewOrderBtn.disabled = count === 0;
    if (step === 3) renderCheckoutItems();
  }

  // Step 3 — same markup/look as the waiter screen's Order Summary
  function renderCheckoutItems() {
    // Last item removed right on the summary — nothing left to accept
    if (basket.length === 0) {
      showToast('Order is empty');
      goToStep(2);
      return;
    }
    basketTotalEl.textContent = `$${basketTotal().toFixed(2)}`;
    basketItemsEl.innerHTML = basket
      .map((b) => {
        const summary = customizationSummary(b);
        return `
        <div class="basket-item-row">
          <div class="basket-item-info">
            <div class="basket-item-name">${escapeHtml(b.name)}</div>
            ${summary ? `<div class="item-customization">${escapeHtml(summary)}</div>` : ''}
            <div class="basket-item-price mono">$${lineUnitPrice(b).toFixed(2)} each</div>
          </div>
          <div class="qty-controls">
            <button type="button" class="qty-btn minus" data-key="${escapeHtml(b.key)}" data-delta="-1" aria-label="Remove one">${b.quantity === 1 ? '🗑' : '−'}</button>
            <span class="qty-value">${b.quantity}</span>
            <button type="button" class="qty-btn plus" data-key="${escapeHtml(b.key)}" data-delta="1" aria-label="Add one">+</button>
          </div>
        </div>`;
      })
      .join('');
    basketItemsEl.querySelectorAll('.qty-btn').forEach((btn) => {
      btn.addEventListener('click', () => changeQty(btn.dataset.key, Number(btn.dataset.delta)));
    });
  }

  // Step 2 -> Step 3
  viewOrderBtn.addEventListener('click', () => {
    if (basket.length === 0) return;
    orderingForCheckout.innerHTML = whoLabel();
    goToStep(3);
    renderCheckoutItems();
  });

  function resetTicket() {
    basket = [];
    selectedWaiterId = null;
    selectedTableId = null;
    orderHint.textContent = '';
    renderWaiterChips();
    renderTableChips();
    updateTicket();
  }

  // Step 3 -> send -> back to Step 1 for the next paper ticket
  acceptOrderBtn.addEventListener('click', async () => {
    if (basket.length === 0) return;
    const waiter = waiters.find((w) => w.id === selectedWaiterId);
    const table = tables.find((t) => t.id === selectedTableId);
    if (!waiter || !table) {
      showToast('Choose the waitress and table again', true);
      goToStep(1);
      return;
    }

    acceptOrderBtn.disabled = true;
    acceptOrderBtn.textContent = 'Sending…';
    try {
      await api('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          tableId: table.id,
          waiterId: waiter.id,
          items: basket.map((b) => ({
            menuItemId: b.menuItemId,
            quantity: b.quantity,
            temperature: b.temperature || undefined,
            removedIngredients: b.removedIngredients,
            extraNames: b.selectedExtras.map((e) => e.name),
          })),
        }),
      });
      // Leave Step 3 first — emptying the basket while still on the
      // summary would trip its "order is empty" bounce-back.
      goToStep(1);
      resetTicket();
      showToast(`Sent to kitchen/bar — Table ${table.label} for ${waiter.name}`);
    } catch (err) {
      showToast(err.message || 'Failed to send order', true);
    } finally {
      acceptOrderBtn.disabled = false;
      acceptOrderBtn.textContent = '✅ Accept Order';
    }
  });

  // ---------------- Load ----------------
  async function refresh() {
    await Promise.all([loadWaiters(), loadTables(), loadCategories()]);
    updateTicket();
  }

  refresh().catch((err) => showToast(err.message || 'Failed to load the menu', true));

  return { refresh };
};
