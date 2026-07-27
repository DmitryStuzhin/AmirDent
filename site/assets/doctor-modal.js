/* Всплывающая карточка врача.
   Открывается кликом по врачу в сетке на главной и по карточке в стопке на
   странице услуги. Данные берутся из assets/services-data.js, поэтому биография
   правится в одном месте.

   Окно живёт в <dialog>: браузер сам даёт верхний слой, подложку и Esc. Там,
   где <dialog> не поддержан, работаем обычным блоком с ручным закрытием. */
(function () {
  var data = window.AMIR_SERVICES;
  if (!data || !data.doctors) return;

  var dlg = null, panel = null, lastFocus = null, native = false;

  function build() {
    if (dlg) return;
    native = typeof HTMLDialogElement === 'function' && 'showModal' in HTMLDialogElement.prototype;
    dlg = document.createElement(native ? 'dialog' : 'div');
    dlg.className = 'dm';
    dlg.setAttribute('aria-labelledby', 'dmName');
    if (!native) {
      dlg.setAttribute('role', 'dialog');
      dlg.setAttribute('aria-modal', 'true');
      dlg.hidden = true;
    }
    dlg.innerHTML =
      '<div class="dm-panel">' +
        '<button type="button" class="dm-x" aria-label="Закрыть">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
        '</button>' +
        '<div class="dm-media"><img alt="" id="dmPhoto" decoding="async"></div>' +
        '<div class="dm-body">' +
          '<div class="dm-role" id="dmRole"></div>' +
          '<h2 class="dm-name" id="dmName"></h2>' +
          '<div class="dm-stats" id="dmStats"></div>' +
          '<div class="dm-video" id="dmVideo" hidden></div>' +
          '<div class="dm-bio" id="dmBio"></div>' +
          '<div class="dm-cta">' +
            '<a class="btn btn-gold" href="#zapis" id="dmBook">Записаться к врачу</a>' +
            '<a class="dm-wa" href="https://wa.me/79262031828" target="_blank" rel="noopener">Написать в WhatsApp</a>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(dlg);
    panel = dlg.querySelector('.dm-panel');

    dlg.querySelector('.dm-x').addEventListener('click', close);
    // клик мимо панели закрывает
    dlg.addEventListener('click', function (e) {
      if (!panel.contains(e.target)) close();
    });
    dlg.addEventListener('cancel', function (e) { e.preventDefault(); close(); });
    if (!native) {
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && !dlg.hidden) close();
      });
    }
    dlg.querySelector('#dmBook').addEventListener('click', close);
  }

  function fill(d) {
    var img = dlg.querySelector('#dmPhoto');
    img.src = d.photo || '';
    img.alt = d.name || '';
    dlg.querySelector('#dmRole').textContent = d.spec || d.role || '';
    dlg.querySelector('#dmName').textContent = d.name || '';

    var stats = dlg.querySelector('#dmStats');
    stats.innerHTML = '';
    var cells = [];
    if (d.years) cells.push(['Стаж', d.years]);
    if (d.spec) cells.push(['Направление', d.spec]);
    cells.push(['Приём', 'Ежедневно 09:00–21:00']);
    cells.forEach(function (c) {
      var box = document.createElement('div');
      box.className = 'dm-stat';
      var k = document.createElement('span'); k.textContent = c[0];
      var v = document.createElement('b'); v.textContent = c[1];
      box.appendChild(k); box.appendChild(v);
      stats.appendChild(box);
    });

    // Видео пока ни у кого не заполнено — блок появится, как только в данных
    // врача окажется ссылка на ролик.
    var vbox = dlg.querySelector('#dmVideo');
    vbox.innerHTML = '';
    if (d.video) {
      var v = document.createElement('video');
      v.src = d.video;
      v.controls = true;
      v.preload = 'none';
      v.playsInline = true;
      if (d.poster) v.poster = d.poster;
      vbox.appendChild(v);
      vbox.hidden = false;
    } else {
      vbox.hidden = true;
    }

    var bio = dlg.querySelector('#dmBio');
    bio.innerHTML = '';
    var rows = d.bio || [];
    if (!rows.length) {
      var p = document.createElement('p');
      p.className = 'dm-empty';
      p.textContent = d.exp || 'Подробности об образовании уточняются.';
      bio.appendChild(p);
      return;
    }
    var h = document.createElement('h3');
    h.className = 'dm-bio-h';
    h.textContent = 'Образование и практика';
    bio.appendChild(h);
    var ol = document.createElement('ol');
    ol.className = 'dm-track';
    rows.forEach(function (r) {
      var li = document.createElement('li');
      var year = document.createElement('span');
      year.className = 'dm-year';
      year.textContent = r[0] || '';
      var txt = document.createElement('p');
      txt.textContent = r[1] || '';
      li.appendChild(year); li.appendChild(txt);
      ol.appendChild(li);
    });
    bio.appendChild(ol);
  }

  function open(id) {
    var d = data.doctors[id];
    if (!d) return;
    build();
    fill(d);
    lastFocus = document.activeElement;
    document.documentElement.classList.add('dm-lock');
    if (native) dlg.showModal();
    else { dlg.hidden = false; trap(); }
    panel.scrollTop = 0;
    dlg.querySelector('.dm-x').focus();
  }

  function close() {
    if (!dlg) return;
    document.documentElement.classList.remove('dm-lock');
    if (native) dlg.close();
    else dlg.hidden = true;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  // Запасной перехват фокуса там, где нет настоящего <dialog>.
  function trap() {
    dlg.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;
      var f = dlg.querySelectorAll('a[href],button,video');
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }

  // Один обработчик на документ: ловит и сетку на главной, и стопку на
  // странице услуги, включая карточки, которые появились позже.
  document.addEventListener('click', function (e) {
    var hit = e.target.closest ? e.target.closest('[data-doc]') : null;
    if (!hit) return;
    if (e.target.closest('a')) return; // ссылка внутри карточки важнее
    e.preventDefault();
    open(hit.getAttribute('data-doc'));
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var hit = document.activeElement;
    if (!hit || !hit.hasAttribute || !hit.hasAttribute('data-doc')) return;
    e.preventDefault();
    open(hit.getAttribute('data-doc'));
  });

  window.AMIR_DOCTOR_MODAL = { open: open, close: close };
})();
