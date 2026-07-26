/* AmirDent admin dashboard — manage doctors & services */
(function () {
  if (!window.AmirCMS) return;

  var state = { doctors: [], services: [], content: { v: 4 } };
  var CATS = [
    ['ortho', 'Ортодонтия'],
    ['therapy', 'Терапия'],
    ['hygiene', 'Гигиена'],
    ['surgery', 'Хирургия'],
    ['implant', 'Имплантация'],
    ['prosth', 'Протезирование'],
    ['paro', 'Пародонтология'],
    ['kids', 'Детская']
  ];

  function $(id) { return document.getElementById(id); }
  function toast(msg, isErr) {
    var t = $('dashToast');
    if (!t) { alert(msg); return; }
    t.textContent = msg;
    t.classList.toggle('err', !!isErr);
    t.classList.add('show');
    clearTimeout(toast._tm);
    toast._tm = setTimeout(function () { t.classList.remove('show'); }, 3500);
  }

  function placeholderPhoto() {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><rect fill="#e8e0d4" width="100%" height="100%"/><text x="50%" y="50%" text-anchor="middle" fill="#9c7f4b" font-family="sans-serif" font-size="22">Фото</text></svg>';
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  }

  function parseFromIndex(html) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var doctors = Array.prototype.slice.call(doc.querySelectorAll('.doc-grid .doc')).map(function (el) {
      var img = el.querySelector('img');
      return {
        name: (el.querySelector('h3') && el.querySelector('h3').textContent.trim()) || '',
        role: (el.querySelector('.role') && el.querySelector('.role').textContent.trim()) || '',
        exp: (el.querySelector('.exp') && el.querySelector('.exp').textContent.trim()) || '',
        src: (img && img.getAttribute('src')) || ''
      };
    });
    var services = Array.prototype.slice.call(doc.querySelectorAll('.price-list .prow')).map(function (el) {
      return {
        name: (el.querySelector('.pn') && el.querySelector('.pn').textContent.trim()) || '',
        tag: (el.querySelector('.ptag') && el.querySelector('.ptag').textContent.trim()) || '',
        price: (el.querySelector('.pp') && el.querySelector('.pp').textContent.trim()) || '',
        cat: el.getAttribute('data-cat') || 'therapy'
      };
    });
    return { doctors: doctors, services: services };
  }

  function doctorsToHtml(list) {
    return list.map(function (d) {
      var src = d.src || placeholderPhoto();
      var name = d.name || 'Врач';
      return '<article class="doc">' +
        '<div class="doc-photo"><img src="' + escAttr(src) + '" alt="' + escAttr(name) + '"></div>' +
        '<div class="doc-body">' +
        '<div class="role">' + escHtml(d.role || '') + '</div>' +
        '<h3>' + escHtml(name) + '</h3>' +
        '<div class="exp">' + escHtml(d.exp || '') + '</div>' +
        '</div></article>';
    }).join('');
  }

  function servicesToHtml(list) {
    return list.map(function (s) {
      var name = s.name || 'Услуга';
      var tag = s.tag || '';
      var price = s.price || '0 ₽';
      var cat = s.cat || 'therapy';
      return '<div class="prow" data-cat="' + escAttr(cat) + '" data-name="' + escAttr(name.toLowerCase()) + '">' +
        '<span class="pn">' + escHtml(name) + '</span>' +
        '<span class="ptag">' + escHtml(tag) + '</span>' +
        '<span class="pp">' + escHtml(price) + '</span></div>';
    }).join('');
  }

  function escAttr(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }
  function escHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  async function loadData() {
    var file = {};
    try {
      var res = await fetch('assets/content.json?ts=' + Date.now(), { cache: 'no-store' });
      if (res.ok) file = await res.json();
    } catch (e) {}

    state.content = file && typeof file === 'object' ? file : { v: 4 };

    if (Array.isArray(file.doctors) && Array.isArray(file.services)) {
      state.doctors = file.doctors.slice();
      state.services = file.services.slice();
      return;
    }

    // Bootstrap from live index.html if arrays not saved yet
    try {
      var page = await fetch('index.html?ts=' + Date.now(), { cache: 'no-store' });
      var html = await page.text();
      var parsed = parseFromIndex(html);

      // Prefer HTML snapshots if present
      if (typeof file.docsHtml === 'string' && file.docsHtml) {
        parsed.doctors = parseFromIndex('<div class="doc-grid">' + file.docsHtml + '</div>').doctors;
      }
      if (typeof file.priceHtml === 'string' && file.priceHtml) {
        parsed.services = parseFromIndex('<div class="price-list">' + file.priceHtml + '</div>').services;
      }

      state.doctors = parsed.doctors;
      state.services = parsed.services;
    } catch (e) {
      state.doctors = [];
      state.services = [];
    }
  }

  async function saveAll() {
    var snap = Object.assign({}, state.content, {
      v: 4,
      savedAt: new Date().toISOString(),
      doctors: state.doctors,
      services: state.services,
      docsHtml: doctorsToHtml(state.doctors),
      priceHtml: servicesToHtml(state.services)
    });
    state.content = snap;
    AmirCMS.saveContent(snap);
    if (!AmirCMS.getToken()) {
      toast('Сессия истекла — войдите снова', true);
      setTimeout(function () { location.reload(); }, 800);
      return false;
    }
    try {
      await AmirCMS.publishContent(snap);
      var check = await fetch('assets/content.json?ts=' + Date.now(), { cache: 'no-store' });
      var remote = await check.json();
      if (!remote || remote.savedAt !== snap.savedAt) throw new Error('сервер вернул старые данные');
      toast('✓ Сохранено на сайт');
      return true;
    } catch (err) {
      toast('Ошибка: ' + (err && err.message ? err.message : err), true);
      return false;
    }
  }

  function renderDoctors() {
    var box = $('docList');
    if (!state.doctors.length) {
      box.innerHTML = '<p class="empty">Врачей пока нет</p>';
      return;
    }
    box.innerHTML = state.doctors.map(function (d, i) {
      return '<div class="row-item">' +
        '<div class="meta"><b></b><small></small></div>' +
        '<button type="button" class="btn danger" data-del-doc="' + i + '">Удалить</button>' +
        '</div>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('.row-item'), function (row, i) {
      var d = state.doctors[i];
      row.querySelector('b').textContent = d.name || 'Без имени';
      row.querySelector('small').textContent = [d.role, d.exp].filter(Boolean).join(' · ');
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-del-doc]'), function (btn) {
      btn.onclick = async function () {
        var i = +btn.getAttribute('data-del-doc');
        var name = (state.doctors[i] && state.doctors[i].name) || 'врача';
        if (!confirm('Удалить «' + name + '»?')) return;
        state.doctors.splice(i, 1);
        renderDoctors();
        await saveAll();
      };
    });
  }

  function renderServices(filter) {
    var box = $('svcList');
    var q = (filter || '').trim().toLowerCase();
    var items = state.services.map(function (s, i) { return { s: s, i: i }; }).filter(function (x) {
      if (!q) return true;
      return (x.s.name || '').toLowerCase().indexOf(q) >= 0 || (x.s.tag || '').toLowerCase().indexOf(q) >= 0;
    });
    if (!items.length) {
      box.innerHTML = '<p class="empty">Ничего не найдено</p>';
      return;
    }
    box.innerHTML = items.map(function (x) {
      return '<div class="row-item" data-i="' + x.i + '">' +
        '<div class="meta"><b></b><small></small></div>' +
        '<button type="button" class="btn danger" data-del-svc="' + x.i + '">Удалить</button>' +
        '</div>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('.row-item'), function (row) {
      var i = +row.getAttribute('data-i');
      var s = state.services[i];
      row.querySelector('b').textContent = s.name || 'Без названия';
      row.querySelector('small').textContent = [s.tag, s.price].filter(Boolean).join(' · ');
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-del-svc]'), function (btn) {
      btn.onclick = async function () {
        var i = +btn.getAttribute('data-del-svc');
        var name = (state.services[i] && state.services[i].name) || 'услугу';
        if (!confirm('Удалить «' + name + '»?')) return;
        state.services.splice(i, 1);
        renderServices($('svcSearch').value);
        await saveAll();
      };
    });
  }

  function showDash() {
    $('loginView').hidden = true;
    $('dashView').hidden = false;
    document.body.classList.remove('admin-login');
    document.body.classList.add('admin-dash');
  }

  function wireForms() {
    $('addDoctor').onsubmit = async function (e) {
      e.preventDefault();
      var name = $('docName').value.trim();
      if (!name) { toast('Введите ФИО', true); return; }
      state.doctors.push({
        name: name,
        role: $('docRole').value.trim() || 'Специализация',
        exp: $('docExp').value.trim() || '',
        src: $('docSrc').value.trim() || placeholderPhoto()
      });
      $('addDoctor').reset();
      renderDoctors();
      var ok = await saveAll();
      if (ok) toast('Врач добавлен и сохранён');
    };

    $('docFile').onchange = function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      if (f.size > 2.5 * 1024 * 1024) { toast('Файл больше 2.5 МБ — лучше URL', true); return; }
      var r = new FileReader();
      r.onload = function () { $('docSrc').value = r.result; };
      r.readAsDataURL(f);
    };

    $('addService').onsubmit = async function (e) {
      e.preventDefault();
      var name = $('svcName').value.trim();
      if (!name) { toast('Введите название услуги', true); return; }
      state.services.unshift({
        name: name,
        tag: $('svcTag').value.trim() || 'Терапия',
        price: $('svcPrice').value.trim() || '0 ₽',
        cat: $('svcCat').value || 'therapy'
      });
      $('addService').reset();
      $('svcCat').value = 'therapy';
      renderServices($('svcSearch').value);
      var ok = await saveAll();
      if (ok) toast('Услуга добавлена и сохранена');
    };

    $('svcSearch').oninput = function () { renderServices(this.value); };
    $('btnSave').onclick = function () { saveAll(); };
    $('btnLogout').onclick = function () {
      AmirCMS.logout();
      location.href = 'admin.html';
    };
    $('btnSite').onclick = function () {
      window.open('index.html?view=' + Date.now(), '_blank', 'noopener');
    };
  }

  function fillCatSelect() {
    $('svcCat').innerHTML = CATS.map(function (c) {
      return '<option value="' + c[0] + '">' + c[1] + '</option>';
    }).join('');
  }

  async function boot() {
    // purge old broken sessions
    try {
      var raw = sessionStorage.getItem('amirdent_admin_session');
      if (raw) {
        var s = JSON.parse(raw);
        if (!s.token) sessionStorage.removeItem('amirdent_admin_session');
      }
    } catch (e) {}

    if (!AmirCMS.isAuthed()) {
      $('loginView').hidden = false;
      $('dashView').hidden = true;
      var form = $('adminLogin');
      var err = $('loginErr');
      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        err.classList.remove('show');
        var ok = await AmirCMS.login(form.login.value.trim(), form.password.value);
        if (!ok) { err.classList.add('show'); return; }
        location.replace('admin.html');
      });
      return;
    }

    showDash();
    fillCatSelect();
    wireForms();
    $('dashStatus').textContent = 'Загрузка…';
    await loadData();
    renderDoctors();
    renderServices('');
    $('dashStatus').textContent = 'Врачей: ' + state.doctors.length + ' · Услуг: ' + state.services.length;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
