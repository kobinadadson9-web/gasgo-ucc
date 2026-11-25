(function() {
  const STORAGE_KEY = "gasgo_ucc_secure_db_v2";
  let memDb = JSON.parse(JSON.stringify(window.__SEED_DB__));
  try {
    const saved = window.localStorage && window.localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && parsed.config && parsed.security) memDb = parsed;
    }
  } catch (_) {}

  function saveDb() {
    try {
      if (window.localStorage) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(memDb));
    } catch (_) {}
  }

  function studentOrder(o) {
    const {commissionPercent, platformProfit, riderPayout, riderId, ...safe} = o;
    return safe;
  }

  function round2(n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  }

  function getAuthRoleFromHeaders(headers) {
    const h = headers || {};
    const code = String(h["x-auth-code"] || "").trim();
    const role = String(h["x-auth-role"] || "").trim();
    if (!code) return "student";
    if (role === "owner" && code === memDb.security.ownerPassword) return "owner";
    if ((role === "rider" || role === "owner") && (code === memDb.security.riderPin || code === memDb.security.ownerPassword)) {
      return role === "owner" && code === memDb.security.ownerPassword ? "owner" : "rider";
    }
    return "student";
  }

  function computeStats(db) {
    let grossVolume = 0, totalGasCost = 0, totalDeliveryFees = 0, totalOwnerProfit = 0, totalRiderPayouts = 0, deliveredCount = 0, activeCount = 0;
    for (const o of (db.orders || [])) {
      if (o.status === "cancelled") continue;
      grossVolume += Number(o.totalPaid || 0);
      totalGasCost += Number(o.gasCost || 0);
      totalDeliveryFees += Number(o.deliveryFee || 0);
      totalOwnerProfit += Number(o.platformProfit || 0);
      totalRiderPayouts += Number(o.riderPayout || 0);
      if (o.status === "delivered") deliveredCount++; else activeCount++;
    }
    return {
      totalOrders: db.orders.length,
      deliveredCount,
      activeCount,
      grossVolume: round2(grossVolume),
      totalGasCost: round2(totalGasCost),
      totalDeliveryFees: round2(totalDeliveryFees),
      totalOwnerProfit: round2(totalOwnerProfit),
      totalRiderPayouts: round2(totalRiderPayouts)
    };
  }

  const origFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = async function(url, opts = {}) {
    const rawUrl = String(url);
    if (!rawUrl.startsWith("/api/")) {
      return origFetch ? origFetch(url, opts) : Promise.reject(new Error("Offline"));
    }
    const [pathOnly, queryString] = rawUrl.split("?");
    const params = new URLSearchParams(queryString || "");
    const method = (opts.method || "GET").toUpperCase();
    const body = opts.body ? JSON.parse(opts.body) : {};
    const role = getAuthRoleFromHeaders(opts.headers);

    const jsonRes = (obj, status = 200) => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => obj
    });

    if (pathOnly === "/api/auth/login" && method === "POST") {
      const code = String(body.code || "").trim();
      if (body.role === "owner") {
        return code === memDb.security.ownerPassword
          ? jsonRes({ ok: true, role: "owner" })
          : jsonRes({ error: "Incorrect Owner Password." }, 401);
      }
      if (body.role === "rider") {
        return (code === memDb.security.riderPin || code === memDb.security.ownerPassword)
          ? jsonRes({ ok: true, role: "rider" })
          : jsonRes({ error: "Incorrect 4-digit Rider PIN." }, 401);
      }
      return jsonRes({ error: "Invalid role." }, 400);
    }

    if (pathOnly === "/api/state" && method === "GET") {
      if (role === "owner") {
        return jsonRes({
          role: "owner",
          config: memDb.config,
          riders: memDb.riders,
          orders: memDb.orders,
          stats: computeStats(memDb),
          securityMeta: { riderPin: memDb.security.riderPin }
        });
      }
      if (role === "rider") {
        return jsonRes({
          role: "rider",
          config: memDb.config,
          riders: memDb.riders,
          orders: memDb.orders,
          stats: null
        });
      }
      const myIds = (params.get("myOrders") || "").split(",").filter(Boolean);
      const studentOrders = memDb.orders.filter(o => myIds.includes(o.id)).map(studentOrder);
      return jsonRes({
        role: "student",
        config: (({commissionPercent, ...publicConfig}) => publicConfig)(memDb.config),
        riders: [],
        orders: studentOrders,
        stats: null
      });
    }

    if (pathOnly === "/api/orders/lookup" && method === "GET") {
      const q = (params.get("q") || "").trim().toLowerCase();
      const digits = q.replace(/\D/g, "");
      const found = memDb.orders.find(o => {
        if (o.id.toLowerCase() === q) return true;
        const pDigits = String(o.studentPhone || "").replace(/\D/g, "");
        return digits.length >= 7 && pDigits.endsWith(digits.slice(-9));
      });
      if (!found) return jsonRes({ error: "No order found for that Order ID or phone number." }, 404);
      return jsonRes({ order: studentOrder(found) });
    }

    if (pathOnly === "/api/orders" && method === "POST") {
      const zone = memDb.config.zones.find(z => z.id === body.zoneId);
      const cylinder = memDb.config.cylinders.find(c => c.id === body.cylinderId);
      const station = memDb.config.stations.find(s => s.id === body.stationId) || memDb.config.stations[0];
      if (!zone || !cylinder) return jsonRes({ error: "Invalid zone or cylinder" }, 400);

      let gasCost = round2(cylinder.kg * memDb.config.lpgPricePerKg);
      let estimatedKg = cylinder.kg;
      if (body.refillMode === "custom") {
        const customAmt = Math.max(20, Number(body.customGasAmount) || 20);
        gasCost = round2(Math.min(customAmt, gasCost));
        estimatedKg = round2(gasCost / memDb.config.lpgPricePerKg);
      }
      const isExpress = body.speedTier === "express";
      const deliveryFee = round2(zone.deliveryFee + (isExpress ? memDb.config.expressSurcharge : 0));
      const totalPaid = round2(gasCost + deliveryFee);
      const commissionPercent = Number(memDb.config.commissionPercent);
      const platformProfit = round2(deliveryFee * (commissionPercent / 100));
      const riderPayout = round2(deliveryFee - platformProfit);

      const newOrder = {
        id: "ORD-UCC-" + (8045 + memDb.orders.length),
        createdAt: new Date().toISOString(),
        studentName: body.studentName,
        studentPhone: body.studentPhone,
        zoneId: zone.id,
        zoneName: zone.name,
        hostel: body.hostel,
        stationId: station.id,
        stationName: station.name,
        cylinderId: cylinder.id,
        cylinderLabel: cylinder.label,
        refillMode: body.refillMode === "custom" ? "custom" : "full",
        estimatedKg,
        cylinderNote: body.cylinderNote || "Standard student cylinder",
        speedTier: isExpress ? "express" : "standard",
        gasCost,
        deliveryFee,
        totalPaid,
        commissionPercent,
        platformProfit,
        riderPayout,
        paymentMethod: body.paymentMethod || "MTN Mobile Money",
        paymentRef: "PAY-MOMO-" + Math.floor(100000 + Math.random() * 900000),
        paymentStatus: "paid",
        securityTag: "TAG-" + Math.floor(100 + Math.random() * 900),
        deliveryPin: String(Math.floor(1000 + Math.random() * 9000)),
        status: "searching",
        riderId: null,
        riderName: null,
        riderPhone: null,
        riderVehicle: null
      };
      memDb.orders.unshift(newOrder);
      saveDb();
      return jsonRes({ order: studentOrder(newOrder) }, 201);
    }

    const statusMatch = pathOnly.match(/^\/api\/orders\/([^/]+)\/status$/);
    if (statusMatch && method === "PATCH") {
      if (role !== "rider" && role !== "owner") return jsonRes({ error: "Rider PIN required" }, 403);
      const orderId = decodeURIComponent(statusMatch[1]);
      const order = memDb.orders.find(o => o.id === orderId);
      if (!order) return jsonRes({ error: "Order not found" }, 404);
      if (body.status === "accepted" && body.riderId) {
        const rider = memDb.riders.find(r => r.id === body.riderId);
        if (rider) {
          order.riderId = rider.id;
          order.riderName = rider.name;
          order.riderPhone = rider.phone;
          order.riderVehicle = rider.vehicle;
        }
      }
      if (body.status === "delivered" && order.status !== "delivered" && order.riderId) {
        const rider = memDb.riders.find(r => r.id === order.riderId);
        if (rider) rider.tripsCount = Number(rider.tripsCount || 0) + 1;
      }
      order.status = body.status;
      saveDb();
      return jsonRes({ order });
    }

    if (pathOnly === "/api/config" && method === "PUT") {
      if (role !== "owner") return jsonRes({ error: "Owner password required" }, 403);
      if (body.lpgPricePerKg !== undefined) memDb.config.lpgPricePerKg = round2(body.lpgPricePerKg);
      if (body.commissionPercent !== undefined) memDb.config.commissionPercent = round2(body.commissionPercent);
      if (body.expressSurcharge !== undefined) memDb.config.expressSurcharge = round2(body.expressSurcharge);
      if (Array.isArray(body.zones)) {
        for (const z of body.zones) {
          const target = memDb.config.zones.find(item => item.id === z.id);
          if (target && z.deliveryFee !== undefined) target.deliveryFee = round2(z.deliveryFee);
        }
      }
      saveDb();
      return jsonRes({ config: memDb.config, stats: computeStats(memDb) });
    }

    if (pathOnly === "/api/security" && method === "PUT") {
      if (role !== "owner") return jsonRes({ error: "Owner password required" }, 403);
      if (body.newOwnerPassword && body.newOwnerPassword.length < 8) return jsonRes({error: "Owner password must contain at least 8 characters."}, 400);
      if (body.newRiderPin && !/^\d{4}$/.test(body.newRiderPin)) return jsonRes({error: "Rider PIN must contain exactly 4 digits."}, 400);
      if (body.newOwnerPassword && body.newOwnerPassword.length >= 8) memDb.security.ownerPassword = body.newOwnerPassword;
      if (body.newRiderPin && body.newRiderPin.length >= 4) memDb.security.riderPin = body.newRiderPin;
      saveDb();
      return jsonRes({ ok: true });
    }

    if (pathOnly === "/api/riders" && method === "POST") {
      if (role !== "owner") return jsonRes({ error: "Owner password required" }, 403);
      const nr = {
        id: "rider-" + Date.now(),
        name: body.name,
        phone: body.phone,
        vehicle: body.vehicle,
        rating: 5.0,
        tripsCount: 0,
        online: true
      };
      memDb.riders.push(nr);
      saveDb();
      return jsonRes({ rider: nr }, 201);
    }

    return jsonRes({ error: "Not found" }, 404);
  };

  window.EventSource = function() { return { close() {} }; };
})();
