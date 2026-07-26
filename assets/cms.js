/* AmirDent CMS — reliable snapshot save/load (no overlapping selectors) */
(function(){
  if(!window.AmirCMS) return;

  var content = { v:3 };
  var currentEl = null;
  var dirty = false;
  var panelMode = null; // 'doctors' | 'services' | null

  // Only UNIQUE selectors — each node matched once
  var TEXT_SELECTORS = [
    '.hero-copy h1',
    '.hero-sub',
    '#about > .container > .sec-title > h2',
    '#about > .container > .sec-title > p',
    '#services > .container > .sec-title > h2',
    '#services > .container > .sec-title > p',
    '#services .price-note',
    'section.pad > .container > .sec-title > h2',
    'section.pad > .container > .sec-title > p',
    'section.pad.cream2 > .container > .sec-title > h2',
    'section.pad.cream2 > .container > .sec-title > p',
    '#doctors .chief-body .role',
    '#doctors .chief-body h3',
    '#doctors .chief-body .exp',
    '#doctors .chief-body > p',
    '#doctors .sec-title h2',
    '#zapis .cta-grid > div > h2',
    '#zapis .cta-grid > div > p:not(.agree)',
    '.ftr-about'
  ];

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
    if(!AmirCMS.getToken()){
      toast('Сессия устарела — войдите снова');
      setTimeout(function(){ location.href='admin.html'; }, 800);
      return Promise.reject(new Error('no token'));
    }
    return AmirCMS.publishContent(content).then(function(res){
      return fetch('assets/content.json?ts='+Date.now(),{cache:'no-store'}).then(function(r){ return r.json(); }).then(function(remote){
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
      toast('Ошибка сохранения: '+(err&&err.message?err.message:err));
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

  function queryUniqueTexts(){
    // Collect text nodes with de-duplication (first selector wins)
    var seen=new Set();
    var items=[];
    TEXT_SELECTORS.forEach(function(sel){
      document.querySelectorAll(sel).forEach(function(n, idx){
        if(isCmsUi(n)) return;
        if(seen.has(n)) return;
        seen.add(n);
        items.push({
          sel: sel,
          idx: idx,
          html: n.innerHTML,
          hidden: n.style.display==='none'
        });
      });
    });
    // Also capture step / doc / review / chip / card labels uniquely by path index
    var extraGroups=[
      ['.steps-grid .step h3', 'html'],
      ['.steps-grid .step p', 'html'],
      ['.rev-grid .rev > p', 'html'],
      ['.rev-grid .rev .who b', 'html'],
      ['.rev-grid .rev .who small', 'html'],
      ['.why-grid .pcard .lbl', 'html'],
      ['.why-grid .pcard .cap .big', 'html'],
      ['.why-grid .pcard .cap p', 'html'],
      ['.why-grid .pcard .lbl2', 'html'],
      ['.why-grid .pcard.solid > p', 'html'],
      ['.chip', 'html'],
      ['.hero-trust .t', 'html']
    ];
    extraGroups.forEach(function(pair){
      var sel=pair[0];
      document.querySelectorAll(sel).forEach(function(n, idx){
        if(isCmsUi(n) || seen.has(n)) return;
        seen.add(n);
        items.push({ sel:sel, idx:idx, html:n.innerHTML, hidden:n.style.display==='none' });
      });
    });
    return items;
  }

  function doctorsToHtml(list){
    return (list||[]).map(function(d){
      var src=d.src||'';
      var name=d.name||'Врач';
      return '<article class="doc">'+
        '<div class="doc-photo"><img src="'+escAttr(src)+'" alt="'+escAttr(name)+'"></div>'+
        '<div class="doc-body">'+
        '<div class="role">'+(d.role||'').replace(/</g,'&lt;')+'</div>'+
        '<h3>'+name.replace(/</g,'&lt;')+'</h3>'+
        '<div class="exp">'+(d.exp||'').replace(/</g,'&lt;')+'</div>'+
        '</div></article>';
    }).join('');
  }

  function servicesToHtml(list){
    return (list||[]).map(function(s){
      var name=s.name||'Услуга';
      return '<div class="prow" data-cat="'+escAttr(s.cat||'therapy')+'" data-name="'+escAttr(name.toLowerCase())+'">'+
        '<span class="pn">'+name.replace(/</g,'&lt;')+'</span>'+
        '<span class="ptag">'+(s.tag||'').replace(/</g,'&lt;')+'</span>'+
        '<span class="pp">'+(s.price||'').replace(/</g,'&lt;')+'</span></div>';
    }).join('');
  }

  function collectDoctors(){
    return Array.prototype.slice.call(document.querySelectorAll('.doc-grid .doc')).map(function(el){
      var img=el.querySelector('img');
      return {
        name:(el.querySelector('h3')&&el.querySelector('h3').textContent.trim())||'',
        role:(el.querySelector('.role')&&el.querySelector('.role').textContent.trim())||'',
        exp:(el.querySelector('.exp')&&el.querySelector('.exp').textContent.trim())||'',
        src:(img&&img.getAttribute('src'))||''
      };
    });
  }

  function collectServices(){
    return Array.prototype.slice.call(document.querySelectorAll('.price-list .prow')).map(function(el){
      return {
        name:(el.querySelector('.pn')&&el.querySelector('.pn').textContent.trim())||'',
        tag:(el.querySelector('.ptag')&&el.querySelector('.ptag').textContent.trim())||'',
        price:(el.querySelector('.pp')&&el.querySelector('.pp').textContent.trim())||'',
        cat:el.getAttribute('data-cat')||'therapy'
      };
    });
  }

  function buildSnapshot(){
    var snap={ v:4, savedAt:new Date().toISOString() };

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
    snap.services=collectServices();
    snap.docsHtml=doctorsToHtml(snap.doctors);
    snap.priceHtml=servicesToHtml(snap.services);

    snap.textItems=queryUniqueTexts();

    snap.hiddenBlocks=[];
    ['.why-grid .pcard','.rev-grid .rev','.steps-grid .step','.reel'].forEach(function(sel){
      document.querySelectorAll(sel).forEach(function(n, idx){
        if(n.style.display==='none') snap.hiddenBlocks.push({ sel:sel, idx:idx });
      });
    });

    return snap;
  }

  function applySnapshot(snap){
    if(!snap || typeof snap!=='object') return;

    // Prefer structured arrays from admin dashboard
    if(Array.isArray(snap.services)){
      var list=document.querySelector('.price-list');
      if(list) list.innerHTML=servicesToHtml(snap.services);
    } else if(typeof snap.priceHtml==='string'){
      var list2=document.querySelector('.price-list');
      if(list2) list2.innerHTML=snap.priceHtml;
    }

    if(Array.isArray(snap.doctors)){
      var docs=document.querySelector('.doc-grid');
      if(docs) docs.innerHTML=doctorsToHtml(snap.doctors);
    } else if(typeof snap.docsHtml==='string'){
      var docs2=document.querySelector('.doc-grid');
      if(docs2) docs2.innerHTML=snap.docsHtml;
    }

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
        var nodes=document.querySelectorAll(item.sel);
        var n=nodes[item.idx||0];
        if(!n) return;
        if(typeof item.html==='string') n.innerHTML=item.html;
        n.style.display=item.hidden?'none':'';
      });
    }

    // 3) images AFTER texts (so img tags inside edited HTML get final src)
    if(Array.isArray(snap.images)){
      var imgs=contentImgs();
      snap.images.forEach(function(item, i){
        if(!imgs[i] || !item) return;
        if(item.src!=null && item.src!=='') imgs[i].setAttribute('src', item.src);
        if(item.alt!=null) imgs[i].setAttribute('alt', item.alt);
      });
    }

    // 4) reels
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
  }

  function markEditable(el, label, type){
    if(!el || isCmsUi(el)) return;
    el.classList.add('cms-editable');
    el.setAttribute('data-cms-label', label||'Редактировать');
    el.setAttribute('data-cms-type', type||'block');
  }

  function wireTargets(){
    contentImgs().forEach(function(img){ markEditable(img, 'Фото', 'image'); });
    document.querySelectorAll('.reel').forEach(function(r){ markEditable(r, 'Видео', 'video'); });
    document.querySelectorAll('.prow').forEach(function(r){ markEditable(r, 'Услуга', 'price'); });
    document.querySelectorAll('.doc-grid .doc').forEach(function(r){ markEditable(r, 'Врач', 'doctor'); });
    document.querySelectorAll('.pcard,.rev,.step,.chief,.ba-wrap,.score').forEach(function(r){
      markEditable(r, 'Блок', 'block');
    });
    document.querySelectorAll('.hero-copy h1,.hero-sub,.sec-title h2,.sec-title p,.chip,.ftr-about,.chief-body h3,.chief-body p,.chief-body .role,.chief-body .exp,.rev > p,.step h3,.step p,.cta-grid > div > h2,.cta-grid > div > p,.price-note,.hero-trust .t').forEach(function(el){
      markEditable(el, 'Текст', 'text');
    });
  }

  function addPriceRow(list, data){
    list=list||document.querySelector('.price-list');
    if(!list){ alert('Блок прайса не найден'); return null; }
    data=data||{};
    var name=data.name||'Новая услуга';
    var tag=data.tag||'Терапия';
    var price=data.price||'0 ₽';
    var cat=data.cat||'therapy';
    var row=document.createElement('div');
    row.className='prow';
    row.dataset.cat=cat;
    row.dataset.name=String(name).toLowerCase();
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

  function addDoctor(grid, data){
    grid=grid||document.querySelector('.doc-grid');
    if(!grid){ alert('Блок врачей не найден'); return null; }
    data=data||{};
    var name=data.name||'Новый врач';
    var role=data.role||'Специализация';
    var exp=data.exp||'Опыт работы';
    var src=data.src||doctorPlaceholder();
    var art=document.createElement('article');
    art.className='doc';
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
    return art;
  }

  function catOptions(selected){
    return [
      ['ortho','Ортодонтия'],['therapy','Терапия'],['hygiene','Гигиена'],
      ['surgery','Хирургия'],['implant','Имплантация'],['prosth','Протезирование'],
      ['paro','Пародонтология'],['kids','Детская']
    ].map(function(p){ return opt(p[0],p[1],selected); }).join('');
  }

  function openDoctorsPanel(){
    panelMode='doctors';
    currentEl=null;
    var modal=document.getElementById('cmsModal');
    var box=modal.querySelector('.cms-modal');
    box.classList.add('cms-modal-wide');
    document.getElementById('cmsModalTitle').textContent='Управление врачами';
    document.getElementById('cmsDelete').style.display='none';
    document.getElementById('cmsApply').style.display='none';
    document.getElementById('cmsCancel').textContent='Закрыть';
    var fields=document.getElementById('cmsModalFields');
    var docs=Array.prototype.slice.call(document.querySelectorAll('.doc-grid .doc'));
    var listHtml=docs.map(function(doc, i){
      var name=(doc.querySelector('h3')&&doc.querySelector('h3').textContent)||('Врач '+(i+1));
      var role=(doc.querySelector('.role')&&doc.querySelector('.role').textContent)||'';
      return '<div class="cms-item" data-idx="'+i+'">'+
        '<div class="cms-item-main"><b></b><small></small></div>'+
        '<div class="cms-item-actions">'+
          '<button type="button" class="btn btn-ghost cms-edit-doc" data-idx="'+i+'">Изменить</button>'+
          '<button type="button" class="btn btn-danger cms-del-doc" data-idx="'+i+'">Удалить</button>'+
        '</div></div>';
    }).join('');
    fields.innerHTML=
      '<p class="sub" style="margin-top:0">Добавьте врача формой ниже или удалите из списка. Потом нажмите «Сохранить на сайт».</p>'+
      '<div class="cms-item-list" id="cmsDocList">'+(listHtml||'<p class="sub">Пока нет врачей в сетке.</p>')+'</div>'+
      '<div class="cms-divider"></div>'+
      '<h4 class="cms-h4">Добавить врача</h4>'+
      '<div class="field"><label>ФИО</label><input id="cmsNewDocName" type="text" placeholder="Иванов Иван"></div>'+
      '<div class="field"><label>Специализация</label><input id="cmsNewDocRole" type="text" placeholder="Ортодонтия"></div>'+
      '<div class="field"><label>Опыт / должность</label><input id="cmsNewDocExp" type="text" placeholder="Врач-ортодонт · 5 лет"></div>'+
      '<div class="field"><label>URL фото</label><input id="cmsNewDocSrc" type="text" placeholder="https://..."></div>'+
      '<div class="field"><label>Или файл</label><input id="cmsNewDocFile" type="file" accept="image/*"></div>'+
      '<button type="button" class="btn btn-gold" id="cmsCreateDoctor" style="width:100%">+ Добавить врача</button>';

    // fill names safely
    fields.querySelectorAll('.cms-item').forEach(function(item){
      var i=+item.getAttribute('data-idx');
      var doc=docs[i]; if(!doc) return;
      var b=item.querySelector('b'); var sm=item.querySelector('small');
      b.textContent=(doc.querySelector('h3')&&doc.querySelector('h3').textContent)||'';
      sm.textContent=(doc.querySelector('.role')&&doc.querySelector('.role').textContent)||'';
    });

    document.getElementById('cmsNewDocFile').onchange=function(e){
      var f=e.target.files&&e.target.files[0]; if(!f) return;
      if(f.size>2.5*1024*1024){ alert('Файл слишком большой (макс ~2.5 МБ)'); return; }
      var r=new FileReader();
      r.onload=function(){ document.getElementById('cmsNewDocSrc').value=r.result; };
      r.readAsDataURL(f);
    };

    document.getElementById('cmsCreateDoctor').onclick=function(){
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
      toast('Врач добавлен. Нажмите «Сохранить на сайт»');
      openDoctorsPanel();
    };

    fields.querySelectorAll('.cms-del-doc').forEach(function(btn){
      btn.onclick=function(){
        var i=+btn.getAttribute('data-idx');
        var list=document.querySelectorAll('.doc-grid .doc');
        var el=list[i];
        if(!el) return;
        var nm=(el.querySelector('h3')&&el.querySelector('h3').textContent)||'этого врача';
        if(!confirm('Удалить врача «'+nm+'»?')) return;
        el.remove();
        markDirty();
        toast('Врач удалён. Нажмите «Сохранить на сайт»');
        openDoctorsPanel();
      };
    });

    fields.querySelectorAll('.cms-edit-doc').forEach(function(btn){
      btn.onclick=function(){
        var i=+btn.getAttribute('data-idx');
        var el=document.querySelectorAll('.doc-grid .doc')[i];
        if(el){ closeModal(); openModal(el); }
      };
    });

    modal.classList.add('open');
  }

  function openServicesPanel(){
    panelMode='services';
    currentEl=null;
    var modal=document.getElementById('cmsModal');
    var box=modal.querySelector('.cms-modal');
    box.classList.add('cms-modal-wide');
    document.getElementById('cmsModalTitle').textContent='Управление услугами';
    document.getElementById('cmsDelete').style.display='none';
    document.getElementById('cmsApply').style.display='none';
    document.getElementById('cmsCancel').textContent='Закрыть';
    var fields=document.getElementById('cmsModalFields');
    var rows=Array.prototype.slice.call(document.querySelectorAll('.price-list .prow'));
    fields.innerHTML=
      '<p class="sub" style="margin-top:0">Добавьте услугу формой ниже. Удаление — кнопкой в списке. Потом «Сохранить на сайт».</p>'+
      '<div class="field"><label>Поиск в списке</label><input id="cmsSvcSearch" type="search" placeholder="Начните вводить название…"></div>'+
      '<div class="cms-item-list" id="cmsSvcList"></div>'+
      '<div class="cms-divider"></div>'+
      '<h4 class="cms-h4">Добавить услугу</h4>'+
      '<div class="field"><label>Название</label><input id="cmsNewSvcName" type="text" placeholder="Название услуги"></div>'+
      '<div class="field"><label>Категория (подпись)</label><input id="cmsNewSvcTag" type="text" placeholder="Терапия"></div>'+
      '<div class="field"><label>Цена</label><input id="cmsNewSvcPrice" type="text" placeholder="5 000 ₽"></div>'+
      '<div class="field"><label>Фильтр</label><select id="cmsNewSvcCat">'+catOptions('therapy')+'</select></div>'+
      '<button type="button" class="btn btn-gold" id="cmsCreateService" style="width:100%">+ Добавить услугу</button>';

    function renderList(q){
      q=(q||'').trim().toLowerCase();
      var box=document.getElementById('cmsSvcList');
      var matched=rows.map(function(row, i){
        var name=(row.querySelector('.pn')&&row.querySelector('.pn').textContent)||'';
        var price=(row.querySelector('.pp')&&row.querySelector('.pp').textContent)||'';
        var tag=(row.querySelector('.ptag')&&row.querySelector('.ptag').textContent)||'';
        if(q && name.toLowerCase().indexOf(q)<0 && tag.toLowerCase().indexOf(q)<0) return '';
        return '<div class="cms-item" data-idx="'+i+'">'+
          '<div class="cms-item-main"><b></b><small></small></div>'+
          '<div class="cms-item-actions">'+
            '<button type="button" class="btn btn-ghost cms-edit-svc" data-idx="'+i+'">Изменить</button>'+
            '<button type="button" class="btn btn-danger cms-del-svc" data-idx="'+i+'">Удалить</button>'+
          '</div></div>';
      }).filter(Boolean);
      box.innerHTML=matched.length?matched.join(''):'<p class="sub">Ничего не найдено</p>';
      box.querySelectorAll('.cms-item').forEach(function(item){
        var i=+item.getAttribute('data-idx');
        var row=rows[i]; if(!row) return;
        item.querySelector('b').textContent=(row.querySelector('.pn')&&row.querySelector('.pn').textContent)||'';
        var price=(row.querySelector('.pp')&&row.querySelector('.pp').textContent)||'';
        var tag=(row.querySelector('.ptag')&&row.querySelector('.ptag').textContent)||'';
        item.querySelector('small').textContent=tag+(price?' · '+price:'');
      });
      box.querySelectorAll('.cms-del-svc').forEach(function(btn){
        btn.onclick=function(){
          var i=+btn.getAttribute('data-idx');
          var el=document.querySelectorAll('.price-list .prow')[i];
          if(!el) return;
          var nm=(el.querySelector('.pn')&&el.querySelector('.pn').textContent)||'эту услугу';
          if(!confirm('Удалить услугу «'+nm+'»?')) return;
          el.remove();
          markDirty();
          toast('Услуга удалена. Нажмите «Сохранить на сайт»');
          openServicesPanel();
        };
      });
      box.querySelectorAll('.cms-edit-svc').forEach(function(btn){
        btn.onclick=function(){
          var i=+btn.getAttribute('data-idx');
          var el=document.querySelectorAll('.price-list .prow')[i];
          if(el){ closeModal(); openModal(el); }
        };
      });
    }

    renderList('');
    document.getElementById('cmsSvcSearch').oninput=function(){ renderList(this.value); };

    document.getElementById('cmsCreateService').onclick=function(){
      var name=document.getElementById('cmsNewSvcName').value.trim();
      if(!name){ alert('Введите название услуги'); return; }
      var tag=document.getElementById('cmsNewSvcTag').value.trim()||'Терапия';
      var price=document.getElementById('cmsNewSvcPrice').value.trim()||'0 ₽';
      var cat=document.getElementById('cmsNewSvcCat').value;
      var row=addPriceRow(null, { name:name, tag:tag, price:price, cat:cat });
      if(!row) return;
      markDirty();
      toast('Услуга добавлена. Нажмите «Сохранить на сайт»');
      openServicesPanel();
    };

    modal.classList.add('open');
  }

  function buildBar(){
    var bar=document.createElement('div');
    bar.className='cms-bar';
    bar.innerHTML=
      '<div class="left"><span class="badge">Админ</span><span class="meta">Врачи / Услуги → правки → Сохранить на сайт</span></div>'+
      '<div class="right">'+
        '<button type="button" id="cmsManageDoctors">Врачи</button>'+
        '<button type="button" id="cmsManageServices">Услуги</button>'+
        '<button type="button" class="primary" id="cmsSaveNow">Сохранить на сайт</button>'+
        '<button type="button" id="cmsReset">Сбросить</button>'+
        '<button type="button" id="cmsLogout">Выйти</button>'+
      '</div>';
    document.body.prepend(bar);

    var hint=document.createElement('div');
    hint.className='cms-hint show';
    hint.textContent='Откройте «Врачи» или «Услуги» сверху — там добавление и удаление';
    document.body.appendChild(hint);
    setTimeout(function(){ hint.classList.remove('show'); }, 6000);

    var toastEl=document.createElement('div');
    toastEl.className='cms-toast';
    toastEl.id='cmsToast';
    document.body.appendChild(toastEl);

    document.getElementById('cmsManageDoctors').onclick=function(e){
      e.preventDefault(); e.stopPropagation();
      openDoctorsPanel();
    };
    document.getElementById('cmsManageServices').onclick=function(e){
      e.preventDefault(); e.stopPropagation();
      openServicesPanel();
    };
    document.getElementById('cmsSaveNow').onclick=function(){ persist({openPreview:true}).catch(function(){}); };
    document.getElementById('cmsLogout').onclick=function(){ AmirCMS.logout(); location.href='admin.html'; };
    document.getElementById('cmsReset').onclick=function(){
      if(!confirm('Сбросить все правки на сайте к исходным?')) return;
      content={ v:3, savedAt:new Date().toISOString() };
      AmirCMS.clearContent();
      AmirCMS.publishContent(content).then(function(){ location.reload(); })
        .catch(function(e){ alert(e.message||e); location.reload(); });
    };
  }

  function buildModal(){
    var bg=document.createElement('div');
    bg.className='cms-modal-bg';
    bg.id='cmsModal';
    bg.innerHTML=
      '<div class="cms-modal" role="dialog" aria-modal="true">'+
        '<h3 id="cmsModalTitle">Редактирование</h3>'+
        '<p class="sub">После сохранения изменение сразу на публичном сайте.</p>'+
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

    if(type==='image'){
      title.textContent='Редактировать фото';
      fields.innerHTML=
        '<div class="field"><label>URL изображения</label><input id="cmsSrc" type="text" value="'+escAttr(el.getAttribute('src')||'')+'"></div>'+
        '<div class="field"><label>Или загрузить файл</label><input id="cmsFile" type="file" accept="image/*"></div>'+
        '<div class="field"><label>Alt</label><input id="cmsAlt" type="text" value="'+escAttr(el.getAttribute('alt')||'')+'"></div>'+
        '<img class="preview-img" id="cmsPrev" src="'+escAttr(el.getAttribute('src')||'')+'" alt="">';
      document.getElementById('cmsSrc').oninput=function(){ document.getElementById('cmsPrev').src=this.value; };
      document.getElementById('cmsFile').onchange=function(e){
        var f=e.target.files&&e.target.files[0]; if(!f) return;
        if(f.size>2.5*1024*1024){ alert('Файл слишком большой (макс ~2.5 МБ). Лучше вставьте URL картинки.'); return; }
        var r=new FileReader();
        r.onload=function(){ document.getElementById('cmsSrc').value=r.result; document.getElementById('cmsPrev').src=r.result; };
        r.readAsDataURL(f);
      };
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
        '<div class="field"><label>Категория</label><input id="cmsTag" type="text"></div>'+
        '<div class="field"><label>Цена</label><input id="cmsPrice" type="text"></div>'+
        '<div class="field"><label>Фильтр</label><select id="cmsCat">'+
          opt('ortho','Ортодонтия',el.dataset.cat)+opt('therapy','Терапия',el.dataset.cat)+
          opt('hygiene','Гигиена',el.dataset.cat)+opt('surgery','Хирургия',el.dataset.cat)+
          opt('implant','Имплантация',el.dataset.cat)+opt('prosth','Протезирование',el.dataset.cat)+
          opt('paro','Пародонтология',el.dataset.cat)+opt('kids','Детская',el.dataset.cat)+
        '</select></div>'+
        '<div class="field"><label><input id="cmsAddAfter" type="checkbox"> Добавить ещё услугу ниже</label></div>';
      document.getElementById('cmsName').value=pn?pn.textContent:'';
      document.getElementById('cmsTag').value=pt?pt.textContent:'';
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
        '<div class="field"><label>Или загрузить файл</label><input id="cmsDocFile" type="file" accept="image/*"></div>'+
        '<img class="preview-img" id="cmsDocPrev" src="'+escAttr(img?img.getAttribute('src'):'')+'" alt="">';
      document.getElementById('cmsDocName').value=name?name.textContent:'';
      document.getElementById('cmsDocRole').value=role?role.textContent:'';
      document.getElementById('cmsDocExp').value=exp?exp.textContent:'';
      document.getElementById('cmsDocSrc').oninput=function(){ document.getElementById('cmsDocPrev').src=this.value; };
      document.getElementById('cmsDocFile').onchange=function(e){
        var f=e.target.files&&e.target.files[0]; if(!f) return;
        if(f.size>2.5*1024*1024){ alert('Файл слишком большой (макс ~2.5 МБ). Лучше вставьте URL картинки.'); return; }
        var r=new FileReader();
        r.onload=function(){ document.getElementById('cmsDocSrc').value=r.result; document.getElementById('cmsDocPrev').src=r.result; };
        r.readAsDataURL(f);
      };
    } else if(type==='text'){
      title.textContent='Редактировать текст';
      fields.innerHTML='<div class="field"><label>Текст</label><textarea id="cmsText"></textarea></div>';
      document.getElementById('cmsText').value=el.innerHTML;
    } else {
      title.textContent='Редактировать блок';
      fields.innerHTML=
        '<div class="field"><label>Содержимое</label><textarea id="cmsText"></textarea></div>'+
        '<div class="field"><label><input id="cmsHide" type="checkbox"'+(el.style.display==='none'?' checked':'')+'> Скрыть блок</label></div>';
      document.getElementById('cmsText').value=el.innerHTML;
    }
    document.getElementById('cmsModal').classList.add('open');
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
      el.setAttribute('src', document.getElementById('cmsSrc').value.trim());
      el.setAttribute('alt', document.getElementById('cmsAlt').value.trim());
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
      var tag=document.getElementById('cmsTag').value.trim();
      var price=document.getElementById('cmsPrice').value.trim();
      var cat=document.getElementById('cmsCat').value;
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
        if(dSrc) dImg.setAttribute('src', dSrc);
        dImg.setAttribute('alt', dName);
      }
    } else if(type==='text' || type==='block'){
      el.innerHTML=document.getElementById('cmsText').value;
      if(type==='block') el.style.display=document.getElementById('cmsHide').checked?'none':'';
    }

    closeModal();
    markDirty();
    toast('Изменение применено. Нажмите «Сохранить на сайт»');
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
    var el=e.target.closest('.prow.cms-editable, .doc.cms-editable, .cms-editable');
    if(!el) return;
    e.preventDefault();
    e.stopPropagation();
    openModal(el);
  }

  async function boot(){
    var sess=AmirCMS.getSession();
    if(sess && !sess.token) AmirCMS.logout();

    var params=new URLSearchParams(location.search);
    var previewOnly=params.get('preview')==='1';

    var fileContent=null;
    try{
      var res=await fetch('assets/content.json?ts='+Date.now(),{cache:'no-store'});
      if(res.ok) fileContent=await res.json();
    }catch(e){}

    if(fileContent && (fileContent.v===2 || fileContent.v===3 || fileContent.v===4 || fileContent.priceHtml || fileContent.docsHtml || fileContent.doctors || fileContent.services || fileContent.textItems || fileContent.texts)){
      content=fileContent;
      AmirCMS.saveContent(fileContent);
      applySnapshot(fileContent);
    }

    // Режим пользователя после сохранения из админки — без панели редактора
    if(previewOnly || !AmirCMS.isAuthed()) return;

    document.body.classList.add('cms-admin');
    buildBar();
    buildModal();
    wireTargets();
    document.addEventListener('click', onAdminClick, true);
    var hdr=document.querySelector('.hdr');
    if(hdr) hdr.style.top='58px';
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
