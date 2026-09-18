(function () {
  let token = localStorage.getItem('kds_cashier_token') || null;
  let user = JSON.parse(localStorage.getItem('kds_cashier_user') || 'null');
  let socket = null;

  let unpaidOrders = []; // flat list from GET /api/payments/unpaid
  let selectedOrderId = null; // which order's bill is currently open in the modal

  // ---------------- DOM refs ----------------
  const loginScreen = document.getElementById('loginScreen');
  const appScreen = document.getElementById('appScreen');
  const loginForm = document.getElementById('loginForm');
  const loginError = document.getElementById('loginError');
  const logoutBtn = document.getElementById('logoutBtn');
  const refreshBtn = document.getElementById('refreshBtn');
  const dateDisplay = document.getElementById('dateDisplay');
  const headerDateInput = document.getElementById('headerDateInput');

  const toggleBtns = document.querySelectorAll('.toggle-btn');
  const billsView = document.getElementById('billsView');
  const historyView = document.getElementById('historyView');

  const tablesGrid = document.getElementById('tablesGrid');
  const historyList = document.getElementById('historyList');
  const historyDateInput = document.getElementById('historyDateInput');

  const billModal = document.getElementById('billModal');
  const billModalTitle = document.getElementById('billModalTitle');
  const billBody = document.getElementById('billBody');
  const billCloseBtn = document.getElementById('billCloseBtn');
  const paymentMethodGrid = document.getElementById('paymentMethodGrid');
  let selectedPaymentMethod = 'CASH';
  const payError = document.getElementById('payError');
  const markPaidBtn = document.getElementById('markPaidBtn');
  const paymentScreenshotInput = document.getElementById('paymentScreenshotInput');
  const screenshotPreviewWrap = document.getElementById('screenshotPreviewWrap');
  const screenshotPreview = document.getElementById('screenshotPreview');
  const removeScreenshotBtn = document.getElementById('removeScreenshotBtn');

  const screenshotLightbox = document.getElementById('screenshotLightbox');
  const lightboxImage = document.getElementById('lightboxImage');
  const lightboxFallback = document.getElementById('lightboxFallback');
  const lightboxCloseBtn = document.getElementById('lightboxCloseBtn');

  const receiptPrintArea = document.getElementById('receiptPrintArea');

  // ---------------- Helpers ----------------
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  function lineTotal(item) {
    const extras = Array.isArray(item.selectedExtras) ? item.selectedExtras : [];
    const extrasSum = extras.reduce((s, e) => s + Number(e.price || 0), 0);
    return (Number(item.unitPrice) + extrasSum) * item.quantity;
  }

  const TEMPERATURE_LABELS = { HOT: 'Hot', COLD: 'Cold', NORMAL: 'Normal', NORMAL_WITH_ICE: 'Normal + Ice' };

  function customizationSummary(item) {
    const parts = [];
    if (item.temperature) parts.push(TEMPERATURE_LABELS[item.temperature] || item.temperature);
    if (item.removedIngredients && item.removedIngredients.length > 0) parts.push(`no ${item.removedIngredients.join(', ')}`);
    if (item.selectedExtras && item.selectedExtras.length > 0) parts.push(`+${item.selectedExtras.map((e) => e.name).join(', ')}`);
    return parts.join(' · ');
  }

  function orderTotal(order) {
    return order.items.reduce((s, i) => s + lineTotal(i), 0);
  }

  let toastTimer = null;
  function showToast(message, isError) {
    let toast = document.getElementById('toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toast';
      toast.className = 'toast hidden';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.toggle('error', Boolean(isError));
    toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.add('hidden'), 3000);
  }

  async function api(path, options = {}) {
    const isFormData = options.body instanceof FormData;
    const res = await fetch(path, {
      ...options,
      headers: {
        ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
    });
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  function showApp() {
    loginScreen.classList.add('hidden');
    appScreen.classList.remove('hidden');
  }
  function showLogin() {
    appScreen.classList.add('hidden');
    loginScreen.classList.remove('hidden');
  }

  // ---------------- Auth ----------------
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.textContent = '';
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    try {
      const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      if (data.user.role !== 'CASHIER' && data.user.role !== 'MANAGER') {
        loginError.textContent = 'This account is not a cashier or manager account.';
        return;
      }
      token = data.token;
      user = data.user;
      localStorage.setItem('kds_cashier_token', token);
      localStorage.setItem('kds_cashier_user', JSON.stringify(user));
      boot();
    } catch (err) {
      loginError.textContent = err.message || 'Login failed';
    }
  });

  logoutBtn.addEventListener('click', () => {
    token = null;
    user = null;
    localStorage.removeItem('kds_cashier_token');
    localStorage.removeItem('kds_cashier_user');
    showLogin();
  });

  refreshBtn.addEventListener('click', () => {
    loadUnpaidOrders();
    if (!historyView.classList.contains('hidden')) loadHistory();
  });

  // ---------------- Header date filter ----------------
  // One date picker in the header drives both tabs: Open Bills (cumulative
  // — every unpaid bill on or before this date) and Payment History (that
  // specific day's paid orders). Keeps historyDateInput in sync so the
  // History tab's own picker reflects the same date without needing a
  // second, separate selection.
  headerDateInput.addEventListener('change', () => {
    historyDateInput.value = headerDateInput.value;
    loadUnpaidOrders();
    if (!historyView.classList.contains('hidden')) loadHistory();
  });

  // ---------------- Tabs ----------------
  toggleBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      toggleBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const view = btn.dataset.view;
      billsView.classList.toggle('hidden', view !== 'bills');
      historyView.classList.toggle('hidden', view !== 'history');
      if (view === 'bills') loadUnpaidOrders();
      if (view === 'history') loadHistory();
    });
  });

  // ---------------- Open Bills ----------------
  async function loadUnpaidOrders() {
    try {
      const date = headerDateInput.value || todayISO();
      unpaidOrders = await api(`/api/payments/unpaid?date=${date}`);
      renderTablesGrid();
    } catch (err) {
      showToast(err.message || 'Failed to load open bills', true);
    }
  }

  function renderTablesGrid() {
    if (unpaidOrders.length === 0) {
      tablesGrid.innerHTML = '<div class="empty-state">No completed orders waiting on payment right now.</div>';
      return;
    }

    // Oldest first, so a waiter's earliest still-unpaid customer surfaces first.
    const sorted = [...unpaidOrders].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    tablesGrid.innerHTML = sorted
      .map((o) => {
        const total = orderTotal(o);
        return `
        <div class="table-bill-card" data-order-id="${o.id}">
          <div class="table-label">#${o.id.slice(0, 6).toUpperCase()}</div>
          <div class="ticket-count">Table ${escapeHtml(o.table.label)} · ${escapeHtml(o.waiter.name)}</div>
          <div class="bill-total mono">$${total.toFixed(2)}</div>
          <div class="view-bill-hint">Tap to view & pay →</div>
        </div>`;
      })
      .join('');

    tablesGrid.querySelectorAll('.table-bill-card').forEach((card) => {
      card.addEventListener('click', () => openBillModal(card.dataset.orderId));
    });
  }

  // ---------------- Screenshot preview ----------------
  paymentScreenshotInput.addEventListener('change', () => {
    const file = paymentScreenshotInput.files[0];
    if (!file) {
      screenshotPreviewWrap.classList.add('hidden');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      screenshotPreview.src = reader.result;
      screenshotPreviewWrap.classList.remove('hidden');
    };
    reader.readAsDataURL(file);
  });

  removeScreenshotBtn.addEventListener('click', () => {
    paymentScreenshotInput.value = '';
    screenshotPreviewWrap.classList.add('hidden');
  });

  // ---------------- Payment method tiles ----------------
  paymentMethodGrid.addEventListener('click', (e) => {
    const tile = e.target.closest('.payment-tile');
    if (!tile) return;
    selectedPaymentMethod = tile.dataset.method;
    paymentMethodGrid.querySelectorAll('.payment-tile').forEach((t) => {
      t.classList.toggle('active', t === tile);
    });
  });

  function resetPaymentForm() {
    selectedPaymentMethod = 'CASH';
    paymentMethodGrid.querySelectorAll('.payment-tile').forEach((t) => {
      t.classList.toggle('active', t.dataset.method === 'CASH');
    });
    paymentScreenshotInput.value = '';
    screenshotPreviewWrap.classList.add('hidden');
    payError.textContent = '';
  }

  // ---------------- Bill detail + payment ----------------
  function openBillModal(orderId) {
    selectedOrderId = orderId;
    resetPaymentForm();

    const order = unpaidOrders.find((o) => o.id === orderId);
    if (!order) return;

    billModalTitle.textContent = `Order #${order.id.slice(0, 6).toUpperCase()}`;

    const total = orderTotal(order);

    billBody.innerHTML = `
        <div class="bill-ticket-group">
          <div class="bill-ticket-header">
            <span>Table ${escapeHtml(order.table.label)} · ${escapeHtml(order.waiter.name)}</span>
            <span>${new Date(order.createdAt).toLocaleTimeString()}</span>
          </div>
          ${order.items
            .map((it) => {
              const summary = customizationSummary(it);
              return `
              <div class="bill-item-row">
                <span>${it.quantity}× ${escapeHtml(it.menuItem.name)}${summary ? `<br/><span class="bill-item-custom">${escapeHtml(summary)}</span>` : ''}</span>
                <span class="mono">$${lineTotal(it).toFixed(2)}</span>
              </div>`;
            })
            .join('')}
        </div>
        <div class="bill-total-row"><span>Total</span><span class="mono">$${total.toFixed(2)}</span></div>`;

    billModal.classList.remove('hidden');
  }

  billCloseBtn.addEventListener('click', () => billModal.classList.add('hidden'));
  billModal.addEventListener('click', (e) => {
    if (e.target === billModal) billModal.classList.add('hidden');
  });

  markPaidBtn.addEventListener('click', async () => {
    payError.textContent = '';
    const order = unpaidOrders.find((o) => o.id === selectedOrderId);
    if (!order) return;

    const orderIds = [order.id];
    const paymentMethod = selectedPaymentMethod;

    const formData = new FormData();
    formData.append('orderIds', JSON.stringify(orderIds));
    formData.append('paymentMethod', paymentMethod);
    const file = paymentScreenshotInput.files[0];
    if (file) formData.append('screenshot', file);

    markPaidBtn.disabled = true;
    markPaidBtn.textContent = 'Processing…';

    try {
      const paidOrders = await api('/api/payments', { method: 'POST', body: formData });
      billModal.classList.add('hidden');
      showToast('Payment recorded');
      printReceipt(paidOrders, paymentMethod);
      loadUnpaidOrders();
    } catch (err) {
      payError.textContent = err.message || 'Failed to record payment';
    } finally {
      markPaidBtn.disabled = false;
      markPaidBtn.textContent = 'Mark Paid & Print Receipt';
    }
  });

  // ---------------- Receipt printing ----------------
  const METHOD_LABELS = {
    CASH: 'Cash',
    CARD: 'Card',
    TELEBIRR: 'Telebirr',
    CBE: 'CBE',
    BOA: 'BOA',
    MOBILE_MONEY: 'Mobile Money',
  };

  function printReceipt(orders, paymentMethod) {
    const total = orders.reduce((s, o) => s + orderTotal(o), 0);
    const methodLabel = METHOD_LABELS[paymentMethod] || paymentMethod;
    const tableLabel = orders[0].table.label;
    const cashierName = (user && user.name) || 'Cashier';
    const now = new Date();

    const itemsHtml = orders
      .map(
        (o) => `
        <div class="receipt-line receipt-order-header"><span>Order #${o.id.slice(0, 6).toUpperCase()}</span><span>Waiter: ${escapeHtml(o.waiter.name)}</span></div>
        ${o.items
          .map(
            (it) => `
        <div class="receipt-line"><span>${it.quantity}× ${escapeHtml(it.menuItem.name)}</span><span>$${lineTotal(it).toFixed(2)}</span></div>`
          )
          .join('')}
        <div class="receipt-divider"></div>`
      )
      .join('');

    const hasScreenshot = orders.some((o) => o.paymentScreenshotUrl);

    receiptPrintArea.innerHTML = `
      <div class="receipt-center">
        <div><strong>RECEIPT</strong></div>
        <div>Table ${escapeHtml(tableLabel)}</div>
        <div>${now.toLocaleString()}</div>
      </div>
      <div class="receipt-divider"></div>
      ${itemsHtml}
      <div class="receipt-line receipt-total"><span>TOTAL</span><span>$${total.toFixed(2)}</span></div>
      <div class="receipt-line"><span>Payment</span><span>${escapeHtml(methodLabel)}</span></div>
      <div class="receipt-line"><span>Cashier</span><span>${escapeHtml(cashierName)}</span></div>
      ${hasScreenshot ? '<div class="receipt-line"><span>Proof</span><span>Screenshot on file</span></div>' : ''}
      <div class="receipt-divider"></div>
      <div class="receipt-center">Thank you!</div>
    `;

    window.print();
  }

  // ---------------- Payment History ----------------
  historyDateInput.addEventListener('change', () => {
    headerDateInput.value = historyDateInput.value;
    loadHistory();
  });

  async function loadHistory() {
    const date = historyDateInput.value || todayISO();
    try {
      const paid = await api(`/api/payments/history?date=${date}`);
      renderHistory(paid);
    } catch (err) {
      showToast(err.message || 'Failed to load payment history', true);
    }
  }

  function renderHistory(paid) {
    if (paid.length === 0) {
      historyList.innerHTML = '<div class="history-empty">No payments recorded on this day.</div>';
      return;
    }

    // Fixed grid: 5 columns, always present, so a row without a
    // screenshot (View button) never shifts Reprint (or anything else)
    // out of alignment with the rows around it — see .history-row in
    // cashier.css for the actual column widths.
    historyList.innerHTML = paid
      .map((o) => {
        const total = orderTotal(o);
        const hasScreenshot = Boolean(o.paymentScreenshotUrl);
        return `
        <div class="history-row" data-id="${o.id}">
          <div class="info">
            <span class="ticket-line">#${o.id.slice(0, 6).toUpperCase()} · Table ${escapeHtml(o.table.label)}</span>
            <span class="meta-line">${escapeHtml(o.waiter.name)} · paid by ${escapeHtml((o.cashier && o.cashier.name) || '—')} · ${new Date(o.paidAt).toLocaleTimeString()}</span>
          </div>
          <div class="method-cell">
            <span class="method-tag">${METHOD_LABELS[o.paymentMethod] || o.paymentMethod}</span>
          </div>
          <div class="amount-cell">
            <span class="amount mono">$${total.toFixed(2)}</span>
          </div>
          <div class="view-cell">
            <button type="button" class="small-btn view-screenshot" data-url="${escapeHtml(o.paymentScreenshotUrl || '')}" ${hasScreenshot ? '' : 'disabled style="visibility:hidden"'}>📷 View</button>
          </div>
          <div class="reprint-cell">
            <button type="button" class="small-btn reprint" data-id="${o.id}">🖨 Reprint</button>
          </div>
        </div>`;
      })
      .join('');

    historyList.querySelectorAll('.reprint').forEach((btn) => {
      btn.addEventListener('click', () => {
        const order = paid.find((o) => o.id === btn.dataset.id);
        if (order) printReceipt([order], order.paymentMethod);
      });
    });

    historyList.querySelectorAll('.view-screenshot').forEach((btn) => {
      btn.addEventListener('click', () => openLightbox(btn.dataset.url));
    });
  }

  function openLightbox(url) {
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

  // ---------------- Socket ----------------
  // Notifies the cashier the moment a table's order is fully done across
  // every station it needed (see orderController.js's updateOrderStatus
  // -> table_ready_for_checkout) — Open Bills refreshes itself instantly
  // instead of waiting for a manual refresh or the next visit to this tab.
  function connectSocket() {
    socket = io({ auth: { token } });

    socket.on('table_ready_for_checkout', ({ tableLabel }) => {
      showToast(`Table ${tableLabel} is ready for checkout`);
      loadUnpaidOrders();
    });

    socket.on('connect_error', (err) => {
      console.error('Socket connection error:', err.message);
    });
  }

  // ---------------- Boot ----------------
  async function boot() {
    showApp();
    dateDisplay.textContent = new Date().toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
    headerDateInput.value = todayISO();
    historyDateInput.value = todayISO();
    connectSocket();
    await loadUnpaidOrders();
  }

  if (token && user) {
    boot().catch((err) => {
      console.error('Boot failed, clearing session:', err);
      localStorage.removeItem('kds_cashier_token');
      localStorage.removeItem('kds_cashier_user');
      showLogin();
    });
  } else {
    showLogin();
  }
})();
