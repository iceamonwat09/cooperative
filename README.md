# เว็บไซต์สหกรณ์ออมทรัพย์พนักงานไทยรวมสินพัฒนาอุตสาหกรรม จำกัด (ส.พ.ส.) — Demo

เว็บไซต์ตัวอย่างสำหรับสหกรณ์ออมทรัพย์ (ภาษาไทย, Mobile-first, Dark mode, PDPA) พร้อมระบบตรวจสอบข้อมูลสมาชิกและระบบผู้ดูแล
**เป็น Demo ฝั่งเบราว์เซอร์ทั้งหมด — ข้อมูลทุกอย่างเป็นข้อมูลสมมติ** รันบน GitHub Pages ได้ทันทีโดยไม่ต้อง build

**ดู Demo:** https://iceamonwat09.github.io/cooperative/ (เปิด GitHub Pages ตาม [project-docs/deploy.md](project-docs/deploy.md))

| ระบบ | ทดลองเข้าใช้ |
|---|---|
| สมาชิก `#/member` | `000123` / `Demo@1234` (OTP แสดงที่มุมจอ) |
| ผู้ดูแล `#/admin` | `admin` / `Admin@1234` · `staff` / `Staff@1234` · `viewer` / `View@1234` |

## สิ่งที่ส่งมอบ
1. **Sitemap + Wireframe** — [project-docs/sitemap-wireframes.md](project-docs/sitemap-wireframes.md) (และหน้า `#/sitemap` ในเว็บ)
2. **ดีไซน์หน้าแรก / Dashboard สมาชิก / หน้าข่าว** — ตัวเว็บจริง
3. **Database schema** — [database/schema.sql](database/schema.sql) (PostgreSQL)
4. **โค้ดที่รันได้ + Error handling + mock data** — `index.html`, `assets/`
5. **ติดตั้งและ deploy** — [project-docs/deploy.md](project-docs/deploy.md)
6. **ความปลอดภัย/PDPA และสิ่งที่ต้องทำก่อนใช้จริง** — [project-docs/security.md](project-docs/security.md)

## โครงสร้าง
```
index.html              โครงหน้า (header, nav, footer, cookie banner, ไอคอน SVG)
assets/css/style.css    design tokens + components (light/dark, responsive)
assets/js/theme.js      ใช้ธีม/ขนาดตัวอักษรก่อน render (กันกระพริบ)
assets/js/data.js       mock data ทั้งหมด (แก้ชื่อสหกรณ์/ที่อยู่ที่ SITE)
assets/js/app.js        router, templating ที่ escape อัตโนมัติ, หน้าสาธารณะ, เครื่องคำนวณ, cookie consent
assets/js/member.js     ล็อกอิน + OTP + lockout + session timeout, dashboard สมาชิก, ใบเสร็จ
assets/js/admin.js      CRUD เนื้อหา, อัตราดอกเบี้ย, ร้องเรียน, นำเข้า CSV, สิทธิ์, audit log
assets/files/           PDF ตัวอย่าง
database/schema.sql     schema สำหรับระบบจริง
project-docs/           sitemap, wireframe, deploy, security
```
