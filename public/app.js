'use strict';

// ==================== CONFIG ====================
const PAYSTACK_PUBLIC_KEY = 'pk_live_b5dbaf4b930d176961c4a712e55917dc77dbec20'

const RIDER_FEE_GHS = 2; // Platform fee charged to a rider per accepted order
const MIN_TOPUP_GHS = 2;
const DEFAULT_STUDENT_COORDS = { lat: 5.1045, lng: -1.2836 };
const DEFAULT_RIDER_COORDS = { lat: 5.1072, lng: -1.2815 };

// ⚠ Hardcoded auth code. Anyone can read this in the browser. Move rider
// authentication to the server (session/token) before going live.
const RIDER_AUTH_HEADERS = { 'x-auth-role': 'rider', 'x-auth-code': '2222' };

const STORAGE_KEYS = { student: 'gasgo_student', rider: 'gasgo_rider' };

const RIDER_STAGE_FLOW = {
  accepted: { next: 'picked_up', label: 'Confirm Cylinder Picked Up' },
  picked_up: { next: 'filling_gas', label: 'At Station Filling Gas' },
  filling_gas: { next: 'returning', label: 'Returning to Student Hostel' },
  returning: { next: 'delivered', label: 'Mark as Delivered' }
};

// ==================== STATE ====================
const appState = {
  role: null, // 'student' | 'rider'
  student: loadStored(STORAGE_KEYS.student),
  rider: loadStored(STORAGE_KEYS.rider),
  config: {
    lpgPricePerKg: 14.5,
    expressSurcharge: 5,
    stations: [],
    zones: []
  },
  orders: [],
  selectedRating: 5
};

// Map handles (used by initStudentMap, which is not in the uploaded file)
let studentMap = null;
let riderMarker = null;
let studentMarker = null;

let gpsWatchId = null;

// ==================== HELPERS ====================
const $ = (id) => document.getElementById(id);

function on(id, eventName, handler) {
  $(id)?.addEventListener(eventName, handler);
}

function setText(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}

function money(value) {
  return `GH₵ ${Number(value || 0).toFixed(2)}`;
}

// Prevents user-supplied text (names, notes, hostels) from injecting HTML.
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function loadStored(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}

function saveStored(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

// JSON fetch wrapper. Returns { ok, status, data }. Throws if the server
// answers with something that is not JSON (usually: server not running).
async function api(url, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(url, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Server returned status ${res.status}. Ensure node server.js is running.`);
  }
  return { ok: res.ok, status: res.status, data };
}

async function getPosition(fallback, timeout) {
  if (!navigator.geolocation) return fallback;
  try {
    const pos = await new Promise((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, { timeout })
    );
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  } catch {
    return fallback;
  }
}

function stopGpsBroadcast() {
  if (gpsWatchId !== null) {
    navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = null;
  }
}

function showView(viewId) {
  document.querySelectorAll('.view-section').forEach((sec) => {
    sec.classList.add('hidden');
    sec.classList.remove('active');
  });
  const target = $(viewId);
  if (target) {
    target.classList.remove('hidden');
    target.classList.add('active');
  }
}

function setActiveUserChip(text) {
  const chip = $('activeUserChip');
  if (!chip) return;
  if (text) {
    chip.textContent = text;
    chip.classList.remove('hidden');
  } else {
    chip.classList.add('hidden');
  }
}

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', async () => {
  bindEvents();
  await fetchPlatformConfig();

  if (appState.student) {
    enterStudentPortal(appState.student);
  } else if (appState.rider) {
    enterRiderPortal(appState.rider);
  } else {
    showView('view-auth-gateway');
  }

  connectLiveStream();
});

async function fetchPlatformConfig() {
  try {
    const { ok, data } = await api('/api/state');
    if (!ok || !data.config) return;

    appState.config = data.config;
    const rate = Number(data.config.lpgPricePerKg).toFixed(2);
    setText('liveLpgRateChip', `LPG: GH₵ ${rate} / kg`);
    setText('perKgHint', `Rate: GH₵ ${rate} / kg`);
    populateSelectors();
    updateOrderSummary();
  } catch (err) {
    console.error('Failed to load platform config:', err);
  }
}

function populateSelectors() {
  const zoneSelect = $('zoneSelect');
  const stationSelect = $('stationSelect');
  if (!zoneSelect || !stationSelect) return;

  zoneSelect.innerHTML = (appState.config.zones || [])
    .map(
      (z) =>
        `<option value="${escapeHtml(z.id)}">${escapeHtml(z.name)} (${money(z.deliveryFee)} delivery)</option>`
    )
    .join('');

  stationSelect.innerHTML = (appState.config.stations || [])
    .map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`)
    .join('');
}

// ==================== EVENT BINDINGS ====================
function bindEvents() {
  bindPortalSwitching();
  bindAuthForms();
  bindOrderForm();
  bindRatingModal();
  on('refreshStudentOrdersBtn', 'click', loadStudentHistory);
  on('riderPaystackTopupBtn', 'click', handleRiderPaystackTopup);
}

function showLoginForm(role) {
  const isStudent = role === 'student';
  $('selectStudentPortalBtn')?.classList.toggle('active', isStudent);
  $('selectRiderPortalBtn')?.classList.toggle('active', !isStudent);
  $('studentLoginForm')?.classList.toggle('hidden', !isStudent);
  $('riderLoginForm')?.classList.toggle('hidden', isStudent);
}

function bindPortalSwitching() {
  on('selectStudentPortalBtn', 'click', () => showLoginForm('student'));
  on('selectRiderPortalBtn', 'click', () => showLoginForm('rider'));

  on('switchPortalBtn', 'click', () => {
    localStorage.removeItem(STORAGE_KEYS.student);
    localStorage.removeItem(STORAGE_KEYS.rider);
    appState.student = null;
    appState.rider = null;
    appState.role = null;
    stopGpsBroadcast();
    setActiveUserChip(null);
    showView('view-auth-gateway');
  });
}

function bindAuthForms() {
  on('studentLoginForm', 'submit', handleStudentLogin);
  on('riderLoginForm', 'submit', handleRiderLogin);
}

function bindOrderForm() {
  document.querySelectorAll('.kg-preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      $('kgAmountInput').value = btn.dataset.kg;
      updateOrderSummary();
    });
  });

  ['kgAmountInput', 'zoneSelect', 'speedSelect'].forEach((id) => {
    on(id, 'input', updateOrderSummary);
    on(id, 'change', updateOrderSummary);
  });

  on('studentOrderForm', 'submit', handleStudentOrderSubmit);
}

function bindRatingModal() {
  on('closeRateModalBtn', 'click', () => $('rateRiderModalBackdrop').classList.add('hidden'));

  document.querySelectorAll('.star-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      appState.selectedRating = Number(btn.dataset.star);
      document.querySelectorAll('.star-btn').forEach((b) => {
        b.classList.toggle('selected', Number(b.dataset.star) === appState.selectedRating);
      });
    });
  });

  on('rateRiderForm', 'submit', handleSubmitRating);
}

// ==================== AUTH ====================
function handleStudentLogin(e) {
  e.preventDefault();
  const email = $('stuLoginEmail').value.trim().toLowerCase();
  const name = $('stuLoginName').value.trim();
  const phone = $('stuLoginPhone').value.trim();
  const area = $('stuLoginArea').value;

  if (!email.includes('@')) {
    alert('Please enter a valid Gmail address.');
    return;
  }

  const profile = { email, name, phone, area };
  saveStored(STORAGE_KEYS.student, profile);
  appState.student = profile;
  enterStudentPortal(profile);
}

async function handleRiderLogin(e) {
  e.preventDefault();
  const errBox = $('riderLoginErrorBox');
  errBox.classList.add('hidden');

  const payload = {
    name: $('ridLoginName').value.trim(),
    phone: $('ridLoginPhone').value.trim(),
    area: $('ridLoginArea').value,
    idCardNumber: $('ridLoginIdCard').value.trim(),
    vehiclePlate: $('ridLoginPlate').value.trim(),
    vehicleType: $('ridLoginVehicleType').value
  };

  try {
    const { ok, data } = await api('/api/riders/login', { method: 'POST', body: payload });
    if (!ok) {
      errBox.textContent = data.error || 'Rider verification failed.';
      errBox.classList.remove('hidden');
      return;
    }

    saveStored(STORAGE_KEYS.rider, data.rider);
    appState.rider = data.rider;
    enterRiderPortal(data.rider);
  } catch (err) {
    errBox.textContent = err.message || 'Server is offline. Run "node server.js" in terminal.';
    errBox.classList.remove('hidden');
  }
}

// ==================== STUDENT PORTAL ====================
function enterStudentPortal(student) {
  appState.role = 'student';
  showView('view-student');
  setActiveUserChip(`🎓 ${student.email}`);

  setText('studentWelcomeName', student.name);
  setText('studentProfileSummary', `${student.email} · ${student.phone} · ${student.area}`);

  initStudentMap();
  loadStudentHistory();
}

function updateOrderSummary() {
  const kg = Number($('kgAmountInput')?.value || 0);
  const rate = Number(appState.config.lpgPricePerKg || 14.5);
  const zoneId = $('zoneSelect')?.value;
  const isExpress = $('speedSelect')?.value === 'express';

  const zone = (appState.config.zones || []).find((z) => z.id === zoneId) || { deliveryFee: 8 };
  const gasCost = kg * rate;
  const deliveryFee =
    Number(zone.deliveryFee || 8) + (isExpress ? Number(appState.config.expressSurcharge || 5) : 0);

  setText('summaryTotalDisplay', money(gasCost + deliveryFee));
  setText(
    'summaryBreakdownText',
    `${kg} kg × ${money(rate)} = ${money(gasCost)} Gas + ${money(deliveryFee)} Delivery`
  );
}

async function handleStudentOrderSubmit(e) {
  e.preventDefault();
  if (!appState.student) return;

  const { lat, lng } = await getPosition(DEFAULT_STUDENT_COORDS, 3000);
  const { student } = appState;

  const payload = {
    studentEmail: student.email,
    studentName: student.name,
    studentPhone: student.phone,
    studentArea: student.area,
    zoneId: $('zoneSelect').value,
    hostelName: $('hostelNameInput').value.trim(),
    roomNumber: $('roomNumberInput').value.trim(),
    stationId: $('stationSelect').value,
    kgAmount: Number($('kgAmountInput').value),
    speed: $('speedSelect')?.value,
    lat,
    lng
    // ⚠ The uploaded file was cut off in the middle of this payload.
    // Add any remaining fields from your original (e.g. cylinder note) here.
  };

  // ⚠ The rest of this function was also cut off. The endpoint and response
  // handling below are an assumption; check them against your server.js.
  try {
    const { ok, data } = await api('/api/orders', { method: 'POST', body: payload });
    if (!ok) {
      alert(data.error || 'Could not place order.');
      return;
    }
    $('studentOrderForm').reset();
    updateOrderSummary();
    await loadStudentHistory();
  } catch (err) {
    alert('Network error placing order.');
  }
}

function openRateModal(orderId) {
  $('rateOrderIdInput').value = orderId;
  setText('rateOrderSubtitle', `Order ${orderId}`);
  $('rateRiderModalBackdrop').classList.remove('hidden');
}

async function handleSubmitRating(e) {
  e.preventDefault();
  const orderId = $('rateOrderIdInput').value;
  const comment = $('rateCommentInput').value.trim();

  try {
    const { ok, data } = await api(`/api/orders/${encodeURIComponent(orderId)}/rate`, {
      method: 'POST',
      body: { rating: appState.selectedRating, comment }
    });
    if (!ok) {
      alert(data.error || 'Could not submit rating.');
      return;
    }
    $('rateRiderModalBackdrop').classList.add('hidden');
    alert('Thank you! Your rider rating has been recorded.');
    await loadStudentHistory();
  } catch (err) {
    alert('Network error submitting rating.');
  }
}

// ==================== ⚠ MISSING FROM UPLOADED FILE ====================
// These two functions are called above but were not in the file you sent.
// Paste your original versions here (they use studentMap / riderMarker /
// studentMarker and openRateModal).
function initStudentMap() {}
async function loadStudentHistory() {}

// ==================== RIDER PORTAL ====================
async function enterRiderPortal(rider) {
  appState.role = 'rider';
  showView('view-rider');
  setActiveUserChip(`🛵 ${rider.name} (${rider.vehiclePlate})`);

  await loadAllOrdersForRider();
  renderRiderDashboard();
}

async function loadAllOrdersForRider() {
  try {
    const { ok, data } = await api('/api/state', { headers: RIDER_AUTH_HEADERS });
    if (!ok) return;

    if (Array.isArray(data.orders)) {
      appState.orders = data.orders;
    }
    if (Array.isArray(data.riders) && appState.rider) {
      const fresh = data.riders.find((r) => r.id === appState.rider.id);
      if (fresh) {
        appState.rider = fresh;
        saveStored(STORAGE_KEYS.rider, fresh);
      }
    }
  } catch (err) {
    console.error('Error loading rider orders:', err);
  }
}

async function refreshRiderDashboard() {
  await loadAllOrdersForRider();
  renderRiderDashboard();
}

// ---------- Paystack top-up ----------
function isPaystackConfigured() {
  return (
    typeof PaystackPop !== 'undefined' &&
    typeof PAYSTACK_PUBLIC_KEY === 'string' &&
    PAYSTACK_PUBLIC_KEY.startsWith('pk_') &&
    !PAYSTACK_PUBLIC_KEY.includes('replace_with') &&
    !PAYSTACK_PUBLIC_KEY.includes('your_actual_public_key')
  );
}

function setTopupButton(disabled, label) {
  const btn = $('riderPaystackTopupBtn');
  if (!btn) return;
  btn.disabled = disabled;
  btn.textContent = label;
}

function handleRiderPaystackTopup() {
  const { rider } = appState;
  if (!rider) return;

  const amountGhs = Number($('topupAmountInput')?.value || 0);
  if (!amountGhs || amountGhs < MIN_TOPUP_GHS) {
    alert(`Minimum top-up amount is ${money(MIN_TOPUP_GHS)}.`);
    return;
  }

  if (!isPaystackConfigured()) {
    // ⚠ Test-only fallback: credits the wallet without a real payment.
    // Make sure your server rejects "LOCAL-TEST-" references in production.
    verifyRiderTopup(`LOCAL-TEST-${rider.id}-${Date.now()}`, amountGhs);
    return;
  }

  setTopupButton(true, 'Opening Paystack...');

  const handler = PaystackPop.setup({
    key: PAYSTACK_PUBLIC_KEY,
    email: `${rider.id}@gasgoucc.com`,
    amount: Math.round(amountGhs * 100),
    currency: 'GHS',
    ref: `GASGO-TOPUP-${rider.id}-${Date.now()}`,
    metadata: {
      riderId: rider.id,
      riderName: rider.name,
      vehiclePlate: rider.vehiclePlate
    },
    callback: (response) => verifyRiderTopup(response.reference, amountGhs),
    onClose: () => setTopupButton(false, '+ Top Up via Paystack')
  });
  handler.openIframe();
}

async function verifyRiderTopup(reference, amountGhs) {
  setTopupButton(true, 'Crediting Wallet...');

  try {
    const { ok, data } = await api('/api/riders/topup/verify', {
      method: 'POST',
      body: { riderId: appState.rider.id, reference, amountGhs }
    });
    if (!ok) {
      alert(data.error || 'Paystack top-up verification failed.');
      return;
    }

    appState.rider.creditBalanceGhs = Number(data.balanceAfterGhs);
    saveStored(STORAGE_KEYS.rider, appState.rider);
    await refreshRiderDashboard();

    alert(`Paystack Top-Up Successful! New credit balance: ${money(data.balanceAfterGhs)}`);
  } catch (err) {
    alert('Network error verifying Paystack top-up. Make sure server.js is running.');
  } finally {
    setTopupButton(false, '+ Top Up via Paystack');
  }
}

// ---------- Order actions ----------
async function acceptOrder(orderId) {
  if (!appState.rider) return;

  if (Number(appState.rider.creditBalanceGhs || 0) < RIDER_FEE_GHS) {
    alert(`Insufficient credit! You need at least ${money(RIDER_FEE_GHS)} topped up via Paystack to accept an order.`);
    return;
  }

  const { lat, lng } = await getPosition(DEFAULT_RIDER_COORDS, 4000);

  try {
    const { ok, data } = await api(`/api/orders/${encodeURIComponent(orderId)}/status`, {
      method: 'PATCH',
      body: { status: 'accepted', riderId: appState.rider.id, riderLat: lat, riderLng: lng }
    });
    if (!ok) {
      alert(data.error || 'Could not accept order.');
      return;
    }

    startRiderGpsBroadcast(orderId);
    // The refreshed rider record from the server carries the new balance.
    await refreshRiderDashboard();
  } catch (err) {
    alert('Network error accepting order.');
  }
}

async function advanceOrderStage(orderId, nextStatus) {
  try {
    const { ok, data } = await api(`/api/orders/${encodeURIComponent(orderId)}/status`, {
      method: 'PATCH',
      body: { status: nextStatus }
    });
    if (!ok) {
      alert(data.error || 'Failed to update delivery status.');
      return;
    }

    if (nextStatus === 'delivered') stopGpsBroadcast();
    await refreshRiderDashboard();
  } catch (err) {
    alert('Network error updating order stage.');
  }
}

function startRiderGpsBroadcast(orderId) {
  if (!navigator.geolocation) return;
  stopGpsBroadcast();

  gpsWatchId = navigator.geolocation.watchPosition(
    async (pos) => {
      try {
        await api(`/api/orders/${encodeURIComponent(orderId)}/location`, {
          method: 'PATCH',
          body: { lat: pos.coords.latitude, lng: pos.coords.longitude }
        });
      } catch {
        // Ignore a failed ping; the next position update will retry.
      }
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
  );
}

// ---------- Rider dashboard rendering ----------
function renderRiderDashboard() {
  const { rider, orders } = appState;
  if (!rider) return;

  renderRiderHeader(rider);
  renderAvailableJobs(orders.filter((o) => o.status === 'searching'));
  renderMyJobs(orders.filter((o) => o.riderId === rider.id));
}

function renderRiderHeader(rider) {
  setText('riderHeaderName', rider.name);
  setText(
    'riderHeaderMeta',
    `ID: ${rider.idCardNumber} · Plate: ${rider.vehiclePlate} · Area: ${rider.area} · ★ ${Number(rider.rating || 5).toFixed(1)}`
  );
  setText('riderCreditBalance', money(rider.creditBalanceGhs));
}

const JOB_CARD_STYLE = 'border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; margin-bottom: 10px;';

function renderAvailableJobs(openOrders) {
  setText('availableJobsCount', `${openOrders.length} Open`);
  const list = $('riderAvailableList');
  if (!list) return;

  if (openOrders.length === 0) {
    list.innerHTML = '<p class="sub-text">No pending student gas orders right now.</p>';
    return;
  }

  list.innerHTML = openOrders
    .map(
      (o) => `
      <div class="job-card" style="${JOB_CARD_STYLE}">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <strong>${escapeHtml(o.id)} · ${escapeHtml(o.estimatedKg)} kg Refill</strong>
          <span class="trust-pill">Earn ${money(o.riderPayout || o.deliveryFee)}</span>
        </div>
        <div class="sub-text" style="margin-top:6px;">
          <div><strong>Student:</strong> ${escapeHtml(o.studentName)} (${escapeHtml(o.studentPhone)}) · Area: ${escapeHtml(o.studentArea || o.zoneName)}</div>
          <div><strong>Drop-off:</strong> ${escapeHtml(o.hostel)}</div>
          <div><strong>Station:</strong> ${escapeHtml(o.stationName)} · Note: ${escapeHtml(o.cylinderNote || 'None')}</div>
        </div>
        <div style="margin-top:10px;">
          <button type="button" class="btn-pay-confirm accept-order-btn" data-id="${escapeHtml(o.id)}">
            Accept Order (Pay ${money(RIDER_FEE_GHS)} Credit)
          </button>
        </div>
      </div>`
    )
    .join('');

  list.querySelectorAll('.accept-order-btn').forEach((btn) => {
    btn.addEventListener('click', () => acceptOrder(btn.dataset.id));
  });
}

function renderMyJobs(myOrders) {
  const list = $('riderMyJobsList');
  if (!list) return;

  if (myOrders.length === 0) {
    list.innerHTML = '<p class="sub-text">You have not accepted any deliveries yet.</p>';
    return;
  }

  list.innerHTML = myOrders
    .map((o) => {
      const step = RIDER_STAGE_FLOW[o.status];
      const action = step
        ? `<button type="button" class="btn-pay-confirm advance-stage-btn" data-id="${escapeHtml(o.id)}" data-next="${step.next}">${step.label}</button>`
        : `<span class="sub-text">✓ Completed ${o.riderRating ? `· Rated ${escapeHtml(o.riderRating)} ★` : ''}</span>`;

      return `
      <div class="job-card" style="${JOB_CARD_STYLE}">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <strong>${escapeHtml(o.id)} · ${escapeHtml(o.estimatedKg)} kg (${escapeHtml(o.studentName)})</strong>
          <span class="trust-pill">${escapeHtml(o.status.replaceAll('_', ' ').toUpperCase())}</span>
        </div>
        <div class="sub-text" style="margin-top:6px;">
          <div><strong>Phone:</strong> ${escapeHtml(o.studentPhone)} · <strong>Area:</strong> ${escapeHtml(o.studentArea || o.zoneName)}</div>
          <div><strong>Location:</strong> ${escapeHtml(o.hostel)}</div>
          <div><strong>Security Tag:</strong> <code>${escapeHtml(o.securityTag)}</code> · <strong>Delivery PIN:</strong> <code>${escapeHtml(o.deliveryPin)}</code></div>
        </div>
        <div style="margin-top:10px;">${action}</div>
      </div>`;
    })
    .join('');

  list.querySelectorAll('.advance-stage-btn').forEach((btn) => {
    btn.addEventListener('click', () => advanceOrderStage(btn.dataset.id, btn.dataset.next));
  });
}

// ==================== REAL-TIME SSE STREAM ====================
function connectLiveStream() {
  try {
    const evtSource = new EventSource('/api/stream');
    evtSource.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type !== 'refresh') return;
        if (appState.student) await loadStudentHistory();
        if (appState.rider) await refreshRiderDashboard();
      } catch {
        // Ignore malformed stream messages.
      }
    };
  } catch {
    // Live updates are optional; the app still works without them.
  }
}
