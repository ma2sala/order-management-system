(function () {
  'use strict';

  const API = '';
  const WARNING_THRESHOLD_SEC = 5 * 60; // flag tickets sitting > 5 min

  let token = localStorage.getItem('kds_barista_token') || null;
  let user = JSON.parse(localStorage.getItem('kds_barista_user') || 'null');
  let socket = null;
  let audioCtx = null;
  let muted = false;

  let activeTickets = []; // orders from the server, shape from GET /api/orders
  let completedTickets = [];
  let flashIds = new Set();
  let view = 'active';

  // ---------------- DOM refs ----------------
  const loginScreen = document.getElementById('loginScreen');
  const appScreen = document.getElementById('appScreen');
  const loginForm = document.getElementById('loginForm');
  const loginError = document.getElementById('loginError');

  const pendingCountEl = document.getElementById('pendingCount');
  const progressCountEl = document.getElementById('progressCount');
  const muteBtn = document.getElementById('muteBtn');
  const completedDateInput = document.getElementById('completedDateInput');
  const historyBtn = document.getElementById('historyBtn');
  const logoutBtn = document.getElementById('logoutBtn');

  const toggleBtns = document.querySelectorAll('.toggle-btn');
  const activeView = document.getElementById('activeView');
  const completedView = document.getElementById('completedView');
  const activeTabCount = document.getElementById('activeTabCount');
  const completedTabCount = document.getElementById('completedTabCount');

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
      if (data.user.role !== 'BARISTA' && data.user.role !== 'MANAGER') {
        loginError.textContent = 'This screen is for barista or manager accounts.';
        return;
      }
      token = data.token;
      user = data.user;
      localStorage.setItem('kds_barista_token', token);
      localStorage.setItem('kds_barista_user', JSON.stringify(user));
      boot();
    } catch (err) {
      loginError.textContent = err.message || 'Login failed';
    }
  });

  function showApp() {
    loginScreen.classList.add('hidden');
    appScreen.classList.remove('hidden');
  }

  // ---------------- Audio chime (Web Audio, no external asset) ----------------
  function playChime() {
    if (muted) return;
    try {
      if (!audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AC();
      }
      const now = audioCtx.currentTime;
      [880, 1175].forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, now + i * 0.14);
        gain.gain.exponentialRampToValueAtTime(0.22, now + i * 0.14 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.14 + 0.32);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(now + i * 0.14);
        osc.stop(now + i * 0.14 + 0.34);
      });
    } catch (e) {
      // Audio not available in this environment — fail silently
    }
  }

  muteBtn.addEventListener('click', () => {
    muted = !muted;
    muteBtn.textContent = muted ? '🔇' : '🔊';
  });

  // ---------------- Socket ----------------
  function connectSocket() {
    socket = io({ auth: { token } });

    socket.on('connect', () => {
      console.log('[barista] Socket connected. id:', socket.id);
    });

    // Server emits this to the barista_channel room whenever a waiter
    // sends a new order (see src/controllers/orderController.js -> createOrder)
    socket.on('new_order', (order) => {
      console.log('[barista] Socket received new_order event:', order);
      activeTickets.unshift(order);
      flashAndChime(order.id);
      render();
    });

    socket.on('order_voided', ({ orderId }) => {
      activeTickets = activeTickets.filter((t) => t.id !== orderId);
      render();
    });

    socket.on('disconnect', (reason) => {
      console.warn('[barista] Socket disconnected:', reason);
    });

    socket.on('connect_error', (err) => {
      console.error('Socket connection error:', err.message);
    });
  }

  function flashAndChime(id) {
    playChime();
    flashIds.add(id);
    setTimeout(() => {
      flashIds.delete(id);
      render();
    }, 4000);
  }

  // ---------------- View toggle ----------------
  function switchView(newView) {
    view = newView;
    toggleBtns.forEach((b) => b.classList.toggle('active', b.dataset.view === newView));
    activeView.classList.toggle('hidden', view !== 'active');
    completedView.classList.toggle('hidden', view !== 'completed');
  }

  toggleBtns.forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  // Clipboard icon in the header — jumps straight to Recent Completed,
  // same as clicking that tab directly.
  historyBtn.addEventListener('click', () => switchView('completed'));

  logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('kds_barista_token');
    localStorage.removeItem('kds_barista_user');
    location.reload();
  });

  // ---------------- Status actions ----------------
  async function startPreparing(ticket) {
    ticket.status = 'IN_PROGRESS';
    render();
    try {
      await api(`/api/orders/${ticket.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'IN_PROGRESS' }),
      });
    } catch (err) {
      console.error('Failed to update status:', err);
    }
  }

  async function markComplete(ticket) {
    activeTickets = activeTickets.filter((t) => t.id !== ticket.id);
    completedTickets.unshift({ ...ticket, status: 'COMPLETED', completedAt: new Date().toISOString() });
    completedTickets = completedTickets.slice(0, 30);
    render();
    try {
      await api(`/api/orders/${ticket.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'COMPLETED' }),
      });
    } catch (err) {
      console.error('Failed to update status:', err);
    }
  }

  // ---------------- Elapsed time ----------------
  function elapsedLabel(createdAt) {
    const diffSec = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000));
    if (diffSec < 60) return { text: 'Just now', overdue: false };
    const m = Math.floor(diffSec / 60);
    const s = diffSec % 60;
    return { text: `${m}m ${s}s ago`, overdue: diffSec > WARNING_THRESHOLD_SEC };
  }

  // ---------------- Rendering ----------------
  function render() {
    const pending = activeTickets.filter((t) => t.status === 'PENDING').length;
    const inProgress = activeTickets.filter((t) => t.status === 'IN_PROGRESS').length;
    pendingCountEl.textContent = pending;
    progressCountEl.textContent = inProgress;
    activeTabCount.textContent = activeTickets.length ? `(${activeTickets.length})` : '';
    completedTabCount.textContent = completedTickets.length ? `(${completedTickets.length})` : '';

    renderActive();
    renderCompleted();
  }

  function renderActive() {
    if (activeTickets.length === 0) {
      activeView.innerHTML = '<div class="empty-state">No active tickets. New orders will flash in here.</div>';
      return;
    }

    activeView.innerHTML = activeTickets.map(ticketCardHtml).join('');

    activeView.querySelectorAll('[data-action="start"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const ticket = activeTickets.find((t) => t.id === btn.dataset.id);
        if (ticket) startPreparing(ticket);
      });
    });
    activeView.querySelectorAll('[data-action="complete"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const ticket = activeTickets.find((t) => t.id === btn.dataset.id);
        if (ticket) markComplete(ticket);
      });
    });
  }

  function ticketCardHtml(ticket) {
    const isPending = ticket.status === 'PENDING';
    const accent = isPending ? 'var(--wait)' : 'var(--prog)';
    const { text: elapsedText, overdue } = elapsedLabel(ticket.createdAt);
    const flashing = flashIds.has(ticket.id);

    return `
      <div class="ticket ${flashing ? 'flash' : ''}" style="border-left:6px solid ${accent}">
        <div class="ticket-row-top">
          <div class="ticket-id"><span class="hash">#</span>${ticket.ticketNo || ticket.id.slice(0, 5).toUpperCase()}</div>
          <div class="status-badge" style="background:${accent}">
            ${isPending ? '⏱ Pending' : '👨‍🍳 In Progress'}
          </div>
        </div>

        <div class="meta-row">
          <span>🍽 <strong>${escapeHtml(ticket.table.label)}</strong></span>
          <span class="muted">👤 ${escapeHtml(ticket.waiter.name)}</span>
        </div>

        <div class="items-box">
          <div class="items-label">Items</div>
          ${ticket.items
            .map(
              (it) => `
            <div class="item-row">
              <span>${escapeHtml(it.menuItem.name)}</span>
              <span class="qty mono">×${it.quantity}</span>
            </div>`
            )
            .join('')}
        </div>

        <div class="elapsed-row ${overdue ? 'overdue' : ''}">
          ${overdue ? '⚠️' : ''} ${elapsedText}
        </div>

        ${
          isPending
            ? `<button class="action-btn start" data-action="start" data-id="${ticket.id}">👨‍🍳 Start Preparing</button>`
            : `<button class="action-btn complete" data-action="complete" data-id="${ticket.id}">✅ Mark Complete</button>`
        }
      </div>`;
  }

  function renderCompleted() {
    if (completedTickets.length === 0) {
      completedView.innerHTML = '<div class="empty-state">Completed tickets will appear here.</div>';
      return;
    }
    completedView.innerHTML = completedTickets
      .map(
        (t) => `
        <div class="completed-mini">
          <div class="top">
            <span class="mono" style="font-weight:700;color:var(--paper)">#${t.ticketNo || t.id.slice(0, 5).toUpperCase()}</span>
            <span class="done-chip">✅ Done</span>
          </div>
          <p>${escapeHtml(t.table.label)} · ${escapeHtml(t.waiter.name)}</p>
          <p>${t.items.map((it) => `${it.quantity}× ${escapeHtml(it.menuItem.name)}`).join(', ')}</p>
        </div>`
      )
      .join('');
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Explicit local-date formatter for <input type="date"> — builds
  // YYYY-MM-DD from the browser's own local date components, so there's
  // no ambiguity about locale or timezone conversion here.
  function todayDateString() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // ---------------- Completed history (date filter) ----------------
  async function loadCompleted() {
    try {
      const date = completedDateInput.value; // YYYY-MM-DD
      completedTickets = await api(`/api/orders/completed?date=${date}`);
      render();
    } catch (err) {
      console.error('Failed to load completed orders:', err);
    }
  }

  completedDateInput.addEventListener('change', loadCompleted);

  // ---------------- Active-queue polling fallback ----------------
  // New orders already arrive live via the 'new_order' socket event (see
  // connectSocket above) — this is only a resilience backstop in case a
  // socket connection drops silently (e.g. flaky cafe wifi) without
  // reconnecting. It merges rather than replaces activeTickets, so it
  // can't stomp on a ticket this screen is mid-way through updating
  // (e.g. between clicking "Start" and the PATCH request resolving).
  function reconcileActiveTickets(serverTickets) {
    const knownIds = new Set(activeTickets.map((t) => t.id));
    const serverIds = new Set(serverTickets.map((t) => t.id));

    // Anything the server has that we don't (a missed socket event)
    serverTickets.forEach((t) => {
      if (!knownIds.has(t.id)) {
        activeTickets.push(t);
        flashAndChime(t.id);
      }
    });

    // Anything we still have locally that the server no longer counts as
    // active (completed/voided from elsewhere, e.g. the manager dashboard)
    activeTickets = activeTickets.filter((t) => serverIds.has(t.id));
  }

  async function pollActiveOrders() {
    try {
      const active = await api('/api/orders');
      console.log('[barista] API response orders fetched (poll):', active);
      reconcileActiveTickets(active);
      render();
    } catch (err) {
      console.error('Active-orders poll failed:', err);
    }
  }

  // ---------------- Boot ----------------
  async function boot() {
    showApp();
    connectSocket();
    // Force today's date on every load — a browser can restore this
    // input's previous value from form autofill/history on reload, so
    // checking "if empty" isn't reliable; always reset it explicitly.
    completedDateInput.value = todayDateString(); // YYYY-MM-DD in local time
    console.log('[barista] Active date filter value on init:', completedDateInput.value);
    try {
      const [active, completed] = await Promise.all([
        api('/api/orders'), // active queue seed
        api(`/api/orders/completed?date=${completedDateInput.value}`), // today's completed orders, so this
                                                                         // tab isn't empty after a refresh
      ]);
      console.log('[barista] API response orders fetched (initial active):', active);
      console.log('[barista] API response orders fetched (initial completed):', completed);
      activeTickets = active;
      completedTickets = completed;
    } catch (err) {
      console.error('Failed to load orders:', err);
    }
    render();
    setInterval(render, 1000); // keep elapsed-time counters ticking
    setInterval(pollActiveOrders, 3000); // socket resilience backstop
  }

  if (token && user) {
    boot().catch((err) => {
      console.error('Boot failed, clearing session:', err);
      localStorage.removeItem('kds_barista_token');
      localStorage.removeItem('kds_barista_user');
      loginScreen.classList.remove('hidden');
      appScreen.classList.add('hidden');
    });
  }
})();
