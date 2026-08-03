/* Всплывающая карточка врача.
   Открывается кликом по врачу в сетке на главной и по карточке в стопке на
   странице услуги. Данные берутся из assets/services-data.js, поэтому биография
   правится в одном месте.

   Окно живёт в <dialog>: браузер сам даёт верхний слой, подложку и Esc. Там,
   где <dialog> не поддержан, работаем обычным блоком с ручным закрытием. */
(function () {
  var data = window.AMIR_SERVICES;
  if (!data || !data.doctors) return;

  var dlg = null, panel = null, lastFocus = null, native = false, fromKeyboard = false;
  var currentDoctorId = '';

  function mediaUrl(url) {
    if (!url || typeof url !== 'string') return '';
    var u = url.trim();
    if (!u) return '';
    if (/^data:|^https?:\/\//i.test(u) || u.indexOf('//') === 0) return u;
    if (u.charAt(0) === '/') return u;
    if (u.indexOf('assets/') === 0) return '/' + u;
    return u;
  }

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
    img.src = mediaUrl(d.photo || '');
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
    if (d.pdRating != null) {
      var pdBox = document.createElement('div');
      pdBox.className = 'dm-stat dm-stat-rating';
      var srcLabel = d.ratingSource === 'zub' ? 'Зуб.ру'
        : d.ratingSource === 'docdoc' ? 'DocDoc'
        : d.ratingSource === 'yandex' ? 'Яндекс Карты'
        : d.ratingSource === 'doctu' ? 'Doctu'
        : 'ПроДокторов';
      var pdK = document.createElement('span'); pdK.className = 'dm-rating-source'; pdK.textContent = srcLabel;
      var pdMain = document.createElement('div'); pdMain.className = 'dm-rating-main';
      var pdV = document.createElement('b');
      pdV.textContent = Number(d.pdRating).toFixed(1);
      var pdStars = document.createElement('span');
      pdStars.className = 'dm-rating-stars';
      pdStars.setAttribute('aria-hidden', 'true');
      pdStars.textContent = '★★★★★';
      pdMain.appendChild(pdV); pdMain.appendChild(pdStars);
      pdBox.appendChild(pdK); pdBox.appendChild(pdMain);
      if (d.pdReviews) {
        var pdReviews = document.createElement('span');
        pdReviews.className = 'dm-rating-reviews';
        pdReviews.textContent = d.pdReviews + ' ' + (d.pdReviews % 10 === 1 && d.pdReviews % 100 !== 11 ? 'отзыв' : (d.pdReviews % 10 >= 2 && d.pdReviews % 10 <= 4 && (d.pdReviews % 100 < 12 || d.pdReviews % 100 > 14) ? 'отзыва' : 'отзывов'));
        pdBox.appendChild(pdReviews);
      }
      if (d.pdUrl) {
        var pdA = document.createElement('a');
        pdA.className = 'dm-pd-link';
        pdA.href = d.pdUrl;
        pdA.target = '_blank';
        pdA.rel = 'noopener noreferrer';
        pdA.appendChild(pdBox);
        stats.appendChild(pdA);
      } else {
        stats.appendChild(pdBox);
      }
    }

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

  /* Одна запись врача может быть показана сразу в нескольких местах: в общей
     сетке, на странице услуги и во всплывающей карточке. Обновляем их вместе,
     чтобы сохранённая в CMS фотография нигде не оставалась старой. */
  function syncDoctorCards(id, d) {
    if (!id || !d) return;
    var photo = mediaUrl(d.photo || d.src || '');
    document.querySelectorAll('[data-doc]').forEach(function (card) {
      if (card.getAttribute('data-doc') !== id) return;
      var img = card.querySelector('.doc-photo img, .chief-media img, .dp-doc-photo img, .dp-team-photo img, img');
      var name = card.querySelector('.doc-body h3, .chief-body h3, .dp-doc-name, .dp-team-card h3');
      var role = card.querySelector('.doc-body .role, .chief-body .role, .dp-doc-role, .dp-team-role');
      var exp = card.querySelector('.doc-body .exp, .chief-body .exp, .dp-doc-exp, .dp-team-card p');
      if (img && photo) img.setAttribute('src', photo);
      if (img && d.name) img.setAttribute('alt', d.name);
      if (name && d.name) name.textContent = d.name;
      if (role && d.role != null) role.textContent = d.role;
      if (exp && d.exp != null) exp.textContent = d.exp;
      var details = card.querySelector('.doc-details,.dp-doc-btn');
      if (details && d.name) details.setAttribute('aria-label', 'Подробнее о враче ' + d.name);
    });
    if (dlg && currentDoctorId === id && (native ? dlg.open : !dlg.hidden)) fill(d);
  }

  function mergeDoctorSnapshot(snap) {
    if (!snap || !Array.isArray(snap.doctors)) return;
    snap.doctors.forEach(function (d) {
      if (!d || !d.id) return;
      var prev = data.doctors[d.id] || {};
      var merged = Object.assign({}, prev, d, {
        photo: mediaUrl(d.src || d.photo || prev.photo || ''),
        bio: Array.isArray(d.bio) ? d.bio : (prev.bio || [])
      });
      data.doctors[d.id] = merged;
      syncDoctorCards(d.id, merged);
    });
    applyDocRatings();
  }

  function open(id) {
    var d = data.doctors[id];
    if (!d) return;
    build();
    currentDoctorId = id;
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
    // После клика мышкой не возвращаем фокус на карточку —
    // иначе остаётся золотая рамка :focus-visible.
    if (fromKeyboard && lastFocus && lastFocus.focus) lastFocus.focus();
    else if (lastFocus && lastFocus.blur) lastFocus.blur();
    lastFocus = null;
    fromKeyboard = false;
    currentDoctorId = '';
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
    fromKeyboard = false;
    open(hit.getAttribute('data-doc'));
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var trigger = document.activeElement;
    if (!trigger || !trigger.classList || !trigger.classList.contains('doc-details')) return;
    var hit = trigger.closest('[data-doc]');
    if (!hit) return;
    e.preventDefault();
    fromKeyboard = true;
    open(hit.getAttribute('data-doc'));
  });

  /* Рейтинг на карточках. Берётся из services-data.js (pdRating / pdReviews / pdUrl).
     ratingSource: pd | zub | docdoc | yandex | doctu — источник лучшего найденного рейтинга. */
  function ratingSourceMeta(source) {
    if (source === 'zub') return { key: 'zub', label: 'Зуб.ру', fallback: 'https://zub.ru/doctors/' };
    if (source === 'docdoc') return { key: 'docdoc', label: 'DocDoc', fallback: 'https://docdoc.ru/' };
    if (source === 'yandex') return { key: 'yandex', label: 'Яндекс Карты', fallback: 'https://yandex.ru/maps/org/amirdent/1781090864/' };
    if (source === 'doctu') return { key: 'doctu', label: 'Doctu', fallback: 'https://doctu.ru/msk/' };
    return { key: 'pd', label: 'ПроДокторов', fallback: 'https://prodoctorov.ru/' };
  }
  function applyDocRatings() {
    var docs = data.doctors;
    if (!docs) return;
    document.querySelectorAll('[data-doc]').forEach(function (el) {
      var id = el.getAttribute('data-doc');
      var d = docs[id];
      el.removeAttribute('role');
      el.removeAttribute('tabindex');
      el.removeAttribute('aria-haspopup');
      var body = el.querySelector('.doc-body')
        || el.querySelector('.chief-body')
        || el.querySelector('.dp-doc-text');
      if (!body) return;
      var details = body.querySelector('.doc-details');
      if (!details) {
        details = document.createElement('button');
        details.type = 'button';
        details.className = 'doc-details';
        details.textContent = 'Подробнее о враче';
        details.setAttribute('aria-label', 'Подробнее о враче ' + (d && d.name ? d.name : ''));
        body.appendChild(details);
      }
      var old = body.querySelector('.doc-pd');
      if (old) old.remove();
      if (!d || d.pdRating == null) return;
      var meta = ratingSourceMeta(d.ratingSource);
      var sourceLabel = meta.label;
      var fallbackUrl = meta.fallback;
      var a = document.createElement('a');
      a.className = 'doc-pd';
      a.href = d.pdUrl || fallbackUrl;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.setAttribute('aria-label', 'Рейтинг на ' + sourceLabel + ': ' + Number(d.pdRating).toFixed(1));
      var score = document.createElement('span');
      score.className = 'doc-pd-score';
      score.textContent = Number(d.pdRating).toFixed(1);
      var stars = document.createElement('span');
      stars.className = 'doc-pd-stars';
      stars.setAttribute('aria-hidden', 'true');
      stars.textContent = '★★★★★';
      var label = document.createElement('span');
      label.className = 'doc-pd-label';
      label.textContent = sourceLabel + (d.pdReviews ? ' · ' + d.pdReviews : '');
      a.appendChild(score);
      a.appendChild(stars);
      a.appendChild(label);
      var btn = body.querySelector('.dp-doc-btn,.doc-details');
      if (btn) body.insertBefore(a, btn);
      else body.appendChild(a);
    });
  }

  function scheduleRatings() {
    applyDocRatings();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleRatings);
  } else {
    scheduleRatings();
  }
  document.addEventListener('amir:service-ready', scheduleRatings);
  document.addEventListener('amir:cms-content-ready', function (e) {
    mergeDoctorSnapshot(e && e.detail);
  });

  window.AMIR_DOCTOR_MODAL = { open: open, close: close };
  window.AMIR_applyDocRatings = applyDocRatings;
  window.AMIR_syncDoctorCards = syncDoctorCards;
  window.AMIR_mergeDoctorSnapshot = mergeDoctorSnapshot;
})();
