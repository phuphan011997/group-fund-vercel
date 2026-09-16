// ============================================================
//  /api/[...path].js — toàn bộ API chạy trong một serverless function
//
//  Các đường dẫn xử lý:
//    GET    /api/trips/:tripId/state          đọc toàn bộ dữ liệu chuyến
//    PUT    /api/trips/:tripId/meta/trip      ghi tên chuyến, người giữ quỹ, ghi chú
//    PUT    /api/trips/:tripId/:coll/:id      ghi một document
//    DELETE /api/trips/:tripId/:coll/:id      xoá một document
//
//  Biến môi trường cần khai trên Vercel:
//    MONGODB_URI  chuỗi kết nối Atlas
//    APP_TOKEN    mã truy cập, người dùng nhập khi mở app lần đầu
// ============================================================

const { MongoClient } = require("mongodb");

const DB_NAME = "group_fund";
const COLLS = new Set(["members", "expenses", "plans", "logs"]);

// Serverless chạy nhiều lần trên cùng một container, nên giữ lại kết nối
// ở biến toàn cục để lần gọi sau không phải mở lại từ đầu.
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

module.exports = async function handler(req, res) {
  // App và API cùng một tên miền nên không cần CORS.
  // Nếu bạn host app ở nơi khác, mở dòng dưới và điền địa chỉ đó.
  // res.setHeader("Access-Control-Allow-Origin", "https://trang-cua-ban.com");
  // res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  // res.setHeader("Access-Control-Allow-Methods", "GET, PUT, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  // /api/health — kiểm tra nhanh, không cần token.
  // Mở thẳng trên trình duyệt để biết hỏng ở khâu nào.
  const rawPath = [].concat(req.query.path || []);
  if (rawPath[0] === "health") {
    const out = {
      route: "ok",
      hasMongoUri: !!process.env.MONGODB_URI,
      hasAppToken: !!process.env.APP_TOKEN,
      db: "chua-thu"
    };
    if (out.hasMongoUri) {
      try {
        const d = await getDb();
        await d.command({ ping: 1 });
        out.db = "ket-noi-duoc";
      } catch (e) {
        out.db = "loi";
        out.dbError = String(e && e.message || e).slice(0, 200);
      }
    }
    return res.status(200).json(out);
  }

  const token = process.env.APP_TOKEN;
  if (!token) return res.status(500).json({ error: "server_misconfigured" });
  if ((req.headers.authorization || "") !== "Bearer " + token) {
    return res.status(401).json({ error: "unauthorized" });
  }

  // /api/trips/:tripId/... → ["trips", tripId, ...]
  const parts = rawPath;
  if (parts[0] !== "trips" || !parts[1]) {
    return res.status(404).json({ error: "not_found" });
  }
  const tripId = parts[1];
  const rest = parts.slice(2);

  let db;
  try {
    db = await getDb();
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "db_unavailable" });
  }

  try {
    // ---- đọc toàn bộ trạng thái ----
    if (req.method === "GET" && rest[0] === "state" && rest.length === 1) {
      const [trip, members, expenses, plans, logs] = await Promise.all([
        db.collection("trips").findOne({ _id: tripId }),
        db.collection("members").find({ tripId }).sort({ createdAt: 1 }).toArray(),
        db.collection("expenses").find({ tripId }).sort({ createdAt: -1 }).toArray(),
        db.collection("plans").find({ tripId }).sort({ date: 1, time: 1 }).toArray(),
        db.collection("logs").find({ tripId }).sort({ at: -1 }).limit(300).toArray()
      ]);
      return res.status(200).json({
        meta: trip
          ? { name: trip.name, holderId: trip.holderId || null, note: trip.note || "" }
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
