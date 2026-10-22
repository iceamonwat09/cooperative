/* =========================================================
   admin.js — ระบบผู้ดูแล (Demo): CRUD เนื้อหา, นำเข้าสมาชิก, สิทธิ์, Audit log
   Demo เก็บการแก้ไขใน localStorage ของเบราว์เซอร์นี้เท่านั้น
   ========================================================= */
(function () {
  'use strict';
  var C = window.Coop;
  if (!C) return;
  var html = C.html, raw = C.raw, icon = C.icon, D = C.D, Store = C.Store;

  var SESSION_KEY = 'coop.asession', IDLE_MIN = 15, MAX_FAILS = 5, LOCK_MIN = 15;
  var ROLE_LABEL = { super: 'Super Admin', staff: 'เจ้าหน้าที่', viewer: 'ผู้ดูข้อมูล' };
  var PERMS = [
    ['content.view', 'ดูข้อมูลเนื้อหา', ['super', 'staff', 'viewer']],
    ['content.edit', 'เพิ่ม/แก้ไข/ลบ ข่าว แบนเนอร์ อัตราดอกเบี้ย ไฟล์ กรรมการ FAQ', ['super', 'staff']],
    ['complaints.edit', 'จัดการเรื่องร้องเรียน', ['super', 'staff']],
    ['members.import', 'นำเข้าข้อมูลสมาชิก / เชื่อมต่อระบบหลัก', ['super']],
    ['users.manage', 'จัดการผู้ใช้และสิทธิ์', ['super']],
    ['audit.view', 'ดู Audit log', ['super', 'viewer']],
    ['system.reset', 'รีเซ็ตข้อมูล Demo', ['super']]
  ];
  function roleOf(u) { var o = Store.get('ADMIN_ROLES'); return o[u.username] || u.role; }
  function can(admin, perm) { var p = PERMS.filter(function (x) { return x[0] === perm; })[0]; return !!p && p[2].indexOf(roleOf(admin)) !== -1; }
  function findAdmin(u) { return D.ADMINS.filter(function (a) { return a.username === u; })[0]; }

  function getSession() {
    var s = C.SS.get(SESSION_KEY, null);
    if (!s) return null;
    if (Date.now() - s.lastActive > IDLE_MIN * 60000) { C.SS.del(SESSION_KEY); C.SS.set('coop.a.expired', 1); return null; }
    s.lastActive = Date.now(); C.SS.set(SESSION_KEY, s);
    return s;
  }
  function guard() { var s = getSession(); if (!s) return null; var a = findAdmin(s.username); if (!a) { C.SS.del(SESSION_KEY); return null; } return a; }
  var lastTouch = 0;
  ['click', 'keydown'].forEach(function (ev) {
    document.addEventListener(ev, function () {
      if (Date.now() - lastTouch < 5000 || location.hash.indexOf('#/admin') !== 0) return;
      lastTouch = Date.now(); var s = C.SS.get(SESSION_KEY, null); if (s) { s.lastActive = Date.now(); C.SS.set(SESSION_KEY, s); }
    }, { capture: true, passive: true });
  });

  /* ---------------- Login ---------------- */
  function loginPage() {
    var expired = C.SS.get('coop.a.expired', 0); C.SS.del('coop.a.expired');
    return { title: 'เข้าสู่ระบบผู้ดูแล', html: html`<div class="auth-wrap"><div class="card auth-card"><div class="card__body">
      <div class="auth-card__icon">${icon('i-shield')}</div>
      <h1 style="font-size:1.5rem;margin-bottom:4px">ระบบผู้ดูแลเว็บไซต์</h1><p class="muted">สำหรับเจ้าหน้าที่สหกรณ์ฯ เท่านั้น</p>
      ${expired ? html`<div class="alert alert--warn" role="alert" style="margin-bottom:12px">หมดเวลาการใช้งาน กรุณาเข้าสู่ระบบอีกครั้ง</div>` : ''}
      <form id="aLogin" class="form-grid" novalidate>
        <div class="field"><label for="aUser">ชื่อผู้ใช้</label><input id="aUser" class="input" autocomplete="username" required maxlength="40" pattern="[a-zA-Z0-9._-]{3,40}"><span class="error-msg">กรุณากรอกชื่อผู้ใช้</span></div>
        <div class="field"><label for="aPw">รหัสผ่าน</label><input id="aPw" class="input" type="password" autocomplete="current-password" required maxlength="64"><span class="error-msg">กรุณากรอกรหัสผ่าน</span></div>
        <div id="aMsg" aria-live="assertive"></div>
        <button class="btn btn--primary btn--lg btn--block" type="submit" id="aBtn">เข้าสู่ระบบ</button>
        <div class="demo-creds"><strong>บัญชีทดลอง:</strong><br><code>admin</code> / <code>Admin@1234</code> (Super Admin)<br><code>staff</code> / <code>Staff@1234</code> (เจ้าหน้าที่)<br><code>viewer</code> / <code>View@1234</code> (ผู้ดูข้อมูล)</div>
      </form></div></div></div>`, after: function (root) {
      var f = root.querySelector('#aLogin'), msg = root.querySelector('#aMsg'), btn = root.querySelector('#aBtn');
      f.addEventListener('submit', function (e) {
        e.preventDefault(); msg.innerHTML = '';
        if (!f.checkValidity()) { f.reportValidity(); return; }
        var u = root.querySelector('#aUser').value.trim().toLowerCase(), pw = root.querySelector('#aPw');
        var lk = C.LS.get('coop.lock.a.' + u, { fails: 0, until: 0 });
        if (lk.until > Date.now()) { msg.innerHTML = html`<div class="alert alert--danger" role="alert">บัญชีถูกระงับชั่วคราว ลองใหม่ในอีก ${Math.ceil((lk.until - Date.now()) / 60000)} นาที</div>`.__raw; return; }
        var a = findAdmin(u);
        btn.disabled = true;
        C.member.verifyPassword(a ? a.cred : { salt: '00'.repeat(16), hash: 'x', iter: 150000 }, pw.value).then(function (ok) {
          if (!a || !ok) {
            lk.fails = (lk.until && lk.until <= Date.now()) ? 1 : lk.fails + 1; lk.until = 0;
            if (lk.fails >= MAX_FAILS) { lk.until = Date.now() + LOCK_MIN * 60000; lk.fails = 0; }
            C.LS.set('coop.lock.a.' + u, lk);
            C.audit('admin:' + u, 'login', 'รหัสผ่านไม่ถูกต้อง', false);
            msg.innerHTML = html`<div class="alert alert--danger" role="alert">${lk.until ? 'ใส่รหัสผ่านผิดเกินกำหนด บัญชีถูกระงับ ' + LOCK_MIN + ' นาที' : 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'}</div>`.__raw;
            pw.value = ''; pw.focus(); return;
          }
          C.LS.set('coop.lock.a.' + u, { fails: 0, until: 0 });
          C.SS.set(SESSION_KEY, { username: u, lastActive: Date.now(), loginAt: Date.now() });
          C.audit('admin:' + u, 'login', 'เข้าสู่ระบบสำเร็จ (' + ROLE_LABEL[roleOf(a)] + ')');
          C.go('/admin/dashboard');
        }).catch(function (err) { msg.innerHTML = html`<div class="alert alert--danger" role="alert">${err.message}</div>`.__raw; })
          .finally(function () { btn.disabled = false; });
      });
    } };
  }

  /* ---------------- Shell ---------------- */
  var TABS = [
    ['dashboard', 'แดชบอร์ด', 'i-chart', 'content.view'], ['news', 'ข่าว/ประกาศ', 'i-chat', 'content.view'], ['banners', 'แบนเนอร์', 'i-eye', 'content.view'],
    ['rates', 'อัตราดอกเบี้ย', 'i-coins', 'content.view'], ['downloads', 'ไฟล์ดาวน์โหลด', 'i-download', 'content.view'], ['board', 'คณะกรรมการ', 'i-users', 'content.view'],
    ['faq', 'FAQ', 'i-chat', 'content.view'], ['complaints', 'เรื่องร้องเรียน', 'i-file', 'content.view'], ['import', 'นำเข้าสมาชิก', 'i-download', 'members.import'],
    ['users', 'ผู้ใช้และสิทธิ์', 'i-shield', 'content.view'], ['audit', 'Audit log', 'i-lock', 'audit.view']
  ];
  function shell(a, tab, content) {
    return html`<div class="container app">
      <aside class="app__side"><nav class="card" aria-label="เมนูผู้ดูแล"><ul class="sidenav">${TABS.filter(function (t) { return can(a, t[3]); }).map(function (t) { return html`<li><a href="#/admin/${t[0]}" ${t[0] === tab ? raw('aria-current="page"') : ''}>${icon(t[2])}${t[1]}</a></li>`; })}
        <li><a href="#/admin/logout">${icon('i-logout')}ออกจากระบบ</a></li></ul></nav></aside>
      <div class="stack" style="min-width:0">
        <div class="card app__userbar"><div class="userchip"><div class="userchip__avatar" aria-hidden="true">${a.name.charAt(0)}</div><div><strong>${a.name}</strong><div class="small muted">${a.username} · <span class="badge role-badge">${ROLE_LABEL[roleOf(a)]}</span></div></div></div>
          <span class="small muted">โหมด Demo: การแก้ไขบันทึกในเบราว์เซอร์นี้เท่านั้น</span></div>
        ${content}
      </div></div>`;
  }
  function denied() { return html`<div class="alert alert--danger" role="alert">${icon('i-lock')} ท่านไม่มีสิทธิ์เข้าถึงส่วนนี้ (ตามบทบาทของท่าน)</div>`; }

  /* ---------------- Generic CRUD ---------------- */
  function uid(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  var SCHEMAS = {
    news: { key: 'NEWS', idPrefix: 'n', title: 'ข่าว/ประกาศ', fields: [
      { k: 'title', label: 'หัวข้อข่าว', type: 'text', req: true, max: 200 },
      { k: 'cat', label: 'หมวดหมู่', type: 'select', req: true, options: D.CATEGORIES.map(function (c) { return [c.key, c.label]; }) },
      { k: 'date', label: 'วันที่ประกาศ', type: 'date', req: true },
      { k: 'pinned', label: 'ปักหมุดไว้ด้านบน', type: 'checkbox' },
      { k: 'excerpt', label: 'สรุปย่อ', type: 'textarea', req: true, max: 300 },
      { k: 'body', label: 'เนื้อหา (เว้นบรรทัดว่างเพื่อขึ้นย่อหน้าใหม่)', type: 'paragraphs', req: true, max: 10000 },
      { k: 'attach', label: 'ไฟล์แนบ PDF (ไม่เกิน 10 MB)', type: 'pdf' }
    ], cols: [['title', 'หัวข้อ'], ['cat', 'หมวด', function (v) { return (D.CATEGORIES.filter(function (c) { return c.key === v; })[0] || {}).label; }], ['date', 'วันที่', function (v) { return C.fmtDate(v); }], ['pinned', 'ปักหมุด', function (v) { return v ? '📌' : ''; }]] },
    banners: { key: 'BANNERS', idPrefix: 'b', title: 'แบนเนอร์หน้าแรก', fields: [
      { k: 'tag', label: 'ป้ายกำกับ', type: 'text', req: true, max: 40 },
      { k: 'title', label: 'หัวข้อ', type: 'text', req: true, max: 120 },
      { k: 'text', label: 'ข้อความ', type: 'textarea', req: true, max: 300 },
      { k: 'cta', label: 'ข้อความปุ่ม', type: 'text', req: true, max: 40 },
      { k: 'href', label: 'ลิงก์ปุ่ม (เช่น #/news หรือ https://…)', type: 'url', req: true, max: 300 },
      { k: 'stat', label: 'ตัวเลขเด่น (ถ้ามี)', type: 'text', max: 20 },
      { k: 'statLabel', label: 'คำอธิบายตัวเลข', type: 'text', max: 40 },
      { k: 'theme', label: 'ธีมสี', type: 'select', options: [['navy', 'น้ำเงิน'], ['teal', 'เขียวน้ำทะเล'], ['gold', 'ทอง']] }
    ], cols: [['title', 'หัวข้อ'], ['tag', 'ป้าย'], ['theme', 'ธีม']] },
    downloads: { key: 'DOWNLOADS', idPrefix: 'f', title: 'ไฟล์ดาวน์โหลด', fields: [
      { k: 'name', label: 'ชื่อเอกสาร', type: 'text', req: true, max: 200 },
      { k: 'cat', label: 'หมวด', type: 'select', req: true, options: D.DOWNLOAD_CATS.map(function (c) { return [c, c]; }) },
      { k: 'updated', label: 'วันที่ปรับปรุง', type: 'date', req: true },
      { k: 'pdf', label: 'ไฟล์ PDF (ไม่เกิน 10 MB)', type: 'pdf', req: true }
    ], cols: [['name', 'ชื่อเอกสาร'], ['cat', 'หมวด'], ['updated', 'ปรับปรุง', function (v) { return C.fmtDate(v); }], ['size', 'ขนาด']] },
    board: { key: 'BOARD', idPrefix: 'p', title: 'คณะกรรมการดำเนินการ', fields: [
      { k: 'name', label: 'ชื่อ – นามสกุล', type: 'text', req: true, max: 120 },
      { k: 'role', label: 'ตำแหน่ง', type: 'text', req: true, max: 120 },
      { k: 'lead', label: 'แสดงเป็นประธาน (ใหญ่ด้านบน)', type: 'checkbox' }
    ], cols: [['name', 'ชื่อ'], ['role', 'ตำแหน่ง']] },
    faq: { key: 'FAQ', idPrefix: 'q', title: 'คำถามที่พบบ่อย', fields: [
      { k: 'q', label: 'คำถาม', type: 'text', req: true, max: 300 },
      { k: 'a', label: 'คำตอบ', type: 'textarea', req: true, max: 3000 }
    ], cols: [['q', 'คำถาม']] }
  };
  function withIds(list, prefix) { var changed = false; list = list.map(function (x, i) { if (!x.id) { changed = true; return Object.assign({ id: prefix + 'x' + i }, x); } return x; }); return { list: list, changed: changed }; }
  function getList(sch) { var r = withIds(Store.get(sch.key).slice(), sch.idPrefix); return r.list; }

  function crudView(a, name) {
    var sch = SCHEMAS[name], list = getList(sch), editable = can(a, 'content.edit');
    return html`<div class="card"><div class="card__body">
      <div class="admin-head"><h1 style="font-size:1.3rem">${sch.title} <span class="badge badge--muted">${list.length}</span></h1>
        ${editable ? html`<button type="button" class="btn btn--primary btn--sm" data-act="add">${icon('i-plus')} เพิ่มรายการ</button>` : html`<span class="badge badge--muted">ดูอย่างเดียว</span>`}</div>
      ${name === 'news' || name === 'downloads' ? html`<div class="search" style="margin-bottom:12px"><label class="sr-only" for="crudQ">ค้นหา</label>${icon('i-search')}<input id="crudQ" class="input" type="search" placeholder="ค้นหา…"></div>` : ''}
      <div class="table-wrap"><table class="table table--stack" id="crudTable"><thead><tr>${sch.cols.map(function (c) { return html`<th scope="col">${c[1]}</th>`; })}<th scope="col" class="r">จัดการ</th></tr></thead>
      <tbody>${list.map(function (row) { return html`<tr data-id="${row.id}" data-text="${(row.title || row.name || row.q || '').toLowerCase()}">${sch.cols.map(function (c) { return html`<td data-label="${c[1]}">${c[2] ? c[2](row[c[0]]) : row[c[0]]}</td>`; })}
        <td class="r" data-label="จัดการ"><div class="row-actions">${editable ? html`<button type="button" class="icon-btn" data-act="edit" aria-label="แก้ไข ${row.title || row.name || row.q}">${icon('i-edit')}</button><button type="button" class="icon-btn" data-act="del" aria-label="ลบ ${row.title || row.name || row.q}">${icon('i-trash')}</button>` : html`<button type="button" class="icon-btn" data-act="view" aria-label="ดู">${icon('i-eye')}</button>`}</div></td></tr>`; })}</tbody></table></div>
    </div></div>`;
  }

  function fieldInput(f, v, ro) {
    var id = 'f_' + f.k, dis = ro ? raw('disabled') : '';
    var req = f.req ? raw('required') : '';
    var max = f.max ? raw('maxlength="' + f.max + '"') : '';
    if (f.type === 'checkbox') return html`<label class="check"><input type="checkbox" id="${id}" name="${f.k}" ${v ? raw('checked') : ''} ${dis}><span>${f.label}</span></label>`;
    var label = html`<label for="${id}">${f.label}${f.req ? html` <span class="req">*</span>` : ''}</label>`;
    if (f.type === 'select') return html`<div class="field">${label}<select id="${id}" name="${f.k}" class="select" ${req} ${dis}>${f.options.map(function (o) { return html`<option value="${o[0]}" ${o[0] === v ? raw('selected') : ''}>${o[1]}</option>`; })}</select></div>`;
    if (f.type === 'textarea' || f.type === 'paragraphs') return html`<div class="field">${label}<textarea id="${id}" name="${f.k}" class="textarea" ${req} ${max} ${dis}>${f.type === 'paragraphs' && Array.isArray(v) ? v.join('\n\n') : (v || '')}</textarea><span class="error-msg">กรุณากรอก${f.label}</span></div>`;
    if (f.type === 'date') return html`<div class="field">${label}<input id="${id}" name="${f.k}" type="date" class="input" value="${v || C.toISO(new Date())}" ${req} ${dis}><span class="error-msg">กรุณาเลือกวันที่</span></div>`;
    if (f.type === 'pdf') {
      var cur = v && (v.name || v.file) ? (v.name || v.file) : '';
      return html`<div class="field">${label}${cur ? html`<span class="hint">ไฟล์ปัจจุบัน: ${cur}</span>` : ''}<input id="${id}" name="${f.k}" type="file" accept="application/pdf,.pdf" class="input" ${f.req && !cur ? req : ''} ${dis}><span class="hint">Demo: ระบบจะตรวจชนิดและขนาดไฟล์ แต่ไม่อัปโหลดจริง (ใช้ไฟล์ตัวอย่างแทน)</span><span class="error-msg">กรุณาเลือกไฟล์ PDF</span></div>`;
    }
    var pattern = f.type === 'url' ? raw('pattern="(#/.*|https://.+|assets/.+)"') : '';
    return html`<div class="field">${label}<input id="${id}" name="${f.k}" class="input" ${req} ${max} ${pattern} value="${v || ''}" ${dis}><span class="error-msg">${f.type === 'url' ? 'ลิงก์ต้องขึ้นต้นด้วย #/ หรือ https://' : 'กรุณากรอก' + f.label}</span></div>`;
  }
  function readPdf(input) {
    var file = input.files && input.files[0];
    if (!file) return Promise.resolve(null);
    if (file.size > 10 * 1024 * 1024) return Promise.reject(new Error('ไฟล์ใหญ่เกิน 10 MB'));
    if (!/\.pdf$/i.test(file.name)) return Promise.reject(new Error('อนุญาตเฉพาะไฟล์ .pdf'));
    // ตรวจ magic bytes "%PDF" ไม่เชื่อแค่นามสกุลไฟล์
    return file.slice(0, 5).arrayBuffer().then(function (buf) {
      var sig = String.fromCharCode.apply(null, new Uint8Array(buf));
      if (sig.indexOf('%PDF') !== 0) throw new Error('ไฟล์นี้ไม่ใช่ PDF ที่ถูกต้อง');
      var kb = file.size / 1024;
      return { name: file.name.replace(/[^\p{L}\p{N}\s._()-]/gu, '_').slice(0, 120), file: 'assets/files/sample.pdf', size: kb > 1024 ? (kb / 1024).toFixed(1) + ' MB' : Math.ceil(kb) + ' KB' };
    });
  }

  function openEditor(a, name, row, ro) {
    var sch = SCHEMAS[name], isNew = !row;
    row = row || {};
    return C.openModal(html`<form method="dialog" class="modal__body" id="crudForm" novalidate>
      <h2>${ro ? 'รายละเอียด' : isNew ? 'เพิ่ม' : 'แก้ไข'}${sch.title}</h2>
      ${sch.fields.map(function (f) { return fieldInput(f, f.type === 'pdf' && name === 'downloads' ? (row.file ? { name: row.file } : null) : row[f.k], ro); })}
      <div id="crudErr" aria-live="assertive"></div>
      <div class="modal__actions"><button class="btn btn--ghost" value="cancel" formnovalidate>${ro ? 'ปิด' : 'ยกเลิก'}</button>${ro ? '' : html`<button class="btn btn--primary" value="save" id="crudSave">บันทึก</button>`}</div>
    </form>`, { wide: true, label: sch.title, onOpen: function (dlg) {
      var form = dlg.querySelector('#crudForm');
      form.addEventListener('submit', function (e) {
        if (e.submitter && e.submitter.value === 'cancel') return;
        e.preventDefault();
        if (!form.checkValidity()) { form.reportValidity(); return; }
        var data = Object.assign({}, row), pdfInput = null;
        sch.fields.forEach(function (f) {
          var el = form.elements[f.k];
          if (f.type === 'checkbox') data[f.k] = el.checked;
          else if (f.type === 'pdf') pdfInput = el;
          else if (f.type === 'paragraphs') data[f.k] = el.value.split(/\n\s*\n/).map(function (s) { return s.trim(); }).filter(Boolean);
          else data[f.k] = el.value.trim();
        });
        if (data.href && C.safeUrl(data.href) !== data.href) { dlg.querySelector('#crudErr').innerHTML = html`<div class="alert alert--danger">ลิงก์ไม่ปลอดภัย</div>`.__raw; return; }
        readPdf(pdfInput || { files: [] }).then(function (pdf) {
          if (pdf) {
            if (name === 'downloads') { data.file = pdf.file; data.size = pdf.size; } else data.attach = pdf;
          }
          var list = getList(sch);
          if (isNew) { data.id = uid(sch.idPrefix); list.unshift(data); } else list = list.map(function (x) { return x.id === data.id ? data : x; });
          Store.set(sch.key, list);
          C.audit('admin:' + a.username, (isNew ? 'create:' : 'update:') + name, data.title || data.name || data.q || data.id);
          C.toast('บันทึกเรียบร้อย', 'success');
          dlg.close('save');
          C.render();
        }).catch(function (err) { dlg.querySelector('#crudErr').innerHTML = html`<div class="alert alert--danger" role="alert">${err.message}</div>`.__raw; });
      });
    } });
  }
  function bindCrud(root, a, name) {
    var sch = SCHEMAS[name];
    var q = root.querySelector('#crudQ');
    if (q) q.addEventListener('input', function () { var v = q.value.trim().toLowerCase(); root.querySelectorAll('#crudTable tbody tr').forEach(function (tr) { tr.hidden = v && tr.dataset.text.indexOf(v) === -1; }); });
    root.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      var act = b.dataset.act, tr = b.closest('tr'), id = tr && tr.dataset.id;
      var row = id && getList(sch).filter(function (x) { return x.id === id; })[0];
      if (act === 'add') { if (can(a, 'content.edit')) openEditor(a, name, null); }
      else if (act === 'edit') { if (can(a, 'content.edit')) openEditor(a, name, row); }
      else if (act === 'view') openEditor(a, name, row, true);
      else if (act === 'del' && can(a, 'content.edit')) {
        C.confirmBox('ต้องการลบ “' + (row.title || row.name || row.q) + '” ใช่หรือไม่? การลบไม่สามารถย้อนกลับได้', 'ลบ').then(function (ok) {
          if (!ok) return;
          Store.set(sch.key, getList(sch).filter(function (x) { return x.id !== id; }));
          C.audit('admin:' + a.username, 'delete:' + name, row.title || row.name || row.q || id);
          C.toast('ลบเรียบร้อย', 'success'); C.render();
        });
      }
    });
  }

  /* ---------------- Rates editor ---------------- */
  function ratesView(a) {
    var R = Store.get('RATES'), ed = can(a, 'content.edit');
    function rows(list, kind) {
      return list.map(function (r, i) { return html`<tr><td data-label="ประเภท"><input class="input" name="${kind}-name-${i}" value="${r.name}" required maxlength="100" ${ed ? '' : raw('disabled')} aria-label="ชื่อ"></td>
        <td data-label="เงื่อนไข"><input class="input" name="${kind}-note-${i}" value="${r.note}" maxlength="100" ${ed ? '' : raw('disabled')} aria-label="เงื่อนไข"></td>
        <td data-label="% ต่อปี" style="width:140px"><input class="input num" type="number" step="0.01" min="0" max="30" name="${kind}-rate-${i}" value="${r.rate}" required ${ed ? '' : raw('disabled')} aria-label="อัตรา ${r.name}"></td></tr>`; });
    }
    return html`<form class="card" id="rateForm" novalidate><div class="card__body">
      <div class="admin-head"><h1 style="font-size:1.3rem">อัตราดอกเบี้ย</h1>
        <div class="field" style="grid-auto-flow:column;align-items:center;gap:8px"><label for="rEff">มีผลตั้งแต่</label><input id="rEff" class="input" type="date" value="${R.effective}" required ${ed ? '' : raw('disabled')}></div></div>
      <h2 style="font-size:1.05rem">เงินฝาก</h2><div class="table-wrap"><table class="table table--stack"><thead><tr><th>ประเภท</th><th>เงื่อนไข</th><th>% ต่อปี</th></tr></thead><tbody>${rows(R.deposit, 'd')}</tbody></table></div>
      <h2 style="font-size:1.05rem;margin-top:18px">เงินกู้</h2><div class="table-wrap"><table class="table table--stack"><thead><tr><th>ประเภท</th><th>เงื่อนไข</th><th>% ต่อปี</th></tr></thead><tbody>${rows(R.loan, 'l')}</tbody></table></div>
      ${ed ? html`<p style="margin:16px 0 0"><button class="btn btn--primary" type="submit">บันทึกอัตราดอกเบี้ย</button></p>` : ''}
    </div></form>`;
  }
  function bindRates(root, a) {
    var f = root.querySelector('#rateForm'); if (!f) return;
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!can(a, 'content.edit')) return;
      if (!f.checkValidity()) { f.reportValidity(); return; }
      var R = JSON.parse(JSON.stringify(Store.get('RATES'))), changes = [];
      R.effective = f.querySelector('#rEff').value;
      [['deposit', 'd'], ['loan', 'l']].forEach(function (k) {
        R[k[0]].forEach(function (r, i) {
          var nr = parseFloat(f.elements[k[1] + '-rate-' + i].value);
          if (nr !== r.rate) changes.push(r.name + ' ' + r.rate + '→' + nr);
          r.rate = nr; r.name = f.elements[k[1] + '-name-' + i].value.trim(); r.note = f.elements[k[1] + '-note-' + i].value.trim();
        });
      });
      Store.set('RATES', R);
      C.audit('admin:' + a.username, 'update:rates', changes.join(', ') || 'แก้ไขข้อความ/วันที่มีผล');
      C.toast('บันทึกอัตราดอกเบี้ยแล้ว — หน้าแรกและเครื่องคำนวณใช้ค่าใหม่ทันที', 'success');
    });
  }

  /* ---------------- Complaints ---------------- */
  function complaintsView(a) {
    var list = Store.get('COMPLAINTS'), ed = can(a, 'complaints.edit');
    return html`<div class="card"><div class="card__body"><h1 style="font-size:1.3rem">เรื่องร้องเรียน / เสนอแนะ <span class="badge badge--muted">${list.length}</span></h1>
      ${list.length ? html`<div class="table-wrap"><table class="table table--stack"><thead><tr><th>เลขที่</th><th>วันที่</th><th>ประเภท</th><th>ผู้ส่ง</th><th>รายละเอียด</th><th>สถานะ</th></tr></thead>
      <tbody>${list.map(function (c, i) { return html`<tr><td data-label="เลขที่" class="num">${c.ref}</td><td data-label="วันที่">${new Date(c.at).toLocaleString('th-TH')}</td><td data-label="ประเภท">${c.type}</td><td data-label="ผู้ส่ง">${c.name}<br><span class="small muted">${C.maskPhone(c.phone)}</span></td><td data-label="รายละเอียด" style="max-width:320px;white-space:pre-wrap">${c.msg}</td>
        <td data-label="สถานะ">${ed ? html`<select class="select" data-ci="${i}" aria-label="สถานะ ${c.ref}">${['ใหม่', 'กำลังดำเนินการ', 'ปิดเรื่อง'].map(function (s) { return html`<option ${s === c.status ? raw('selected') : ''}>${s}</option>`; })}</select>` : c.status}</td></tr>`; })}</tbody></table></div>`
      : html`<p class="empty">ยังไม่มีเรื่องร้องเรียน — ลองส่งจากหน้า <a href="#/contact">ติดต่อเรา</a></p>`}</div></div>`;
  }
  function bindComplaints(root, a) {
    root.querySelectorAll('select[data-ci]').forEach(function (s) {
      s.addEventListener('change', function () {
        var list = Store.get('COMPLAINTS').slice(); var c = list[+s.dataset.ci]; c.status = s.value; Store.set('COMPLAINTS', list);
        C.audit('admin:' + a.username, 'update:complaint', c.ref + ' → ' + s.value); C.toast('อัปเดตสถานะแล้ว', 'success');
      });
    });
  }

  /* ---------------- Import members (CSV) ---------------- */
  var CSV_HEAD = ['member_no', 'title', 'first_name', 'last_name', 'id_card', 'phone', 'email', 'dept', 'join_date', 'share_total', 'share_monthly'];
  function parseCSV(text) {
    var rows = [], row = [], cur = '', q = false;
    text = text.replace(/^﻿/, '');
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += ch;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (c) { return c.trim(); }); });
  }
  function validThaiId(id) {
    if (!/^\d{13}$/.test(id)) return false;
    var sum = 0; for (var i = 0; i < 12; i++) sum += +id[i] * (13 - i);
    return (11 - sum % 11) % 10 === +id[12];
  }
  function validateRow(r) {
    var e = [];
    if (!/^\d{6}$/.test(r.member_no)) e.push('เลขทะเบียนต้องเป็นตัวเลข 6 หลัก');
    if (!r.first_name || !r.last_name) e.push('ต้องมีชื่อและนามสกุล');
    if (!validThaiId(r.id_card)) e.push('เลขบัตรประชาชนไม่ถูกต้อง');
    if (r.phone && !/^0\d{8,9}$/.test(r.phone)) e.push('เบอร์โทรไม่ถูกต้อง');
    if (r.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email)) e.push('อีเมลไม่ถูกต้อง');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.join_date) || isNaN(C.parseISO(r.join_date))) e.push('วันที่เป็นสมาชิกต้องเป็น YYYY-MM-DD');
    if (!(+r.share_total >= 0)) e.push('ทุนเรือนหุ้นต้องเป็นตัวเลข');
    if (!(+r.share_monthly >= 0)) e.push('ค่าหุ้นรายเดือนต้องเป็นตัวเลข');
    return e;
  }
  function importView(a) {
    if (!can(a, 'members.import')) return denied();
    var imported = Store.get('MEMBERS_IMPORTED');
    return html`<div class="card"><div class="card__body">
      <h1 style="font-size:1.3rem">นำเข้าข้อมูลสมาชิก</h1>
      <p class="muted">รองรับไฟล์ CSV (UTF-8) — จาก Excel เลือก “บันทึกเป็น → CSV UTF-8 (คั่นด้วยจุลภาค)” ระบบจริงรองรับ .xlsx ที่ฝั่งเซิร์ฟเวอร์</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px"><button type="button" class="btn btn--outline btn--sm" id="tplBtn">${icon('i-download')} ดาวน์โหลดไฟล์ตัวอย่าง (CSV)</button></div>
      <div class="field"><label for="csvFile">เลือกไฟล์ CSV (ไม่เกิน 5 MB)</label><input id="csvFile" type="file" accept=".csv,text/csv" class="input"></div>
      <div id="csvOut" style="margin-top:14px" aria-live="polite"></div>
    </div></div>
    <div class="card"><div class="card__body"><h2 style="font-size:1.1rem">เชื่อมต่อฐานข้อมูลระบบหลัก</h2>
      <p class="muted small">ระบบจริง: เซิร์ฟเวอร์ดึงข้อมูลจากระบบสหกรณ์หลัก (เช่น ผ่าน REST API / Database view แบบอ่านอย่างเดียว) ทุกสิ้นวันทำการ แล้วอัปเดต “ข้อมูล ณ วันที่” อัตโนมัติ</p>
      <dl class="dl"><dt>สถานะ</dt><dd><span class="badge badge--muted">ไม่ได้เชื่อมต่อ (Demo)</span></dd><dt>รอบการซิงก์</dt><dd>ทุกวัน 23:30 น.</dd><dt>ข้อมูลล่าสุด</dt><dd>${C.fmtDate(D.SITE.dataAsOf, 'long')}</dd></dl></div></div>
    <div class="card"><div class="card__body"><h2 style="font-size:1.1rem">สมาชิกที่นำเข้าแล้ว <span class="badge badge--muted">${imported.length}</span></h2>
      ${imported.length ? html`<div class="table-wrap"><table class="table table--stack"><thead><tr><th>เลขทะเบียน</th><th>ชื่อ</th><th>เลขบัตร</th><th>หน่วยงาน</th><th class="r">ทุนเรือนหุ้น</th></tr></thead><tbody>${imported.map(function (m) { return html`<tr><td data-label="เลขทะเบียน" class="num">${m.member_no}</td><td data-label="ชื่อ">${m.title}${m.first_name} ${m.last_name}</td><td data-label="เลขบัตร" class="num">${C.maskId(m.id_card)}</td><td data-label="หน่วยงาน">${m.dept}</td><td data-label="หุ้น" class="r">${C.money(m.share_total)}</td></tr>`; })}</tbody></table></div>` : html`<p class="muted small">ยังไม่มี</p>`}</div></div>`;
  }
  function bindImport(root, a) {
    var tpl = root.querySelector('#tplBtn'); if (!tpl) return;
    tpl.addEventListener('click', function () {
      var sample = [CSV_HEAD.join(','), '000777,นาย,ทดสอบ,นำเข้า,1101700230705,0899999999,test@example.com,ฝ่ายบัญชี,2020-01-15,52000,1000', '000778,นางสาว,ตัวอย่าง,ข้อมูล,1234567890121,0811111111,,ฝ่ายผลิต,2021-07-01,24000,500'].join('\r\n');
      var blob = new Blob(['﻿' + sample], { type: 'text/csv;charset=utf-8' });
      var link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'member-import-template.csv'; link.click();
      setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
    });
    root.querySelector('#csvFile').addEventListener('change', function (e) {
      var file = e.target.files[0], out = root.querySelector('#csvOut');
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) { out.innerHTML = html`<div class="alert alert--danger" role="alert">ไฟล์ใหญ่เกิน 5 MB</div>`.__raw; return; }
      if (!/\.csv$/i.test(file.name)) { out.innerHTML = html`<div class="alert alert--danger" role="alert">กรุณาเลือกไฟล์ .csv (หากเป็น .xlsx ให้บันทึกเป็น CSV UTF-8 ก่อน)</div>`.__raw; return; }
      file.text().then(function (text) {
        var rows = parseCSV(text);
        if (rows.length < 2) throw new Error('ไม่พบข้อมูลในไฟล์');
        var head = rows[0].map(function (h) { return h.trim().toLowerCase(); });
        var missing = CSV_HEAD.filter(function (h) { return head.indexOf(h) === -1; });
        if (missing.length) throw new Error('ไม่พบคอลัมน์: ' + missing.join(', '));
        if (rows.length > 5001) throw new Error('นำเข้าได้ครั้งละไม่เกิน 5,000 แถว');
        var seen = {};
        var parsed = rows.slice(1).map(function (r, i) {
          var o = {}; head.forEach(function (h, j) { o[h] = (r[j] || '').trim(); });
          var errs = validateRow(o);
          if (seen[o.member_no]) errs.push('เลขทะเบียนซ้ำในไฟล์ (แถว ' + seen[o.member_no] + ')'); else seen[o.member_no] = i + 2;
          return { line: i + 2, data: o, errs: errs };
        });
        var good = parsed.filter(function (p) { return !p.errs.length; });
        out.innerHTML = html`<div class="alert ${good.length === parsed.length ? 'alert--success' : 'alert--warn'}" role="status">ตรวจสอบ ${parsed.length} แถว: ถูกต้อง ${good.length} แถว · ผิดพลาด ${parsed.length - good.length} แถว</div>
          <div class="table-wrap" style="margin-top:10px;max-height:360px"><table class="table"><thead><tr><th>แถว</th><th>เลขทะเบียน</th><th>ชื่อ</th><th>เลขบัตร</th><th>ผลตรวจ</th></tr></thead><tbody>${parsed.slice(0, 200).map(function (p) {
            return html`<tr><td class="num">${p.line}</td><td class="num">${p.data.member_no}</td><td>${p.data.first_name} ${p.data.last_name}</td><td class="num">${C.maskId(p.data.id_card)}</td><td>${p.errs.length ? html`<span class="badge badge--danger">${p.errs.join(' / ')}</span>` : html`<span class="badge badge--success">ผ่าน</span>`}</td></tr>`; })}</tbody></table></div>
          ${good.length ? html`<p style="margin:12px 0 0"><button type="button" class="btn btn--primary" id="doImport">นำเข้า ${good.length} รายการที่ถูกต้อง</button></p>` : ''}`.__raw;
        var btn = out.querySelector('#doImport');
        if (btn) btn.addEventListener('click', function () {
          var cur = Store.get('MEMBERS_IMPORTED').slice(), map = {};
          cur.forEach(function (m, i) { map[m.member_no] = i; });
          var added = 0, updated = 0;
          good.forEach(function (p) {
            var d = p.data; d.share_total = +d.share_total; d.share_monthly = +d.share_monthly;
            if (d.member_no in map) { cur[map[d.member_no]] = d; updated++; } else { cur.push(d); added++; }
          });
          Store.set('MEMBERS_IMPORTED', cur);
          C.audit('admin:' + a.username, 'import:members', file.name + ' เพิ่ม ' + added + ' แก้ไข ' + updated + ' ผิดพลาด ' + (parsed.length - good.length));
          C.toast('นำเข้าสำเร็จ: เพิ่ม ' + added + ' ราย แก้ไข ' + updated + ' ราย', 'success');
          C.render();
        });
      }).catch(function (err) { out.innerHTML = html`<div class="alert alert--danger" role="alert">${err.message}</div>`.__raw; });
    });
  }

  /* ---------------- Users & roles ---------------- */
  function usersView(a) {
    var manage = can(a, 'users.manage');
    return html`<div class="card"><div class="card__body"><h1 style="font-size:1.3rem">ผู้ใช้ระบบผู้ดูแล</h1>
      <div class="table-wrap"><table class="table table--stack"><thead><tr><th>ชื่อผู้ใช้</th><th>ชื่อ</th><th>บทบาท</th></tr></thead><tbody>${D.ADMINS.map(function (u) {
        var r = roleOf(u);
        return html`<tr><td data-label="ชื่อผู้ใช้" class="num">${u.username}</td><td data-label="ชื่อ">${u.name}</td><td data-label="บทบาท">${manage && u.username !== a.username
          ? html`<select class="select" data-user="${u.username}" aria-label="บทบาทของ ${u.username}" style="max-width:200px">${Object.keys(ROLE_LABEL).map(function (k) { return html`<option value="${k}" ${k === r ? raw('selected') : ''}>${ROLE_LABEL[k]}</option>`; })}</select>`
          : html`<span class="badge">${ROLE_LABEL[r]}</span>${u.username === a.username ? html` <span class="small muted">(ตัวท่านเอง)</span>` : ''}`}</td></tr>`;
      })}</tbody></table></div>
      ${manage ? '' : html`<p class="small muted" style="margin:10px 0 0">เฉพาะ Super Admin เท่านั้นที่เปลี่ยนบทบาทได้</p>`}</div></div>
      <div class="card"><div class="card__body"><h2 style="font-size:1.1rem">ตารางสิทธิ์ตามบทบาท</h2>
      <div class="table-wrap"><table class="table"><thead><tr><th>สิทธิ์</th>${Object.keys(ROLE_LABEL).map(function (k) { return html`<th class="r">${ROLE_LABEL[k]}</th>`; })}</tr></thead>
      <tbody>${PERMS.map(function (p) { return html`<tr><td>${p[1]}</td>${Object.keys(ROLE_LABEL).map(function (k) { return p[2].indexOf(k) !== -1 ? html`<td class="r perm-yes" aria-label="อนุญาต">✓</td>` : html`<td class="r perm-no" aria-label="ไม่อนุญาต">—</td>`; })}</tr>`; })}</tbody></table></div></div></div>`;
  }
  function bindUsers(root, a) {
    root.querySelectorAll('select[data-user]').forEach(function (s) {
      s.addEventListener('change', function () {
        if (!can(a, 'users.manage')) return;
        var roles = Object.assign({}, Store.get('ADMIN_ROLES'));
        var u = s.dataset.user, before = roleOf(findAdmin(u));
        roles[u] = s.value; Store.set('ADMIN_ROLES', roles);
        C.audit('admin:' + a.username, 'update:role', u + ' ' + ROLE_LABEL[before] + ' → ' + ROLE_LABEL[s.value]);
        C.toast('เปลี่ยนบทบาทของ ' + u + ' แล้ว', 'success');
      });
    });
  }

  /* ---------------- Audit ---------------- */
  function auditView(a) {
    if (!can(a, 'audit.view')) return denied();
    var log = Store.get('AUDIT');
    return html`<div class="card"><div class="card__body">
      <div class="admin-head"><h1 style="font-size:1.3rem">Audit log <span class="badge badge--muted">${log.length}</span></h1><button type="button" class="btn btn--outline btn--sm" id="auditCsv">${icon('i-download')} ส่งออก CSV</button></div>
      <div class="toolbar" style="grid-template-columns:1fr auto"><div class="search"><label class="sr-only" for="auditQ">ค้นหา</label>${icon('i-search')}<input id="auditQ" class="input" type="search" placeholder="ค้นหาผู้ใช้ / การกระทำ"></div>
        <select class="select" id="auditOk" aria-label="กรองผลลัพธ์" style="width:auto"><option value="">ทั้งหมด</option><option value="1">สำเร็จ</option><option value="0">ล้มเหลว</option></select></div>
      ${log.length ? html`<div class="table-wrap" style="max-height:560px"><table class="table table--stack log-list" id="auditTable"><thead><tr><th>เวลา</th><th>ผู้ใช้</th><th>การกระทำ</th><th>รายละเอียด</th><th>ผล</th></tr></thead>
      <tbody>${log.map(function (l) { return html`<tr data-ok="${l.ok ? 1 : 0}"><td data-label="เวลา">${new Date(l.at).toLocaleString('th-TH')}</td><td data-label="ผู้ใช้">${l.actor}</td><td data-label="การกระทำ">${l.action}</td><td data-label="รายละเอียด">${l.detail}</td><td data-label="ผล">${l.ok ? html`<span class="badge badge--success">สำเร็จ</span>` : html`<span class="badge badge--danger">ล้มเหลว</span>`}</td></tr>`; })}</tbody></table></div>`
        : html`<p class="empty">ยังไม่มีบันทึก</p>`}
      <p class="small muted" style="margin:10px 0 0">ระบบจริงเก็บ log ที่เซิร์ฟเวอร์ (append-only) พร้อม IP address ไม่น้อยกว่า 90 วัน ตาม พ.ร.บ.คอมพิวเตอร์</p></div></div>`;
  }
  function csvCell(v) { v = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; }
  function bindAudit(root, a) {
    var q = root.querySelector('#auditQ'), ok = root.querySelector('#auditOk');
    function filter() { var v = q.value.trim().toLowerCase(), o = ok.value; root.querySelectorAll('#auditTable tbody tr').forEach(function (tr) { tr.hidden = (v && tr.textContent.toLowerCase().indexOf(v) === -1) || (o && tr.dataset.ok !== o); }); }
    if (q) { q.addEventListener('input', filter); ok.addEventListener('change', filter); }
    var b = root.querySelector('#auditCsv');
    if (b) b.addEventListener('click', function () {
      var rows = [['time', 'actor', 'action', 'detail', 'ok']].concat(Store.get('AUDIT').map(function (l) { return [l.at, l.actor, l.action, l.detail, l.ok ? 'success' : 'fail']; }));
      var blob = new Blob(['﻿' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n')], { type: 'text/csv;charset=utf-8' });
      var link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'audit-log.csv'; link.click();
      setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
      C.audit('admin:' + a.username, 'export:audit', rows.length - 1 + ' แถว');
    });
  }

  /* ---------------- Dashboard ---------------- */
  function dashView(a) {
    var log = Store.get('AUDIT'), comp = Store.get('COMPLAINTS');
    var since = Date.now() - 86400000;
    var fails = log.filter(function (l) { return !l.ok && new Date(l.at).getTime() > since; }).length;
    return html`<div class="kpis">
        <div class="card kpi"><div class="kpi__label">${icon('i-chat')} ข่าว/ประกาศ</div><div class="kpi__value">${Store.get('NEWS').length}</div><div class="kpi__sub">ปักหมุด ${Store.get('NEWS').filter(function (n) { return n.pinned; }).length}</div></div>
        <div class="card kpi"><div class="kpi__label">${icon('i-file')} เรื่องร้องเรียนใหม่</div><div class="kpi__value">${comp.filter(function (c) { return c.status === 'ใหม่'; }).length}</div><div class="kpi__sub">ทั้งหมด ${comp.length}</div></div>
        <div class="card kpi"><div class="kpi__label">${icon('i-download')} ไฟล์ดาวน์โหลด</div><div class="kpi__value">${Store.get('DOWNLOADS').length}</div></div>
        <div class="card kpi"><div class="kpi__label">${icon('i-lock')} ล็อกอินล้มเหลว 24 ชม.</div><div class="kpi__value" style="${fails ? 'color:var(--danger)' : ''}">${fails}</div></div>
      </div>
      <div class="card"><div class="card__body"><div class="admin-head"><h2 style="font-size:1.1rem">กิจกรรมล่าสุด</h2>${can(a, 'audit.view') ? html`<a href="#/admin/audit" class="small">ดูทั้งหมด ›</a>` : ''}</div>
        ${can(a, 'audit.view') ? (log.length ? html`<ul class="feature-list small">${log.slice(0, 8).map(function (l) { return html`<li><span><strong>${l.actor}</strong> · ${l.action} · ${l.detail} <span class="muted">(${new Date(l.at).toLocaleString('th-TH')})</span></span></li>`; })}</ul>` : html`<p class="muted">ยังไม่มีกิจกรรม</p>`) : html`<p class="muted small">บทบาทของท่านไม่มีสิทธิ์ดู Audit log</p>`}</div></div>
      ${can(a, 'system.reset') ? html`<div class="card"><div class="card__body"><h2 style="font-size:1.1rem">รีเซ็ตข้อมูล Demo</h2><p class="muted small">ล้างการแก้ไขทั้งหมดในเบราว์เซอร์นี้ (ข่าว แบนเนอร์ อัตราดอกเบี้ย log ฯลฯ) กลับเป็นข้อมูลตัวอย่างเริ่มต้น</p><button type="button" class="btn btn--danger btn--sm" id="resetDemo">${icon('i-trash')} รีเซ็ตข้อมูล Demo</button></div></div>` : ''}`;
  }
  function bindDash(root, a) {
    var b = root.querySelector('#resetDemo');
    if (b) b.addEventListener('click', function () {
      C.confirmBox('รีเซ็ตข้อมูล Demo ทั้งหมดในเบราว์เซอร์นี้?', 'รีเซ็ต').then(function (ok) {
        if (!ok) return;
        Store.reset(); C.audit('admin:' + a.username, 'system:reset', 'รีเซ็ตข้อมูล Demo'); C.toast('รีเซ็ตเรียบร้อย', 'success'); C.render();
      });
    });
  }

  /* ---------------- Routes ---------------- */
  C.route('/admin', function () { if (guard()) { C.go('/admin/dashboard'); return null; } return loginPage(); });
  C.route('/admin/logout', function () {
    var s = C.SS.get(SESSION_KEY, null); if (s) C.audit('admin:' + s.username, 'logout', 'ออกจากระบบ');
    C.SS.del(SESSION_KEY); C.toast('ออกจากระบบผู้ดูแลแล้ว'); C.go('/admin'); return null;
  });
  C.route('/admin/:tab', function (p) {
    var a = guard(); if (!a) { C.go('/admin'); return null; }
    var t = TABS.filter(function (x) { return x[0] === p.tab; })[0];
    if (!t) { C.go('/admin/dashboard'); return null; }
    var content, bind;
    if (!can(a, t[3])) content = denied();
    else if (SCHEMAS[p.tab]) { content = crudView(a, p.tab); bind = function (r) { bindCrud(r, a, p.tab); }; }
    else if (p.tab === 'dashboard') { content = dashView(a); bind = function (r) { bindDash(r, a); }; }
    else if (p.tab === 'rates') { content = ratesView(a); bind = function (r) { bindRates(r, a); }; }
    else if (p.tab === 'complaints') { content = complaintsView(a); bind = function (r) { bindComplaints(r, a); }; }
    else if (p.tab === 'import') { content = importView(a); bind = function (r) { bindImport(r, a); }; }
    else if (p.tab === 'users') { content = usersView(a); bind = function (r) { bindUsers(r, a); }; }
    else if (p.tab === 'audit') { content = auditView(a); bind = function (r) { bindAudit(r, a); }; }
    return { title: 'ผู้ดูแล — ' + t[1], html: shell(a, p.tab, content), after: function (root) {
      if (bind) bind(root.querySelector('.app > .stack') || root);
      var iv = setInterval(function () { if (!C.SS.get(SESSION_KEY, null) || !getSessionNoTouch()) { clearInterval(iv); C.toast('หมดเวลาการใช้งาน', 'error'); C.go('/admin'); } }, 5000);
      C.onCleanup(function () { clearInterval(iv); });
    } };
  });
  function getSessionNoTouch() { var s = C.SS.get(SESSION_KEY, null); if (!s) return null; if (Date.now() - s.lastActive > IDLE_MIN * 60000) { C.SS.del(SESSION_KEY); C.SS.set('coop.a.expired', 1); return null; } return s; }

  C.admin = { parseCSV: parseCSV, validThaiId: validThaiId, validateRow: validateRow, csvCell: csvCell };
})();
