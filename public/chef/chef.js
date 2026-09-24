(function () {
  'use strict';

  const API = '';
  const WARNING_THRESHOLD_SEC = 5 * 60; // flag tickets sitting > 5 min

  let token = localStorage.getItem('kds_chef_token') || null;
  let user = JSON.parse(localStorage.getItem('kds_chef_user') || 'null');
  let socket = null;
  let audioCtx = null;
  let muted = false;

  let activeTickets = []; // orders from the server, shape from GET /api/orders — already
                           // narrowed to this ticket's kitchen items only, see narrowToKitchen()
  let completedTickets = [];
  let flashIds = new Set();
  let view = 'active';

  // Mobile/some desktop browsers block audio until a real user gesture has
  // happened on the page. Explicitly create/resume the AudioContext on the
  // very first tap/click anywhere, so it's already unlocked well before a
  // 'new_order' socket event ever needs to play a chime.
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
  document.addEventListener('touchstart', unlockAudioOnce, { once: true });
  document.addEventListener('keydown', unlockAudioOnce, { once: true });

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
    // A 401 on anything but the login request itself means this screen's
    // login has expired (tokens last 12h — see authController.js).
    if (res.status === 401 && path !== '/api/auth/login') sessionExpired();
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Request failed: ${res.status}`);
    }
    return res.json();
  }

  // ---------------- Session expiry + connection warning ----------------
  // Before this, an expired login failed silently: the 3s poll only
  // logged to the console, a socket reconnect was rejected, and even a
  // page refresh just showed an empty queue — so the display looked
  // fine while no new orders ever arrived. Now it drops back to the
  // sign-in screen and says why.
  let pollTimer = null;
  let renderTimer = null;

  function sessionExpired() {
    if (!token) return; // already handled
    token = null;
    user = null;
    localStorage.removeItem('kds_chef_token');
    localStorage.removeItem('kds_chef_user');
    clearInterval(pollTimer);
    clearInterval(renderTimer);
    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
      socket = null;
    }
    setConnectionWarning(false);
    appScreen.classList.add('hidden');
    loginScreen.classList.remove('hidden');
    loginError.textContent = 'Your login expired — sign in again to keep receiving orders.';
  }

  // Red banner while the server can't be reached (Wi-Fi down, server
  // restarting) — new orders can't arrive, and the staff should know.
  let connectionBanner = null;
  function setConnectionWarning(show) {
    if (!connectionBanner) {
      connectionBanner = document.createElement('div');
      connectionBanner.className = 'connection-banner hidden';
      connectionBanner.textContent = '⚠ Connection lost — new orders may not appear. Check the Wi-Fi.';
      document.body.appendChild(connectionBanner);
    }
    connectionBanner.classList.toggle('hidden', !show);
  }

  // ---------------- Kitchen-item filtering ----------------
  // GET /api/orders and GET /api/orders/completed return every order with
  // every item tagged `station: 'kitchen' | 'bar'` (see orderController.js
  // -> withStations). This screen only cares about kitchen items — an
  // order that's 100% drinks has nothing for the kitchen, and a mixed
  // order should only show its food/snack lines here, leaving the drink
  // lines for the Barista Display.
  function narrowToKitchen(order) {
    const kitchenItems = (order.items || []).filter((i) => i.station === 'kitchen');
    if (kitchenItems.length === 0) return null;
    return { ...order, items: kitchenItems };
  }

  function narrowToKitchenMany(orders) {
    return orders.map(narrowToKitchen).filter(Boolean);
  }

  // GET /api/orders filters on the ORDER's overall status, which stays
  // PENDING/IN_PROGRESS until EVERY station — not just kitchen — is
  // done. Without this check, a ticket whose kitchen side is already
  // COMPLETED but whose bar side is still active would keep coming back
  // from that endpoint and get treated as "still active for the
  // kitchen" by reconcileActiveTickets/boot() below, reappearing in the
  // queue the moment Barista touches their own side of the same order.
  function isKitchenActive(ticket) {
    return ticket.kitchenStatus === 'PENDING' || ticket.kitchenStatus === 'IN_PROGRESS';
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
      if (data.user.role !== 'CHEF' && data.user.role !== 'MANAGER') {
        loginError.textContent = 'This screen is for chef or manager accounts.';
        return;
      }
      token = data.token;
      user = data.user;
      localStorage.setItem('kds_chef_token', token);
      localStorage.setItem('kds_chef_user', JSON.stringify(user));
      boot().catch((bootErr) => {
        console.error('Boot failed after login:', bootErr);
        loginError.textContent = `Something went wrong loading the queue: ${bootErr.message || bootErr}`;
      });
    } catch (err) {
      loginError.textContent = err.message || 'Login failed';
    }
  });

  function showApp() {
    loginScreen.classList.add('hidden');
    appScreen.classList.remove('hidden');
  }

  // Peak volume of the new-order / ready chime (0–1). Was 0.22 — raised
  // so it's heard over a busy kitchen/counter. Lower this if it's too much.
  const CHIME_VOLUME = 0.9;

  // ---------------- Audio chime (Web Audio, no external asset) ----------------
  function playChime() {
    if (muted) return;
    try {
      if (!audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AC();
      }
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
      const notes = [740, 990]; // lower than the Barista's pattern, so side-by-side screens are told apart by ear;
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
      console.log('[chef] Socket connected. id:', socket.id);
      setConnectionWarning(false);
    });

    // Server only emits this to the chef_channel room when the order has
    // at least one kitchen item (see orderController.js -> createOrder),
    // but we still narrow it here too — cheap, and keeps this screen
    // correct even if that server-side check ever changes.
    socket.on('new_order', (order) => {
      console.log('[chef] Socket received new_order event:', order);
      const narrowed = narrowToKitchen(order);
      if (!narrowed) return;
      activeTickets.unshift(narrowed);
      flashAndChime(narrowed.id);
      render();
    });

    // Another Chef tablet tapped Start/Complete on a ticket — keep every
    // open tablet in step instead of showing a stale status until refresh.
    // (This tablet's own taps are already applied optimistically, and
    // skipped here while their request is still in flight.)
    socket.on('status_updated', ({ orderId, station, kitchenStatus }) => {
      if (station !== 'kitchen' || inFlightStatusUpdates.has(orderId)) return;
      const ticket = activeTickets.find((t) => t.id === orderId);
      if (!ticket) return;
      if (kitchenStatus === 'COMPLETED') {
        activeTickets = activeTickets.filter((t) => t.id !== orderId);
        loadCompleted(); // so "Recent Completed" shows it on this tablet too
      } else {
        ticket.kitchenStatus = kitchenStatus;
      }
      render();
    });

    socket.on('order_voided', ({ orderId }) => {
      activeTickets = activeTickets.filter((t) => t.id !== orderId);
      render();
    });

    socket.on('disconnect', (reason) => {
      console.warn('[chef] Socket disconnected:', reason);
    });

    socket.on('connect_error', (err) => {
      console.error('Socket connection error:', err.message);
      if (err.message.startsWith('Unauthorized')) sessionExpired();
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

  historyBtn.addEventListener('click', () => switchView('completed'));

  logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('kds_chef_token');
    localStorage.removeItem('kds_chef_user');
    location.reload();
  });

  // ---------------- Status actions ----------------
  // Note: order status is still per-order, not per-item (a known,
  // pre-existing limitation shared with the Barista Display) — on a
  // mixed food+drink order, whichever screen marks it Started/Complete
  // first flips that status for the whole order. The other display picks
  // up the change on its next 3-second poll.
  // Guards against a status PATCH being sent twice for the same ticket —
  // e.g. a very fast double-tap landing before the optimistic re-render
  // below has swapped the button out.
  const inFlightStatusUpdates = new Set();

  async function startPreparing(ticket) {
    if (inFlightStatusUpdates.has(ticket.id)) return;
    inFlightStatusUpdates.add(ticket.id);

    const previousKitchenStatus = ticket.kitchenStatus;
    ticket.kitchenStatus = 'IN_PROGRESS';
    render();
    try {
      await api(`/api/orders/${ticket.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'IN_PROGRESS', station: 'kitchen' }),
      });
    } catch (err) {
      console.error('Failed to update status:', err);
      ticket.kitchenStatus = previousKitchenStatus;
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
    completedTickets.unshift({ ...ticket, kitchenStatus: 'COMPLETED', completedAt: new Date().toISOString() });
    completedTickets = completedTickets.slice(0, 30);
    render();
    try {
      await api(`/api/orders/${ticket.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'COMPLETED', station: 'kitchen' }),
      });
    } catch (err) {
      console.error('Failed to update status:', err);
      completedTickets = completedTickets.filter((t) => t.id !== ticket.id);
      activeTickets.unshift(ticket);
      render();
      showFailureToast('Failed to mark this ticket complete — try again.');
    } finally {
      inFlightStatusUpdates.delete(ticket.id);
    }
  }

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
    const pending = activeTickets.filter((t) => t.kitchenStatus === 'PENDING').length;
    const inProgress = activeTickets.filter((t) => t.kitchenStatus === 'IN_PROGRESS').length;
    pendingCountEl.textContent = pending;
    progressCountEl.textContent = inProgress;
    activeTabCount.textContent = activeTickets.length ? `(${activeTickets.length})` : '';
    completedTabCount.textContent = completedTickets.length ? `(${completedTickets.length})` : '';

    renderActive();
    renderCompleted();
  }

  // ---------------- In-place card diffing (no full innerHTML wipe) ----------------
  // Previously every render() — including the once-a-second tick that
  // just updates elapsed-time text — replaced the ENTIRE container's
  // innerHTML, tearing down and recreating every card even when nothing
  // about it actually changed. That's what caused the visible flicker:
  // a freshly-created DOM node replays its fadeInUp animation every
  // time, even for a ticket that's been sitting there for 10 minutes.
  // This keeps each ticket's own <div> alive across renders — matched by
  // data-order-id — and only patches its content in place, so unrelated
  // cards are never touched and a genuinely new/removed ticket is the
  // only thing that actually mounts/unmounts.
  function diffRenderTickets(container, tickets, cardHtmlFn, emptyMessage) {
    const newIds = new Set(tickets.map((t) => t.id));

    Array.from(container.children).forEach((el) => {
      if (el.dataset && el.dataset.orderId && !newIds.has(el.dataset.orderId)) {
        el.classList.add('fade-out');
        setTimeout(() => el.remove(), 250);
      }
    });

    if (tickets.length === 0) {
      if (container.children.length === 0) {
        container.innerHTML = `<div class="empty-state">${emptyMessage}</div>`;
      }
      return;
    }

    const staleEmpty = container.querySelector('.empty-state');
    if (staleEmpty) staleEmpty.remove();

    tickets.forEach((ticket) => {
      const html = cardHtmlFn(ticket).trim();
      const temp = document.createElement('div');
      temp.innerHTML = html;
      const freshEl = temp.firstElementChild;
      freshEl.dataset.orderId = ticket.id;

      const existingEl = container.querySelector(`[data-order-id="${ticket.id}"]`);
      if (existingEl) {
        if (existingEl.innerHTML !== freshEl.innerHTML) {
          existingEl.innerHTML = freshEl.innerHTML;
        }
        if (existingEl.className !== freshEl.className) {
          existingEl.className = freshEl.className;
        }
        const freshStyle = freshEl.getAttribute('style');
        if (freshStyle && existingEl.getAttribute('style') !== freshStyle) {
          existingEl.setAttribute('style', freshStyle);
        }
      } else {
        freshEl.dataset.orderId = ticket.id;
        container.prepend(freshEl);
      }
    });
  }

  // Event delegation: ONE listener per container, attached once here —
  // works for every card regardless of how many times it gets patched
  // in place by diffRenderTickets above.
  activeView.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || btn.disabled) return;
    const ticket = activeTickets.find((t) => t.id === btn.dataset.id);
    if (!ticket) return;

    if (btn.dataset.action === 'start') {
      btn.disabled = true;
      startPreparing(ticket);
    } else if (btn.dataset.action === 'complete') {
      btn.disabled = true;
      markComplete(ticket);
    } else if (btn.dataset.action === 'details') {
      openDetailsModal(ticket);
    }
  });

  completedView.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="details"]');
    if (!btn) return;
    const ticket = completedTickets.find((t) => t.id === btn.dataset.id);
    if (ticket) openDetailsModal(ticket);
  });

  function renderActive() {
    diffRenderTickets(activeView, activeTickets, ticketCardHtml, 'No active tickets. New food orders will flash in here.');
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

    // ticket.items here is already narrowed to kitchen items only (see
    // narrowToKitchen() near the top of this file), so no extra filter
    // is needed the way barista.js needs one for its own station.
    detailsBody.innerHTML = `
      <div class="details-row"><span class="details-label">Waiter</span><span>${escapeHtml(ticket.waiter.name)}</span></div>
      <div class="details-divider"></div>
      ${ticket.items
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
    const isPending = ticket.kitchenStatus === 'PENDING';
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

  function completedCardHtml(t) {
    return `
        <div class="completed-mini">
          <div class="top">
            <span class="mono" style="font-weight:700;color:var(--paper)">#${t.ticketNo || t.id.slice(0, 5).toUpperCase()}</span>
            <div class="completed-mini-actions">
              <span class="done-chip">✅ Done</span>
              <button class="details-eye-btn" data-action="details" data-id="${t.id}" title="View Details" aria-label="View Details">👁</button>
            </div>
          </div>
          <p>${escapeHtml(t.table.label)} · ${escapeHtml(t.waiter.name)}</p>
          <p>${t.items.map((it) => `${it.quantity}× ${escapeHtml(it.menuItem.name)}`).join(', ')}</p>
        </div>`;
  }

  function renderCompleted() {
    diffRenderTickets(completedView, completedTickets, completedCardHtml, 'Completed tickets will appear here.');
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
      const completed = await api(`/api/orders/completed?date=${date}&station=kitchen`);
      completedTickets = narrowToKitchenMany(completed);
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
  // Expects serverTickets already narrowed to kitchen items AND filtered
  // to isKitchenActive() (see pollActiveOrders below) — this function
  // trusts that list as "everything currently active for the kitchen"
  // and doesn't re-derive it, so don't call this with a raw, unfiltered
  // order list.
  function reconcileActiveTickets(serverTickets) {
    const knownIds = new Set(activeTickets.map((t) => t.id));
    const serverIds = new Set(serverTickets.map((t) => t.id));

    serverTickets.forEach((t) => {
      if (!knownIds.has(t.id)) {
        activeTickets.push(t);
        flashAndChime(t.id);
      }
    });

    // Also correct the status of tickets already on screen, in case a
    // live update from another tablet was missed (e.g. a Wi-Fi blip).
    const serverById = new Map(serverTickets.map((t) => [t.id, t]));
    activeTickets.forEach((t) => {
      const fresh = serverById.get(t.id);
      if (fresh && !inFlightStatusUpdates.has(t.id)) t.kitchenStatus = fresh.kitchenStatus;
    });

    activeTickets = activeTickets.filter((t) => serverIds.has(t.id));
  }

  async function pollActiveOrders() {
    try {
      const active = await api('/api/orders');
      const narrowed = narrowToKitchenMany(active).filter(isKitchenActive);
      console.log('[chef] API response orders fetched (poll):', narrowed);
      reconcileActiveTickets(narrowed);
      render();
      setConnectionWarning(false);
    } catch (err) {
      console.error('Active-orders poll failed:', err);
      if (token) setConnectionWarning(true); // (a 401 already ended the session)
    }
  }

  // ---------------- Boot ----------------
  async function boot() {
    showApp();
    connectSocket();
    completedDateInput.value = todayDateString(); // YYYY-MM-DD in local time
    console.log('[chef] Active date filter value on init:', completedDateInput.value);
    try {
      const [active, completed] = await Promise.all([
        api('/api/orders'),
        api(`/api/orders/completed?date=${completedDateInput.value}&station=kitchen`),
      ]);
      activeTickets = narrowToKitchenMany(active).filter(isKitchenActive);
      completedTickets = narrowToKitchenMany(completed);
      console.log('[chef] API response orders fetched (initial active):', activeTickets);
      console.log('[chef] API response orders fetched (initial completed):', completedTickets);
    } catch (err) {
      console.error('Failed to load orders:', err);
    }
    render();
    if (!token) return; // login had already expired — now on the sign-in screen
    clearInterval(renderTimer);
    clearInterval(pollTimer);
    renderTimer = setInterval(render, 1000); // keep elapsed-time counters ticking
    pollTimer = setInterval(pollActiveOrders, 3000); // socket resilience backstop
  }

  if (token && user) {
    boot().catch((err) => {
      console.error('Boot failed, clearing session:', err);
      localStorage.removeItem('kds_chef_token');
      localStorage.removeItem('kds_chef_user');
      loginScreen.classList.remove('hidden');
      appScreen.classList.add('hidden');
    });
  }
})();
