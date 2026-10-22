# ติดตั้งและ Deploy

## A. เปิด Demo บน GitHub Pages (ไม่ต้องติดตั้งอะไร)
เว็บนี้เป็นไฟล์ static (HTML/CSS/JS ล้วน ไม่มี build step) จึงวางบน GitHub Pages ได้ทันที

1. เข้า `https://github.com/iceamonwat09/cooperative` → **Settings** → **Pages**
2. **Build and deployment → Source:** `Deploy from a branch`
3. **Branch:** เลือก `main` (หลัง merge Pull Request) หรือ `claude/optimistic-albattani-mss7h7` เพื่อดูทันที → โฟลเดอร์ `/ (root)` → **Save**
4. รอ 1–2 นาที (ดูสถานะที่แท็บ **Actions** → *pages build and deployment*)
5. เปิด **https://iceamonwat09.github.io/cooperative/**

> ไฟล์ `.nojekyll` มีไว้แล้ว เพื่อให้ GitHub Pages เสิร์ฟไฟล์ตรง ๆ ไม่ผ่าน Jekyll
> ทุกลิงก์เป็นแบบ relative + hash routing (`#/news`) จึงทำงานใต้ path `/cooperative/` และรีเฟรชหน้าใดก็ได้ไม่เจอ 404

### บัญชีทดลอง
| ระบบ | ผู้ใช้ | รหัสผ่าน |
|---|---|---|
| สมาชิก | `000123` | `Demo@1234` → OTP แสดงที่มุมขวาล่าง |
| Admin (Super) | `admin` | `Admin@1234` |
| เจ้าหน้าที่ | `staff` | `Staff@1234` |
| ผู้ดูข้อมูล | `viewer` | `View@1234` |

การแก้ไขในระบบ Admin บันทึกใน localStorage ของเบราว์เซอร์ที่ใช้เท่านั้น (กด “รีเซ็ตข้อมูล Demo” ในแดชบอร์ดเพื่อล้าง)

## B. รันบนเครื่องตัวเอง
```bash
git clone https://github.com/iceamonwat09/cooperative.git
cd cooperative
npx http-server -p 8080 -c-1 .     # หรือ: python3 -m http.server 8080
# เปิด http://localhost:8080
```
ต้องเปิดผ่าน `http://localhost` หรือ `https://` (WebCrypto ไม่ทำงานบน `file://`)

## C. ปรับแต่ง
| ต้องการเปลี่ยน | แก้ที่ |
|---|---|
| ชื่อสหกรณ์ ที่อยู่ เบอร์ LINE เวลาทำการ | `assets/js/data.js` → `SITE` (และ `<title>` ใน `index.html`) |
| สี/ฟอนต์ | `assets/css/style.css` → `:root` (light) และบล็อก dark |
| โลโก้ | `assets/img/logo.webp` (หัวเว็บ/ใบเสร็จ), `logo-192.png`, `favicon-32.png`, `apple-touch-icon.png` |
| ข่าว อัตราดอกเบี้ย ฯลฯ | ผ่านหน้า Admin (Demo) หรือแก้ `data.js` |
| ไฟล์ PDF | วางใน `assets/files/` แล้วอ้างอิงใน `data.js` |
| แผนที่ | `SITE.mapQuery` (ชื่อสถานที่หรือ `lat,lng`) |

## D. ขึ้นระบบจริง (Production) — แนวทาง
```
[ผู้ใช้] ──HTTPS──> [CDN/WAF] ──> [Frontend (ไฟล์ชุดนี้)]
                                  │  fetch /api/*
                                  ▼
                           [Backend API]  ── argon2id, session, CSRF, rate limit, OTP(SMS)
                                  │
                       [PostgreSQL (schema.sql)] <── sync ทุกคืน ── [ระบบสหกรณ์หลัก]
                       [Private file storage]  (ใบเสร็จ PDF, ไฟล์แนบ)
```
1. สร้างฐานข้อมูล: `psql -d coop -f database/schema.sql`
2. ทำ Backend API ตามตาราง (`/api/auth/login`, `/api/auth/otp`, `/api/me/*`, `/api/admin/*`) และย้ายการตรวจรหัส/OTP/สิทธิ์จาก `member.js`/`admin.js` ไปไว้ฝั่งเซิร์ฟเวอร์
3. เปลี่ยน `Store`/`D.MEMBERS` ในฝั่งหน้าเว็บให้ดึงจาก API แทน mock data
4. ตั้งค่า security headers ที่เว็บเซิร์ฟเวอร์ (ดู `project-docs/security.md`)
5. โฮสต์ได้ทั้ง VPS (Nginx + Docker), Cloud (Azure App Service / AWS) หรือ hosting ไทยที่รองรับ Node/PHP
