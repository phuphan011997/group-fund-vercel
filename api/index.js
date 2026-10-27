// ============================================================
//  /api/index.js — toàn bộ API chạy trong một serverless function.
//  vercel.json chuyển mọi đường dẫn /api/* về đây kèm tham số ?path=
//
//  Xác thực:
//    Mỗi người có tài khoản riêng (username + mật khẩu). Đăng nhập xong
//    nhận một session token, hạn 30 ngày, gửi kèm ở header Authorization.
//    Tài khoản admin phải nhập thêm ADMIN_SECRET mỗi lần đăng nhập.
//
//  Đường dẫn:
//    GET    /api/health                       kiểm tra, không cần đăng nhập
//    POST   /api/auth/login                   {username, password, adminSecret?}
//    POST   /api/auth/logout
//    GET    /api/me                           thông tin phiên + chuyến được gán
//    PUT    /api/me/trip                      {tripId} người dùng tự đổi chuyến
//    GET    /api/users                        admin: danh sách tài khoản
//    PUT    /api/users/:username              admin: tạo hoặc sửa tài khoản
//    DELETE /api/users/:username              admin: xoá tài khoản
//    GET    /api/trips                        admin: toàn bộ chuyến
//    GET    /api/trips/:tripId/state          đọc dữ liệu một chuyến
//    PUT    /api/trips/:tripId/meta/trip      ghi thông tin chung
//    PUT    /api/trips/:tripId/:coll/:id      ghi một document
//    DELETE /api/trips/:tripId/:coll/:id      xoá một document
//
//  Biến môi trường trên Vercel:
//    MONGODB_URI    chuỗi kết nối Atlas
//    ADMIN_SECRET   mã bí mật admin phải nhập thêm khi đăng nhập
// ============================================================

const { MongoClient } = require("mongodb");
const crypto = require("crypto");

const DB_NAME = "group_fund";
const COLLS = new Set(["members", "expenses", "plans", "logs"]);
const SESSION_DAYS = 30;

let cached = global._groupFundMongo;
if (!cached) cached = global._groupFundMongo = { client: null, promise: null };

async function getDb() {
  if (cached.client) return cached.client.db(DB_NAME);
  if (!cached.promise) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error("missing MONGODB_URI");
    cached.promise = new MongoClient(uri, { maxPoolSize: 5 }).connect();
  }
  cached.client = await cached.promise;
  return cached.client.db(DB_NAME);
}

function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body) {
    try { return JSON.parse(req.body); } catch (e) { return {}; }
  }
  return {};
}

const strip = (arr) => arr.map((doc) => {
  const { _id, tripId, ...rest } = doc;
  return { id: _id, ...rest };
});

// Đường dẫn tới qua tham số ?path=trips/trip-1/state do vercel.json chuyển sang.
// Hàm này nhận cả dạng chuỗi lẫn dạng mảng, và tự đọc từ req.url nếu thiếu cả hai.
function pathParts(req) {
  let raw = [].concat((req.query && req.query.path) || []);
  if (raw.length === 1 && String(raw[0]).indexOf("/") !== -1) {
    raw = String(raw[0]).split("/");
  }
  if (!raw.length) {
    const p = String(req.url || "").split("?")[0].replace(/^\/+/, "").replace(/^api\/?/, "");
    raw = p ? p.split("/") : [];
  }
  return raw.filter(Boolean).map(function (x) {
    try { return decodeURIComponent(x); } catch (e) { return x; }
  });
}

// ---------- mật khẩu ----------
// scrypt có sẵn trong Node, không cần cài thêm thư viện.
function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), s, 64).toString("hex");
  return { salt: s, hash };
}
function verifyPassword(password, salt, expected) {
  if (!salt || !expected) return false;
  const { hash } = hashPassword(password, salt);
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
function safeEqual(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}
function normUser(u) {
  return String(u || "").trim().toLowerCase();
}
function publicUser(u) {
  return {
    username: u._id,
    name: u.name || u._id,
    role: u.role || "member",
    tripIds: u.tripIds || [],
    currentTripId: u.currentTripId || (u.tripIds || [])[0] || null
  };
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();

  const parts = pathParts(req);

  // ---- /api/health: kiểm tra nhanh, không cần đăng nhập ----
  if (parts[0] === "health") {
    const out = {
      route: "ok",
      hasMongoUri: !!process.env.MONGODB_URI,
      hasAdminSecret: !!process.env.ADMIN_SECRET,
      db: "chua-thu"
    };
    if (out.hasMongoUri) {
      try {
        const d = await getDb();
        await d.command({ ping: 1 });
        out.db = "ket-noi-duoc";
        out.userCount = await d.collection("users").countDocuments();
      } catch (e) {
        out.db = "loi";
        out.dbError = String((e && e.message) || e).slice(0, 200);
      }
    }
    return res.status(200).json(out);
  }

  let db;
  try {
    db = await getDb();
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "db_unavailable" });
  }

  const users = () => db.collection("users");
  const sessions = () => db.collection("sessions");

  try {
    // ================= ĐĂNG NHẬP =================
    if (req.method === "POST" && parts[0] === "auth" && parts[1] === "login") {
      const b = readBody(req);
      const username = normUser(b.username);
      const password = String(b.password || "");
      if (!username || !password) {
        return res.status(400).json({ error: "missing_credentials" });
      }

      let user = await users().findOne({ _id: username });

      // Tài khoản admin đầu tiên: khi chưa có ai trong hệ thống, người nhập
      // đúng ADMIN_SECRET sẽ được tạo thành admin.
      if (!user) {
        const total = await users().countDocuments();
        const secret = process.env.ADMIN_SECRET || "";
        if (total === 0 && secret && safeEqual(b.adminSecret, secret)) {
          const { salt, hash } = hashPassword(password);
          user = {
            _id: username, name: b.name || username, role: "admin",
            salt: salt, passwordHash: hash, tripIds: [], currentTripId: null,
            createdAt: new Date()
          };
          await users().insertOne(user);
        } else {
          return res.status(401).json({ error: "invalid_login" });
        }
      } else if (!verifyPassword(password, user.salt, user.passwordHash)) {
        return res.status(401).json({ error: "invalid_login" });
      }

      // Admin phải nhập đúng mã bí mật mỗi lần đăng nhập.
      if (user.role === "admin") {
        const secret = process.env.ADMIN_SECRET || "";
        if (!secret || !safeEqual(b.adminSecret, secret)) {
          return res.status(401).json({ error: "admin_secret_required" });
        }
      }

      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000);
      await sessions().insertOne({
        _id: token, username: user._id, createdAt: new Date(), expiresAt: expiresAt
      });

      const tripIds = user.tripIds || [];
      const trips = tripIds.length
        ? await db.collection("trips").find({ _id: { $in: tripIds } }).toArray()
        : [];
      return res.status(200).json({
        token: token,
        expiresAt: expiresAt.toISOString(),
        user: publicUser(user),
        trips: trips.map((t) => ({ id: t._id, name: t.name }))
      });
    }

    // ================= KIỂM TRA PHIÊN =================
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/, "");
    if (!token) return res.status(401).json({ error: "unauthorized" });

    const session = await sessions().findOne({ _id: token });
    if (!session) return res.status(401).json({ error: "unauthorized" });
    if (session.expiresAt && new Date(session.expiresAt) < new Date()) {
      await sessions().deleteOne({ _id: token });
      return res.status(401).json({ error: "session_expired" });
    }

    const me = await users().findOne({ _id: session.username });
    if (!me) {
      await sessions().deleteOne({ _id: token });
      return res.status(401).json({ error: "unauthorized" });
    }
    const isAdmin = me.role === "admin";
    const myTrips = me.tripIds || [];
    const canUseTrip = (id) => isAdmin || myTrips.indexOf(id) !== -1;

    // ---- đăng xuất ----
    if (req.method === "POST" && parts[0] === "auth" && parts[1] === "logout") {
      await sessions().deleteOne({ _id: token });
      return res.status(204).end();
    }

    // ---- thông tin của tôi ----
    if (req.method === "GET" && parts[0] === "me" && parts.length === 1) {
      const list = isAdmin
        ? await db.collection("trips").find({}).sort({ updatedAt: -1 }).limit(100).toArray()
        : (myTrips.length
            ? await db.collection("trips").find({ _id: { $in: myTrips } }).toArray()
            : []);
      return res.status(200).json({
        user: publicUser(me),
        trips: list.map((t) => ({ id: t._id, name: t.name }))
      });
    }

    // ---- người dùng tự đổi chuyến ----
    if (req.method === "PUT" && parts[0] === "me" && parts[1] === "trip") {
      const b = readBody(req);
      if (!b.tripId) return res.status(400).json({ error: "missing_tripId" });
      if (!canUseTrip(b.tripId)) return res.status(403).json({ error: "trip_not_assigned" });
      await users().updateOne({ _id: me._id }, { $set: { currentTripId: b.tripId } });
      return res.status(204).end();
    }

    // ================= QUẢN TRỊ =================
    if (parts[0] === "users") {
      if (!isAdmin) return res.status(403).json({ error: "forbidden" });

      if (req.method === "GET" && parts.length === 1) {
        const list = await users().find({}).sort({ createdAt: 1 }).limit(200).toArray();
        return res.status(200).json({ users: list.map(publicUser) });
      }

      const target = normUser(parts[1]);
      if (!target) return res.status(404).json({ error: "not_found" });

      if (req.method === "PUT") {
        const b = readBody(req);
        const existing = await users().findOne({ _id: target });
        const set = {};
        if (b.name !== undefined) set.name = String(b.name);
        if (b.role !== undefined) set.role = b.role === "admin" ? "admin" : "member";
        if (Array.isArray(b.tripIds)) set.tripIds = b.tripIds.map(String);
        if (b.password) {
          const { salt, hash } = hashPassword(String(b.password));
          set.salt = salt;
          set.passwordHash = hash;
        }
        if (!existing) {
          if (!b.password) return res.status(400).json({ error: "password_required" });
          set.createdAt = new Date();
          if (!set.name) set.name = target;
          if (!set.role) set.role = "member";
          if (!set.tripIds) set.tripIds = [];
          set.currentTripId = set.tripIds[0] || null;
        } else if (set.tripIds && set.tripIds.indexOf(existing.currentTripId) === -1) {
          // chuyến đang mở bị gỡ khỏi danh sách thì chuyển về chuyến đầu tiên
          set.currentTripId = set.tripIds[0] || null;
        }
        await users().updateOne({ _id: target }, { $set: set }, { upsert: true });
        // đổi mật khẩu hoặc hạ quyền thì huỷ mọi phiên cũ của người đó
        if (b.password || (set.role && existing && set.role !== existing.role)) {
          await sessions().deleteMany({ username: target });
        }
        const saved = await users().findOne({ _id: target });
        return res.status(200).json({ user: publicUser(saved) });
      }

      if (req.method === "DELETE") {
        if (target === me._id) return res.status(400).json({ error: "cannot_delete_self" });
        await users().deleteOne({ _id: target });
        await sessions().deleteMany({ username: target });
        return res.status(204).end();
      }
    }

    // ---- danh sách toàn bộ chuyến, chỉ admin ----
    if (req.method === "GET" && parts[0] === "trips" && parts.length === 1) {
      if (!isAdmin) return res.status(403).json({ error: "forbidden" });
      const list = await db.collection("trips").find({}).sort({ updatedAt: -1 }).limit(100).toArray();
      return res.status(200).json({
        trips: list.map((t) => ({ id: t._id, name: t.name, updatedAt: t.updatedAt || null }))
      });
    }

    // ================= DỮ LIỆU MỘT CHUYẾN =================
    if (parts[0] !== "trips" || !parts[1]) {
      return res.status(404).json({ error: "not_found", seen: parts, url: req.url });
    }
    const tripId = parts[1];
    const rest = parts.slice(2);

    // Tạo chuyến mới là việc của admin; ngoài ra chỉ vào được chuyến được gán.
    const tripExists = await db.collection("trips").findOne({ _id: tripId });
    if (!tripExists && !isAdmin) return res.status(403).json({ error: "forbidden" });
    if (tripExists && !canUseTrip(tripId)) return res.status(403).json({ error: "trip_not_assigned" });

    // ---- đọc toàn bộ trạng thái ----
    if (req.method === "GET" && rest[0] === "state" && rest.length === 1) {
      const [members, expenses, plans, logs] = await Promise.all([
        db.collection("members").find({ tripId }).sort({ createdAt: 1 }).toArray(),
        db.collection("expenses").find({ tripId }).sort({ createdAt: -1 }).toArray(),
        db.collection("plans").find({ tripId }).sort({ date: 1, time: 1 }).toArray(),
        db.collection("logs").find({ tripId }).sort({ at: -1 }).limit(300).toArray()
      ]);
      return res.status(200).json({
        meta: tripExists
          ? { name: tripExists.name, holderId: tripExists.holderId || null, note: tripExists.note || "" }
          : { name: "Quỹ nhóm", holderId: null, note: "" },
        members: strip(members),
        expenses: strip(expenses),
        plans: strip(plans),
        logs: strip(logs)
      });
    }

    // ---- ghi thông tin chung của chuyến ----
    if (req.method === "PUT" && rest[0] === "meta" && rest[1] === "trip") {
      const b = readBody(req);
      if (!tripExists && !isAdmin) return res.status(403).json({ error: "forbidden" });
      await db.collection("trips").updateOne(
        { _id: tripId },
        {
          $set: {
            name: String(b.name || "Quỹ nhóm"),
            holderId: b.holderId || null,
            note: String(b.note || ""),
            updatedAt: new Date()
          }
        },
        { upsert: true }
      );
      // admin tạo chuyến mới thì tự gán luôn cho chính mình
      if (!tripExists && isAdmin && (me.tripIds || []).indexOf(tripId) === -1) {
        await users().updateOne({ _id: me._id }, { $addToSet: { tripIds: tripId } });
      }
      return res.status(204).end();
    }

    // ---- ghi / xoá một document ----
    if (rest.length === 2) {
      const coll = rest[0];
      const id = rest[1];
      if (!COLLS.has(coll)) return res.status(400).json({ error: "bad_collection" });

      if (req.method === "PUT") {
        const body = Object.assign({}, readBody(req));
        delete body._id;
        delete body.id;
        // Người thực hiện do máy chủ gắn từ phiên đăng nhập, không lấy theo
        // dữ liệu client gửi lên — nếu không thì ai cũng ghi log dưới tên
        // người khác được.
        if (coll === "logs") {
          body.who = me._id;
          body.whoName = me.name || me._id;
        }
        await db.collection(coll).updateOne(
          { _id: id },
          { $set: Object.assign({}, body, { tripId }) },
          { upsert: true }
        );
        return res.status(204).end();
      }
      if (req.method === "DELETE") {
        await db.collection(coll).deleteOne({ _id: id, tripId });
        return res.status(204).end();
      }
    }

    return res.status(404).json({ error: "not_found" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "server_error" });
  }
};
