# Quỹ nhóm

Webapp theo dõi quỹ và chia tiền cho nhóm du lịch. Dữ liệu lưu trên MongoDB Atlas,
API chạy dạng serverless trên Vercel, giao diện tối ưu cho điện thoại.

## Cấu trúc

```
index.html              giao diện, chạy thẳng trên trình duyệt, không cần build
manifest.webmanifest    khai báo để cài ra màn hình chính như một app
icon-*.png              biểu tượng app
api/index.js            toàn bộ API (xác thực + dữ liệu), một serverless function
vercel.json             chuyển mọi đường dẫn /api/* về function trên
mongodb-setup.js         script tạo collection, validator và index trên Atlas
package.json
```

## Bước 1 — chuẩn bị MongoDB Atlas

1. Vào cluster của bạn, mở tab **MongoSH** (hoặc chạy `mongosh` ở máy).
2. Dán toàn bộ nội dung `mongodb-setup.js` vào rồi chạy.
   Script tạo database `group_fund` với 7 collection (trips, members, expenses,
   plans, logs, users, sessions), các validator và index, trong đó có TTL tự xoá
   phiên đăng nhập quá hạn.
3. Vào **Network Access**, thêm `0.0.0.0/0` vào danh sách cho phép.
   Serverless của Vercel không có IP cố định nên bắt buộc phải mở như vậy;
   tài khoản và mật khẩu trong chuỗi kết nối vẫn là lớp bảo vệ.
4. Vào **Database Access**, tạo một user chỉ có quyền đọc/ghi đúng database
   `group_fund`, đừng dùng user quyền admin.

## Bước 2 — đẩy code lên Git

```bash
git init
git add .
git commit -m "quy nhom"
git remote add origin <repo-cua-ban>
git push -u origin main
```

## Bước 3 — deploy trên Vercel

1. **Add New → Project**, chọn repo vừa push.
2. Framework Preset để **Other**, không cần build command, không cần output directory.
3. Mở **Environment Variables**, thêm hai biến (chọn cả Production và Preview):

   | Tên | Giá trị |
   |---|---|
   | `MONGODB_URI` | chuỗi kết nối Atlas, nhớ thêm `/group_fund` trước dấu `?` |
   | `ADMIN_SECRET` | mã bí mật quản trị, chỉ bạn biết |

4. Bấm **Deploy**.

Sinh chuỗi ngẫu nhiên cho `ADMIN_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```

## Bước 4 — tạo tài khoản admin đầu tiên

Mở địa chỉ Vercel cấp cho bạn. Màn đăng nhập hiện ra:

1. Bấm **Tôi là quản trị viên**.
2. Nhập tên đăng nhập và mật khẩu bạn muốn dùng, cùng với `ADMIN_SECRET`.
3. Bấm Đăng nhập.

Vì database chưa có tài khoản nào, lần đăng nhập này tạo luôn tài khoản admin cho
bạn. Từ lần thứ hai trở đi, cơ chế này đóng lại: ai nhập đúng `ADMIN_SECRET` nhưng
username lạ cũng chỉ nhận về lỗi đăng nhập.

## Tài khoản và phân quyền

**Thành viên** chỉ cần tên đăng nhập và mật khẩu. Họ nhập liệu bình thường trong
những chuyến được gán, và tự đổi qua lại giữa các chuyến đó bằng nút `⇄`.

**Quản trị viên** phải nhập thêm `ADMIN_SECRET` **mỗi lần** đăng nhập, kể cả khi mật
khẩu đã đúng. Mật khẩu bị lộ vẫn chưa đủ để vào được quyền admin. Header của admin
có thêm nút `⚙` để:

- tạo chuyến đi mới
- tạo tài khoản, đặt lại mật khẩu, đổi vai trò, xoá tài khoản
- gán chuyến nào cho ai, bằng cách bấm chọn trong danh sách chuyến

Đăng nhập xong, máy đó nhớ phiên **30 ngày** rồi mới hỏi lại. Đổi mật khẩu hoặc đổi
vai trò của một người sẽ huỷ mọi phiên đang mở của người đó, nên họ phải đăng nhập lại.

Mật khẩu lưu dưới dạng băm scrypt kèm salt riêng từng người, database không giữ mật
khẩu gốc. Phân quyền kiểm tra ở phía API chứ không chỉ ẩn nút: thành viên gọi thẳng
API để xem danh sách tài khoản, tạo chuyến, hay đọc chuyến chưa được gán đều nhận 403.

## Nhiều chuyến đi

Mỗi người có danh sách chuyến riêng do admin gán, và tự chọn chuyến muốn mở — khác
với trước đây là cả nhóm dùng chung một chuyến. Chuyến đang mở lưu theo tài khoản nên
đổi máy vẫn giữ nguyên.

Dữ liệu các chuyến tách biệt hoàn toàn nhờ trường `tripId`, chuyển qua lại bao nhiêu
lần cũng không mất gì. Mã chuyến sinh tự động từ tên, ví dụ "Đà Lạt tháng 10" thành
`da-lat-thang-10-k3f9`.

## Cài ra màn hình chính

App khai báo manifest nên cài được như một ứng dụng thật, chạy toàn màn hình,
không có thanh địa chỉ.

- **iPhone (Safari):** nút Chia sẻ → *Thêm vào MH chính*
- **Android (Chrome):** menu ba chấm → *Cài đặt ứng dụng*

Giao diện khoá ở mức phóng to 100% để layout không vỡ: chụm hai ngón, chạm hai
lần và Ctrl+cuộn đều bị chặn. Riêng Safari trên iOS bỏ qua thẻ meta
`user-scalable=no` khi duyệt web thường, nên việc chặn được làm thẳng ở cử chỉ
chạm — cài ra màn hình chính thì khoá chắc hơn nữa.

Đánh đổi: người cần phóng to để đọc sẽ không phóng được. Nếu muốn bỏ khoá, xoá
`maximum-scale=1, user-scalable=no` trong thẻ viewport và bỏ đoạn chặn cử chỉ ở
đầu khối script.

## Khi app báo mất kết nối

Mở `https://<ten-mien-cua-ban>/api/health` trên trình duyệt. Endpoint này không cần
mã truy cập và cho biết hỏng ở khâu nào:

| Kết quả | Nghĩa là | Cách sửa |
|---|---|---|
| Trang 404 của Vercel | function không được nhận diện | Kiểm tra `api/index.js` và `vercel.json` đều có trong repo trên GitHub (xem trực tiếp trên web GitHub cho chắc) |
| `hasMongoUri: false` hoặc `hasAdminSecret: false` | thiếu biến môi trường | Thêm biến trên Vercel rồi **Redeploy** — biến mới không tự áp dụng cho bản đã deploy |
| `db: "loi"` kèm `dbError` nhắc timeout | Atlas chặn IP | Network Access thêm `0.0.0.0/0` |
| `db: "loi"` kèm `dbError` nhắc authentication | sai user/mật khẩu | Kiểm tra lại chuỗi kết nối, mật khẩu có ký tự đặc biệt phải mã hoá URL |
| `db: "ket-noi-duoc"`, `userCount: 0` | chưa có tài khoản nào | Đăng nhập lần đầu theo Bước 4 để tạo admin |
| Không tạo được admin đầu tiên dù nhập đúng secret | `userCount` đã lớn hơn 0 | Dùng tài khoản admin đã có; nếu quên mật khẩu, xoá document trong collection `users` trên Atlas rồi làm lại Bước 4 |
| Admin báo cần mã quản trị dù đã nhập | `ADMIN_SECRET` trên Vercel khác mã đang nhập | Đối chiếu lại biến rồi Redeploy |

Xem log chi tiết ở Vercel: tab **Deployments → Runtime Logs**.

## Vài điều nên biết

**Về bảo mật.** Mỗi người một tài khoản riêng, nhưng trong cùng một chuyến thì mọi
thành viên đều sửa được mọi số liệu — app không khoá theo từng khoản chi. Tab Lịch sử
ghi lại ai làm gì theo username, và username đó do máy chủ gắn từ phiên đăng nhập chứ
không lấy theo dữ liệu client gửi lên, nên không ai ghi log dưới tên người khác được.
Với một quỹ đi chơi thì đủ dùng; đừng đưa dữ liệu nhạy cảm hơn vào đây.

Đổi `ADMIN_SECRET` trên Vercel thì các admin phải dùng mã mới ở lần đăng nhập sau,
còn phiên đang mở vẫn chạy tiếp cho tới khi hết hạn.

**Về giới hạn miễn phí.** Cluster M0 của Atlas cho 512MB, thừa sức cho vài trăm
chuyến. Bản Hobby của Vercel giới hạn số lần gọi function; app hiện đồng bộ 6 giây
một lần khi đang mở, nếu nhóm đông và mở liên tục cả ngày thì nên nâng con số đó
lên (tìm `6000` trong `index.html`).

**Về log.** Script setup có tạo TTL index tự xoá log sau 180 ngày, nhưng TTL chỉ
chạy khi trường `at` là kiểu Date. App đang lưu `at` dạng số mili-giây nên TTL sẽ
không kích hoạt; bản thân app đã tự giới hạn 300 dòng gần nhất nên không lo phình.

## Chạy thử ở máy

```bash
npm install -g vercel
npm install
vercel dev
```

Tạo file `.env.local` với `MONGODB_URI` và `ADMIN_SECRET` để `vercel dev` đọc được.
