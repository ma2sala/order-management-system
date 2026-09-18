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

  // Mobile/some desktop browsers block audio until a real user gesture has
  // happened on the page. Explicitly create/resume the AudioContext on the
  // very first tap/click anywhere, so it's already unlocked well before a
  // 'new_order' socket event ever needs to play a chime (same approach as
  // the Waiter screen's unlockAudioOnce()).
  function unlockAudioOnce() {
    try {
      if (!audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AC();
      }
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) {
      // ignore — playChime() will just no-op later if this never unlocks
    }
  }
  document.addEventListener('click', unlockAudioOnce, { once: true });

  // ---------------- DOM refs ----------------
  const loginScreen = document.getElementById('loginScreen');
  const appScreen = document.getElementById('appScreen');
  const loginForm = document.getElementById('loginForm');
  const loginError = document.getElementById('loginError');

  const pendingCountEl = document.getElementById('pendingCount');
  const progressCountEl = document.getElementById('progressCount');
  const muteBtn = document.getElementById('muteBtn');
  const muteIconOn = document.getElementById('muteIconOn');
  const muteIconOff = document.getElementById('muteIconOff');
  const completedDateInput = document.getElementById('completedDateInput');
  const historyBtn = document.getElementById('historyBtn');
  const logoutBtn = document.getElementById('logoutBtn');

  const detailsModal = document.getElementById('detailsModal');
  const detailsModalTitle = document.getElementById('detailsModalTitle');
  const detailsBody = document.getElementById('detailsBody');
  const detailsCloseBtn = document.getElementById('detailsCloseBtn');

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
    muteIconOn.classList.toggle('hidden', muted);
    muteIconOff.classList.toggle('hidden', !muted);
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
      // Only flash/chime if this order actually has something for the bar
      // to make — a food-only order is silently added (so it's tracked for
      // status purposes) but doesn't interrupt the barista.
      if (hasBarItems(order)) flashAndChime(order.id);
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

  // A ticket only belongs on this display if at least one of its items
  // is tagged for the bar station (see orderController.js's stationOf()).
  // A food-only order has nothing for Barista to prepare.
  function hasBarItems(ticket) {
    return ticket.items.some((it) => it.station === 'bar');
  }

  // GET /api/orders (used both at boot and by the 3-second polling
  // backstop below) filters on the ORDER's overall status, which stays
  // PENDING/IN_PROGRESS until every station — not just this one — is
  // done. Without this check, a ticket whose bar side is already
  // COMPLETED but whose kitchen side is still active would keep coming
  // back from that endpoint and get treated as "still active for the
  // bar" by reconcileActiveTickets/boot() below, reappearing in the
  // queue the moment Chef touches their own side of the same order.
  // This is the one source of truth for whether a ticket belongs in
  // Barista's active queue at all.
  function isBarActive(ticket) {
    return ticket.barStatus === 'PENDING' || ticket.barStatus === 'IN_PROGRESS';
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
  // Guards against a status PATCH being sent twice for the same ticket —
  // e.g. a very fast double-tap landing before the optimistic re-render
  // below has swapped the button out.
  const inFlightStatusUpdates = new Set();

  async function startPreparing(ticket) {
    if (inFlightStatusUpdates.has(ticket.id)) return;
    inFlightStatusUpdates.add(ticket.id);

    const previousBarStatus = ticket.barStatus;
    ticket.barStatus = 'IN_PROGRESS';
    render();
    try {
      await api(`/api/orders/${ticket.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'IN_PROGRESS', station: 'bar' }),
      });
    } catch (err) {
      console.error('Failed to update status:', err);
      // Roll back the optimistic change so the button reappears (in its
      // original, clickable state) rather than silently drifting out of
      // sync with what the server actually has.
      ticket.barStatus = previousBarStatus;
      render();
      showFailureToast('Failed to start preparing this ticket — try again.');
    } finally {
      inFlightStatusUpdates.delete(ticket.id);
    }
  }

  async function markComplete(ticket) {
    if (inFlightStatusUpdates.has(ticket.id)) return;
    inFlightStatusUpdates.add(ticket.id);

    activeTickets = activeTickets.filter((t) => t.id !== ticket.id);
    completedTickets.unshift({ ...ticket, barStatus: 'COMPLETED', completedAt: new Date().toISOString() });
    completedTickets = completedTickets.slice(0, 30);
    render();
    try {
      await api(`/api/orders/${ticket.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'COMPLETED', station: 'bar' }),
      });
    } catch (err) {
      console.error('Failed to update status:', err);
      // Roll back: move it back into the active queue so the "Mark
      // Complete" button reappears instead of vanishing into a
      // completed-looking state the server never actually confirmed.
      completedTickets = completedTickets.filter((t) => t.id !== ticket.id);
      activeTickets.unshift(ticket);
      render();
      showFailureToast('Failed to mark this ticket complete — try again.');
    } finally {
      inFlightStatusUpdates.delete(ticket.id);
    }
  }

  // Minimal inline toast for a failed status update — reuses the same
  // #toast element/animation the completed-history view doesn't have its
  // own copy of, so this stays self-contained rather than depending on
  // another screen's toast helper.
  function showFailureToast(message) {
    let toast = document.getElementById('toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toast';
      toast.className = 'toast error hidden';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.remove('hidden');
    clearTimeout(showFailureToast._t);
    showFailureToast._t = setTimeout(() => toast.classList.add('hidden'), 3500);
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
    const barActive = activeTickets.filter(hasBarItems);
    const barCompleted = completedTickets.filter(hasBarItems);

    const pending = barActive.filter((t) => t.barStatus === 'PENDING').length;
    const inProgress = barActive.filter((t) => t.barStatus === 'IN_PROGRESS').length;
    pendingCountEl.textContent = pending;
    progressCountEl.textContent = inProgress;
    activeTabCount.textContent = barActive.length ? `(${barActive.length})` : '';
    completedTabCount.textContent = barCompleted.length ? `(${barCompleted.length})` : '';

    renderActive(barActive);
    renderCompleted(barCompleted);
  }

  function renderActive(barActive) {
    if (barActive.length === 0) {
      activeView.innerHTML = '<div class="empty-state">No active tickets. New orders will flash in here.</div>';
      return;
    }

    activeView.innerHTML = barActive.map(ticketCardHtml).join('');

    activeView.querySelectorAll('[data-action="start"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        btn.disabled = true; // belt-and-suspenders on top of inFlightStatusUpdates —
                              // this button element itself is normally about to be
                              // replaced by the next render() anyway, but a slow/janky
                              // browser tick is exactly the gap a double-tap could land in
        const ticket = activeTickets.find((t) => t.id === btn.dataset.id);
        if (ticket) startPreparing(ticket);
      });
    });
    activeView.querySelectorAll('[data-action="complete"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        btn.disabled = true;
        const ticket = activeTickets.find((t) => t.id === btn.dataset.id);
        if (ticket) markComplete(ticket);
      });
    });
    activeView.querySelectorAll('[data-action="details"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const ticket = activeTickets.find((t) => t.id === btn.dataset.id);
        if (ticket) openDetailsModal(ticket);
      });
    });
  }

  // ---------------- Ticket details modal ----------------
  const TEMPERATURE_LABELS = { HOT: 'Hot', COLD: 'Cold', NORMAL: 'Normal', NORMAL_WITH_ICE: 'Normal + Ice' };

  // One line per modification, matching how a kitchen ticket actually
  // needs to be scanned at a glance — not a single comma-joined blob.
  function itemCustomizationLines(item) {
    const lines = [];
    if (item.temperature) {
      lines.push(`[${TEMPERATURE_LABELS[item.temperature] || item.temperature}]`);
    }
    (item.removedIngredients || []).forEach((ing) => lines.push(`- No ${ing}`));
    (item.selectedExtras || []).forEach((ex) => {
      const priceText = typeof ex.price === 'number' ? ` (+$${ex.price.toFixed(2)})` : '';
      lines.push(`+ ${ex.name}${priceText}`);
    });
    if (item.notes) lines.push(`Note: ${item.notes}`);
    return lines;
  }

  function openDetailsModal(ticket) {
    detailsModalTitle.textContent = `#${ticket.ticketNo || ticket.id.slice(0, 5).toUpperCase()} — Table ${ticket.table.label}`;

    const barItems = ticket.items.filter((it) => it.station === 'bar');

    detailsBody.innerHTML = `
      <div class="details-row"><span class="details-label">Waiter</span><span>${escapeHtml(ticket.waiter.name)}</span></div>
      <div class="details-divider"></div>
      ${barItems
        .map((it) => {
          const lines = itemCustomizationLines(it);
          return `
          <div class="details-item">
            <div class="details-item-top">
              <span>${it.quantity}× ${escapeHtml(it.menuItem.name)}</span>
            </div>
            ${
              lines.length > 0
                ? lines.map((l) => `<div class="details-item-custom">${escapeHtml(l)}</div>`).join('')
                : '<div class="details-item-custom muted-note">No customizations</div>'
            }
          </div>`;
        })
        .join('')}
    `;

    detailsModal.classList.remove('hidden');
  }

  detailsCloseBtn.addEventListener('click', () => detailsModal.classList.add('hidden'));
  detailsModal.addEventListener('click', (e) => {
    if (e.target === detailsModal) detailsModal.classList.add('hidden');
  });

  function ticketCardHtml(ticket) {
    const isPending = ticket.barStatus === 'PENDING';
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
            .filter((it) => it.station === 'bar')
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

        <div class="ticket-actions-row">
          ${
            isPending
              ? `<button class="action-btn start" data-action="start" data-id="${ticket.id}">👨‍🍳 Start Preparing</button>`
              : `<button class="action-btn complete" data-action="complete" data-id="${ticket.id}">✅ Mark Complete</button>`
          }
          <button class="action-btn details" data-action="details" data-id="${ticket.id}" title="View Details">📋</button>
        </div>
      </div>`;
  }

  function renderCompleted(barCompleted) {
    if (barCompleted.length === 0) {
      completedView.innerHTML = '<div class="empty-state">Completed tickets will appear here.</div>';
      return;
    }
    completedView.innerHTML = barCompleted
      .map(
        (t) => `
        <div class="completed-mini">
          <div class="top">
            <span class="mono" style="font-weight:700;color:var(--paper)">#${t.ticketNo || t.id.slice(0, 5).toUpperCase()}</span>
            <span class="done-chip">✅ Done</span>
          </div>
          <p>${escapeHtml(t.table.label)} · ${escapeHtml(t.waiter.name)}</p>
          <p>${t.items.filter((it) => it.station === 'bar').map((it) => `${it.quantity}× ${escapeHtml(it.menuItem.name)}`).join(', ')}</p>
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
      completedTickets = await api(`/api/orders/completed?date=${date}&station=bar`);
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
    // Only tickets that are genuinely still active FOR THE BAR — see
    // isBarActive() above for why the raw server list isn't enough on
    // its own (it reflects the whole order, not this station).
    const barActiveServerTickets = serverTickets.filter(isBarActive);
    const barActiveServerIds = new Set(barActiveServerTickets.map((t) => t.id));

    // Anything the server has that we don't (a missed socket event)
    barActiveServerTickets.forEach((t) => {
      if (!knownIds.has(t.id)) {
        activeTickets.push(t);
        flashAndChime(t.id);
      }
    });

    // Anything we still have locally that the server no longer counts as
    // active for the bar (completed/voided — from this screen, or from
    // Barista's OWN completion a moment ago that the server has now
    // confirmed) — this is also what actually removes a just-completed
    // ticket instead of letting the next poll resurrect it.
    activeTickets = activeTickets.filter((t) => barActiveServerIds.has(t.id));
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
        api(`/api/orders/completed?date=${completedDateInput.value}&station=bar`), // today's completed orders, so this
                                                                                  // tab isn't empty after a refresh
      ]);
      console.log('[barista] API response orders fetched (initial active):', active);
      console.log('[barista] API response orders fetched (initial completed):', completed);
      activeTickets = active.filter(isBarActive);
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
