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
  const orderView = document.getElementById('orderView');
  const billsView = document.getElementById('billsView');
  const historyView = document.getElementById('historyView');
  const readyStrip = document.getElementById('readyStrip');

  let orderEntry = null; // New Order tab, mounted from order-entry.js in boot()

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
    // Signed out (e.g. an expired login mid-request) — the sign-in screen's
    // own message says what happened; a stray "Unauthorized" toast over it
    // would only confuse.
    if (!token) return;
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
    // A 401 on anything but the login request itself means this screen's
    // login has expired (tokens last 12h — see authController.js).
    if (res.status === 401 && path !== '/api/auth/login') sessionExpired();
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  // ---------------- Session expiry + connection warning ----------------
  // Same fix as the Chef/Barista displays: before this, an expired login
  // failed silently — the socket's reconnect was rejected, so the cashier
  // stopped getting "ready" alerts and couldn't send orders, with nothing
  // on screen saying why. Now it drops back to the sign-in screen and
  // says so. Nothing is reloaded, so a half-entered order is still there
  // after signing back in.
  function sessionExpired() {
    if (!token) return; // already handled
    token = null;
    user = null;
    localStorage.removeItem('kds_cashier_token');
    localStorage.removeItem('kds_cashier_user');
    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
      socket = null;
    }
    setConnectionWarning(false);
    showLogin();
    loginError.textContent = 'Your login expired — sign in again to keep taking orders.';
  }

  // Red banner while the live connection is down — "ready" alerts can't
  // arrive, so the cashier would otherwise never hear about finished food.
  let connectionBanner = null;
  function setConnectionWarning(show) {
    if (!connectionBanner) {
      connectionBanner = document.createElement('div');
      connectionBanner.className = 'connection-banner hidden';
      connectionBanner.textContent = '⚠ Connection lost — "ready" alerts may not appear. Check the Wi-Fi.';
      document.body.appendChild(connectionBanner);
    }
    connectionBanner.classList.toggle('hidden', !show);
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
    if (orderEntry) orderEntry.refresh();
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
      orderView.classList.toggle('hidden', view !== 'order');
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

  // ---------------- Payment proof (uploaded screenshot or camera photo) ----------------
  // One slot for the proof image, whichever way it was taken — this is
  // what gets sent as `screenshot` with the payment.
  let proofFile = null;

  function setProof(file) {
    proofFile = file || null;
    if (screenshotPreview.src.startsWith('blob:')) URL.revokeObjectURL(screenshotPreview.src);
    if (!proofFile) {
      screenshotPreview.removeAttribute('src');
      screenshotPreviewWrap.classList.add('hidden');
      return;
    }
    screenshotPreview.src = URL.createObjectURL(proofFile);
    screenshotPreviewWrap.classList.remove('hidden');
  }

  const cameraFallbackInput = document.getElementById('cameraFallbackInput');
  document.getElementById('uploadScreenshotBtn').addEventListener('click', () => paymentScreenshotInput.click());
  paymentScreenshotInput.addEventListener('change', () => {
    setProof(paymentScreenshotInput.files[0]);
    paymentScreenshotInput.value = ''; // so picking the same file again still fires 'change'
  });
  cameraFallbackInput.addEventListener('change', () => {
    setProof(cameraFallbackInput.files[0]);
    cameraFallbackInput.value = '';
  });

  removeScreenshotBtn.addEventListener('click', () => setProof(null));

  // ---------------- Camera ----------------
  // Live camera in the page (laptop webcam, USB camera, or a tablet's
  // back camera). Needs HTTPS or localhost — Railway serves HTTPS. If the
  // browser has no live-camera support, falls back to the phone's camera
  // app via <input capture>.
  const cameraModal = document.getElementById('cameraModal');
  const cameraVideo = document.getElementById('cameraVideo');
  const cameraStill = document.getElementById('cameraStill');
  const cameraError = document.getElementById('cameraError');
  const cameraSwitchBtn = document.getElementById('cameraSwitchBtn');
  const cameraCaptureBtn = document.getElementById('cameraCaptureBtn');
  const cameraRetakeBtn = document.getElementById('cameraRetakeBtn');
  const cameraUseBtn = document.getElementById('cameraUseBtn');
  let cameraStream = null;
  let cameraFacing = 'environment'; // back camera first on phones/tablets
  let capturedBlob = null;

  function stopCamera() {
    if (cameraStream) cameraStream.getTracks().forEach((t) => t.stop());
    cameraStream = null;
    cameraVideo.srcObject = null;
  }

  function showCameraLive() {
    capturedBlob = null;
    if (cameraStill.src) URL.revokeObjectURL(cameraStill.src);
    cameraStill.classList.add('hidden');
    cameraVideo.classList.remove('hidden');
    cameraCaptureBtn.classList.remove('hidden');
    cameraRetakeBtn.classList.add('hidden');
    cameraUseBtn.classList.add('hidden');
  }

  async function startCamera() {
    stopCamera();
    cameraError.textContent = '';
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: cameraFacing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      cameraVideo.srcObject = cameraStream;
      const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      cameraSwitchBtn.classList.toggle('hidden', cams.length < 2);
    } catch (err) {
      console.error('Camera error:', err);
      cameraError.textContent = err.name === 'NotAllowedError'
        ? 'Camera access was blocked. Click the camera icon in the address bar and choose "Allow", then try again.'
        : err.name === 'NotFoundError'
          ? 'No camera found on this device. Use "Upload Screenshot" instead.'
          : `Couldn't start the camera (${err.message || err.name}).`;
      cameraCaptureBtn.classList.add('hidden');
    }
  }

  document.getElementById('takePhotoBtn').addEventListener('click', () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      cameraFallbackInput.click();
      return;
    }
    showCameraLive();
    cameraModal.classList.remove('hidden');
    startCamera();
  });

  cameraSwitchBtn.addEventListener('click', () => {
    cameraFacing = cameraFacing === 'environment' ? 'user' : 'environment';
    showCameraLive();
    startCamera();
  });

  cameraCaptureBtn.addEventListener('click', () => {
    if (!cameraVideo.videoWidth) return; // camera not ready yet
    const canvas = document.createElement('canvas');
    canvas.width = cameraVideo.videoWidth;
    canvas.height = cameraVideo.videoHeight;
    canvas.getContext('2d').drawImage(cameraVideo, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      capturedBlob = blob;
      cameraStill.src = URL.createObjectURL(blob);
      cameraStill.classList.remove('hidden');
      cameraVideo.classList.add('hidden');
      cameraCaptureBtn.classList.add('hidden');
      cameraRetakeBtn.classList.remove('hidden');
      cameraUseBtn.classList.remove('hidden');
    }, 'image/jpeg', 0.85);
  });

  cameraRetakeBtn.addEventListener('click', showCameraLive);

  function closeCamera() {
    stopCamera();
    cameraModal.classList.add('hidden');
  }

  cameraUseBtn.addEventListener('click', () => {
    if (!capturedBlob) return;
    setProof(new File([capturedBlob], `payment-photo-${Date.now()}.jpg`, { type: 'image/jpeg' }));
    closeCamera();
  });
  document.getElementById('cameraCloseBtn').addEventListener('click', closeCamera);
  cameraModal.addEventListener('click', (e) => {
    if (e.target === cameraModal) closeCamera();
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
    setProof(null);
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
    if (proofFile) formData.append('screenshot', proofFile);

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

  // ---------------- Ready for pickup ----------------
  let readyItems = []; // [{ key, label, tableLabel, waiterName, time }]
  let audioCtx = null;

  // Peak volume of the new-order / ready chime (0–1). Was 0.22 — raised
  // so it's heard over a busy kitchen/counter. Lower this if it's too much.
  const CHIME_VOLUME = 0.9;

  // Web Audio chime, same approach as the waiter screen — no sound file
  // to go missing. Browsers only allow audio after a click on the page,
  // which the cashier will have made long before the first ready event.
  function playReadyChime() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const now = audioCtx.currentTime;
      // Louder than the original soft sine "ding": triangle wave (carries
      // better over kitchen noise), ~4x the volume, longer notes, and the
      // pattern plays twice. The compressor acts as a limiter so the
      // overlapping notes get loud without crackling/distorting.
      const limiter = audioCtx.createDynamicsCompressor();
      limiter.threshold.value = -6;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.1;
      limiter.connect(audioCtx.destination);
      const notes = [660, 880, 990]; // three rising notes — a distinct "ready!" sound;
      [0, 0.75].forEach((repeatAt) => {
        notes.forEach((freq, i) => {
          const start = now + repeatAt + i * 0.18;
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.type = 'triangle';
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0.0001, start);
          gain.gain.exponentialRampToValueAtTime(CHIME_VOLUME, start + 0.015);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.5);
          osc.connect(gain).connect(limiter);
          osc.start(start);
          osc.stop(start + 0.52);
        });
      });
    } catch (e) {
      // Web Audio unavailable — the ready strip still shows
    }
  }

  function addReady(entry) {
    // A socket reconnect can replay an event — don't list it twice
    if (readyItems.some((r) => r.key === entry.key)) return;
    readyItems.push({ ...entry, time: new Date() });
    playReadyChime();
    renderReadyStrip();
  }

  function renderReadyStrip() {
    readyStrip.classList.toggle('hidden', readyItems.length === 0);
    readyStrip.innerHTML = readyItems
      .map(
        (r) => `
        <div class="ready-chip">
          <span class="ready-label">${escapeHtml(r.label)}</span>
          <span class="ready-table mono">Table ${escapeHtml(r.tableLabel)}</span>
          <span class="ready-waiter">tell ${escapeHtml(r.waiterName)}</span>
          <span class="ready-time">${r.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          <button type="button" class="ready-dismiss" data-key="${escapeHtml(r.key)}" aria-label="Done — waitress told" title="Done — waitress told">✕</button>
        </div>`
      )
      .join('');
    readyStrip.querySelectorAll('.ready-dismiss').forEach((btn) => {
      btn.addEventListener('click', () => {
        readyItems = readyItems.filter((r) => r.key !== btn.dataset.key);
        renderReadyStrip();
      });
    });
  }

  // ---------------- Socket ----------------
  // Notifies the cashier the moment a table's order is fully done across
  // every station it needed (see orderController.js's updateOrderStatus
  // -> table_ready_for_checkout) — Open Bills refreshes itself instantly
  // instead of waiting for a manual refresh or the next visit to this tab.
  //
  // The waitresses take orders on paper and have no screen of their own,
  // so every "ready" event also lands in the ready strip (with a chime)
  // and stays there until the cashier has told the waitress and taps ✕ —
  // a 3-second toast alone is too easy to miss at a busy counter.
  function connectSocket() {
    if (socket) {
      // A re-login after sessionExpired()/logout — never run two at once
      socket.removeAllListeners();
      socket.disconnect();
    }
    socket = io({ auth: { token } });

    // A brief blip reconnects on its own; while it's down, say so. Any
    // order that finished in the meantime is picked up by reloading the
    // open bills on reconnect.
    let wasDisconnected = false;
    socket.on('disconnect', (reason) => {
      wasDisconnected = true;
      setConnectionWarning(true);
      // The server cut this screen off on purpose (e.g. the account was
      // deactivated) — socket.io won't retry that by itself, so retry
      // once: a refused handshake then lands on the sign-in screen via
      // connect_error below.
      if (reason === 'io server disconnect') socket.connect();
    });
    socket.on('connect', () => {
      setConnectionWarning(false);
      if (wasDisconnected) {
        wasDisconnected = false;
        loadUnpaidOrders();
      }
    });

    socket.on('table_ready_for_checkout', ({ orderId, tableLabel, waiterName }) => {
      addReady({ key: `${orderId}:all`, label: '✅ Order ready', tableLabel, waiterName });
      showToast(`Table ${tableLabel} is ready for checkout`);
      loadUnpaidOrders();
    });

    // Paid at another cashier screen (or by a manager) — drop it from
    // Open Bills here too, and refresh history if that's on screen.
    socket.on('orders_paid', ({ orderIds }) => {
      // (markPaidBtn is disabled while THIS screen's own payment is in
      // flight — that one isn't "another screen".)
      const payingHere = markPaidBtn.disabled;
      if (!payingHere && selectedOrderId && orderIds.includes(selectedOrderId) && !billModal.classList.contains('hidden')) {
        billModal.classList.add('hidden');
        showToast('This bill was just paid on another screen');
      }
      loadUnpaidOrders();
      if (!historyView.classList.contains('hidden')) loadHistory();
    });

    // A manager voided an order — it's no longer a bill or a pickup
    socket.on('order_voided', ({ orderId }) => {
      readyItems = readyItems.filter((r) => !r.key.startsWith(`${orderId}:`));
      renderReadyStrip();
      loadUnpaidOrders();
    });

    // Price / availability / new item changed in the Manager Dashboard —
    // reload the New Order menu (a half-entered order is kept).
    socket.on('menu_changed', () => {
      if (orderEntry) orderEntry.refresh().catch(() => {});
    });

    // Only one station of a mixed food + drinks order is done — the
    // waitress can already carry that part out.
    socket.on('station_ready', ({ orderId, station, tableLabel, waiterName }) => {
      const label = station === 'kitchen' ? '🍽 Food ready' : '🥤 Drinks ready';
      addReady({ key: `${orderId}:${station}`, label, tableLabel, waiterName });
    });

    socket.on('connect_error', (err) => {
      console.error('Socket connection error:', err.message);
      if (err.message.startsWith('Unauthorized')) {
        sessionExpired();
        return;
      }
      setConnectionWarning(true);
    });
  }

  // ---------------- Boot ----------------
  async function boot() {
    showApp();
    dateDisplay.textContent = new Date().toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
    headerDateInput.value = todayISO();
    historyDateInput.value = todayISO();
    connectSocket();
    // Mounted once; on a later sign-in (e.g. after an expired login) its
    // waitress/table/menu lists are reloaded, since the first load may
    // have been rejected. A half-entered order is kept either way.
    if (!orderEntry) orderEntry = window.CashierOrderEntry({ api, showToast, escapeHtml, customizationSummary });
    else orderEntry.refresh().catch((err) => showToast(err.message || 'Failed to load the menu', true));
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
