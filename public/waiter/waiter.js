(function () {
  'use strict';

  const API = ''; // same origin as this static file is served from

  // ---------------- State ----------------
  let token = localStorage.getItem('kds_waiter_token') || null;
  let user = JSON.parse(localStorage.getItem('kds_waiter_user') || 'null');
  let socket = null;
  let audioCtx = null;

  // ---------------- Completion chime ----------------
  // Web Audio synth chime (same approach as the Barista Display) rather
  // than an audio file — no /assets/notification.mp3 dependency to go
  // missing, and no network request needed to play it.
  function playCompletionChime() {
    try {
      if (!audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AC();
      }
      const now = audioCtx.currentTime;
      // A slightly different two-note pattern than the Barista Display's
      // alert chime, so it reads as "your order is ready" rather than
      // "new ticket in" if someone's ever in earshot of both screens.
      [660, 990].forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, now + i * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.2, now + i * 0.12 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.12 + 0.28);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(now + i * 0.12);
        osc.stop(now + i * 0.12 + 0.3);
      });
    } catch (e) {
      // Web Audio unavailable in this environment — fail silently, the
      // in-app notification (pushNotification) still shows regardless.
    }
  }

  // Mobile browsers block audio until a real user gesture has happened on
  // the page. Rather than waiting for the first genuine sound attempt
  // (which is out of our control — it's whenever a ticket completes) and
  // hoping a gesture already happened, explicitly create/resume the
  // AudioContext on the very first tap/click anywhere, so it's unlocked
  // well before any notification needs to play.
  function unlockAudioOnce() {
    try {
      if (!audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AC();
      }
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) {
      // ignore — playCompletionChime() will just no-op later if this never unlocks
    }
  }
  document.addEventListener('click', unlockAudioOnce, { once: true });

  // The 3-step ordering flow: 1 = table selection, 2 = menu & item
  // selection, 3 = receipt/checkout. 'history' is a side page (My Orders)
  // reachable from the header at any point, outside the numbered flow.
  let step = 1;

  let tables = [];
  let categories = [];
  let activeCategory = null; // top-level category id
  let activeSubCategory = null; // child category id, when the active category has children
  let activeSubSubCategory = null; // grandchild category id, e.g. a wine/spirit type under Alcohol
  let selectedTable = null;

  // basket line shape:
  // { key, menuItemId, name, unitPrice, quantity, temperature,
  //   removedIngredients: [], selectedExtras: [{name, price}] }
  let basket = [];

  let myOrders = [];

  let notifications = [];
  let unread = 0;

  let currentDateLabel = null; // tracks the last date string we rendered

  // Customize-modal working state for whichever item is currently open
  let customizing = null; // the raw menu item being customized
  let customizeTemperature = null;
  let customizeRemoved = new Set();
  let customizeExtras = new Set(); // extra names
  let customizeQty = 1;

  const STATUS_META = {
    PENDING: { label: 'Pending', color: 'var(--wait)', icon: '⏱' },
    IN_PROGRESS: { label: 'In Progress', color: 'var(--prog)', icon: '👨‍🍳' },
    COMPLETED: { label: 'Completed', color: 'var(--go)', icon: '✅' },
    VOIDED: { label: 'Voided', color: 'var(--danger)', icon: '⛔' },
  };

  const TEMPERATURE_LABELS = { HOT: '🔥 Hot', COLD: '🥶 Cold', NORMAL: '🌡 Normal', NORMAL_WITH_ICE: '🧊 Normal + Ice' };
  const LEGACY_TEMPERATURE_OPTIONS = ['HOT', 'COLD', 'NORMAL']; // fallback for older items saved before per-item lists existed

  // ---------------- DOM refs ----------------
  const loginScreen = document.getElementById('loginScreen');
  const appScreen = document.getElementById('appScreen');
  const loginForm = document.getElementById('loginForm');
  const loginError = document.getElementById('loginError');

  const tableStatusLine = document.getElementById('tableStatusLine');
  const dateDisplay = document.getElementById('dateDisplay');
  const historyBtn = document.getElementById('historyBtn');
  const bellBtn = document.getElementById('bellBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  const unreadBadge = document.getElementById('unreadBadge');
  const notifPanel = document.getElementById('notifPanel');

  const stepTables = document.getElementById('stepTables');
  const stepMenu = document.getElementById('stepMenu');
  const stepCheckout = document.getElementById('stepCheckout');
  const stepHistory = document.getElementById('stepHistory');
  const STEP_SECTIONS = { 1: stepTables, 2: stepMenu, 3: stepCheckout, history: stepHistory };

  const backToTablesBtn = document.getElementById('backToTablesBtn');
  const backToMenuBtn = document.getElementById('backToMenuBtn');
  const backFromHistoryBtn = document.getElementById('backFromHistoryBtn');
  const orderingForTable = document.getElementById('orderingForTable');
  const checkoutTableLabel = document.getElementById('checkoutTableLabel');

  const ordersList = document.getElementById('ordersList');
  const ordersDateInput = document.getElementById('ordersDateInput');

  const tableChips = document.getElementById('tableChips');
  const categoryTabs = document.getElementById('categoryTabs');
  const subCategoryTabs = document.getElementById('subCategoryTabs');
  const subSubCategoryTabs = document.getElementById('subSubCategoryTabs');
  const menuGrid = document.getElementById('menuGrid');

  const checkoutSummary = document.getElementById('checkoutSummary');
  const viewOrderBtn = document.getElementById('viewOrderBtn');

  const basketItemsEl = document.getElementById('basketItems');
  const basketTotalBigEl = document.getElementById('basketTotalBig');
  const acceptOrderBtn = document.getElementById('acceptOrderBtn');

  const toastEl = document.getElementById('toast');

  const customizeModal = document.getElementById('customizeModal');
  const customizeItemName = document.getElementById('customizeItemName');
  const customizeItemPrice = document.getElementById('customizeItemPrice');
  const temperatureSection = document.getElementById('temperatureSection');
  const temperatureOptions = document.getElementById('temperatureOptions');
  const ingredientGridSection = document.getElementById('ingredientGridSection');
  const ingredientGrid = document.getElementById('ingredientGrid');
  const customizeQtyValue = document.getElementById('customizeQtyValue');
  const customizeQtyMinus = document.getElementById('customizeQtyMinus');
  const customizeQtyPlus = document.getElementById('customizeQtyPlus');
  const customizeAddTotal = document.getElementById('customizeAddTotal');
  const customizeCancelBtn = document.getElementById('customizeCancelBtn');
  const customizeAddBtn = document.getElementById('customizeAddBtn');
  const modalError = document.getElementById('modalError');

  // ---------------- Step navigation ----------------
  function goToStep(next) {
    step = next;
    Object.entries(STEP_SECTIONS).forEach(([key, section]) => {
      // Object keys are always strings, so compare loosely against `next`
      section.classList.toggle('hidden', String(key) !== String(next));
    });
  }

  backToTablesBtn.addEventListener('click', () => goToStep(1));
  backToMenuBtn.addEventListener('click', () => goToStep(2));
  backFromHistoryBtn.addEventListener('click', () => goToStep(1));

  historyBtn.addEventListener('click', () => {
    goToStep('history');
    loadMyOrders();
  });

  // ---------------- Date display ----------------
  function updateDateDisplay() {
    if (!dateDisplay) return;
    const label = new Date().toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    if (label !== currentDateLabel) {
      currentDateLabel = label;
      dateDisplay.textContent = label;
    }
  }

  // ---------------- Pricing helpers ----------------
  // Mirrors src/utils/pricing.js on the server — the server is the source
  // of truth for the real charge; this is just for showing the right
  // number to the waiter before the order is even sent.
  function extrasSum(extras) {
    return (extras || []).reduce((s, e) => s + Number(e.price), 0);
  }
  function lineUnitPrice(basketLine) {
    return Number(basketLine.unitPrice) + extrasSum(basketLine.selectedExtras);
  }
  function orderItemLineTotal(orderItem) {
    const extras = Array.isArray(orderItem.selectedExtras) ? orderItem.selectedExtras : [];
    return (Number(orderItem.unitPrice) + extrasSum(extras)) * orderItem.quantity;
  }

  // Builds a short human-readable summary like "Cold • no Onions, Pickles • +Extra Cheese"
  function customizationSummary({ temperature, removedIngredients, selectedExtras }) {
    const parts = [];
    if (temperature) parts.push(TEMPERATURE_LABELS[temperature] || temperature);
    if (removedIngredients && removedIngredients.length > 0) {
      parts.push(`no ${removedIngredients.join(', ')}`);
    }
    if (selectedExtras && selectedExtras.length > 0) {
      parts.push(`+${selectedExtras.map((e) => e.name).join(', +')}`);
    }
    return parts.join(' • ');
  }

  // ---------------- API helper ----------------
  async function api(path, options = {}) {
    const res = await fetch(API + path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Request failed: ${res.status}`);
    }
    return res.json();
  }

  // ---------------- Login ----------------
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.textContent = '';
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      token = data.token;
      user = data.user;
      localStorage.setItem('kds_waiter_token', token);
      localStorage.setItem('kds_waiter_user', JSON.stringify(user));
      boot().catch((bootErr) => {
        // boot() itself is a fire-and-forget call here, so without this
        // catch a failure inside it (e.g. categories failing to load)
        // becomes a silent unhandled rejection — the app screen is
        // already showing by the time it happens, so nothing would ever
        // tell you it broke. Surface it instead of leaving the screen blank.
        console.error('Boot failed after login:', bootErr);
        loginError.textContent = `Something went wrong loading the menu: ${bootErr.message || bootErr}`;
      });
    } catch (err) {
      loginError.textContent = err.message || 'Login failed';
    }
  });

  function showApp() {
    loginScreen.classList.add('hidden');
    appScreen.classList.remove('hidden');
  }

  logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('kds_waiter_token');
    localStorage.removeItem('kds_waiter_user');
    location.reload();
  });

  // ---------------- Socket ----------------
  function connectSocket() {
    socket = io({ auth: { token } });

    socket.on('status_updated', ({ orderId, status }) => {
      const order = myOrders.find((o) => o.id === orderId);
      if (order) order.status = status;
      renderOrders();

      if (status === 'COMPLETED') playCompletionChime();

      const meta = STATUS_META[status] || {};
      const label = order ? `Ticket for ${order.table.label}` : 'Your order';
      pushNotification(`${label} — ${meta.label || status}`);
    });

    socket.on('order_voided', ({ orderId }) => {
      const order = myOrders.find((o) => o.id === orderId);
      if (order) order.status = 'VOIDED';
      renderOrders();
      pushNotification(`An order was voided by a manager`);
    });

    socket.on('connect_error', (err) => {
      console.error('Socket connection error:', err.message);
    });
  }

  // ---------------- Notifications ----------------
  function pushNotification(text) {
    notifications.unshift({ id: Date.now(), text, time: new Date() });
    notifications = notifications.slice(0, 20);
    unread += 1;
    renderNotifBadge();
    renderNotifPanel();
    showToast(text);
  }

  function renderNotifBadge() {
    if (unread > 0) {
      unreadBadge.textContent = String(unread);
      unreadBadge.classList.remove('hidden');
    } else {
      unreadBadge.classList.add('hidden');
    }
  }

  function renderNotifPanel() {
    if (notifications.length === 0) {
      notifPanel.innerHTML = '<p class="notif-empty">No updates yet.</p>';
      return;
    }
    notifPanel.innerHTML = notifications
      .map(
        (n) => `
        <div class="notif-item">
          <p class="text">${escapeHtml(n.text)}</p>
          <p class="time">${n.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
        </div>`
      )
      .join('');
  }

  bellBtn.addEventListener('click', () => {
    notifPanel.classList.toggle('hidden');
    unread = 0;
    renderNotifBadge();
  });

  function showToast(text) {
    toastEl.textContent = text;
    toastEl.classList.remove('hidden');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toastEl.classList.add('hidden'), 3500);
  }

  // ---------------- Step 1: Tables ----------------
  async function loadTables() {
    tables = await api('/api/tables');
    // Natural/numeric sort so T2 < T10 (plain alphabetical sorting treats
    // these as strings and puts T10 right after T1, before T2).
    tables.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }));
    tableChips.innerHTML = tables
      .map((t) => `<button class="chip" data-id="${t.id}">${escapeHtml(t.label)}</button>`)
      .join('');
    tableChips.querySelectorAll('.chip').forEach((chip) => {
      chip.addEventListener('click', () => selectTable(chip.dataset.id));
    });
  }

  // Selecting a table advances straight to Step 2 — that's the whole point
  // of the linear flow, no extra confirmation needed here.
  function selectTable(tableId) {
    selectedTable = tables.find((t) => t.id === tableId);
    if (!selectedTable) return;
    tableStatusLine.textContent = `Serving ${selectedTable.label}`;
    orderingForTable.textContent = selectedTable.label;
    goToStep(2);
  }

  // ---------------- Step 2: Menu ----------------
  // Simple name -> icon lookup for the main category tabs. Falls back to
  // no icon for any category name not listed here (e.g. a future addition).
  const CATEGORY_ICONS = {
    'Top Items': '⭐',
    Drinks: '🥤',
    Meals: '🍽️',
    Snacks: '🍿',
  };

  // "Top Items" isn't a real category in the database — an item can only
  // belong to one category, so making it a real 4th category would mean
  // duplicating menu items. Instead this walks the whole category tree
  // returned by the API and pulls out anything marked isFeatured, building
  // a client-side-only pseudo-category that behaves exactly like a real
  // one everywhere else in this file (it has an id, a name, and a flat
  // menuItems list, with no children — so it renders with no subcategory row).
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
      // Don't let a failed fetch leave the whole category area silently
      // blank with no clue why — log full details for debugging and show
      // something visible with a retry, right where the tabs would be.
      console.error('Failed to load categories:', err);
      categoryTabs.innerHTML = `
        <div class="category-load-error">
          Couldn't load the menu (${escapeHtml(err.message || 'unknown error')}).
          <button type="button" id="retryCategoriesBtn">Retry</button>
        </div>`;
      const retryBtn = document.getElementById('retryCategoriesBtn');
      if (retryBtn) retryBtn.addEventListener('click', () => loadCategories());
      return; // stop here — nothing below is safe to run without real data
    }

    // Defensive: every node should carry a children array (see catalog.js),
    // but never let a missing/undefined one crash rendering — treat it as
    // "no children" instead of throwing.
    realCategories = (realCategories || []).map((c) => ({ ...c, children: c.children || [] }));

    const topItemsCategory = {
      id: '__top_items__',
      name: 'Top Items',
      menuItems: collectFeaturedItems(realCategories),
      children: [],
    };

    categories = [topItemsCategory, ...realCategories];

    if (categories.length > 0) selectCategory(categories[0].id, { skipRender: true });
    categoryTabs.innerHTML = categories
      .map((c) => {
        const icon = CATEGORY_ICONS[c.name] || '';
        return `<button class="category-pill" data-id="${c.id}">${icon ? icon + ' ' : ''}${escapeHtml(c.name)}</button>`;
      })
      .join('');
    categoryTabs.querySelectorAll('.category-pill').forEach((pill) => {
      pill.addEventListener('click', () => selectCategory(pill.dataset.id));
    });
    highlightActiveCategory();
    renderSubCategoryTabs();
    renderMenuGrid();
  }

  // Selecting a top-level category: if it has children (e.g. "Drinks" has
  // Hot Drinks/Juices & Smoothies/Soft Drinks/Alcohol), auto-select the
  // first child and show the sub-tab row. If it has no children (e.g.
  // Snacks, Meals) its own items render directly, same as before.
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

  // A sub-category can itself have children (only "Alcohol" does right now
  // — Red Wine, Whisky, etc.). This keeps activeSubSubCategory in sync
  // whenever the active top category or sub-category changes.
  function refreshSubSubForActiveSub() {
    const subNode = findActiveSubNode();
    const grandchildren = subNode && subNode.children ? subNode.children : [];
    activeSubSubCategory = grandchildren.length > 0 ? grandchildren[0].id : null;
  }

  function findActiveSubNode() {
    const cat = categories.find((c) => c.id === activeCategory);
    if (!cat || !cat.children) return null;
    return cat.children.find((c) => c.id === activeSubCategory) || null;
  }

  function highlightActiveCategory() {
    categoryTabs.querySelectorAll('.category-pill').forEach((pill) => {
      pill.classList.toggle('active', pill.dataset.id === activeCategory);
    });
  }

  function renderSubCategoryTabs() {
    const cat = categories.find((c) => c.id === activeCategory);
    const children = cat && cat.children ? cat.children : [];

    if (children.length === 0) {
      subCategoryTabs.classList.add('hidden');
      subCategoryTabs.innerHTML = '';
      return;
    }

    subCategoryTabs.classList.remove('hidden');
    subCategoryTabs.innerHTML = children
      .map((c) => `<button class="subcategory-pill" data-id="${c.id}">${escapeHtml(c.name)}</button>`)
      .join('');
    subCategoryTabs.querySelectorAll('.subcategory-pill').forEach((pill) => {
      pill.classList.toggle('active', pill.dataset.id === activeSubCategory);
      pill.addEventListener('click', () => {
        activeSubCategory = pill.dataset.id;
        subCategoryTabs.querySelectorAll('.subcategory-pill').forEach((p) => p.classList.remove('active'));
        pill.classList.add('active');
        refreshSubSubForActiveSub();
        renderSubSubCategoryTabs();
        renderMenuGrid();
      });
    });
  }

  // Third row — only shown when the active sub-category itself has
  // children, e.g. Alcohol -> Red Wine / Whisky / Vodka / etc.
  function renderSubSubCategoryTabs() {
    const subNode = findActiveSubNode();
    const grandchildren = subNode && subNode.children ? subNode.children : [];

    if (grandchildren.length === 0) {
      subSubCategoryTabs.classList.add('hidden');
      subSubCategoryTabs.innerHTML = '';
      return;
    }

    subSubCategoryTabs.classList.remove('hidden');
    subSubCategoryTabs.innerHTML = grandchildren
      .map((c) => `<button class="subcategory-pill subsubcategory-pill" data-id="${c.id}">${escapeHtml(c.name)}</button>`)
      .join('');
    subSubCategoryTabs.querySelectorAll('.subsubcategory-pill').forEach((pill) => {
      pill.classList.toggle('active', pill.dataset.id === activeSubSubCategory);
      pill.addEventListener('click', () => {
        activeSubSubCategory = pill.dataset.id;
        subSubCategoryTabs.querySelectorAll('.subsubcategory-pill').forEach((p) => p.classList.remove('active'));
        pill.classList.add('active');
        renderMenuGrid();
      });
    });
  }

  function itemHasCustomization(item) {
    return item.hasTemperatureOption
      || (item.customizableIngredients && item.customizableIngredients.length > 0)
      || (item.extraOptions && item.extraOptions.length > 0);
  }

  function renderMenuGrid() {
    const cat = categories.find((c) => c.id === activeCategory);
    let items = [];
    if (cat && cat.children && cat.children.length > 0) {
      const subCat = cat.children.find((c) => c.id === activeSubCategory) || cat.children[0];
      if (subCat && subCat.children && subCat.children.length > 0) {
        const subSubCat = subCat.children.find((c) => c.id === activeSubSubCategory) || subCat.children[0];
        items = subSubCat ? subSubCat.menuItems : [];
      } else {
        items = subCat ? subCat.menuItems : [];
      }
    } else if (cat) {
      items = cat.menuItems;
    }
    menuGrid.innerHTML = items
      .map(
        (item) => `
        <div class="menu-card">
          <div>
            <div class="name">${escapeHtml(item.name)}</div>
            <div class="price mono">$${Number(item.price).toFixed(2)}</div>
          </div>
          <button class="add-btn" data-id="${item.id}">+</button>
        </div>`
      )
      .join('');

    menuGrid.querySelectorAll('.add-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const item = items.find((i) => i.id === btn.dataset.id);
        if (itemHasCustomization(item)) {
          openCustomizeModal(item);
        } else {
          addToBasket({
            key: item.id, // no customization possible, so the menu item id alone is a stable merge key
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
    modalError.classList.add('hidden'); // clear any leftover error from a previous item

    customizeItemName.textContent = item.name;
    customizeItemPrice.textContent = `$${Number(item.price).toFixed(2)} base`;

    // Temperature
    if (item.hasTemperatureOption) {
      temperatureSection.classList.remove('hidden');
      // Use this item's own allowed choices (e.g. bar drinks offer
      // Cold/Normal/Normal+Ice, coffee offers Hot/Cold/Normal) — fall back
      // to the legacy three-option set for any item saved before this field existed.
      const allowedTemps = (item.temperatureOptions && item.temperatureOptions.length > 0)
        ? item.temperatureOptions
        : LEGACY_TEMPERATURE_OPTIONS;
      temperatureOptions.innerHTML = allowedTemps
        .map((key) => `<button type="button" class="option-chip" data-temp="${key}">${TEMPERATURE_LABELS[key] || key}</button>`)
        .join('');
      temperatureOptions.querySelectorAll('.option-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
          customizeTemperature = chip.dataset.temp;
          temperatureOptions.querySelectorAll('.option-chip').forEach((c) => c.classList.remove('selected'));
          chip.classList.add('selected');
          modalError.classList.add('hidden'); // picking a temperature resolves the earlier warning
          updateCustomizeTotal();
        });
      });
    } else {
      temperatureSection.classList.add('hidden');
    }

    // Unified ingredient grid: removable base ingredients (red minus,
    // active/included by default) and extras (green plus, off by default)
    // rendered together as one set of toggle cards.
    const removable = Array.isArray(item.customizableIngredients) ? item.customizableIngredients : [];
    const extras = Array.isArray(item.extraOptions) ? item.extraOptions : [];

    if (removable.length > 0 || extras.length > 0) {
      ingredientGridSection.classList.remove('hidden');
      const removableCards = removable
        .map(
          (ing) => `
          <button type="button" class="ingredient-card remove-type included" data-kind="remove" data-name="${escapeHtml(ing)}">
            <span class="ingredient-toggle-icon">−</span>
            <span class="ingredient-card-name">${escapeHtml(ing)}</span>
          </button>`
        )
        .join('');
      const extraCards = extras
        .map(
          (ex) => `
          <button type="button" class="ingredient-card extra-type" data-kind="extra" data-name="${escapeHtml(ex.name)}" data-price="${ex.price}">
            <span class="ingredient-toggle-icon">+</span>
            <span class="ingredient-card-name">${escapeHtml(ex.name)} <span class="extra-price">+$${Number(ex.price).toFixed(2)}</span></span>
          </button>`
        )
        .join('');
      ingredientGrid.innerHTML = removableCards + extraCards;

      ingredientGrid.querySelectorAll('.ingredient-card[data-kind="remove"]').forEach((card) => {
        card.addEventListener('click', () => {
          const ing = card.dataset.name;
          if (customizeRemoved.has(ing)) {
            // was removed (grayed out) — put it back
            customizeRemoved.delete(ing);
            card.classList.add('included');
          } else {
            // was included — take it out
            customizeRemoved.add(ing);
            card.classList.remove('included');
          }
        });
      });

      ingredientGrid.querySelectorAll('.ingredient-card[data-kind="extra"]').forEach((card) => {
        card.addEventListener('click', () => {
          const name = card.dataset.name;
          if (customizeExtras.has(name)) {
            customizeExtras.delete(name);
            card.classList.remove('selected');
          } else {
            customizeExtras.add(name);
            card.classList.add('selected');
          }
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

  customizeCancelBtn.addEventListener('click', () => {
    customizeModal.classList.add('hidden');
  });

  customizeAddBtn.addEventListener('click', () => {
    if (customizing.hasTemperatureOption && !customizeTemperature) {
      modalError.textContent = 'Please select a temperature first';
      modalError.classList.remove('hidden');
      showToast('Pick a temperature first');
      return;
    }
    modalError.classList.add('hidden');
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

    customizeModal.classList.add('hidden');
  });

  // ---------------- Basket ----------------
  function addToBasket(line) {
    const existing = basket.find((b) => b.key === line.key);
    if (existing) {
      existing.quantity += line.quantity;
    } else {
      basket.push(line);
    }
    updateBasketUI();
  }

  function changeQty(key, delta) {
    const item = basket.find((b) => b.key === key);
    if (!item) return;
    item.quantity += delta;
    if (item.quantity <= 0) basket = basket.filter((b) => b.key !== key);
    updateBasketUI();
  }

  function basketTotals() {
    const count = basket.reduce((s, b) => s + b.quantity, 0);
    const total = basket.reduce((s, b) => s + b.quantity * lineUnitPrice(b), 0);
    return { count, total };
  }

  // Refreshes whichever basket-related UI is currently visible: the
  // checkout bar at the bottom of Step 2 always updates, and the itemized
  // receipt on Step 3 updates too if that's the page currently showing
  // (e.g. after a quantity edit made right there on the receipt).
  function updateBasketUI() {
    const { count, total } = basketTotals();

    checkoutSummary.textContent = `${count} item${count === 1 ? '' : 's'} · $${total.toFixed(2)}`;
    viewOrderBtn.disabled = count === 0;

    if (step === 3) {
      renderCheckoutItems();
    }
  }

  function renderCheckoutItems() {
    const { total } = basketTotals();
    basketTotalBigEl.textContent = `$${total.toFixed(2)}`;

    basketItemsEl.innerHTML = basket
      .map((b) => {
        const summary = customizationSummary(b);
        return `
        <div class="basket-item-row">
          <div>
            <div class="basket-item-name">${escapeHtml(b.name)}</div>
            ${summary ? `<div class="item-customization">${escapeHtml(summary)}</div>` : ''}
            <div class="basket-item-price mono">$${lineUnitPrice(b).toFixed(2)} each</div>
          </div>
          <div class="qty-controls">
            <button class="qty-btn minus" data-key="${b.key}" data-delta="-1">${b.quantity === 1 ? '🗑' : '−'}</button>
            <span class="qty-value">${b.quantity}</span>
            <button class="qty-btn plus" data-key="${b.key}" data-delta="1">+</button>
          </div>
        </div>`;
      })
      .join('');

    basketItemsEl.querySelectorAll('.qty-btn').forEach((btn) => {
      btn.addEventListener('click', () => changeQty(btn.dataset.key, Number(btn.dataset.delta)));
    });

    // If the last item was removed right here on the receipt, there's
    // nothing left to accept — send the waiter back to the menu instead
    // of showing an empty receipt.
    if (basket.length === 0) {
      showToast('Cart is empty');
      goToStep(2);
    }
  }

  // Step 2 -> Step 3
  viewOrderBtn.addEventListener('click', () => {
    if (basket.length === 0) return;
    checkoutTableLabel.textContent = selectedTable ? selectedTable.label : '';
    renderCheckoutItems();
    goToStep(3);
  });

  // Step 3 -> submit -> back to Step 1
  acceptOrderBtn.addEventListener('click', async () => {
    if (!selectedTable || basket.length === 0) return;
    acceptOrderBtn.disabled = true;
    acceptOrderBtn.textContent = 'Sending…';
    try {
      await api('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          tableId: selectedTable.id,
          items: basket.map((b) => ({
            menuItemId: b.menuItemId,
            quantity: b.quantity,
            temperature: b.temperature || undefined,
            removedIngredients: b.removedIngredients,
            extraNames: b.selectedExtras.map((e) => e.name),
          })),
        }),
      });

      showToast('Order sent to the kitchen/bar!');

      // Reset everything for the next customer/table
      basket = [];
      selectedTable = null;
      tableStatusLine.textContent = 'Select a table to begin';
      updateBasketUI();
      loadMyOrders(); // keep the history tab fresh in the background
      goToStep(1);
    } catch (err) {
      showToast(err.message || 'Failed to send order');
    } finally {
      acceptOrderBtn.disabled = false;
      acceptOrderBtn.textContent = '✅ Accept Order';
    }
  });

  // ---------------- My Orders (history) ----------------
  async function loadMyOrders() {
    try {
      const date = ordersDateInput.value; // YYYY-MM-DD, defaults to today via boot()
      myOrders = await api(`/api/orders/mine?date=${date}`);
      renderOrders();
    } catch (err) {
      console.error(err);
    }
  }

  ordersDateInput.addEventListener('change', loadMyOrders);

  function renderOrders() {
    if (myOrders.length === 0) {
      ordersList.innerHTML = '<p class="orders-empty">No orders sent on this day.</p>';
      return;
    }

    ordersList.innerHTML = myOrders
      .map((order) => {
        const meta = STATUS_META[order.status] || STATUS_META.PENDING;
        const total = order.items.reduce((s, i) => s + orderItemLineTotal(i), 0);
        return `
        <div class="ticket-card">
          <div class="ticket-perforation"></div>
          <div class="ticket-top">
            <div>
              <p class="ticket-eyebrow">Ticket</p>
              <p class="ticket-num mono">#${order.id.slice(0, 6).toUpperCase()}</p>
            </div>
            <div style="text-align:right">
              <p class="ticket-eyebrow">Table</p>
              <p class="ticket-num">${escapeHtml(order.table.label)}</p>
            </div>
          </div>
          <hr class="ticket-divider" />
          ${order.items
            .map((it) => {
              const summary = customizationSummary({
                temperature: it.temperature,
                removedIngredients: it.removedIngredients,
                selectedExtras: it.selectedExtras,
              });
              return `
            <div class="ticket-item-row" style="flex-direction:column;align-items:stretch;">
              <div style="display:flex;justify-content:space-between;">
                <span>${it.quantity}× ${escapeHtml(it.menuItem.name)}</span>
                <span class="mono">$${orderItemLineTotal(it).toFixed(2)}</span>
              </div>
              ${summary ? `<div class="item-customization">${escapeHtml(summary)}</div>` : ''}
            </div>`;
            })
            .join('')}
          <hr class="ticket-divider" />
          <div class="ticket-total-row">
            <span>Total</span>
            <span class="mono">$${total.toFixed(2)}</span>
          </div>
          <div class="ticket-actions">
            <div class="status-chip" style="background:${meta.color}">
              ${meta.icon} ${meta.label}
            </div>
            <div class="cancel-locked" title="Cancelling requires manager approval">
              🔒 Cancel
            </div>
          </div>
        </div>`;
      })
      .join('');
  }

  // ---------------- Boot ----------------
  async function boot() {
    showApp();
    goToStep(1);
    updateDateDisplay();
    setInterval(updateDateDisplay, 60 * 1000); // catches the date rolling over past midnight
    // Force today's date on every load — a browser can restore this
    // input's previous value from form autofill/history on reload, so
    // checking "if empty" isn't reliable; always reset it explicitly.
    ordersDateInput.value = todayDateString(); // YYYY-MM-DD in local time
    connectSocket();
    await Promise.all([loadTables(), loadCategories()]);
    updateBasketUI();
    await loadMyOrders();
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Explicit local-date formatter for <input type="date"> — builds
  // YYYY-MM-DD from the browser's own local date components (getFullYear/
  // getMonth/getDate all read local time, not UTC), so there's no
  // ambiguity about locale or timezone conversion here.
  function todayDateString() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // Auto-login if a token is already stored
  if (token && user) {
    boot().catch((err) => {
      console.error('Boot failed, clearing session:', err);
      localStorage.removeItem('kds_waiter_token');
      localStorage.removeItem('kds_waiter_user');
      loginScreen.classList.remove('hidden');
      appScreen.classList.add('hidden');
    });
  }
})();
