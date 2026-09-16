# Quỹ nhóm

Webapp theo dõi quỹ và chia tiền cho nhóm du lịch. Dữ liệu lưu trên MongoDB Atlas,
API chạy dạng serverless trên Vercel, giao diện tối ưu cho điện thoại.

## Cấu trúc

```
index.html              giao diện, chạy thẳng trên trình duyệt, không cần build
api/index.js            toàn bộ API, chạy như một serverless function
vercel.json             chuyển mọi đường dẫn /api/* về function trên
mongodb-setup.js         script tạo collection, validator và index trên Atlas
package.json
```

## Bước 1 — chuẩn bị MongoDB Atlas

1. Vào cluster của bạn, mở tab **MongoSH** (hoặc chạy `mongosh` ở máy).
2. Dán toàn bộ nội dung `mongodb-setup.js` vào rồi chạy.
   Script tạo database `group_fund` với 5 collection, các validator, index, và một
   chuyến mẫu tên `trip-1`.
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
   | `APP_TOKEN` | mã cho thành viên, một chuỗi ngẫu nhiên bạn tự đặt |
   | `ADMIN_TOKEN` | mã cho người quản lý, **phải khác** `APP_TOKEN` |

4. Bấm **Deploy**.

Sinh chuỗi ngẫu nhiên cho `APP_TOKEN`:

```bash
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```

## Bước 4 — dùng

Mở địa chỉ Vercel cấp cho bạn. Lần đầu app hỏi **mã truy cập**. Có hai mã:

- Nhập `APP_TOKEN` → vào với tư cách **thành viên**: nhập liệu bình thường, không
  thấy nút quản lý chuyến.
- Nhập `ADMIN_TOKEN` → vào với tư cách **quản lý**: header hiện thêm nút `⇄` để
  xem danh sách chuyến, tạo chuyến mới, và chọn chuyến nào đang mở.

Máy đó sẽ nhớ mã, lần sau không hỏi lại. Gửi link kèm `APP_TOKEN` cho mọi người
trong nhóm, giữ `ADMIN_TOKEN` cho riêng bạn.

Nếu ai đó nhập sai mã, app báo ngay và không đọc được gì.

## Nhiều chuyến đi

Cả nhóm dùng chung một link, chuyến nào đang mở do admin quyết định và lưu trên
server. Admin bấm `⇄`, chọn chuyến khác hoặc tạo chuyến mới, mọi người đang mở app
sẽ tự chuyển theo trong khoảng 6 giây mà không cần deploy lại hay đổi link.

Dữ liệu các chuyến tách biệt hoàn toàn nhờ trường `tripId`, chuyển qua lại bao nhiêu
lần cũng không mất gì. Mã chuyến sinh tự động từ tên, ví dụ "Đà Lạt tháng 10" thành
`da-lat-thang-10-k3f9`.

Thành viên thường không tạo hay chuyển chuyến được; API trả về 403 nếu thử.

## Khi app báo mất kết nối

Mở `https://<ten-mien-cua-ban>/api/health` trên trình duyệt. Endpoint này không cần
mã truy cập và cho biết hỏng ở khâu nào:

| Kết quả | Nghĩa là | Cách sửa |
|---|---|---|
| Trang 404 của Vercel | function không được nhận diện | Kiểm tra `api/index.js` và `vercel.json` đều có trong repo trên GitHub (xem trực tiếp trên web GitHub cho chắc) |
| `hasMongoUri: false` hoặc `hasAppToken: false` | thiếu biến môi trường | Thêm biến trên Vercel rồi **Redeploy** — biến mới không tự áp dụng cho bản đã deploy |
| `db: "loi"` kèm `dbError` nhắc timeout | Atlas chặn IP | Network Access thêm `0.0.0.0/0` |
| `db: "loi"` kèm `dbError` nhắc authentication | sai user/mật khẩu | Kiểm tra lại chuỗi kết nối, mật khẩu có ký tự đặc biệt phải mã hoá URL |
| `db: "ket-noi-duoc"` mà app vẫn lỗi | mã truy cập sai | Xoá dữ liệu trang trong trình duyệt rồi nhập lại mã đúng |
| Đăng nhập bằng `ADMIN_TOKEN` mà không thấy nút `⇄` | chưa khai biến `ADMIN_TOKEN` trên Vercel | Thêm biến rồi Redeploy |

Xem log chi tiết ở Vercel: tab **Deployments → Runtime Logs**.

## Vài điều nên biết

**Về mã truy cập.** Hai mã này là mật khẩu chung theo vai trò chứ không phải tài
khoản riêng từng người. Ai có `APP_TOKEN` đều sửa được mọi số liệu, và app không
phân biệt được ai là ai ngoài việc mỗi người tự chọn tên mình ở tab Lịch sử.
`ADMIN_TOKEN` chỉ thêm quyền quản lý chuyến, không phải quyền cao hơn về dữ liệu.
Với một quỹ đi chơi thì đủ dùng; đừng đưa dữ liệu nhạy cảm hơn vào đây. Muốn đổi
mã, sửa biến trên Vercel rồi redeploy, mọi người sẽ được hỏi mã mới.

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

Tạo file `.env.local` với `MONGODB_URI` và `APP_TOKEN` để `vercel dev` đọc được.
