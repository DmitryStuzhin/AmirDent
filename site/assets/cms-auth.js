/* AmirDent CMS auth — client-side session for static admin */
(function(global){
  var SESSION_KEY='amirdent_admin_session';
  var CONTENT_KEY='amirdent_cms_content';
  // SHA-256("admin") / SHA-256("AmirDent2026!")
  var LOGIN_HASH='8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918';
  var PASS_HASH='967297ed8703119a5dcfa394969506d97b7223d88c678cf87d9677678479c91d';

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
    PASS_HASH:PASS_HASH,
    async login(login, password){
      var lh=await sha256(login);
      var ph=await sha256(password);
      if(lh!==LOGIN_HASH || ph!==PASS_HASH) return false;
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
