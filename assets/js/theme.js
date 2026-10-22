/* โหลดก่อน render เพื่อไม่ให้หน้ากระพริบ: ใช้ธีม/ขนาดตัวอักษรที่ผู้ใช้เลือกไว้
   (localStorage เมื่อยินยอมคุกกี้การตั้งค่า, ไม่เช่นนั้นใช้ sessionStorage เฉพาะรอบนี้) */
(function () {
  function read(k) {
    try { return localStorage.getItem(k) || sessionStorage.getItem(k); } catch (e) { return null; }
  }
  var t = read('coop.theme');
  if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t);
  var f = parseInt(read('coop.font') || '0', 10);
  if (f >= -1 && f <= 2 && f !== 0) document.documentElement.setAttribute('data-font', String(f));
})();
