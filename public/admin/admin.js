(function () {
  'use strict';

  const API = '';

  let token = localStorage.getItem('kds_admin_token') || null;
  let user = JSON.parse(localStorage.getItem('kds_admin_user') || 'null');
  let socket = null;
  let socketConnected = false; // guard against double-connecting

  let currentDate = todayISO();
  let currentOrders = [];
  let lastOverviewReport = null; // cached report from the last loadOverview() call, patched live off socket events
  let pendingVoidOrderId = null;

  let itemsCategoryFilter = 'all'; // 'all' | 'drinks' | 'food' — for the Items Ordered Today panel
  let itemsPeriod = 'daily'; // 'daily' | 'weekly' | 'monthly' — for the same panel
  let topSellersMode = false; // when true, Items Ordered Today is ranked by quantity sold instead of A–Z
  let ordersCategoryFilter = 'all'; // 'all' | 'drinks' | 'food' — for the All Orders panel
  let lastItemsOrdered = []; // most recent report.itemsOrdered, re-rendered when the category filter changes
  let itemCategoryMap = new Map(); // menu item name -> 'drinks' | 'food' | null, built from currentOrders
  let itemMidCategoryMap = new Map(); // menu item name -> 'Alcohol' | 'Hot Drinks' | 'Juices & Smoothies' | 'Soft Drinks' | null

  // ---------------- Stock (backed by /api/stock — synced across every login) ----------------
  let stockItems = [];
  let menuItemsForLinking = []; // cached list from GET /api/stock/menu-items, for the link picker
  let editingStockItemId = null;
  let pendingLinkStockItemId = null;

  // ---------------- Menu management ----------------
  let menuItemsAdmin = [];
  let categoriesFlat = []; // cached list from GET /api/menu-items/categories
  let editingMenuItemId = null;
  let extraRowSeq = 0; // unique-enough ids for dynamically added extra rows
  let menuCategoryFilter = 'all'; // 'all' | 'drinks' | 'food' — for the Menu tab
  let menuTopSellersMode = false; // ranks the Menu tab by units sold on the selected date
  let menuSearchQuery = ''; // free-text filter on item name / category path, lowercased

  const FOOD_TOP_CATEGORIES = ['Snacks', 'Meals'];

  // Walk a menu item's category up to its top-level ancestor (mirrors the
  // same logic the Barista/Chef displays use to split a ticket into
  // drink items vs food items).
  function topCategoryName(menuItem) {
    let c = menuItem && menuItem.category;
    if (!c) return null;
    while (c.parent) c = c.parent;
    return c.name;
  }
  function categoryBucket(menuItem) {
    const top = topCategoryName(menuItem);
    if (top === 'Drinks') return 'drinks';
    if (FOOD_TOP_CATEGORIES.includes(top)) return 'food';
    return null;
  }
  function orderItemMatchesFilter(orderItem, filter) {
    if (filter === 'all') return true;
    return categoryBucket(orderItem.menuItem) === filter;
  }

  // The drink sub-type just below "Drinks" — Alcohol, Hot Drinks,
  // Juices & Smoothies, or Soft Drinks. Climbs past any deeper alcohol
  // sub-type (Red Wine, Whisky, etc.) to land on "Alcohol" itself.
  function midCategoryName(menuItem) {
    let c = menuItem && menuItem.category;
    if (!c) return null;
    while (c.parent && c.parent.parent) c = c.parent;
    return c.name;
  }

  // Small colored tag shown after a drink's name: red = Alcohol,
  // green = non-alcoholic (Soft Drinks), yellow = Hot Drinks or Juices.
  function categoryTagFor(mid) {
    if (mid === 'Alcohol') return { label: 'Alcohol', cls: 'tag-red' };
    if (mid === 'Soft Drinks') return { label: 'Non-Alcoholic', cls: 'tag-green' };
    if (mid === 'Hot Drinks') return { label: 'Hot', cls: 'tag-yellow' };
    if (mid === 'Juices & Smoothies') return { label: 'Juice', cls: 'tag-yellow' };
    return null;
  }
  function categoryTagHtml(mid) {
    const t = categoryTagFor(mid);
    return t ? ` <span class="category-tag ${t.cls}">${t.label}</span>` : '';
  }

  const STATUS_META = {
    PENDING: { label: 'Pending', color: 'var(--wait)' },
    IN_PROGRESS: { label: 'In Progress', color: 'var(--prog)' },
    COMPLETED: { label: 'Completed', color: 'var(--go)' },
    VOIDED: { label: 'Voided', color: 'var(--danger)' },
  };

  const TEMPERATURE_LABELS = { HOT: '🔥 Hot', COLD: '🥶 Cold', NORMAL: '🌡 Normal', NORMAL_WITH_ICE: '🧊 Normal + Ice' };

  const PAYMENT_METHOD_LABELS = {
    CASH: 'Cash',
    CARD: 'Card',
    TELEBIRR: 'Telebirr',
    CBE: 'CBE',
    BOA: 'BOA',
    MOBILE_MONEY: 'Mobile Money',
  };

  // ---------------- DOM refs ----------------
  const loginScreen = document.getElementById('loginScreen');
  const appScreen = document.getElementById('appScreen');
  const loginForm = document.getElementById('loginForm');
  const loginError = document.getElementById('loginError');

  const dateInput = document.getElementById('dateInput');
  const refreshBtn = document.getElementById('refreshBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  const toggleBtns = document.querySelectorAll('.toggle-btn');
  const hamburgerBtn = document.getElementById('hamburgerBtn');
  const mobileNavDropdown = document.getElementById('mobileNavDropdown');
  const mobileNavItems = document.querySelectorAll('.mobile-nav-item');

  const overviewView = document.getElementById('overviewView');
  const ordersView = document.getElementById('ordersView');
  const staffView = document.getElementById('staffView');
  const stockView = document.getElementById('stockView');
  const menuMgmtView = document.getElementById('menuMgmtView');

  const stockTable = document.getElementById('stockTable');
  const addStockBtn = document.getElementById('addStockBtn');
  const stockItemModal = document.getElementById('stockItemModal');
  const stockItemModalTitle = document.getElementById('stockItemModalTitle');
  const stockItemForm = document.getElementById('stockItemForm');
  const stockItemError = document.getElementById('stockItemError');
  const stockItemCancelBtn = document.getElementById('stockItemCancelBtn');
  const stockItemSubmitBtn = document.getElementById('stockItemSubmitBtn');

  const linkMenuItemModal = document.getElementById('linkMenuItemModal');
  const linkMenuItemSelect = document.getElementById('linkMenuItemSelect');
  const linkQtyPerSale = document.getElementById('linkQtyPerSale');
  const linkItemForm = document.getElementById('linkItemForm');
  const linkItemError = document.getElementById('linkItemError');
  const linkItemCancelBtn = document.getElementById('linkItemCancelBtn');

  const menuItemsTable = document.getElementById('menuItemsTable');
  const addMenuItemBtn = document.getElementById('addMenuItemBtn');
  const menuItemModal = document.getElementById('menuItemModal');
  const menuItemModalTitle = document.getElementById('menuItemModalTitle');
  const menuItemForm = document.getElementById('menuItemForm');
  const menuItemError = document.getElementById('menuItemError');
  const menuItemCancelBtn = document.getElementById('menuItemCancelBtn');
  const menuItemSubmitBtn = document.getElementById('menuItemSubmitBtn');
  const menuItemCategorySelect = document.getElementById('menuItemCategory');
  const menuItemImageUrlInput = document.getElementById('menuItemImageUrl');
  const menuItemImagePreview = document.getElementById('menuItemImagePreview');
  const menuItemHasTempCheckbox = document.getElementById('menuItemHasTemp');
  const menuItemExtrasList = document.getElementById('menuItemExtrasList');
  const addExtraRowBtn = document.getElementById('addExtraRowBtn');
  const menuCategoryFilterRow = document.getElementById('menuCategoryFilter');
  const menuTopSellersBtn = document.getElementById('menuTopSellersBtn');
  const menuSearchInput = document.getElementById('menuSearchInput');

  const statGrid = document.getElementById('statGrid');
  const itemsTable = document.getElementById('itemsTable');
  const flaggedTable = document.getElementById('flaggedTable');
  const ordersTable = document.getElementById('ordersTable');
  const staffTable = document.getElementById('staffTable');

  const itemsCategoryFilterRow = document.getElementById('itemsCategoryFilter');
  const itemsPeriodFilterRow = document.getElementById('itemsPeriodFilter');
  const itemsPeriodLabel = document.getElementById('itemsPeriodLabel');
  const topSellersBtn = document.getElementById('topSellersBtn');
  const ordersCategoryFilterRow = document.getElementById('ordersCategoryFilter');

  const addStaffBtn = document.getElementById('addStaffBtn');
  const staffModal = document.getElementById('staffModal');
  const staffForm = document.getElementById('staffForm');
  const staffError = document.getElementById('staffError');
  const staffCancelBtn = document.getElementById('staffCancelBtn');

  const voidModal = document.getElementById('voidModal');
  const voidForm = document.getElementById('voidForm');
  const voidError = document.getElementById('voidError');
  const voidCancelBtn = document.getElementById('voidCancelBtn');

  const detailsModal = document.getElementById('detailsModal');
  const detailsBody = document.getElementById('detailsBody');
  const detailsCloseBtn = document.getElementById('detailsCloseBtn');

  const receiptModal = document.getElementById('receiptModal');
  const receiptBody = document.getElementById('receiptBody');
  const receiptCloseBtn = document.getElementById('receiptCloseBtn');
  const receiptPrintBtn = document.getElementById('receiptPrintBtn');
  const receiptPrintArea = document.getElementById('receiptPrintArea');

  const screenshotLightbox = document.getElementById('screenshotLightbox');
  const lightboxImage = document.getElementById('lightboxImage');
  const lightboxFallback = document.getElementById('lightboxFallback');
  const lightboxCloseBtn = document.getElementById('lightboxCloseBtn');

  const toastEl = document.getElementById('toast');

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

  // Addis Ababa is UTC+3, no DST — same reasoning as orderController.js's
  // addisDayStart(). Neither the raw UTC date (new Date().toISOString())
  // nor the browser/OS's own local date can be trusted to match Addis
  // Ababa's calendar day — the manager's computer may be set to a
  // different timezone entirely — so this shifts the current UTC instant
  // by the fixed offset before reading the date off it. Keeping this
  // function as the SINGLE source of "today" (used both for the date
  // picker's default and for every currentDate === todayISO() live-event
  // guard below) is what matters most: as long as both sides agree, the
  // exact timezone convention chosen is less important than never drifting.
  function todayISO() {
    const ADDIS_ABABA_UTC_OFFSET_HOURS = 3;
    const nowInAddis = new Date(Date.now() + ADDIS_ABABA_UTC_OFFSET_HOURS * 60 * 60 * 1000);
    const y = nowInAddis.getUTCFullYear();
    const m = String(nowInAddis.getUTCMonth() + 1).padStart(2, '0');
    const d = String(nowInAddis.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function showToast(text, isError) {
    toastEl.textContent = text;
    toastEl.classList.toggle('error', !!isError);
    toastEl.classList.remove('hidden');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toastEl.classList.add('hidden'), 3500);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Mirrors src/utils/pricing.js — the server is the source of truth for
  // the real charge; this just displays the same number to the manager.
  function lineTotal(item) {
    const extras = Array.isArray(item.selectedExtras) ? item.selectedExtras : [];
    const extrasSum = extras.reduce((s, e) => s + Number(e.price || 0), 0);
    return (Number(item.unitPrice) + extrasSum) * item.quantity;
  }

  function itemCustomizationSummary(item) {
    const parts = [];
    if (item.temperature) parts.push(TEMPERATURE_LABELS[item.temperature] || item.temperature);
    if (item.removedIngredients && item.removedIngredients.length > 0) {
      parts.push(`no ${item.removedIngredients.join(', ')}`);
    }
    const extras = Array.isArray(item.selectedExtras) ? item.selectedExtras : [];
    if (extras.length > 0) parts.push(`+${extras.map((e) => e.name).join(', +')}`);
    return parts.join(' • ');
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
      if (data.user.role !== 'MANAGER') {
        loginError.textContent = 'This dashboard is for manager accounts only.';
        return;
      }
      token = data.token;
      user = data.user;
      localStorage.setItem('kds_admin_token', token);
      localStorage.setItem('kds_admin_user', JSON.stringify(user));
      boot();
    } catch (err) {
      loginError.textContent = err.message || 'Login failed';
    }
  });

  function showApp() {
    loginScreen.classList.add('hidden');
    appScreen.classList.remove('hidden');
  }

  logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('kds_admin_token');
    localStorage.removeItem('kds_admin_user');
    location.reload();
  });

  // ---------------- View toggle ----------------
  // Shared by the desktop tab row (.toggle-btn) and the mobile hamburger
  // dropdown (.mobile-nav-item) so both stay in sync no matter which one
  // was used to switch views.
  function switchView(view) {
    toggleBtns.forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    mobileNavItems.forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    overviewView.classList.toggle('hidden', view !== 'overview');
    ordersView.classList.toggle('hidden', view !== 'orders');
    staffView.classList.toggle('hidden', view !== 'staff');
    stockView.classList.toggle('hidden', view !== 'stock');
    menuMgmtView.classList.toggle('hidden', view !== 'menu');
    if (view === 'staff') loadStaff();
    if (view === 'stock') loadStock();
    if (view === 'menu') loadMenuItemsAdmin();
  }

  toggleBtns.forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  mobileNavItems.forEach((btn) => {
    btn.addEventListener('click', () => {
      switchView(btn.dataset.view);
      mobileNavDropdown.classList.add('hidden');
      hamburgerBtn.setAttribute('aria-expanded', 'false');
    });
  });

  hamburgerBtn.addEventListener('click', () => {
    const isOpen = !mobileNavDropdown.classList.contains('hidden');
    mobileNavDropdown.classList.toggle('hidden', isOpen);
    hamburgerBtn.setAttribute('aria-expanded', String(!isOpen));
  });

  // ---------------- Date control ----------------
  dateInput.addEventListener('change', () => {
    currentDate = dateInput.value || todayISO();
    loadOverview();
    loadOrders();
    loadItemsPanel();
  });

  refreshBtn.addEventListener('click', () => {
    loadOverview();
    loadOrders();
    loadStock();
    loadItemsPanel();
  });

  // ---------------- Category filters (Drinks / Food) ----------------
  itemsCategoryFilterRow.addEventListener('click', (e) => {
    const btn = e.target.closest('.cat-filter-btn');
    if (!btn) return;
    itemsCategoryFilterRow.querySelectorAll('.cat-filter-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    itemsCategoryFilter = btn.dataset.cat;
    renderItemsTable(lastItemsOrdered);
  });

  itemsPeriodFilterRow.addEventListener('click', (e) => {
    const btn = e.target.closest('.cat-filter-btn');
    if (!btn) return;
    itemsPeriodFilterRow.querySelectorAll('.cat-filter-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    itemsPeriod = btn.dataset.period;
    loadItemsPanel();
  });

  ordersCategoryFilterRow.addEventListener('click', (e) => {
    const btn = e.target.closest('.cat-filter-btn');
    if (!btn) return;
    ordersCategoryFilterRow.querySelectorAll('.cat-filter-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    ordersCategoryFilter = btn.dataset.cat;
    renderOrdersTable();
  });

  topSellersBtn.addEventListener('click', () => {
    topSellersMode = !topSellersMode;
    topSellersBtn.classList.toggle('active', topSellersMode);
    renderItemsTable(lastItemsOrdered);
  });

  menuCategoryFilterRow.addEventListener('click', (e) => {
    const btn = e.target.closest('.cat-filter-btn');
    if (!btn) return;
    menuCategoryFilterRow.querySelectorAll('.cat-filter-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    menuCategoryFilter = btn.dataset.cat;
    renderMenuItemsTable();
  });

  menuTopSellersBtn.addEventListener('click', () => {
    menuTopSellersMode = !menuTopSellersMode;
    menuTopSellersBtn.classList.toggle('active', menuTopSellersMode);
    renderMenuItemsTable();
  });

  // Real-time filtering as the manager types — combines with the
  // category pills and Top Sellers mode rather than replacing them.
  menuSearchInput.addEventListener('input', () => {
    menuSearchQuery = menuSearchInput.value.trim().toLowerCase();
    renderMenuItemsTable();
  });

  // ---------------- Overview (daily reconciliation) ----------------
  async function loadOverview() {
    try {
      const report = await api(`/api/reports/daily?date=${currentDate}`);
      lastOverviewReport = report;
      renderStatGrid(report);
      renderFlaggedTable(report.flaggedAttempts.details);
    } catch (err) {
      showToast(err.message || 'Failed to load report', true);
    }
  }

  // ---------------- Items Ordered panel: Daily / Weekly / Monthly ----------------
  // Built entirely on top of the existing per-day report endpoint — fetch
  // every day in the selected range and merge them client-side, rather
  // than needing a new backend endpoint for weekly/monthly aggregation.
  function parseISODateUTC(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }
  function toISO(d) {
    return d.toISOString().slice(0, 10);
  }

  function getDateRangeForPeriod(period, baseDateISO) {
    const base = parseISODateUTC(baseDateISO);

    if (period === 'weekly') {
      // Monday–Sunday of the week containing the selected date.
      const day = base.getUTCDay(); // 0 = Sun .. 6 = Sat
      const diffToMonday = day === 0 ? -6 : 1 - day;
      const monday = new Date(base);
      monday.setUTCDate(base.getUTCDate() + diffToMonday);
      const dates = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setUTCDate(monday.getUTCDate() + i);
        dates.push(toISO(d));
      }
      return dates;
    }

    if (period === 'monthly') {
      const year = base.getUTCFullYear();
      const month = base.getUTCMonth();
      const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      const dates = [];
      for (let day = 1; day <= lastDay; day++) {
        dates.push(toISO(new Date(Date.UTC(year, month, day))));
      }
      return dates;
    }

    return [baseDateISO]; // daily
  }

  function formatPeriodLabel(period, baseDateISO) {
    const base = parseISODateUTC(baseDateISO);
    if (period === 'weekly') {
      const range = getDateRangeForPeriod('weekly', baseDateISO);
      const start = parseISODateUTC(range[0]).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const end = parseISODateUTC(range[range.length - 1]).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      return `This Week (${start}–${end})`;
    }
    if (period === 'monthly') {
      return `This Month (${base.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })})`;
    }
    return base.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  }

  async function loadItemsPanel() {
    const dates = getDateRangeForPeriod(itemsPeriod, currentDate);
    itemsPeriodLabel.textContent = formatPeriodLabel(itemsPeriod, currentDate);

    try {
      const reports = await Promise.all(
        dates.map((d) => api(`/api/reports/daily?date=${d}`).catch(() => ({ itemsOrdered: [] })))
      );
      const merged = new Map(); // name -> { name, quantity, revenue }
      reports.forEach((r) => {
        (r.itemsOrdered || []).forEach((i) => {
          const existing = merged.get(i.name);
          if (existing) {
            existing.quantity += i.quantity;
            existing.revenue += i.revenue;
          } else {
            merged.set(i.name, { name: i.name, quantity: i.quantity, revenue: i.revenue });
          }
        });
      });
      lastItemsOrdered = Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name));
      renderItemsTable(lastItemsOrdered);
    } catch (err) {
      showToast(err.message || 'Failed to load items report', true);
    }
  }

  function renderStatGrid(report) {
    const s = report.summary;
    const cards = [
      { label: 'Orders Placed', value: s.ordersPlaced },
      { label: 'Orders Voided', value: s.ordersVoided, tone: s.ordersVoided > 0 ? 'warn' : '' },
      { label: 'Revenue (Live)', value: `$${s.liveRevenue.toFixed(2)}` },
      { label: 'Revenue (Logged)', value: `$${s.loggedRevenue.toFixed(2)}` },
      {
        label: 'Reconciled',
        value: s.reconciled ? '✓ Match' : `⚠ Off by $${Math.abs(s.discrepancy).toFixed(2)}`,
        tone: s.reconciled ? 'good' : 'bad',
      },
      {
        label: 'Blocked Attempts',
        value: report.flaggedAttempts.failed,
        tone: report.flaggedAttempts.failed > 0 ? 'bad' : 'good',
      },
    ];

    statGrid.innerHTML = cards
      .map(
        (c) => `
        <div class="stat-card ${c.tone || ''}">
          <p class="label">${c.label}</p>
          <p class="value">${c.value}</p>
        </div>`
      )
      .join('');
  }

  function renderItemsTable(items) {
    let filtered =
      itemsCategoryFilter === 'all'
        ? items
        : (items || []).filter((i) => itemCategoryMap.get(i.name) === itemsCategoryFilter);

    if (!filtered || filtered.length === 0) {
      const emptyMsg =
        itemsCategoryFilter === 'all'
          ? 'No items ordered on this day.'
          : `No ${itemsCategoryFilter === 'drinks' ? 'drink' : 'food'} items ordered on this day.`;
      itemsTable.innerHTML = `<table class="grid"><tbody><tr class="empty-row"><td>${emptyMsg}</td></tr></tbody></table>`;
      return;
    }

    if (topSellersMode) {
      // Best sellers first — quantity sold, revenue as the tiebreaker.
      filtered = [...filtered].sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue);
    }

    const RANK_MEDALS = ['🥇', '🥈', '🥉'];

    // Totals over exactly the same `filtered` list the rows above are
    // built from — since that already reflects the current Daily/Weekly/
    // Monthly period AND the current All/Drinks/Food category filter,
    // this row updates automatically every time renderItemsTable() is
    // re-run for either kind of toggle, with no separate sync needed.
    const totalQuantity = filtered.reduce((sum, i) => sum + i.quantity, 0);
    const totalRevenue = filtered.reduce((sum, i) => sum + i.revenue, 0);

    itemsTable.innerHTML = `
      <table class="grid">
        <thead><tr><th>${topSellersMode ? '#' : ''}Item</th><th>Quantity</th><th>Revenue</th></tr></thead>
        <tbody>
          ${filtered
            .map((i, idx) => {
              const rankHtml = topSellersMode
                ? RANK_MEDALS[idx]
                  ? `<span class="rank-medal">${RANK_MEDALS[idx]}</span>`
                  : `<span class="rank-number">${idx + 1}.</span>`
                : '';
              return `
            <tr>
              <td>${rankHtml}${escapeHtml(i.name)}${categoryTagHtml(itemMidCategoryMap.get(i.name))}</td>
              <td class="mono-cell">${i.quantity}</td>
              <td class="mono-cell">$${i.revenue.toFixed(2)}</td>
            </tr>`;
            })
            .join('')}
          <tr class="total-row">
            <td><strong>TOTAL</strong></td>
            <td class="mono-cell"><strong>${totalQuantity}</strong></td>
            <td class="mono-cell"><strong>$${totalRevenue.toFixed(2)}</strong></td>
          </tr>
        </tbody>
      </table>`;
  }

  function renderFlaggedTable(details) {
    if (!details || details.length === 0) {
      flaggedTable.innerHTML = '<table class="grid"><tbody><tr class="empty-row"><td>No blocked attempts on this day. 🎉</td></tr></tbody></table>';
      return;
    }
    flaggedTable.innerHTML = `
      <table class="grid">
        <thead><tr><th>Action</th><th>Actor</th><th>Role</th><th>Order</th><th>IP</th><th>Time</th></tr></thead>
        <tbody>
          ${details
            .map(
              (d) => `
            <tr>
              <td>${escapeHtml(d.action)}</td>
              <td>${escapeHtml(d.actor)}</td>
              <td>${escapeHtml(d.role)}</td>
              <td class="mono-cell">${d.orderId ? d.orderId.slice(0, 6).toUpperCase() : '—'}</td>
              <td class="mono-cell">${escapeHtml(d.ip || '—')}</td>
              <td>${new Date(d.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>`;
  }

  // ---------------- Orders ----------------
  async function loadOrders() {
    try {
      currentOrders = await api(`/api/orders/all?date=${currentDate}`);
      renderOrdersTable();
    } catch (err) {
      showToast(err.message || 'Failed to load orders', true);
    }
  }

  // Item name -> 'drinks' | 'food' | null, derived from the full menu list
  // (not just a single day's orders) so weekly/monthly item reports —
  // which can include items outside today's orders — still categorize
  // and filter correctly.
  function rebuildItemCategoryMap() {
    itemCategoryMap = new Map();
    itemMidCategoryMap = new Map();
    menuItemsAdmin.forEach((m) => {
      itemCategoryMap.set(m.name, categoryBucket(m));
      itemMidCategoryMap.set(m.name, midCategoryName(m));
    });
  }

  function renderOrdersTable() {
    const filterActive = ordersCategoryFilter !== 'all';

    if (filterActive) {
      renderOrdersTableByItem();
      return;
    }

    if (currentOrders.length === 0) {
      ordersTable.innerHTML = '<table class="grid"><tbody><tr class="empty-row"><td>No orders on this day.</td></tr></tbody></table>';
      return;
    }

    ordersTable.innerHTML = `
      <table class="grid">
        <thead>
          <tr><th>Ticket</th><th>Table</th><th>Waiter</th><th>Items</th><th>Total</th><th>Status</th><th>Action</th></tr>
        </thead>
        <tbody>
          ${currentOrders
            .map((o) => {
              const meta = STATUS_META[o.status] || STATUS_META.PENDING;
              const total = o.items.reduce((s, i) => s + lineTotal(i), 0);
              const itemsSummary = o.items
                .map((i) => `${i.quantity}× ${escapeHtml(i.menuItem.name)}${categoryTagHtml(midCategoryName(i.menuItem))}`)
                .join(', ');
              const canVoid = o.status !== 'VOIDED';
              return `
              <tr>
                <td class="mono-cell">#${o.id.slice(0, 6).toUpperCase()}</td>
                <td>${escapeHtml(o.table.label)}</td>
                <td>${escapeHtml(o.waiter.name)}</td>
                <td>${itemsSummary}</td>
                <td class="mono-cell">$${total.toFixed(2)}</td>
                <td><span class="status-pill" style="background:${meta.color}">${meta.label}</span></td>
                <td>
                  <button class="small-btn view" data-id="${o.id}">View</button>
                  <button class="small-btn void" data-id="${o.id}" ${canVoid ? '' : 'disabled'}>
                    ${canVoid ? 'Void' : 'Voided'}
                  </button>
                </td>
              </tr>`;
            })
            .join('')}
        </tbody>
      </table>`;

    ordersTable.querySelectorAll('.small-btn.view').forEach((btn) => {
      btn.addEventListener('click', () => openDetailsModal(btn.dataset.id));
    });
    ordersTable.querySelectorAll('.small-btn.void:not(:disabled)').forEach((btn) => {
      btn.addEventListener('click', () => openVoidModal(btn.dataset.id));
    });
  }

  // Simplified view for the Drinks/Food filters — one row per item
  // (not per order), just Waiter / Item / Price, with a grand total.
  // Voided orders are excluded so the total reflects real sales.
  function renderOrdersTableByItem() {
    const rows = [];
    currentOrders
      .filter((o) => o.status !== 'VOIDED')
      .forEach((o) => {
        o.items
          .filter((it) => orderItemMatchesFilter(it, ordersCategoryFilter))
          .forEach((it) => {
            rows.push({
              waiter: o.waiter.name,
              name: `${it.quantity}× ${it.menuItem.name}`,
              tag: categoryTagHtml(midCategoryName(it.menuItem)),
              price: lineTotal(it),
            });
          });
      });

    if (rows.length === 0) {
      const label = ordersCategoryFilter === 'drinks' ? 'drink' : 'food';
      ordersTable.innerHTML = `<table class="grid"><tbody><tr class="empty-row"><td>No ${label} items on this day.</td></tr></tbody></table>`;
      return;
    }

    const grandTotal = rows.reduce((s, r) => s + r.price, 0);

    ordersTable.innerHTML = `
      <table class="grid">
        <thead>
          <tr><th>Waiter</th><th>Item</th><th>Price</th></tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (r) => `
            <tr>
              <td>${escapeHtml(r.waiter)}</td>
              <td>${escapeHtml(r.name)}${r.tag}</td>
              <td class="mono-cell">$${r.price.toFixed(2)}</td>
            </tr>`
            )
            .join('')}
          <tr class="total-row">
            <td colspan="2"><strong>Total</strong></td>
            <td class="mono-cell"><strong>$${grandTotal.toFixed(2)}</strong></td>
          </tr>
        </tbody>
      </table>`;
  }

  // ---------------- Order details modal ----------------
  function openDetailsModal(orderId) {
    const order = currentOrders.find((o) => o.id === orderId);
    if (!order) return;

    const meta = STATUS_META[order.status] || STATUS_META.PENDING;
    const total = order.items.reduce((s, i) => s + lineTotal(i), 0);

    detailsBody.innerHTML = `
      <div class="details-top">
        <div>
          <p class="ticket-eyebrow">Ticket</p>
          <p class="details-big mono">#${order.id.slice(0, 6).toUpperCase()}</p>
        </div>
        <div style="text-align:right">
          <p class="ticket-eyebrow">Table</p>
          <p class="details-big">${escapeHtml(order.table.label)}</p>
        </div>
      </div>

      <div class="details-row"><span class="details-label">Waiter</span><span>${escapeHtml(order.waiter.name)}</span></div>
      <div class="details-row"><span class="details-label">Placed</span><span>${new Date(order.createdAt).toLocaleString()}</span></div>
      <div class="details-row">
        <span class="details-label">Status</span>
        <span class="status-pill" style="background:${meta.color}">${meta.label}</span>
      </div>

      <div class="details-divider"></div>

      ${order.items
        .map((it) => {
          const summary = itemCustomizationSummary(it);
          return `
          <div class="details-item">
            <div class="details-item-top">
              <span>${it.quantity}× ${escapeHtml(it.menuItem.name)}${categoryTagHtml(midCategoryName(it.menuItem))}</span>
              <span class="mono">$${lineTotal(it).toFixed(2)}</span>
            </div>
            ${summary ? `<div class="details-item-custom">${escapeHtml(summary)}</div>` : ''}
          </div>`;
        })
        .join('')}

      <div class="details-divider"></div>

      <div class="details-row details-total">
        <span>Total</span>
        <span class="mono">$${total.toFixed(2)}</span>
      </div>

      <div class="details-actions-row">
        <button type="button" class="details-action-btn" id="viewReceiptBtn">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><line x1="10" y1="9" x2="8" y2="9"></line></svg>
          View Receipt
        </button>
        <button type="button" class="details-action-btn" id="viewScreenshotBtn" ${order.paymentScreenshotUrl ? '' : 'disabled title="No screenshot uploaded for this transaction"'}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
          View Screenshot
        </button>
      </div>
      ${!order.paymentScreenshotUrl ? '<p class="field-hint">No screenshot uploaded for this transaction.</p>' : ''}

      ${
        order.isVoided
          ? `
        <div class="void-info-box">
          <p class="void-info-title">⛔ Voided</p>
          <div class="details-row"><span class="details-label">Voided by</span><span>${escapeHtml(order.voidedBy?.name || 'Unknown')}</span></div>
          <div class="details-row"><span class="details-label">Reason</span><span>${escapeHtml(order.voidReason || 'No reason given')}</span></div>
          <div class="details-row"><span class="details-label">Voided at</span><span>${order.voidedAt ? new Date(order.voidedAt).toLocaleString() : '—'}</span></div>
        </div>`
          : ''
      }
    `;

    document.getElementById('viewReceiptBtn').addEventListener('click', () => openReceiptModal(order));
    const screenshotBtn = document.getElementById('viewScreenshotBtn');
    if (order.paymentScreenshotUrl) {
      screenshotBtn.addEventListener('click', () => openScreenshotLightbox(order.paymentScreenshotUrl));
    }

    detailsModal.classList.remove('hidden');
  }

  detailsCloseBtn.addEventListener('click', () => detailsModal.classList.add('hidden'));

  // ---------------- Receipt preview ----------------
  function openReceiptModal(order) {
    const total = order.items.reduce((s, i) => s + lineTotal(i), 0);
    const methodLabel = order.isPaid ? (PAYMENT_METHOD_LABELS[order.paymentMethod] || order.paymentMethod) : 'Not yet paid';

    receiptBody.innerHTML = `
      <div class="details-top">
        <div>
          <p class="ticket-eyebrow">Ticket</p>
          <p class="details-big mono">#${order.id.slice(0, 6).toUpperCase()}</p>
        </div>
        <div style="text-align:right">
          <p class="ticket-eyebrow">Table</p>
          <p class="details-big">${escapeHtml(order.table.label)}</p>
        </div>
      </div>

      <div class="details-row"><span class="details-label">Date</span><span>${new Date(order.createdAt).toLocaleString()}</span></div>
      <div class="details-row"><span class="details-label">Server</span><span>${escapeHtml(order.waiter.name)}</span></div>
      <div class="details-row"><span class="details-label">Payment method</span><span>${escapeHtml(methodLabel)}</span></div>
      ${order.isPaid && order.cashier ? `<div class="details-row"><span class="details-label">Cashier</span><span>${escapeHtml(order.cashier.name)}</span></div>` : ''}

      <div class="details-divider"></div>

      ${order.items
        .map((it) => {
          const summary = itemCustomizationSummary(it);
          return `
          <div class="details-item">
            <div class="details-item-top">
              <span>${it.quantity}× ${escapeHtml(it.menuItem.name)}</span>
              <span class="mono">$${lineTotal(it).toFixed(2)}</span>
            </div>
            ${summary ? `<div class="details-item-custom">${escapeHtml(summary)}</div>` : ''}
          </div>`;
        })
        .join('')}

      <div class="details-divider"></div>

      <div class="details-row details-total">
        <span>Total</span>
        <span class="mono">$${total.toFixed(2)}</span>
      </div>
    `;

    receiptPrintBtn.onclick = () => printReceiptFor(order, methodLabel, total);

    receiptModal.classList.remove('hidden');
  }

  receiptCloseBtn.addEventListener('click', () => receiptModal.classList.add('hidden'));

  function printReceiptFor(order, methodLabel, total) {
    const itemsHtml = order.items
      .map((it) => `<div class="receipt-line"><span>${it.quantity}× ${escapeHtml(it.menuItem.name)}</span><span>$${lineTotal(it).toFixed(2)}</span></div>`)
      .join('');

    receiptPrintArea.innerHTML = `
      <div class="receipt-center">
        <div><strong>RECEIPT</strong></div>
        <div>Table ${escapeHtml(order.table.label)}</div>
        <div>${new Date(order.createdAt).toLocaleString()}</div>
      </div>
      <div class="receipt-divider"></div>
      ${itemsHtml}
      <div class="receipt-divider"></div>
      <div class="receipt-line receipt-total"><span>TOTAL</span><span>$${total.toFixed(2)}</span></div>
      <div class="receipt-line"><span>Server</span><span>${escapeHtml(order.waiter.name)}</span></div>
      <div class="receipt-line"><span>Payment</span><span>${escapeHtml(methodLabel)}</span></div>
      <div class="receipt-divider"></div>
      <div class="receipt-center">Thank you!</div>
    `;
    window.print();
  }

  // ---------------- Payment screenshot lightbox ----------------
  function openScreenshotLightbox(url) {
    lightboxImage.classList.remove('hidden');
    lightboxFallback.classList.add('hidden');
    lightboxImage.src = url;
    screenshotLightbox.classList.remove('hidden');
  }
  // A screenshot uploaded before the app started using a persistent
  // volume (or on a host with no volume at all) 404s here — show a clear
  // message instead of a broken-image icon.
  lightboxImage.addEventListener('error', () => {
    lightboxImage.classList.add('hidden');
    lightboxFallback.classList.remove('hidden');
  });
  lightboxCloseBtn.addEventListener('click', () => screenshotLightbox.classList.add('hidden'));
  screenshotLightbox.addEventListener('click', (e) => {
    if (e.target === screenshotLightbox) screenshotLightbox.classList.add('hidden');
  });

  function openVoidModal(orderId) {
    pendingVoidOrderId = orderId;
    voidError.textContent = '';
    document.getElementById('voidReason').value = '';
    voidModal.classList.remove('hidden');
  }

  voidCancelBtn.addEventListener('click', () => voidModal.classList.add('hidden'));

  voidForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    voidError.textContent = '';
    const reason = document.getElementById('voidReason').value.trim();

    try {
      await api(`/api/orders/${pendingVoidOrderId}`, {
        method: 'DELETE',
        body: JSON.stringify({ reason }),
      });
      voidModal.classList.add('hidden');
      showToast('Order voided');
      loadOrders();
      loadOverview();
    } catch (err) {
      voidError.textContent = err.message || 'Failed to void order';
    }
  });

  // ---------------- Staff ----------------
  let staffList = [];

  async function loadStaff() {
    try {
      staffList = await api('/api/users');
      renderStaffTable(staffList);
    } catch (err) {
      showToast(err.message || 'Failed to load staff', true);
    }
  }

  function renderStaffTable(users) {
    if (users.length === 0) {
      staffTable.innerHTML = '<table class="grid"><tbody><tr class="empty-row"><td>No staff accounts yet.</td></tr></tbody></table>';
      return;
    }
    staffTable.innerHTML = `
      <table class="grid">
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>
          ${users
            .map(
              (u) => `
            <tr>
              <td>${escapeHtml(u.name)}</td>
              <td class="mono-cell">${escapeHtml(u.email)}</td>
              <td><span class="role-pill">${u.role}</span></td>
              <td class="${u.isActive ? 'active-pill' : 'inactive-pill'}">${u.isActive ? '● Active' : '● Inactive'}</td>
              <td>
                <button class="small-btn staff-toggle-btn ${u.isActive ? 'toggle-off' : 'toggle-on'}" data-id="${u.id}" data-active="${u.isActive}" ${u.id === user.id ? 'disabled title="You cannot deactivate your own account"' : ''}>
                  ${u.isActive ? 'Deactivate' : 'Activate'}
                </button>
                <button class="small-btn edit-stock staff-edit-btn" data-id="${u.id}">Edit</button>
                <button class="small-btn void staff-delete-btn" data-id="${u.id}" data-name="${escapeHtml(u.name)}" ${u.id === user.id ? 'disabled title="You cannot delete your own account"' : ''}>
                  Delete
                </button>
              </td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>`;

    staffTable.querySelectorAll('.staff-toggle-btn:not(:disabled)').forEach((btn) => {
      btn.addEventListener('click', () => toggleStaffActive(btn.dataset.id, btn.dataset.active === 'true'));
    });
    staffTable.querySelectorAll('.staff-edit-btn').forEach((btn) => {
      btn.addEventListener('click', () => openEditStaffModal(btn.dataset.id));
    });
    staffTable.querySelectorAll('.staff-delete-btn:not(:disabled)').forEach((btn) => {
      btn.addEventListener('click', () => deleteStaffAccount(btn.dataset.id, btn.dataset.name));
    });
  }

  let editingStaffId = null; let editingStaffIsActive = true;
  const editStaffModal = document.getElementById('editStaffModal');
  const editStaffForm = document.getElementById('editStaffForm');
  const editStaffError = document.getElementById('editStaffError');
  const editStaffCancelBtn = document.getElementById('editStaffCancelBtn');

  function openEditStaffModal(id) {
    const staffUser = staffList.find((u) => u.id === id);
    if (!staffUser) return;
    editingStaffId = id; editingStaffIsActive = staffUser.isActive;
    editStaffError.textContent = '';
    document.getElementById('editStaffName').value = staffUser.name;
    document.getElementById('editStaffEmail').value = staffUser.email;
    editStaffModal.classList.remove('hidden');
  }

  editStaffCancelBtn.addEventListener('click', () => editStaffModal.classList.add('hidden'));

  editStaffForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    editStaffError.textContent = '';
    const name = document.getElementById('editStaffName').value.trim();
    const email = document.getElementById('editStaffEmail').value.trim();

    if (!name || !email) {
      editStaffError.textContent = 'Name and email are required';
      return;
    }

    try {
      await api(`/api/users/${editingStaffId}`, { method: 'PATCH', body: JSON.stringify({ name, email, isActive: editingStaffIsActive }) });
      editStaffModal.classList.add('hidden');
      showToast('Account updated');
      loadStaff();
    } catch (err) {
      editStaffError.textContent = err.message || 'Failed to update account';
    }
  });

  async function deleteStaffAccount(id, name) {
    if (!confirm(`Permanently delete "${name}"'s account? This can't be undone. If they have order history, delete will fail — deactivate instead.`)) return;
    try {
      await api(`/api/users/${id}`, { method: 'DELETE' });
      showToast('Account deleted');
      staffList = staffList.filter((u) => u.id !== id);
      renderStaffTable(staffList);
    } catch (err) {
      showToast(err.message || 'Failed to delete account', true);
    }
  }

  async function toggleStaffActive(id, currentlyActive) {
    try {
      await api(`/api/users/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !currentlyActive }),
      });
      showToast(currentlyActive ? 'Account deactivated' : 'Account activated');
      loadStaff();
    } catch (err) {
      showToast(err.message || 'Failed to update account', true);
    }
  }

  addStaffBtn.addEventListener('click', () => {
    staffError.textContent = '';
    staffForm.reset();
    staffModal.classList.remove('hidden');
  });

  staffCancelBtn.addEventListener('click', () => staffModal.classList.add('hidden'));

  staffForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    staffError.textContent = '';

    const name = document.getElementById('staffName').value.trim();
    const email = document.getElementById('staffEmail').value.trim();
    const password = document.getElementById('staffPassword').value;
    const role = document.getElementById('staffRole').value;

    try {
      await api('/api/users', {
        method: 'POST',
        body: JSON.stringify({ name, email, password, role }),
      });
      staffModal.classList.add('hidden');
      showToast('Staff account created');
      loadStaff();
    } catch (err) {
      staffError.textContent = err.message || 'Failed to create account';
    }
  });

  // ---------------- Stock ----------------
  async function loadStock() {
    try {
      stockItems = await api('/api/stock');
      renderStockTable();
    } catch (err) {
      showToast(err.message || 'Failed to load stock', true);
    }
  }

  async function loadMenuItemsForLinking() {
    if (menuItemsForLinking.length > 0) return; // cached — menu items rarely change mid-shift
    try {
      menuItemsForLinking = await api('/api/stock/menu-items');
    } catch (err) {
      showToast(err.message || 'Failed to load menu items', true);
    }
  }

  function renderStockTable() {
    if (stockItems.length === 0) {
      stockTable.innerHTML = '<table class="grid"><tbody><tr class="empty-row"><td>No stock items yet — add one to start tracking.</td></tr></tbody></table>';
      return;
    }

    stockTable.innerHTML = `
      <table class="grid">
        <thead><tr><th>Item</th><th>Category</th><th>Quantity</th><th>Linked Menu Items</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>
          ${stockItems
            .map((s) => {
              const hasThreshold = s.threshold !== null && s.threshold !== undefined && s.threshold !== '';
              const isLow = hasThreshold && Number(s.quantity) <= Number(s.threshold);
              const statusHtml = hasThreshold
                ? isLow
                  ? '<span class="category-tag tag-red">Low Stock</span>'
                  : '<span class="category-tag tag-green">OK</span>'
                : '<span class="field-hint" style="margin:0;">—</span>';
              const linksHtml = (s.links || [])
                .map(
                  (l) => `
                <span class="link-chip">
                  ${escapeHtml(l.menuItem.name)} <span class="mono">×${l.qtyPerSale}</span>
                  <button type="button" class="unlink-btn" data-link-id="${l.id}" title="Remove link">✕</button>
                </span>`
                )
                .join('');
              return `
            <tr>
              <td>${escapeHtml(s.name)}</td>
              <td><span class="role-pill">${escapeHtml(s.category)}</span></td>
              <td>
                <input type="number" step="0.01" min="0" class="stock-qty-input" data-id="${s.id}" value="${s.quantity}" />
                ${s.unit ? `<span class="stock-unit">${escapeHtml(s.unit)}</span>` : ''}
              </td>
              <td>
                <div class="stock-links">
                  ${linksHtml}
                  <button type="button" class="small-btn link-item-btn" data-id="${s.id}">+ Link</button>
                </div>
              </td>
              <td>${statusHtml}</td>
              <td>
                <button class="small-btn save-qty" data-id="${s.id}">Save</button>
                <button class="small-btn edit-stock" data-id="${s.id}">Edit</button>
                <button class="small-btn void delete-stock" data-id="${s.id}">Delete</button>
              </td>
            </tr>`;
            })
            .join('')}
        </tbody>
      </table>`;

    stockTable.querySelectorAll('.save-qty').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const input = stockTable.querySelector(`.stock-qty-input[data-id="${id}"]`);
        if (!input) return;
        const val = Number(input.value);
        if (Number.isNaN(val) || val < 0) {
          showToast('Enter a valid quantity', true);
          return;
        }
        try {
          await api(`/api/stock/${id}`, { method: 'PATCH', body: JSON.stringify({ quantity: val }) });
          showToast('Quantity updated');
          loadStock();
        } catch (err) {
          showToast(err.message || 'Failed to update quantity', true);
        }
      });
    });

    stockTable.querySelectorAll('.edit-stock').forEach((btn) => {
      btn.addEventListener('click', () => openStockItemModal(btn.dataset.id));
    });

    stockTable.querySelectorAll('.delete-stock').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const item = stockItems.find((s) => s.id === id);
        if (!item) return;
        if (!confirm(`Remove "${item.name}" from stock tracking? This also removes its menu item links.`)) return;
        try {
          await api(`/api/stock/${id}`, { method: 'DELETE' });
          loadStock();
        } catch (err) {
          showToast(err.message || 'Failed to delete stock item', true);
        }
      });
    });

    stockTable.querySelectorAll('.link-item-btn').forEach((btn) => {
      btn.addEventListener('click', () => openLinkModal(btn.dataset.id));
    });

    stockTable.querySelectorAll('.unlink-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const linkId = btn.dataset.linkId;
        // find which stock item owns this link, for the DELETE URL
        const owner = stockItems.find((s) => (s.links || []).some((l) => l.id === linkId));
        if (!owner) return;
        try {
          await api(`/api/stock/${owner.id}/links/${linkId}`, { method: 'DELETE' });
          loadStock();
        } catch (err) {
          showToast(err.message || 'Failed to remove link', true);
        }
      });
    });
  }

  function openStockItemModal(id) {
    editingStockItemId = id || null;
    stockItemError.textContent = '';
    stockItemForm.reset();

    if (editingStockItemId) {
      const item = stockItems.find((s) => s.id === editingStockItemId);
      if (!item) return;
      stockItemModalTitle.textContent = 'Edit Stock Item';
      stockItemSubmitBtn.textContent = 'Save Changes';
      document.getElementById('stockItemName').value = item.name;
      document.getElementById('stockItemCategory').value = item.category;
      document.getElementById('stockItemQuantity').value = item.quantity;
      document.getElementById('stockItemUnit').value = item.unit || '';
      document.getElementById('stockItemThreshold').value = item.threshold ?? '';
    } else {
      stockItemModalTitle.textContent = 'Add Stock Item';
      stockItemSubmitBtn.textContent = 'Add Item';
      document.getElementById('stockItemCategory').value = 'Drinks';
    }

    stockItemModal.classList.remove('hidden');
  }

  addStockBtn.addEventListener('click', () => openStockItemModal(null));
  stockItemCancelBtn.addEventListener('click', () => stockItemModal.classList.add('hidden'));

  stockItemForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    stockItemError.textContent = '';

    const name = document.getElementById('stockItemName').value.trim();
    const category = document.getElementById('stockItemCategory').value;
    const quantity = Number(document.getElementById('stockItemQuantity').value);
    const unit = document.getElementById('stockItemUnit').value.trim();
    const thresholdRaw = document.getElementById('stockItemThreshold').value;
    const threshold = thresholdRaw === '' ? null : Number(thresholdRaw);

    if (!name) {
      stockItemError.textContent = 'Item name is required';
      return;
    }
    if (Number.isNaN(quantity) || quantity < 0) {
      stockItemError.textContent = 'Enter a valid quantity';
      return;
    }

    try {
      if (editingStockItemId) {
        await api(`/api/stock/${editingStockItemId}`, {
          method: 'PATCH',
          body: JSON.stringify({ name, category, quantity, unit, threshold }),
        });
        showToast('Stock item updated');
      } else {
        await api('/api/stock', {
          method: 'POST',
          body: JSON.stringify({ name, category, quantity, unit, threshold }),
        });
        showToast('Stock item added');
      }
      stockItemModal.classList.add('hidden');
      loadStock();
    } catch (err) {
      stockItemError.textContent = err.message || 'Failed to save stock item';
    }
  });

  // ---------------- Link menu item to stock ----------------
  async function openLinkModal(stockItemId) {
    pendingLinkStockItemId = stockItemId;
    linkItemError.textContent = '';
    linkQtyPerSale.value = '1';

    await loadMenuItemsForLinking();
    linkMenuItemSelect.innerHTML = menuItemsForLinking
      .map((m) => `<option value="${m.id}">${escapeHtml(m.name)} — ${escapeHtml(m.category.name)}</option>`)
      .join('');

    linkMenuItemModal.classList.remove('hidden');
  }

  linkItemCancelBtn.addEventListener('click', () => linkMenuItemModal.classList.add('hidden'));

  linkItemForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    linkItemError.textContent = '';

    const menuItemId = linkMenuItemSelect.value;
    const qtyPerSale = Number(linkQtyPerSale.value);

    if (!menuItemId) {
      linkItemError.textContent = 'Pick a menu item';
      return;
    }
    if (Number.isNaN(qtyPerSale) || qtyPerSale <= 0) {
      linkItemError.textContent = 'Quantity per sale must be greater than 0';
      return;
    }

    try {
      await api(`/api/stock/${pendingLinkStockItemId}/links`, {
        method: 'POST',
        body: JSON.stringify({ menuItemId, qtyPerSale }),
      });
      linkMenuItemModal.classList.add('hidden');
      showToast('Linked — this menu item will now draw down this stock');
      loadStock();
    } catch (err) {
      linkItemError.textContent = err.message || 'Failed to link menu item';
    }
  });

  // ---------------- Socket (live stock updates — no manual refresh needed) ----------------
  function connectSocket() {
    if (socketConnected) return; // never attach a second set of listeners
    socketConnected = true;
    socket = io({ auth: { token } });

    // Emitted by the server whenever a waiter's order draws down a linked
    // stock item — see src/controllers/orderController.js -> createOrder.
    // We don't need the payload, just re-fetch the current picture.
    socket.on('stock_changed', () => {
      loadStock();
    });

    // A table's order just finished across every station it needed and
    // is now sitting in the Cashier's Open Bills — surfaced here too so a
    // manager watching this dashboard sees it without switching screens.
    socket.on('table_ready_for_checkout', ({ tableLabel }) => {
      showToast(`Table ${tableLabel} ready for checkout`);
    });

    // ---- Real-time Orders tab sync (no manual refresh needed) ----
    // Both handlers only touch currentOrders/re-render when the Orders
    // tab is actually showing "today" — a live event is always about
    // something happening right now, so it has nothing to add to a past
    // day the manager might currently be reviewing.
    socket.off('new_order').on('new_order', (order) => {
      if (currentDate !== todayISO()) return;
      if (currentOrders.some((o) => o.id === order.id)) return; // already have it
      currentOrders.unshift(order);
      renderOrdersTable();

      // Patch the two headline Overview numbers instantly off the same
      // event, rather than re-fetching /api/reports/daily — that round
      // trip was the source of the delay and the brief "No items ordered
      // on this day" empty-state flicker while it was in flight. The
      // other cards (Voided, Logged Revenue, Reconciled, Blocked
      // Attempts) are audit/reconciliation figures — deliberately left
      // untouched here rather than approximated, and simply catch up on
      // the next real loadOverview() (date change, refresh, or reopening
      // the Overview tab).
      if (lastOverviewReport) {
        const orderTotal = order.items.reduce((sum, it) => sum + lineTotal(it), 0);
        lastOverviewReport.summary.ordersPlaced += 1;
        lastOverviewReport.summary.liveRevenue += orderTotal;
        renderStatGrid(lastOverviewReport);
      }
    });

    socket.off('order_voided').on('order_voided', ({ orderId }) => {
      if (currentDate !== todayISO()) return;
      const order = currentOrders.find((o) => o.id === orderId);
      if (order) {
        order.status = 'VOIDED';
        order.isVoided = true;
        renderOrdersTable();
      }

      // Same instant-patch approach as new_order above — only when we
      // actually have this order's items on hand (it's today's order and
      // the Orders tab has already loaded it) do we know its revenue to
      // subtract; otherwise this is skipped and picked up by the next
      // real refresh rather than guessed at.
      if (lastOverviewReport && order) {
        const orderTotal = order.items.reduce((sum, it) => sum + lineTotal(it), 0);
        lastOverviewReport.summary.ordersVoided += 1;
        lastOverviewReport.summary.liveRevenue -= orderTotal;
        renderStatGrid(lastOverviewReport);
      }
    });

    socket.off('status_updated').on('status_updated', ({ orderId, kitchenStatus, barStatus, status }) => {
      if (currentDate !== todayISO()) return;
      const order = currentOrders.find((o) => o.id === orderId);
      if (!order) return;
      order.kitchenStatus = kitchenStatus;
      order.barStatus = barStatus;
      order.status = status;
      renderOrdersTable();
    });

    socket.on('connect_error', (err) => {
      console.error('Socket connection error:', err.message);
    });
  }

  // ---------------- Menu management ----------------
  async function loadMenuItemsAdmin() {
    try {
      menuItemsAdmin = await api('/api/menu-items');
      renderMenuItemsTable();
      rebuildItemCategoryMap();
      renderItemsTable(lastItemsOrdered); // re-apply category tags/filter now the map is fresh
    } catch (err) {
      showToast(err.message || 'Failed to load menu items', true);
    }
  }

  async function loadCategoriesFlat() {
    if (categoriesFlat.length > 0) return; // cached — categories rarely change mid-shift
    try {
      categoriesFlat = await api('/api/menu-items/categories');
    } catch (err) {
      showToast(err.message || 'Failed to load categories', true);
    }
  }

  function renderMenuItemsTable() {
    let filtered =
      menuCategoryFilter === 'all' ? menuItemsAdmin : menuItemsAdmin.filter((m) => categoryBucket(m) === menuCategoryFilter);

    if (menuSearchQuery) {
      filtered = filtered.filter(
        (m) => m.name.toLowerCase().includes(menuSearchQuery) || m.categoryPath.toLowerCase().includes(menuSearchQuery)
      );
    }

    if (filtered.length === 0) {
      const emptyMsg = menuSearchQuery
        ? `No items match "${escapeHtml(menuSearchInput.value.trim())}".`
        : menuCategoryFilter === 'all'
          ? 'No menu items yet — add one to get started.'
          : `No ${menuCategoryFilter === 'drinks' ? 'drink' : 'food'} items on the menu.`;
      menuItemsTable.innerHTML = `<table class="grid"><tbody><tr class="empty-row"><td>${emptyMsg}</td></tr></tbody></table>`;
      return;
    }

    // Units sold on the currently selected date (top of the dashboard) —
    // matched by name against the same report the Overview tab uses.
    const soldQtyByName = new Map((lastItemsOrdered || []).map((i) => [i.name, i.quantity]));
    if (menuTopSellersMode) {
      filtered = [...filtered].sort((a, b) => (soldQtyByName.get(b.name) || 0) - (soldQtyByName.get(a.name) || 0));
    }
    const RANK_MEDALS = ['🥇', '🥈', '🥉'];

    menuItemsTable.innerHTML = `
      <table class="grid">
        <thead><tr><th>${menuTopSellersMode ? '#' : ''}Item</th><th>Category</th>${menuTopSellersMode ? '<th>Sold</th>' : ''}<th>Price</th><th>Available</th><th>Top Item</th><th>Action</th></tr></thead>
        <tbody>
          ${filtered
            .map((m, idx) => {
              const rankHtml = menuTopSellersMode
                ? RANK_MEDALS[idx]
                  ? `<span class="rank-medal">${RANK_MEDALS[idx]}</span>`
                  : `<span class="rank-number">${idx + 1}.</span>`
                : '';
              const soldCell = menuTopSellersMode ? `<td class="mono-cell">${soldQtyByName.get(m.name) || 0}</td>` : '';
              const thumbHtml = m.imageUrl
                ? `<img src="${escapeHtmlAttr(m.imageUrl)}" alt="" style="width:28px;height:28px;object-fit:cover;border-radius:6px;vertical-align:middle;margin-right:8px;" />`
                : '';
              return `
            <tr>
              <td>${rankHtml}${thumbHtml}${escapeHtml(m.name)}</td>
              <td><span class="role-pill">${escapeHtml(m.categoryPath)}</span></td>
              ${soldCell}
              <td>
                <input type="number" step="0.01" min="0" class="menu-price-input" data-id="${m.id}" value="${m.price}" />
                <button class="small-btn price-save" data-id="${m.id}">Save</button>
              </td>
              <td>
                <button type="button" class="small-btn ${m.isAvailable ? 'toggle-on' : 'toggle-off'} availability-btn" data-id="${m.id}" data-available="${m.isAvailable}">
                  ${m.isAvailable ? '● Available' : '● Removed'}
                </button>
              </td>
              <td>
                <button type="button" class="small-btn ${m.isFeatured ? 'toggle-on' : 'toggle-off'} featured-btn" data-id="${m.id}" data-featured="${m.isFeatured}" title="Show this item in the waiters' Top Items shortcut">
                  ${m.isFeatured ? '⭐ Top Item' : '☆ Mark as Top'}
                </button>
              </td>
              <td>
                <button class="small-btn edit-menu-item" data-id="${m.id}">Edit</button>
                <button class="small-btn void delete-menu-item" data-id="${m.id}">Delete</button>
              </td>
            </tr>`;
            })
            .join('')}
        </tbody>
      </table>`;

    menuItemsTable.querySelectorAll('.featured-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const currentlyFeatured = btn.dataset.featured === 'true';
        try {
          await api(`/api/menu-items/${id}`, { method: 'PATCH', body: JSON.stringify({ isFeatured: !currentlyFeatured }) });
          loadMenuItemsAdmin();
        } catch (err) {
          showToast(err.message || 'Failed to update', true);
        }
      });
    });

    menuItemsTable.querySelectorAll('.price-save').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const input = menuItemsTable.querySelector(`.menu-price-input[data-id="${id}"]`);
        if (!input) return;
        const val = Number(input.value);
        if (Number.isNaN(val) || val < 0) {
          showToast('Enter a valid price', true);
          return;
        }
        try {
          await api(`/api/menu-items/${id}`, { method: 'PATCH', body: JSON.stringify({ price: val }) });
          showToast('Price updated');
          loadMenuItemsAdmin();
        } catch (err) {
          showToast(err.message || 'Failed to update price', true);
        }
      });
    });

    menuItemsTable.querySelectorAll('.availability-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const currentlyAvailable = btn.dataset.available === 'true';
        try {
          await api(`/api/menu-items/${id}`, { method: 'PATCH', body: JSON.stringify({ isAvailable: !currentlyAvailable }) });
          loadMenuItemsAdmin();
        } catch (err) {
          showToast(err.message || 'Failed to update availability', true);
        }
      });
    });

    menuItemsTable.querySelectorAll('.edit-menu-item').forEach((btn) => {
      btn.addEventListener('click', () => openMenuItemModal(btn.dataset.id));
    });

    menuItemsTable.querySelectorAll('.delete-menu-item').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const item = menuItemsAdmin.find((m) => m.id === id);
        if (!item) return;
        if (!confirm(`Delete "${item.name}" completely? If it has past orders, use "Removed" instead — this will tell you if that's the case.`)) return;
        try {
          await api(`/api/menu-items/${id}`, { method: 'DELETE' });
          loadMenuItemsAdmin();
        } catch (err) {
          showToast(err.message || 'Failed to delete menu item', true);
        }
      });
    });
  }

  function addExtraRow(name, price) {
    const rowId = `extra_${extraRowSeq++}`;
    const row = document.createElement('div');
    row.className = 'extra-row';
    row.dataset.rowId = rowId;
    row.innerHTML = `
      <input type="text" placeholder="Extra name" class="extra-name-input" value="${name ? escapeHtmlAttr(name) : ''}" />
      <input type="number" placeholder="Price" step="0.01" min="0" class="extra-price-input" value="${price !== undefined ? price : ''}" />
      <button type="button" class="remove-extra-btn" title="Remove">✕</button>
    `;
    row.querySelector('.remove-extra-btn').addEventListener('click', () => row.remove());
    menuItemExtrasList.appendChild(row);
  }

  function escapeHtmlAttr(str) {
    return String(str).replace(/"/g, '&quot;');
  }

  addExtraRowBtn.addEventListener('click', () => addExtraRow());

  menuItemImageUrlInput.addEventListener('input', () => {
    const val = menuItemImageUrlInput.value.trim();
    if (val) {
      menuItemImagePreview.src = val;
      menuItemImagePreview.style.display = 'block';
    } else {
      menuItemImagePreview.src = '';
      menuItemImagePreview.style.display = 'none';
    }
  });
  menuItemImagePreview.addEventListener('error', () => {
    menuItemImagePreview.style.display = 'none';
  });

  function collectExtraRows() {
    return Array.from(menuItemExtrasList.querySelectorAll('.extra-row'))
      .map((row) => ({
        name: row.querySelector('.extra-name-input').value.trim(),
        price: row.querySelector('.extra-price-input').value,
      }))
      .filter((e) => e.name !== ''); // skip rows the manager left blank
  }

  async function openMenuItemModal(id) {
    editingMenuItemId = id || null;
    menuItemError.textContent = '';
    menuItemForm.reset();
    menuItemExtrasList.innerHTML = '';

    await loadCategoriesFlat();
    menuItemCategorySelect.innerHTML = categoriesFlat.map((c) => `<option value="${c.id}">${escapeHtml(c.path)}</option>`).join('');

    menuItemImageUrlInput.value = '';
    menuItemImagePreview.src = '';
    menuItemImagePreview.style.display = 'none';

    if (editingMenuItemId) {
      const item = menuItemsAdmin.find((m) => m.id === editingMenuItemId);
      if (!item) return;
      menuItemModalTitle.textContent = 'Edit Menu Item';
      menuItemSubmitBtn.textContent = 'Save Changes';
      document.getElementById('menuItemName').value = item.name;
      menuItemCategorySelect.value = item.categoryId;
      document.getElementById('menuItemPrice').value = item.price;
      if (item.imageUrl) {
        menuItemImageUrlInput.value = item.imageUrl;
        menuItemImagePreview.src = item.imageUrl;
        menuItemImagePreview.style.display = 'block';
      }
      document.getElementById('menuItemAvailable').checked = item.isAvailable;
      document.getElementById('menuItemFeatured').checked = item.isFeatured;
      menuItemHasTempCheckbox.checked = item.hasTemperatureOption;
      document.querySelectorAll('.temp-opt').forEach((cb) => {
        cb.checked = Array.isArray(item.temperatureOptions) && item.temperatureOptions.includes(cb.value);
      });
      document.getElementById('menuItemIngredients').value = Array.isArray(item.customizableIngredients)
        ? item.customizableIngredients.join(', ')
        : '';
      const extras = Array.isArray(item.extraOptions) ? item.extraOptions : [];
      extras.forEach((e) => addExtraRow(e.name, e.price));
    } else {
      menuItemModalTitle.textContent = 'Add Menu Item';
      menuItemSubmitBtn.textContent = 'Add Item';
      document.getElementById('menuItemAvailable').checked = true;
      document.getElementById('menuItemFeatured').checked = false;
      document.querySelectorAll('.temp-opt').forEach((cb) => (cb.checked = false));
    }

    menuItemModal.classList.remove('hidden');
  }

  addMenuItemBtn.addEventListener('click', () => openMenuItemModal(null));
  menuItemCancelBtn.addEventListener('click', () => menuItemModal.classList.add('hidden'));

  menuItemForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    menuItemError.textContent = '';

    const name = document.getElementById('menuItemName').value.trim();
    const categoryId = menuItemCategorySelect.value;
    const price = Number(document.getElementById('menuItemPrice').value);
    const imageUrl = menuItemImageUrlInput.value.trim() || null;
    const isAvailable = document.getElementById('menuItemAvailable').checked;
    const isFeatured = document.getElementById('menuItemFeatured').checked;
    const hasTemperatureOption = menuItemHasTempCheckbox.checked;
    const temperatureOptions = Array.from(document.querySelectorAll('.temp-opt:checked')).map((cb) => cb.value);
    const customizableIngredients = document
      .getElementById('menuItemIngredients')
      .value.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const extraOptions = collectExtraRows();

    if (!name) {
      menuItemError.textContent = 'Item name is required';
      return;
    }
    if (!categoryId) {
      menuItemError.textContent = 'Pick a category';
      return;
    }
    if (Number.isNaN(price) || price < 0) {
      menuItemError.textContent = 'Enter a valid price';
      return;
    }
    if (hasTemperatureOption && temperatureOptions.length === 0) {
      menuItemError.textContent = 'Pick at least one temperature option, or uncheck "Offers a temperature choice"';
      return;
    }

    const payload = {
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
    };

    try {
      if (editingMenuItemId) {
        await api(`/api/menu-items/${editingMenuItemId}`, { method: 'PATCH', body: JSON.stringify(payload) });
        showToast('Menu item updated');
      } else {
        await api('/api/menu-items', { method: 'POST', body: JSON.stringify(payload) });
        showToast('Menu item added');
      }
      menuItemModal.classList.add('hidden');
      loadMenuItemsAdmin();
    } catch (err) {
      menuItemError.textContent = err.message || 'Failed to save menu item';
    }
  });

  // ---------------- Boot ----------------
  async function boot() {
    showApp();
    dateInput.value = currentDate;
    connectSocket();
    loadStock();
    loadMenuItemsAdmin(); // also builds the category maps the Items panel needs
    await Promise.all([loadOverview(), loadOrders(), loadItemsPanel()]);
  }

  if (token && user) {
    boot().catch((err) => {
      console.error('Boot failed, clearing session:', err);
      localStorage.removeItem('kds_admin_token');
      localStorage.removeItem('kds_admin_user');
      loginScreen.classList.remove('hidden');
      appScreen.classList.add('hidden');
    });
  }
})();
