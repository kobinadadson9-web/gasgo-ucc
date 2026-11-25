const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || '';
const ACCEPT_ORDER_FEE = 2.00; // GH₵ 2.00 deducted from rider wallet per accepted order

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function round2(num) {
  return Math.round((Number(num) + Number.EPSILON) * 100) / 100;
}

function ensureDbExists() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_PATH)) {
    const defaultDb = {
      security: { ownerPassword: 'uccboss2026', riderPin: '2222' },
      config: {
        platformName: 'GasGo UCC',
        lpgPricePerKg: 14.5,
        acceptOrderFee: ACCEPT_ORDER_FEE,
        expressSurcharge: 5,
        stations: [
          { id: 'st-science', name: 'Science Market LPG Station', lat: 5.1048, lng: -1.2815 },
          { id: 'st-amamoma', name: 'Amamoma Junction Gas Point', lat: 5.1152, lng: -1.2910 }
        ],
        cylinders: [
          { id: 'cyl-3kg', label: '3kg Student Cylinder', kg: 3 },
          { id: 'cyl-6kg', label: '6kg Medium Cylinder', kg: 6 },
          { id: 'cyl-14kg', label: '14.5kg Large Cylinder', kg: 14.5 }
        ],
        zones: [
          { id: 'z-valco', name: 'Valco / Casford / Adehye', deliveryFee: 8, defaultStation: 'st-science', lat: 5.1065, lng: -1.2840 },
          { id: 'z-amamoma', name: 'Amamoma / Kwapro / Kwasipra', deliveryFee: 10, defaultStation: 'st-amamoma', lat: 5.1170, lng: -1.2925 },
          { id: 'z-ayensu', name: 'Ayensu / Apewosika', deliveryFee: 12, defaultStation: 'st-science', lat: 5.1012, lng: -1.2755 }
        ]
      },
      students: [],
      riders: [],
      orders: [],
      walletTransactions: []
    };
    fs.writeFileSync(DB_PATH, JSON.stringify(defaultDb, null, 2), 'utf8');
  }
}

function readDb() {
  ensureDbExists();
  const raw = fs.readFileSync(DB_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed.security) parsed.security = { ownerPassword: 'uccboss2026', riderPin: '2222' };
  if (!parsed.students) parsed.students = [];
  if (!parsed.riders) parsed.riders = [];
  if (!parsed.orders) parsed.orders = [];
  if (!parsed.walletTransactions) parsed.walletTransactions = [];
  return parsed;
}

function writeDb(data) {
  ensureDbExists();
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
}

// Helper to verify Paystack transaction via Paystack API
function verifyPaystackReference(reference) {
  return new Promise((resolve, reject) => {
    if (!PAYSTACK_SECRET_KEY) {
      // Local dev fallback if PAYSTACK_SECRET_KEY is not set in environment yet
      return resolve({ verified: true, simulated: true, amountGhs: null });
    }
    const options = {
      hostname: 'api.paystack.co',
      port: 443,
      path: `/transaction/verify/${encodeURIComponent(reference)}`,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`
      }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (parsed.status && parsed.data && parsed.data.status === 'success') {
            resolve({
              verified: true,
              simulated: false,
              amountGhs: round2(parsed.data.amount / 100)
            });
          } else {
            resolve({ verified: false, message: parsed.message || 'Payment not verified.' });
          }
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function getAuthRole(req, db) {
  const code = String(req.headers['x-auth-code'] || req.query.authCode || '').trim();
  const requestedRole = String(req.headers['x-auth-role'] || req.query.authRole || '').trim();
  if (!code) return 'guest';

  if (code === db.security.ownerPassword && requestedRole === 'owner') return 'owner';
  if (requestedRole === 'rider') {
    const rider = db.riders.find((r) => r.id === code || r.idCardNumber === code);
    if (rider || code === db.security.riderPin || code === db.security.ownerPassword) return 'rider';
  }
  if (requestedRole === 'student') {
    const student = db.students.find((s) => s.email === code.toLowerCase());
    if (student) return 'student';
  }
  return 'guest';
}

function sanitizeOrderForStudent(o) {
  return {
    id: o.id,
    createdAt: o.createdAt,
    studentEmail: o.studentEmail,
    studentName: o.studentName,
    studentPhone: o.studentPhone,
    studentArea: o.studentArea,
    zoneId: o.zoneId,
    zoneName: o.zoneName,
    hostel: o.hostel,
    roomNumber: o.roomNumber,
    studentLocation: o.studentLocation || null,
    stationId: o.stationId,
    stationName: o.stationName,
    stationLocation: o.stationLocation || null,
    cylinderId: o.cylinderId,
    cylinderLabel: o.cylinderLabel,
    customKg: o.customKg,
    speedTier: o.speedTier,
    gasCost: o.gasCost,
    deliveryFee: o.deliveryFee,
    totalPaid: o.totalPaid,
    paymentMethod: o.paymentMethod,
    paymentRef: o.paymentRef,
    paymentStatus: o.paymentStatus,
    securityTag: o.securityTag,
    deliveryPin: o.deliveryPin,
    status: o.status,
    riderId: o.riderId,
    riderName: o.riderName,
    riderPhone: o.riderPhone,
    riderVehicle: o.riderVehicle,
    riderPlate: o.riderPlate,
    riderArea: o.riderArea,
    riderLocation: o.riderLocation || null,
    rating: o.rating || null,
    ratingReview: o.ratingReview || null
  };
}

function computeStats(db) {
  const orders = db.orders || [];
  let grossVolume = 0;
  let totalGasCost = 0;
  let totalDeliveryFees = 0;
  let totalOwnerProfit = 0;
  let deliveredCount = 0;
  let activeCount = 0;

  for (const o of orders) {
    if (o.status === 'cancelled') continue;
    grossVolume += Number(o.totalPaid || 0);
    totalGasCost += Number(o.gasCost || 0);
    totalDeliveryFees += Number(o.deliveryFee || 0);
    totalOwnerProfit += Number(o.platformProfit || 0);
    if (o.status === 'delivered') {
      deliveredCount++;
    } else {
      activeCount++;
    }
  }

  return {
    totalOrders: orders.length,
    deliveredCount,
    activeCount,
    grossVolume: round2(grossVolume),
    totalGasCost: round2(totalGasCost),
    totalDeliveryFees: round2(totalDeliveryFees),
    totalOwnerProfit: round2(totalOwnerProfit)
  };
}

// SSE live updates for map tracking & order status changes
const sseClients = new Set();

function broadcastRefresh(eventPayload = { type: 'refresh' }) {
  const payload = JSON.stringify(eventPayload);
  for (const res of sseClients) {
    try {
      res.write(`data: ${payload}\n\n`);
    } catch (_) {
      sseClients.delete(res);
    }
  }
}

app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  sseClients.add(res);
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

  const keepAlive = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch (_) {
      clearInterval(keepAlive);
      sseClients.delete(res);
    }
  }, 20000);

  req.on('close', () => {
    clearInterval(keepAlive);
    sseClients.delete(res);
  });
});

// ==========================================
// 1. PORTAL LOGINS (STUDENT, RIDER, OWNER)
// ==========================================

// Student Portal Login (Gmail + Phone + Area)
app.post('/api/auth/student', (req, res) => {
  try {
    const db = readDb();
    const { email, name, phone, area } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();

    if (!cleanEmail || !cleanEmail.includes('@')) {
      return res.status(400).json({ error: 'Please enter a valid Gmail address.' });
    }

    let student = db.students.find((s) => s.email === cleanEmail);

    if (!student) {
      // First-time login requires phone and area for rider identification
      if (!phone || !area) {
        return res.status(400).json({
          requiresSetup: true,
          error: 'First-time login: Please provide your phone number and UCC area for rider identification.'
        });
      }
      student = {
        id: `stu-${Date.now()}`,
        email: cleanEmail,
        name: String(name || cleanEmail.split('@')[0]).trim(),
        phone: String(phone).trim(),
        area: String(area).trim(),
        createdAt: new Date().toISOString()
      };
      db.students.push(student);
    } else {
      // Update profile details if provided on subsequent login
      if (phone) student.phone = String(phone).trim();
      if (area) student.area = String(area).trim();
      if (name) student.name = String(name).trim();
      student.lastLoginAt = new Date().toISOString();
    }

    writeDb(db);
    const history = db.orders
      .filter((o) => o.studentEmail === student.email || o.studentPhone === student.phone)
      .map(sanitizeOrderForStudent);

    return res.json({ ok: true, role: 'student', student, orders: history });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Student login failed.' });
  }
});
// Rider Portal Login (Verified ID Card Number + Vehicle Plate + Area)
app.post('/api/riders/login', (req, res) => {
  try {
    const db = readDb();
    const { name, phone, idCardNumber, vehiclePlate, area, vehicleType } = req.body || {};
    const cleanId = String(idCardNumber || '').trim().toUpperCase();
    const cleanPlate = String(vehiclePlate || '').trim().toUpperCase();
    const cleanArea = String(area || '').trim();

    if (!name || !phone || !cleanId || !cleanPlate || !cleanArea) {
      return res.status(400).json({
        error: 'Name, phone, verified ID card number, vehicle number plate, and area are required.'
      });
    }

    // Validate Ghana Card (GHA-XXXXXXXXX-X) or standard government/student ID format
    const validIdPattern = /^(GHA-\d{9}-\d|[A-Z0-9-]{6,20})$/;
    if (!validIdPattern.test(cleanId)) {
      return res.status(400).json({
        error: 'Invalid ID card format. Use Ghana Card (e.g. GHA-123456789-0) or valid ID number.'
      });
    }

    // Validate Ghana vehicle number plate format (e.g. CR 1234-24 or GR-4521-23)
    const validPlatePattern = /^[A-Z]{2,3}[\s-]?\d{1,4}[\s-]?\d{2}$/;
    if (!validPlatePattern.test(cleanPlate)) {
      return res.status(400).json({
        error: 'Invalid vehicle number plate format (e.g. CR 1234-24).'
      });
    }

    let rider = db.riders.find(
      (r) => r.idCardNumber === cleanId || r.vehiclePlate === cleanPlate
    );

    if (!rider) {
      rider = {
        id: `rider-${Date.now()}`,
        name: String(name).trim(),
        phone: String(phone).trim(),
        idCardNumber: cleanId,
        vehiclePlate: cleanPlate,
        vehicle: `${vehicleType || 'Motorbike'} (${cleanPlate})`,
        area: cleanArea,
        verified: true,
        creditBalanceGhs: 0,
        rating: 5.0,
        ratingCount: 0,
        tripsCount: 0,
        online: true,
        createdAt: new Date().toISOString()
      };
      db.riders.push(rider);
    } else {
      rider.name = String(name).trim();
      rider.phone = String(phone).trim();
      rider.area = cleanArea;
      if (vehicleType) rider.vehicle = `${vehicleType} (${cleanPlate})`;
      rider.online = true;
    }

    writeDb(db);
    broadcastRefresh();
    return res.json({ ok: true, role: 'rider', rider });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Rider verification failed.' });
  }
});

// Rider Portal: Verify Paystack top-up reference & credit rider wallet
app.post('/api/riders/topup/verify', async (req, res) => {
  try {
    const db = readDb();
    const { riderId, reference, amountGhs } = req.body || {};
    const cleanRef = String(reference || '').trim();

    if (!riderId || !cleanRef) {
      return res.status(400).json({ error: 'Rider ID and Paystack payment reference are required.' });
    }

    const rider = db.riders.find((r) => r.id === riderId);
    if (!rider) {
      return res.status(404).json({ error: 'Rider profile not found.' });
    }

    if (!db.walletTransactions) db.walletTransactions = [];
    const existingTx = db.walletTransactions.find((tx) => tx.reference === cleanRef);
    if (existingTx) {
      return res.json({
        ok: true,
        alreadyApplied: true,
        balanceAfterGhs: round2(rider.creditBalanceGhs || 0)
      });
    }

    let verifiedAmount = round2(Number(amountGhs || 0));
    let channel = 'paystack';

    const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
    const isLocalTestRef = cleanRef.startsWith('LOCAL-TEST-');

    if (paystackSecret && !isLocalTestRef) {
      let verifyResp;
      try {
        verifyResp = await fetch(
          `https://paystack.co{encodeURIComponent(cleanRef)}`,
          {
            headers: { Authorization: `Bearer ${paystackSecret}` }
          }
        );
      } catch (netErr) {
        return res.status(502).json({
          error: 'Could not reach Paystack servers. Check your internet connection and try again.'
        });
      }

      const verifyData = await verifyResp.json();
      if (!verifyResp.ok || !verifyData.status || verifyData.data?.status !== 'success') {
        return res.status(400).json({
          error: verifyData.message || 'Paystack transaction verification failed.'
        });
      }
      verifiedAmount = round2(Number(verifyData.data.amount || 0) / 100);
      channel = verifyData.data.channel || 'paystack';
    }

    if (verifiedAmount <= 0) {
      return res.status(400).json({ error: 'Top-up amount must be greater than GH₵ 0.00.' });
    }

    const currentBalance = Number(rider.creditBalanceGhs || 0);
    const nextBalance = round2(currentBalance + verifiedAmount);
    rider.creditBalanceGhs = nextBalance;

    db.walletTransactions.unshift({
      id: `wtx-${Date.now()}`,
      riderId: rider.id,
      riderName: rider.name,
      type: 'topup',
      amountGhs: verifiedAmount,
      balanceAfterGhs: nextBalance,
      reference: cleanRef,
      channel,
      createdAt: new Date().toISOString()
    });

    writeDb(db);
    broadcastRefresh();

    return res.json({
      ok: true,
      alreadyApplied: false,
      creditedGhs: verifiedAmount,
      balanceAfterGhs: nextBalance
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to verify Paystack top-up.' });
  }
});


// Live Map Tracking: Rider updates GPS coordinates & student fetches live rider location
app.patch('/api/orders/:id/location', (req, res) => {
  try {
    const db = readDb();
    const order = db.orders.find((o) => o.id === req.params.id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }
    const { lat, lng } = req.body || {};
    if (lat !== undefined && lng !== undefined) {
      order.riderLat = Number(lat);
      order.riderLng = Number(lng);
      order.locationUpdatedAt = new Date().toISOString();
      writeDb(db);
      broadcastRefresh();
    }
    return res.json({
      orderId: order.id,
      status: order.status,
      riderLat: order.riderLat,
      riderLng: order.riderLng,
      studentLat: order.studentLat,
      studentLng: order.studentLng
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to update rider location.' });
  }
});

// Student Portal: Rate rider after delivery
app.post('/api/orders/:id/rate', (req, res) => {
  try {
    const db = readDb();
    const order = db.orders.find((o) => o.id === req.params.id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }
    if (order.status !== 'delivered') {
      return res.status(400).json({ error: 'You can only rate a rider after the gas is delivered.' });
    }
    if (order.riderRating) {
      return res.status(400).json({ error: 'You have already rated this delivery.' });
    }

    const stars = Number(req.body?.rating);
    const comment = String(req.body?.comment || '').trim();
    if (!stars || stars < 1 || stars > 5) {
      return res.status(400).json({ error: 'Please select a rating between 1 and 5 stars.' });
    }

    order.riderRating = stars;
    order.ratingComment = comment;

    if (order.riderId) {
      const rider = db.riders.find((r) => r.id === order.riderId);
      if (rider) {
        const prevCount = Number(rider.ratingCount || 0);
        const prevAvg = Number(rider.rating || 5.0);
        const newCount = prevCount + 1;
        rider.rating = round2((prevAvg * prevCount + stars) / newCount);
        rider.ratingCount = newCount;
      }
    }

    writeDb(db);
    broadcastRefresh();
    return res.json({ ok: true, order });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to submit rider rating.' });
  }
});

ensureDbExists();

const server = app.listen(PORT, HOST, () => {
  console.log(`\nGasGo UCC server running at: http://${HOST}:${PORT}\n`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Stop the other server (Ctrl+C) and try again.`);
  } else {
    console.error('Server error:', err);
  }
});
