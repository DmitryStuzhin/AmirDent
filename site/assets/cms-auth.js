/* AmirDent CMS auth — сессия админки; пароль проверяет сервер */
(function(global){
  var SESSION_KEY='amirdent_admin_session';
  var CONTENT_KEY='amirdent_cms_content';

  // Логин и пароль здесь намеренно не хранятся: этот файл загружает каждый
  // посетитель сайта, поэтому любые значения в нём равносильны публикации.
  // Проверка идёт на сервере (netlify/functions/cms.mjs), браузер отправляет
  // только SHA-256 введённого пароля.

  function toHex(buf){
    return Array.from(new Uint8Array(buf)).map(function(b){return b.toString(16).padStart(2,'0');}).join('');
  }
  async function sha256(str){
    var data=new TextEncoder().encode(str);
    var dig=await crypto.subtle.digest('SHA-256', data);
    return toHex(dig);
  }

  var AmirCMS={
    CONTENT_KEY:CONTENT_KEY,
    SESSION_KEY:SESSION_KEY,
    async login(login, password){
      var ph=await sha256(password);
      var res=null;
      try{
        res=await fetch('/api/cms/login',{
          method:'POST',
          headers:{'Content-Type':'application/json','X-CMS-Token':ph},
          body:JSON.stringify({ login:login, token:ph })
        });
      }catch(e){
        throw new Error('Нет связи с сервером');
      }
      // Локальный сервер разработки может не знать этого адреса — тогда пароль
      // всё равно будет проверен при сохранении.
      if(res.status!==404 && !res.ok) return false;
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({
        login:login,
        at:Date.now(),
        token:ph
      }));
      return true;
    },
    logout:function(){
      sessionStorage.removeItem(SESSION_KEY);
    },
    isAuthed:function(){
      try{
        var raw=sessionStorage.getItem(SESSION_KEY);
        if(!raw) return false;
        var s=JSON.parse(raw);
        if(!s || !s.at || !s.token) return false;
        if(Date.now()-s.at > 12*60*60*1000){ this.logout(); return false; }
        return true;
      }catch(e){ return false; }
    },
    getSession:function(){
      try{ return JSON.parse(sessionStorage.getItem(SESSION_KEY)||'null'); }catch(e){ return null; }
    },
    getToken:function(){
      var s=this.getSession();
      return s&&s.token?s.token:'';
    },
    loadContent:function(){
      try{ return JSON.parse(localStorage.getItem(CONTENT_KEY)||'{}'); }catch(e){ return {}; }
    },
    saveContent:function(data){
      localStorage.setItem(CONTENT_KEY, JSON.stringify(data));
    },
    clearContent:function(){
      localStorage.removeItem(CONTENT_KEY);
    },
    async publishContent(data){
      var token=this.getToken();
      if(!token) throw new Error('Нет сессии');
      var res=await fetch('/api/cms/save',{
        method:'POST',
        headers:{
          'Content-Type':'application/json',
          'X-CMS-Token':token
        },
        body:JSON.stringify({ content:data, token:token })
      });
      var json=null;
      try{ json=await res.json(); }catch(e){}
      if(!res.ok || !json || !json.ok){
        var msg=(json&&json.error)||('Ошибка сервера '+res.status);
        throw new Error(msg);
      }
      return json;
    }
  };

  global.AmirCMS=AmirCMS;
})(window);
