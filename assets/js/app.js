/* =========================================================
   app.js — แกนของเว็บไซต์: utilities, store, router, หน้าสาธารณะ
   ไม่มี framework / build step เพื่อให้ deploy บน GitHub Pages ได้ทันที
   ========================================================= */
(function () {
  'use strict';

  var D = window.COOP_DATA;
  if (!D) { document.getElementById('main').textContent = 'โหลดข้อมูลไม่สำเร็จ กรุณารีเฟรชหน้า'; return; }

  /* ---------------- Safe templating (กัน XSS) ----------------
     ทุกค่าที่แทรกผ่าน html`` จะถูก escape อัตโนมัติ ยกเว้นห่อด้วย raw() */
  function esc(s) {
    return String(s).replace(/[&<>"'`]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c];
    });
  }
  function raw(s) { return { __raw: String(s) }; }
  function toStr(v) {
    if (v === null || v === undefined || v === false) return '';
    if (Array.isArray(v)) return v.map(toStr).join('');
    if (typeof v === 'object' && '__raw' in v) return v.__raw;
    return esc(v);
  }
  function html(strings) {
    var out = strings[0];
    for (var i = 1; i < arguments.length; i++) out += toStr(arguments[i]) + strings[i];
    return raw(out);
  }
  /* อนุญาตเฉพาะลิงก์ภายใน / ไฟล์ในเว็บ / https เท่านั้น */
  function safeUrl(u) {
    u = String(u || '').trim();
    if (/^#\//.test(u) || /^assets\//.test(u) || /^https:\/\//i.test(u) || /^tel:|^mailto:/i.test(u)) return u;
    return '#/';
  }
  function icon(id, cls) { return raw('<svg class="ic ' + (cls || '') + '" aria-hidden="true"><use href="#' + esc(id) + '"/></svg>'); }

  /* ---------------- Formatting ---------------- */
  var nf2 = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var nf0 = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 });
  function money(n) { return nf2.format(Number(n) || 0); }
  function num(n) { return nf0.format(Number(n) || 0); }
  function pct(n) { return (Number(n) || 0).toFixed(2) + '%'; }
  function parseISO(iso) { var p = String(iso).split('-'); return new Date(+p[0], (+p[1] || 1) - 1, +p[2] || 1); }
  function fmtDate(iso, style) {
    if (!iso) return '-';
    var d = iso instanceof Date ? iso : parseISO(iso);
    if (isNaN(d)) return '-';
    return d.toLocaleDateString('th-TH', style === 'long' ? { day: 'numeric', month: 'long', year: 'numeric' } : { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function toISO(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function maskId(id) { id = String(id || '').replace(/\D/g, ''); if (id.length !== 13) return 'x-xxxx-xxxxx-xx-x'; return 'x-xxxx-xxxxx-' + id.slice(10, 12) + '-' + id.slice(12); }
  function maskAcct(no) { no = String(no || '').replace(/\D/g, ''); if (no.length < 4) return 'xxx'; return 'xxx-x-x' + no.slice(-4, -1) + '-' + no.slice(-1); }
  function maskPhone(p) { p = String(p || '').replace(/\D/g, ''); return p.length >= 4 ? 'xxx-xxx-' + p.slice(-4) : 'xxx'; }
  function maskEmail(e) { var m = String(e || '').split('@'); if (m.length !== 2) return '-'; return m[0].slice(0, 2) + '***@' + m[1]; }

  /* ---------------- Storage (ปลอดภัยเมื่อ storage ถูกปิด) ---------------- */
  var mem = {};
  var LS = {
    get: function (k, def) { try { var v = localStorage.getItem(k); return v === null ? def : JSON.parse(v); } catch (e) { return k in mem ? mem[k] : def; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { mem[k] = v; } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) { delete mem[k]; } }
  };
  var SS = {
    get: function (k, def) { try { var v = sessionStorage.getItem(k); return v === null ? def : JSON.parse(v); } catch (e) { return ('s:' + k) in mem ? mem['s:' + k] : def; } },
    set: function (k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { mem['s:' + k] = v; } },
    del: function (k) { try { sessionStorage.removeItem(k); } catch (e) { delete mem['s:' + k]; } }
  };

  /* Store: ข้อมูลที่ผู้ดูแลแก้ไขได้ (Demo เก็บใน localStorage ของเบราว์เซอร์นี้) */
  var STORE_KEY = 'coop.store.v1';
  var EDITABLE = ['NEWS', 'BANNERS', 'BOARD', 'FAQ', 'DOWNLOADS', 'MEMBERS_IMPORTED', 'AUDIT', 'ADMIN_ROLES', 'COMPLAINTS'];
  var overrides = LS.get(STORE_KEY, {}) || {};
  var Store = {
    get: function (key) {
      if (key === 'RATES') return overrides.RATES || D.RATES;
      if (key in overrides) return overrides[key];
      if (key === 'MEMBERS_IMPORTED' || key === 'AUDIT' || key === 'COMPLAINTS') return [];
      if (key === 'ADMIN_ROLES') return {};
      return D[key];
    },
    set: function (key, val) {
      if (key !== 'RATES' && EDITABLE.indexOf(key) === -1) throw new Error('ไม่อนุญาตให้แก้ไข ' + key);
      overrides[key] = val; LS.set(STORE_KEY, overrides);
    },
    reset: function () { overrides = {}; LS.del(STORE_KEY); }
  };
  function audit(actor, action, detail, ok) {
    var log = Store.get('AUDIT').slice(0, 499);
    log.unshift({ at: new Date().toISOString(), actor: actor || '-', action: action, detail: detail || '', ok: ok !== false, ua: navigator.userAgent.slice(0, 60) });
    Store.set('AUDIT', log);
  }

  /* ---------------- Toast ---------------- */
  function toast(msg, type, title) {
    var box = document.getElementById('toasts');
    var el = document.createElement('div');
    el.className = 'toast' + (type ? ' toast--' + type : '');
    if (title) { var s = document.createElement('strong'); s.textContent = title; el.appendChild(s); }
    el.appendChild(document.createTextNode(msg));
    var x = document.createElement('button');
    x.type = 'button'; x.className = 'toast__close'; x.setAttribute('aria-label', 'ปิดข้อความ'); x.textContent = '×';
    x.addEventListener('click', function () { el.remove(); });
    el.appendChild(x);
    box.appendChild(el);
    setTimeout(function () { el.remove(); }, type === 'otp' ? 60000 : 5000);
    return el;
  }

  /* ---------------- Dialog helpers ---------------- */
  var supportsClosedBy = typeof HTMLDialogElement !== 'undefined' && 'closedBy' in HTMLDialogElement.prototype;
  function lightDismiss(dialog) {
    if (supportsClosedBy || dialog.__ld) return;
    dialog.__ld = true;
    dialog.addEventListener('click', function (e) {
      if (e.target !== dialog) return;
      var r = dialog.getBoundingClientRect();
      var inside = r.top <= e.clientY && e.clientY <= r.top + r.height && r.left <= e.clientX && e.clientX <= r.left + r.width;
      if (!inside) dialog.close();
    });
  }
  /* เปิด modal ที่สร้างแบบ dynamic; คืน Promise ของ returnValue */
  function openModal(content, opts) {
    opts = opts || {};
    var dlg = document.createElement('dialog');
    dlg.className = 'modal' + (opts.wide ? ' modal--wide' : '');
    dlg.setAttribute('closedby', 'any');
    if (opts.label) dlg.setAttribute('aria-label', opts.label);
    dlg.innerHTML = content.__raw;
    document.body.appendChild(dlg);
    lightDismiss(dlg);
    return new Promise(function (resolve) {
      dlg.addEventListener('close', function () { resolve({ value: dlg.returnValue, dialog: dlg }); setTimeout(function () { dlg.remove(); }, 0); });
      if (opts.onOpen) opts.onOpen(dlg);
      dlg.showModal();
    });
  }
  function confirmBox(message, okText) {
    return openModal(html`<form method="dialog" class="modal__body"><h2>ยืนยันการทำรายการ</h2><p>${message}</p>
      <div class="modal__actions"><button class="btn btn--ghost" value="cancel">ยกเลิก</button><button class="btn btn--danger" value="ok">${okText || 'ยืนยัน'}</button></div></form>`, { label: 'ยืนยัน' })
      .then(function (r) { return r.value === 'ok'; });
  }

  /* ---------------- Navigation ---------------- */
  var NAV = [
    { label: 'หน้าแรก', href: '#/' },
    { label: 'เกี่ยวกับสหกรณ์', key: 'about', children: [
      { label: 'ประวัติสหกรณ์', href: '#/about/history' },
      { label: 'วิสัยทัศน์ – พันธกิจ', href: '#/about/vision' },
      { label: 'คณะกรรมการดำเนินการ', href: '#/about/board' },
      { label: 'ผู้ตรวจสอบกิจการ', href: '#/about/auditors' },
      { label: 'เจ้าหน้าที่', href: '#/about/staff' },
      { label: 'ผังองค์กร', href: '#/about/org' }
    ] },
    { label: 'บริการ', key: 'services', children: [
      { label: 'บริการเงินฝาก', href: '#/deposit' },
      { label: 'บริการเงินกู้', href: '#/loan' },
      { label: 'คำนวณค่างวดเงินกู้', href: '#/calculator' },
      { label: 'สวัสดิการสมาชิก', href: '#/welfare' }
    ] },
    { label: 'ข่าวและประกาศ', href: '#/news' },
    { label: 'ดาวน์โหลด', href: '#/downloads' },
    { label: 'เปิดเผยข้อมูล', href: '#/disclosure' },
    { label: 'ติดต่อเรา', key: 'contact', children: [
      { label: 'ติดต่อ / ร้องเรียน', href: '#/contact' },
      { label: 'คำถามที่พบบ่อย (FAQ)', href: '#/faq' },
      { label: 'นโยบายความเป็นส่วนตัว', href: '#/privacy' }
    ] }
  ];

  function buildNav() {
    var desk = NAV.map(function (item, i) {
      if (!item.children) return html`<li><a href="${item.href}">${item.label}</a></li>`;
      return html`<li class="has-sub"><button type="button" class="nav-parent" aria-expanded="false" aria-controls="sub-${i}" data-key="${item.key}">${item.label}${icon('i-chev')}</button>
        <ul class="submenu" id="sub-${i}">${item.children.map(function (c) { return html`<li><a href="${c.href}">${c.label}</a></li>`; })}</ul></li>`;
    });
    document.getElementById('mainnav').innerHTML = html`<ul>${desk}</ul>`.__raw;

    var mob = NAV.map(function (item) {
      if (!item.children) return html`<li><a href="${item.href}">${item.label}</a></li>`;
      return html`<li><details><summary>${item.label}${icon('i-chev')}</summary><ul>${item.children.map(function (c) { return html`<li><a href="${c.href}">${c.label}</a></li>`; })}</ul></details></li>`;
    });
    document.getElementById('drawerNav').innerHTML = html`<ul>${mob}</ul>
      <div class="drawer__cta"><a class="btn btn--gold btn--block" href="#/member">${icon('i-user')} ตรวจสอบข้อมูลสมาชิก</a>
      <a class="btn btn--outline btn--block" href="tel:${D.SITE.phoneTel}">${icon('i-phone')} โทร ${D.SITE.phone}</a></div>`.__raw;

    // dropdown (desktop): click/keyboard + ปิดเมื่อคลิกข้างนอก/Esc
    var nav = document.getElementById('mainnav');
    function closeAll(except) {
      nav.querySelectorAll('.nav-parent').forEach(function (b) {
        if (b === except) return;
        b.setAttribute('aria-expanded', 'false');
        document.getElementById(b.getAttribute('aria-controls')).classList.remove('is-open');
      });
    }
    nav.addEventListener('click', function (e) {
      var b = e.target.closest('.nav-parent');
      if (b) {
        var open = b.getAttribute('aria-expanded') !== 'true';
        // เปิดด้วย hover อยู่แล้ว: คลิกครั้งแรกไม่ต้องปิด
        if (!open && b.dataset.hoverOpen === '1') { b.dataset.hoverOpen = ''; return; }
        closeAll(b);
        b.setAttribute('aria-expanded', String(open));
        document.getElementById(b.getAttribute('aria-controls')).classList.toggle('is-open', open);
        return;
      }
      if (e.target.closest('a')) closeAll();
    });
    nav.querySelectorAll('.has-sub').forEach(function (li) {
      li.addEventListener('mouseenter', function () { if (matchMedia('(hover:hover)').matches) { var b = li.querySelector('.nav-parent'); closeAll(b); if (b.getAttribute('aria-expanded') !== 'true') b.dataset.hoverOpen = '1'; b.setAttribute('aria-expanded', 'true'); li.querySelector('.submenu').classList.add('is-open'); } });
      li.addEventListener('mouseleave', function () { if (matchMedia('(hover:hover)').matches) { li.querySelector('.nav-parent').dataset.hoverOpen = ''; closeAll(); } });
    });
    document.addEventListener('click', function (e) { if (!e.target.closest('#mainnav')) closeAll(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { var open = nav.querySelector('.nav-parent[aria-expanded="true"]'); closeAll(); if (open) open.focus(); }
    });

    // drawer (mobile)
    var drawer = document.getElementById('drawer');
    var btn = document.getElementById('menuBtn');
    lightDismiss(drawer);
    btn.addEventListener('click', function () { drawer.showModal(); btn.setAttribute('aria-expanded', 'true'); });
    drawer.addEventListener('close', function () { btn.setAttribute('aria-expanded', 'false'); });
    drawer.addEventListener('click', function (e) { if (e.target.closest('a') || e.target.closest('[data-close]')) drawer.close(); });
  }

  function markActiveNav(path) {
    var section = '/' + (path.split('/')[1] || '');
    document.querySelectorAll('#mainnav a, #drawerNav a').forEach(function (a) {
      var href = a.getAttribute('href').slice(1);
      var active = href === path || (href !== '/' && section !== '/' && href === section);
      if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    var groups = { about: ['/about'], services: ['/deposit', '/loan', '/calculator', '/welfare'], contact: ['/contact', '/faq', '/privacy'] };
    document.querySelectorAll('#mainnav .nav-parent').forEach(function (b) {
      b.classList.toggle('is-active', (groups[b.dataset.key] || []).indexOf(section) !== -1);
    });
  }

  /* ---------------- Router (hash) ---------------- */
  var routes = [];
  function route(pattern, handler) {
    var keys = [];
    var re = new RegExp('^' + pattern.replace(/:(\w+)/g, function (_, k) { keys.push(k); return '([^/]+)'; }) + '/?$');
    routes.push({ re: re, keys: keys, handler: handler });
  }
  var cleanup = [];
  function onCleanup(fn) { cleanup.push(fn); }
  function currentPath() { var h = location.hash.replace(/^#/, ''); return h.split('?')[0] || '/'; }
  function render(opts) {
    opts = opts && opts.keepScroll ? opts : {};
    // hash ที่ไม่ใช่ route (เช่น #main จาก skip link) ไม่ต้อง render ใหม่
    if (location.hash && location.hash.indexOf('#/') !== 0) {
      if (render.first) history.replaceState(null, '', '#/'); else return;
    }
    cleanup.splice(0).forEach(function (fn) { try { fn(); } catch (e) { /* ignore */ } });
    var path = currentPath();
    var main = document.getElementById('main');
    var match = null, params = {};
    for (var i = 0; i < routes.length; i++) {
      var m = routes[i].re.exec(path);
      if (m) {
        match = routes[i];
        try { routes[i].keys.forEach(function (k, j) { params[k] = decodeURIComponent(m[j + 1]); }); }
        catch (e) { match = null; } // URL encode ผิดรูปแบบ → 404
        break;
      }
    }
    var page;
    try {
      page = match ? match.handler(params) : notFound();
    } catch (err) {
      console.error(err);
      page = errorPage(err);
    }
    if (!page) return; // handler ทำ redirect เอง
    main.innerHTML = page.html.__raw;
    document.title = (page.title ? page.title + ' | ' : '') + D.SITE.name;
    markActiveNav(path);
    if (page.after) { try { page.after(main, params); } catch (err) { console.error(err); toast('เกิดข้อผิดพลาดในการแสดงผลบางส่วน', 'error'); } }
    if (!page.keepScroll && !opts.keepScroll) window.scrollTo(0, 0);
    if (!render.first && !opts.keepScroll) main.focus({ preventScroll: true });
    render.first = false;
  }
  render.first = true;
  function go(path) { if (currentPath() === path) render(); else location.hash = '#' + path; }

  /* ---------------- Shared page parts ---------------- */
  function pageHero(title, sub, crumbs, current) {
    crumbs = crumbs || [];
    return html`<section class="page-hero"><div class="container">
      <nav class="breadcrumb" aria-label="เส้นทาง"><ol><li><a href="#/">หน้าแรก</a></li>${crumbs.map(function (c) { return c.href ? html`<li><a href="${c.href}">${c.label}</a></li>` : html`<li aria-current="page">${c.label}</li>`; })}<li aria-current="page">${current || title}</li></ol></nav>
      <h1>${title}</h1>${sub ? html`<p>${sub}</p>` : ''}</div></section>`;
  }
  function catOf(key) { return D.CATEGORIES.filter(function (c) { return c.key === key; })[0] || D.CATEGORIES[0]; }
  function sortedNews() {
    return Store.get('NEWS').slice().sort(function (a, b) {
      if (!!b.pinned - !!a.pinned) return !!b.pinned - !!a.pinned;
      return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
    });
  }
  function newsCard(n) {
    var c = catOf(n.cat);
    return html`<article class="card news-card">
      <div class="news-card__thumb cat-${c.key}">${icon(c.icon)}<span class="badge">${c.label}</span>${n.pinned ? html`<span class="news-card__pin">${icon('i-pin')} ปักหมุด</span>` : ''}</div>
      <div class="news-card__body">
        <h3><a href="#/news/${n.id}">${n.title}</a></h3>
        <p>${n.excerpt}</p>
        <div class="news-meta"><span class="cat-label">${c.label}</span><time datetime="${n.date}">${fmtDate(n.date)}</time>${n.attach ? html`<span>${icon('i-file')} มีไฟล์แนบ</span>` : ''}</div>
      </div></article>`;
  }
  function rateOf(id) {
    var R = Store.get('RATES');
    return R.deposit.concat(R.loan).filter(function (r) { return r.id === id; })[0];
  }
  function notFound() {
    return { title: 'ไม่พบหน้า', html: html`${pageHero('ไม่พบหน้าที่ต้องการ', 'หน้าที่ท่านเรียกอาจถูกย้ายหรือไม่มีอยู่')}
      <section class="section"><div class="container empty"><p>ลองกลับไปที่หน้าแรก หรือดูผังเว็บไซต์</p><p><a class="btn btn--primary" href="#/">กลับหน้าแรก</a> <a class="btn btn--outline" href="#/sitemap">ผังเว็บไซต์</a></p></div></section>` };
  }
  function errorPage(err) {
    return { title: 'เกิดข้อผิดพลาด', html: html`${pageHero('เกิดข้อผิดพลาด', 'ระบบไม่สามารถแสดงหน้านี้ได้ในขณะนี้')}
      <section class="section"><div class="container"><div class="alert alert--danger" role="alert">ขออภัย เกิดข้อผิดพลาดที่ไม่คาดคิด (${err && err.message ? err.message : 'unknown'}) กรุณาลองใหม่อีกครั้ง หรือติดต่อ ${D.SITE.phone}</div>
      <p style="margin-top:16px"><a class="btn btn--primary" href="#/">กลับหน้าแรก</a></p></div></section>` };
  }

  /* =========================================================
     หน้าแรก
     ========================================================= */
  route('/', function () {
    var banners = Store.get('BANNERS');
    var news = sortedNews().slice(0, 6);
    var R = Store.get('RATES');
    var F = D.FINANCIALS[D.FINANCIALS.length - 1];
    var pinned = sortedNews().filter(function (n) { return n.pinned; })[0];
    var thisYear = new Date().getFullYear() + 543;

    var slides = banners.map(function (b, i) {
      return html`<div class="slide slide--${b.theme || 'navy'}${i === 0 ? ' is-active' : ''}" role="group" aria-roledescription="สไลด์" aria-label="${i + 1} จาก ${banners.length}" ${i === 0 ? '' : raw('aria-hidden="true"')}>
        <div class="container slide__inner">
          <div>
            <span class="badge">${b.tag}</span>
            <h2>${b.title}</h2>
            <p>${b.text}</p>
            <div class="slide__actions"><a class="btn btn--gold btn--lg" href="${safeUrl(b.href)}" ${i === 0 ? '' : raw('tabindex="-1"')}>${b.cta} ${icon('i-arrow')}</a></div>
          </div>
          ${b.stat ? html`<div class="slide__art"><div class="slide__stat"><small>${b.statLabel}</small><div class="big">${b.stat}</div><small>ข้อมูล ณ ${fmtDate(R.effective)}</small></div></div>` : ''}
        </div></div>`;
    });

    var rateRows = function (list, type) {
      return list.map(function (r) {
        return html`<li><span><strong>${r.name}</strong><br><span class="small muted">${r.note}</span></span><span class="rate">${r.rate.toFixed(2)}<small>% ต่อปี</small></span></li>`;
      });
    };

    return { title: 'หน้าแรก', html: html`
      ${pinned ? html`<div class="notice-bar"><div class="container"><strong>${icon('i-pin')} ประกาศ</strong><a href="#/news/${pinned.id}">${pinned.title}</a></div></div>` : ''}
      <section class="hero" aria-roledescription="carousel" aria-label="ข่าวเด่น">
        <div class="hero__track" id="heroTrack" aria-live="off">${slides}</div>
        <div class="hero__controls"><div class="container">
          <div class="dots" role="group" aria-label="เลือกสไลด์">${banners.map(function (b, i) { return html`<button type="button" aria-label="สไลด์ที่ ${i + 1}: ${b.tag}" aria-current="${i === 0 ? 'true' : 'false'}" data-slide="${i}"></button>`; })}</div>
          <div class="hero__arrows"><button type="button" class="prev" aria-label="สไลด์ก่อนหน้า">${icon('i-arrow')}</button><button type="button" class="next" aria-label="สไลด์ถัดไป">${icon('i-arrow')}</button></div>
          <button type="button" class="hero__pause" aria-pressed="false">หยุดเลื่อน</button>
        </div></div>
      </section>

      <h1 class="sr-only">${D.SITE.name}</h1>
      <section class="quick" aria-label="บริการด่วน"><div class="container"><div class="quick__grid">
        <a class="quick__item" href="#/member"><span class="quick__icon">${icon('i-user')}</span><span><strong>ตรวจสอบข้อมูลสมาชิก</strong><small>หุ้น เงินฝาก เงินกู้ ปันผล</small></span></a>
        <a class="quick__item" href="#/downloads"><span class="quick__icon">${icon('i-download')}</span><span><strong>ดาวน์โหลดแบบฟอร์ม</strong><small>คำขอกู้ สวัสดิการ ระเบียบ</small></span></a>
        <a class="quick__item" href="#/calculator"><span class="quick__icon">${icon('i-calc')}</span><span><strong>คำนวณเงินกู้</strong><small>ลดต้นลดดอก / ผ่อนคงที่</small></span></a>
        <a class="quick__item" href="#/contact"><span class="quick__icon">${icon('i-chat')}</span><span><strong>ติดต่อสหกรณ์</strong><small>โทร LINE ร้องเรียน</small></span></a>
      </div></div></section>

      <section class="section" aria-labelledby="h-rates"><div class="container">
        <div class="section-head"><div><span class="eyebrow">อัตราดอกเบี้ยล่าสุด</span><h2 id="h-rates">อัตราดอกเบี้ยเงินฝากและเงินกู้</h2></div>
          <span class="badge badge--gold">มีผลตั้งแต่ ${fmtDate(R.effective, 'long')}</span></div>
        <div class="rates">
          <article class="card rate-card"><div class="rate-card__head"><span class="quick__icon">${icon('i-coins')}</span><h3>เงินฝาก</h3></div>
            <ul class="rate-list">${rateRows(R.deposit)}</ul>
            <div class="rate-card__foot"><span>ดอกเบี้ยเงินฝากได้รับยกเว้นภาษีตามกฎหมาย</span><a href="#/deposit">รายละเอียดเงินฝาก ›</a></div></article>
          <article class="card rate-card rate-card--loan"><div class="rate-card__head"><span class="quick__icon">${icon('i-bank')}</span><h3>เงินกู้</h3></div>
            <ul class="rate-list">${rateRows(R.loan)}</ul>
            <div class="rate-card__foot"><span>อัตราดอกเบี้ยอาจเปลี่ยนแปลงตามประกาศ</span><a href="#/calculator">คำนวณค่างวด ›</a></div></article>
        </div>
      </div></section>

      <section class="section section--alt" aria-labelledby="h-news"><div class="container">
        <div class="section-head"><div><span class="eyebrow">ข่าวสารสหกรณ์</span><h2 id="h-news">ข่าวและประกาศล่าสุด</h2></div>
          <a class="btn btn--outline btn--sm" href="#/news">ดูข่าวทั้งหมด ${icon('i-arrow')}</a></div>
        <div class="news-grid news-grid--compact">${news.map(newsCard)}</div>
      </div></section>

      <section class="section" aria-labelledby="h-trust"><div class="container">
        <div class="section-head"><div><span class="eyebrow">ความมั่นคง</span><h2 id="h-trust">ผลการดำเนินงานปี ${F.year}</h2></div><a href="#/disclosure">ดูผลการดำเนินงานย้อนหลัง ›</a></div>
        <div class="trust">
          <div class="card trust__item"><div class="kpi__label" style="justify-content:center">สมาชิก</div><div class="kpi__value">${num(F.members)}</div><div class="kpi__sub">ราย</div></div>
          <div class="card trust__item"><div class="kpi__label" style="justify-content:center">สินทรัพย์รวม</div><div class="kpi__value">${num(F.assets)}</div><div class="kpi__sub">ล้านบาท</div></div>
          <div class="card trust__item"><div class="kpi__label" style="justify-content:center">เงินปันผล</div><div class="kpi__value">${F.dividend.toFixed(2)}%</div><div class="kpi__sub">เฉลี่ยคืน ${F.refund}%</div></div>
          <div class="card trust__item"><div class="kpi__label" style="justify-content:center">ดำเนินงานมา</div><div class="kpi__value">${thisYear - D.SITE.founded}</div><div class="kpi__sub">ปี (ก่อตั้ง ${D.SITE.founded})</div></div>
        </div>
      </div></section>

      <section class="section section--alt" aria-labelledby="h-svc"><div class="container">
        <div class="section-head"><div><span class="eyebrow">บริการของเรา</span><h2 id="h-svc">ดูแลสมาชิกทุกช่วงชีวิต</h2></div></div>
        <div class="grid grid-3">
          <a class="card quick__item" href="#/deposit"><span class="quick__icon">${icon('i-coins')}</span><span><strong>เงินฝาก</strong><small>ออมทรัพย์ ออมทรัพย์พิเศษ เงินฝากประจำ ดอกเบี้ยสูงสุด ${Math.max.apply(null, R.deposit.map(function (r) { return r.rate; })).toFixed(2)}%</small></span></a>
          <a class="card quick__item" href="#/loan"><span class="quick__icon">${icon('i-bank')}</span><span><strong>เงินกู้</strong><small>ฉุกเฉิน สามัญ ที่อยู่อาศัย การศึกษา ดอกเบี้ยเริ่มต้น ${Math.min.apply(null, R.loan.map(function (r) { return r.rate; })).toFixed(2)}%</small></span></a>
          <a class="card quick__item" href="#/welfare"><span class="quick__icon">${icon('i-heart')}</span><span><strong>สวัสดิการ</strong><small>ทุนการศึกษาบุตร รักษาพยาบาล สมาชิกอาวุโส และอื่น ๆ อีก ${D.WELFARE.length} รายการ</small></span></a>
        </div>
      </div></section>

      <section class="section"><div class="container"><div class="card"><div class="card__body cta-band">
        <div><h2 style="margin:0 0 4px">มีคำถาม? เราพร้อมช่วยเหลือ</h2><p class="muted" style="margin:0">โทร ${D.SITE.phone} (${D.SITE.hours[0][0]} ${D.SITE.hours[0][1]}) หรือเพิ่มเพื่อน LINE ${D.SITE.line}</p></div>
        <div class="cta-band__actions"><a class="btn btn--primary" href="tel:${D.SITE.phoneTel}">${icon('i-phone')} โทรหาเรา</a><a class="btn btn--outline" href="#/faq">คำถามที่พบบ่อย</a></div>
      </div></div></div></section>
    `, after: initHero };
  });

  function initHero(root) {
    var slides = root.querySelectorAll('.slide');
    var dots = root.querySelectorAll('.dots button');
    if (slides.length < 2) return;
    var idx = 0, timer = null;
    var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    var pauseBtn = root.querySelector('.hero__pause');
    var paused = reduce;
    function show(n) {
      idx = (n + slides.length) % slides.length;
      slides.forEach(function (s, i) {
        var on = i === idx;
        s.classList.toggle('is-active', on);
        if (on) s.removeAttribute('aria-hidden'); else s.setAttribute('aria-hidden', 'true');
        s.querySelectorAll('a').forEach(function (a) { if (on) a.removeAttribute('tabindex'); else a.setAttribute('tabindex', '-1'); });
      });
      dots.forEach(function (d, i) { d.setAttribute('aria-current', i === idx ? 'true' : 'false'); });
    }
    function start() { stop(); if (!paused) timer = setInterval(function () { show(idx + 1); }, 6000); }
    function stop() { if (timer) clearInterval(timer); timer = null; }
    function setPaused(p) { paused = p; pauseBtn.setAttribute('aria-pressed', String(p)); pauseBtn.textContent = p ? 'เล่นต่อ' : 'หยุดเลื่อน'; start(); }
    setPaused(paused);
    dots.forEach(function (d) { d.addEventListener('click', function () { show(+d.dataset.slide); start(); }); });
    root.querySelector('.hero__arrows .prev').addEventListener('click', function () { show(idx - 1); start(); });
    root.querySelector('.hero__arrows .next').addEventListener('click', function () { show(idx + 1); start(); });
    pauseBtn.addEventListener('click', function () { setPaused(!paused); });
    var hero = root.querySelector('.hero');
    hero.addEventListener('focusin', stop);
    hero.addEventListener('focusout', start);
    hero.addEventListener('mouseenter', stop);
    hero.addEventListener('mouseleave', start);
    // ปัดซ้าย/ขวาบนมือถือ
    var x0 = null;
    hero.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    hero.addEventListener('touchend', function (e) {
      if (x0 === null) return;
      var dx = e.changedTouches[0].clientX - x0; x0 = null;
      if (Math.abs(dx) > 50) { show(idx + (dx < 0 ? 1 : -1)); start(); }
    }, { passive: true });
    document.addEventListener('visibilitychange', onVis);
    function onVis() { if (document.hidden) stop(); else start(); }
    onCleanup(function () { stop(); document.removeEventListener('visibilitychange', onVis); });
  }

  /* =========================================================
     ข่าวและประกาศ
     ========================================================= */
  var newsState = { q: '', cat: 'all', page: 1 };
  route('/news', function () {
    return { title: 'ข่าวและประกาศ', html: html`${pageHero('ข่าวและประกาศ', 'ติดตามประกาศ การประชุมใหญ่ การเลือกตั้ง ปันผล และสวัสดิการ')}
      <section class="section"><div class="container">
        <div class="toolbar">
          <div class="search"><label class="sr-only" for="newsQ">ค้นหาข่าว</label>${icon('i-search')}<input id="newsQ" class="input" type="search" placeholder="ค้นหาหัวข้อหรือเนื้อหาข่าว…" value="${newsState.q}" autocomplete="off"></div>
          <div class="chips" role="group" aria-label="หมวดหมู่ข่าว">
            <button type="button" class="chip" data-cat="all" aria-pressed="${newsState.cat === 'all'}">ทั้งหมด</button>
            ${D.CATEGORIES.map(function (c) { return html`<button type="button" class="chip" data-cat="${c.key}" aria-pressed="${newsState.cat === c.key}">${c.label}</button>`; })}
          </div>
        </div>
        <p class="small muted" id="newsCount" aria-live="polite"></p>
        <div id="newsList"></div>
        <nav class="pagination" id="newsPager" aria-label="แบ่งหน้า"></nav>
      </div></section>`, after: function (root) {
      var PER = 9;
      var list = root.querySelector('#newsList'), pager = root.querySelector('#newsPager'), count = root.querySelector('#newsCount');
      function draw() {
        var q = newsState.q.trim().toLowerCase();
        var items = sortedNews().filter(function (n) {
          if (newsState.cat !== 'all' && n.cat !== newsState.cat) return false;
          if (!q) return true;
          return (n.title + ' ' + n.excerpt + ' ' + (n.body || []).join(' ')).toLowerCase().indexOf(q) !== -1;
        });
        var pages = Math.max(1, Math.ceil(items.length / PER));
        if (newsState.page > pages) newsState.page = pages;
        var slice = items.slice((newsState.page - 1) * PER, newsState.page * PER);
        count.textContent = 'พบ ' + items.length + ' รายการ' + (pages > 1 ? ' (หน้า ' + newsState.page + '/' + pages + ')' : '');
        list.innerHTML = (slice.length ? html`<div class="news-grid">${slice.map(newsCard)}</div>` : html`<div class="empty">${icon('i-search')}<p>ไม่พบข่าวที่ตรงกับเงื่อนไข</p><button type="button" class="btn btn--outline btn--sm" id="clearNews">ล้างการค้นหา</button></div>`).__raw;
        var btns = [html`<button type="button" data-p="${newsState.page - 1}" ${newsState.page === 1 ? raw('disabled') : ''} aria-label="หน้าก่อนหน้า">‹</button>`];
        for (var p = 1; p <= pages; p++) btns.push(html`<button type="button" data-p="${p}" ${p === newsState.page ? raw('aria-current="page"') : ''}>${p}</button>`);
        btns.push(html`<button type="button" data-p="${newsState.page + 1}" ${newsState.page === pages ? raw('disabled') : ''} aria-label="หน้าถัดไป">›</button>`);
        pager.innerHTML = pages > 1 ? html`${btns}`.__raw : '';
        var clr = root.querySelector('#clearNews');
        if (clr) clr.addEventListener('click', function () { newsState.q = ''; newsState.cat = 'all'; newsState.page = 1; root.querySelector('#newsQ').value = ''; syncChips(); draw(); });
      }
      function syncChips() { root.querySelectorAll('.chip').forEach(function (c) { c.setAttribute('aria-pressed', String(c.dataset.cat === newsState.cat)); }); }
      var t;
      root.querySelector('#newsQ').addEventListener('input', function (e) { clearTimeout(t); t = setTimeout(function () { newsState.q = e.target.value; newsState.page = 1; draw(); }, 200); });
      root.querySelector('.chips').addEventListener('click', function (e) { var c = e.target.closest('.chip'); if (!c) return; newsState.cat = c.dataset.cat; newsState.page = 1; syncChips(); draw(); });
      pager.addEventListener('click', function (e) { var b = e.target.closest('button[data-p]'); if (!b || b.disabled) return; newsState.page = +b.dataset.p; draw(); root.querySelector('.toolbar').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
      draw();
    } };
  });

  route('/news/:id', function (p) {
    var n = Store.get('NEWS').filter(function (x) { return x.id === p.id; })[0];
    if (!n) return notFound();
    var c = catOf(n.cat);
    var related = sortedNews().filter(function (x) { return x.cat === n.cat && x.id !== n.id; }).slice(0, 3);
    return { title: n.title, html: html`${pageHero(n.title, '', [{ label: 'ข่าวและประกาศ', href: '#/news' }, { label: c.label }], 'รายละเอียดข่าว')}
      <section class="section"><div class="container"><article class="article">
        <div class="article__meta"><span class="badge">${c.label}</span>${n.pinned ? html`<span class="badge badge--gold">${icon('i-pin')} ปักหมุด</span>` : ''}<time datetime="${n.date}">ประกาศเมื่อ ${fmtDate(n.date, 'long')}</time></div>
        <div class="article__body">${(n.body || [n.excerpt]).map(function (para) { return html`<p>${para}</p>`; })}</div>
        ${n.attach ? html`<h2 class="small muted" style="margin-top:24px">ไฟล์แนบ</h2><a class="attach" href="${safeUrl(n.attach.file)}" target="_blank" rel="noopener"><span class="attach__icon">PDF</span><span><strong>${n.attach.name}</strong><br><span class="small muted">${n.attach.size || ''} · เปิดในแท็บใหม่</span></span></a>` : ''}
        <p style="margin-top:24px" class="no-print actions-row"><a class="btn btn--outline" href="#/news">‹ กลับไปหน้าข่าว</a><button type="button" class="btn btn--ghost" id="printBtn">${icon('i-print')} พิมพ์</button></p>
      </article>
      ${related.length ? html`<h2 style="margin-top:40px">ข่าวที่เกี่ยวข้อง</h2><div class="news-grid">${related.map(newsCard)}</div>` : ''}
      </div></section>`, after: function (root) { root.querySelector('#printBtn').addEventListener('click', function () { window.print(); }); } };
  });

  /* =========================================================
     เกี่ยวกับสหกรณ์
     ========================================================= */
  function initials(name) {
    var n = String(name).replace(/^(นาย|นางสาว|นาง|เด็กชาย|เด็กหญิง|ดร\.)/, '').trim();
    return n.charAt(0);
  }
  function personCard(p) {
    return html`<div class="card person${p.lead ? ' person--lead' : ''}"><div class="person__avatar" aria-hidden="true">${initials(p.name)}</div><strong>${p.name}</strong><span>${p.role}</span></div>`;
  }
  route('/about', function () { return aboutPage(); });
  route('/about/:section', function (p) { return aboutPage(p.section); });
  function aboutPage(section) {
    var A = D.ABOUT, board = Store.get('BOARD');
    var lead = board.filter(function (b) { return b.lead; });
    var rest = board.filter(function (b) { return !b.lead; });
    var tabs = [['history', 'ประวัติ'], ['vision', 'วิสัยทัศน์ – พันธกิจ'], ['board', 'คณะกรรมการ'], ['auditors', 'ผู้ตรวจสอบกิจการ'], ['staff', 'เจ้าหน้าที่'], ['org', 'ผังองค์กร']];
    return { title: 'เกี่ยวกับสหกรณ์', html: html`${pageHero('เกี่ยวกับสหกรณ์', 'ก่อตั้งเมื่อปี พ.ศ. ' + D.SITE.founded + ' — สถาบันการเงินของสมาชิก โดยสมาชิก เพื่อสมาชิก')}
      <div class="container"><nav class="tabs" aria-label="หัวข้อในหน้านี้" style="margin-top:12px">${tabs.map(function (t) { return html`<a href="#/about/${t[0]}" ${section === t[0] ? raw('aria-current="page"') : ''}>${t[1]}</a>`; })}</nav></div>
      <section class="section" id="history" style="padding-top:12px"><div class="container split">
        <div><span class="eyebrow">ประวัติความเป็นมา</span><h2>ประวัติสหกรณ์</h2>${A.history.map(function (p) { return html`<p class="lead">${p}</p>`; })}</div>
        <div class="kpis" style="grid-template-columns:1fr 1fr">${[['ก่อตั้ง', 'พ.ศ. ' + D.SITE.founded], ['สมาชิกแรกตั้ง', '312 ราย'], ['สมาชิกปัจจุบัน', num(D.FINANCIALS[4].members) + ' ราย'], ['สินทรัพย์', num(D.FINANCIALS[4].assets) + ' ล้านบาท']].map(function (k) { return html`<div class="card kpi"><div class="kpi__label">${k[0]}</div><div class="kpi__value">${k[1]}</div></div>`; })}</div>
      </div></section>
      <section class="section section--alt" id="vision"><div class="container split">
        <div><span class="eyebrow">Vision</span><h2>วิสัยทัศน์</h2><p class="lead">“${A.vision}”</p>
          <h3 style="margin-top:20px">ค่านิยมองค์กร</h3><p>${A.values.map(function (v) { return html`<span class="badge badge--gold" style="margin:0 6px 6px 0">${v}</span>`; })}</p></div>
        <div><span class="eyebrow">Mission</span><h2>พันธกิจ</h2><ol class="feature-list">${A.missions.map(function (m) { return html`<li>${m}</li>`; })}</ol></div>
      </div></section>
      <section class="section" id="board"><div class="container">
        <div class="section-head"><div><span class="eyebrow">ชุดที่ 36 (2568 – 2569)</span><h2>คณะกรรมการดำเนินการ</h2></div></div>
        <div class="people" style="grid-template-columns:1fr;max-width:280px;margin:0 auto 16px">${lead.map(personCard)}</div>
        <div class="people">${rest.map(personCard)}</div>
      </div></section>
      <section class="section section--alt" id="auditors"><div class="container">
        <div class="section-head"><div><span class="eyebrow">ปี 2569</span><h2>ผู้ตรวจสอบกิจการ</h2></div></div>
        <div class="people">${D.AUDITORS.map(personCard)}</div>
      </div></section>
      <section class="section" id="staff"><div class="container">
        <div class="section-head"><div><span class="eyebrow">ฝ่ายจัดการ</span><h2>เจ้าหน้าที่สหกรณ์</h2></div></div>
        <div class="people">${D.STAFF.map(personCard)}</div>
      </div></section>
      <section class="section section--alt" id="org"><div class="container">
        <div class="section-head"><div><span class="eyebrow">โครงสร้าง</span><h2>ผังองค์กร</h2></div></div>
        <div class="org" role="img" aria-label="ผังองค์กร: ที่ประชุมใหญ่ อยู่เหนือคณะกรรมการดำเนินการ ผู้ตรวจสอบกิจการ และผู้สอบบัญชี คณะกรรมการดำเนินการดูแลคณะอนุกรรมการและผู้จัดการ ผู้จัดการดูแลฝ่ายต่าง ๆ">
          <div class="org__node org__node--top">${D.ORG.top}</div><div class="org__line"></div>
          <div class="org__row">${D.ORG.level2.map(function (x, i) { return html`<div class="org__node"${i === 0 ? raw(' style="border-width:2px;font-weight:700"') : ''}>${x}</div>`; })}</div><div class="org__line"></div>
          <div class="org__row">${D.ORG.committees.map(function (x) { return html`<div class="org__node">${x}</div>`; })}</div><div class="org__line"></div>
          <div class="org__node org__node--top" style="background:var(--gold-500);border-color:var(--gold-500);color:#1d1606">${D.ORG.manager}</div><div class="org__line"></div>
          <div class="org__row">${D.ORG.depts.map(function (x) { return html`<div class="org__node">${x}</div>`; })}</div>
        </div>
      </div></section>`, after: function (root) {
      if (section) { var el = root.querySelector('#' + CSS.escape(section)); if (el) setTimeout(function () { el.scrollIntoView({ block: 'start' }); }, 0); }
    }, keepScroll: !!section };
  }

  /* =========================================================
     เงินฝาก
     ========================================================= */
  route('/deposit', function () {
    var R = Store.get('RATES');
    return { title: 'บริการเงินฝาก', html: html`${pageHero('บริการเงินฝาก', 'ออมอย่างมั่นคง ดอกเบี้ยดี ได้รับยกเว้นภาษีเงินได้', [{ label: 'บริการ' }])}
      <section class="section"><div class="container">
        <div class="section-head"><div><span class="eyebrow">ประเภทบัญชี</span><h2>เลือกบัญชีที่เหมาะกับคุณ</h2></div></div>
        <div class="grid grid-2">${D.DEPOSIT_TYPES.map(function (t) {
          var r = rateOf(t.rateId);
          return html`<article class="card"><div class="card__body"><div class="acct"><h3 style="margin:0">${t.name}</h3><span class="badge badge--gold">${r ? r.rate.toFixed(2) + '% ต่อปี' : '-'}</span></div>
            <p class="muted small" style="margin:6px 0 12px">${t.min}</p><ul class="feature-list">${t.features.map(function (f) { return html`<li>${f}</li>`; })}</ul></div></article>`;
        })}</div>
      </div></section>
      <section class="section section--alt"><div class="container">
        <div class="section-head"><div><span class="eyebrow">อัตราดอกเบี้ย</span><h2>ตารางอัตราดอกเบี้ยเงินฝาก</h2></div><span class="badge">มีผล ${fmtDate(R.effective, 'long')}</span></div>
        <div class="table-wrap"><table class="table table--stack"><thead><tr><th scope="col">ประเภทเงินฝาก</th><th scope="col">เงื่อนไข</th><th scope="col" class="r">อัตราดอกเบี้ย (% ต่อปี)</th></tr></thead>
        <tbody>${R.deposit.map(function (r) { return html`<tr><td data-label="ประเภท"><strong>${r.name}</strong></td><td data-label="เงื่อนไข">${r.note}</td><td data-label="ดอกเบี้ย" class="r"><strong>${r.rate.toFixed(2)}</strong></td></tr>`; })}</tbody></table></div>
      </div></section>
      <section class="section"><div class="container split">
        <div><h2>เงื่อนไขการฝาก-ถอน</h2><ul class="feature-list">${D.DEPOSIT_CONDITIONS.map(function (c) { return html`<li>${c}</li>`; })}</ul></div>
        <div class="card"><div class="card__body"><h3>เปิดบัญชีเงินฝาก</h3><p class="muted">ดาวน์โหลดแบบฟอร์ม กรอกข้อมูล แล้วยื่นที่สำนักงานพร้อมบัตรประชาชน</p>
          <a class="btn btn--primary" href="#/downloads">${icon('i-download')} ดาวน์โหลดแบบฟอร์ม</a></div></div>
      </div></section>` };
  });

  /* =========================================================
     เงินกู้
     ========================================================= */
  route('/loan', function () {
    var R = Store.get('RATES');
    return { title: 'บริการเงินกู้', html: html`${pageHero('บริการเงินกู้', 'สินเชื่อดอกเบี้ยเป็นธรรมสำหรับสมาชิก พร้อมเครื่องคำนวณค่างวด', [{ label: 'บริการ' }])}
      <section class="section"><div class="container">
        <div class="section-head"><div><span class="eyebrow">ประเภทเงินกู้</span><h2>เงินกู้สำหรับสมาชิก</h2></div><a class="btn btn--gold" href="#/calculator">${icon('i-calc')} คำนวณค่างวด</a></div>
        <div class="accordion">${D.LOAN_TYPES.map(function (t, i) {
          var r = rateOf(t.rateId);
          return html`<details ${i === 0 ? raw('open') : ''}><summary><span>${t.name} <span class="badge badge--gold" style="margin-left:6px">${r ? r.rate.toFixed(2) + '%' : '-'}</span></span>${icon('i-chev')}</summary>
            <div class="acc-body"><div class="grid grid-3">
              <div><h3>วงเงินและระยะเวลา</h3><ul class="feature-list"><li>${t.limit}</li><li>${t.term}</li><li>ดอกเบี้ย ${r ? r.rate.toFixed(2) : '-'}% ต่อปี</li></ul></div>
              <div><h3>คุณสมบัติผู้กู้</h3><ul class="feature-list">${t.qualify.map(function (q) { return html`<li>${q}</li>`; })}</ul></div>
              <div><h3>เอกสารที่ใช้</h3><ul class="feature-list">${t.docs.map(function (q) { return html`<li>${q}</li>`; })}</ul></div>
            </div><p style="margin:14px 0 0"><a class="btn btn--outline btn--sm" href="#/calculator?type=${t.id}">คำนวณค่างวด${t.name}</a> <a class="btn btn--ghost btn--sm" href="#/downloads">ดาวน์โหลดแบบคำขอ</a></p></div></details>`;
        })}</div>
      </div></section>
      <section class="section section--alt"><div class="container">
        <div class="section-head"><div><h2>ตารางอัตราดอกเบี้ยเงินกู้</h2></div><span class="badge">มีผล ${fmtDate(R.effective, 'long')}</span></div>
        <div class="table-wrap"><table class="table table--stack"><thead><tr><th scope="col">ประเภทเงินกู้</th><th scope="col">วงเงิน</th><th scope="col">ระยะเวลาผ่อน</th><th scope="col" class="r">ดอกเบี้ย (% ต่อปี)</th></tr></thead>
        <tbody>${D.LOAN_TYPES.map(function (t) { var r = rateOf(t.rateId); return html`<tr><td data-label="ประเภท"><strong>${t.name}</strong></td><td data-label="วงเงิน">${t.limit}</td><td data-label="ระยะเวลา">${t.term}</td><td data-label="ดอกเบี้ย" class="r"><strong>${r ? r.rate.toFixed(2) : '-'}</strong></td></tr>`; })}</tbody></table></div>
        <p class="small muted" style="margin-top:10px">หมายเหตุ: วงเงินที่ได้รับจริงขึ้นอยู่กับทุนเรือนหุ้น อายุการเป็นสมาชิก และความสามารถในการชำระหนี้ตามระเบียบสหกรณ์ฯ</p>
      </div></section>` };
  });

  /* =========================================================
     เครื่องคำนวณค่างวด
     ลดต้นลดดอก = ชำระเงินต้นเท่ากันทุกงวด + ดอกเบี้ยตามยอดคงเหลือ
     คงที่      = ชำระเท่ากันทุกงวด (annuity) ดอกเบี้ยคิดจากยอดคงเหลือ
     ========================================================= */
  function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
  function schedule(principal, ratePct, months, method) {
    if (!(principal > 0) || !(months > 0) || !(ratePct >= 0)) throw new Error('ข้อมูลไม่ถูกต้อง');
    var r = ratePct / 100 / 12, bal = principal, rows = [], totalInt = 0;
    var pmt = method === 'annuity' ? (r === 0 ? principal / months : principal * r / (1 - Math.pow(1 + r, -months))) : 0;
    pmt = Math.ceil(round2(pmt * 100)) / 100; // ปัดขึ้นเป็นสตางค์ งวดสุดท้ายจึงไม่สูงกว่างวดอื่น
    var prinFixed = principal / months;
    for (var i = 1; i <= months; i++) {
      var interest = round2(bal * r);
      var prin = method === 'annuity' ? round2(pmt - interest) : round2(prinFixed);
      if (i === months) prin = round2(bal); // งวดสุดท้ายปิดยอดพอดี
      bal = round2(bal - prin);
      totalInt += interest;
      rows.push({ n: i, principal: prin, interest: interest, payment: round2(prin + interest), balance: Math.max(0, bal) });
    }
    return { rows: rows, totalInterest: round2(totalInt), total: round2(principal + totalInt), first: rows[0].payment, last: rows[rows.length - 1].payment };
  }

  route('/calculator', function () {
    var q = new URLSearchParams(location.hash.split('?')[1] || '');
    var preset = D.LOAN_TYPES.filter(function (t) { return t.id === q.get('type'); })[0] || D.LOAN_TYPES[1];
    var pr = rateOf(preset.rateId);
    return { title: 'คำนวณค่างวดเงินกู้', html: html`${pageHero('คำนวณค่างวดเงินกู้', 'ประมาณการค่างวด ดอกเบี้ยรวม และตารางผ่อนชำระ ทั้งแบบลดต้นลดดอกและแบบผ่อนคงที่', [{ label: 'บริการ' }, { label: 'เงินกู้', href: '#/loan' }])}
      <section class="section"><div class="container split split--calc">
        <form class="card" id="calcForm" novalidate><div class="card__body form-grid">
          <div class="field"><label for="cType">ประเภทเงินกู้</label>
            <select id="cType" class="select">${D.LOAN_TYPES.map(function (t) { return html`<option value="${t.id}" ${t.id === preset.id ? raw('selected') : ''}>${t.name}</option>`; })}</select></div>
          <div class="field"><label for="cAmount">จำนวนเงินกู้ <span class="req">*</span></label>
            <span class="hint" id="cAmountHint">ระหว่าง 1,000 – ${num(preset.max)} บาท</span>
            <div class="input-group"><input id="cAmount" class="input num" inputmode="numeric" required value="${num(Math.min(500000, preset.max))}" aria-describedby="cAmountHint cAmountErr" autocomplete="off"><span class="addon">บาท</span></div>
            <span class="error-msg" id="cAmountErr" role="alert"></span></div>
          <div class="form-grid form-grid--2">
            <div class="field"><label for="cRate">ดอกเบี้ย <span class="req">*</span></label>
              <div class="input-group"><input id="cRate" class="input num" type="number" step="0.01" min="0" max="30" required value="${pr ? pr.rate : 6}" aria-describedby="cRateErr"><span class="addon">% ต่อปี</span></div>
              <span class="error-msg" id="cRateErr">ดอกเบี้ยต้องอยู่ระหว่าง 0 – 30%</span></div>
            <div class="field"><label for="cMonths">จำนวนงวด <span class="req">*</span></label>
              <div class="input-group"><input id="cMonths" class="input num" type="number" step="1" min="1" max="${preset.maxMonths}" required value="${Math.min(120, preset.maxMonths)}" aria-describedby="cMonthsHint cMonthsErr"><span class="addon">เดือน</span></div>
              <span class="hint" id="cMonthsHint">สูงสุด ${preset.maxMonths} งวด</span>
              <span class="error-msg" id="cMonthsErr">จำนวนงวดไม่ถูกต้อง</span></div>
          </div>
          <fieldset class="field" style="border:0;padding:0;margin:0"><legend class="label" style="margin-bottom:6px">วิธีคำนวณ</legend>
            <div class="seg">
              <label><input type="radio" name="method" value="flat-principal" checked><span>ลดต้นลดดอก</span></label>
              <label><input type="radio" name="method" value="annuity"><span>ผ่อนคงที่</span></label>
              <label><input type="radio" name="method" value="compare"><span>เปรียบเทียบ</span></label>
            </div></fieldset>
          <button class="btn btn--primary btn--lg" type="submit">${icon('i-calc')} คำนวณ</button>
          <p class="small muted" style="margin:0">* ผลการคำนวณเป็นการประมาณการ คิดดอกเบี้ยรายเดือน (อัตราต่อปี ÷ 12) ระบบจริงของสหกรณ์คิดตามจำนวนวัน ยอดจริงอาจต่างเล็กน้อย</p>
        </div></form>
        <div id="calcOut" aria-live="polite"></div>
      </div>
      <div class="container" id="calcTable"></div></section>`, after: initCalc };
  });

  function parseAmount(s) { var v = String(s).replace(/[,\s]/g, ''); return /^\d+(\.\d{1,2})?$/.test(v) ? parseFloat(v) : NaN; }
  function initCalc(root) {
    var form = root.querySelector('#calcForm');
    var type = root.querySelector('#cType'), amount = root.querySelector('#cAmount'), rate = root.querySelector('#cRate'), months = root.querySelector('#cMonths');
    var out = root.querySelector('#calcOut'), tbl = root.querySelector('#calcTable');
    function cur() { return D.LOAN_TYPES.filter(function (t) { return t.id === type.value; })[0]; }
    function validateAmount() {
      var t = cur(), v = parseAmount(amount.value), msg = '';
      if (isNaN(v)) msg = 'กรุณากรอกจำนวนเงินเป็นตัวเลข';
      else if (v < 1000) msg = 'จำนวนเงินกู้ขั้นต่ำ 1,000 บาท';
      else if (v > t.max) msg = 'วงเงินสูงสุดของ' + t.name + ' คือ ' + num(t.max) + ' บาท';
      amount.setCustomValidity(msg);
      root.querySelector('#cAmountErr').textContent = msg;
      return !msg;
    }
    type.addEventListener('change', function () {
      var t = cur(), r = rateOf(t.rateId);
      if (r) rate.value = r.rate;
      months.max = t.maxMonths;
      if (+months.value > t.maxMonths) months.value = t.maxMonths;
      var av = parseAmount(amount.value);
      if (!isNaN(av) && av > t.max) amount.value = num(t.max);
      root.querySelector('#cMonthsHint').textContent = 'สูงสุด ' + t.maxMonths + ' งวด';
      root.querySelector('#cAmountHint').textContent = 'ระหว่าง 1,000 – ' + num(t.max) + ' บาท';
      validateAmount();
    });
    amount.addEventListener('input', validateAmount);
    function validateMonths() {
      var v = months.validity, el = root.querySelector('#cMonthsErr');
      el.textContent = v.valueMissing || v.badInput ? 'กรุณากรอกจำนวนงวด' : v.rangeUnderflow ? 'อย่างน้อย 1 งวด' : v.rangeOverflow ? 'เกินที่ระเบียบกำหนด (สูงสุด ' + months.max + ' งวด)' : v.stepMismatch ? 'จำนวนงวดต้องเป็นจำนวนเต็ม' : '';
    }
    months.addEventListener('input', validateMonths);
    amount.addEventListener('blur', function () { var v = parseAmount(amount.value); if (!isNaN(v)) amount.value = v % 1 ? money(v) : num(v); });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      validateAmount(); validateMonths();
      if (!form.checkValidity()) { form.reportValidity(); out.innerHTML = ''; tbl.innerHTML = ''; return; }
      var P = parseAmount(amount.value), R = parseFloat(rate.value), N = parseInt(months.value, 10);
      var m = form.querySelector('input[name="method"]:checked').value;
      try {
        if (m === 'compare') {
          var a = schedule(P, R, N, 'flat-principal'), b = schedule(P, R, N, 'annuity');
          out.innerHTML = html`<div class="calc-result"><div class="small">ประหยัดดอกเบี้ยด้วยแบบลดต้นลดดอก</div><div class="big">${money(b.totalInterest - a.totalInterest)} บาท</div>
            <div class="table-wrap"><table class="table"><thead><tr><th scope="col"><span class="sr-only">รายการ</span></th><th scope="col" class="r">ลดต้นลดดอก</th><th scope="col" class="r">ผ่อนคงที่</th></tr></thead><tbody>
            <tr><td>ค่างวดแรก</td><td class="r">${money(a.first)}</td><td class="r">${money(b.first)}</td></tr>
            <tr><td>ค่างวดสุดท้าย</td><td class="r">${money(a.last)}</td><td class="r">${money(b.last)}</td></tr>
            <tr><td>ดอกเบี้ยรวม</td><td class="r">${money(a.totalInterest)}</td><td class="r">${money(b.totalInterest)}</td></tr>
            <tr><td>ยอดชำระรวม</td><td class="r">${money(a.total)}</td><td class="r">${money(b.total)}</td></tr></tbody></table></div></div>`.__raw;
          tbl.innerHTML = '';
          return;
        }
        var s = schedule(P, R, N, m);
        out.innerHTML = html`<div class="calc-result">
          <div class="small">${m === 'annuity' ? 'ค่างวดต่อเดือน (เท่ากันทุกงวด)' : 'ค่างวดเดือนแรก (ลดลงทุกเดือน)'}</div>
          <div class="big">${money(s.first)} บาท</div>
          <dl><dt>เงินต้น</dt><dd>${money(P)}</dd><dt>ค่างวดสุดท้าย</dt><dd>${money(s.last)}</dd><dt>ดอกเบี้ยรวม</dt><dd>${money(s.totalInterest)}</dd><dt>ยอดชำระรวม</dt><dd>${money(s.total)}</dd><dt>จำนวนงวด</dt><dd>${N} งวด</dd></dl>
          <p style="margin:14px 0 0"><a class="btn btn--white btn--sm" href="#calcTable" id="toTable">ดูตารางผ่อนชำระ</a></p></div>`.__raw;
        tbl.innerHTML = html`<div class="section-head" style="margin-top:32px"><h2 style="margin:0">ตารางผ่อนชำระ (${N} งวด)</h2><button type="button" class="btn btn--outline btn--sm no-print" id="printSch">${icon('i-print')} พิมพ์ตาราง</button></div>
          <div class="table-wrap table-wrap--scroll"><table class="table table--sched"><thead><tr><th scope="col">งวดที่</th><th scope="col" class="r col-detail">เงินต้น</th><th scope="col" class="r col-detail">ดอกเบี้ย</th><th scope="col" class="r">ค่างวด</th><th scope="col" class="r">คงเหลือ</th></tr></thead>
          <tbody>${s.rows.map(function (r) { return html`<tr><td class="num">${r.n}</td><td class="r col-detail">${money(r.principal)}</td><td class="r col-detail">${money(r.interest)}</td><td class="r"><strong>${money(r.payment)}</strong></td><td class="r">${money(r.balance)}</td></tr>`; })}</tbody>
          <tfoot><tr><td>รวม</td><td class="r col-detail">${money(P)}</td><td class="r col-detail">${money(s.totalInterest)}</td><td class="r">${money(s.total)}</td><td></td></tr></tfoot></table></div>`.__raw;
        tbl.querySelector('#printSch').addEventListener('click', function () { window.print(); });
        out.querySelector('#toTable').addEventListener('click', function (ev) { ev.preventDefault(); tbl.scrollIntoView({ behavior: 'smooth' }); });
      } catch (err) {
        out.innerHTML = html`<div class="alert alert--danger" role="alert">คำนวณไม่สำเร็จ: ${err.message}</div>`.__raw;
      }
    });
    form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit'));
  }

  /* =========================================================
     สวัสดิการ
     ========================================================= */
  route('/welfare', function () {
    return { title: 'สวัสดิการสมาชิก', html: html`${pageHero('สวัสดิการสมาชิก', 'ดูแลสมาชิกและครอบครัวตั้งแต่แรกเข้าจนถึงวัยเกษียณ', [{ label: 'บริการ' }])}
      <section class="section"><div class="container">
        <div class="grid grid-2">${D.WELFARE.map(function (w) {
          return html`<article class="card"><div class="card__body"><div style="display:flex;gap:12px;align-items:flex-start"><span class="quick__icon">${icon(w.icon)}</span>
            <div style="flex:1"><h3 style="margin:0">${w.title}</h3><div class="amount" style="color:var(--link);margin:2px 0 10px">${w.amount}</div>
            <ul class="feature-list small">${w.cond.map(function (c) { return html`<li>${c}</li>`; })}</ul></div></div></div></article>`;
        })}</div>
      </div></section>
      <section class="section section--alt"><div class="container split">
        <div><h2>ขั้นตอนการขอรับสวัสดิการ</h2><ol class="steps">
          <li><strong>ดาวน์โหลดแบบคำขอ</strong><br><span class="muted">จากหน้าดาวน์โหลด หมวดแบบฟอร์มสวัสดิการ</span></li>
          <li><strong>แนบเอกสารประกอบ</strong><br><span class="muted">ตามเงื่อนไขของสวัสดิการแต่ละประเภท</span></li>
          <li><strong>ยื่นที่สำนักงานหรือผู้ประสานงาน</strong><br><span class="muted">ภายในระยะเวลาที่กำหนด</span></li>
          <li><strong>รับเงินเข้าบัญชีเงินฝาก</strong><br><span class="muted">ภายใน 15 วันทำการหลังอนุมัติ</span></li></ol></div>
        <div class="card"><div class="card__body"><h3>แบบคำขอสวัสดิการ</h3><p class="muted">ดาวน์โหลดแบบคำขอและระเบียบว่าด้วยสวัสดิการสมาชิกฉบับล่าสุด</p><a class="btn btn--primary" href="#/downloads">${icon('i-download')} ไปหน้าดาวน์โหลด</a></div></div>
      </div></section>` };
  });

  /* =========================================================
     ดาวน์โหลด
     ========================================================= */
  var dlState = { q: '', cat: 'all' };
  route('/downloads', function () {
    return { title: 'ดาวน์โหลด', html: html`${pageHero('ดาวน์โหลด', 'แบบฟอร์ม ระเบียบ และข้อบังคับของสหกรณ์ฯ')}
      <section class="section"><div class="container">
        <div class="toolbar">
          <div class="search"><label class="sr-only" for="dlQ">ค้นหาเอกสาร</label>${icon('i-search')}<input id="dlQ" class="input" type="search" placeholder="ค้นหาชื่อเอกสาร…" value="${dlState.q}" autocomplete="off"></div>
          <div class="chips" role="group" aria-label="หมวดเอกสาร"><button type="button" class="chip" data-cat="all" aria-pressed="${dlState.cat === 'all'}">ทั้งหมด</button>${D.DOWNLOAD_CATS.map(function (c) { return html`<button type="button" class="chip" data-cat="${c}" aria-pressed="${dlState.cat === c}">${c}</button>`; })}</div>
        </div>
        <p class="small muted" id="dlCount" aria-live="polite"></p>
        <div id="dlList"></div>
      </div></section>`, after: function (root) {
      var list = root.querySelector('#dlList');
      function draw() {
        var q = dlState.q.trim().toLowerCase();
        var items = Store.get('DOWNLOADS').filter(function (f) { return (dlState.cat === 'all' || f.cat === dlState.cat) && (!q || f.name.toLowerCase().indexOf(q) !== -1); });
        root.querySelector('#dlCount').textContent = 'พบ ' + items.length + ' ไฟล์';
        if (!items.length) { list.innerHTML = html`<div class="empty">${icon('i-file')}<p>ไม่พบเอกสาร</p></div>`.__raw; return; }
        var groups = {};
        items.forEach(function (f) { (groups[f.cat] = groups[f.cat] || []).push(f); });
        list.innerHTML = html`${Object.keys(groups).map(function (g) {
          return html`<h2 style="font-size:1.1rem;margin:20px 0 10px">${g} <span class="badge badge--muted">${groups[g].length}</span></h2>
            <div class="grid grid-2">${groups[g].map(function (f) { return html`<a class="attach" href="${safeUrl(f.file)}" download><span class="attach__icon">PDF</span><span style="flex:1;min-width:0"><strong>${f.name}</strong><br><span class="small muted">${f.size} · ปรับปรุง ${fmtDate(f.updated)}</span></span>${icon('i-download')}</a>`; })}</div>`;
        })}`.__raw;
      }
      var t;
      root.querySelector('#dlQ').addEventListener('input', function (e) { clearTimeout(t); t = setTimeout(function () { dlState.q = e.target.value; draw(); }, 150); });
      root.querySelector('.chips').addEventListener('click', function (e) { var c = e.target.closest('.chip'); if (!c) return; dlState.cat = c.dataset.cat; root.querySelectorAll('.chip').forEach(function (x) { x.setAttribute('aria-pressed', String(x === c)); }); draw(); });
      draw();
    } };
  });

  /* =========================================================
     เปิดเผยข้อมูล + กราฟ (SVG ไม่พึ่งไลบรารี)
     ========================================================= */
  function barChart(data, key, opts) {
    opts = opts || {};
    var W = 560, H = 260, pad = { l: 76, r: 12, t: 24, b: 32 };
    var max = Math.max.apply(null, data.map(function (d) { return d[key]; }));
    var nice = Math.pow(10, Math.floor(Math.log10(max))); max = Math.ceil(max / nice) * nice;
    var bw = (W - pad.l - pad.r) / data.length;
    var y = function (v) { return pad.t + (H - pad.t - pad.b) * (1 - v / max); };
    var s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(opts.label) + '">';
    for (var g = 0; g <= 4; g++) { var gv = max * g / 4, gy = y(gv); s += '<line class="grid-line" x1="' + pad.l + '" x2="' + (W - pad.r) + '" y1="' + gy + '" y2="' + gy + '"/><text x="' + (pad.l - 8) + '" y="' + (gy + 4) + '" text-anchor="end">' + esc(num(gv)) + '</text>'; }
    data.forEach(function (d, i) {
      var x = pad.l + i * bw + bw * 0.2, w = bw * 0.6, top = y(d[key]);
      s += '<rect class="bar' + (i === data.length - 1 ? ' bar--alt' : '') + '" x="' + x + '" y="' + top + '" width="' + w + '" height="' + (H - pad.b - top) + '" rx="5"/>';
      s += '<text class="val" x="' + (x + w / 2) + '" y="' + (top - 6) + '" text-anchor="middle">' + esc(opts.fmt ? opts.fmt(d[key]) : num(d[key])) + '</text>';
      s += '<text x="' + (x + w / 2) + '" y="' + (H - 10) + '" text-anchor="middle">' + esc(d.year) + '</text>';
    });
    return raw(s + '</svg>');
  }
  function lineChart(data, keys, opts) {
    var W = 560, H = 260, pad = { l: 44, r: 16, t: 24, b: 32 };
    var all = []; keys.forEach(function (k) { data.forEach(function (d) { all.push(d[k]); }); });
    var max = Math.ceil((Math.max.apply(null, all) + 1) / 4) * 4, min = 0; // ลงตัวทีละ 4 ช่อง
    var step = (W - pad.l - pad.r) / data.length;
    var x0 = pad.l + step / 2;
    var y = function (v) { return pad.t + (H - pad.t - pad.b) * (1 - (v - min) / (max - min)); };
    var s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(opts.label) + '">';
    for (var g = 0; g <= 4; g++) { var gv = min + (max - min) * g / 4, gy = y(gv); s += '<line class="grid-line" x1="' + pad.l + '" x2="' + (W - pad.r) + '" y1="' + gy + '" y2="' + gy + '"/><text x="' + (pad.l - 8) + '" y="' + (gy + 4) + '" text-anchor="end">' + gv.toFixed(0) + '%</text>'; }
    keys.forEach(function (k, ki) {
      var pts = data.map(function (d, i) { return (x0 + i * step) + ',' + y(d[k]); }).join(' ');
      s += '<polyline class="line" points="' + pts + '"' + (ki ? ' style="stroke:var(--brand-600)"' : '') + '/>';
      data.forEach(function (d, i) {
        s += '<circle class="dot" cx="' + (x0 + i * step) + '" cy="' + y(d[k]) + '" r="5"' + (ki ? ' style="stroke:var(--brand-600)"' : '') + '/>';
        s += '<text class="val" x="' + (x0 + i * step) + '" y="' + (y(d[k]) - 10) + '" text-anchor="middle">' + d[k].toFixed(2) + '</text>';
      });
    });
    data.forEach(function (d, i) { s += '<text x="' + (x0 + i * step) + '" y="' + (H - 10) + '" text-anchor="middle">' + esc(d.year) + '</text>'; });
    return raw(s + '</svg>');
  }
  function dataTable(caption, cols, rows) {
    return html`<details class="small" style="margin-top:8px"><summary style="cursor:pointer;color:var(--link)">ดูข้อมูลเป็นตาราง</summary>
      <div class="table-wrap" style="margin-top:8px"><table class="table"><caption class="sr-only">${caption}</caption><thead><tr>${cols.map(function (c, i) { return html`<th scope="col" class="${i ? 'r' : ''}">${c}</th>`; })}</tr></thead>
      <tbody>${rows.map(function (r) { return html`<tr>${r.map(function (v, i) { return i ? html`<td class="r">${v}</td>` : html`<th scope="row">${v}</th>`; })}</tr>`; })}</tbody></table></div></details>`;
  }
  route('/disclosure', function () {
    var F = D.FINANCIALS, last = F[F.length - 1], prev = F[F.length - 2];
    function delta(a, b) { var d = (a - b) / b * 100; return (d >= 0 ? '▲ ' : '▼ ') + Math.abs(d).toFixed(1) + '% จากปีก่อน'; }
    return { title: 'เปิดเผยข้อมูล', html: html`${pageHero('เปิดเผยข้อมูล', 'งบการเงิน รายงานประจำปี และผลการดำเนินงานย้อนหลัง เพื่อความโปร่งใสต่อสมาชิก')}
      <section class="section"><div class="container">
        <div class="section-head"><div><span class="eyebrow">สรุปผลการดำเนินงาน</span><h2>ปีบัญชี ${last.year}</h2></div><span class="badge">ข้อมูลผ่านการตรวจสอบโดยผู้สอบบัญชี</span></div>
        <div class="kpis">
          <div class="card kpi"><div class="kpi__label">${icon('i-bank')} สินทรัพย์รวม</div><div class="kpi__value">${num(last.assets)} <small class="small muted">ล้านบาท</small></div><div class="kpi__sub">${delta(last.assets, prev.assets)}</div></div>
          <div class="card kpi"><div class="kpi__label">${icon('i-chart')} กำไรสุทธิ</div><div class="kpi__value">${last.profit.toFixed(1)} <small class="small muted">ล้านบาท</small></div><div class="kpi__sub">${delta(last.profit, prev.profit)}</div></div>
          <div class="card kpi"><div class="kpi__label">${icon('i-users')} จำนวนสมาชิก</div><div class="kpi__value">${num(last.members)} <small class="small muted">ราย</small></div><div class="kpi__sub">${delta(last.members, prev.members)}</div></div>
          <div class="card kpi"><div class="kpi__label">${icon('i-coins')} ปันผล / เฉลี่ยคืน</div><div class="kpi__value">${last.dividend.toFixed(2)}% / ${last.refund}%</div><div class="kpi__sub">อนุมัติโดยที่ประชุมใหญ่</div></div>
        </div>
      </div></section>
      <section class="section section--alt"><div class="container grid grid-2">
        <div class="card"><div class="card__body"><h3>สินทรัพย์รวม (ล้านบาท)</h3>${barChart(F, 'assets', { label: 'กราฟแท่งสินทรัพย์รวมปี 2564 ถึง 2568' })}
          ${dataTable('สินทรัพย์รวม', ['ปี', 'ล้านบาท'], F.map(function (d) { return [d.year, num(d.assets)]; }))}</div></div>
        <div class="card"><div class="card__body"><h3>กำไรสุทธิ (ล้านบาท)</h3>${barChart(F, 'profit', { label: 'กราฟแท่งกำไรสุทธิปี 2564 ถึง 2568', fmt: function (v) { return v.toFixed(1); } })}
          ${dataTable('กำไรสุทธิ', ['ปี', 'ล้านบาท'], F.map(function (d) { return [d.year, d.profit.toFixed(1)]; }))}</div></div>
        <div class="card"><div class="card__body"><h3>จำนวนสมาชิก (ราย)</h3>${barChart(F, 'members', { label: 'กราฟแท่งจำนวนสมาชิกปี 2564 ถึง 2568' })}
          ${dataTable('จำนวนสมาชิก', ['ปี', 'ราย'], F.map(function (d) { return [d.year, num(d.members)]; }))}</div></div>
        <div class="card"><div class="card__body"><h3>อัตราปันผลและเฉลี่ยคืน (%)</h3><div class="legend"><span class="alt">ปันผล</span><span>เฉลี่ยคืน</span></div>${lineChart(F, ['dividend', 'refund'], { label: 'กราฟเส้นอัตราเงินปันผลและเฉลี่ยคืน' })}
          ${dataTable('อัตราปันผลและเฉลี่ยคืน', ['ปี', 'ปันผล %', 'เฉลี่ยคืน %'], F.map(function (d) { return [d.year, d.dividend.toFixed(2), d.refund.toFixed(2)]; }))}</div></div>
      </div></section>
      <section class="section"><div class="container">
        <div class="section-head"><h2 style="margin:0">งบการเงินและรายงานประจำปี</h2></div>
        <div class="grid grid-2">${D.REPORTS.map(function (r) { return html`<a class="attach" href="${safeUrl(r.file)}" target="_blank" rel="noopener"><span class="attach__icon">PDF</span><span style="flex:1"><strong>${r.name}</strong><br><span class="small muted">${r.type} · ${r.size}</span></span>${icon('i-download')}</a>`; })}</div>
      </div></section>` };
  });

  /* =========================================================
     ติดต่อเรา + ฟอร์มร้องเรียน
     ========================================================= */
  route('/contact', function () {
    var S = D.SITE;
    return { title: 'ติดต่อเรา', html: html`${pageHero('ติดต่อเรา', 'สอบถาม ร้องเรียน หรือเสนอแนะ เรายินดีรับฟังทุกความคิดเห็น')}
      <section class="section"><div class="container split">
        <div class="stack">
          <div class="card"><div class="card__body">
            <h2 style="font-size:1.25rem">${S.name}</h2>
            <ul class="feature-list contact-list">
              <li><span><strong>ที่อยู่</strong><br>${S.address}</span></li>
              <li><span><strong>โทรศัพท์</strong><br><a href="tel:${S.phoneTel}">${S.phone}</a> · โทรสาร ${S.fax}</span></li>
              <li><span><strong>อีเมล</strong><br><a href="mailto:${S.email}">${S.email}</a></span></li>
              <li><span><strong>LINE Official Account</strong><br>${S.line}</span></li>
            </ul></div></div>
          <div class="card"><div class="card__body"><h3>เวลาทำการ</h3><dl class="dl">${S.hours.map(function (h) { return html`<dt>${h[0]}</dt><dd>${h[1]}</dd>`; })}</dl></div></div>
          <iframe class="map-frame" title="แผนที่ตั้งสหกรณ์" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="https://www.google.com/maps?q=${encodeURIComponent(S.mapQuery)}&output=embed"></iframe>
          <div class="card"><div class="card__body map-fallback"><span class="small muted">${icon('i-map')} แผนที่ไม่แสดง? เปิดในแอปแผนที่ได้โดยตรง</span><a class="btn btn--outline btn--sm" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(S.mapQuery)}" target="_blank" rel="noopener">เปิดใน Google Maps</a></div></div>
        </div>
        <form class="card" id="complaintForm" novalidate><div class="card__body form-grid">
          <div><h2 style="font-size:1.25rem;margin-bottom:4px">ร้องเรียน / เสนอแนะ</h2><p class="small muted" style="margin:0">ข้อมูลของท่านจะถูกเก็บเป็นความลับ และใช้เพื่อการติดต่อกลับเท่านั้น</p></div>
          <div class="field"><label for="cfType">ประเภทเรื่อง <span class="req">*</span></label>
            <select id="cfType" class="select" required><option value="">— เลือกประเภท —</option><option>ร้องเรียนการให้บริการ</option><option>เสนอแนะ / ติชม</option><option>สอบถามข้อมูล</option><option>แจ้งเบาะแสการทุจริต</option></select>
            <span class="error-msg">กรุณาเลือกประเภทเรื่อง</span></div>
          <div class="form-grid form-grid--2">
            <div class="field"><label for="cfName">ชื่อ – นามสกุล <span class="req">*</span></label><input id="cfName" class="input" required maxlength="100" autocomplete="name"><span class="error-msg">กรุณากรอกชื่อ</span></div>
            <div class="field"><label for="cfPhone">เบอร์โทรศัพท์ <span class="req">*</span></label><input id="cfPhone" class="input" type="tel" required pattern="0[0-9]{8,9}" inputmode="tel" autocomplete="tel" placeholder="เช่น 0812345678"><span class="error-msg">เบอร์โทร 9–10 หลัก ขึ้นต้นด้วย 0</span></div>
          </div>
          <div class="field"><label for="cfEmail">อีเมล (ถ้ามี)</label><input id="cfEmail" class="input" type="email" autocomplete="email" maxlength="120"><span class="error-msg">รูปแบบอีเมลไม่ถูกต้อง</span></div>
          <div class="field"><label for="cfMsg">รายละเอียด <span class="req">*</span></label><textarea id="cfMsg" class="textarea" required minlength="10" maxlength="2000"></textarea><span class="hint"><span id="cfCount">0</span>/2000 ตัวอักษร</span><span class="error-msg">กรุณากรอกรายละเอียดอย่างน้อย 10 ตัวอักษร</span></div>
          <div class="hp" aria-hidden="true"><label for="cfWeb">เว็บไซต์</label><input id="cfWeb" tabindex="-1" autocomplete="off"></div>
          <div class="field"><label class="check"><input type="checkbox" id="cfConsent" required><span>ข้าพเจ้ายินยอมให้สหกรณ์ฯ เก็บและใช้ข้อมูลข้างต้นเพื่อดำเนินการตามคำร้อง ตาม<a href="#/privacy">นโยบายความเป็นส่วนตัว</a></span></label><span class="error-msg">กรุณายืนยันความยินยอม</span></div>
          <button class="btn btn--primary btn--lg" type="submit">ส่งเรื่อง</button>
          <div id="cfResult" aria-live="polite"></div>
        </div></form>
      </div></section>`, after: function (root) {
      var f = root.querySelector('#complaintForm');
      var msg = root.querySelector('#cfMsg');
      msg.addEventListener('input', function () { root.querySelector('#cfCount').textContent = msg.value.length; msg.setCustomValidity(''); });
      root.querySelector('#cfName').addEventListener('input', function (e) { e.target.setCustomValidity(''); });
      f.addEventListener('submit', function (e) {
        e.preventDefault();
        if (root.querySelector('#cfWeb').value) return; // honeypot: บอท
        var nm = root.querySelector('#cfName');
        nm.setCustomValidity(nm.value.trim() ? '' : 'กรุณากรอกชื่อ');
        msg.setCustomValidity(msg.value.trim().length >= 10 ? '' : 'กรุณากรอกรายละเอียดอย่างน้อย 10 ตัวอักษร');
        if (!f.checkValidity()) { f.reportValidity(); return; }
        var last = SS.get('coop.cf.last', 0);
        if (Date.now() - last < 30000) { toast('กรุณารอสักครู่ก่อนส่งเรื่องใหม่', 'error'); return; }
        var ref = 'CF' + new Date().toISOString().slice(2, 10).replace(/-/g, '') + '-' + Math.floor(1000 + Math.random() * 9000);
        var list = Store.get('COMPLAINTS').slice(0, 199);
        list.unshift({ ref: ref, at: new Date().toISOString(), type: root.querySelector('#cfType').value, name: root.querySelector('#cfName').value.trim(), phone: root.querySelector('#cfPhone').value.trim(), email: root.querySelector('#cfEmail').value.trim(), msg: msg.value.trim(), status: 'ใหม่' });
        Store.set('COMPLAINTS', list);
        SS.set('coop.cf.last', Date.now());
        f.reset(); root.querySelector('#cfCount').textContent = '0';
        root.querySelector('#cfResult').innerHTML = html`<div class="alert alert--success" role="status">ได้รับเรื่องของท่านแล้ว เลขที่อ้างอิง <strong>${ref}</strong> เจ้าหน้าที่จะติดต่อกลับภายใน 3 วันทำการ</div>`.__raw;
        toast('ส่งเรื่องเรียบร้อย เลขที่ ' + ref, 'success');
      });
    } };
  });

  /* =========================================================
     FAQ
     ========================================================= */
  route('/faq', function () {
    return { title: 'คำถามที่พบบ่อย', html: html`${pageHero('คำถามที่พบบ่อย (FAQ)', 'รวมคำตอบสำหรับคำถามที่สมาชิกสอบถามบ่อย')}
      <section class="section"><div class="container" style="max-width:860px">
        <div class="search" style="margin-bottom:16px"><label class="sr-only" for="faqQ">ค้นหาคำถาม</label>${icon('i-search')}<input id="faqQ" class="input" type="search" placeholder="พิมพ์คำที่ต้องการค้นหา เช่น เงินกู้ รหัสผ่าน" autocomplete="off"></div>
        <div class="accordion" id="faqList">${Store.get('FAQ').map(function (f) { return html`<details><summary>${f.q}${icon('i-chev')}</summary><div class="acc-body"><p style="margin:0">${f.a}</p></div></details>`; })}</div>
        <p class="empty" id="faqEmpty" hidden>ไม่พบคำถามที่ค้นหา — <a href="#/contact">ส่งคำถามถึงเจ้าหน้าที่</a></p>
        <div class="alert alert--info" style="margin-top:24px">ไม่พบคำตอบที่ต้องการ? โทร ${D.SITE.phone} หรือ <a href="#/contact">ส่งข้อความถึงเรา</a></div>
      </div></section>`, after: function (root) {
      var items = root.querySelectorAll('#faqList details');
      root.querySelector('#faqQ').addEventListener('input', function (e) {
        var q = e.target.value.trim().toLowerCase(), shown = 0;
        items.forEach(function (d) { var m = !q || d.textContent.toLowerCase().indexOf(q) !== -1; d.hidden = !m; if (m) shown++; if (q && m) d.open = true; });
        root.querySelector('#faqEmpty').hidden = shown > 0;
      });
    } };
  });

  /* =========================================================
     นโยบายความเป็นส่วนตัว (PDPA)
     ========================================================= */
  route('/privacy', function () {
    var S = D.SITE;
    var sec = [
      ['ข้อมูลที่เราเก็บรวบรวม', ['ข้อมูลระบุตัวตน เช่น ชื่อ-นามสกุล เลขประจำตัวประชาชน เลขทะเบียนสมาชิก', 'ข้อมูลการติดต่อ เช่น ที่อยู่ เบอร์โทรศัพท์ อีเมล', 'ข้อมูลทางการเงิน เช่น ทุนเรือนหุ้น เงินฝาก เงินกู้ ภาระค้ำประกัน', 'ข้อมูลการใช้งานเว็บไซต์ เช่น บันทึกการเข้าสู่ระบบ (log) ที่อยู่ IP คุกกี้']],
      ['วัตถุประสงค์การใช้ข้อมูล', ['ให้บริการตามข้อบังคับและระเบียบของสหกรณ์ฯ (ฐานสัญญา)', 'ปฏิบัติตามกฎหมาย เช่น พ.ร.บ.สหกรณ์ และกฎหมายป้องกันการฟอกเงิน (ฐานกฎหมาย)', 'รักษาความปลอดภัยของระบบและป้องกันการทุจริต (ฐานประโยชน์โดยชอบด้วยกฎหมาย)', 'ส่งข่าวสารและสิทธิประโยชน์ (เมื่อได้รับความยินยอม)']],
      ['การเปิดเผยข้อมูล', ['สหกรณ์ฯ ไม่ขายหรือให้เช่าข้อมูลส่วนบุคคล', 'เปิดเผยแก่หน่วยงานรัฐเมื่อกฎหมายกำหนด เช่น กรมส่งเสริมสหกรณ์ กรมตรวจบัญชีสหกรณ์', 'ผู้ให้บริการภายนอกที่ทำสัญญารักษาความลับ เช่น ผู้ให้บริการระบบ SMS']],
      ['ระยะเวลาการเก็บรักษา', ['ตลอดระยะเวลาการเป็นสมาชิก และ 10 ปีหลังสิ้นสุดสมาชิกภาพ หรือตามที่กฎหมายกำหนด', 'บันทึกการเข้าใช้งานระบบเก็บไม่น้อยกว่า 90 วัน ตาม พ.ร.บ.คอมพิวเตอร์']],
      ['สิทธิของเจ้าของข้อมูล', ['ขอเข้าถึงและขอรับสำเนาข้อมูล', 'ขอแก้ไขข้อมูลให้ถูกต้อง', 'ขอลบหรือระงับการใช้ข้อมูล (ภายใต้ข้อยกเว้นตามกฎหมาย)', 'คัดค้านการประมวลผล และถอนความยินยอมได้ทุกเมื่อ', 'ร้องเรียนต่อสำนักงานคณะกรรมการคุ้มครองข้อมูลส่วนบุคคล']],
      ['คุกกี้', ['คุกกี้ที่จำเป็น: ใช้สำหรับการเข้าสู่ระบบและความปลอดภัย', 'คุกกี้การตั้งค่า: จดจำขนาดตัวอักษรและโหมดมืด (เมื่อยินยอม)', 'คุกกี้วิเคราะห์: สถิติการเข้าชมแบบไม่ระบุตัวตน (เมื่อยินยอม)', 'ท่านเปลี่ยนการตั้งค่าคุกกี้ได้ทุกเมื่อที่ลิงก์ “ตั้งค่าคุกกี้” ท้ายเว็บไซต์']],
      ['มาตรการรักษาความปลอดภัย', ['เชื่อมต่อผ่าน HTTPS เข้ารหัสทุกหน้า', 'เข้ารหัสรหัสผ่านแบบทางเดียว (argon2id/bcrypt) ไม่มีผู้ใดทราบรหัสผ่านของท่าน', 'จำกัดจำนวนครั้งการเข้าสู่ระบบผิด และออกจากระบบอัตโนมัติเมื่อไม่ใช้งาน 15 นาที', 'แสดงข้อมูลอ่อนไหวแบบปิดบังบางส่วน และไม่ส่งข้อมูลส่วนบุคคลผ่าน URL']]
    ];
    return { title: 'นโยบายความเป็นส่วนตัว', html: html`${pageHero('นโยบายความเป็นส่วนตัว', 'ตามพระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 (PDPA)')}
      <section class="section"><div class="container article">
        <p class="lead">${S.name} (“สหกรณ์ฯ”) ให้ความสำคัญกับการคุ้มครองข้อมูลส่วนบุคคลของสมาชิกและผู้ใช้บริการ นโยบายนี้อธิบายวิธีการเก็บ ใช้ และเปิดเผยข้อมูลของท่าน</p>
        ${sec.map(function (s, i) { return html`<h2 style="font-size:1.2rem;margin-top:28px">${i + 1}. ${s[0]}</h2><ul class="feature-list">${s[1].map(function (x) { return html`<li>${x}</li>`; })}</ul>`; })}
        <h2 style="font-size:1.2rem;margin-top:28px">${sec.length + 1}. ติดต่อเจ้าหน้าที่คุ้มครองข้อมูลส่วนบุคคล (DPO)</h2>
        <p>${S.address}<br>โทร ${S.phone} · อีเมล dpo@coop-demo.example</p>
        <p class="small muted">ปรับปรุงล่าสุด ${fmtDate('2026-10-01', 'long')}</p>
        <p><button type="button" class="btn btn--outline" id="openCookie">ตั้งค่าคุกกี้</button></p>
      </div></section>`, after: function (root) { root.querySelector('#openCookie').addEventListener('click', openCookieSettings); } };
  });

  /* =========================================================
     ผังเว็บไซต์
     ========================================================= */
  route('/sitemap', function () {
    return { title: 'ผังเว็บไซต์', html: html`${pageHero('ผังเว็บไซต์', 'โครงสร้างเมนูทั้งหมดของเว็บไซต์')}
      <section class="section"><div class="container grid grid-2">
        <div class="card"><div class="card__body sitemap-tree"><h2 style="font-size:1.2rem">ส่วนสาธารณะ</h2><ul>${NAV.map(function (n) {
          return html`<li>${n.href ? html`<a href="${n.href}">${n.label}</a>` : html`<strong>${n.label}</strong>`}${n.children ? html`<ul>${n.children.map(function (c) { return html`<li><a href="${c.href}">${c.label}</a></li>`; })}</ul>` : ''}</li>`;
        })}<li><a href="#/sitemap">ผังเว็บไซต์</a></li></ul></div></div>
        <div class="stack">
          <div class="card"><div class="card__body sitemap-tree"><h2 style="font-size:1.2rem">ระบบสมาชิก (ต้องเข้าสู่ระบบ)</h2><ul><li><a href="#/member">เข้าสู่ระบบ (เลขทะเบียน + รหัสผ่าน + OTP)</a><ul>
            <li>ภาพรวม</li><li>ทุนเรือนหุ้น</li><li>เงินฝาก + รายการเคลื่อนไหว</li><li>เงินกู้ + ตารางผ่อนชำระ</li><li>ภาระค้ำประกัน</li><li>ใบเสร็จรับเงินรายเดือน</li><li>ปันผล / เฉลี่ยคืน</li><li>ผู้รับผลประโยชน์</li><li>เปลี่ยนรหัสผ่าน</li></ul></li></ul></div></div>
          <div class="card"><div class="card__body sitemap-tree"><h2 style="font-size:1.2rem">ระบบผู้ดูแล (เจ้าหน้าที่)</h2><ul><li><a href="#/admin">เข้าสู่ระบบผู้ดูแล</a><ul>
            <li>แดชบอร์ด</li><li>ข่าว/ประกาศ</li><li>แบนเนอร์</li><li>อัตราดอกเบี้ย</li><li>ไฟล์ดาวน์โหลด</li><li>คณะกรรมการ</li><li>FAQ</li><li>เรื่องร้องเรียน</li><li>นำเข้าข้อมูลสมาชิก</li><li>ผู้ใช้และสิทธิ์</li><li>Audit log</li></ul></li></ul></div></div>
        </div>
      </div></section>` };
  });

  /* =========================================================
     Cookie consent (PDPA)
     ========================================================= */
  var CONSENT_KEY = 'coop.consent';
  function getConsent() { return LS.get(CONSENT_KEY, null); }
  function saveConsent(c) {
    c.at = new Date().toISOString(); c.v = 1;
    LS.set(CONSENT_KEY, c);
    document.getElementById('cookieBanner').hidden = true;
    // ถ้าไม่ยินยอมคุกกี้การตั้งค่า ย้ายค่าที่จำไว้ไปเก็บแค่รอบนี้
    try {
      ['coop.theme', 'coop.font'].forEach(function (k) {
        var v = localStorage.getItem(k) || sessionStorage.getItem(k);
        if (v === null) return;
        if (c.preference) { localStorage.setItem(k, v); sessionStorage.removeItem(k); } else { sessionStorage.setItem(k, v); localStorage.removeItem(k); }
      });
    } catch (e) { /* ignore */ }
  }
  function prefSet(k, v) {
    var c = getConsent();
    try { if (c && c.preference) localStorage.setItem(k, v); else sessionStorage.setItem(k, v); } catch (e) { /* ignore */ }
  }
  function openCookieSettings() {
    var dlg = document.getElementById('cookieDialog');
    var c = getConsent() || {};
    dlg.querySelector('[name="preference"]').checked = !!c.preference;
    dlg.querySelector('[name="analytics"]').checked = !!c.analytics;
    dlg.showModal();
  }
  function initConsent() {
    var banner = document.getElementById('cookieBanner');
    if (!getConsent()) banner.hidden = false;
    banner.addEventListener('click', function (e) {
      var b = e.target.closest('[data-cookie]'); if (!b) return;
      var a = b.dataset.cookie;
      if (a === 'all') saveConsent({ necessary: true, preference: true, analytics: true });
      else if (a === 'necessary') saveConsent({ necessary: true, preference: false, analytics: false });
      else openCookieSettings();
    });
    var dlg = document.getElementById('cookieDialog');
    lightDismiss(dlg);
    dlg.addEventListener('close', function () {
      if (dlg.returnValue !== 'save') return;
      saveConsent({ necessary: true, preference: dlg.querySelector('[name="preference"]').checked, analytics: dlg.querySelector('[name="analytics"]').checked });
      toast('บันทึกการตั้งค่าคุกกี้แล้ว', 'success');
    });
    document.getElementById('cookieSettingsLink').addEventListener('click', openCookieSettings);
  }

  /* ---------------- Theme & font size ---------------- */
  function initPrefs() {
    var root = document.documentElement;
    document.getElementById('themeToggle').addEventListener('click', function () {
      var cur = root.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      var next = cur === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      prefSet('coop.theme', next);
    });
    var fs = document.querySelector('.fontsize');
    function syncFont() { var f = root.getAttribute('data-font') || '0'; fs.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', String((b.dataset.font === '0' && f === '0') || (b.dataset.font !== '0' && false))); }); }
    fs.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      var cur = parseInt(root.getAttribute('data-font') || '0', 10), d = parseInt(b.dataset.font, 10);
      var next = d === 0 ? 0 : Math.max(-1, Math.min(2, cur + d));
      if (next) root.setAttribute('data-font', String(next)); else root.removeAttribute('data-font');
      prefSet('coop.font', String(next));
      syncFont();
    });
    syncFont();
  }

  function initSiteText() {
    document.querySelectorAll('[data-site]').forEach(function (el) { el.textContent = D.SITE[el.dataset.site]; });
    document.getElementById('year').textContent = new Date().getFullYear() + 543;
    document.getElementById('footerAddress').innerHTML = html`${D.SITE.address}<br>โทร <a href="tel:${D.SITE.phoneTel}">${D.SITE.phone}</a> · LINE ${D.SITE.line}<br>อีเมล <a href="mailto:${D.SITE.email}">${D.SITE.email}</a><br>${D.SITE.hours[0][0]} ${D.SITE.hours[0][1]}`.__raw;
  }

  /* ---------------- Public API สำหรับ member.js / admin.js ---------------- */
  window.Coop = {
    D: D, html: html, raw: raw, esc: esc, icon: icon, safeUrl: safeUrl,
    money: money, num: num, pct: pct, fmtDate: fmtDate, parseISO: parseISO, toISO: toISO,
    maskId: maskId, maskAcct: maskAcct, maskPhone: maskPhone, maskEmail: maskEmail,
    LS: LS, SS: SS, Store: Store, audit: audit, toast: toast, openModal: openModal, confirmBox: confirmBox, lightDismiss: lightDismiss,
    route: route, go: go, render: render, onCleanup: onCleanup, pageHero: pageHero, schedule: schedule, round2: round2,
    newsCategories: D.CATEGORIES, parseAmount: parseAmount
  };

  /* aria-invalid ให้ตรงกับ :user-invalid (สำหรับ screen reader) */
  function syncAria(el) { if (el && el.matches && el.matches('input, select, textarea')) { try { el.setAttribute('aria-invalid', el.matches(':user-invalid') ? 'true' : 'false'); } catch (e) { /* old browser */ } } }
  document.addEventListener('blur', function (e) { syncAria(e.target); }, true);
  document.addEventListener('input', function (e) { if (e.target.hasAttribute && e.target.hasAttribute('aria-invalid')) syncAria(e.target); });

  window.addEventListener('error', function (e) { console.error(e.error || e.message); });
  window.addEventListener('unhandledrejection', function (e) { console.error(e.reason); toast('เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง', 'error'); });

  document.addEventListener('DOMContentLoaded', function () {
    initSiteText();
    buildNav();
    initConsent();
    initPrefs();
    window.addEventListener('hashchange', render);
    document.querySelector('.skip-link').addEventListener('click', function (e) { e.preventDefault(); document.getElementById('main').focus(); });
    render();
  });
})();
