/* AmirDent CMS auth — the password never becomes a browser-side bearer token. */
(function (global) {
  'use strict';

  var CONTENT_KEY = 'amirdent_cms_content';
  // Только sessionStorage вкладки: cookie-сессия ≠ режим правки на публичных страницах.
  var EDIT_KEY = 'amirdent_cms_edit';
  var state = { checked: false, authenticated: false, user: null, revision: '' };

  async function request(url, options) {
    var response;
    try {
      response = await fetch(url, Object.assign({ credentials: 'same-origin' }, options || {}));
    } catch (error) {
      throw new Error('Нет связи с сервером');
    }
    var data = null;
    try {
      data = await response.json();
    } catch (error) {}
    return { response: response, data: data };
  }

  var AmirCMS = {
    CONTENT_KEY: CONTENT_KEY,

    async login(login, password) {
      var result = await request('/api/cms/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: login, password: password }),
      });
      if (result.response.status === 401) return false;
      if (result.response.status === 429) {
        throw new Error('Слишком много попыток. Подождите 15 минут.');
      }
      if (result.response.status === 500 && result.data && result.data.error === 'not_configured') {
        throw new Error(result.data.message || 'Админка не настроена: задайте CMS_LOGIN и CMS_PASSWORD_HASH в .env');
      }
      if (!result.response.ok || !result.data || result.data.ok !== true) {
        throw new Error('Сервер не смог выполнить вход (код ' + result.response.status + ')');
      }
      state.checked = true;
      state.authenticated = true;
      state.user = result.data.user || null;
      return true;
    },

    async refreshSession() {
      var result = await request('/api/cms/session', { cache: 'no-store' });
      state.checked = true;
      state.authenticated = result.response.ok && !!(result.data && result.data.authenticated);
      state.user = state.authenticated ? result.data.user || null : null;
      return state.authenticated;
    },

    async logout() {
      try {
        await request('/api/cms/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      } finally {
        state.checked = true;
        state.authenticated = false;
        state.user = null;
        this.exitEditMode();
      }
    },

    enterEditMode() {
      try { sessionStorage.setItem(EDIT_KEY, '1'); } catch (e) {}
    },

    exitEditMode() {
      try { sessionStorage.removeItem(EDIT_KEY); } catch (e) {}
    },

    isEditMode() {
      try { return sessionStorage.getItem(EDIT_KEY) === '1'; } catch (e) { return false; }
    },

    isAuthed() {
      return state.checked && state.authenticated;
    },

    canEdit() {
      return this.isAuthed() && this.isEditMode();
    },

    getSession() {
      return state.authenticated ? { login: state.user && state.user.login } : null;
    },

    getToken() {
      return state.authenticated ? 'cookie-session' : '';
    },

    setRevision(revision) {
      state.revision = String(revision || '');
    },

    loadContent() {
      try {
        return JSON.parse(localStorage.getItem(CONTENT_KEY) || '{}');
      } catch (error) {
        return {};
      }
    },

    saveContent(data) {
      localStorage.setItem(CONTENT_KEY, JSON.stringify(data));
      if (data && data.revision) state.revision = data.revision;
    },

    clearContent() {
      localStorage.removeItem(CONTENT_KEY);
    },

    async publishContent(data) {
      if (!state.authenticated) throw new Error('Нет сессии');
      var result = await request('/api/cms/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: data, revision: state.revision }),
      });
      if (!result.response.ok || !result.data || !result.data.ok) {
        if (result.response.status === 401) state.authenticated = false;
        if (result.response.status === 409) {
          throw new Error('Контент уже изменён другим администратором. Обновите страницу перед сохранением.');
        }
        throw new Error((result.data && result.data.error) || 'Ошибка сервера ' + result.response.status);
      }
      state.revision = result.data.revision || '';
      if (data) {
        data.savedAt = result.data.savedAt || data.savedAt;
        data.revision = state.revision;
        this.saveContent(data);
      }
      return result.data;
    },

    async listLeads() {
      var result = await request('/api/cms/leads', { cache: 'no-store' });
      if (!result.response.ok) throw new Error((result.data && result.data.error) || 'Не удалось загрузить заявки');
      return result.data.leads || [];
    },
  };

  global.AmirCMS = AmirCMS;
})(window);
