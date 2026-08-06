/* AmirDent — применяет /assets/content.json на публичных страницах.
   Панель правки не грузится: только тексты / фото / reels из снимка CMS. */
(function () {
  'use strict';

  try {
    var params = new URLSearchParams(location.search || '');
    var preview = params.get('preview') === '1';
    // В режиме правки полный cms.js сам применит снимок.
    // ?preview=1 — вид «как у посетителя»: apply нужен даже при флаге правки.
    if (!preview && sessionStorage.getItem('amirdent_cms_edit') === '1') return;
  } catch (e) {}

  function isServicePage() {
    try {
      if (document.getElementById('dirPage')) return true;
      if (document.getElementById('dirTitle') && document.getElementById('dirFacts')) return true;
      var path = location.pathname || '';
      if (/^\/uslugi(\/|$)/.test(path)) return true;
      if (/service\.html$/i.test(path)) return true;
    } catch (e) {}
    return false;
  }

  function applyTextItems(snap) {
    var items = snap.textItems;
    if (!Array.isArray(items)) return;
    var servicePage = isServicePage();
    items.forEach(function (item) {
      if (!item || !item.sel || typeof item.html !== 'string') return;
      if (
        servicePage &&
        (item.sel === '#dirTitle' ||
          item.sel === '#dirDesc' ||
          item.sel === '#dirGroup' ||
          item.sel === '#dirDocRole' ||
          item.sel === '#dirDocName' ||
          item.sel === '#dirDocExp')
      ) {
        return;
      }
      var n = null;
      try {
        var nodes = document.querySelectorAll(item.sel);
        n = nodes[item.idx || 0] || null;
      } catch (err) {
        n = null;
      }
      if (!n) return;
      if (n.closest && n.closest('#booking,.cms-bar,.cms-modal-bg')) return;
      n.innerHTML = item.html;
      if (item.hidden) n.style.display = 'none';
      else if (n.style.display === 'none') n.style.display = '';
    });
  }

  function applyImages(snap) {
    if (!Array.isArray(snap.images)) return;
    var imgs = Array.prototype.slice.call(document.querySelectorAll('body img')).filter(function (img) {
      return !(img.closest && img.closest('.doc-grid,.cms-bar,.cms-modal-bg'));
    });
    snap.images.forEach(function (item, i) {
      var img = imgs[i];
      if (!img || !item) return;
      if (item.src) img.setAttribute('src', item.src);
      if (typeof item.alt === 'string') img.setAttribute('alt', item.alt);
    });
  }

  function applyReels(snap) {
    if (!Array.isArray(snap.reels)) return;
    var section = document.getElementById('reels');
    var buttons = document.querySelectorAll('#reels .reel, .reels .reel');
    snap.reels.forEach(function (r, i) {
      var btn = buttons[i];
      if (!btn || !r) return;
      var video = String(r.video || '').trim();
      btn.setAttribute('data-video', video);
      btn.hidden = false;
      var poster = btn.querySelector('.reel-poster');
      if (poster && r.poster) {
        poster.style.backgroundImage = 'url(' + JSON.stringify(String(r.poster)) + ')';
      }
      var cap = btn.querySelector('.reel-cap');
      if (cap && typeof r.captionHtml === 'string') cap.innerHTML = r.captionHtml;
    });
    if (section) section.hidden = false;
  }

  function applyDoctors(snap) {
    if (typeof snap.docsHtml !== 'string' || !snap.docsHtml.trim()) return;
    var grid = document.querySelector('.doc-grid');
    if (!grid) return;
    grid.innerHTML = snap.docsHtml;
    if (snap.docsV != null) grid.setAttribute('data-docs-v', String(snap.docsV));
  }

  function run(snap) {
    if (!snap || typeof snap !== 'object') return;
    applyTextItems(snap);
    applyImages(snap);
    applyReels(snap);
    applyDoctors(snap);
    try {
      document.dispatchEvent(new CustomEvent('amir:cms-content-ready', { detail: snap }));
    } catch (e) {}
  }

  function boot() {
    fetch('/assets/content.json?ts=' + Date.now(), { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(run)
      .catch(function () {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
