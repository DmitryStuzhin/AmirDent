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
    '#about > .container > .sec-title > h2',
    '#about > .container > .sec-title > p',
    '#services > .container > .sec-title > h2',
    '#services > .container > .sec-title > p',
    '#services .price-note',
    'section.pad > .container > .sec-title > h2',
    'section.pad > .container > .sec-title > p',
    '#doctors .chief-body .role',
    '#doctors .chief-body h3',
    '#doctors .chief-body .exp',
    '#doctors .chief-body > p',
    '#doctors .chief-facts .f b',
    '#doctors .chief-facts .f small',
    '#doctors .sec-title h2',
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
    textItems.forEach(function(item){
      if(!item || !item.sel) return;
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
            return json.url;
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
    var url='index.html?preview=1&view='+Date.now();
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
      return fetch('/assets/content.json?ts='+Date.now(),{cache:'no-store'}).then(function(r){ return r.json(); }).then(function(remote){
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
    }).catch(function(err){
      var msg=err&&err.message?err.message:String(err);
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
      var src=(d.src||'').trim();
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

  function collectDoctors(){
    return Array.prototype.slice.call(document.querySelectorAll('.doc-grid .doc')).map(function(el){
      var img=el.querySelector('img');
      return {
        id:el.getAttribute('data-doc')||'',
        name:(el.querySelector('h3')&&el.querySelector('h3').textContent.trim())||'',
        role:(el.querySelector('.role')&&el.querySelector('.role').textContent.trim())||'',
        exp:(el.querySelector('.exp')&&el.querySelector('.exp').textContent.trim())||'',
        src:(img&&img.getAttribute('src'))||''
      };
    });
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
    window.AMIR_SERVICES.groups=groups.map(function(g){
      return {
        title:g.title,
        items:(g.items||[]).map(function(it){
          var row={ slug:it.slug, title:it.title, desc:it.desc||'', doctors:it.doctors?it.doctors.slice():[] };
          if(it.match) row.match=it.match;
          return row;
        })
      };
    });
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
      window.AMIR_SERVICES.doctors[d.id]={
        name:d.name||prev.name||'Врач',
        role:d.role||prev.role||'',
        exp:d.exp||prev.exp||'',
        photo:d.src||prev.photo||'',
        spec:prev.spec||d.role||'',
        years:prev.years||'',
        video:prev.video||'',
        bio:prev.bio||[],
        pdRating:prev.pdRating,
        pdReviews:prev.pdReviews,
        pdUrl:prev.pdUrl,
        ratingSource:prev.ratingSource
      };
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
      if(Array.isArray(base.serviceGroups)) snap.serviceGroups=base.serviceGroups;
      else {
        var liveGroups=collectServiceGroups();
        if(liveGroups) snap.serviceGroups=liveGroups;
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
    snap.docsHtml=doctorsToHtml(snap.doctors);

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
          if(docs) docs.innerHTML=doctorsToHtml(snap.doctors);
        } else if(typeof snap.docsHtml==='string'){
          var docs2=document.querySelector('.doc-grid');
          if(docs2) docs2.innerHTML=snap.docsHtml;
        }
      }
    }

    if(Array.isArray(snap.serviceGroups)) applyServiceGroups(snap.serviceGroups);
    syncDoctorsIntoServicesData(snap);
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
    document.querySelectorAll('.doc-grid .doc').forEach(function(r){ markEditable(r, 'Врач', 'doctor'); });

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
      return;
    }
    document.body.classList.add('cms-admin');
    buildBar();
    buildModal();
    wireTargets();
    document.addEventListener('click', onAdminClick, true);
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
    var src=data.src||doctorPlaceholder();
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
      window.AMIR_SERVICES.doctors[id]={
        name:name,
        role:role,
        exp:exp,
        photo:src,
        spec:role,
        years:'',
        video:'',
        bio:[]
      };
    }
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

  function catOptions(selected){
    return [
      ['ortho','Ортодонтия'],['therapy','Терапия'],['hygiene','Гигиена'],
      ['surgery','Хирургия'],['implant','Имплантация'],['prosth','Протезирование'],
      ['paro','Пародонтология'],['kids','Детская'],['cosmo','Косметология']
    ].map(function(p){ return opt(p[0],p[1],selected); }).join('');
  }

  /* Три главных направления сайта — ими выбирают категорию при добавлении услуги. */
  function groupCatKey(cat){
    if(cat==='ortho') return 'ortho';
    if(cat==='cosmo') return 'cosmo';
    return 'stoma';
  }
  function groupCatLabel(cat){
    if(cat==='ortho') return 'Ортодонтия';
    if(cat==='cosmo') return 'Косметология';
    return 'Стоматология';
  }
  function groupCatOptions(selectedCat){
    var cur=groupCatKey(selectedCat||'stoma');
    return [
      ['ortho','Ортодонтия'],
      ['stoma','Стоматология'],
      ['cosmo','Косметология']
    ].map(function(p){ return opt(p[0],p[1],cur); }).join('');
  }
  function groupCatToPriceCat(cat){
    if(cat==='ortho') return 'ortho';
    if(cat==='cosmo') return 'cosmo';
    return 'stoma';
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
  function doctorSelectOptions(subcatSlug, selected){
    var docs=window.AMIR_SERVICES&&window.AMIR_SERVICES.doctors||{};
    var preferred=[];
    var groups=window.AMIR_SERVICES&&window.AMIR_SERVICES.groups||[];
    for(var g=0;g<groups.length;g++){
      var items=groups[g].items||[];
      for(var i=0;i<items.length;i++){
        if(items[i].slug===subcatSlug && items[i].doctors) preferred=items[i].doctors.slice();
      }
    }
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
    var ids=[];
    preferred.forEach(function(id){ if(names[id] && ids.indexOf(id)<0) ids.push(id); });
    Object.keys(names).forEach(function(id){ if(ids.indexOf(id)<0) ids.push(id); });
    if(!ids.length) return '<option value="">Нет врачей</option>';
    return ids.map(function(id){
      return opt(id, names[id]||id, selected||preferred[0]||'');
    }).join('');
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
      fetch('/prices.html?ts='+Date.now(),{cache:'no-store'}).then(function(r){ return r.ok?r.text():''; }).catch(function(){ return ''; }),
      fetch('/assets/content.json?ts='+Date.now(),{cache:'no-store'}).then(function(r){ return r.ok?r.json():null; }).catch(function(){ return null; })
    ]).then(function(pair){
      var html=pair[0], saved=pair[1];
      var base=[];
      if(html){
        var doc=new DOMParser().parseFromString(html,'text/html');
        base=Array.prototype.map.call(doc.querySelectorAll('.price-list .prow'), function(el){
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
        '<div class="field"><label>Специализация</label><input id="cmsNewDocRole" type="text" placeholder="Ортодонтия"></div>'+
        '<div class="field"><label>Опыт / должность</label><input id="cmsNewDocExp" type="text" placeholder="Врач-ортодонт · 5 лет"></div>'+
        '<div class="field"><label>URL фото</label><input id="cmsNewDocSrc" type="text" placeholder="https://..."></div>'+
        '<div class="field"><label>Или файл</label><input id="cmsNewDocFile" type="file" accept="image/*"></div>'+
        '<button type="button" class="btn btn-gold" id="cmsCreateDoctor" style="width:100%">+ Добавить врача</button>';

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
      wireImageFileInput(document.getElementById('cmsNewDocFile'), function(url){
        document.getElementById('cmsNewDocSrc').value=url;
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
        var doc=addDoctor(null, {
          name:name,
          role:document.getElementById('cmsNewDocRole').value.trim()||'Специализация',
          exp:document.getElementById('cmsNewDocExp').value.trim()||'Опыт работы',
          src:document.getElementById('cmsNewDocSrc').value.trim()||doctorPlaceholder()
        });
        if(!doc) return;
        markDirty();
        toast('Врач добавлен. Нажмите «Сохранить»');
        openDocsServicesPanel('doctors');
      };

      pane.querySelectorAll('.cms-del-doc').forEach(function(btn){
        btn.onclick=function(){
          var i=+btn.getAttribute('data-idx');
          var el=document.querySelectorAll('.doc-grid .doc')[i];
          if(!el) return;
          var nm=(el.querySelector('h3')&&el.querySelector('h3').textContent)||'этого врача';
          if(!confirm('Удалить врача «'+nm+'»?')) return;
          el.remove();
          markDirty();
          toast('Врач удалён. Нажмите «Сохранить»');
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
    }

    function renderServicesPane(pane){
      if(!window.AMIR_SERVICES || !Array.isArray(window.AMIR_SERVICES.groups)){
        pane.innerHTML='<p class="sub" style="margin-top:0">Список направлений не загружен. Обновите страницу.</p>';
        return;
      }
      pane.innerHTML='<p class="sub" style="margin-top:0">Загружаем список услуг…</p>';
      hydrateServicesForAdmin(function(rows){
        renderServicesPaneReady(pane, rows||[]);
      });
    }

    function renderServicesPaneReady(pane, rows){
      var svcRows=Array.isArray(rows)?rows.slice():[];
      function subcatOptionsHtml(cat, selected){
        var items=subcatsForGroup(cat);
        if(!items.length) return '<option value="">Нет подкатегорий</option>';
        return items.map(function(it){ return opt(it.slug, it.title, selected||''); }).join('');
      }
      var firstCat='ortho';
      var firstSubs=subcatsForGroup(firstCat);
      var firstSub=firstSubs[0]?firstSubs[0].slug:'';
      pane.innerHTML=
        '<p class="sub" style="margin-top:0">Новая услуга попадает в общий прайс и в список цен внутри выбранной подкатегории (например, «Брекеты»). В колонки на главной она не добавляется.</p>'+
        '<div class="field"><label>Поиск в списке</label><input id="cmsSvcSearch" type="search" placeholder="Начните вводить название…"></div>'+
        '<div class="cms-item-list" id="cmsSvcList"></div>'+
        '<div class="cms-divider"></div>'+
        '<h4 class="cms-h4">Добавить услугу</h4>'+
        '<div class="field"><label>Название</label><input id="cmsNewSvcName" type="text" placeholder="Название услуги"></div>'+
        '<div class="field"><label>Категория</label><select id="cmsNewSvcCat">'+groupCatOptions(firstCat)+'</select></div>'+
        '<div class="field"><label>Подкатегория</label><select id="cmsNewSvcSubcat">'+subcatOptionsHtml(firstCat, firstSub)+'</select></div>'+
        '<div class="field"><label>Врач</label><select id="cmsNewSvcDoctor">'+doctorSelectOptions(firstSub, '')+'</select></div>'+
        '<div class="field"><label>Цена</label><input id="cmsNewSvcPrice" type="text" placeholder="5 000 ₽"></div>'+
        '<button type="button" class="btn btn-gold" id="cmsCreateService" style="width:100%">+ Добавить услугу</button>';

      function refreshSubcatAndDoctor(){
        var cat=document.getElementById('cmsNewSvcCat').value||'ortho';
        var subSel=document.getElementById('cmsNewSvcSubcat');
        var cur=subSel.value;
        var items=subcatsForGroup(cat);
        var keep=items.some(function(it){ return it.slug===cur; })?cur:(items[0]?items[0].slug:'');
        subSel.innerHTML=subcatOptionsHtml(cat, keep);
        document.getElementById('cmsNewSvcDoctor').innerHTML=doctorSelectOptions(subSel.value, '');
      }

      function persistSvcRows(){
        setEditableServices(svcRows);
        markDirty();
      }

      function removeServiceAt(idx){
        if(idx<0 || idx>=svcRows.length) return false;
        var removed=svcRows.splice(idx,1)[0];
        persistSvcRows();
        // Убрать строку из DOM-прайса точечно (без полной пересборки, если уже обновили)
        var name=(removed&&removed.name||'').trim().toLowerCase();
        if(name){
          document.querySelectorAll('.price-list .prow').forEach(function(el){
            var n=((el.querySelector('.pn')&&el.querySelector('.pn').textContent)||el.getAttribute('data-name')||'').trim().toLowerCase();
            if(n===name) el.remove();
          });
        }
        return true;
      }

      function renderList(q){
        q=(q||'').trim().toLowerCase();
        var listBox=document.getElementById('cmsSvcList');
        if(!listBox) return;
        var html=[];
        svcRows.forEach(function(row, i){
          var name=row.name||'';
          var tag=row.tag||'';
          var sub=subcatTitleBySlug(row.subcat||'');
          if(q && name.toLowerCase().indexOf(q)<0 && tag.toLowerCase().indexOf(q)<0 && sub.toLowerCase().indexOf(q)<0) return;
          html.push(
            '<div class="cms-item" data-idx="'+i+'">'+
              '<div class="cms-item-main"><b></b><small></small></div>'+
              '<div class="cms-item-actions">'+
                '<button type="button" class="btn btn-danger cms-del-svc" data-idx="'+i+'" data-state="idle">Удалить</button>'+
              '</div></div>'
          );
        });
        listBox.innerHTML=html.length?html.join(''):'<p class="sub">Пока нет услуг или ничего не найдено</p>';
        listBox.querySelectorAll('.cms-item').forEach(function(item){
          var i=+item.getAttribute('data-idx');
          var row=svcRows[i]; if(!row) return;
          item.querySelector('b').textContent=row.name||'';
          var bits=[row.tag||'', subcatTitleBySlug(row.subcat||''), doctorNameById(row.doctor||''), row.price||''].filter(Boolean);
          item.querySelector('small').textContent=bits.join(' · ');
        });
      }

      var listBox=document.getElementById('cmsSvcList');
      // Делегирование: без native confirm (он даёт «клик навылет» и откат списка)
      listBox.addEventListener('click', function(e){
        var btn=e.target&&e.target.closest?e.target.closest('.cms-del-svc'):null;
        if(!btn || !listBox.contains(btn)) return;
        e.preventDefault();
        e.stopPropagation();
        var i=+btn.getAttribute('data-idx');
        var row=svcRows[i];
        if(!row) return;
        var state=btn.getAttribute('data-state')||'idle';
        if(state!=='confirm'){
          listBox.querySelectorAll('.cms-del-svc[data-state="confirm"]').forEach(function(b){
            b.setAttribute('data-state','idle');
            b.textContent='Удалить';
          });
          btn.setAttribute('data-state','confirm');
          btn.textContent='Точно удалить?';
          return;
        }
        if(!removeServiceAt(i)) return;
        toast('Услуга «'+(row.name||'')+'» удалена. Нажмите «Сохранить»');
        var qEl=document.getElementById('cmsSvcSearch');
        renderList(qEl?qEl.value:'');
      });

      renderList('');
      document.getElementById('cmsSvcSearch').oninput=function(){ renderList(this.value); };
      document.getElementById('cmsNewSvcCat').onchange=refreshSubcatAndDoctor;
      document.getElementById('cmsNewSvcSubcat').onchange=function(){
        document.getElementById('cmsNewSvcDoctor').innerHTML=doctorSelectOptions(this.value, '');
      };
      document.getElementById('cmsCreateService').onclick=function(){
        var name=document.getElementById('cmsNewSvcName').value.trim();
        if(!name){ alert('Введите название услуги'); return; }
        var cat=document.getElementById('cmsNewSvcCat').value||'ortho';
        var subcat=document.getElementById('cmsNewSvcSubcat').value;
        if(!subcat){ alert('Выберите подкатегорию'); return; }
        var doctor=document.getElementById('cmsNewSvcDoctor').value;
        if(!doctor){ alert('Выберите врача'); return; }
        var price=document.getElementById('cmsNewSvcPrice').value.trim()||'0 ₽';
        var entry={
          name:name,
          tag:groupCatLabel(cat),
          price:price,
          cat:groupCatToPriceCat(cat),
          subcat:subcat,
          doctor:doctor
        };
        svcRows.unshift(entry);
        ensureDoctorOnSubcat(subcat, doctor);
        persistSvcRows();
        toast('Услуга добавлена в «'+subcatTitleBySlug(subcat)+'». Нажмите «Сохранить»');
        document.getElementById('cmsNewSvcName').value='';
        document.getElementById('cmsNewSvcPrice').value='';
        var qEl=document.getElementById('cmsSvcSearch');
        if(qEl) qEl.value='';
        renderList('');
      };
    }

    modal.classList.add('open');
  }

  function openDoctorsPanel(){ openDocsServicesPanel('doctors'); }
  function openServicesPanel(){ openDocsServicesPanel('services'); }

  async function openHistoryPanel(){
    panelMode='history';
    currentEl=null;
    var modal=document.getElementById('cmsModal');
    var box=modal.querySelector('.cms-modal');
    box.classList.add('cms-modal-wide');
    document.getElementById('cmsModalTitle').textContent='История изменений';
    document.getElementById('cmsModalSub').textContent='Можно вернуться к одной из предыдущих сохранённых версий';
    document.getElementById('cmsDelete').style.display='none';
    document.getElementById('cmsApply').style.display='none';
    document.getElementById('cmsCancel').textContent='Закрыть';
    var fields=document.getElementById('cmsModalFields');
    fields.innerHTML='<p class="sub">Загружаем историю…</p>';
    modal.classList.add('open');

    try{
      var versions=await AmirCMS.listVersions();
      if(!versions.length){
        fields.innerHTML='<p class="sub">История появится после первого сохранения.</p>';
        return;
      }
      fields.innerHTML=
        '<div class="cms-item-list">'+versions.slice(0,20).map(function(v,i){
          var date=v.archivedAt?new Date(v.archivedAt).toLocaleString('ru-RU'):'Дата не указана';
          var author=v.archivedBy?' · '+escHtml(v.archivedBy):'';
          return '<div class="cms-item">'+
            '<div class="cms-item-main"><b>Версия от '+escHtml(date)+'</b><small>'+author+'</small></div>'+
            '<div class="cms-item-actions"><button type="button" class="btn btn-ghost cms-restore-version" data-idx="'+i+'" data-state="idle">Восстановить</button></div>'+
          '</div>';
        }).join('')+'</div>'+
        '<p class="sub" style="margin-top:14px">Перед восстановлением текущая версия автоматически сохранится в истории.</p>';

      fields.addEventListener('click',async function(e){
        var btn=e.target.closest('.cms-restore-version');
        if(!btn || !fields.contains(btn))return;
        var state=btn.getAttribute('data-state')||'idle';
        if(state!=='confirm'){
          fields.querySelectorAll('.cms-restore-version[data-state="confirm"]').forEach(function(other){
            other.setAttribute('data-state','idle');
            other.textContent='Восстановить';
          });
          btn.setAttribute('data-state','confirm');
          btn.textContent='Подтвердить восстановление';
          return;
        }
        var index=parseInt(btn.getAttribute('data-idx'),10);
        if(index<0 || index>=versions.length)return;
        fields.querySelectorAll('button').forEach(function(other){other.disabled=true;});
        btn.textContent='Восстанавливаем…';
        try{
          await AmirCMS.restoreVersion(versions[index].key);
          location.reload();
        }catch(err){
          fields.querySelectorAll('button').forEach(function(other){other.disabled=false;});
          btn.setAttribute('data-state','idle');
          btn.textContent='Повторить восстановление';
          toast('Не удалось восстановить версию: '+(err&&err.message?err.message:err));
        }
      });
    }catch(err){
      fields.innerHTML='<p class="sub">Не удалось загрузить историю. Закройте окно и попробуйте ещё раз.</p>';
      toast('Ошибка истории: '+(err&&err.message?err.message:err));
    }
  }

  function buildBar(){
    var bar=document.createElement('div');
    bar.className='cms-bar';
    bar.innerHTML=
      '<div class="left"><span class="badge">Режим правки</span><span class="meta">Клик по тексту / фото / блоку</span></div>'+
      '<div class="right">'+
        '<button type="button" id="cmsManageDoctors">Врачи</button>'+
        '<button type="button" id="cmsManageServices">Услуги</button>'+
        '<button type="button" id="cmsHistory">История</button>'+
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
        location.href='/prices.html';
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
    document.getElementById('cmsHistory').onclick=function(){ openHistoryPanel(); };
    document.getElementById('cmsPreview').onclick=function(){
      window.open('index.html?preview=1&view='+Date.now(), '_blank', 'noopener,noreferrer');
    };
    document.getElementById('cmsLogout').onclick=async function(){ await AmirCMS.logout(); location.href='index.html'; };
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
    if(box) box.classList.remove('cms-modal-wide');
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
      fields.innerHTML=
        '<div class="field"><label>Название</label><input id="cmsName" type="text"></div>'+
        '<div class="field"><label>Категория</label><select id="cmsCat">'+groupCatOptions(el.dataset.cat)+'</select></div>'+
        '<div class="field"><label>Цена</label><input id="cmsPrice" type="text"></div>'+
        '<div class="field"><label><input id="cmsAddAfter" type="checkbox"> Добавить ещё услугу ниже</label></div>';
      document.getElementById('cmsName').value=pn?pn.textContent:'';
      document.getElementById('cmsPrice').value=pp?pp.textContent:'';
    } else if(type==='doctor'){
      title.textContent='Редактировать врача';
      var img=el.querySelector('.doc-photo img');
      var role=el.querySelector('.doc-body .role');
      var name=el.querySelector('.doc-body h3');
      var exp=el.querySelector('.doc-body .exp');
      fields.innerHTML=
        '<div class="field"><label>ФИО</label><input id="cmsDocName" type="text"></div>'+
        '<div class="field"><label>Специализация</label><input id="cmsDocRole" type="text"></div>'+
        '<div class="field"><label>Опыт / должность</label><input id="cmsDocExp" type="text"></div>'+
        '<div class="field"><label>URL фото</label><input id="cmsDocSrc" type="text" value="'+escAttr(img?img.getAttribute('src'):'')+'"></div>'+
        '<div class="field"><label>Загрузить с устройства</label><input id="cmsDocFile" type="file" accept="image/*"></div>'+
        '<p class="sub" style="margin:0 0 8px">Фото сожмётся и сохранится на сервер — будет отображаться стабильно.</p>'+
        '<img class="preview-img" id="cmsDocPrev" src="'+escAttr(img?img.getAttribute('src'):'')+'" alt="">';
      document.getElementById('cmsDocName').value=name?name.textContent:'';
      document.getElementById('cmsDocRole').value=role?role.textContent:'';
      document.getElementById('cmsDocExp').value=exp?exp.textContent:'';
      document.getElementById('cmsDocSrc').oninput=function(){ document.getElementById('cmsDocPrev').src=this.value; };
      wireImageFileInput(document.getElementById('cmsDocFile'), function(url){
        document.getElementById('cmsDocSrc').value=url;
        document.getElementById('cmsDocPrev').src=url;
      });
    } else if(type==='text'){
      title.textContent='Изменить текст';
      var sub=document.getElementById('cmsModalSub');
      if(sub) sub.textContent='Введите новый текст — как на сайте, без кода';
      del.style.display='none';
      fields.innerHTML='<div class="field"><label>Текст</label><textarea id="cmsText" rows="5"></textarea></div>';
      document.getElementById('cmsText').value=(el.innerText||el.textContent||'').replace(/\n+$/,'');
    } else {
      // Никакого HTML-редактора блоков — уводим на простой текст, если возможно
      title.textContent='Изменить текст';
      del.style.display='none';
      fields.innerHTML='<div class="field"><label>Текст</label><textarea id="cmsText" rows="5"></textarea></div>';
      document.getElementById('cmsText').value=(el.innerText||el.textContent||'').replace(/\n+$/,'');
      el.setAttribute('data-cms-type','text');
    }
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
    if(box) box.classList.remove('cms-modal-wide');
    if(apply){ apply.style.display=''; apply.textContent='Сохранить'; }
    if(cancel) cancel.textContent='Отмена';
    if(del){ del.style.display=''; del.textContent='Удалить'; }
  }

  function applyModal(){
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
    } else if(type==='price'){
      var name=document.getElementById('cmsName').value.trim();
      var cat=document.getElementById('cmsCat').value||'stoma';
      var tag=groupCatLabel(cat);
      var price=document.getElementById('cmsPrice').value.trim();
      var pn=el.querySelector('.pn'); var pp=el.querySelector('.pp'); var pt=el.querySelector('.ptag');
      if(pn) pn.textContent=name;
      if(pt) pt.textContent=tag;
      if(pp) pp.textContent=price;
      el.dataset.cat=cat;
      el.dataset.name=name.toLowerCase();
      if(document.getElementById('cmsAddAfter') && document.getElementById('cmsAddAfter').checked){
        var neu=addPriceRow(el.closest('.price-list'));
        if(neu) el.after(neu);
      }
    } else if(type==='doctor'){
      var dName=document.getElementById('cmsDocName').value.trim()||'Врач';
      var dRole=document.getElementById('cmsDocRole').value.trim();
      var dExp=document.getElementById('cmsDocExp').value.trim();
      var dSrc=document.getElementById('cmsDocSrc').value.trim();
      var dImg=el.querySelector('.doc-photo img');
      var dRoleEl=el.querySelector('.doc-body .role');
      var dNameEl=el.querySelector('.doc-body h3');
      var dExpEl=el.querySelector('.doc-body .exp');
      if(dNameEl) dNameEl.textContent=dName;
      if(dRoleEl) dRoleEl.textContent=dRole;
      if(dExpEl) dExpEl.textContent=dExp;
      if(dImg){
        dImg.setAttribute('src', dSrc || doctorPlaceholder());
        dImg.setAttribute('alt', dName);
      }
    } else if(type==='text'){
      var plain=document.getElementById('cmsText').value;
      if(el.id==='dirGroup'){
        el.innerHTML='<span class="dot"></span>'+escHtml(plain.replace(/^\s*·\s*/,'').trim());
      } else {
        el.textContent=plain;
      }
    }

    closeModal();
    markDirty();
    toast('Изменение применено. Нажмите «Сохранить»');
  }

  function deleteCurrent(){
    if(!currentEl || panelMode) return;
    var type=currentEl.getAttribute('data-cms-type')||'';
    var msg=type==='doctor'?'Удалить этого врача с сайта?':
            type==='price'?'Удалить эту услугу из прайса?':
            'Удалить этот элемент?';
    if(!confirm(msg)) return;
    var el=currentEl;
    if(type==='doctor' || type==='price' || el.matches('.prow,.doc')){
      el.remove();
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
    rewire: function(){ try{ enableAdminUi(); wireTargets(); }catch(e){} },
    open: function(el){ try{ openModal(el); }catch(e){} },
    isServicePage: isServicePage
  };

  function onServicePageReady(){
    if(onServicePageReady._previewOnly) return;
    applyTextItemsOnly(content);
    if(AmirCMS.isAuthed()){
      enableAdminUi();
      wireTargets();
      var hint=document.querySelector('.cms-hint');
      if(hint){
        hint.textContent='Кликните заголовок, описание, факты, цены или фото врача';
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
      var res=await fetch('/assets/content.json?ts='+Date.now(),{cache:'no-store'});
      if(res.ok) fileContent=await res.json();
    }catch(e){}

    if(fileContent && (fileContent.v===2 || fileContent.v===3 || fileContent.v===4 || fileContent.priceHtml || fileContent.docsHtml || fileContent.doctors || fileContent.services || fileContent.textItems || fileContent.texts)){
      content=fileContent;
      AmirCMS.setRevision(fileContent.revision||fileContent.savedAt||'');
      AmirCMS.saveContent(fileContent);
      applySnapshot(fileContent);
    }

    // Режим пользователя после сохранения из админки — без панели редактора
    if(previewOnly) return;
    if(!await AmirCMS.refreshSession()) return;

    enableAdminUi();
    if(window.__amirServiceReady || isServicePage()){
      onServicePageReady();
      // На случай поздней подгрузки прайса — ещё раз пометить через короткий интервал
      setTimeout(onServicePageReady, 400);
      setTimeout(onServicePageReady, 1200);
    }
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
