/* AmirDent CMS auth — the password never becomes a browser-side bearer token. */
(function (global) {
  'use strict';

  var CONTENT_KEY = 'amirdent_cms_content';
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
      }
    },

    isAuthed() {
      return state.checked && state.authenticated;
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

    async listVersions() {
      var result = await request('/api/cms/versions', { cache: 'no-store' });
      if (!result.response.ok) throw new Error((result.data && result.data.error) || 'Не удалось загрузить историю');
      return result.data.versions || [];
    },

    async restoreVersion(key) {
      var result = await request('/api/cms/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: key }),
      });
      if (!result.response.ok || !result.data || !result.data.ok) {
        throw new Error((result.data && result.data.error) || 'Не удалось восстановить версию');
      }
      return result.data;
    },
  };

  global.AmirCMS = AmirCMS;
})(window);
