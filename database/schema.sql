-- =========================================================
-- Database schema — เว็บไซต์สหกรณ์ออมทรัพย์ (สำหรับระบบจริงที่มี Backend)
-- เป้าหมาย: PostgreSQL 15+  (ปรับเป็น MySQL 8 ได้: เปลี่ยน BIGSERIAL→BIGINT AUTO_INCREMENT, TIMESTAMPTZ→DATETIME, JSONB→JSON)
-- หลักการ:
--   * เงินใช้ NUMERIC(15,2) ไม่ใช้ FLOAT
--   * รหัสผ่านเก็บเป็น hash (argon2id/bcrypt) เท่านั้น
--   * เลขบัตรประชาชนเก็บแบบเข้ารหัส (pgcrypto) + เก็บ 4 หลักท้ายไว้แสดงผลแบบปิดบัง
--   * ทุกตารางมี created_at/updated_at, การแก้ไขข้อมูลสำคัญบันทึกใน audit_logs
--   * ข้อมูลสมาชิก/หุ้น/เงินฝาก/เงินกู้ เป็น "สำเนาอ่านอย่างเดียว" ที่ซิงก์จากระบบสหกรณ์หลักทุกสิ้นวัน
-- =========================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- ข้อมูลอ้างอิง ----------
CREATE TABLE data_snapshots (                       -- รอบการซิงก์ = "ข้อมูล ณ วันที่"
  id            BIGSERIAL PRIMARY KEY,
  as_of_date    DATE        NOT NULL UNIQUE,
  source        VARCHAR(50) NOT NULL DEFAULT 'core-system',
  rows_imported INTEGER     NOT NULL DEFAULT 0,
  status        VARCHAR(20) NOT NULL DEFAULT 'success' CHECK (status IN ('running','success','failed')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- สมาชิก ----------
CREATE TABLE members (
  id              BIGSERIAL PRIMARY KEY,
  member_no       CHAR(6)      NOT NULL UNIQUE,              -- เลขทะเบียนสมาชิก
  title           VARCHAR(30)  NOT NULL,
  first_name      VARCHAR(100) NOT NULL,
  last_name       VARCHAR(100) NOT NULL,
  id_card_enc     BYTEA        NOT NULL,                     -- pgp_sym_encrypt(id_card, key)
  id_card_last4   CHAR(4)      NOT NULL,                     -- สำหรับแสดงแบบปิดบัง
  phone           VARCHAR(15),
  email           VARCHAR(120),
  department      VARCHAR(150),
  birth_date      DATE,
  join_date       DATE         NOT NULL,
  status          VARCHAR(20)  NOT NULL DEFAULT 'active' CHECK (status IN ('active','resigned','deceased','suspended')),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE member_credentials (                    -- แยกจาก members เพื่อจำกัดสิทธิ์การเข้าถึง
  member_id         BIGINT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  password_hash     VARCHAR(255) NOT NULL,           -- argon2id
  must_change       BOOLEAN      NOT NULL DEFAULT TRUE,
  failed_attempts   SMALLINT     NOT NULL DEFAULT 0,
  locked_until      TIMESTAMPTZ,
  password_changed_at TIMESTAMPTZ,
  last_login_at     TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE otp_challenges (
  id           BIGSERIAL PRIMARY KEY,
  member_id    BIGINT      NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  code_hash    VARCHAR(255) NOT NULL,               -- เก็บ hash ของ OTP ไม่เก็บตัวเลขจริง
  ref_code     CHAR(4)     NOT NULL,
  channel      VARCHAR(10) NOT NULL CHECK (channel IN ('sms','email')),
  attempts     SMALLINT    NOT NULL DEFAULT 0,
  expires_at   TIMESTAMPTZ NOT NULL,
  used_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_otp_member ON otp_challenges(member_id, created_at DESC);

CREATE TABLE sessions (                              -- session ฝั่งเซิร์ฟเวอร์ (cookie HttpOnly+Secure+SameSite)
  id            CHAR(64)    PRIMARY KEY,             -- sha256 ของ token
  subject_type  VARCHAR(10) NOT NULL CHECK (subject_type IN ('member','admin')),
  subject_id    BIGINT      NOT NULL,
  ip_address    INET,
  user_agent    VARCHAR(255),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),  -- idle timeout 15 นาที
  revoked_at    TIMESTAMPTZ
);

-- ---------- ทุนเรือนหุ้น ----------
CREATE TABLE shares (
  member_id      BIGINT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  total_amount   NUMERIC(15,2) NOT NULL DEFAULT 0,
  unit_price     NUMERIC(10,2) NOT NULL DEFAULT 10,
  monthly_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  snapshot_id    BIGINT REFERENCES data_snapshots(id),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE share_transactions (
  id           BIGSERIAL PRIMARY KEY,
  member_id    BIGINT        NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  tx_date      DATE          NOT NULL,
  description  VARCHAR(150)  NOT NULL,
  amount       NUMERIC(15,2) NOT NULL,
  balance      NUMERIC(15,2) NOT NULL,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX ix_share_tx ON share_transactions(member_id, tx_date DESC);

-- ---------- เงินฝาก ----------
CREATE TABLE deposit_types (
  id          SERIAL PRIMARY KEY,
  code        VARCHAR(20)  NOT NULL UNIQUE,
  name        VARCHAR(150) NOT NULL,
  description TEXT,
  sort_order  SMALLINT     NOT NULL DEFAULT 0,
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE
);
CREATE TABLE deposit_accounts (
  id            BIGSERIAL PRIMARY KEY,
  member_id     BIGINT        NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  account_no    VARCHAR(20)   NOT NULL UNIQUE,
  type_id       INT           NOT NULL REFERENCES deposit_types(id),
  balance       NUMERIC(15,2) NOT NULL DEFAULT 0,
  interest_rate NUMERIC(5,2)  NOT NULL,
  opened_date   DATE          NOT NULL,
  status        VARCHAR(20)   NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','frozen')),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE TABLE deposit_transactions (
  id           BIGSERIAL PRIMARY KEY,
  account_id   BIGINT        NOT NULL REFERENCES deposit_accounts(id) ON DELETE CASCADE,
  tx_date      DATE          NOT NULL,
  description  VARCHAR(150)  NOT NULL,
  deposit      NUMERIC(15,2) NOT NULL DEFAULT 0,
  withdraw     NUMERIC(15,2) NOT NULL DEFAULT 0,
  balance      NUMERIC(15,2) NOT NULL,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX ix_dep_tx ON deposit_transactions(account_id, tx_date DESC);

-- ---------- เงินกู้ ----------
CREATE TABLE loan_types (
  id           SERIAL PRIMARY KEY,
  code         VARCHAR(20)   NOT NULL UNIQUE,
  name         VARCHAR(150)  NOT NULL,
  max_amount   NUMERIC(15,2) NOT NULL,
  max_months   SMALLINT      NOT NULL,
  qualifications TEXT,
  documents    TEXT,
  sort_order   SMALLINT      NOT NULL DEFAULT 0,
  is_active    BOOLEAN       NOT NULL DEFAULT TRUE
);
CREATE TABLE loans (
  id              BIGSERIAL PRIMARY KEY,
  member_id       BIGINT        NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  contract_no     VARCHAR(30)   NOT NULL UNIQUE,
  type_id         INT           NOT NULL REFERENCES loan_types(id),
  principal       NUMERIC(15,2) NOT NULL,
  interest_rate   NUMERIC(5,2)  NOT NULL,
  months          SMALLINT      NOT NULL,
  method          VARCHAR(20)   NOT NULL CHECK (method IN ('flat_principal','annuity')), -- ลดต้นลดดอก / คงที่
  start_date      DATE          NOT NULL,
  balance         NUMERIC(15,2) NOT NULL,
  paid_installments SMALLINT    NOT NULL DEFAULT 0,
  status          VARCHAR(20)   NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed','default')),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX ix_loans_member ON loans(member_id);
CREATE TABLE loan_installments (                     -- ตารางผ่อนชำระ
  id           BIGSERIAL PRIMARY KEY,
  loan_id      BIGINT        NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  installment_no SMALLINT    NOT NULL,
  due_date     DATE          NOT NULL,
  principal    NUMERIC(15,2) NOT NULL,
  interest     NUMERIC(15,2) NOT NULL,
  balance_after NUMERIC(15,2) NOT NULL,
  paid_date    DATE,
  UNIQUE (loan_id, installment_no)
);

-- ---------- ค้ำประกัน ----------
CREATE TABLE guarantees (
  id                  BIGSERIAL PRIMARY KEY,
  loan_id             BIGINT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  guarantor_member_id BIGINT NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  guarantee_amount    NUMERIC(15,2) NOT NULL,
  status              VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','released')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (loan_id, guarantor_member_id)
);
CREATE INDEX ix_guarantor ON guarantees(guarantor_member_id);

-- ---------- ใบเสร็จรายเดือน / ปันผล / ผู้รับผลประโยชน์ ----------
CREATE TABLE receipts (
  id          BIGSERIAL PRIMARY KEY,
  member_id   BIGINT        NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  receipt_no  VARCHAR(30)   NOT NULL UNIQUE,
  period      CHAR(7)       NOT NULL,                -- YYYY-MM
  receipt_date DATE         NOT NULL,
  total       NUMERIC(15,2) NOT NULL,
  pdf_path    VARCHAR(255),                           -- ไฟล์ใน private storage (ดาวน์โหลดผ่าน signed URL)
  UNIQUE (member_id, period)
);
CREATE TABLE receipt_items (
  id          BIGSERIAL PRIMARY KEY,
  receipt_id  BIGINT        NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  description VARCHAR(200)  NOT NULL,
  principal   NUMERIC(15,2) NOT NULL DEFAULT 0,
  interest    NUMERIC(15,2) NOT NULL DEFAULT 0,
  balance_after NUMERIC(15,2)
);
CREATE TABLE dividends (
  id             BIGSERIAL PRIMARY KEY,
  member_id      BIGINT        NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  fiscal_year    SMALLINT      NOT NULL,              -- พ.ศ.
  dividend_rate  NUMERIC(5,2)  NOT NULL,
  dividend_amount NUMERIC(15,2) NOT NULL,
  refund_rate    NUMERIC(5,2)  NOT NULL,
  refund_amount  NUMERIC(15,2) NOT NULL,
  paid_date      DATE,
  UNIQUE (member_id, fiscal_year)
);
CREATE TABLE beneficiaries (
  id            BIGSERIAL PRIMARY KEY,
  member_id     BIGINT       NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  full_name     VARCHAR(200) NOT NULL,
  relation      VARCHAR(50)  NOT NULL,
  id_card_enc   BYTEA,
  id_card_last4 CHAR(4),
  share_percent NUMERIC(5,2) NOT NULL CHECK (share_percent > 0 AND share_percent <= 100),
  effective_date DATE        NOT NULL
);

-- ---------- เนื้อหาเว็บไซต์ (CMS) ----------
CREATE TABLE news_categories (
  id    SERIAL PRIMARY KEY,
  code  VARCHAR(20)  NOT NULL UNIQUE,                -- general, meeting, election, dividend, welfare
  name  VARCHAR(100) NOT NULL
);
CREATE TABLE news (
  id            BIGSERIAL PRIMARY KEY,
  category_id   INT          NOT NULL REFERENCES news_categories(id),
  title         VARCHAR(200) NOT NULL,
  slug          VARCHAR(220) NOT NULL UNIQUE,
  excerpt       VARCHAR(300),
  body          TEXT         NOT NULL,               -- sanitize ด้วย allow-list ก่อนบันทึก
  is_pinned     BOOLEAN      NOT NULL DEFAULT FALSE,
  status        VARCHAR(20)  NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  published_at  TIMESTAMPTZ,
  created_by    BIGINT,
  updated_by    BIGINT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX ix_news_list ON news(status, is_pinned DESC, published_at DESC);
CREATE INDEX ix_news_search ON news USING gin (to_tsvector('simple', title || ' ' || coalesce(excerpt,'') || ' ' || body));

CREATE TABLE files (                                 -- ไฟล์ทั้งหมด (แนบข่าว, ดาวน์โหลด, รายงาน)
  id            BIGSERIAL PRIMARY KEY,
  category      VARCHAR(50)  NOT NULL,               -- แบบฟอร์มสมาชิก / ระเบียบ / ข้อบังคับ / งบการเงิน / news-attachment ...
  title         VARCHAR(200) NOT NULL,
  storage_path  VARCHAR(255) NOT NULL,
  mime_type     VARCHAR(100) NOT NULL CHECK (mime_type = 'application/pdf'),
  size_bytes    BIGINT       NOT NULL CHECK (size_bytes <= 10485760),
  sha256        CHAR(64)     NOT NULL,
  is_public     BOOLEAN      NOT NULL DEFAULT TRUE,
  uploaded_by   BIGINT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE TABLE news_attachments (
  news_id BIGINT NOT NULL REFERENCES news(id) ON DELETE CASCADE,
  file_id BIGINT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  PRIMARY KEY (news_id, file_id)
);
CREATE TABLE banners (
  id          BIGSERIAL PRIMARY KEY,
  tag         VARCHAR(40), title VARCHAR(120) NOT NULL, body VARCHAR(300),
  cta_label   VARCHAR(40), cta_url VARCHAR(300),
  theme       VARCHAR(20) NOT NULL DEFAULT 'navy',
  sort_order  SMALLINT NOT NULL DEFAULT 0,
  starts_at   TIMESTAMPTZ, ends_at TIMESTAMPTZ,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE interest_rates (                        -- เก็บประวัติ ไม่ update ทับ
  id             BIGSERIAL PRIMARY KEY,
  product_kind   VARCHAR(10)  NOT NULL CHECK (product_kind IN ('deposit','loan')),
  product_code   VARCHAR(20)  NOT NULL,
  product_name   VARCHAR(150) NOT NULL,
  rate           NUMERIC(5,2) NOT NULL CHECK (rate >= 0 AND rate <= 30),
  note           VARCHAR(150),
  effective_date DATE         NOT NULL,
  created_by     BIGINT,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (product_code, effective_date)
);
CREATE TABLE people (                                -- คณะกรรมการ / ผู้ตรวจสอบกิจการ / เจ้าหน้าที่
  id         BIGSERIAL PRIMARY KEY,
  group_code VARCHAR(20)  NOT NULL CHECK (group_code IN ('board','auditor','staff')),
  full_name  VARCHAR(200) NOT NULL,
  position   VARCHAR(150) NOT NULL,
  photo_path VARCHAR(255),
  term       VARCHAR(50),
  sort_order SMALLINT     NOT NULL DEFAULT 0,
  is_active  BOOLEAN      NOT NULL DEFAULT TRUE
);
CREATE TABLE faqs (
  id SERIAL PRIMARY KEY, question VARCHAR(300) NOT NULL, answer TEXT NOT NULL,
  sort_order SMALLINT NOT NULL DEFAULT 0, is_active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE financial_summaries (
  fiscal_year SMALLINT PRIMARY KEY, total_assets NUMERIC(18,2), net_profit NUMERIC(18,2),
  member_count INTEGER, dividend_rate NUMERIC(5,2), refund_rate NUMERIC(5,2)
);
CREATE TABLE complaints (
  id          BIGSERIAL PRIMARY KEY,
  ref_no      VARCHAR(20)  NOT NULL UNIQUE,
  topic       VARCHAR(50)  NOT NULL,
  full_name   VARCHAR(100) NOT NULL,
  phone       VARCHAR(15)  NOT NULL,
  email       VARCHAR(120),
  message     TEXT         NOT NULL,
  consent_at  TIMESTAMPTZ  NOT NULL,                 -- PDPA consent
  status      VARCHAR(20)  NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_progress','closed')),
  ip_address  INET,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE TABLE cookie_consents (
  id          BIGSERIAL PRIMARY KEY,
  consent_id  UUID        NOT NULL,                  -- anonymous id ใน cookie
  necessary   BOOLEAN     NOT NULL DEFAULT TRUE,
  preference  BOOLEAN     NOT NULL,
  analytics   BOOLEAN     NOT NULL,
  policy_version VARCHAR(10) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- ผู้ดูแลระบบ / สิทธิ์ ----------
CREATE TABLE admin_users (
  id              BIGSERIAL PRIMARY KEY,
  username        VARCHAR(40)  NOT NULL UNIQUE,
  full_name       VARCHAR(150) NOT NULL,
  email           VARCHAR(120) NOT NULL UNIQUE,
  password_hash   VARCHAR(255) NOT NULL,             -- argon2id
  role            VARCHAR(20)  NOT NULL CHECK (role IN ('super','staff','viewer')),
  totp_secret_enc BYTEA,                             -- 2FA สำหรับผู้ดูแล (แนะนำ)
  failed_attempts SMALLINT     NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ,
  is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE TABLE role_permissions (
  role       VARCHAR(20) NOT NULL,
  permission VARCHAR(50) NOT NULL,                  -- content.edit, members.import, users.manage, audit.view ...
  PRIMARY KEY (role, permission)
);
INSERT INTO role_permissions VALUES
 ('super','content.view'),('super','content.edit'),('super','complaints.edit'),('super','members.import'),('super','users.manage'),('super','audit.view'),
 ('staff','content.view'),('staff','content.edit'),('staff','complaints.edit'),
 ('viewer','content.view'),('viewer','audit.view');

CREATE TABLE import_jobs (
  id          BIGSERIAL PRIMARY KEY,
  file_name   VARCHAR(200) NOT NULL,
  total_rows  INTEGER NOT NULL, ok_rows INTEGER NOT NULL, error_rows INTEGER NOT NULL,
  errors      JSONB,
  created_by  BIGINT REFERENCES admin_users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Audit log (append-only) ----------
CREATE TABLE audit_logs (
  id           BIGSERIAL PRIMARY KEY,
  occurred_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  actor_type   VARCHAR(10)  NOT NULL CHECK (actor_type IN ('member','admin','system','anonymous')),
  actor_id     BIGINT,
  actor_label  VARCHAR(100),
  action       VARCHAR(60)  NOT NULL,               -- login, login_failed, otp_failed, logout, create:news, update:rates ...
  entity       VARCHAR(50),
  entity_id    VARCHAR(50),
  before_data  JSONB,
  after_data   JSONB,
  success      BOOLEAN      NOT NULL DEFAULT TRUE,
  ip_address   INET,
  user_agent   VARCHAR(255)
);
CREATE INDEX ix_audit_time  ON audit_logs(occurred_at DESC);
CREATE INDEX ix_audit_actor ON audit_logs(actor_type, actor_id, occurred_at DESC);
-- ห้ามแก้ไข/ลบ audit log จากแอปพลิเคชัน
REVOKE UPDATE, DELETE ON audit_logs FROM PUBLIC;
