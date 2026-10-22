# ความปลอดภัยและ PDPA

## สิ่งที่ Demo นี้ทำแล้ว (ฝั่งเบราว์เซอร์)
| ข้อกำหนด | Demo | ไฟล์ |
|---|---|---|
| Hash รหัสผ่าน | PBKDF2-SHA256 + salt 16 ไบต์ + 150,000 รอบ (WebCrypto) ไม่มีรหัสจริงในโค้ด | `member.js` `pbkdf2()` |
| จำกัดล็อกอินผิด | ผิด 5 ครั้ง → ระงับ 15 นาที, ข้อความไม่บอกว่าเลขทะเบียนมีอยู่หรือไม่ | `member.js` `initLogin()`, `admin.js` |
| OTP | 6 หลักจาก `crypto.getRandomValues`, หมดอายุ 5 นาที, ผิดได้ 3 ครั้ง, ขอใหม่ได้หลัง 60 วินาที, มี Ref | `member.js` `startOtp()` |
| Session timeout 15 นาที | นับจากการใช้งานล่าสุด, เตือนก่อน 1 นาที, ออกจากระบบอัตโนมัติ | `member.js` `sessionTimer()` |
| ป้องกัน XSS | ทุกค่าที่แสดงผ่าน `html```  ถูก escape อัตโนมัติ, ลิงก์ผ่าน `safeUrl()` (ห้าม `javascript:`), CSP `script-src 'self'` | `app.js` |
| ไฟล์อัปโหลด | ตรวจนามสกุล + ขนาด ≤10 MB + magic bytes `%PDF` | `admin.js` `readPdf()` |
| CSV injection | ส่งออก CSV ใส่ `'` นำหน้าค่าที่ขึ้นต้นด้วย `= + - @` | `admin.js` `csvCell()` |
| ปิดบังข้อมูลอ่อนไหว | เลขบัตร `x-xxxx-xxxxx-56-7`, บัญชี `xxx-x-x456-7`, เบอร์ `xxx-xxx-5678`, อีเมล `so***@…` | `app.js` `mask*()` |
| ไม่ส่งข้อมูลส่วนบุคคลผ่าน URL | URL มีแค่ชื่อหน้า/เดือนใบเสร็จ ไม่มีเลขทะเบียน/เลขบัญชี | router |
| สิทธิ์ผู้ดูแล | Super Admin / เจ้าหน้าที่ / ผู้ดูข้อมูล ตรวจสิทธิ์ทั้งตอนแสดงผลและตอนทำรายการ | `admin.js` `PERMS`, `can()` |
| Audit log | บันทึกล็อกอินสำเร็จ/ล้มเหลว, OTP ผิด, CRUD, นำเข้า, เปลี่ยนสิทธิ์, ส่งออก | `app.js` `audit()` |
| PDPA | หน้านโยบาย, Cookie consent 3 ระดับ, ยินยอมก่อนส่งฟอร์ม, ค่าที่ “จดจำ” ใช้ localStorage เฉพาะเมื่อยินยอม | `app.js` |
| Bot / spam | honeypot + จำกัดส่งฟอร์มทุก 30 วินาที | `app.js` `/contact` |

## ข้อจำกัดของ Demo (ต้องทำเมื่อขึ้นระบบจริง)
GitHub Pages เป็น static hosting — **ข้อมูลทุกอย่างอยู่ในเบราว์เซอร์** ผู้ที่เปิด DevTools อ่าน mock data ได้ จึงใช้ได้กับข้อมูลสมมติเท่านั้น
ระบบจริงต้องมี Backend (เช่น Node.js/NestJS, Laravel หรือ ASP.NET Core) + ฐานข้อมูลตาม `database/schema.sql` และ:

1. **รหัสผ่าน**: argon2id (memory ≥ 64 MB) หรือ bcrypt cost ≥ 12 ที่ฝั่งเซิร์ฟเวอร์ ห้ามตรวจรหัสในเบราว์เซอร์
2. **Session**: cookie `HttpOnly; Secure; SameSite=Strict`, เก็บ session ในเซิร์ฟเวอร์, idle 15 นาที + absolute 8 ชม., หมุน session id หลังล็อกอิน
3. **CSRF**: SameSite=Strict + CSRF token (double-submit หรือ synchronizer) ทุก POST/PUT/DELETE
4. **SQL Injection**: ใช้ parameterized query / ORM เท่านั้น ห้ามต่อ string SQL, บัญชี DB ของเว็บมีสิทธิ์น้อยที่สุด
5. **OTP**: ส่งผ่านผู้ให้บริการ SMS จริง, เก็บเฉพาะ hash ของ OTP, rate limit ต่อเบอร์และต่อ IP
6. **Rate limit**: ล็อกอิน 5 ครั้ง/15 นาที ต่อบัญชี และ 20 ครั้ง/นาที ต่อ IP (เช่น ผ่าน reverse proxy / WAF)
7. **HTTPS + Headers**: HSTS, CSP แบบ header, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, `frame-ancestors 'none'`
8. **ไฟล์ส่วนบุคคล** (ใบเสร็จ PDF): เก็บใน private storage, ดาวน์โหลดผ่าน signed URL อายุสั้น ตรวจว่าเป็นของผู้ล็อกอิน (ป้องกัน IDOR)
9. **เข้ารหัสข้อมูล**: เลขบัตรประชาชนเข้ารหัสในฐานข้อมูล, backup เข้ารหัส
10. **ผู้ดูแล**: บังคับ 2FA (TOTP), จำกัด IP สำนักงาน, log append-only เก็บ ≥ 90 วัน (พ.ร.บ.คอมพิวเตอร์)
11. **PDPA**: บันทึก consent ในฐานข้อมูล, ROPA, DPO, ขั้นตอนรับคำขอใช้สิทธิ์เจ้าของข้อมูล, แจ้งเหตุละเมิดภายใน 72 ชม.
