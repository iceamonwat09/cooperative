/* =========================================================
   member.js — ระบบตรวจสอบข้อมูลสมาชิก (Demo ฝั่งเบราว์เซอร์)
   ระบบจริง: การยืนยันตัวตน/OTP/session ต้องทำที่เซิร์ฟเวอร์ (ดู project-docs/security.md)
   ========================================================= */
(function () {
  'use strict';
  var C = window.Coop;
  if (!C) return;
  var html = C.html, raw = C.raw, icon = C.icon, D = C.D;

  var MAX_FAILS = 5, LOCK_MIN = 15, IDLE_MIN = 15, OTP_TTL = 300, OTP_TRIES = 3;
  var SESSION_KEY = 'coop.msession';

  /* ---------------- Crypto helpers ---------------- */
  function hexToBytes(hex) { var a = new Uint8Array(hex.length / 2); for (var i = 0; i < a.length; i++) a[i] = parseInt(hex.substr(i * 2, 2), 16); return a; }
  function bytesToHex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return b.toString(16).padStart(2, '0'); }).join(''); }
  function randHex(n) { var a = new Uint8Array(n); crypto.getRandomValues(a); return bytesToHex(a); }
  function pbkdf2(password, saltHex, iter) {
    if (!window.crypto || !crypto.subtle) return Promise.reject(new Error('เบราว์เซอร์นี้ไม่รองรับการเข้ารหัส (ต้องเปิดผ่าน HTTPS)'));
    var enc = new TextEncoder();
    return crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']).then(function (key) {
      return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: hexToBytes(saltHex), iterations: iter }, key, 256);
    }).then(bytesToHex);
  }
  function safeEqual(a, b) { if (a.length !== b.length) return false; var r = 0; for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }
  function verifyPassword(cred, password) { return pbkdf2(password, cred.salt, cred.iter).then(function (h) { return safeEqual(h, cred.hash); }); }
  function makeCred(password) { var salt = randHex(16); return pbkdf2(password, salt, 150000).then(function (h) { return { salt: salt, hash: h, iter: 150000 }; }); }
  function otpCode() { var a = new Uint32Array(1); crypto.getRandomValues(a); return String(a[0] % 1000000).padStart(6, '0'); }

  /* ---------------- Members & lockout ---------------- */
  function findMember(no) { return D.MEMBERS.filter(function (m) { return m.memberNo === no; })[0]; }
  function credOf(m) { return C.LS.get('coop.mcred.' + m.memberNo, null) || m.cred; }
  function lockInfo(no) { return C.LS.get('coop.lock.m.' + no, { fails: 0, until: 0 }); }
  function setLock(no, v) { C.LS.set('coop.lock.m.' + no, v); }

  /* ---------------- Session ---------------- */
  function getSession() {
    var s = C.SS.get(SESSION_KEY, null);
    if (!s) return null;
    if (Date.now() - s.lastActive > IDLE_MIN * 60000) { C.SS.del(SESSION_KEY); C.SS.set('coop.m.expired', 1); return null; }
    return s;
  }
  function touch() { var s = C.SS.get(SESSION_KEY, null); if (s) { s.lastActive = Date.now(); C.SS.set(SESSION_KEY, s); } }
  function logout(reason) {
    var s = C.SS.get(SESSION_KEY, null);
    if (s) C.audit('member:' + s.memberNo, 'logout', reason || 'ออกจากระบบ');
    C.SS.del(SESSION_KEY);
    if (reason === 'timeout') C.SS.set('coop.m.expired', 1);
    C.go('/member');
  }
  var lastTouch = 0;
  ['click', 'keydown', 'scroll', 'touchstart'].forEach(function (ev) {
    document.addEventListener(ev, function () {
      if (Date.now() - lastTouch < 5000) return;
      lastTouch = Date.now();
      if (location.hash.indexOf('#/member') === 0 && C.SS.get(SESSION_KEY, null)) touch();
    }, { passive: true, capture: true });
  });

  /* =========================================================
     หน้าเข้าสู่ระบบ (2 ขั้น: รหัสผ่าน → OTP)
     ========================================================= */
  var pending = null; // { memberNo, otp, exp, tries, ref }
  var otpToast = null;
  function loginPage() {
    var expired = C.SS.get('coop.m.expired', 0);
    C.SS.del('coop.m.expired');
    return { title: 'เข้าสู่ระบบสมาชิก', html: html`<div class="auth-wrap"><div class="card auth-card"><div class="card__body" id="authBody">
      <div class="auth-card__icon">${icon('i-lock')}</div>
      <h1 style="font-size:1.5rem;margin-bottom:4px">ตรวจสอบข้อมูลสมาชิก</h1>
      <p class="muted" style="margin-bottom:18px">เข้าสู่ระบบด้วยเลขทะเบียนสมาชิกและรหัสผ่าน</p>
      ${expired ? html`<div class="alert alert--warn" role="alert" style="margin-bottom:14px">หมดเวลาการใช้งาน (ไม่มีการใช้งานเกิน ${IDLE_MIN} นาที) กรุณาเข้าสู่ระบบอีกครั้ง</div>` : ''}
      <form id="loginForm" class="form-grid" novalidate>
        <div class="field"><label for="mNo">เลขทะเบียนสมาชิก</label><span class="hint" id="mNoHint">ตัวเลข 6 หลัก</span>
          <input id="mNo" class="input num" inputmode="numeric" autocomplete="username" required pattern="[0-9]{6}" maxlength="6" aria-describedby="mNoHint">
          <span class="error-msg">กรุณากรอกเลขทะเบียนสมาชิก 6 หลัก</span></div>
        <div class="field"><label for="mPw">รหัสผ่าน</label>
          <div class="input-group"><input id="mPw" class="input" type="password" autocomplete="current-password" required maxlength="64"><button type="button" class="addon" id="togglePw" aria-label="แสดงรหัสผ่าน" aria-pressed="false" style="cursor:pointer">${icon('i-eye')}</button></div>
          <span class="error-msg">กรุณากรอกรหัสผ่าน</span></div>
        <div id="loginMsg" aria-live="assertive"></div>
        <button class="btn btn--primary btn--lg btn--block" type="submit" id="loginBtn">เข้าสู่ระบบ</button>
        <p class="small muted" style="margin:0;text-align:center">ลืมรหัสผ่าน? ติดต่อ ${D.SITE.phone} พร้อมบัตรประชาชน<br>สหกรณ์ฯ จะไม่ขอรหัสผ่านหรือ OTP จากท่านทุกช่องทาง</p>
        <div class="demo-creds"><strong>บัญชีทดลอง (Demo):</strong> เลขทะเบียน <code>000123</code> รหัสผ่าน <code>Demo@1234</code><br>รหัส OTP จะแสดงเป็นข้อความแจ้งเตือนมุมจอแทน SMS</div>
      </form></div></div></div>`, after: initLogin };
  }

  function initLogin(root) {
    var form = root.querySelector('#loginForm'), msg = root.querySelector('#loginMsg'), btn = root.querySelector('#loginBtn');
    var pw = root.querySelector('#mPw');
    root.querySelector('#togglePw').addEventListener('click', function (e) {
      var show = pw.type === 'password'; pw.type = show ? 'text' : 'password';
      e.currentTarget.setAttribute('aria-pressed', String(show)); e.currentTarget.setAttribute('aria-label', show ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน');
    });
    function fail(text) { msg.innerHTML = html`<div class="alert alert--danger" role="alert">${text}</div>`.__raw; }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      msg.innerHTML = '';
      if (!form.checkValidity()) { form.reportValidity(); return; }
      var no = root.querySelector('#mNo').value.trim();
      var lk = lockInfo(no);
      if (lk.until > Date.now()) { fail('บัญชีถูกระงับชั่วคราวเนื่องจากใส่รหัสผ่านผิดเกิน ' + MAX_FAILS + ' ครั้ง กรุณาลองใหม่ในอีก ' + Math.ceil((lk.until - Date.now()) / 60000) + ' นาที หรือติดต่อเจ้าหน้าที่'); return; }
      btn.disabled = true; btn.textContent = 'กำลังตรวจสอบ…';
      var m = findMember(no);
      // ตรวจรหัสเสมอแม้ไม่พบสมาชิก เพื่อไม่ให้เวลาตอบสนองบอกได้ว่ามีเลขทะเบียนนี้หรือไม่
      var cred = m ? credOf(m) : { salt: '00'.repeat(16), hash: 'x', iter: 150000 };
      verifyPassword(cred, pw.value).then(function (ok) {
        if (!m || !ok) {
          lk.fails = (lk.until && lk.until <= Date.now()) ? 1 : lk.fails + 1;
          lk.until = 0;
          if (lk.fails >= MAX_FAILS) { lk.until = Date.now() + LOCK_MIN * 60000; lk.fails = 0; }
          setLock(no, lk);
          C.audit('member:' + no, 'login', 'รหัสผ่านไม่ถูกต้อง', false);
          if (lk.until) fail('ใส่รหัสผ่านผิดเกินกำหนด บัญชีถูกระงับ ' + LOCK_MIN + ' นาที');
          else fail('เลขทะเบียนสมาชิกหรือรหัสผ่านไม่ถูกต้อง' + (lk.fails >= 3 ? ' (เหลือโอกาสอีก ' + (MAX_FAILS - lk.fails) + ' ครั้ง)' : ''));
          pw.value = ''; pw.focus();
          return;
        }
        setLock(no, { fails: 0, until: 0 });
        startOtp(root, m);
      }).catch(function (err) {
        fail('ไม่สามารถตรวจสอบได้: ' + err.message);
      }).finally(function () { btn.disabled = false; btn.textContent = 'เข้าสู่ระบบ'; });
    });
  }

  function sendOtp(m) {
    pending = { memberNo: m.memberNo, otp: otpCode(), exp: Date.now() + OTP_TTL * 1000, tries: 0, ref: randHex(2).toUpperCase(), sentAt: Date.now() };
    if (otpToast) otpToast.remove();
    otpToast = C.toast('รหัส OTP ของท่านคือ ' + pending.otp + ' (Ref: ' + pending.ref + ') ใช้ได้ภายใน 5 นาที', 'otp', 'SMS ถึง ' + C.maskPhone(m.phone) + ' (Demo)');
  }
  function startOtp(root, m) {
    sendOtp(m);
    var body = root.querySelector('#authBody');
    body.innerHTML = html`<div class="auth-card__icon">${icon('i-shield')}</div>
      <h1 style="font-size:1.4rem;margin-bottom:4px">ยืนยันตัวตนด้วย OTP</h1>
      <p class="muted">ส่งรหัส 6 หลักไปที่เบอร์ <strong class="num">${C.maskPhone(m.phone)}</strong> แล้ว <span id="otpRef">(Ref: ${pending.ref})</span></p>
      <form id="otpForm" class="form-grid" novalidate>
        <div class="field"><label for="otp">รหัส OTP</label><input id="otp" class="input otp-input" inputmode="numeric" autocomplete="one-time-code" required pattern="[0-9]{6}" maxlength="6"><span class="error-msg">กรุณากรอกรหัส 6 หลัก</span></div>
        <div id="otpMsg" aria-live="assertive"></div>
        <button class="btn btn--primary btn--lg btn--block" type="submit">ยืนยัน</button>
        <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap" class="small">
          <button type="button" class="linklike" id="resend" disabled>ขอรหัสใหม่ (<span id="cd">60</span>)</button>
          <a href="#/member" id="backLogin">เปลี่ยนบัญชี</a></div>
      </form>`.__raw;
    var otp = body.querySelector('#otp'); otp.focus();
    var resend = body.querySelector('#resend'), cd = body.querySelector('#cd');
    var iv = setInterval(function () {
      var left = 60 - Math.floor((Date.now() - pending.sentAt) / 1000);
      if (left <= 0) { resend.disabled = false; resend.textContent = 'ขอรหัสใหม่'; } else { resend.disabled = true; resend.innerHTML = 'ขอรหัสใหม่ (<span>' + left + '</span>)'; }
    }, 1000);
    C.onCleanup(function () { clearInterval(iv); });
    body.querySelector('#backLogin').addEventListener('click', function (e) { e.preventDefault(); pending = null; C.render(); });
    resend.addEventListener('click', function () { sendOtp(m); body.querySelector('#otpRef').textContent = '(Ref: ' + pending.ref + ')'; body.querySelector('#otpMsg').innerHTML = ''; otp.value = ''; otp.focus(); });
    body.querySelector('#otpForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var out = body.querySelector('#otpMsg');
      if (!e.target.checkValidity()) { e.target.reportValidity(); return; }
      if (!pending || Date.now() > pending.exp) { out.innerHTML = html`<div class="alert alert--danger" role="alert">รหัส OTP หมดอายุ กรุณากด “ขอรหัสใหม่”</div>`.__raw; return; }
      if (otp.value !== pending.otp) {
        pending.tries++;
        if (pending.tries >= OTP_TRIES) { pending = null; C.audit('member:' + m.memberNo, 'otp', 'OTP ผิดเกินกำหนด', false); C.toast('ใส่ OTP ผิดเกิน ' + OTP_TRIES + ' ครั้ง กรุณาเข้าสู่ระบบใหม่', 'error'); C.render(); return; }
        out.innerHTML = html`<div class="alert alert--danger" role="alert">รหัส OTP ไม่ถูกต้อง (เหลือ ${OTP_TRIES - pending.tries} ครั้ง)</div>`.__raw;
        otp.select(); return;
      }
      pending = null;
      if (otpToast) { otpToast.remove(); otpToast = null; }
      C.SS.set(SESSION_KEY, { memberNo: m.memberNo, token: randHex(16), loginAt: Date.now(), lastActive: Date.now() });
      C.audit('member:' + m.memberNo, 'login', 'เข้าสู่ระบบสำเร็จ (รหัสผ่าน + OTP)');
      C.toast('เข้าสู่ระบบสำเร็จ', 'success');
      C.go('/member/overview');
    });
  }

  /* =========================================================
     คำนวณข้อมูลสมาชิก
     ========================================================= */
  var AS_OF = C.parseISO(D.SITE.dataAsOf);
  function monthsBetween(a, b) { return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()); }
  function loanStatus(l) {
    var s = C.schedule(l.principal, l.rate, l.months, l.method);
    var start = C.parseISO(l.start);
    var paid = Math.max(0, Math.min(l.months, monthsBetween(start, AS_OF) + 1));
    var bal = paid === 0 ? l.principal : s.rows[paid - 1].balance;
    var next = paid < l.months ? s.rows[paid] : null;
    var dueDates = s.rows.map(function (r, i) { var d = new Date(start.getFullYear(), start.getMonth() + i + 1, 0); return C.toISO(d); });
    return { sch: s, paid: paid, remaining: l.months - paid, balance: bal, next: next, dueDates: dueDates, pctPaid: Math.round((l.principal - bal) / l.principal * 100) };
  }
  function receiptFor(m, ym) {
    var y = +ym.slice(0, 4), mo = +ym.slice(5, 7);
    var monthEnd = new Date(y, mo, 0);
    var items = [{ name: 'ค่าหุ้นรายเดือน', principal: m.shares.perMonth, interest: 0 }];
    m.loans.forEach(function (l) {
      var st = loanStatus(l);
      var idx = monthsBetween(C.parseISO(l.start), monthEnd);
      if (idx >= 0 && idx < l.months) { var r = st.sch.rows[idx]; items.push({ name: l.type + ' (' + l.contract + ') งวดที่ ' + (idx + 1), principal: r.principal, interest: r.interest, balance: r.balance }); }
    });
    items.push({ name: 'เงินฝากออมทรัพย์พิเศษ (หักเงินเดือน)', principal: 3000, interest: 0 });
    var total = items.reduce(function (a, b) { return a + b.principal + b.interest; }, 0);
    return { no: 'R' + ym.replace('-', '') + '-' + m.memberNo, date: C.toISO(monthEnd), items: items, total: C.round2(total) };
  }
  function receiptMonths() {
    var out = [];
    for (var i = 0; i < 12; i++) { var d = new Date(AS_OF.getFullYear(), AS_OF.getMonth() - i, 1); out.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')); }
    return out;
  }
  function thMonth(ym) { var d = new Date(+ym.slice(0, 4), +ym.slice(5, 7) - 1, 1); return d.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' }); }
  function bahtText(n) {
    // แปลงจำนวนเงินเป็นตัวอักษรภาษาไทย (สำหรับใบเสร็จ)
    var digits = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'], pos = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];
    function read(s) {
      var out = '';
      if (s.length > 6) { out += read(s.slice(0, -6)) + 'ล้าน'; s = s.slice(-6); }
      s = s.replace(/^0+/, '');
      for (var i = 0; i < s.length; i++) {
        var d = +s[i], p = s.length - i - 1;
        if (!d) continue;
        if (p === 1 && d === 1) out += 'สิบ';
        else if (p === 1 && d === 2) out += 'ยี่สิบ';
        else if (p === 0 && d === 1 && s.length > 1) out += 'เอ็ด';
        else out += digits[d] + pos[p];
      }
      return out;
    }
    var parts = (Math.round(n * 100) / 100).toFixed(2).split('.');
    var b = read(parts[0]) || 'ศูนย์', st = +parts[1];
    return b + 'บาท' + (st ? read(parts[1]) + 'สตางค์' : 'ถ้วน');
  }

  /* =========================================================
     Dashboard shell
     ========================================================= */
  var TABS = [
    ['overview', 'ภาพรวม', 'i-chart'], ['shares', 'ทุนเรือนหุ้น', 'i-coins'], ['deposits', 'เงินฝาก', 'i-bank'], ['loans', 'เงินกู้', 'i-file'],
    ['guarantees', 'ภาระค้ำประกัน', 'i-shield'], ['receipts', 'ใบเสร็จรับเงิน', 'i-print'], ['dividends', 'ปันผล/เฉลี่ยคืน', 'i-coins'],
    ['beneficiaries', 'ผู้รับผลประโยชน์', 'i-users'], ['password', 'เปลี่ยนรหัสผ่าน', 'i-lock']
  ];
  function shell(m, tab, content) {
    var name = m.title + m.firstName + ' ' + m.lastName;
    return html`<div class="container app">
      <aside class="app__side no-print"><nav class="card" aria-label="เมนูสมาชิก"><ul class="sidenav">${TABS.map(function (t) { return html`<li><a href="#/member/${t[0]}" ${t[0] === tab ? raw('aria-current="page"') : ''}>${icon(t[2])}${t[1]}</a></li>`; })}
        <li><a href="#/member/logout" class="logout-link">${icon('i-logout')}ออกจากระบบ</a></li></ul></nav></aside>
      <div class="stack" style="min-width:0">
        <div class="card app__userbar no-print">
          <div class="userchip"><div class="userchip__avatar" aria-hidden="true">${m.firstName.charAt(0)}</div><div style="min-width:0"><strong>${name}</strong><div class="small muted">เลขทะเบียน <span class="num">${m.memberNo}</span> · ${m.dept}</div></div></div>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span class="asof">ข้อมูล ณ วันที่ ${C.fmtDate(D.SITE.dataAsOf, 'long')}</span><span class="session-timer" id="sessTimer" aria-live="off"></span></div>
        </div>
        ${content}
      </div></div>`;
  }
  function sessionTimer(root) {
    var el = root.querySelector('#sessTimer'), warned = false;
    function tick() {
      var s = C.SS.get(SESSION_KEY, null);
      if (!s) return;
      var left = IDLE_MIN * 60000 - (Date.now() - s.lastActive);
      if (left <= 0) { clearInterval(iv); C.toast('หมดเวลาการใช้งาน ระบบออกจากระบบให้อัตโนมัติ', 'error'); logout('timeout'); return; }
      var mm = Math.floor(left / 60000), ss = Math.floor(left % 60000 / 1000);
      if (el) { el.textContent = 'หมดเวลาใน ' + mm + ':' + String(ss).padStart(2, '0'); el.classList.toggle('is-warn', left < 60000); }
      if (left < 60000 && !warned) { warned = true; C.toast('ระบบจะออกจากระบบใน 1 นาที หากไม่มีการใช้งาน แตะหน้าจอเพื่อใช้งานต่อ', 'error'); }
      if (left >= 60000) warned = false;
    }
    var iv = setInterval(tick, 1000); tick();
    C.onCleanup(function () { clearInterval(iv); });
  }

  /* ---------------- Tabs ---------------- */
  function kpi(label, value, sub, ic) { return html`<div class="card kpi"><div class="kpi__label">${icon(ic || 'i-coins')} ${label}</div><div class="kpi__value">${value}</div>${sub ? html`<div class="kpi__sub">${sub}</div>` : ''}</div>`; }

  function tabOverview(m) {
    var dep = m.deposits.reduce(function (a, d) { return a + d.balance; }, 0);
    var loans = m.loans.map(function (l) { return { l: l, s: loanStatus(l) }; });
    var debt = loans.reduce(function (a, x) { return a + x.s.balance; }, 0);
    var monthly = receiptFor(m, receiptMonths()[0]).total;
    var div = m.dividends[0];
    return html`<h1 class="sr-only">ภาพรวมข้อมูลสมาชิก</h1>
      <div class="kpis">
        ${kpi('ทุนเรือนหุ้น', C.money(m.shares.total), C.num(m.shares.total / m.shares.unitPrice) + ' หุ้น', 'i-coins')}
        ${kpi('เงินฝากรวม', C.money(dep), m.deposits.length + ' บัญชี', 'i-bank')}
        ${kpi('หนี้เงินกู้คงเหลือ', C.money(debt), loans.length + ' สัญญา', 'i-file')}
        ${kpi('ยอดหักรายเดือน', C.money(monthly), 'งวด ' + thMonth(receiptMonths()[0]), 'i-print')}
      </div>
      <div class="grid grid-2">
        <div class="card"><div class="card__body"><div class="acct"><h2 style="font-size:1.1rem;margin:0">เงินกู้</h2><a href="#/member/loans" class="small">ดูรายละเอียด ›</a></div>
          ${loans.map(function (x) { return html`<div style="margin-top:14px"><div class="acct"><strong>${x.l.type}</strong><span class="amount">${C.money(x.s.balance)}</span></div>
            <div class="small muted" style="margin:2px 0 6px">ชำระแล้ว ${x.s.paid}/${x.l.months} งวด · คงเหลือ ${x.s.remaining} งวด</div>
            <div class="progress" role="progressbar" aria-label="ชำระแล้ว ${x.s.pctPaid}%" aria-valuenow="${x.s.pctPaid}" aria-valuemin="0" aria-valuemax="100"><span style="width:${x.s.pctPaid}%"></span></div></div>`; })}
        </div></div>
        <div class="card"><div class="card__body"><div class="acct"><h2 style="font-size:1.1rem;margin:0">เงินฝาก</h2><a href="#/member/deposits" class="small">ดูรายการเคลื่อนไหว ›</a></div>
          ${m.deposits.map(function (d) { return html`<div class="acct" style="padding:12px 0;border-bottom:1px dashed var(--border)"><span><strong>${d.type}</strong><br><span class="acct__no">${C.maskAcct(d.no)}</span></span><span class="amount">${C.money(d.balance)}</span></div>`; })}
        </div></div>
        <div class="card"><div class="card__body"><div class="acct"><h2 style="font-size:1.1rem;margin:0">ปันผลล่าสุด (ปี ${div.year})</h2><a href="#/member/dividends" class="small">ย้อนหลัง ›</a></div>
          <dl class="dl" style="margin-top:12px"><dt>เงินปันผล ${div.dividendRate.toFixed(2)}%</dt><dd>${C.money(div.dividend)}</dd><dt>เงินเฉลี่ยคืน ${div.refundRate}%</dt><dd>${C.money(div.refund)}</dd><dt><strong>รวม</strong></dt><dd><strong>${C.money(div.dividend + div.refund)}</strong></dd></dl></div></div>
        <div class="card"><div class="card__body"><div class="acct"><h2 style="font-size:1.1rem;margin:0">ภาระค้ำประกัน</h2><a href="#/member/guarantees" class="small">รายละเอียด ›</a></div>
          <dl class="dl" style="margin-top:12px"><dt>ท่านค้ำประกันให้ผู้อื่น</dt><dd>${m.guaranteeFor.length} สัญญา</dd><dt>ผู้ค้ำประกันเงินกู้ของท่าน</dt><dd>${m.guaranteedBy.length} คน</dd><dt>ยอดภาระค้ำคงเหลือ</dt><dd>${C.money(m.guaranteeFor.reduce(function (a, g) { return a + g.balance; }, 0))}</dd></dl></div></div>
      </div>
      <div class="card"><div class="card__body"><h2 style="font-size:1.1rem">ข้อมูลส่วนตัว</h2>
        <dl class="dl"><dt>เลขประจำตัวประชาชน</dt><dd>${C.maskId(m.idCard)}</dd><dt>โทรศัพท์</dt><dd>${C.maskPhone(m.phone)}</dd><dt>อีเมล</dt><dd>${C.maskEmail(m.email)}</dd><dt>วันที่เป็นสมาชิก</dt><dd>${C.fmtDate(m.joinDate, 'long')}</dd></dl>
        <p class="small muted" style="margin:10px 0 0">ข้อมูลอ่อนไหวแสดงแบบปิดบังบางส่วนเพื่อความปลอดภัย หากต้องการแก้ไขข้อมูลโปรดติดต่อเจ้าหน้าที่</p></div></div>`;
  }

  function tabShares(m) {
    return html`<div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr))">
        ${kpi('ทุนเรือนหุ้นสะสม', C.money(m.shares.total) + ' บาท', null, 'i-coins')}
        ${kpi('จำนวนหุ้น', C.num(m.shares.total / m.shares.unitPrice) + ' หุ้น', 'มูลค่าหุ้นละ ' + m.shares.unitPrice + ' บาท', 'i-chart')}
        ${kpi('ส่งหุ้นรายเดือน', C.money(m.shares.perMonth) + ' บาท', 'หักจากเงินเดือน', 'i-calc')}
      </div>
      <div class="card"><div class="card__body"><h1 style="font-size:1.2rem">ประวัติการส่งค่าหุ้น</h1>
        <div class="table-wrap"><table class="table table--stack"><thead><tr><th scope="col">วันที่</th><th scope="col">รายการ</th><th scope="col" class="r">จำนวนเงิน</th><th scope="col" class="r">ทุนเรือนหุ้นสะสม</th></tr></thead>
        <tbody>${m.shares.history.map(function (h) { return html`<tr><td data-label="วันที่">${C.fmtDate(h[0])}</td><td data-label="รายการ">ส่งค่าหุ้นรายเดือน</td><td data-label="จำนวนเงิน" class="r amount--in">+${C.money(h[1])}</td><td data-label="สะสม" class="r">${C.money(h[2])}</td></tr>`; })}</tbody></table></div>
        <p class="small muted" style="margin:10px 0 0">ต้องการเปลี่ยนแปลงค่าหุ้นรายเดือน ดาวน์โหลด “คำขอเปลี่ยนแปลงค่าหุ้นรายเดือน” ที่หน้า <a href="#/downloads">ดาวน์โหลด</a></p></div></div>`;
  }

  var depIdx = 0;
  function tabDeposits(m) {
    if (depIdx >= m.deposits.length) depIdx = 0;
    var d = m.deposits[depIdx];
    return html`<div class="grid grid-3">${m.deposits.map(function (x, i) {
        return html`<button type="button" class="card quick__item dep-pick" data-i="${i}" aria-pressed="${i === depIdx}" style="text-align:left;cursor:pointer;${i === depIdx ? 'border-color:var(--brand-600);box-shadow:0 0 0 2px var(--brand-500)' : ''}"><span style="width:100%"><strong>${x.type}</strong><small class="acct__no">${C.maskAcct(x.no)} · ${x.rate.toFixed(2)}%</small><span class="amount" style="font-size:1.25rem;display:block;margin-top:6px">${C.money(x.balance)}</span></span></button>`;
      })}</div>
      <div class="card"><div class="card__body"><div class="acct" style="margin-bottom:12px"><h1 style="font-size:1.2rem;margin:0">รายการเคลื่อนไหว: ${d.type}</h1><span class="acct__no">${C.maskAcct(d.no)}</span></div>
        <div class="table-wrap"><table class="table table--stack"><thead><tr><th scope="col">วันที่</th><th scope="col">รายการ</th><th scope="col" class="r">ฝาก</th><th scope="col" class="r">ถอน</th><th scope="col" class="r">คงเหลือ</th></tr></thead>
        <tbody>${d.tx.map(function (t) { return html`<tr><td data-label="วันที่">${C.fmtDate(t[0])}</td><td data-label="รายการ">${t[1]}</td><td data-label="ฝาก" class="r amount--in">${t[2] ? C.money(t[2]) : '-'}</td><td data-label="ถอน" class="r amount--out">${t[3] ? C.money(t[3]) : '-'}</td><td data-label="คงเหลือ" class="r">${C.money(t[4])}</td></tr>`; })}</tbody></table></div></div></div>`;
  }

  var loanIdx = 0;
  function tabLoans(m) {
    if (loanIdx >= m.loans.length) loanIdx = 0;
    var l = m.loans[loanIdx], st = loanStatus(l);
    return html`<div class="grid grid-2">${m.loans.map(function (x, i) {
        var s = loanStatus(x);
        return html`<button type="button" class="card quick__item loan-pick" data-i="${i}" aria-pressed="${i === loanIdx}" style="text-align:left;cursor:pointer;${i === loanIdx ? 'border-color:var(--brand-600);box-shadow:0 0 0 2px var(--brand-500)' : ''}"><span style="width:100%"><strong>${x.type}</strong><small>สัญญา ${x.contract} · ${x.rate.toFixed(2)}%</small><span class="amount" style="font-size:1.25rem;display:block;margin:6px 0">${C.money(s.balance)}</span><span class="progress" style="display:block"><span style="width:${s.pctPaid}%"></span></span><small>ชำระแล้ว ${s.pctPaid}%</small></span></button>`;
      })}</div>
      <div class="card"><div class="card__body">
        <h1 style="font-size:1.2rem">${l.type} — สัญญาเลขที่ ${l.contract}</h1>
        <div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-bottom:16px">
          ${kpi('วงเงินกู้', C.money(l.principal), null, 'i-bank')}${kpi('คงเหลือ', C.money(st.balance), null, 'i-file')}
          ${kpi('งวดคงเหลือ', st.remaining + ' / ' + l.months, null, 'i-calc')}${kpi('งวดถัดไป', st.next ? C.money(st.next.payment) : 'ปิดบัญชีแล้ว', st.next ? 'ครบกำหนด ' + C.fmtDate(st.dueDates[st.paid]) : '', 'i-clock')}
        </div>
        <p class="small muted">วิธีชำระ: ${l.method === 'annuity' ? 'ผ่อนคงที่ (คงยอด)' : 'ลดต้นลดดอก (คงต้น)'} · ดอกเบี้ย ${l.rate.toFixed(2)}% ต่อปี · เริ่มสัญญา ${C.fmtDate(l.start, 'long')} · ผู้ค้ำประกัน ${l.guarantors} คน</p>
        <h2 style="font-size:1.05rem;margin-top:16px">ตารางผ่อนชำระ</h2>
        <div class="table-wrap table-wrap--scroll"><table class="table table--sched"><thead><tr><th scope="col">งวด</th><th scope="col">ครบกำหนด</th><th scope="col" class="r col-detail">เงินต้น</th><th scope="col" class="r col-detail">ดอกเบี้ย</th><th scope="col" class="r">ค่างวด</th><th scope="col" class="r">คงเหลือ</th><th scope="col">สถานะ</th></tr></thead>
        <tbody>${st.sch.rows.map(function (r, i) { var paid = i < st.paid; return html`<tr${i === st.paid ? raw(' id="nextRow" style="background:var(--gold-100)"') : ''}><td class="num">${r.n}</td><td class="nowrap">${C.fmtDate(st.dueDates[i])}</td><td class="r col-detail">${C.money(r.principal)}</td><td class="r col-detail">${C.money(r.interest)}</td><td class="r"><strong>${C.money(r.payment)}</strong></td><td class="r">${C.money(r.balance)}</td><td>${paid ? html`<span class="badge badge--success">ชำระแล้ว</span>` : i === st.paid ? html`<span class="badge badge--gold">งวดถัดไป</span>` : html`<span class="badge badge--muted">รอชำระ</span>`}</td></tr>`; })}</tbody></table></div>
      </div></div>`;
  }

  function tabGuarantees(m) {
    return html`<div class="card"><div class="card__body"><h1 style="font-size:1.2rem">ท่านค้ำประกันให้ผู้อื่น</h1>
        ${m.guaranteeFor.length ? html`<div class="table-wrap"><table class="table table--stack"><thead><tr><th scope="col">ผู้กู้</th><th scope="col">สัญญา</th><th scope="col" class="r">วงเงินกู้</th><th scope="col" class="r">หนี้คงเหลือ</th></tr></thead>
        <tbody>${m.guaranteeFor.map(function (g) { return html`<tr><td data-label="ผู้กู้">${g.name}<br><span class="small muted">เลขทะเบียน ${g.memberNo}</span></td><td data-label="สัญญา">${g.contract}</td><td data-label="วงเงิน" class="r">${C.money(g.amount)}</td><td data-label="คงเหลือ" class="r">${C.money(g.balance)}</td></tr>`; })}</tbody></table></div>` : html`<p class="muted">ไม่มีภาระค้ำประกัน</p>`}
        <div class="alert alert--info" style="margin-top:12px">ผู้ค้ำประกันมีภาระร่วมรับผิดชอบหนี้ หากผู้กู้ผิดนัดชำระ สหกรณ์ฯ จะแจ้งให้ท่านทราบเป็นลายลักษณ์อักษร</div></div></div>
      <div class="card"><div class="card__body"><h2 style="font-size:1.2rem">ผู้ค้ำประกันเงินกู้ของท่าน</h2>
        <div class="table-wrap"><table class="table table--stack"><thead><tr><th scope="col">ผู้ค้ำประกัน</th><th scope="col">เลขทะเบียน</th><th scope="col">สัญญาที่ค้ำ</th></tr></thead>
        <tbody>${m.guaranteedBy.map(function (g) { return html`<tr><td data-label="ผู้ค้ำ">${g.name}</td><td data-label="เลขทะเบียน" class="num">${g.memberNo}</td><td data-label="สัญญา">${g.contract}</td></tr>`; })}</tbody></table></div></div></div>`;
  }

  function tabReceipts(m) {
    return html`<div class="card"><div class="card__body"><h1 style="font-size:1.2rem">ใบเสร็จรับเงินรายเดือน</h1><p class="muted small">ย้อนหลัง 12 เดือน · กด “ดู / บันทึก PDF” แล้วเลือกปลายทาง “บันทึกเป็น PDF” ในหน้าพิมพ์</p>
      <div class="table-wrap"><table class="table table--stack"><thead><tr><th scope="col">ประจำเดือน</th><th scope="col">เลขที่ใบเสร็จ</th><th scope="col" class="r">จำนวนเงิน</th><th scope="col"></th></tr></thead>
      <tbody>${receiptMonths().map(function (ym) { var r = receiptFor(m, ym); return html`<tr><td data-label="เดือน">${thMonth(ym)}</td><td data-label="เลขที่" class="num">${r.no}</td><td data-label="จำนวนเงิน" class="r">${C.money(r.total)}</td><td data-label="" class="r"><a class="btn btn--outline btn--sm" href="#/member/receipt/${ym}">${icon('i-print')} ดู / บันทึก PDF</a></td></tr>`; })}</tbody></table></div></div></div>`;
  }

  function receiptView(m, ym) {
    if (!/^\d{4}-\d{2}$/.test(ym) || receiptMonths().indexOf(ym) === -1) return html`<div class="alert alert--danger" role="alert">ไม่พบใบเสร็จประจำเดือนที่ระบุ</div><p><a class="btn btn--outline" href="#/member/receipts">‹ กลับ</a></p>`;
    var r = receiptFor(m, ym);
    return html`<p class="no-print" style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn btn--outline btn--sm" href="#/member/receipts">‹ กลับ</a><button type="button" class="btn btn--primary btn--sm" id="printReceipt">${icon('i-print')} พิมพ์ / บันทึกเป็น PDF</button></p>
      <article class="receipt" aria-label="ใบเสร็จรับเงิน">
        <div class="receipt__head"><img src="assets/img/logo.svg" alt="" width="56" height="56"><div><h2 style="margin:0;font-size:1.15rem">${D.SITE.name}</h2><div class="small">${D.SITE.address}</div></div></div>
        <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px"><div><h3 style="margin:0">ใบเสร็จรับเงิน</h3><div class="small">ประจำเดือน ${thMonth(ym)}</div></div>
          <div class="small" style="text-align:right">เลขที่ <strong>${r.no}</strong><br>วันที่ ${C.fmtDate(r.date, 'long')}</div></div>
        <p class="small" style="margin-bottom:12px">ได้รับเงินจาก <strong>${m.title}${m.firstName} ${m.lastName}</strong> เลขทะเบียนสมาชิก ${m.memberNo} หน่วยงาน ${m.dept}</p>
        <div class="table-wrap" style="border-color:#ddd;background:#fff"><table class="table"><thead><tr><th scope="col">รายการ</th><th scope="col" class="r">เงินต้น</th><th scope="col" class="r">ดอกเบี้ย</th><th scope="col" class="r">รวม</th><th scope="col" class="r">คงเหลือ</th></tr></thead>
          <tbody>${r.items.map(function (it) { return html`<tr><td>${it.name}</td><td class="r">${C.money(it.principal)}</td><td class="r">${it.interest ? C.money(it.interest) : '-'}</td><td class="r">${C.money(it.principal + it.interest)}</td><td class="r">${it.balance !== undefined ? C.money(it.balance) : '-'}</td></tr>`; })}</tbody>
          <tfoot><tr><td colspan="3">รวมเงิน (${bahtText(r.total)})</td><td class="r">${C.money(r.total)}</td><td></td></tr></tfoot></table></div>
        <div style="display:flex;justify-content:space-between;margin-top:40px;gap:20px;font-size:.9rem"><div style="text-align:center">.................................<br>เหรัญญิก</div><div style="text-align:center">.................................<br>ผู้จัดการ</div></div>
        <p class="small" style="margin-top:20px;color:#666">เอกสารนี้จัดทำจากระบบตรวจสอบข้อมูลสมาชิก (ตัวอย่าง — ไม่ใช่เอกสารทางการเงินจริง)</p>
      </article>`;
  }

  function tabDividends(m) {
    var tot = m.dividends.reduce(function (a, d) { return a + d.dividend + d.refund; }, 0);
    return html`<div class="card"><div class="card__body"><h1 style="font-size:1.2rem">เงินปันผลและเงินเฉลี่ยคืนย้อนหลัง</h1>
      <div class="table-wrap"><table class="table table--stack"><thead><tr><th scope="col">ปีบัญชี</th><th scope="col" class="r">อัตราปันผล</th><th scope="col" class="r">เงินปันผล</th><th scope="col" class="r">อัตราเฉลี่ยคืน</th><th scope="col" class="r">เงินเฉลี่ยคืน</th><th scope="col" class="r">รวม</th><th scope="col">วันที่จ่าย</th></tr></thead>
      <tbody>${m.dividends.map(function (d) { return html`<tr><td data-label="ปี"><strong>${d.year}</strong></td><td data-label="อัตราปันผล" class="r">${d.dividendRate.toFixed(2)}%</td><td data-label="ปันผล" class="r">${C.money(d.dividend)}</td><td data-label="อัตราเฉลี่ยคืน" class="r">${d.refundRate.toFixed(2)}%</td><td data-label="เฉลี่ยคืน" class="r">${C.money(d.refund)}</td><td data-label="รวม" class="r"><strong>${C.money(d.dividend + d.refund)}</strong></td><td data-label="วันที่จ่าย">${C.fmtDate(d.paid)}</td></tr>`; })}</tbody>
      <tfoot><tr><td colspan="5">รวม ${m.dividends.length} ปี</td><td class="r">${C.money(tot)}</td><td></td></tr></tfoot></table></div>
      <p class="small muted" style="margin:10px 0 0">เงินปันผลและเฉลี่ยคืนโอนเข้าบัญชีเงินฝากออมทรัพย์ของท่าน</p></div></div>`;
  }

  function tabBeneficiaries(m) {
    return html`<div class="card"><div class="card__body"><h1 style="font-size:1.2rem">ผู้รับผลประโยชน์</h1>
      <div class="table-wrap"><table class="table table--stack"><thead><tr><th scope="col">ชื่อ – นามสกุล</th><th scope="col">ความสัมพันธ์</th><th scope="col">เลขประจำตัวประชาชน</th><th scope="col" class="r">สัดส่วน</th></tr></thead>
      <tbody>${m.beneficiaries.map(function (b) { return html`<tr><td data-label="ชื่อ">${b.name}</td><td data-label="ความสัมพันธ์">${b.relation}</td><td data-label="เลขบัตร" class="num">${C.maskId(b.idCard)}</td><td data-label="สัดส่วน" class="r">${b.share}%</td></tr>`; })}</tbody></table></div>
      <div class="alert alert--info" style="margin-top:12px">ต้องการเปลี่ยนแปลงผู้รับผลประโยชน์ ยื่น “หนังสือแต่งตั้งผู้รับผลประโยชน์” ฉบับใหม่ที่สำนักงาน <a href="#/downloads">ดาวน์โหลดแบบฟอร์ม</a></div></div></div>`;
  }

  function tabPassword() {
    return html`<form class="card" id="pwForm" novalidate style="max-width:560px"><div class="card__body form-grid">
      <h1 style="font-size:1.2rem;margin:0">เปลี่ยนรหัสผ่าน</h1>
      <div class="field"><label for="pwOld">รหัสผ่านปัจจุบัน</label><input id="pwOld" class="input" type="password" autocomplete="current-password" required><span class="error-msg">กรุณากรอกรหัสผ่านปัจจุบัน</span></div>
      <div class="field"><label for="pwNew">รหัสผ่านใหม่</label>
        <ul class="hint" id="pwRules" style="margin:0;padding-left:18px"><li>อย่างน้อย 8 ตัวอักษร</li><li>มีตัวพิมพ์ใหญ่ ตัวพิมพ์เล็ก และตัวเลข</li><li>มีอักขระพิเศษ เช่น ! @ # $</li></ul>
        <input id="pwNew" class="input" type="password" autocomplete="new-password" required minlength="8" maxlength="64" pattern="(?=.*\\d)(?=.*[a-z])(?=.*[A-Z])(?=.*[\\W_]).{8,64}" aria-describedby="pwRules"><span class="error-msg">รหัสผ่านไม่ตรงตามเงื่อนไข</span></div>
      <div class="field"><label for="pwNew2">ยืนยันรหัสผ่านใหม่</label><input id="pwNew2" class="input" type="password" autocomplete="new-password" required><span class="error-msg" id="pw2Err">รหัสผ่านไม่ตรงกัน</span></div>
      <div id="pwMsg" aria-live="assertive"></div>
      <button class="btn btn--primary" type="submit" id="pwBtn">บันทึกรหัสผ่านใหม่</button>
    </div></form>`;
  }
  function initPassword(root, m) {
    var f = root.querySelector('#pwForm'); if (!f) return;
    var n1 = f.querySelector('#pwNew'), n2 = f.querySelector('#pwNew2'), msg = f.querySelector('#pwMsg'), btn = f.querySelector('#pwBtn');
    function match() { n2.setCustomValidity(n2.value && n2.value !== n1.value ? 'รหัสผ่านไม่ตรงกัน' : ''); }
    n1.addEventListener('input', match); n2.addEventListener('input', match);
    f.addEventListener('submit', function (e) {
      e.preventDefault(); msg.innerHTML = ''; match();
      if (!f.checkValidity()) { f.reportValidity(); return; }
      var old = f.querySelector('#pwOld').value;
      if (old === n1.value) { msg.innerHTML = html`<div class="alert alert--danger" role="alert">รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม</div>`.__raw; return; }
      btn.disabled = true;
      verifyPassword(credOf(m), old).then(function (ok) {
        if (!ok) { C.audit('member:' + m.memberNo, 'change-password', 'รหัสผ่านเดิมไม่ถูกต้อง', false); msg.innerHTML = html`<div class="alert alert--danger" role="alert">รหัสผ่านปัจจุบันไม่ถูกต้อง</div>`.__raw; return; }
        return makeCred(n1.value).then(function (cred) {
          C.LS.set('coop.mcred.' + m.memberNo, cred);
          C.audit('member:' + m.memberNo, 'change-password', 'เปลี่ยนรหัสผ่านสำเร็จ');
          f.reset();
          msg.innerHTML = html`<div class="alert alert--success" role="status">เปลี่ยนรหัสผ่านเรียบร้อยแล้ว ครั้งถัดไปโปรดใช้รหัสผ่านใหม่</div>`.__raw;
          C.toast('เปลี่ยนรหัสผ่านสำเร็จ', 'success');
        });
      }).catch(function (err) { msg.innerHTML = html`<div class="alert alert--danger" role="alert">ไม่สำเร็จ: ${err.message}</div>`.__raw; })
        .finally(function () { btn.disabled = false; });
    });
  }

  /* =========================================================
     Routes
     ========================================================= */
  function guard() { var s = getSession(); if (!s) return null; var m = findMember(s.memberNo); if (!m) { C.SS.del(SESSION_KEY); return null; } return m; }

  C.route('/member', function () {
    if (guard()) { C.go('/member/overview'); return null; }
    return loginPage();
  });
  C.route('/member/logout', function () { logout('ออกจากระบบโดยผู้ใช้'); C.toast('ออกจากระบบเรียบร้อย'); return null; });
  C.route('/member/receipt/:ym', function (p) {
    var m = guard(); if (!m) { C.go('/member'); return null; }
    return { title: 'ใบเสร็จรับเงิน', html: shell(m, 'receipts', receiptView(m, p.ym)), after: function (root) {
      sessionTimer(root);
      var b = root.querySelector('#printReceipt'); if (b) b.addEventListener('click', function () { C.audit('member:' + m.memberNo, 'receipt', 'พิมพ์ใบเสร็จ ' + p.ym); window.print(); });
    } };
  });
  C.route('/member/:tab', function (p) {
    var m = guard(); if (!m) { C.go('/member'); return null; }
    var map = { overview: tabOverview, shares: tabShares, deposits: tabDeposits, loans: tabLoans, guarantees: tabGuarantees, receipts: tabReceipts, dividends: tabDividends, beneficiaries: tabBeneficiaries, password: tabPassword };
    var fn = map[p.tab];
    if (!fn) { C.go('/member/overview'); return null; }
    var tabLabel = TABS.filter(function (t) { return t[0] === p.tab; })[0][1];
    return { title: 'สมาชิก — ' + tabLabel, html: shell(m, p.tab, fn(m)), after: function (root) {
      sessionTimer(root);
      root.querySelectorAll('.dep-pick').forEach(function (b) { b.addEventListener('click', function () { depIdx = +b.dataset.i; C.render(); }); });
      root.querySelectorAll('.loan-pick').forEach(function (b) { b.addEventListener('click', function () { loanIdx = +b.dataset.i; C.render(); }); });
      if (p.tab === 'password') initPassword(root, m);
    } };
  });

  // export สำหรับ admin/test
  C.member = { pbkdf2: pbkdf2, verifyPassword: verifyPassword, makeCred: makeCred, safeEqual: safeEqual, randHex: randHex, bahtText: bahtText, loanStatus: loanStatus };
})();
