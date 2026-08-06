/* AmirDent CMS — reliable snapshot save/load (no overlapping selectors) */
(function(){
  if(!window.AmirCMS) return;

  var content = { v:3 };
  var currentEl = null;
  var dirty = false;
  var panelMode = null; // 'doctors' | 'services' | null

  // Единый список: и для клика в админке, и для сохранения в content.json.
  // Раньше wireTargets помечал одни узлы, а queryUniqueTexts сохранял другие —
  // из‑за этого часть правок «исчезала» у посетителей после перезагрузки.
  var TEXT_SELECTORS = [
    '.hero-copy h1',
    '.hero-sub',
    '.eyebrow',
    '.hero-trust .t b',
    '.hero-trust .t small',
    // Заголовки секций — только стабильные якоря (не section.pad … idx)
    '[data-cms-text="about-title"]',
    '[data-cms-text="about-sub"]',
    '[data-cms-text="services-title"]',
    '[data-cms-text="services-sub"]',
    '[data-cms-text="steps-title"]',
    '[data-cms-text="steps-sub"]',
    '[data-cms-text="map-title"]',
    '[data-cms-text="map-sub"]',
    '[data-cms-text="doctors-title"]',
    '[data-cms-text="reviews-title"]',
    '[data-cms-text="reviews-sub"]',
    '[data-cms-text="reels-title"]',
    '[data-cms-text="reels-sub"]',
    '#services .price-note',
    '#doctors .chief-body .role',
    '#doctors .chief-body h3',
    '#doctors .chief-body .exp',
    '#doctors .chief-body > p',
    '#doctors .chief-facts .f b',
    '#doctors .chief-facts .f small',
    '.stats-grid .stat b',
    '.stats-grid .stat > span',
    '.why-grid .pcard .lbl',
    '.why-grid .pcard .cap .big',
    '.why-grid .pcard .cap p',
    '.why-grid .pcard .lbl2',
    '.why-grid .pcard.solid > p',
    '.why-grid .pcard.solid .plogos span',
    '.steps-grid .step h3',
    '.steps-grid .step p',
    '.rev-track > .rev:not(.rev-clone) > p',
    '.rev-track > .rev:not(.rev-clone) .who b',
    '.rev-track > .rev:not(.rev-clone) .who small',
    '.score .v',
    '.score small',
    '.chip',
    '#zapis .cta-grid > div > h2',
    '#zapis .cta-grid > div > p:not(.agree)',
    '.ftr-about',
    // Страница услуги /uslugi/...
    '#dirTitle',
    '#dirDesc',
    '#dirGroup',
    '.dp-perks li',
    '#dirDocRole',
    '#dirDocName',
    '#dirDocExp',
    '#dirSteps .dp-step h3',
    '#dirSteps .dp-step p',
    '#dirInfo > h3',
    '#dirInfo > p',
    '.dp-h2'
  ];

  function applyTextItemsOnly(snap){
    var textItems=(snap&&snap.textItems)||(content&&content.textItems);
    if(!textItems && snap && snap.texts){
      textItems=[];
      Object.keys(snap.texts).forEach(function(sel){
        (snap.texts[sel]||[]).forEach(function(item, idx){
          textItems.push({ sel:sel, idx:idx, html:item.html, hidden:!!item.hidden });
        });
      });
    }
    if(!Array.isArray(textItems)) return;
    var skipServiceFields=isServicePage();
    textItems.forEach(function(item){
      if(!item || !item.sel) return;
      if(skipServiceFields && (item.sel==='#dirTitle' || item.sel==='#dirDesc' || item.sel==='#dirGroup' || item.sel==='#dirDocRole' || item.sel==='#dirDocName' || item.sel==='#dirDocExp')) return;
      var n=null;
      try{
        var nodes=document.querySelectorAll(item.sel);
        n=nodes[item.idx||0]||null;
      }catch(e){ n=null; }
      if(!n) return;
      if(typeof item.html==='string') n.innerHTML=item.html;
      if(item.hidden) n.style.display='none';
      else if(n.style.display==='none') n.style.display='';
    });
  }

  function isServicePage(){
    try{
      if(document.getElementById('dirPage')) return true;
      if(document.getElementById('dirTitle') && document.getElementById('dirFacts')) return true;
      var path=location.pathname||'';
      if(/^\/uslugi(\/|$)/.test(path)) return true;
      if(/service\.html$/i.test(path)) return true;
    }catch(e){}
    return false;
  }

  function mainPriceList(){
    // На карточке услуги #dirList — урезанный список; полный прайс не трогаем.
    if(isServicePage()) return null;
    return document.querySelector('#services .price-list, .price-page .price-list, .price-list');
  }

  function toast(msg, opts){
    var t=document.getElementById('cmsToast');
    if(!t){ alert(typeof msg==='string'?msg:''); return; }
    opts=opts||{};
    if(opts.html) t.innerHTML=msg;
    else t.textContent=msg;
    t.classList.add('show');
    t.style.pointerEvents=opts.html?'auto':'none';
    clearTimeout(toast._tm);
    if(!opts.sticky){
      toast._tm=setTimeout(function(){
        t.classList.remove('show');
        t.style.pointerEvents='none';
      }, opts.html?8000:3500);
    }
  }

  function compressImageFile(file, maxSide, quality){
    return new Promise(function(resolve, reject){
      if(!file || !file.type || file.type.indexOf('image/')!==0){
        reject(new Error('Выберите файл изображения (JPG, PNG, WEBP)'));
        return;
      }
      var url=URL.createObjectURL(file);
      var img=new Image();
      img.onload=function(){
        try{
          var side=Math.max(img.width, img.height)||1;
          var scale=Math.min(1, (maxSide||1100)/side);
          var w=Math.max(1, Math.round(img.width*scale));
          var h=Math.max(1, Math.round(img.height*scale));
          var canvas=document.createElement('canvas');
          canvas.width=w;
          canvas.height=h;
          var ctx=canvas.getContext('2d');
          ctx.fillStyle='#e8e0d4';
          ctx.fillRect(0,0,w,h);
          ctx.drawImage(img,0,0,w,h);
          URL.revokeObjectURL(url);
          resolve(canvas.toDataURL('image/jpeg', quality==null?0.82:quality));
        }catch(err){
          URL.revokeObjectURL(url);
          reject(err);
        }
      };
      img.onerror=function(){
        URL.revokeObjectURL(url);
        reject(new Error('Не удалось прочитать фото'));
      };
      img.src=url;
    });
  }

  /* Локальные пути всегда от корня сайта (/assets/...), иначе на /uslugi/...
     относительный assets/... ищет файл не там. */
  function normalizeMediaUrl(url){
    if(!url || typeof url!=='string') return url||'';
    var u=url.trim();
    if(!u) return '';
    if(/^data:|^https?:\/\//i.test(u) || u.indexOf('//')===0) return u;
    if(u.charAt(0)==='/') return u;
    if(u.indexOf('assets/')===0) return '/'+u;
    return u;
  }

  function uploadCmsImage(file){
    toast('Обрабатываем фото…');
    return compressImageFile(file, 1100, 0.82).then(function(dataUrl){
      return fetch('/api/cms/upload',{
        method:'POST',
        credentials:'same-origin',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ image:dataUrl })
      }).then(function(res){
        return res.json().catch(function(){ return null; }).then(function(json){
          if(res.ok && json && json.ok && json.url){
            toast('Фото загружено');
            return normalizeMediaUrl(json.url);
          }
          if(res.status===401){
            if(window.AmirCMS && typeof AmirCMS.logout==='function'){
              try{ AmirCMS.logout(); }catch(e){}
            }
            throw new Error('Сессия истекла — войдите в админку заново (/admin.html)');
          }
          throw new Error((json&&json.error)||'Не удалось сохранить фото');
        });
      });
    });
  }

  function wireImageFileInput(inputEl, onUrl, onBusy){
    if(!inputEl) return;
    var uploadSeq=0;
    inputEl.onchange=function(e){
      var f=e.target.files&&e.target.files[0];
      if(!f) return;
      var seq=++uploadSeq;
      if(typeof onBusy==='function') onBusy(true);
      uploadCmsImage(f).then(function(url){
        if(seq!==uploadSeq) return;
        if(typeof onUrl==='function') onUrl(url);
        if(typeof onBusy==='function') onBusy(false);
      }).catch(function(err){
        if(seq!==uploadSeq) return;
        if(typeof onBusy==='function') onBusy(false);
        alert(err&&err.message?err.message:err);
      });
    };
  }

  function openPublicSite(){
    var url='/?preview=1&view='+Date.now();
    var win=window.open(url, '_blank', 'noopener,noreferrer');
    if(!win){
      toast('✓ Сохранено. <a href="'+url+'" target="_blank" rel="noopener" style="color:#d3ba86;font-weight:700">Открыть сайт для пользователя →</a>', {html:true});
      return false;
    }
    try{ win.opener=null; }catch(e){}
    return true;
  }

  function markDirty(){
    dirty=true;
    var b=document.getElementById('cmsSaveNow');
    if(b) b.textContent='Сохранить на сайт *';
  }

  function clearDirty(){
    dirty=false;
    var b=document.getElementById('cmsSaveNow');
    if(b) b.textContent='Сохранить на сайт';
  }

  function persist(opts){
    opts=opts||{};
    content=buildSnapshot();
    AmirCMS.saveContent(content);
    if(!AmirCMS.isAuthed()){
      toast('Сессия устарела — войдите снова');
      setTimeout(function(){ location.href='admin.html'; }, 800);
      return Promise.reject(new Error('no token'));
    }
    return AmirCMS.publishContent(content).then(function(res){
      if(res && res.savedAt) content.savedAt=res.savedAt;
      // Проверка: сервер реально отдал свежий снимок (не HTML-страницу ошибки)
      return fetch('/api/cms/content?ts='+Date.now(),{cache:'no-store',credentials:'same-origin'}).then(function(r){
        return r.text().then(function(text){
          var remote=null;
          try{ remote=text?JSON.parse(text):null; }catch(parseErr){
            throw new Error('API ответил не JSON (код '+r.status+'). Запущен ли server.py / деплой CMS?');
          }
          if(!r.ok) throw new Error('Не удалось проверить сохранение (код '+r.status+')');
          if(!remote || remote.savedAt!==content.savedAt){
            throw new Error('сервер вернул старые данные');
          }
          clearDirty();
          if(opts.openPreview!==false){
            if(openPublicSite()){
              toast('✓ Сохранено. Открыта новая вкладка с сайтом для пользователя');
            }
          } else {
            toast('✓ Сохранено на сайт');
          }
          return res;
        });
      });
    }).catch(function(err){
      var msg=err&&err.message?err.message:String(err);
      if(/did not match the expected pattern/i.test(msg)){
        msg='Сервер вернул не JSON (часто HTML-ошибку). Проверьте, что API CMS доступен.';
      }
      toast('Ошибка сохранения: '+msg);
      if(/нет доступа|нет сессии|401/i.test(msg)){
        setTimeout(function(){
          AmirCMS.logout();
          location.href='admin.html';
        }, 1200);
      }
      throw err;
    });
  }

  function isCmsUi(el){
    return !!(el && el.closest && el.closest('.cms-bar,.cms-modal-bg,#cmsPrev'));
  }

  function contentImgs(){
    // Фото врачей живут в docsHtml — не дублируем их в images[]
    return Array.prototype.slice.call(document.querySelectorAll('body img')).filter(function(img){
      return !isCmsUi(img) && !img.closest('.doc-grid');
    });
  }

  /** Карточка .pcard перекрывает <img> градиентом — правим фото через карточку или сам img */
  function resolveImg(el){
    if(!el) return null;
    if(el.tagName==='IMG') return el;
    return el.querySelector('img');
  }

  function cleanNode(el){
    var clone=el.cloneNode(true);
    clone.querySelectorAll('.cms-editable').forEach(stripCms);
    stripCms(clone);
    return clone;
  }

  function stripCms(n){
    if(!n || !n.classList) return;
    n.classList.remove('cms-editable','cms-hot','cms-hidden-mark');
    n.removeAttribute('data-cms-label');
    n.removeAttribute('data-cms-type');
  }

  function cssPath(el){
    if(!el || el.nodeType!==1) return '';
    var parts=[];
    var cur=el;
    while(cur && cur.nodeType===1 && cur!==document.documentElement){
      var tag=cur.tagName.toLowerCase();
      if(cur.id){
        parts.unshift('#'+cur.id.replace(/([^\w-])/g,'\\$1'));
        break;
      }
      var parent=cur.parentElement;
      if(!parent){ parts.unshift(tag); break; }
      var same=0, index=0, kids=parent.children;
      for(var i=0;i<kids.length;i++){
        if(kids[i].tagName===cur.tagName){
          same++;
          if(kids[i]===cur) index=same;
        }
      }
      parts.unshift(same>1 ? tag+':nth-of-type('+index+')' : tag);
      cur=parent;
    }
    return parts.join(' > ');
  }

  /* Разметка для снимка, очищенная от того, что дорисовал скрипт.
     Числа в статистике живут в двух местах: атрибут data-count — исходное
     значение, а текст внутри — то, что нарисовал счётчик. Если снимать
     innerHTML как есть, в снимок попадёт случайный кадр анимации (например
     «3.7» вместо «5.0»), и он будет подставляться при каждой загрузке.
     Поэтому снимаем с клона, вернув числам их исходные значения; живой DOM
     не трогаем, иначе цифра на экране мигнёт. */
  function canonicalHtml(n){
    if(!n) return '';
    if(!n.querySelector('[data-count]')) return n.innerHTML;
    var clone=n.cloneNode(true);
    clone.querySelectorAll('[data-count]').forEach(function(c){
      c.textContent=c.getAttribute('data-count')||c.textContent;
    });
    return clone.innerHTML;
  }

  function queryUniqueTexts(){
    var seen=new Set();
    var items=[];
    function push(n, sel, idx){
      if(!n || isCmsUi(n) || seen.has(n)) return;
      if(n.closest && n.closest('#booking')) return;
      // Стабильный якорь важнее позиционного селектора
      var anchor=n.getAttribute && n.getAttribute('data-cms-text');
      if(anchor){
        sel='[data-cms-text="'+anchor+'"]';
        idx=0;
      }
      seen.add(n);
      items.push({
        sel: sel,
        idx: idx||0,
        html: canonicalHtml(n),
        hidden: n.style.display==='none'
      });
    }
    TEXT_SELECTORS.forEach(function(sel){
      document.querySelectorAll(sel).forEach(function(n, idx){ push(n, sel, idx); });
    });
    // Факты на карточке услуги — с привязкой к slug, чтобы страницы не путали тексты
    document.querySelectorAll('#dirFacts .dp-fact[data-fact-id]').forEach(function(cell){
      var id=cell.getAttribute('data-fact-id');
      var slug=cell.getAttribute('data-service')||'';
      if(!id) return;
      var base='#dirFacts .dp-fact[data-fact-id="'+id+'"]'+(slug?'[data-service="'+slug+'"]':'');
      push(cell.querySelector('b'), base+' > b', 0);
      push(cell.querySelector('span'), base+' > span', 0);
    });
    // Страховка: любой текст, который можно править в админке, обязан попасть в снимок
    document.querySelectorAll('.cms-editable[data-cms-type="text"]').forEach(function(n){
      if(seen.has(n)) return;
      push(n, cssPath(n), 0);
    });
    return items;
  }

  function doctorsToHtml(list){
    return (list||[]).map(function(d){
      var src=normalizeMediaUrl((d.src||d.photo||'').trim());
      if(!src || src==='undefined' || src==='null') src=doctorPlaceholder();
      var name=d.name||'Врач';
      // data-doc связывает карточку с врачом в services-data.js: по нему
      // открывается всплывающая карточка. Без него клик перестаёт работать.
      var link=d.id?' data-doc="'+escAttr(d.id)+'"':'';
      // Рейтинги ПроДокторов подставляются из services-data.js после вставки HTML.
      return '<article class="doc"'+link+'>'+
        '<div class="doc-photo"><img src="'+escAttr(src)+'" alt="'+escAttr(name)+'"></div>'+
        '<div class="doc-body">'+
        '<div class="role">'+(d.role||'').replace(/</g,'&lt;')+'</div>'+
        '<h3>'+name.replace(/</g,'&lt;')+'</h3>'+
        '<div class="exp">'+(d.exp||'').replace(/</g,'&lt;')+'</div>'+
        '<button type="button" class="doc-details">Подробнее о враче</button>'+
        '</div></article>';
    }).join('');
  }

  function servicesToHtml(list){
    return (list||[]).map(function(s){
      var name=s.name||'Услуга';
      var attrs=' data-cat="'+escAttr(s.cat||'therapy')+'" data-name="'+escAttr(name.toLowerCase())+'"';
      if(s.subcat) attrs+=' data-subcat="'+escAttr(s.subcat)+'"';
      if(s.doctor) attrs+=' data-doctor="'+escAttr(s.doctor)+'"';
      return '<div class="prow"'+attrs+'>'+
        '<span class="pn">'+name.replace(/</g,'&lt;')+'</span>'+
        '<span class="ptag">'+(s.tag||'').replace(/</g,'&lt;')+'</span>'+
        '<span class="pp">'+(s.price||'').replace(/</g,'&lt;')+'</span></div>';
    }).join('');
  }

  /* Версия списка врачей. Живёт в разметке (.doc-grid[data-docs-v]) и попадает
     в сохранённый снимок. Если в хранилище лежит снимок с меньшей версией —
     он сделан до правки вёрстки и врачей в нём меньше, чем на странице,
     поэтому применять его нельзя. Первое же сохранение из админки запишет
     актуальный список с новой версией. */
  function docsVersion(){
    var grid=document.querySelector('.doc-grid');
    return grid?parseInt(grid.getAttribute('data-docs-v')||'0',10)||0:0;
  }
  function docsSnapshotIsFresh(snap){
    return (parseInt(snap&&snap.docsV,10)||0) >= docsVersion();
  }

  function collectOneDoctor(el){
    if(!el) return null;
    var prevById={};
    (content && content.doctors || []).forEach(function(d){
      if(d && d.id) prevById[d.id]=d;
    });
    var img=el.querySelector('.doc-photo img, .chief-media img, img');
    var id=el.getAttribute('data-doc')||'';
    var live=(window.AMIR_SERVICES && window.AMIR_SERVICES.doctors && window.AMIR_SERVICES.doctors[id])||{};
    var prev=prevById[id]||{};
    var nameEl=el.querySelector('.doc-body h3, .chief-body h3, h3');
    var roleEl=el.querySelector('.doc-body .role, .chief-body .role, .role');
    var expEl=el.querySelector('.doc-body .exp, .chief-body .exp, .exp');
    return {
      id:id,
      name:(nameEl&&nameEl.textContent.trim())||'',
      role:(roleEl&&roleEl.textContent.trim())||'',
      exp:(expEl&&expEl.textContent.trim())||'',
      src:normalizeMediaUrl((img&&img.getAttribute('src'))||''),
      spec:live.spec!=null&&live.spec!==''?live.spec:(prev.spec||''),
      years:live.years!=null&&live.years!==''?live.years:(prev.years||''),
      bio:Array.isArray(live.bio)?live.bio.slice():(Array.isArray(prev.bio)?prev.bio.slice():[]),
      video:live.video||prev.video||'',
      pdRating:live.pdRating!=null?live.pdRating:prev.pdRating,
      pdReviews:live.pdReviews!=null?live.pdReviews:prev.pdReviews,
      pdUrl:live.pdUrl||prev.pdUrl||'',
      ratingSource:live.ratingSource||prev.ratingSource||'',
      cardHidden:!!el.classList.contains('chief')
    };
  }

  function collectDoctors(){
    var grid=Array.prototype.slice.call(document.querySelectorAll('.doc-grid .doc')).map(collectOneDoctor).filter(Boolean);
    var chief=document.querySelector('#doctors .chief[data-doc]');
    if(chief){
      var c=collectOneDoctor(chief);
      if(c && c.id){
        var idx=-1;
        for(var i=0;i<grid.length;i++){ if(grid[i].id===c.id){ idx=i; break; } }
        if(idx>=0) grid[idx]=Object.assign({}, grid[idx], c, { cardHidden:false });
        else grid.push(c);
      }
    }
    return grid;
  }

  function doctorsForGridHtml(list){
    return (list||[]).filter(function(d){ return d && !d.cardHidden; });
  }

  function applyChiefFromDoctors(list){
    var chief=document.querySelector('#doctors .chief[data-doc]');
    if(!chief || !Array.isArray(list)) return;
    var id=chief.getAttribute('data-doc');
    var d=null;
    for(var i=0;i<list.length;i++){
      if(list[i] && list[i].id===id){ d=list[i]; break; }
    }
    if(!d) return;
    var nameEl=chief.querySelector('.chief-body h3, h3');
    var roleEl=chief.querySelector('.chief-body .role, .role');
    var expEl=chief.querySelector('.chief-body .exp, .exp');
    var img=chief.querySelector('.chief-media img, img');
    if(nameEl && d.name) nameEl.textContent=d.name;
    if(roleEl && d.role) roleEl.textContent=d.role;
    if(expEl && d.exp) expEl.textContent=d.exp;
    if(img && (d.src||d.photo)){
      img.setAttribute('src', d.src||d.photo);
      img.setAttribute('alt', d.name||'');
    }
  }

  function collectServices(root){
    var nodes;
    if(root) nodes=root.querySelectorAll('.prow');
    else nodes=document.querySelectorAll('.price-list .prow');
    return Array.prototype.slice.call(nodes).map(function(el){
      return {
        name:(el.querySelector('.pn')&&el.querySelector('.pn').textContent.trim())||'',
        tag:(el.querySelector('.ptag')&&el.querySelector('.ptag').textContent.trim())||'',
        price:(el.querySelector('.pp')&&el.querySelector('.pp').textContent.trim())||'',
        cat:el.getAttribute('data-cat')||'therapy',
        subcat:el.getAttribute('data-subcat')||'',
        doctor:el.getAttribute('data-doctor')||''
      };
    });
  }

  function mergeServicesByName(baseList, editedList, opts){
    opts=opts||{};
    // master = полный актуальный список (с учётом удалений). Не возвращаем
    // строки, которых в нём уже нет — иначе удаление «откатывается».
    if(opts.master && Array.isArray(opts.master)){
      var byName={};
      (baseList||[]).forEach(function(s){
        var k=(s.name||'').toLowerCase();
        if(k) byName[k]=s;
      });
      (editedList||[]).forEach(function(s){
        var k=(s.name||'').toLowerCase();
        if(k) byName[k]=s;
      });
      return opts.master.map(function(s){
        var k=(s.name||'').toLowerCase();
        return Object.assign({}, byName[k]||s, s);
      }).filter(function(s){ return s && s.name; });
    }
    var out=(baseList||[]).map(function(s){ return Object.assign({}, s); });
    (editedList||[]).forEach(function(ed){
      var key=(ed.name||'').toLowerCase();
      if(!key) return;
      var found=false;
      for(var i=0;i<out.length;i++){
        if((out[i].name||'').toLowerCase()===key){
          out[i]=ed;
          found=true;
          break;
        }
      }
      if(!found) out.push(ed);
    });
    return out;
  }

  function mergeTextItems(oldItems, newItems){
    var map={};
    function key(it){ return String(it.sel)+'#'+String(it.idx||0); }
    (oldItems||[]).forEach(function(it){ if(it&&it.sel) map[key(it)]=it; });
    (newItems||[]).forEach(function(it){ if(it&&it.sel) map[key(it)]=it; });
    return Object.keys(map).map(function(k){ return map[k]; });
  }

  function servicesFromPriceHtml(html){
    if(!html) return [];
    var box=document.createElement('div');
    box.innerHTML=html;
    return Array.prototype.slice.call(box.querySelectorAll('.prow')).map(function(el){
      return {
        name:(el.querySelector('.pn')&&el.querySelector('.pn').textContent.trim())||'',
        tag:(el.querySelector('.ptag')&&el.querySelector('.ptag').textContent.trim())||'',
        price:(el.querySelector('.pp')&&el.querySelector('.pp').textContent.trim())||'',
        cat:el.getAttribute('data-cat')||'therapy',
        subcat:el.getAttribute('data-subcat')||'',
        doctor:el.getAttribute('data-doctor')||''
      };
    });
  }

  function collectServiceGroups(){
    var groups=window.AMIR_SERVICES&&window.AMIR_SERVICES.groups;
    if(!Array.isArray(groups)) return null;
    return groups.map(function(g){
      return {
        title:g.title,
        items:(g.items||[]).map(function(it){
          var row={ slug:it.slug, title:it.title, desc:it.desc||'', doctors:it.doctors?it.doctors.slice():[] };
          if(it.match) row.match=it.match;
          return row;
        })
      };
    });
  }

  function applyServiceGroups(groups){
    if(!Array.isArray(groups) || !window.AMIR_SERVICES) return;
    var prev=window.AMIR_SERVICES.groups||[];
    var mapped=groups.map(function(g){
      return {
        title:g.title,
        items:(g.items||[]).map(function(it){
          var row={ slug:it.slug, title:it.title, desc:it.desc||'', doctors:it.doctors?it.doctors.slice():[] };
          if(it.match) row.match=it.match;
          return row;
        })
      };
    });
    var seen={};
    mapped.forEach(function(g){ seen[g.title]=1; });
    prev.forEach(function(g){
      if(g && g.title && !seen[g.title]) mapped.push(g);
    });
    window.AMIR_SERVICES.groups=mapped;
    if(typeof window.AMIR_rebuildServiceMenus==='function') window.AMIR_rebuildServiceMenus();
  }

  /* Новые врачи из content.json должны попасть в AMIR_SERVICES.doctors —
     иначе страница /uslugi/ не сможет показать карточку по id. */
  function syncDoctorsIntoServicesData(snap){
    if(!snap || !window.AMIR_SERVICES) return;
    if(!window.AMIR_SERVICES.doctors) window.AMIR_SERVICES.doctors={};
    (snap.doctors||[]).forEach(function(d){
      if(!d || !d.id) return;
      var prev=window.AMIR_SERVICES.doctors[d.id]||{};
      var bio=Array.isArray(d.bio)?d.bio:(prev.bio||[]);
      window.AMIR_SERVICES.doctors[d.id]={
        name:d.name||prev.name||'Врач',
        role:d.role||prev.role||'',
        exp:d.exp||prev.exp||'',
        photo:normalizeMediaUrl(d.src||d.photo||prev.photo||''),
        spec:(d.spec!=null&&d.spec!=='')?d.spec:(prev.spec||d.role||''),
        years:(d.years!=null&&d.years!=='')?d.years:(prev.years||''),
        video:(d.video!=null)?d.video:(prev.video||''),
        bio:bio,
        pdRating:d.pdRating!=null?d.pdRating:prev.pdRating,
        pdReviews:d.pdReviews!=null?d.pdReviews:prev.pdReviews,
        pdUrl:d.pdUrl||prev.pdUrl,
        ratingSource:d.ratingSource||prev.ratingSource
      };
    });
  }

  function getDoctorProfile(id){
    if(!id || !window.AMIR_SERVICES || !window.AMIR_SERVICES.doctors) return {};
    return window.AMIR_SERVICES.doctors[id]||{};
  }

  function writeDoctorProfile(id, patch){
    if(!id || !window.AMIR_SERVICES) return;
    if(!window.AMIR_SERVICES.doctors) window.AMIR_SERVICES.doctors={};
    var prev=window.AMIR_SERVICES.doctors[id]||{};
    window.AMIR_SERVICES.doctors[id]=Object.assign({}, prev, patch||{});
  }

  function syncDoctorIntoContent(id, profile){
    if(!id || !profile || !content) return;
    if(!Array.isArray(content.doctors)) content.doctors=[];
    var idx=content.doctors.findIndex(function(d){ return d && d.id===id; });
    var prev=idx>=0?content.doctors[idx]:{id:id};
    var next=Object.assign({}, prev, {
      id:id,
      name:profile.name||prev.name||'Врач',
      role:profile.role!=null?profile.role:(prev.role||''),
      exp:profile.exp!=null?profile.exp:(prev.exp||''),
      src:normalizeMediaUrl(profile.photo||profile.src||prev.src||''),
      spec:profile.spec!=null?profile.spec:(prev.spec||''),
      years:profile.years!=null?profile.years:(prev.years||''),
      video:profile.video!=null?profile.video:(prev.video||''),
      bio:Array.isArray(profile.bio)?profile.bio.slice():(prev.bio||[]),
      pdRating:profile.pdRating!=null?profile.pdRating:prev.pdRating,
      pdReviews:profile.pdReviews!=null?profile.pdReviews:prev.pdReviews,
      pdUrl:profile.pdUrl!=null?profile.pdUrl:(prev.pdUrl||''),
      ratingSource:profile.ratingSource!=null?profile.ratingSource:(prev.ratingSource||'')
    });
    if(idx>=0) content.doctors[idx]=next;
    else content.doctors.push(next);
  }

  function collectBioFromForm(){
    var list=document.getElementById('cmsBioList');
    if(!list) return [];
    return Array.prototype.slice.call(list.querySelectorAll('.cms-bio-row')).map(function(row){
      var year=(row.querySelector('.cms-bio-year')&&row.querySelector('.cms-bio-year').value||'').trim();
      var text=(row.querySelector('.cms-bio-text')&&row.querySelector('.cms-bio-text').value||'').trim();
      return [year, text];
    }).filter(function(pair){ return pair[0]||pair[1]; });
  }

  function autosizeBioText(el){
    if(!el) return;
    el.style.height='auto';
    el.style.height='0px';
    // +4px — запас, иначе нижняя строка иногда обрезается из‑за округления
    var need=Math.max(72, el.scrollHeight+4);
    el.style.height=need+'px';
  }

  function wireBioAutosize(listEl){
    if(!listEl) return;
    listEl.querySelectorAll('.cms-bio-text').forEach(function(ta){
      autosizeBioText(ta);
      if(ta.getAttribute('data-autosize')==='1') return;
      ta.setAttribute('data-autosize','1');
      ta.addEventListener('input', function(){ autosizeBioText(ta); });
    });
  }

  function renderBioEditor(listEl, bio){
    if(!listEl) return;
    var rows=Array.isArray(bio)&&bio.length?bio:[['', '']];
    listEl.innerHTML=rows.map(function(pair, i){
      return '<div class="cms-bio-row" data-i="'+i+'">'+
        '<input class="cms-bio-year" type="text" placeholder="Год" value="'+escAttr(pair[0]||'')+'">'+
        '<textarea class="cms-bio-text" rows="2" placeholder="Образование, курс, практика…">'+escHtml(pair[1]||'')+'</textarea>'+
        '<button type="button" class="btn btn-ghost cms-bio-del" aria-label="Удалить запись">×</button>'+
      '</div>';
    }).join('');
    listEl.querySelectorAll('.cms-bio-del').forEach(function(btn){
      btn.onclick=function(){
        var row=btn.closest('.cms-bio-row');
        if(!row) return;
        row.remove();
        if(!listEl.querySelector('.cms-bio-row')){
          renderBioEditor(listEl, [['', '']]);
        }
      };
    });
    wireBioAutosize(listEl);
    // После открытия модалки ширина поля становится финальной — пересчитать переносы
    requestAnimationFrame(function(){
      wireBioAutosize(listEl);
      setTimeout(function(){ wireBioAutosize(listEl); }, 80);
    });
  }

  /* Врач из строки прайса (data-doctor + data-subcat) → в список врачей подкатегории. */
  function syncSubcatDoctorsFromServices(list){
    (list||[]).forEach(function(s){
      if(s && s.subcat && s.doctor) ensureDoctorOnSubcat(s.subcat, s.doctor);
    });
  }

  function findServiceGroupByCat(cat){
    var title=groupCatLabel(cat);
    var groups=window.AMIR_SERVICES&&window.AMIR_SERVICES.groups;
    if(!groups) return null;
    for(var i=0;i<groups.length;i++){
      if(groups[i].title===title) return groups[i];
    }
    return null;
  }

  function slugifyService(name){
    var map={
      а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',
      к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',
      х:'h',ц:'c',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya'
    };
    var s=String(name||'').toLowerCase().replace(/[а-яё]/g,function(ch){ return map[ch]||''; });
    s=s.replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').replace(/-+/g,'-');
    return s||'usluga';
  }

  function uniqueServiceSlug(base){
    var slug=base;
    var n=2;
    while(true){
      var taken=false;
      var groups=window.AMIR_SERVICES.groups||[];
      for(var g=0;g<groups.length && !taken;g++){
        var items=groups[g].items||[];
        for(var i=0;i<items.length;i++){
          if(items[i].slug===slug){ taken=true; break; }
        }
      }
      if(!taken) return slug;
      slug=base+'-'+n;
      n++;
    }
  }

  function flatServiceItems(){
    var out=[];
    var groups=window.AMIR_SERVICES&&window.AMIR_SERVICES.groups||[];
    groups.forEach(function(g, gi){
      (g.items||[]).forEach(function(it, ii){
        out.push({ groupIndex:gi, itemIndex:ii, groupTitle:g.title, item:it });
      });
    });
    return out;
  }

  function buildSnapshot(){
    var snap={ v:4, savedAt:new Date().toISOString() };

    // Карточка услуги: не перезаписываем весь сайт урезанным DOM
    if(isServicePage()){
      var base=content&&typeof content==='object'?content:{ v:4 };
      snap=Object.assign({}, base, snap);
      snap.textItems=mergeTextItems(base.textItems, queryUniqueTexts());
      var dirList=document.getElementById('dirList');
      var edited=dirList?collectServices(dirList):[];
      var baseServices=Array.isArray(base.services)&&base.services.length
        ? base.services
        : servicesFromPriceHtml(base.priceHtml);
      snap.services=mergeServicesByName(baseServices, edited);
      delete snap.priceHtml;
      if(Array.isArray(base.doctors)) snap.doctors=base.doctors;
      if(typeof base.docsHtml==='string') snap.docsHtml=base.docsHtml;
      if(base.docsV!=null) snap.docsV=base.docsV;
      if(Array.isArray(base.images)) snap.images=base.images;
      if(Array.isArray(base.reels)) snap.reels=base.reels;
      // Название и описание с карточки → в serviceGroups (иначе desc пропадает)
      syncServicePageContentToGroups();
      var liveGroups=collectServiceGroups();
      if(liveGroups){
        snap.serviceGroups=liveGroups;
        content.serviceGroups=liveGroups;
      } else if(Array.isArray(base.serviceGroups)){
        snap.serviceGroups=base.serviceGroups;
      }
      return snap;
    }

    snap.images=contentImgs().map(function(img){
      return { src:img.getAttribute('src')||'', alt:img.getAttribute('alt')||'' };
    });

    snap.reels=Array.prototype.slice.call(document.querySelectorAll('.reel')).map(function(r){
      var poster=r.querySelector('.reel-poster');
      var cap=r.querySelector('.reel-cap');
      var bg=(poster&&poster.style.backgroundImage||'').replace(/^url\(["']?/,'').replace(/["']?\)$/,'');
      return {
        video:r.getAttribute('data-video')||'',
        poster:bg,
        captionHtml:cap?cap.innerHTML:''
      };
    });

    snap.doctors=collectDoctors();
    // На страницах без блока врачей (например prices.html) не затираем список
    if(!snap.doctors.length && content && Array.isArray(content.doctors) && content.doctors.length){
      snap.doctors=content.doctors;
    }
    // Прайс: память — источник правды после правок админки (в т.ч. удалений)
    var collectedServices=collectServices();
    var memServices=(content && Array.isArray(content.services)) ? content.services : [];
    if(dirty && memServices){
      snap.services=memServices.slice();
    } else if(memServices.length && collectedServices.length){
      snap.services=mergeServicesByName(collectedServices, memServices, { master:memServices });
    } else if(memServices.length){
      snap.services=memServices.slice();
    } else if(collectedServices.length){
      snap.services=collectedServices;
    } else {
      snap.services=[];
    }
    content.services=snap.services;
    delete content.priceHtml;
    // Врач услуги → в подкатегорию до сбора групп
    syncSubcatDoctorsFromServices(snap.services);
    snap.serviceGroups=collectServiceGroups();
    snap.docsV=docsVersion();
    if(!snap.docsV && content && content.docsV!=null) snap.docsV=content.docsV;
    snap.docsHtml=doctorsToHtml(doctorsForGridHtml(snap.doctors));

    snap.textItems=queryUniqueTexts();

    snap.hiddenBlocks=[];
    ['.why-grid .pcard','.rev-track > .rev:not(.rev-clone)','.steps-grid .step','.reel'].forEach(function(sel){
      document.querySelectorAll(sel).forEach(function(n, idx){
        if(n.style.display==='none') snap.hiddenBlocks.push({ sel:sel, idx:idx });
      });
    });

    return snap;
  }

  function applySnapshot(snap){
    if(!snap || typeof snap!=='object') return;
    var servicePage=isServicePage();

    // Полный прайс только вне карточки услуги
    if(!servicePage){
      var list=mainPriceList();
      if(list){
        if(Array.isArray(snap.services)) list.innerHTML=servicesToHtml(snap.services);
        else if(typeof snap.priceHtml==='string') list.innerHTML=snap.priceHtml;
      }

      // Снимок старше вёрстки не применяем: в нём нет врачей, добавленных
      // в разметку позже, и подмена молча стёрла бы их со страницы.
      if(docsSnapshotIsFresh(snap)){
        if(Array.isArray(snap.doctors)){
          var docs=document.querySelector('.doc-grid');
          if(docs) docs.innerHTML=doctorsToHtml(doctorsForGridHtml(snap.doctors));
        } else if(typeof snap.docsHtml==='string'){
          var docs2=document.querySelector('.doc-grid');
          if(docs2) docs2.innerHTML=snap.docsHtml;
        }
      }
    }

    if(Array.isArray(snap.serviceGroups)) applyServiceGroups(snap.serviceGroups);
    syncDoctorsIntoServicesData(snap);
    applyChiefFromDoctors(snap.doctors);
    if(Array.isArray(snap.services)) syncSubcatDoctorsFromServices(snap.services);

    // 2) texts (unique items)
    var textItems=snap.textItems;
    if(!textItems && snap.texts){
      // migrate v2 format
      textItems=[];
      Object.keys(snap.texts).forEach(function(sel){
        (snap.texts[sel]||[]).forEach(function(item, idx){
          textItems.push({ sel:sel, idx:idx, html:item.html, hidden:!!item.hidden });
        });
      });
    }
    if(Array.isArray(textItems)){
      textItems.forEach(function(item){
        if(!item || !item.sel) return;
        // Название/описание/направление услуги всегда из serviceGroups, не из снимка текста
        if(servicePage && (item.sel==='#dirTitle' || item.sel==='#dirDesc' || item.sel==='#dirGroup' || item.sel==='#dirDocRole' || item.sel==='#dirDocName' || item.sel==='#dirDocExp')) return;
        var n=null;
        try{
          var nodes=document.querySelectorAll(item.sel);
          n=nodes[item.idx||0]||null;
        }catch(e){ n=null; }
        if(!n) return;
        if(typeof item.html==='string') n.innerHTML=item.html;
        if(item.hidden) n.style.display='none';
        else if(n.style.display==='none') n.style.display='';
      });
    }

    // 3) images / reels — не на карточке услуги (другие наборы img)
    if(!servicePage){
      if(Array.isArray(snap.images)){
        var imgs=contentImgs();
        snap.images.forEach(function(item, i){
          if(!imgs[i] || !item) return;
          if(item.src!=null && item.src!=='') imgs[i].setAttribute('src', item.src);
          if(item.alt!=null) imgs[i].setAttribute('alt', item.alt);
        });
      }

      if(Array.isArray(snap.reels)){
        var reels=document.querySelectorAll('.reel');
        snap.reels.forEach(function(item, i){
          var r=reels[i];
          if(!r || !item) return;
          r.setAttribute('data-video', item.video||'');
          var poster=r.querySelector('.reel-poster');
          if(poster && item.poster) poster.style.backgroundImage="url('"+item.poster+"')";
          var cap=r.querySelector('.reel-cap');
          if(cap && typeof item.captionHtml==='string') cap.innerHTML=item.captionHtml;
        });
        if(typeof window.AMIR_syncReels==='function') window.AMIR_syncReels();
      }
    }

    // 5) hidden blocks
    if(Array.isArray(snap.hiddenBlocks)){
      snap.hiddenBlocks.forEach(function(h){
        var nodes=document.querySelectorAll(h.sel);
        if(nodes[h.idx]) nodes[h.idx].style.display='none';
      });
    }

    // legacy v2 blocks: only apply hidden, skip html overwrite (that caused chaos)
    if(snap.blocks){
      Object.keys(snap.blocks).forEach(function(sel){
        (snap.blocks[sel]||[]).forEach(function(item, i){
          var n=document.querySelectorAll(sel)[i];
          if(!n || !item) return;
          if(item.removed) n.remove();
          else if(item.hidden) n.style.display='none';
        });
      });
    }

    if(typeof window.AMIR_applyDocRatings==='function') window.AMIR_applyDocRatings();
    if(typeof window.AMIR_initCountUps==='function') window.AMIR_initCountUps();
    try{ document.dispatchEvent(new CustomEvent('amir:cms-content-ready',{detail:snap})); }catch(e){}
  }

  function markEditable(el, label, type){
    if(!el || isCmsUi(el)) return;
    el.classList.add('cms-editable');
    el.setAttribute('data-cms-label', label||'Редактировать');
    el.setAttribute('data-cms-type', type||'block');
  }

  function paintEditable(el){
    if(!el || !el.style) return;
    el.style.setProperty('outline', '2px dashed #b39a6b', 'important');
    el.style.setProperty('outline-offset', '4px', 'important');
    el.style.setProperty('cursor', 'pointer', 'important');
    el.setAttribute('title', 'Нажмите, чтобы изменить');
  }

  function wireServicePageEditor(){
    if(!isServicePage()) return;
    var pairs=[
      ['#dirTitle', 'text', 'Название'],
      ['#dirDesc', 'text', 'Описание'],
      ['#dirGroup', 'text', 'Направление'],
      ['#dirDocName', 'text', 'ФИО врача'],
      ['#dirDocRole', 'text', 'Специализация'],
      ['#dirDocExp', 'text', 'Опыт'],
      ['#dirDocImg', 'image', 'Фото врача']
    ];
    pairs.forEach(function(p){
      var el=document.querySelector(p[0]);
      if(!el) return;
      markEditable(el, p[2], p[1]);
      paintEditable(el);
    });
    refreshDirDescPlaceholder();
    document.querySelectorAll('.dp-perks li, #dirSteps .dp-step h3, #dirSteps .dp-step p, #dirFacts .dp-fact b, #dirFacts .dp-fact span, #dirInfo > h3, #dirInfo > p, .dp-h2').forEach(function(el){
      markEditable(el, 'Текст', 'text');
      paintEditable(el);
    });
    document.querySelectorAll('#dirList .prow').forEach(function(el){
      markEditable(el, 'Услуга', 'price');
      paintEditable(el);
    });
    var page=document.getElementById('dirPage');
    if(page && !page.getAttribute('data-cms-wired')){
      page.setAttribute('data-cms-wired', '1');
      page.addEventListener('click', function(e){
        if(!document.body.classList.contains('cms-admin')) return;
        if(e.target.closest('a.btn, a.dp-doc-btn, a.dp-phone, a.dp-info-wa, #booking, .cms-bar, .cms-modal-bg')) return;
        var el=e.target.closest('.cms-editable');
        if(!el) return;
        e.preventDefault();
        e.stopPropagation();
        openModal(el);
      }, true);
    }
  }

  function wireTargets(){
    // Фото внутри .pcard перекрыты ::after/.cap — кликабельна сама карточка
    contentImgs().forEach(function(img){
      if(img.closest('.pcard')) return;
      if(img.id==='dirDocImg') return; // страница услуги — отдельно
      markEditable(img, 'Фото', 'image');
    });
    document.querySelectorAll('.pcard:not(.solid)').forEach(function(card){
      if(resolveImg(card)) markEditable(card, 'Фото', 'image');
    });
    document.querySelectorAll('.reel').forEach(function(r){ markEditable(r, 'Видео', 'video'); });
    document.querySelectorAll('.prow').forEach(function(r){
      if(r.closest('#dirList')) return;
      markEditable(r, 'Услуга', 'price');
    });
    document.querySelectorAll('.doc-grid .doc, #doctors .chief[data-doc]').forEach(function(r){ markEditable(r, 'Врач', 'doctor'); });

    TEXT_SELECTORS.forEach(function(sel){
      document.querySelectorAll(sel).forEach(function(el){
        if(el.closest('#booking')) return;
        markEditable(el, 'Текст', 'text');
        if(el.closest('#dirPage')) paintEditable(el);
      });
    });
    wireServicePageEditor();
  }

  function enableAdminUi(){
    if(document.body.classList.contains('cms-admin')){
      wireTargets();
      if(typeof window.AMIR_syncReels==='function') window.AMIR_syncReels();
      return;
    }
    document.body.classList.add('cms-admin');
    buildBar();
    buildModal();
    wireTargets();
    document.addEventListener('click', onAdminClick, true);
    // Пустая секция видеоотзывов снова видна — чтобы вставить ссылки
    if(typeof window.AMIR_syncReels==='function') window.AMIR_syncReels();
  }

  function addPriceRow(list, data){
    list=list||document.querySelector('.price-list');
    if(!list){ return null; }
    data=data||{};
    var name=data.name||'Новая услуга';
    var tag=data.tag||'Терапия';
    var price=data.price||'0 ₽';
    var cat=data.cat||'therapy';
    var row=document.createElement('div');
    row.className='prow';
    row.dataset.cat=cat;
    row.dataset.name=String(name).toLowerCase();
    if(data.subcat) row.setAttribute('data-subcat', data.subcat);
    if(data.doctor) row.setAttribute('data-doctor', data.doctor);
    row.innerHTML='<span class="pn"></span><span class="ptag"></span><span class="pp"></span>';
    row.querySelector('.pn').textContent=name;
    row.querySelector('.ptag').textContent=tag;
    row.querySelector('.pp').textContent=price;
    markEditable(row,'Услуга','price');
    var empty=list.querySelector('#priceEmpty');
    var first=list.querySelector('.prow');
    if(first) list.insertBefore(row, first);
    else if(empty) list.insertBefore(row, empty);
    else list.appendChild(row);
    return row;
  }

  function doctorPlaceholder(){
    var svg='<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><rect fill="#e8e0d4" width="100%" height="100%"/><text x="50%" y="50%" text-anchor="middle" fill="#9c7f4b" font-family="sans-serif" font-size="22">Фото</text></svg>';
    return 'data:image/svg+xml,'+encodeURIComponent(svg);
  }

  function uniqueDoctorId(name){
    var base=slugifyService(name||'vrach');
    var id=base;
    var n=2;
    var docs=(window.AMIR_SERVICES&&window.AMIR_SERVICES.doctors)||{};
    while(docs[id] || document.querySelector('[data-doc="'+id+'"]')){
      id=base+'-'+n;
      n++;
    }
    return id;
  }
  function bumpDocsVersion(){
    var grid=document.querySelector('.doc-grid');
    if(!grid) return;
    var v=(parseInt(grid.getAttribute('data-docs-v')||'0',10)||0)+1;
    grid.setAttribute('data-docs-v', String(v));
  }
  function addDoctor(grid, data){
    grid=grid||document.querySelector('.doc-grid');
    if(!grid){ alert('Блок врачей не найден'); return null; }
    data=data||{};
    var name=data.name||'Новый врач';
    var role=data.role||'Специализация';
    var exp=data.exp||'Опыт работы';
    var src=normalizeMediaUrl(data.src||'')||doctorPlaceholder();
    var id=data.id||uniqueDoctorId(name);
    var art=document.createElement('article');
    art.className='doc';
    art.setAttribute('data-doc', id);
    art.setAttribute('tabindex', '0');
    art.setAttribute('role', 'button');
    art.setAttribute('aria-haspopup', 'dialog');
    art.innerHTML=
      '<div class="doc-photo"><img alt=""></div>'+
      '<div class="doc-body">'+
        '<div class="role"></div>'+
        '<h3></h3>'+
        '<div class="exp"></div>'+
      '</div>';
    var img=art.querySelector('img');
    img.src=src;
    img.alt=name;
    art.querySelector('.role').textContent=role;
    art.querySelector('h3').textContent=name;
    art.querySelector('.exp').textContent=exp;
    markEditable(art,'Врач','doctor');
    grid.appendChild(art);
    bumpDocsVersion();
    if(window.AMIR_SERVICES){
      if(!window.AMIR_SERVICES.doctors) window.AMIR_SERVICES.doctors={};
      var profile={
        name:name,
        role:role,
        exp:exp,
        photo:src,
        spec:data.spec||role,
        years:data.years||'',
        video:'',
        bio:Array.isArray(data.bio)?data.bio:[]
      };
      if(data.pdRating!=null) profile.pdRating=data.pdRating;
      if(data.pdReviews!=null) profile.pdReviews=data.pdReviews;
      if(data.pdUrl) profile.pdUrl=data.pdUrl;
      if(data.ratingSource) profile.ratingSource=data.ratingSource;
      window.AMIR_SERVICES.doctors[id]=profile;
    }
    if(typeof window.AMIR_applyDocRatings==='function') window.AMIR_applyDocRatings();
    return art;
  }
  function ensureDoctorOnSubcat(subcat, doctorId){
    if(!subcat || !doctorId || !window.AMIR_SERVICES || !window.AMIR_SERVICES.groups) return;
    window.AMIR_SERVICES.groups.forEach(function(g){
      (g.items||[]).forEach(function(it){
        if(it.slug!==subcat) return;
        if(!it.doctors) it.doctors=[];
        if(it.doctors.indexOf(doctorId)<0) it.doctors.unshift(doctorId);
      });
    });
    if(typeof window.AMIR_rebuildServiceMenus==='function') window.AMIR_rebuildServiceMenus();
  }

  /* Полное удаление врача: сетка, профиль, все услуги направлений, прайс. */
  function purgeDoctorEverywhere(doctorId){
    if(!doctorId) return;
    var safe=String(doctorId).replace(/"/g,'');

    document.querySelectorAll('[data-doc="'+safe+'"]').forEach(function(el){
      if(el.classList.contains('chief')){
        el.style.display='none';
        el.removeAttribute('data-doc');
      } else {
        el.remove();
      }
    });

    if(window.AMIR_SERVICES && window.AMIR_SERVICES.doctors){
      delete window.AMIR_SERVICES.doctors[doctorId];
    }

    if(window.AMIR_SERVICES && Array.isArray(window.AMIR_SERVICES.groups)){
      window.AMIR_SERVICES.groups.forEach(function(g){
        (g.items||[]).forEach(function(it){
          if(!it.doctors || !it.doctors.length) return;
          it.doctors=it.doctors.filter(function(id){ return id!==doctorId; });
        });
      });
    }

    if(Array.isArray(content.doctors)){
      content.doctors=content.doctors.filter(function(d){ return d && d.id!==doctorId; });
    }
    var groups=collectServiceGroups();
    if(groups) content.serviceGroups=groups;

    if(Array.isArray(content.services)){
      content.services.forEach(function(s){
        if(s && s.doctor===doctorId) s.doctor='';
      });
      content.priceHtml=servicesToHtml(content.services);
    }
    document.querySelectorAll('.prow[data-doctor="'+safe+'"]').forEach(function(r){
      r.removeAttribute('data-doctor');
    });

    if(Array.isArray(content.doctors)){
      content.docsHtml=doctorsToHtml(doctorsForGridHtml(content.doctors));
      content.docsV=(parseInt(content.docsV,10)||0)+1;
    }

    if(typeof window.AMIR_rebuildServiceMenus==='function') window.AMIR_rebuildServiceMenus();
    if(typeof window.AMIR_applyDocRatings==='function') window.AMIR_applyDocRatings();
  }

  /* Врачи по умолчанию для новой услуги — как у соседних в том же направлении. */
  function defaultDoctorsForGroup(group){
    var items=(group&&group.items)||[];
    for(var i=0;i<items.length;i++){
      if(items[i].doctors && items[i].doctors.length) return items[i].doctors.slice();
    }
    return [];
  }

  function addServiceToDirection(cat, title, doctorIds){
    var group=findServiceGroupByCat(cat);
    if(!group) return null;
    if(!group.items) group.items=[];
    var slug=uniqueServiceSlug(slugifyService(title));
    var doctors=Array.isArray(doctorIds)
      ? doctorIds.filter(Boolean)
      : (doctorIds ? [doctorIds] : []);
    if(!doctors.length) doctors=defaultDoctorsForGroup(group);
    var item={
      slug:slug,
      title:title,
      desc:'',
      doctors:doctors
    };
    group.items.push(item);
    if(typeof window.AMIR_rebuildServiceMenus==='function') window.AMIR_rebuildServiceMenus();
    return item;
  }

  function removeServiceFromDirection(slug){
    if(!slug || !window.AMIR_SERVICES || !window.AMIR_SERVICES.groups) return false;
    var groups=window.AMIR_SERVICES.groups;
    for(var g=0;g<groups.length;g++){
      var items=groups[g].items||[];
      for(var i=0;i<items.length;i++){
        if(items[i].slug===slug){
          items.splice(i,1);
          if(typeof window.AMIR_rebuildServiceMenus==='function') window.AMIR_rebuildServiceMenus();
          return true;
        }
      }
    }
    return false;
  }

  function catKeyFromGroupTitle(title){
    if(title==='Ортодонтия') return 'ortho';
    if(title==='Космеология') return 'cosmo';
    if(title==='Медицина') return 'med';
    return 'stoma';
  }

  function findServiceFlatBySlug(slug){
    var rows=flatServiceItems();
    for(var i=0;i<rows.length;i++){
      if(rows[i].item && rows[i].item.slug===slug) return rows[i];
    }
    return null;
  }

  /* Обновить услугу: название, направление (можно перенести в другую колонку), врачи. */
  function updateServiceInDirection(slug, patch){
    var found=findServiceFlatBySlug(slug);
    if(!found || !found.item) return null;
    var item=found.item;
    var groups=window.AMIR_SERVICES.groups||[];
    var oldGroup=groups[found.groupIndex];
    if(!oldGroup) return null;
    if(patch && patch.title!=null) item.title=String(patch.title).trim()||item.title;
    if(patch && Array.isArray(patch.doctors)) item.doctors=patch.doctors.filter(Boolean);
    var newCat=patch && patch.cat ? groupCatKey(patch.cat) : catKeyFromGroupTitle(found.groupTitle);
    var newGroup=findServiceGroupByCat(newCat);
    if(!newGroup) return null;
    if(newGroup!==oldGroup){
      var idx=(oldGroup.items||[]).indexOf(item);
      if(idx<0) idx=found.itemIndex;
      if(idx>=0) oldGroup.items.splice(idx,1);
      if(!newGroup.items) newGroup.items=[];
      newGroup.items.push(item);
    }
    if(typeof window.AMIR_rebuildServiceMenus==='function') window.AMIR_rebuildServiceMenus();
    return item;
  }

  function catOptions(selected){
    return [
      ['ortho','Ортодонтия'],['therapy','Терапия'],['hygiene','Гигиена'],
      ['surgery','Хирургия'],['implant','Имплантация'],['prosth','Протезирование'],
      ['paro','Пародонтология'],['kids','Детская'],['cosmo','Космеология'],['med','Медицина']
    ].map(function(p){ return opt(p[0],p[1],selected); }).join('');
  }

  /* Специализации врачей — только из списка, без свободного ввода. */
  var DOCTOR_ROLES=[
    'Ортодонтия',
    'Терапия',
    'Терапия · дети',
    'Хирургия',
    'Имплантация',
    'Протезирование',
    'Пародонтология',
    'Гигиена',
    'Косметология',
    'Кардиология',
    'Главный врач клиники'
  ];
  function doctorRoleOptions(selected){
    var cur=String(selected||'').trim();
    var roles=DOCTOR_ROLES.slice();
    if(cur && roles.indexOf(cur)<0) roles.unshift(cur);
    if(!cur) cur=roles[0]||'';
    return roles.map(function(r){ return opt(r, r, cur); }).join('');
  }

  /* На карточке опыт хранится одной строкой «Должность · N лет» — в форме делим. */
  function splitDocExp(text){
    var s=String(text||'').trim();
    if(!s) return { title:'', years:'' };
    var parts=s.split(/\s*[·•|]\s*/).map(function(p){ return p.trim(); }).filter(Boolean);
    if(parts.length>=2){
      return { title:parts[0], years:parts.slice(1).join(' · ') };
    }
    if(/^\d+\s*лет/i.test(s)) return { title:'', years:s };
    return { title:s, years:'' };
  }
  function joinDocExp(title, years){
    title=String(title||'').trim();
    years=String(years||'').trim();
    if(title && years) return title+' · '+years;
    return title||years||'Опыт работы';
  }

  /* Главные направления сайта — ими выбирают категорию при добавлении услуги. */
  function groupCatKey(cat){
    if(cat==='ortho') return 'ortho';
    if(cat==='cosmo') return 'cosmo';
    if(cat==='med') return 'med';
    return 'stoma';
  }
  function groupCatLabel(cat){
    if(cat==='ortho') return 'Ортодонтия';
    if(cat==='cosmo') return 'Космеология';
    if(cat==='med') return 'Медицина';
    return 'Стоматология';
  }
  function groupCatOptions(selectedCat){
    var cur=groupCatKey(selectedCat||'stoma');
    return [
      ['ortho','Ортодонтия'],
      ['stoma','Стоматология'],
      ['cosmo','Космеология'],
      ['med','Медицина']
    ].map(function(p){ return opt(p[0],p[1],cur); }).join('');
  }
  function groupCatToPriceCat(cat){
    // Уже детальная категория прайса (kids, therapy, med…) — не трогаем.
    var c=String(cat||'').trim();
    if(c==='ortho' || c==='cosmo' || c==='med') return c;
    if(c==='therapy' || c==='hygiene' || c==='surgery' || c==='implant' ||
       c==='prosth' || c==='paro' || c==='kids' || c==='stoma') return c;
    return 'therapy';
  }

  function priceCatForServiceSlug(slug){
    var found=findServiceFlatBySlug(slug);
    if(found && found.item && found.item.match && found.item.match.cat){
      return found.item.match.cat;
    }
    return groupCatToPriceCat(catKeyFromGroupTitle(found && found.groupTitle));
  }
  function subcatsForGroup(cat){
    var group=findServiceGroupByCat(cat);
    return (group&&group.items)||[];
  }
  function subcatTitleBySlug(slug){
    var groups=window.AMIR_SERVICES&&window.AMIR_SERVICES.groups||[];
    for(var g=0;g<groups.length;g++){
      var items=groups[g].items||[];
      for(var i=0;i<items.length;i++){
        if(items[i].slug===slug) return items[i].title;
      }
    }
    return slug||'';
  }
  function doctorNameById(id){
    if(!id) return '';
    var d=window.AMIR_SERVICES&&window.AMIR_SERVICES.doctors&&window.AMIR_SERVICES.doctors[id];
    if(d&&d.name) return d.name;
    var card=document.querySelector('.doc-grid .doc[data-doc="'+id+'"], .chief[data-doc="'+id+'"]');
    if(card){
      var h=card.querySelector('h3');
      if(h) return h.textContent.trim();
    }
    return id;
  }
  function collectDoctorNames(){
    var docs=window.AMIR_SERVICES&&window.AMIR_SERVICES.doctors||{};
    var names={};
    Object.keys(docs).forEach(function(id){ names[id]=docs[id].name||id; });
    document.querySelectorAll('.doc-grid .doc[data-doc], .chief[data-doc]').forEach(function(el){
      var id=el.getAttribute('data-doc');
      if(!id) return;
      var h=el.querySelector('h3');
      names[id]=(h&&h.textContent.trim())||names[id]||id;
      if(!docs[id]){
        docs[id]={
          name:names[id],
          role:(el.querySelector('.role')&&el.querySelector('.role').textContent.trim())||'',
          exp:(el.querySelector('.exp')&&el.querySelector('.exp').textContent.trim())||'',
          photo:(el.querySelector('img')&&el.querySelector('img').getAttribute('src'))||'',
          spec:'', years:'', video:'', bio:[]
        };
      }
    });
    return names;
  }

  /* Врачи направления — сначала те, кто уже указан у услуг этой колонки. */
  function preferredDoctorsForCat(cat){
    var group=findServiceGroupByCat(cat);
    var preferred=[];
    ((group&&group.items)||[]).forEach(function(it){
      (it.doctors||[]).forEach(function(id){
        if(preferred.indexOf(id)<0) preferred.push(id);
      });
    });
    return preferred;
  }

  function doctorSelectOptions(subcatSlug, selected){
    var names=collectDoctorNames();
    var preferred=[];
    var groups=window.AMIR_SERVICES&&window.AMIR_SERVICES.groups||[];
    for(var g=0;g<groups.length;g++){
      var items=groups[g].items||[];
      for(var i=0;i<items.length;i++){
        if(items[i].slug===subcatSlug && items[i].doctors) preferred=items[i].doctors.slice();
      }
    }
    var ids=[];
    preferred.forEach(function(id){ if(names[id] && ids.indexOf(id)<0) ids.push(id); });
    Object.keys(names).forEach(function(id){ if(ids.indexOf(id)<0) ids.push(id); });
    if(!ids.length) return '<option value="">Нет врачей</option>';
    return ids.map(function(id){
      return opt(id, names[id]||id, selected||preferred[0]||'');
    }).join('');
  }

  function doctorSelectOptionsForCat(cat, selected){
    var names=collectDoctorNames();
    var preferred=preferredDoctorsForCat(cat);
    var ids=[];
    preferred.forEach(function(id){ if(names[id] && ids.indexOf(id)<0) ids.push(id); });
    Object.keys(names).forEach(function(id){ if(ids.indexOf(id)<0) ids.push(id); });
    if(!ids.length) return '<option value="">Нет врачей</option>';
    var cur=selected && names[selected]?selected:(preferred[0]||ids[0]||'');
    return ids.map(function(id){
      return opt(id, names[id]||id, cur);
    }).join('');
  }

  /* Чекбоксы: можно отметить нескольких врачей на одну услугу. */
  function doctorIdsForCat(cat){
    var names=collectDoctorNames();
    var preferred=preferredDoctorsForCat(cat);
    var ids=[];
    preferred.forEach(function(id){ if(names[id] && ids.indexOf(id)<0) ids.push(id); });
    Object.keys(names).forEach(function(id){ if(ids.indexOf(id)<0) ids.push(id); });
    return ids;
  }

  function doctorChecklistHtmlForCat(cat, selectedIds, listId){
    var names=collectDoctorNames();
    var ids=doctorIdsForCat(cat);
    var selected=Array.isArray(selectedIds)?selectedIds.slice():[];
    var idAttr=listId||'cmsNewSvcDoctors';
    if(!ids.length) return '<p class="sub" style="margin:0">Нет врачей</p>';
    return '<div class="cms-doc-checkList" id="'+escAttr(idAttr)+'">'+ids.map(function(id){
      var checked=selected.indexOf(id)>=0?' checked':'';
      return '<label class="cms-doc-check">'+
        '<input type="checkbox" value="'+escAttr(id)+'"'+checked+'>'+
        '<span>'+escHtml(names[id]||id)+'</span>'+
      '</label>';
    }).join('')+'</div>';
  }

  function readSelectedDoctorIds(rootId){
    var box=document.getElementById(rootId||'cmsNewSvcDoctors');
    if(!box) return [];
    return Array.prototype.slice.call(box.querySelectorAll('input[type="checkbox"]:checked'))
      .map(function(inp){ return inp.value; })
      .filter(Boolean);
  }
  function getEditableServices(){
    var fromDom=collectServices();
    if(fromDom.length) return fromDom;
    if(Array.isArray(content.services) && content.services.length) return content.services.slice();
    return [];
  }
  function setEditableServices(list){
    content.services=Array.isArray(list)?list.slice():[];
    content.priceHtml=servicesToHtml(content.services);
    var priceList=mainPriceList();
    if(priceList) priceList.innerHTML=content.priceHtml;
  }
  function hydrateServicesForAdmin(done){
    var local=Array.isArray(content.services)?content.services.slice():[];
    // Несохранённые правки (добавление/удаление) важнее сервера и DOM
    if(dirty){
      done(local);
      return;
    }
    var priceList=mainPriceList();
    if(priceList && priceList.querySelector('.prow') && local.length){
      // DOM может содержать старые строки — берём состав из memory, цены подтягиваем из DOM
      done(mergeServicesByName(collectServices(), local, { master:local }));
      return;
    }
    if(priceList && priceList.querySelector('.prow') && !local.length){
      done(collectServices());
      return;
    }
    if(local.length){
      done(local);
      return;
    }
    Promise.all([
      fetch('/assets/prices.json?ts='+Date.now(),{cache:'no-store'}).then(function(r){ return r.ok?r.json():null; }).catch(function(){ return null; }),
      fetch('/api/cms/content?ts='+Date.now(),{cache:'no-store'}).then(function(r){ return r.ok?r.json():null; }).catch(function(){ return null; })
    ]).then(function(pair){
      var pricesFile=pair[0], saved=pair[1];
      var base=[];
      if(pricesFile && Array.isArray(pricesFile.services)) base=pricesFile.services.slice();
      var edited=local;
      if(saved){
        var fromSaved=[];
        if(Array.isArray(saved.services) && saved.services.length) fromSaved=saved.services;
        else if(typeof saved.priceHtml==='string') fromSaved=servicesFromPriceHtml(saved.priceHtml);
        edited=mergeServicesByName(fromSaved, local, { master:fromSaved.length?fromSaved:null });
      }
      var master=edited.length?edited:null;
      var merged=mergeServicesByName(base, edited, { master:master });
      content.services=merged;
      content.priceHtml=servicesToHtml(merged);
      done(merged);
    }).catch(function(){ done(local); });
  }

  function openDocsServicesPanel(tab){
    tab=tab||'services';
    panelMode='manage';
    currentEl=null;
    var modal=document.getElementById('cmsModal');
    var box=modal.querySelector('.cms-modal');
    box.classList.add('cms-modal-wide');
    document.getElementById('cmsModalTitle').textContent=tab==='doctors'?'Врачи':'Услуги';
    document.getElementById('cmsDelete').style.display='none';
    document.getElementById('cmsApply').style.display='none';
    document.getElementById('cmsCancel').textContent='Закрыть';
    var fields=document.getElementById('cmsModalFields');
    fields.innerHTML='<div id="cmsManagePane"></div>';
    var pane=document.getElementById('cmsManagePane');
    if(tab==='doctors') renderDoctorsPane(pane);
    else renderServicesPane(pane);

    function renderDoctorsPane(pane){
      var docs=Array.prototype.slice.call(document.querySelectorAll('.doc-grid .doc'));
      var listHtml=docs.map(function(doc, i){
        return '<div class="cms-item" data-idx="'+i+'">'+
          '<div class="cms-item-main"><b></b><small></small></div>'+
          '<div class="cms-item-actions">'+
            '<button type="button" class="btn btn-ghost cms-edit-doc" data-idx="'+i+'">Изменить</button>'+
            '<button type="button" class="btn btn-danger cms-del-doc" data-idx="'+i+'">Удалить</button>'+
          '</div></div>';
      }).join('');
      pane.innerHTML=
        '<p class="sub" style="margin-top:0">Добавьте врача формой ниже или удалите из списка. Потом нажмите «Сохранить».</p>'+
        '<div class="cms-item-list">'+(listHtml||'<p class="sub">Пока нет врачей.</p>')+'</div>'+
        '<div class="cms-divider"></div>'+
        '<h4 class="cms-h4">Добавить врача</h4>'+
        '<div class="field"><label>ФИО</label><input id="cmsNewDocName" type="text" placeholder="Иванов Иван"></div>'+
        selectField('Специализация','cmsNewDocRole',doctorRoleOptions('Ортодонтия'))+
        '<div class="field"><label>Должность</label><input id="cmsNewDocTitle" type="text" placeholder="Врач-ортодонт"></div>'+
        '<div class="field"><label>Опыт</label><input id="cmsNewDocYears" type="text" placeholder="5 лет"></div>'+
        '<div class="field"><label>URL фото</label><input id="cmsNewDocSrc" type="text" placeholder="https://..."></div>'+
        '<div class="field"><label>Или файл</label><input id="cmsNewDocFile" type="file" accept="image/*"></div>'+
        doctorRatingFieldsHtml('cmsNewDocPd')+
        '<button type="button" class="btn btn-gold" id="cmsCreateDoctor" style="width:100%;margin-top:12px">+ Добавить врача</button>';

      pane.querySelectorAll('.cms-item').forEach(function(item){
        var i=+item.getAttribute('data-idx');
        var doc=docs[i]; if(!doc) return;
        item.querySelector('b').textContent=(doc.querySelector('h3')&&doc.querySelector('h3').textContent)||'';
        var role=(doc.querySelector('.role')&&doc.querySelector('.role').textContent)||'';
        var exp=(doc.querySelector('.exp')&&doc.querySelector('.exp').textContent)||'';
        item.querySelector('small').textContent=[role,exp].filter(Boolean).join(' · ');
      });

      var createDoctorBtn=document.getElementById('cmsCreateDoctor');
      var newDoctorUploading=false;
      var newDocRating=wireDoctorRatingLookup({
        prefix:'cmsNewDocPd',
        nameId:'cmsNewDocName',
        photoId:'cmsNewDocSrc',
        autorun:false
      });
      wireImageFileInput(document.getElementById('cmsNewDocFile'), function(url){
        document.getElementById('cmsNewDocSrc').value=url;
        if(newDocRating) newDocRating.run(false);
      }, function(busy){
        newDoctorUploading=busy;
        createDoctorBtn.disabled=busy;
        createDoctorBtn.textContent=busy?'Загружаем фото…':'+ Добавить врача';
      });

      createDoctorBtn.onclick=function(){
        if(newDoctorUploading){
          toast('Дождитесь окончания загрузки фото');
          return;
        }
        var name=document.getElementById('cmsNewDocName').value.trim();
        if(!name){ alert('Введите ФИО врача'); return; }
        var rating=readDoctorRatingFields('cmsNewDocPd');
        function finishAdd(){
          rating=readDoctorRatingFields('cmsNewDocPd');
          var titleVal=document.getElementById('cmsNewDocTitle').value;
          var yearsVal=document.getElementById('cmsNewDocYears').value;
          var doc=addDoctor(null, {
            name:name,
            role:document.getElementById('cmsNewDocRole').value||'Ортодонтия',
            exp:joinDocExp(titleVal, yearsVal),
            src:normalizeMediaUrl(document.getElementById('cmsNewDocSrc').value.trim())||doctorPlaceholder(),
            spec:titleVal||document.getElementById('cmsNewDocRole').value||'',
            years:yearsVal,
            pdRating:rating.pdRating,
            pdReviews:rating.pdReviews,
            pdUrl:rating.pdUrl,
            ratingSource:rating.ratingSource
          });
          if(!doc) return;
          markDirty();
          toast(rating.pdRating!=null
            ?('Врач добавлен с рейтингом '+Number(rating.pdRating).toFixed(1)+' ('+ratingSourceLabel(rating.ratingSource)+'). Нажмите «Сохранить»')
            :'Врач добавлен. Нажмите «Сохранить»');
          openDocsServicesPanel('doctors');
        }
        // Если рейтинг ещё не искали — сначала поиск, потом добавление
        if(rating.pdRating==null && name.split(/\s+/).filter(Boolean).length>=2){
          createDoctorBtn.disabled=true;
          createDoctorBtn.textContent='Ищем рейтинг…';
          fetchDoctorRating(name, document.getElementById('cmsNewDocSrc').value.trim()).then(function(j){
            if(j&&j.best) applyDoctorRatingBest('cmsNewDocPd', j.best);
          }).catch(function(){}).then(function(){
            createDoctorBtn.disabled=false;
            createDoctorBtn.textContent='+ Добавить врача';
            finishAdd();
          });
          return;
        }
        finishAdd();
      };

      pane.querySelectorAll('.cms-del-doc').forEach(function(btn){
        btn.onclick=function(){
          var i=+btn.getAttribute('data-idx');
          var el=document.querySelectorAll('.doc-grid .doc')[i];
          if(!el) return;
          var nm=(el.querySelector('h3')&&el.querySelector('h3').textContent)||'этого врача';
          var docId=el.getAttribute('data-doc')||'';
          if(!confirm('Удалить врача «'+nm+'» со всего сайта? Он пропадёт из всех услуг.')) return;
          if(docId) purgeDoctorEverywhere(docId);
          else el.remove();
          markDirty();
          toast('Врач удалён везде. Нажмите «Сохранить»');
          openDocsServicesPanel('doctors');
        };
      });
      pane.querySelectorAll('.cms-edit-doc').forEach(function(btn){
        btn.onclick=function(){
          var i=+btn.getAttribute('data-idx');
          var el=document.querySelectorAll('.doc-grid .doc')[i];
          if(el){ closeModal(); openModal(el); }
        };
      });
      enhanceCmsSelects(pane);
    }

    function renderServicesPane(pane){
      if(!window.AMIR_SERVICES || !Array.isArray(window.AMIR_SERVICES.groups)){
        pane.innerHTML='<p class="sub" style="margin-top:0">Список направлений не загружен. Обновите страницу.</p>';
        return;
      }
      renderServicesPaneReady(pane);
    }

    function renderServicesPaneReady(pane){
      var firstCat='ortho';
      var editingSlug=null;
      pane.innerHTML=
        '<p class="sub" style="margin-top:0">Нажмите услугу или «Изменить», чтобы поправить название, направление или врачей. Новая услуга появляется в колонке на главной и в меню.</p>'+
        '<div class="cms-item-list" id="cmsSvcList"></div>'+
        '<div class="cms-divider"></div>'+
        '<h4 class="cms-h4" id="cmsSvcFormTitle">Добавить услугу</h4>'+
        '<div class="field"><label>Название</label><input id="cmsNewSvcName" type="text" placeholder="Название услуги"></div>'+
        selectField('Направления','cmsNewSvcCat',groupCatOptions(firstCat))+
        '<div class="field"><label>Врачи</label>'+doctorChecklistHtmlForCat(firstCat, [])+
        '<p class="sub" style="margin:8px 0 0">Можно выбрать несколько</p></div>'+
        '<div class="cms-svc-form-actions">'+
          '<button type="button" class="btn btn-gold" id="cmsCreateService" style="flex:1">+ Добавить услугу</button>'+
          '<button type="button" class="btn btn-ghost" id="cmsCancelEditService" style="display:none;flex:0 0 auto">Отмена</button>'+
        '</div>';

      function listRows(){
        return flatServiceItems().map(function(row){
          var docs=row.item.doctors||[];
          var docNames=docs.map(doctorNameById).filter(Boolean);
          return {
            slug:row.item.slug,
            title:row.item.title||'',
            direction:row.groupTitle||'',
            doctors:docNames.join(', '),
            doctorIds:docs.slice()
          };
        });
      }

      function renderList(){
        var listBox=document.getElementById('cmsSvcList');
        if(!listBox) return;
        var rows=listRows();
        if(!rows.length){
          listBox.innerHTML='<p class="sub">Пока нет услуг</p>';
          return;
        }
        listBox.innerHTML=rows.map(function(row, i){
          var on=editingSlug && editingSlug===row.slug?' is-editing':'';
          return '<div class="cms-item cms-item-svc'+on+'" data-idx="'+i+'" data-slug="'+escAttr(row.slug)+'" role="button" tabindex="0">'+
            '<div class="cms-item-main"><b></b><small></small></div>'+
            '<div class="cms-item-actions">'+
              '<button type="button" class="btn btn-ghost cms-edit-svc" data-slug="'+escAttr(row.slug)+'">Изменить</button>'+
              '<button type="button" class="btn btn-danger cms-del-svc" data-slug="'+escAttr(row.slug)+'" data-state="idle">Удалить</button>'+
            '</div></div>';
        }).join('');
        listBox.querySelectorAll('.cms-item').forEach(function(item){
          var i=+item.getAttribute('data-idx');
          var row=rows[i]; if(!row) return;
          item.querySelector('b').textContent=row.title;
          item.querySelector('small').textContent=[row.direction, row.doctors].filter(Boolean).join(' · ');
        });
      }

      function setDoctorChecklist(cat, selectedIds){
        var field=document.getElementById('cmsNewSvcDoctors');
        if(!field) return;
        var wrap=field.parentNode;
        var html=doctorChecklistHtmlForCat(cat, selectedIds||[]);
        var tmp=document.createElement('div');
        tmp.innerHTML=html;
        var next=tmp.firstChild;
        if(next) wrap.replaceChild(next, field);
      }

      function refreshDoctorChecklist(){
        var cat=document.getElementById('cmsNewSvcCat').value||'ortho';
        var keep=readSelectedDoctorIds('cmsNewSvcDoctors');
        setDoctorChecklist(cat, keep);
      }

      function setFormMode(mode, row){
        var titleEl=document.getElementById('cmsSvcFormTitle');
        var btn=document.getElementById('cmsCreateService');
        var cancel=document.getElementById('cmsCancelEditService');
        var nameEl=document.getElementById('cmsNewSvcName');
        var catEl=document.getElementById('cmsNewSvcCat');
        if(mode==='edit' && row){
          editingSlug=row.slug;
          if(titleEl) titleEl.textContent='Редактировать услугу';
          if(btn) btn.textContent='Сохранить изменения';
          if(cancel) cancel.style.display='';
          if(nameEl) nameEl.value=row.title||'';
          var cat=catKeyFromGroupTitle(row.direction);
          if(catEl){
            catEl.value=cat;
            refreshCmsSelect(catEl);
          }
          setDoctorChecklist(cat, row.doctorIds||[]);
        } else {
          editingSlug=null;
          if(titleEl) titleEl.textContent='Добавить услугу';
          if(btn) btn.textContent='+ Добавить услугу';
          if(cancel) cancel.style.display='none';
          if(nameEl) nameEl.value='';
          if(catEl){
            catEl.value='ortho';
            refreshCmsSelect(catEl);
          }
          setDoctorChecklist('ortho', []);
        }
        renderList();
        var form=document.getElementById('cmsSvcFormTitle');
        if(form && mode==='edit') form.scrollIntoView({ behavior:'smooth', block:'nearest' });
      }

      function beginEdit(slug){
        var rows=listRows();
        var row=null;
        for(var i=0;i<rows.length;i++){
          if(rows[i].slug===slug){ row=rows[i]; break; }
        }
        if(!row) return;
        setFormMode('edit', row);
      }

      var listBox=document.getElementById('cmsSvcList');
      listBox.addEventListener('click', function(e){
        var delBtn=e.target&&e.target.closest?e.target.closest('.cms-del-svc'):null;
        if(delBtn && listBox.contains(delBtn)){
          e.preventDefault();
          e.stopPropagation();
          var slug=delBtn.getAttribute('data-slug')||'';
          var rowEl=delBtn.closest('.cms-item');
          var title=rowEl&&rowEl.querySelector('b')?rowEl.querySelector('b').textContent:'';
          var state=delBtn.getAttribute('data-state')||'idle';
          if(state!=='confirm'){
            listBox.querySelectorAll('.cms-del-svc[data-state="confirm"]').forEach(function(b){
              b.setAttribute('data-state','idle');
              b.textContent='Удалить';
            });
            delBtn.setAttribute('data-state','confirm');
            delBtn.textContent='Точно удалить?';
            return;
          }
          if(!removeServiceFromDirection(slug)) return;
          if(editingSlug===slug) setFormMode('add');
          markDirty();
          toast('Услуга «'+(title||'')+'» удалена. Нажмите «Сохранить»');
          renderList();
          return;
        }

        var editBtn=e.target&&e.target.closest?e.target.closest('.cms-edit-svc'):null;
        var itemEl=e.target&&e.target.closest?e.target.closest('.cms-item-svc'):null;
        if(editBtn && listBox.contains(editBtn)){
          e.preventDefault();
          e.stopPropagation();
          beginEdit(editBtn.getAttribute('data-slug')||'');
          return;
        }
        if(itemEl && listBox.contains(itemEl) && !(e.target.closest && e.target.closest('.cms-item-actions'))){
          e.preventDefault();
          beginEdit(itemEl.getAttribute('data-slug')||'');
        }
      });
      listBox.addEventListener('keydown', function(e){
        if(e.key!=='Enter' && e.key!==' ') return;
        var itemEl=e.target&&e.target.closest?e.target.closest('.cms-item-svc'):null;
        if(!itemEl || !listBox.contains(itemEl)) return;
        if(e.target.closest && e.target.closest('button')) return;
        e.preventDefault();
        beginEdit(itemEl.getAttribute('data-slug')||'');
      });

      renderList();
      enhanceCmsSelects(pane);
      document.getElementById('cmsNewSvcCat').onchange=refreshDoctorChecklist;
      document.getElementById('cmsCancelEditService').onclick=function(){ setFormMode('add'); };
      document.getElementById('cmsCreateService').onclick=function(){
        var name=document.getElementById('cmsNewSvcName').value.trim();
        if(!name){ alert('Введите название услуги'); return; }
        var cat=document.getElementById('cmsNewSvcCat').value||'ortho';
        var doctors=readSelectedDoctorIds('cmsNewSvcDoctors');
        if(!doctors.length){ alert('Выберите хотя бы одного врача'); return; }
        if(editingSlug){
          var updated=updateServiceInDirection(editingSlug, { title:name, cat:cat, doctors:doctors });
          if(!updated){ alert('Не удалось сохранить изменения'); return; }
          markDirty();
          toast('Услуга обновлена. Нажмите «Сохранить»');
          setFormMode('add');
          return;
        }
        var item=addServiceToDirection(cat, name, doctors);
        if(!item){ alert('Не удалось добавить услугу'); return; }
        markDirty();
        toast('Услуга добавлена в «'+groupCatLabel(cat)+'». Нажмите «Сохранить»');
        document.getElementById('cmsNewSvcName').value='';
        setDoctorChecklist(cat, []);
        renderList();
      };
    }

    modal.classList.add('open');
  }

  function openDoctorsPanel(){ openDocsServicesPanel('doctors'); }
  function openServicesPanel(){ openDocsServicesPanel('services'); }

  function buildBar(){
    var bar=document.createElement('div');
    bar.className='cms-bar';
    bar.innerHTML=
      '<div class="left"><span class="badge">Режим правки</span><span class="meta">Клик по тексту / фото / блоку</span></div>'+
      '<div class="right">'+
        '<button type="button" id="cmsManageDoctors">Врачи</button>'+
        '<button type="button" id="cmsManageServices">Услуги</button>'+
        '<button type="button" id="cmsLeads">Заявки</button>'+
        '<button type="button" class="primary" id="cmsSaveNow">Сохранить</button>'+
        '<button type="button" id="cmsPreview">Как видит клиент</button>'+
        '<button type="button" id="cmsLogout">Выйти</button>'+
      '</div>';
    document.body.appendChild(bar);

    var hint=document.createElement('div');
    hint.className='cms-hint show';
    hint.textContent='Кликните текст — правьте прямо на сайте. Фото / врача / услугу — через простую форму';
    document.body.appendChild(hint);
    setTimeout(function(){ hint.classList.remove('show'); }, 5500);

    var toastEl=document.createElement('div');
    toastEl.className='cms-toast';
    toastEl.id='cmsToast';
    document.body.appendChild(toastEl);

    document.getElementById('cmsManageDoctors').onclick=function(e){
      e.preventDefault(); e.stopPropagation();
      if(isServicePage()){
        location.href='/';
        return;
      }
      openDoctorsPanel();
    };
    document.getElementById('cmsManageServices').onclick=function(e){
      e.preventDefault(); e.stopPropagation();
      if(isServicePage()){
        location.href='/prices';
        return;
      }
      openServicesPanel();
    };
    if(isServicePage()){
      var docsBtn=document.getElementById('cmsManageDoctors');
      var svcBtn=document.getElementById('cmsManageServices');
      if(docsBtn) docsBtn.style.display='none';
      if(svcBtn) svcBtn.textContent='Весь прайс';
      var meta=document.querySelector('.cms-bar .meta');
      if(meta) meta.textContent='Золотая рамка = можно нажать';
      hint.textContent='На карточке услуги: нажмите поле в золотой рамке — откроется форма правки';
    }
    document.getElementById('cmsSaveNow').onclick=function(){ persist({openPreview:false}).catch(function(){}); };
    document.getElementById('cmsLeads').onclick=function(){ openLeadsPanel(); };
    document.getElementById('cmsPreview').onclick=function(){
      window.open('/?preview=1&view='+Date.now(), '_blank', 'noopener,noreferrer');
    };
    document.getElementById('cmsLogout').onclick=async function(){ await AmirCMS.logout(); location.href='/'; };
  }

  async function openLeadsPanel(){
    panelMode='leads';
    currentEl=null;
    var modal=document.getElementById('cmsModal');
    var box=modal.querySelector('.cms-modal');
    box.classList.add('cms-modal-wide');
    document.getElementById('cmsModalTitle').textContent='Заявки с сайта';
    document.getElementById('cmsModalSub').textContent='В том числе сохранённые, если Telegram не ответил';
    document.getElementById('cmsDelete').style.display='none';
    document.getElementById('cmsApply').style.display='none';
    document.getElementById('cmsCancel').textContent='Закрыть';
    var fields=document.getElementById('cmsModalFields');
    fields.innerHTML='<p class="sub">Загружаем заявки…</p>';
    modal.classList.add('open');

    function notifyLabel(n){
      var status=n && n.status ? String(n.status) : '';
      if(status==='sent') return 'уведомление отправлено';
      if(status==='failed') return 'Telegram не отправил — заявка в хранилище';
      if(status==='pending') return 'ожидает уведомления';
      return 'статус неизвестен';
    }

    try{
      var leads=await AmirCMS.listLeads();
      if(!leads.length){
        fields.innerHTML='<p class="sub">Заявок пока нет.</p>';
        return;
      }
      fields.innerHTML=
        '<div class="cms-item-list">'+leads.map(function(lead){
          var date=lead.createdAt?new Date(lead.createdAt).toLocaleString('ru-RU'):'Дата не указана';
          var phone=lead.phone||'';
          var tel=phone.replace(/[^\d+]/g,'');
          var svc=lead.service?' · '+escHtml(lead.service):'';
          var note=notifyLabel(lead.notification);
          var warn=(lead.notification&&lead.notification.status&&lead.notification.status!=='sent')?' style="color:#9a3412"':'';
          return '<div class="cms-item">'+
            '<div class="cms-item-main">'+
              '<b>'+escHtml(lead.name||'Без имени')+svc+'</b>'+
              '<small>'+escHtml(date)+' · <span'+warn+'>'+escHtml(note)+'</span></small>'+
              (lead.page?'<small style="display:block;opacity:.75;word-break:break-all">'+escHtml(lead.page)+'</small>':'')+
            '</div>'+
            '<div class="cms-item-actions">'+
              (tel?'<a class="btn btn-ghost" href="tel:'+escAttr(tel)+'">'+escHtml(phone)+'</a>':'')+
            '</div>'+
          '</div>';
        }).join('')+'</div>'+
        '<p class="sub" style="margin-top:14px">Показаны последние заявки. Если статус не «уведомление отправлено» — перезвоните по телефону из списка.</p>';
    }catch(err){
      fields.innerHTML='<p class="sub">Не удалось загрузить заявки. Закройте окно и попробуйте ещё раз.</p>';
      toast('Ошибка заявок: '+(err&&err.message?err.message:err));
    }
  }

  function buildModal(){
    var bg=document.createElement('div');
    bg.className='cms-modal-bg';
    bg.id='cmsModal';
    bg.innerHTML=
      '<div class="cms-modal" role="dialog" aria-modal="true">'+
        '<h3 id="cmsModalTitle">Редактирование</h3>'+
        '<p class="sub" id="cmsModalSub">Простая правка без кода</p>'+
        '<div id="cmsModalFields"></div>'+
        '<div class="row">'+
          '<button type="button" class="btn btn-gold" id="cmsApply">Сохранить</button>'+
          '<button type="button" class="btn btn-ghost" id="cmsCancel">Отмена</button>'+
          '<button type="button" class="btn btn-danger" id="cmsDelete">Удалить</button>'+
        '</div>'+
      '</div>';
    document.body.appendChild(bg);
    bg.addEventListener('click',function(e){ if(e.target===bg) closeModal(); });
    document.getElementById('cmsCancel').onclick=closeModal;
    document.getElementById('cmsApply').onclick=applyModal;
    document.getElementById('cmsDelete').onclick=deleteCurrent;
  }

  function escAttr(s){ return String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }
  function opt(v,label,cur){ return '<option value="'+v+'"'+(cur===v?' selected':'')+'>'+label+'</option>'; }
  function selectField(label, id, optionsHtml){
    return '<div class="field"><label>'+label+'</label>'+
      '<div class="select-wrap"><select id="'+id+'" class="form-select">'+optionsHtml+'</select></div></div>';
  }
  function ratingSourceLabel(src){
    if(src==='zub') return 'Зуб.ру';
    if(src==='docdoc') return 'DocDoc';
    if(src==='yandex') return 'Яндекс Карты';
    if(src==='doctu') return 'Doctu';
    return 'ПроДокторов';
  }
  function doctorRatingFieldsHtml(prefix, seed){
    seed=seed||{};
    var r=seed.pdRating!=null?String(seed.pdRating):'';
    var rev=seed.pdReviews!=null?String(seed.pdReviews):'';
    var url=escAttr(seed.pdUrl||'');
    var src=escAttr(seed.ratingSource||'');
    return '<div class="cms-rating-box" id="'+prefix+'Box">'+
      '<div class="cms-rating-head">'+
        '<h4 class="cms-h4" style="margin:0">Рейтинг на сайтах отзывов</h4>'+
        '<button type="button" class="btn btn-ghost" id="'+prefix+'Find" style="flex:none;min-width:auto;padding:8px 14px">Найти</button>'+
      '</div>'+
      '<p class="sub" id="'+prefix+'Status" style="margin:8px 0 0">По ФИО и фото ищем на ПроДокторов, DocDoc/Яндекс, Зуб.ру и Doctu — прикрепится лучший рейтинг.</p>'+
      '<input type="hidden" id="'+prefix+'Rating" value="'+escAttr(r)+'">'+
      '<input type="hidden" id="'+prefix+'Reviews" value="'+escAttr(rev)+'">'+
      '<input type="hidden" id="'+prefix+'Url" value="'+url+'">'+
      '<input type="hidden" id="'+prefix+'Source" value="'+src+'">'+
    '</div>';
  }
  function readDoctorRatingFields(prefix){
    var ratingEl=document.getElementById(prefix+'Rating');
    var reviewsEl=document.getElementById(prefix+'Reviews');
    var urlEl=document.getElementById(prefix+'Url');
    var srcEl=document.getElementById(prefix+'Source');
    var rating=ratingEl&&ratingEl.value!==''?parseFloat(ratingEl.value):null;
    var reviews=reviewsEl&&reviewsEl.value!==''?parseInt(reviewsEl.value,10):null;
    if(rating!=null&&isNaN(rating)) rating=null;
    if(reviews!=null&&isNaN(reviews)) reviews=null;
    return {
      pdRating:rating,
      pdReviews:reviews,
      pdUrl:(urlEl&&urlEl.value)||'',
      ratingSource:(srcEl&&srcEl.value)||''
    };
  }
  function paintDoctorRatingStatus(prefix, best, meta){
    var st=document.getElementById(prefix+'Status');
    if(!st) return;
    if(best&&best.pdRating!=null){
      var label=best.sourceLabel||ratingSourceLabel(best.ratingSource);
      var bits=[Number(best.pdRating).toFixed(1)+' · '+label];
      if(best.pdReviews) bits.push(best.pdReviews+' отзывов');
      if(best.matchedName) bits.push(best.matchedName);
      st.innerHTML='Прикреплён лучший рейтинг: <b>'+escHtml(bits[0])+'</b>'+
        (bits[1]?' · '+escHtml(bits[1]):'')+
        (bits[2]?'<br><span style="opacity:.85">Совпадение: '+escHtml(bits[2])+'</span>':'')+
        (best.pdUrl?' · <a href="'+escAttr(best.pdUrl)+'" target="_blank" rel="noopener">профиль</a>':'');
      return;
    }
    if(meta&&meta.loading){ st.textContent='Ищем на ПроДокторов, DocDoc/Яндекс, Зуб.ру и Doctu…'; return; }
    if(meta&&meta.error){ st.textContent=meta.error; return; }
    if(meta&&meta.profile){
      var p=meta.profile;
      var source=ratingSourceLabel(p.source||'');
      st.innerHTML='Профиль найден: <b>'+escHtml(p.name||'врач')+'</b> · '+escHtml(source)+
        '. На странице пока нет числового рейтинга'+
        (p.url?' · <a href="'+escAttr(p.url)+'" target="_blank" rel="noopener">профиль</a>':'');
      return;
    }
    st.textContent='Профиль с рейтингом не найден — на сайте рейтинг не покажем.';
  }
  function applyDoctorRatingBest(prefix, best){
    if(!best) return;
    var r=document.getElementById(prefix+'Rating');
    var rev=document.getElementById(prefix+'Reviews');
    var url=document.getElementById(prefix+'Url');
    var src=document.getElementById(prefix+'Source');
    if(r) r.value=best.pdRating!=null?String(best.pdRating):'';
    if(rev) rev.value=best.pdReviews!=null?String(best.pdReviews):'';
    if(url) url.value=best.pdUrl||'';
    if(src) src.value=best.ratingSource||'';
    paintDoctorRatingStatus(prefix, best);
  }
  function clearDoctorRatingFields(prefix){
    ['Rating','Reviews','Url','Source'].forEach(function(suffix){
      var el=document.getElementById(prefix+suffix);
      if(el) el.value='';
    });
  }
  function fetchDoctorRating(name, photo){
    var token=(window.AmirCMS&&AmirCMS.getToken)?AmirCMS.getToken():'';
    return fetch('/api/cms/doctor-rating',{
      method:'POST',
      headers:{'Content-Type':'application/json','X-CMS-Token':token||''},
      body:JSON.stringify({ name:name, photo:photo||'' })
    }).then(function(res){
      return res.json().catch(function(){ return { ok:false, error:'bad_json' }; }).then(function(j){
        j._http=res.status;
        return j;
      });
    });
  }
  function wireDoctorRatingLookup(opts){
    var prefix=opts.prefix;
    var nameId=opts.nameId;
    var photoId=opts.photoId;
    var timer=null;
    var seq=0;
    function run(force){
      var nameEl=document.getElementById(nameId);
      var photoEl=document.getElementById(photoId);
      var name=(nameEl&&nameEl.value||'').trim();
      var photo=(photoEl&&photoEl.value||'').trim();
      var parts=name.split(/\s+/).filter(Boolean);
      if(parts.length<2){
        if(force) paintDoctorRatingStatus(prefix, null, { error:'Укажите фамилию и имя — по ним ищем на трёх сайтах.' });
        return;
      }
      var my=++seq;
      paintDoctorRatingStatus(prefix, null, { loading:true });
      var findBtn=document.getElementById(prefix+'Find');
      if(findBtn){ findBtn.disabled=true; findBtn.textContent='Ищем…'; }
      fetchDoctorRating(name, photo).then(function(j){
        if(my!==seq) return;
        if(findBtn){ findBtn.disabled=false; findBtn.textContent='Найти'; }
        if(!j||j.ok===false){
          var err=(j&&j.error)||'Не удалось выполнить поиск';
          if(j&&j._http===404) err='Сервер без поиска рейтинга — перезапустите python3 server.py';
          else if(j&&j._http===401) err='Войдите в админку заново';
          paintDoctorRatingStatus(prefix, null, { error:err });
          return;
        }
        if(j.best) applyDoctorRatingBest(prefix, j.best);
        else {
          clearDoctorRatingFields(prefix);
          var profiles=(Array.isArray(j.candidates)?j.candidates:[]).filter(function(c){
            return c&&c.url&&Number(c.nameMatch||0)>=0.75&&Number(c.confidence||0)>=0.75;
          }).sort(function(a,b){ return Number(b.confidence||0)-Number(a.confidence||0); });
          paintDoctorRatingStatus(prefix, null, profiles.length?{profile:profiles[0]}:{});
        }
      }).catch(function(){
        if(my!==seq) return;
        if(findBtn){ findBtn.disabled=false; findBtn.textContent='Найти'; }
        paintDoctorRatingStatus(prefix, null, { error:'Нет связи с сервером поиска' });
      });
    }
    function schedule(){
      clearTimeout(timer);
      timer=setTimeout(function(){ run(false); }, 900);
    }
    var nameEl=document.getElementById(nameId);
    var photoEl=document.getElementById(photoId);
    var findBtn=document.getElementById(prefix+'Find');
    if(nameEl) nameEl.addEventListener('input', schedule);
    if(photoEl) photoEl.addEventListener('change', schedule);
    if(findBtn) findBtn.onclick=function(){ run(true); };
    if(opts.seed&&opts.seed.pdRating!=null) applyDoctorRatingBest(prefix, {
      pdRating:opts.seed.pdRating,
      pdReviews:opts.seed.pdReviews,
      pdUrl:opts.seed.pdUrl,
      ratingSource:opts.seed.ratingSource,
      sourceLabel:ratingSourceLabel(opts.seed.ratingSource),
      matchedName:''
    });
    else if(opts.autorun) schedule();
    return { run:run };
  }
  function enhanceCmsSelects(root){
    var scope=root||document.getElementById('cmsModal');
    if(!scope) return;
    var sels=scope.querySelectorAll('select.form-select');
    if(!sels.length) return;
    if(window.AMIR_formSelects&&typeof window.AMIR_formSelects.refresh==='function'){
      Array.prototype.forEach.call(sels, function(sel){ window.AMIR_formSelects.refresh(sel); });
    }
  }
  function refreshCmsSelect(sel){
    if(!sel) return;
    if(window.AMIR_formSelects&&typeof window.AMIR_formSelects.refresh==='function'){
      window.AMIR_formSelects.refresh(sel);
    }
  }

  function openModal(el){
    panelMode=null;
    currentEl=el;
    var type=el.getAttribute('data-cms-type')||'block';
    var fields=document.getElementById('cmsModalFields');
    var title=document.getElementById('cmsModalTitle');
    var del=document.getElementById('cmsDelete');
    var apply=document.getElementById('cmsApply');
    var cancel=document.getElementById('cmsCancel');
    var box=document.querySelector('#cmsModal .cms-modal');
    if(box) box.classList.remove('cms-modal-wide','cms-modal-doctor');
    apply.style.display='';
    apply.textContent='Сохранить';
    cancel.textContent='Отмена';
    del.style.display='';
    if(type==='doctor') del.textContent='Удалить врача';
    else if(type==='price') del.textContent='Удалить услугу';
    else del.textContent='Удалить';
    fields.innerHTML='';
    var sub=document.getElementById('cmsModalSub');
    if(sub) sub.textContent='Простая правка без кода';

    if(type==='image'){
      var img=resolveImg(el);
      if(!img){ toast('Фото в этом блоке не найдено'); return; }
      title.textContent='Редактировать фото';
      del.style.display='none';
      fields.innerHTML=
        '<div class="field"><label>URL изображения</label><input id="cmsSrc" type="text" value="'+escAttr(img.getAttribute('src')||'')+'"></div>'+
        '<div class="field"><label>Загрузить с устройства</label><input id="cmsFile" type="file" accept="image/*"></div>'+
        '<div class="field"><label>Подпись (alt)</label><input id="cmsAlt" type="text" value="'+escAttr(img.getAttribute('alt')||'')+'"></div>'+
        '<img class="preview-img" id="cmsPrev" src="'+escAttr(img.getAttribute('src')||'')+'" alt="">';
      document.getElementById('cmsSrc').oninput=function(){ document.getElementById('cmsPrev').src=this.value; };
      wireImageFileInput(document.getElementById('cmsFile'), function(url){
        document.getElementById('cmsSrc').value=url;
        document.getElementById('cmsPrev').src=url;
      });
    } else if(type==='video'){
      title.textContent='Редактировать видео';
      var poster=el.querySelector('.reel-poster');
      var cap=el.querySelector('.reel-cap');
      var bg=(poster&&poster.style.backgroundImage||'').replace(/^url\(["']?/,'').replace(/["']?\)$/,'');
      var capText='';
      if(cap){
        capText=(cap.childNodes[0]&&cap.childNodes[0].textContent||'');
        var sm=cap.querySelector('small');
        if(sm) capText+='\n'+sm.textContent;
      }
      fields.innerHTML=
        '<div class="field"><label>Ссылка на видео</label><input id="cmsVideo" type="text" value="'+escAttr(el.getAttribute('data-video')||'')+'"></div>'+
        '<div class="field"><label>Обложка URL</label><input id="cmsPoster" type="text" value="'+escAttr(bg)+'"></div>'+
        '<div class="field"><label>Подпись</label><textarea id="cmsCap"></textarea></div>';
      document.getElementById('cmsCap').value=capText;
    } else if(type==='price'){
      title.textContent='Редактировать услугу';
      var pn=el.querySelector('.pn'); var pp=el.querySelector('.pp'); var pt=el.querySelector('.ptag');
      // Детальные категории (kids/therapy/…), иначе kids схлопывался в «Стоматология»
      var priceCat=el.dataset.cat||'therapy';
      if(priceCat==='stoma' && isServicePage()){
        priceCat=defaultCatForServicePage()||'therapy';
      }
      fields.innerHTML=
        '<div class="field"><label>Название</label><input id="cmsName" type="text"></div>'+
        selectField('Категория','cmsCat',catOptions(priceCat))+
        '<div class="field"><label>Цена</label><input id="cmsPrice" type="text"></div>'+
        '<div class="field"><label><input id="cmsAddAfter" type="checkbox"> Добавить ещё услугу ниже</label></div>';
      document.getElementById('cmsName').value=pn?pn.textContent:'';
      document.getElementById('cmsPrice').value=pp?pp.textContent:'';
    } else if(type==='doctor'){
      title.textContent='Редактировать врача';
      var box=document.querySelector('#cmsModal .cms-modal');
      if(box) box.classList.add('cms-modal-wide','cms-modal-doctor');
      var sub=document.getElementById('cmsModalSub');
      if(sub) sub.textContent='Карточка на сайте и полная информация во всплывающем окне';
      var docId=el.getAttribute('data-doc')||'';
      var profile=getDoctorProfile(docId);
      var img=el.querySelector('.doc-photo img, .chief-media img, img');
      var role=el.querySelector('.doc-body .role, .chief-body .role, .role');
      var name=el.querySelector('.doc-body h3, .chief-body h3, h3');
      var exp=el.querySelector('.doc-body .exp, .chief-body .exp, .exp');
      var expParts=splitDocExp(exp?exp.textContent:'');
      var titleVal=profile.spec||expParts.title||'';
      var yearsVal=profile.years||expParts.years||'';
      var bio=Array.isArray(profile.bio)?profile.bio:[];
      fields.innerHTML=
        '<div class="field"><label>ФИО</label><input id="cmsDocName" type="text"></div>'+
        selectField('Специализация','cmsDocRole',doctorRoleOptions(role?role.textContent:''))+
        '<div class="field"><label>Должность</label><input id="cmsDocTitle" type="text" placeholder="Врач-кардиолог"></div>'+
        '<div class="field"><label>Опыт / стаж</label><input id="cmsDocYears" type="text" placeholder="26 лет"></div>'+
        '<div class="field"><label>URL фото</label><input id="cmsDocSrc" type="text" value="'+escAttr(img?img.getAttribute('src'):'')+'"></div>'+
        '<div class="field"><label>Загрузить с устройства</label><input id="cmsDocFile" type="file" accept="image/*"></div>'+
        '<p class="sub" style="margin:0 0 8px">Фото сожмётся и сохранится на сервер — будет отображаться стабильно.</p>'+
        '<img class="preview-img" id="cmsDocPrev" src="'+escAttr(img?img.getAttribute('src')||profile.photo||'':'')+'" alt="">'+
        doctorRatingFieldsHtml('cmsDocPd', {
          pdRating:profile.pdRating,
          pdReviews:profile.pdReviews,
          pdUrl:profile.pdUrl,
          ratingSource:profile.ratingSource
        })+
        '<div class="cms-divider"></div>'+
        '<h4 class="cms-h4">Образование и практика</h4>'+
        '<p class="sub" style="margin-top:0">Эти строки видит клиент во всплывающей карточке врача.</p>'+
        '<div id="cmsBioList" class="cms-bio-list"></div>'+
        '<button type="button" class="btn btn-ghost" id="cmsBioAdd" style="width:100%;margin-top:8px">Добавить образование/практику</button>';
      document.getElementById('cmsDocName').value=name?name.textContent:(profile.name||'');
      document.getElementById('cmsDocTitle').value=titleVal;
      document.getElementById('cmsDocYears').value=yearsVal;
      document.getElementById('cmsDocSrc').oninput=function(){ document.getElementById('cmsDocPrev').src=this.value; };
      var editDocRating=wireDoctorRatingLookup({
        prefix:'cmsDocPd',
        nameId:'cmsDocName',
        photoId:'cmsDocSrc',
        seed:{
          pdRating:profile.pdRating,
          pdReviews:profile.pdReviews,
          pdUrl:profile.pdUrl,
          ratingSource:profile.ratingSource
        },
        autorun:profile.pdRating==null
      });
      wireImageFileInput(document.getElementById('cmsDocFile'), function(url){
        document.getElementById('cmsDocSrc').value=url;
        document.getElementById('cmsDocPrev').src=url;
        if(editDocRating) editDocRating.run(false);
      });
      var bioList=document.getElementById('cmsBioList');
      renderBioEditor(bioList, bio.length?bio:[['', '']]);
      document.getElementById('cmsBioAdd').onclick=function(){
        var cur=collectBioFromForm();
        cur.push(['','']);
        renderBioEditor(bioList, cur);
        var last=bioList.querySelector('.cms-bio-row:last-child .cms-bio-year');
        if(last) last.focus();
      };
    } else if(type==='text'){
      var isDesc=el.id==='dirDesc';
      var isTitle=el.id==='dirTitle';
      title.textContent=isDesc?'Описание услуги':(isTitle?'Название услуги':'Изменить текст');
      var sub=document.getElementById('cmsModalSub');
      if(sub) sub.textContent=isDesc
        ? 'Это описание видят клиенты под названием на странице услуги'
        : 'Введите новый текст — как на сайте, без кода';
      del.style.display='none';
      fields.innerHTML='<div class="field"><label>'+(isDesc?'Описание':(isTitle?'Название':'Текст'))+'</label><textarea id="cmsText" rows="'+(isDesc?'7':'5')+'" placeholder="'+(isDesc?'Кратко расскажите об услуге…':'')+'"></textarea></div>';
      document.getElementById('cmsText').value=(el.innerText||el.textContent||'').replace(/\n+$/,'');
    } else {
      // Никакого HTML-редактора блоков — уводим на простой текст, если возможно
      title.textContent='Изменить текст';
      del.style.display='none';
      fields.innerHTML='<div class="field"><label>Текст</label><textarea id="cmsText" rows="5"></textarea></div>';
      document.getElementById('cmsText').value=(el.innerText||el.textContent||'').replace(/\n+$/,'');
      el.setAttribute('data-cms-type','text');
    }
    enhanceCmsSelects(fields);
    document.getElementById('cmsModal').classList.add('open');
  }

  function startInlineTextEdit(el){
    if(!el || el.isContentEditable) return;
    if(document.querySelector('.cms-editing')) return;
    el.setAttribute('data-cms-prev', el.innerHTML);
    el.contentEditable='true';
    el.classList.add('cms-editing','cms-hot');
    el.focus();
    try{
      var range=document.createRange();
      range.selectNodeContents(el);
      var sel=window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }catch(e){}

    function onPaste(e){
      e.preventDefault();
      var text=(e.clipboardData||window.clipboardData).getData('text/plain');
      document.execCommand('insertText', false, text);
    }
    function onKey(e){
      if(e.key==='Escape'){
        e.preventDefault();
        el.innerHTML=el.getAttribute('data-cms-prev')||'';
        finish(false);
      } else if(e.key==='Enter' && !e.shiftKey){
        e.preventDefault();
        finish(true);
      }
    }
    function finish(save){
      el.removeEventListener('blur', onBlur);
      el.removeEventListener('keydown', onKey);
      el.removeEventListener('paste', onPaste);
      el.contentEditable='false';
      el.classList.remove('cms-editing','cms-hot');
      if(save){
        // Оставляем простой текст; для заголовков с акцентом сохраняем один span.g если был
        var prev=el.getAttribute('data-cms-prev')||'';
        var hadGold=/\bclass=["']g["']/.test(prev);
        var hadCount=/\bdata-count=/.test(prev);
        var plain=(el.innerText||el.textContent||'').replace(/\u00a0/g,' ').trim();
        if(hadCount){
          /* Число статистики. Простым текстом его записывать нельзя: это сотрёт
             span[data-count], счётчик перестанет находить элемент и анимация
             молча исчезнет, а число застынет. Собираем span заново с новым
             значением, чтобы атрибут и текст не разъезжались. */
          var num=(plain.replace(/\s+/g,'').replace(',','.').match(/\d+(?:\.\d+)?/)||[])[0];
          if(!num){
            el.innerHTML=prev;
            toast('Здесь нужно число, например 27 или 5.0');
            el.removeAttribute('data-cms-prev');
            return;
          }
          var tail=/\bclass=["']plus["']/.test(prev)?'<span class="plus">+</span>':'';
          el.innerHTML='<span data-count="'+num+'">'+num+'</span>'+tail;
          markDirty();
          toast('Текст изменён. Нажмите «Сохранить»');
          el.removeAttribute('data-cms-prev');
          return;
        }
        if(hadGold && el.matches('h1')){
          // Пробуем выделить цену «от N ₽» золотом
          var m=plain.match(/^(.*?)(от\s+[\d\s]+₽)(.*)$/i);
          if(m) el.innerHTML=escHtml(m[1])+'<span class="g">'+escHtml(m[2])+'</span>'+escHtml(m[3]);
          else el.textContent=plain;
        } else {
          el.textContent=plain;
        }
        markDirty();
        toast('Текст изменён. Нажмите «Сохранить»');
      }
      el.removeAttribute('data-cms-prev');
    }
    function onBlur(){ finish(true); }
    el.addEventListener('blur', onBlur);
    el.addEventListener('keydown', onKey);
    el.addEventListener('paste', onPaste);
  }

  function escHtml(s){
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function closeModal(){
    document.getElementById('cmsModal').classList.remove('open');
    currentEl=null;
    panelMode=null;
    var apply=document.getElementById('cmsApply');
    var cancel=document.getElementById('cmsCancel');
    var del=document.getElementById('cmsDelete');
    var box=document.querySelector('#cmsModal .cms-modal');
    if(box) box.classList.remove('cms-modal-wide','cms-modal-doctor');
    if(apply){ apply.style.display=''; apply.textContent='Сохранить'; }
    if(cancel) cancel.textContent='Отмена';
    if(del){ del.style.display=''; del.textContent='Удалить'; }
  }

  function servicePageSlug(){
    try{
      var q=new URLSearchParams(location.search).get('s');
      if(q) return q;
      var path=(location.pathname||'').replace(/\/+$/,'').split('/').pop().replace(/\.html$/,'');
      if(!path || path==='service' || path==='uslugi' || path==='index') return '';
      return path;
    }catch(e){ return ''; }
  }

  /* Название/описание с #dirTitle / #dirDesc пишем в услугу направления. */
  function syncServicePageContentToGroups(){
    if(!isServicePage() || !window.AMIR_SERVICES) return null;
    var slug=servicePageSlug();
    if(!slug) return null;
    var found=findServiceFlatBySlug(slug);
    if(!found || !found.item) return null;
    var titleEl=document.getElementById('dirTitle');
    var descEl=document.getElementById('dirDesc');
    if(titleEl){
      var t=(titleEl.textContent||'').trim();
      if(t) found.item.title=t;
    }
    if(descEl){
      found.item.desc=(descEl.textContent||'').trim();
    }
    return found.item;
  }

  function refreshDirDescPlaceholder(){
    var desc=document.getElementById('dirDesc');
    if(!desc) return;
    var empty=!(desc.textContent||'').trim();
    desc.classList.toggle('cms-desc-empty', empty);
    if(empty && document.body.classList.contains('cms-admin')){
      desc.setAttribute('data-placeholder', 'Нажмите, чтобы добавить описание услуги');
    } else {
      desc.removeAttribute('data-placeholder');
    }
  }

  function defaultCatForServicePage(){
    var slug=servicePageSlug();
    if(!slug) return 'therapy';
    return priceCatForServiceSlug(slug) || 'therapy';
  }

  function formatPriceValue(v){
    var s=String(v||'').trim();
    if(!s) return '0 ₽';
    if(/[₽pр]/i.test(s) || /руб/i.test(s)) return s;
    return s.replace(/\s+/g,' ').trim()+' ₽';
  }

  function refreshDirPriceCount(){
    var list=document.getElementById('dirList');
    var count=document.getElementById('dirCount');
    if(!list||!count) return;
    var n=list.querySelectorAll('.prow').length;
    var d=n%10, dd=n%100, word='услуг';
    if(d===1&&dd!==11) word='услуга';
    else if(d>=2&&d<=4&&(dd<12||dd>14)) word='услуги';
    count.textContent=n+' '+word;
  }

  /* Позиция прайса на странице /uslugi/<slug>: видна здесь (data-subcat)
     и в полном прайс-листе (~360). В колонки на главной не попадает. */
  function addPriceServiceForCurrentPage(name, cat, price){
    var slug=servicePageSlug();
    if(!slug) return null;
    var priceCat=priceCatForServiceSlug(slug) || groupCatToPriceCat(cat);
    var tagLabels={
      ortho:'Ортодонтия', therapy:'Терапия', hygiene:'Гигиена', surgery:'Хирургия',
      implant:'Имплантация', prosth:'Протезирование', paro:'Пародонтология',
      kids:'Детская', cosmo:'Космеология', med:'Медицина', stoma:'Стоматология'
    };
    var entry={
      name:name,
      tag:tagLabels[priceCat]||groupCatLabel(cat),
      price:formatPriceValue(price),
      cat:priceCat,
      subcat:slug,
      doctor:''
    };
    if(!Array.isArray(content.services)) content.services=[];
    content.services.unshift(entry);
    content.priceHtml=servicesToHtml(content.services);

    var prices=document.getElementById('dirPrices');
    if(prices) prices.hidden=false;
    var note=document.getElementById('dirNote');
    if(note) note.hidden=true;
    var list=document.getElementById('dirList');
    if(!list) return null;
    var row=addPriceRow(list, {
      name:entry.name,
      tag:entry.tag,
      price:entry.price,
      cat:entry.cat,
      subcat:entry.subcat
    });
    refreshDirPriceCount();
    var more=document.getElementById('dirMore');
    var fade=document.getElementById('dirFade');
    if(more) more.hidden=true;
    if(fade) fade.hidden=true;
    list.classList.remove('is-clamped');
    markDirty();
    return row;
  }

  function openAddPriceOnServicePage(){
    if(!(AmirCMS.canEdit && AmirCMS.canEdit()) || !isServicePage()) return;
    var slug=servicePageSlug();
    if(!slug){
      alert('Не удалось определить страницу услуги');
      return;
    }
    panelMode='add-page-price';
    currentEl=null;
    var modal=document.getElementById('cmsModal');
    var box=modal.querySelector('.cms-modal');
    if(box) box.classList.remove('cms-modal-wide','cms-modal-doctor');
    document.getElementById('cmsModalTitle').textContent='Добавить услугу в прайс';
    var sub=document.getElementById('cmsModalSub');
    if(sub) sub.textContent='Появится в списке цен на этой странице и в полном прайс-листе клиники';
    document.getElementById('cmsDelete').style.display='none';
    var apply=document.getElementById('cmsApply');
    apply.style.display='';
    apply.textContent='Добавить';
    document.getElementById('cmsCancel').textContent='Отмена';
    var fields=document.getElementById('cmsModalFields');
    var defCat=defaultCatForServicePage();
    fields.innerHTML=
      '<p class="sub" style="margin-top:0">Страница: <b>'+escHtml(slug)+'</b>. В меню «Услуги» на главной эта позиция не добавляется.</p>'+
      '<div class="field"><label>Название</label><input id="cmsPagePriceName" type="text" placeholder="Название услуги"></div>'+
      selectField('Направления','cmsPagePriceCat',groupCatOptions(defCat))+
      '<div class="field"><label>Цена</label><input id="cmsPagePriceValue" type="text" placeholder="5 000 ₽"></div>';
    enhanceCmsSelects(fields);
    modal.classList.add('open');
    var nameEl=document.getElementById('cmsPagePriceName');
    if(nameEl) nameEl.focus();
  }

  function applyAddPagePrice(){
    var name=(document.getElementById('cmsPagePriceName')&&document.getElementById('cmsPagePriceName').value||'').trim();
    if(!name){ alert('Введите название услуги'); return; }
    var cat=(document.getElementById('cmsPagePriceCat')&&document.getElementById('cmsPagePriceCat').value)||'stoma';
    var price=(document.getElementById('cmsPagePriceValue')&&document.getElementById('cmsPagePriceValue').value||'').trim();
    var row=addPriceServiceForCurrentPage(name, cat, price);
    if(!row){ alert('Не удалось добавить услугу'); return; }
    closeModal();
    toast('Услуга добавлена в прайс. Нажмите «Сохранить»');
    wireTargets();
  }

  function wireServicePageAddPrice(){
    var btn=document.getElementById('dirAddPrice');
    if(!btn) return;
    if(!(AmirCMS.canEdit && AmirCMS.canEdit()) || onServicePageReady._previewOnly){
      btn.hidden=true;
      return;
    }
    btn.hidden=false;
    btn.onclick=function(e){
      e.preventDefault();
      e.stopPropagation();
      openAddPriceOnServicePage();
    };
    var prices=document.getElementById('dirPrices');
    if(prices) prices.hidden=false;
  }

  function applyModal(){
    if(panelMode==='add-page-price'){
      applyAddPagePrice();
      return;
    }
    if(!currentEl || panelMode) return;
    var el=currentEl;
    var type=el.getAttribute('data-cms-type');

    if(type==='image'){
      var img=resolveImg(el);
      if(img){
        img.setAttribute('src', document.getElementById('cmsSrc').value.trim());
        img.setAttribute('alt', document.getElementById('cmsAlt').value.trim());
      }
    } else if(type==='video'){
      el.setAttribute('data-video', document.getElementById('cmsVideo').value.trim());
      var poster=document.getElementById('cmsPoster').value.trim();
      var posterEl=el.querySelector('.reel-poster');
      if(posterEl) posterEl.style.backgroundImage="url('"+poster+"')";
      var cap=el.querySelector('.reel-cap');
      var parts=document.getElementById('cmsCap').value.split('\n');
      if(cap) cap.innerHTML=parts[0].replace(/</g,'&lt;')+(parts[1]?'<small>'+parts.slice(1).join(' ').replace(/</g,'&lt;')+'</small>':'');
      if(typeof window.AMIR_syncReels==='function') window.AMIR_syncReels();
    } else if(type==='price'){
      var name=document.getElementById('cmsName').value.trim();
      var cat=groupCatToPriceCat(document.getElementById('cmsCat').value||'therapy');
      var tagLabels={
        ortho:'Ортодонтия', therapy:'Терапия', hygiene:'Гигиена', surgery:'Хирургия',
        implant:'Имплантация', prosth:'Протезирование', paro:'Пародонтология',
        kids:'Детская', cosmo:'Космеология', med:'Медицина', stoma:'Стоматология'
      };
      var tag=tagLabels[cat]||'Стоматология';
      var price=formatPriceValue(document.getElementById('cmsPrice').value.trim());
      var pn=el.querySelector('.pn'); var pp=el.querySelector('.pp'); var pt=el.querySelector('.ptag');
      if(pn) pn.textContent=name;
      if(pt) pt.textContent=tag;
      if(pp) pp.textContent=price;
      el.dataset.cat=cat;
      el.dataset.name=name.toLowerCase();
      // На карточке услуги держим привязку к slug страницы и верный data-cat
      if(isServicePage()){
        var pageSlug=servicePageSlug();
        if(pageSlug){
          el.setAttribute('data-subcat', pageSlug);
          var pageCat=priceCatForServiceSlug(pageSlug);
          if(pageCat){
            el.dataset.cat=pageCat;
            if(pt) pt.textContent=tagLabels[pageCat]||tag;
          }
        }
      }
      if(document.getElementById('cmsAddAfter') && document.getElementById('cmsAddAfter').checked){
        var neu=addPriceRow(el.closest('.price-list'), {
          subcat:el.getAttribute('data-subcat')||'',
          cat:el.dataset.cat,
          doctor:el.getAttribute('data-doctor')||''
        });
        if(neu) el.after(neu);
      }
      if(isServicePage()){
        // Синхронизируем память прайса, чтобы полное сохранение не потеряло правку
        var dirList=document.getElementById('dirList');
        var edited=dirList?collectServices(dirList):[];
        var baseServices=Array.isArray(content.services)?content.services:[];
        content.services=mergeServicesByName(baseServices, edited);
        content.priceHtml=servicesToHtml(content.services);
        refreshDirPriceCount();
      }
    } else if(type==='doctor'){
      var dName=document.getElementById('cmsDocName').value.trim()||'Врач';
      var dRole=document.getElementById('cmsDocRole').value.trim();
      var dTitle=document.getElementById('cmsDocTitle').value.trim();
      var dYears=document.getElementById('cmsDocYears').value.trim();
      var dExp=joinDocExp(dTitle, dYears);
      var dSrc=normalizeMediaUrl(document.getElementById('cmsDocSrc').value.trim());
      var dBio=collectBioFromForm();
      var dImg=el.querySelector('.doc-photo img, .chief-media img, img');
      var dRoleEl=el.querySelector('.doc-body .role, .chief-body .role, .role');
      var dNameEl=el.querySelector('.doc-body h3, .chief-body h3, h3');
      var dExpEl=el.querySelector('.doc-body .exp, .chief-body .exp, .exp');
      if(dNameEl) dNameEl.textContent=dName;
      if(dRoleEl) dRoleEl.textContent=dRole;
      if(dExpEl) dExpEl.textContent=dExp;
      if(dImg){
        dImg.setAttribute('src', dSrc || doctorPlaceholder());
        dImg.setAttribute('alt', dName);
      }
      var docId=el.getAttribute('data-doc')||'';
      if(docId){
        var rating=readDoctorRatingFields('cmsDocPd');
        var patch={
          name:dName,
          role:dRole,
          exp:dExp,
          photo:dSrc || doctorPlaceholder(),
          spec:dTitle||dRole,
          years:dYears,
          bio:dBio
        };
        if(rating.pdRating!=null) patch.pdRating=rating.pdRating;
        if(rating.pdReviews!=null) patch.pdReviews=rating.pdReviews;
        if(rating.pdUrl) patch.pdUrl=rating.pdUrl;
        if(rating.ratingSource) patch.ratingSource=rating.ratingSource;
        writeDoctorProfile(docId, patch);
        syncDoctorIntoContent(docId, window.AMIR_SERVICES.doctors[docId]);
        if(typeof window.AMIR_syncDoctorCards==='function'){
          window.AMIR_syncDoctorCards(docId, window.AMIR_SERVICES.doctors[docId]);
        }
        if(typeof window.AMIR_applyDocRatings==='function') window.AMIR_applyDocRatings();
      }
    } else if(type==='text'){
      var plain=document.getElementById('cmsText').value;
      if(el.id==='dirGroup'){
        el.innerHTML='<span class="dot"></span>'+escHtml(plain.replace(/^\s*·\s*/,'').trim());
      } else {
        el.textContent=plain;
      }
      if(el.id==='dirTitle' || el.id==='dirDesc'){
        syncServicePageContentToGroups();
        var groups=collectServiceGroups();
        if(groups) content.serviceGroups=groups;
        refreshDirDescPlaceholder();
        if(el.id==='dirTitle'){
          var crumb=document.getElementById('dirCrumb');
          if(crumb) crumb.textContent=plain.trim()||crumb.textContent;
          if(plain.trim()) document.title=plain.trim()+' — цена и запись · АмирДент';
        }
      }
    }

    closeModal();
    markDirty();
    toast('Изменение применено. Нажмите «Сохранить»');
  }

  function deleteCurrent(){
    if(!currentEl || panelMode) return;
    var type=currentEl.getAttribute('data-cms-type')||'';
    var msg=type==='doctor'?'Удалить этого врача со всего сайта? Он пропадёт из всех услуг.':
            type==='price'?'Удалить эту услугу из прайса?':
            'Удалить этот элемент?';
    if(!confirm(msg)) return;
    var el=currentEl;
    if(type==='doctor' || el.matches('.doc,.chief')){
      var delId=el.getAttribute('data-doc')||'';
      if(delId) purgeDoctorEverywhere(delId);
      else el.remove();
      closeModal();
      markDirty();
      toast('Врач удалён везде. Нажмите «Сохранить»');
      return;
    }
    if(type==='price' || el.matches('.prow')){
      var delName=((el.querySelector('.pn')&&el.querySelector('.pn').textContent)||'').trim().toLowerCase();
      if(delName && Array.isArray(content.services)){
        content.services=content.services.filter(function(s){
          return ((s.name||'').trim().toLowerCase())!==delName;
        });
        content.priceHtml=servicesToHtml(content.services);
      }
      el.remove();
      if(isServicePage()) refreshDirPriceCount();
    } else if(el.matches('.pcard,.rev,.step,.reel')){
      el.style.display='none';
    } else {
      el.remove();
    }
    closeModal();
    markDirty();
    toast('Удалено. Нажмите «Сохранить на сайт»');
  }

  function onAdminClick(e){
    if(e.target.closest('.cms-bar,.cms-modal-bg,.burger,#booking')) return;
    if(e.target.closest('.cms-editing')) return;
    var el=e.target.closest('.prow.cms-editable, .doc.cms-editable, .cms-editable');
    if(!el) return;
    e.preventDefault();
    e.stopPropagation();
    var type=el.getAttribute('data-cms-type')||'';
    // На /uslugi/ всегда форма — так надёжнее, чем contentEditable
    if(type==='text' && !isServicePage()){
      startInlineTextEdit(el);
      return;
    }
    openModal(el);
  }

  // Для отладки и запасного скрипта на service.html
  window.AmirCMSService = {
    rewire: function(){
      try{
        if(!AmirCMS.canEdit || !AmirCMS.canEdit()) return;
        enableAdminUi();
        wireTargets();
      }catch(e){}
    },
    open: function(el){ try{ openModal(el); }catch(e){} },
    isServicePage: isServicePage
  };

  function onServicePageReady(){
    if(onServicePageReady._previewOnly) return;
    applyTextItemsOnly(content);
    if(AmirCMS.canEdit && AmirCMS.canEdit()){
      enableAdminUi();
      wireTargets();
      wireServicePageAddPrice();
      refreshDirDescPlaceholder();
      var hint=document.querySelector('.cms-hint');
      if(hint){
        hint.textContent='Кликните описание под названием, чтобы заполнить. Цены — отдельно ниже';
        hint.classList.add('show');
        setTimeout(function(){ hint.classList.remove('show'); }, 4500);
      }
    }
  }

  async function boot(){
    var params=new URLSearchParams(location.search);
    var previewOnly=params.get('preview')==='1';
    onServicePageReady._previewOnly=previewOnly;

    // Слушаем ДО await: цены на /uslugi/ часто приходят раньше конца boot
    document.addEventListener('amir:service-ready', onServicePageReady);

    var fileContent=null;
    try{
      // Живой снимок только для админки (blobs / локальный файл через API).
      // Посетители получают статику из HTML + /assets/content.json без cms.js.
      var res=await fetch('/api/cms/content?ts='+Date.now(),{cache:'no-store'});
      if(res.ok) fileContent=await res.json();
    }catch(e){}

    if(fileContent && ((Number(fileContent.v)||0) >= 2 || fileContent.priceHtml || fileContent.docsHtml || fileContent.doctors || fileContent.services || fileContent.textItems || fileContent.texts)){
      content=fileContent;
      AmirCMS.setRevision(fileContent.revision||fileContent.savedAt||'');
      AmirCMS.saveContent(fileContent);
      applySnapshot(fileContent);
    }

    // Этот файл подключается только через cms-boot после /admin.html + login.
    if(previewOnly){
      if(AmirCMS.exitEditMode) AmirCMS.exitEditMode();
      return;
    }

    if(!await AmirCMS.refreshSession()){
      if(AmirCMS.exitEditMode) AmirCMS.exitEditMode();
      return;
    }
    if(!AmirCMS.canEdit || !AmirCMS.canEdit()){
      if(AmirCMS.exitEditMode) AmirCMS.exitEditMode();
      return;
    }

    enableAdminUi();
    if(window.__amirServiceReady || isServicePage()){
      onServicePageReady();
      // На случай поздней подгрузки прайса — ещё раз пометить через короткий интервал
      setTimeout(onServicePageReady, 400);
      setTimeout(onServicePageReady, 1200);
    }
    // /prices: список приезжает из prices.json асинхронно — переподключить клики
    if(mainPriceList() && !isServicePage()){
      setTimeout(wireTargets, 400);
      setTimeout(wireTargets, 1200);
    }
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
