/* AmirDent — подключает CMS только после успешного входа через /admin.html.
   Флаг sessionStorage + живая cookie-сессия обязательны оба. */
(function () {
  'use strict';

  var EDIT_KEY = 'amirdent_cms_edit';
  var AUTH_SRC = '/assets/cms-auth.js?v=b14kids1';
  var CMS_SRC = '/assets/cms.js?v=nohistory1';
  var CSS_HREF = '/assets/cms.css?v=b4boot1';

  function qsHas(name, value) {
    try {
      return new URLSearchParams(location.search || '').get(name) === value;
    } catch (e) {
      return false;
    }
  }

  function hasEditFlag() {
    try {
      return sessionStorage.getItem(EDIT_KEY) === '1';
    } catch (e) {
      return false;
    }
  }

  // ?edit=1 больше не открывает правку — только флаг после login
  if (qsHas('preview', '1') || !hasEditFlag()) return;

  function loadCss(href) {
    if (document.querySelector('link[data-cms-css]')) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.setAttribute('data-cms-css', '1');
    document.head.appendChild(link);
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('Не удалось загрузить ' + src)); };
      (document.body || document.documentElement).appendChild(s);
    });
  }

  loadCss(CSS_HREF);
  loadScript(AUTH_SRC)
    .then(function () {
      if (!window.AmirCMS || typeof AmirCMS.refreshSession !== 'function') return null;
      return AmirCMS.refreshSession().then(function (active) {
        if (!active) {
          if (AmirCMS.exitEditMode) AmirCMS.exitEditMode();
          return null;
        }
        if (!AmirCMS.isEditMode || !AmirCMS.isEditMode()) return null;
        return loadScript(CMS_SRC);
      });
    })
    .catch(function (err) {
      try { console.warn('[cms-boot]', err && err.message ? err.message : err); } catch (e) {}
    });
})();
