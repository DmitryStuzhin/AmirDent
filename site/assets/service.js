/* Страница услуги: /uslugi/<адрес> или service.html?s=<адрес>.
   Описание, врачи и группа берутся из assets/services-data.js, цены — из
   прайс-листа, чтобы не держать их в двух местах. */
(function(){
  var data=window.AMIR_SERVICES;
  function el(id){ return document.getElementById(id); }
  var note=el('dirNote');

  function fail(msg){
    if(note){ note.hidden=false; note.textContent=msg; }
  }
  if(!data){ fail('Не удалось загрузить список услуг.'); return; }

  function slugFromUrl(){
    var q=new URLSearchParams(location.search).get('s');
    if(q) return q;
    return location.pathname.replace(/\/+$/,'').split('/').pop().replace(/\.html$/,'');
  }
  function findService(slug){
    for(var g=0;g<data.groups.length;g++){
      var items=data.groups[g].items;
      for(var i=0;i<items.length;i++){
        if(items[i].slug===slug) return { item:items[i], group:data.groups[g] };
      }
    }
    return null;
  }
  function plural(n){
    var d=n%10, dd=n%100;
    if(d===1&&dd!==11) return 'услуга';
    if(d>=2&&d<=4&&(dd<12||dd>14)) return 'услуги';
    return 'услуг';
  }

  /* ---- папка врачей -------------------------------------------------
     Врачей по услуге обычно несколько, поэтому справа они лежат стопкой:
     из-под верхней карточки выглядывают края остальных, как у папки с
     бумагами, и каждые 6 секунд верхняя уходит вверх, открывая
     следующую. Листание замирает при наведении, при фокусе с клавиатуры
     и на скрытой вкладке; точки под стопкой дают перейти вручную. */
  var DOC_DELAY=6000, DOC_LIFT=920, DOC_PEEK=28, DOC_DEPTH=3;
  var destroyDocStack=null;

  function docPlural(n){
    var d=n%10, dd=n%100;
    if(d===1&&dd!==11) return 'врач';
    if(d>=2&&d<=4&&(dd<12||dd>14)) return 'врача';
    return 'врачей';
  }

  function buildDocStack(docs, ids){
    if(typeof destroyDocStack==='function'){
      try{ destroyDocStack(); }catch(e){}
      destroyDocStack=null;
    }
    var stack=el('dirDocStack'), nav=el('dirDocNav'), count=el('dirDocCount');
    if(!stack) return;
    if(count) count.textContent=docs.length+' '+docPlural(docs.length);

    var cards=docs.map(function(d,i){
      var card=document.createElement('article');
      card.className='dp-doc-card';
      if(ids&&ids[i]){
        card.setAttribute('data-doc', ids[i]);
        card.setAttribute('role','button');
        card.setAttribute('aria-haspopup','dialog');
      }
      card.innerHTML='<div class="dp-doc-photo"></div>'+
        '<div class="dp-doc-text">'+
          '<div class="dp-doc-role"></div>'+
          '<div class="dp-doc-name"></div>'+
          '<p class="dp-doc-exp"></p>'+
          '<a href="#zapis" class="dp-doc-btn">Записаться к врачу</a>'+
        '</div>';
      var img=document.createElement('img');
      img.src=d.photo; img.alt=d.name; img.loading='lazy'; img.decoding='async';
      card.querySelector('.dp-doc-photo').appendChild(img);
      card.querySelector('.dp-doc-role').textContent=d.role;
      card.querySelector('.dp-doc-name').textContent=d.name;
      card.querySelector('.dp-doc-exp').textContent=d.exp||'';
      stack.appendChild(card);
      return card;
    });

    // Карточки лежат абсолютно друг на друге, поэтому высоту стопке задаём
    // по самой высокой из них плюс запас на выглядывающие края.
    // Текст у врачей разной длины, а у стопки края должны идти ровно, поэтому
    // все карточки приводим к высоте самой высокой.
    var sizeRaf=null;
    function sizeStack(){
      var h=0;
      cards.forEach(function(c){ c.style.height=''; });
      cards.forEach(function(c){ if(c.offsetHeight>h) h=c.offsetHeight; });
      if(!h) return;
      cards.forEach(function(c){ c.style.height=h+'px'; });
      stack.style.height=(h+(cards.length>1?DOC_PEEK:0))+'px';
    }
    function sizeSoon(){
      if(sizeRaf) cancelAnimationFrame(sizeRaf);
      sizeRaf=requestAnimationFrame(sizeStack);
    }
    window.addEventListener('resize', sizeSoon);
    if(document.fonts&&document.fonts.ready&&document.fonts.ready.then){
      document.fonts.ready.then(sizeStack);
    }

    if(cards.length<2){
      cards[0].dataset.pos='0';
      stack.classList.add('is-single');
      sizeStack();
      destroyDocStack=function(){
        window.removeEventListener('resize', sizeSoon);
        if(sizeRaf) cancelAnimationFrame(sizeRaf);
      };
      return;
    }

    stack.classList.remove('is-single');
    var index=0, timer=null, lift=null, hover=false, focusInside=false;
    var reduce=window.matchMedia?window.matchMedia('(prefers-reduced-motion: reduce)'):null;
    var wrap=el('dirDoc');

    var dots=docs.map(function(d,i){
      var b=document.createElement('button');
      b.type='button';
      b.className='dp-docs-dot';
      b.setAttribute('aria-label','Показать врача: '+d.name);
      b.addEventListener('click', function(){
        show(i);
        schedule();
      });
      nav.appendChild(b);
      return b;
    });
    nav.hidden=false;

    function apply(){
      cards.forEach(function(card,i){
        var pos=(i-index+cards.length)%cards.length;
        card.dataset.pos = pos>DOC_DEPTH ? 'back' : String(pos);
        card.setAttribute('aria-hidden', pos===0?'false':'true');
        card.tabIndex = pos===0 ? 0 : -1;
        // нижние карточки не должны ловить фокус с клавиатуры
        if('inert' in card) card.inert = pos!==0;
        else card.querySelectorAll('a,button').forEach(function(f){
          if(pos===0) f.removeAttribute('tabindex'); else f.setAttribute('tabindex','-1');
        });
      });
      dots.forEach(function(b,i){
        var on=(i===index);
        b.classList.toggle('is-on', on);
        if(on) b.setAttribute('aria-current','true'); else b.removeAttribute('aria-current');
      });
    }

    function show(next){
      if(next===index||lift) return;
      var leaving=cards[index];
      index=next;
      if(reduce&&reduce.matches){
        apply();
        return;
      }
      leaving.classList.add('is-leaving');
      // следующая карточка сразу поднимается, пока верхняя улетает
      apply();
      lift=setTimeout(function(){
        lift=null;
        leaving.classList.remove('is-leaving');
        // вернуть ушедшую карточку вниз стопки без обратного полёта
        leaving.style.transition='none';
        apply();
        void leaving.offsetWidth;
        leaving.style.transition='';
      }, DOC_LIFT);
    }

    function next(){ show((index+1)%cards.length); }
    function stop(){ if(timer){ clearTimeout(timer); timer=null; } }
    function canPlay(){
      return !hover && !focusInside && !document.hidden &&
        !(document.documentElement&&document.documentElement.classList.contains('dm-lock'));
    }
    function schedule(){
      stop();
      if(!canPlay()) return;
      timer=setTimeout(function(){
        timer=null;
        if(!canPlay()||lift){ schedule(); return; }
        next();
        schedule();
      }, DOC_DELAY);
    }

    function onEnter(){ hover=true; stop(); }
    function onLeave(){ hover=false; schedule(); }
    function onFocusIn(){ focusInside=true; stop(); }
    function onFocusOut(e){
      if(wrap.contains(e.relatedTarget)) return;
      focusInside=false;
      schedule();
    }
    function onVis(){
      if(document.hidden) stop(); else schedule();
    }
    if(wrap){
      wrap.addEventListener('mouseenter', onEnter);
      wrap.addEventListener('mouseleave', onLeave);
      wrap.addEventListener('focusin', onFocusIn);
      wrap.addEventListener('focusout', onFocusOut);
    }
    document.addEventListener('visibilitychange', onVis);
    // пауза, пока открыто окно врача
    var mo=typeof MutationObserver==='function'?new MutationObserver(function(){
      if(document.documentElement.classList.contains('dm-lock')) stop();
      else schedule();
    }):null;
    if(mo) mo.observe(document.documentElement,{attributes:true,attributeFilter:['class']});

    destroyDocStack=function(){
      stop();
      if(lift){ clearTimeout(lift); lift=null; }
      window.removeEventListener('resize', sizeSoon);
      if(sizeRaf) cancelAnimationFrame(sizeRaf);
      document.removeEventListener('visibilitychange', onVis);
      if(wrap){
        wrap.removeEventListener('mouseenter', onEnter);
        wrap.removeEventListener('mouseleave', onLeave);
        wrap.removeEventListener('focusin', onFocusIn);
        wrap.removeEventListener('focusout', onFocusOut);
      }
      if(mo) mo.disconnect();
    };

    apply();
    sizeStack();
    schedule();
  }

  var slug=slugFromUrl();
  var found=findService(slug);
  if(!found){
    fail('Такой услуги нет. Откройте прайс-лист, чтобы выбрать нужную.');
    return;
  }
  var item=found.item, group=found.group;
  var docIds=[];
  var docs=[];

  // ---- текст ----
  document.title=item.title+' — цена и запись · АмирДент';
  var meta=document.querySelector('meta[name="description"]');
  if(meta) meta.setAttribute('content', item.desc);

  el('dirTitle').textContent=item.title;
  el('dirDesc').textContent=item.desc;
  el('dirCrumb').textContent=item.title;
  el('dirGroup').innerHTML='<span class="dot"></span>'+group.title;

  function refreshItemFromData(){
    var again=findService(slug);
    if(!again) return false;
    item=again.item;
    group=again.group;
    return true;
  }

  function renderDoctors(){
    docIds=(item.doctors||[]).filter(function(id){ return data.doctors[id]; });
    docs=docIds.map(function(id){ return data.doctors[id]; });

    var stack=el('dirDocStack'), nav=el('dirDocNav'), team=el('dirTeam');
    if(stack) stack.innerHTML='';
    if(nav) nav.innerHTML='';
    if(team) team.innerHTML='';

    var hero=document.querySelector('.dp-hero');
    if(docs.length){
      buildDocStack(docs, docIds);
      if(el('dirDoc')) el('dirDoc').hidden=false;
      if(el('dirInfo')) el('dirInfo').hidden=true;
      if(hero) hero.classList.remove('dp-hero-info');
    } else {
      if(el('dirDoc')) el('dirDoc').hidden=true;
      if(el('dirInfo')) el('dirInfo').hidden=false;
      if(hero) hero.classList.add('dp-hero-info');
    }

    if(docs.length>1 && team){
      docs.forEach(function(d,i){
        var card=document.createElement('article');
        card.className='dp-team-card';
        if(docIds[i]){
          card.setAttribute('data-doc', docIds[i]);
          card.setAttribute('role','button');
          card.setAttribute('aria-haspopup','dialog');
          card.tabIndex=0;
        }
        card.innerHTML='<div class="dp-team-photo"><img src="'+d.photo+'" alt="'+d.name+'"></div>'+
          '<div class="dp-team-role">'+d.role+'</div>'+
          '<h3>'+d.name+'</h3>'+
          '<p>'+(d.exp||'')+'</p>';
        team.appendChild(card);
      });
      if(el('dirTeamWrap')) el('dirTeamWrap').hidden=false;
    } else if(el('dirTeamWrap')){
      el('dirTeamWrap').hidden=true;
    }
  }

  renderDoctors();

  // ---- другие услуги направления ----
  function renderOther(){
    var other=el('dirOther');
    if(!other) return;
    other.innerHTML='';
    group.items.forEach(function(other_item){
      if(other_item.slug===item.slug) return;
      var a=document.createElement('a');
      a.className='dp-other-item';
      a.href='/uslugi/'+other_item.slug;
      a.textContent=other_item.title;
      other.appendChild(a);
    });
  }
  renderOther();

  function signalServiceReady(){
    window.__amirServiceReady=true;
    try{ document.dispatchEvent(new CustomEvent('amir:service-ready')); }catch(e){}
  }

  function money(n){ return n.toLocaleString('ru-RU')+' ₽'; }
  function renderFacts(rows){
    var box=el('dirFacts');
    if(!box) return;
    var facts=[];
    if(rows&&rows.length){
      var prices=Array.prototype.map.call(rows,function(r){
        var t=(r.querySelector('.pp')||{}).textContent||'';
        return parseInt(t.replace(/[^0-9]/g,''),10);
      }).filter(function(n){ return n>0; });
      if(prices.length) facts.push({ id:'price', v:'от '+money(Math.min.apply(null,prices)), k:'стоимость' });
      facts.push({ id:'count', v:String(rows.length), k:'услуг в направлении' });
    }
    if(docs.length>1) facts.push({ id:'doctors', v:String(docs.length), k:'врача по услуге' });
    else facts.push({ id:'hours', v:'09:00–21:00', k:'приём ежедневно' });
    facts.push({ id:'consult', v:'0 ₽', k:'первичный осмотр' });

    box.innerHTML='';
    facts.slice(0,4).forEach(function(f){
      var cell=document.createElement('div');
      cell.className='dp-fact';
      cell.setAttribute('data-fact-id', f.id);
      cell.setAttribute('data-service', slug);
      cell.innerHTML='<b>'+String(f.v).replace(/</g,'&lt;')+'</b><span>'+String(f.k).replace(/</g,'&lt;')+'</span>';
      box.appendChild(cell);
    });
  }

  // ---- цены ----
  function matches(row){
    var subcat=row.getAttribute('data-subcat')||'';
    if(subcat) return subcat===item.slug;
    if(!item.match) return false;
    var name=(row.getAttribute('data-name')||row.textContent||'').toLowerCase();
    if(item.match.cat && (row.getAttribute('data-cat')||'')!==item.match.cat) return false;
    if(!item.match.words) return true;
    for(var i=0;i<item.match.words.length;i++){
      if(name.indexOf(item.match.words[i])>-1) return true;
    }
    return false;
  }

  function rowKey(row){
    return ((row.querySelector&&row.querySelector('.pn')&&row.querySelector('.pn').textContent)||row.getAttribute('data-name')||'').trim().toLowerCase();
  }

  function fillRows(rows){
    var list=el('dirList');
    if(!list) return false;
    var map={};
    Array.prototype.forEach.call(rows, function(r){
      if(!matches(r)) return;
      var key=rowKey(r);
      if(!key) return;
      map[key]=r;
    });
    var picked=Object.keys(map).map(function(k){ return map[k]; });
    if(!picked.length) return false;
    el('dirPrices').hidden=false;
    list.innerHTML='';
    picked.forEach(function(r){
      var row=r.cloneNode(true);
      row.style.display='';
      list.appendChild(row);
    });
    var count=el('dirCount');
    if(count) count.textContent=picked.length+' '+plural(picked.length);
    if(note) note.hidden=true;
    renderFacts(picked);
    setupCollapse(picked.length);
    try{ signalServiceReady(); }catch(e){}
    return true;
  }

  function mergeFill(aRows, bRows){
    var map={};
    function add(rows){
      Array.prototype.forEach.call(rows||[], function(r){
        if(!matches(r)) return;
        var key=rowKey(r);
        if(!key) return;
        map[key]=r;
      });
    }
    add(aRows);
    add(bRows); // b перекрывает a при том же названии
    var keys=Object.keys(map);
    if(!keys.length) return false;
    return fillRows(keys.map(function(k){ return map[k]; }));
  }

  // Список из сорока строк листать бессмысленно: показываем четыре, остальное по кнопке
  var VISIBLE=4;
  function setupCollapse(total){
    var list=el('dirList'), btn=el('dirMore'), fade=el('dirFade');
    if(!list||!btn) return;
    if(total<=VISIBLE){
      list.classList.remove('is-clamped');
      btn.hidden=true;
      if(fade) fade.hidden=true;
      return;
    }
    var open=false;
    function apply(){
      list.classList.toggle('is-clamped', !open);
      if(fade) fade.hidden=open;
      btn.textContent=open
        ? 'Свернуть список'
        : 'Показать все '+total+' '+plural(total);
      btn.setAttribute('aria-expanded', open?'true':'false');
    }
    btn.hidden=false;
    btn.onclick=function(){ open=!open; apply(); };
    apply();
  }

  function servicesHtmlFromList(list){
    return (list||[]).map(function(s){
      var name=s.name||'Услуга';
      var tag=s.tag||'';
      var price=s.price||'';
      function esc(t){ return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'); }
      var attrs=' data-cat="'+esc(s.cat||'therapy')+'" data-name="'+esc(String(name).toLowerCase())+'"';
      if(s.subcat) attrs+=' data-subcat="'+esc(s.subcat)+'"';
      if(s.doctor) attrs+=' data-doctor="'+esc(s.doctor)+'"';
      return '<div class="prow"'+attrs+'>'+
        '<span class="pn">'+esc(name)+'</span>'+
        '<span class="ptag">'+esc(tag)+'</span>'+
        '<span class="pp">'+esc(price)+'</span></div>';
    }).join('');
  }

  var lastPriceRows=null;

  function applySavedPrices(saved){
    if(!lastPriceRows) return false;
    var savedRows=[];
    var savedIsMaster=false;
    if(saved){
      if(Array.isArray(saved.services) && saved.services.length){
        var box=document.createElement('div');
        box.innerHTML=servicesHtmlFromList(saved.services);
        savedRows=box.querySelectorAll('.prow');
        savedIsMaster=true;
      } else if(typeof saved.priceHtml==='string' && saved.priceHtml){
        var box2=document.createElement('div');
        box2.innerHTML=saved.priceHtml;
        savedRows=box2.querySelectorAll('.prow');
        // priceHtml из CMS — полный актуальный прайс
        if(savedRows.length) savedIsMaster=true;
      }
    }
    // content.json важнее prices.html: иначе удалённые услуги возвращаются из статики
    var ok=savedIsMaster ? fillRows(savedRows) : mergeFill(lastPriceRows, savedRows);
    if(!ok){
      if(!item.match){
        el('dirPrices').hidden=true;
        renderFacts(null);
        signalServiceReady();
      } else {
        fail('Цены по этой услуге назовёт администратор — оставьте заявку или позвоните.');
      }
    }
    return ok;
  }

  function onCmsContentReady(ev){
    refreshItemFromData();
    renderDoctors();
    renderOther();
    if(ev && ev.detail) applySavedPrices(ev.detail);
    if(typeof window.AMIR_applyDocRatings==='function') window.AMIR_applyDocRatings();
  }
  document.addEventListener('amir:cms-content-ready', onCmsContentReady);

  fetch('/prices.html',{cache:'no-cache'})
    .then(function(r){
      if(!r.ok) throw new Error('prices '+r.status);
      return r.text();
    })
    .then(function(html){
      var doc=new DOMParser().parseFromString(html,'text/html');
      lastPriceRows=doc.querySelectorAll('.price-list .prow');
      return fetch('/assets/content.json?ts='+Date.now(),{cache:'no-store'})
        .then(function(r){ return r.ok?r.json():null; })
        .then(function(saved){
          applySavedPrices(saved);
        })
        .catch(function(){
          var ok=fillRows(lastPriceRows);
          if(!ok){
            if(!item.match){
              el('dirPrices').hidden=true;
              renderFacts(null);
              signalServiceReady();
            } else {
              fail('Цены по этой услуге назовёт администратор — оставьте заявку или позвоните.');
            }
          }
        });
    })
    .catch(function(){
      fail('Не удалось загрузить цены. Позвоните нам или оставьте заявку — подскажем стоимость.');
    });

  // На странице услуги добавляем её в список, но по умолчанию
  // оставляем «Выберите направление», пока пользователь не выберет сам.
  var form=document.getElementById('booking');
  if(form&&form.service){
    var opts=Array.prototype.slice.call(form.service.options), has=false;
    for(var i=0;i<opts.length;i++){
      if(opts[i].text===group.title||opts[i].text===item.title){ has=true; break; }
    }
    if(!has){
      var extra=document.createElement('option');
      extra.text=item.title;
      form.service.add(extra);
    }
    form.service.value='';
    form.service.selectedIndex=0;
    if(window.AMIR_formSelects) AMIR_formSelects.refresh(form.service);
  }
})();
