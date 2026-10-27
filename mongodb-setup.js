// ============================================================
//  QUỸ NHÓM — script tạo cấu trúc dữ liệu trên MongoDB
//  Chạy bằng mongosh:
//    mongosh "mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/" --file mongodb-setup.js
//  Hoặc dán vào tab "MongoSH" trên giao diện Atlas.
// ============================================================

const DB_NAME = "group_fund";
const d = db.getSiblingDB(DB_NAME);

// ---------- helper: tạo collection kèm validator, bỏ qua nếu đã có ----------
function ensure(name, schema) {
  const exists = d.getCollectionNames().includes(name);
  if (exists) {
    d.runCommand({ collMod: name, validator: { $jsonSchema: schema }, validationLevel: "moderate" });
    print("• cập nhật validator: " + name);
  } else {
    d.createCollection(name, { validator: { $jsonSchema: schema }, validationLevel: "moderate" });
    print("• tạo collection: " + name);
  }
}

// Mọi document đều có tripId để một database phục vụ được nhiều chuyến đi.

// ---------- trips: thông tin chung của chuyến ----------
ensure("trips", {
  bsonType: "object",
  required: ["_id", "name"],
  properties: {
    _id:      { bsonType: "string", description: "tripId, ví dụ 'da-lat-thang-10'" },
    name:     { bsonType: "string" },
    holderId: { bsonType: ["string", "null"], description: "id thành viên đang giữ quỹ" },
    note:     { bsonType: "string", description: "ghi chú chung cả chuyến" },
    updatedAt:{ bsonType: ["date", "long", "double", "int"] }
  }
});

// ---------- members ----------
ensure("members", {
  bsonType: "object",
  required: ["_id", "tripId", "name"],
  properties: {
    _id:     { bsonType: "string" },
    tripId:  { bsonType: "string" },
    name:    { bsonType: "string", minLength: 1 },
    deleted: { bsonType: "bool", description: "true = đã rời nhóm nhưng giữ số liệu" },
    createdAt: { bsonType: ["date", "long", "double", "int"] },
    contributions: {
      bsonType: "array",
      description: "từng lần đóng quỹ, tổng đóng góp = tổng amount",
      items: {
        bsonType: "object",
        required: ["id", "amount"],
        properties: {
          id:     { bsonType: "string" },
          amount: { bsonType: ["double", "int", "long"], minimum: 0 },
          at:     { bsonType: ["date", "long", "double", "int"] }
        }
      }
    }
  }
});

// ---------- expenses ----------
ensure("expenses", {
  bsonType: "object",
  required: ["_id", "tripId", "title", "amount", "payerId", "participantIds"],
  properties: {
    _id:      { bsonType: "string" },
    tripId:   { bsonType: "string" },
    title:    { bsonType: "string", minLength: 1 },
    amount:   { bsonType: ["double", "int", "long"], minimum: 0 },
    payerId:  { bsonType: "string", description: "id người thực sự đưa tiền" },
    fromFund: { bsonType: "bool", description: "true = tiền lấy từ quỹ (người chi là người giữ quỹ)" },
    participantIds: {
      bsonType: "array",
      minItems: 1,
      items: { bsonType: "string" },
      description: "những người cùng chịu khoản này, chia đều"
    },
    createdAt: { bsonType: ["date", "long", "double", "int"] }
  }
});

// ---------- plans: lịch trình ----------
ensure("plans", {
  bsonType: "object",
  required: ["_id", "tripId", "title"],
  properties: {
    _id:     { bsonType: "string" },
    tripId:  { bsonType: "string" },
    title:   { bsonType: "string", minLength: 1 },
    date:    { bsonType: "string", description: "YYYY-MM-DD, rỗng nếu chưa xếp ngày" },
    time:    { bsonType: "string", description: "HH:mm, rỗng nếu chưa có giờ" },
    note:    { bsonType: "string" },
    createdAt: { bsonType: ["date", "long", "double", "int"] }
  }
});

// ---------- logs: lịch sử thao tác ----------
ensure("logs", {
  bsonType: "object",
  required: ["_id", "tripId", "at", "text"],
  properties: {
    _id:    { bsonType: "string" },
    tripId: { bsonType: "string" },
    at:     { bsonType: ["date", "long", "double", "int"] },
    who:    { bsonType: "string" },
    text:   { bsonType: "string" },
    kind:   { bsonType: "string", description: "'del' cho thao tác xoá, để tô màu" }
  }
});

// ---------- users: tài khoản đăng nhập ----------
ensure("users", {
  bsonType: "object",
  required: ["_id", "role"],
  properties: {
    _id:           { bsonType: "string", description: "username, luôn viết thường" },
    name:          { bsonType: "string", description: "tên hiển thị" },
    role:          { enum: ["admin", "member"] },
    salt:          { bsonType: "string" },
    passwordHash:  { bsonType: "string", description: "scrypt, không bao giờ lưu mật khẩu gốc" },
    tripIds:       { bsonType: "array", items: { bsonType: "string" },
                     description: "các chuyến tài khoản này được vào" },
    currentTripId: { bsonType: ["string", "null"], description: "chuyến người này đang mở" },
    createdAt:     { bsonType: ["date", "long", "double", "int"] }
  }
});

// ---------- sessions: phiên đăng nhập, tự hết hạn sau 30 ngày ----------
ensure("sessions", {
  bsonType: "object",
  required: ["_id", "username", "expiresAt"],
  properties: {
    _id:       { bsonType: "string", description: "session token ngẫu nhiên" },
    username:  { bsonType: "string" },
    createdAt: { bsonType: "date" },
    expiresAt: { bsonType: "date" }
  }
});

// ---------- index ----------
d.members.createIndex({ tripId: 1, createdAt: 1 });
d.expenses.createIndex({ tripId: 1, createdAt: -1 });
d.plans.createIndex({ tripId: 1, date: 1, time: 1 });
d.logs.createIndex({ tripId: 1, at: -1 });
d.users.createIndex({ role: 1 });
d.sessions.createIndex({ username: 1 });
// Mongo tự xoá phiên quá hạn, nên không có phiên nào sống quá 30 ngày.
d.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "sessions_ttl" });
print("• đã tạo index");

// Tự xoá log cũ hơn 180 ngày để không phình database.
// Lưu ý: TTL index chỉ hoạt động khi 'at' là kiểu Date.
// Nếu bạn lưu 'at' dạng số mili-giây thì bỏ qua dòng này.
try {
  d.logs.createIndex({ at: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 180, name: "logs_ttl" });
  print("• đã tạo TTL cho logs (180 ngày)");
} catch (e) {
  print("• bỏ qua TTL logs: " + e.message);
}

// Không tạo chuyến mẫu: chuyến đi do admin tạo ngay trong app, và chuyến
// tạo ở đây sẽ không được gán cho ai nên chỉ nằm lay lắt trong database.

print("\nXong. Database: " + DB_NAME);
print("Tài khoản admin đầu tiên được tạo ngay trong app:");
print("  mở trang web, bật 'Tôi là quản trị viên', nhập username/mật khẩu bạn muốn");
print("  cùng ADMIN_SECRET đã khai trên Vercel.");
