(function(){
  // адрес, по которому принимаются заявки (см. netlify/functions/lead.mjs)
  var LEAD_ENDPOINT='/api/lead';

  /* Кастомный select: системный список на macOS/iOS нельзя стилизовать. */
  function enhanceFormSelect(sel){
    if(!sel||!sel.classList.contains('form-select')) return;
    var wrap=sel.closest('.select-wrap');
    if(!wrap) return;
    if(wrap._csel){ wrap._csel.rebuild(); return; }

    sel.classList.add('csel-native');
    sel.setAttribute('tabindex','-1');
    sel.setAttribute('aria-hidden','true');
    wrap.classList.add('is-custom');

    var btn=document.createElement('button');
    btn.type='button';
    btn.className='csel-btn';
    btn.setAttribute('role','combobox');
    btn.setAttribute('aria-haspopup','listbox');
    btn.setAttribute('aria-expanded','false');
    var sourceLabel=sel.id?document.querySelector('label[for="'+sel.id+'"]'):null;
    btn.setAttribute('aria-label',sourceLabel?sourceLabel.textContent.trim():'Услуга');
    btn.innerHTML='<span class="csel-label"></span><span class="csel-chev" aria-hidden="true"></span>';
    var label=btn.querySelector('.csel-label');

    var panel=document.createElement('ul');
    panel.className='csel-panel';
    panel.setAttribute('role','listbox');
    panel.id='csel-'+Math.random().toString(36).slice(2,9);
    btn.setAttribute('aria-controls',panel.id);

    wrap.appendChild(btn);
    wrap.appendChild(panel);

    var open=false, active=-1;

    function selectedOpt(){
      return sel.options[sel.selectedIndex]||null;
    }
    function syncBtn(){
      var o=selectedOpt();
      var empty=!o||o.value==='';
      label.textContent=(o&&o.text)?o.text:'Выберите направление';
      btn.classList.toggle('is-placeholder',empty);
      btn.classList.toggle('is-invalid',sel.classList.contains('is-invalid'));
    }
    function rebuild(){
      panel.innerHTML='';
      Array.prototype.forEach.call(sel.options,function(o,i){
        var li=document.createElement('li');
        li.className='csel-opt';
        li.setAttribute('role','option');
        li.id=panel.id+'-option-'+i;
        li.dataset.index=String(i);
        li.textContent=o.text;
        if(o.value==='') li.classList.add('is-placeholder');
        if(o.disabled) li.setAttribute('aria-disabled','true');
        if(i===sel.selectedIndex){
          li.classList.add('is-selected');
          li.setAttribute('aria-selected','true');
        }
        li.addEventListener('click',function(e){
          e.preventDefault();
          if(o.disabled) return;
          sel.selectedIndex=i;
          sel.dispatchEvent(new Event('change',{bubbles:true}));
          syncBtn();
          paintSelected();
          close();
          btn.focus();
        });
        panel.appendChild(li);
      });
      syncBtn();
    }
    function paintSelected(){
      var items=panel.querySelectorAll('.csel-opt');
      items.forEach(function(li,i){
        var on=i===sel.selectedIndex;
        li.classList.toggle('is-selected',on);
        if(on) li.setAttribute('aria-selected','true'); else li.removeAttribute('aria-selected');
        li.classList.toggle('is-active',i===active);
      });
    }
    function placePanel(){
      // Всегда открываем вниз; если снизу мало места — чуть уменьшаем высоту.
      wrap.classList.remove('is-up');
      var rect=btn.getBoundingClientRect();
      var spaceBelow=Math.max(120, window.innerHeight-rect.bottom-16);
      panel.style.maxHeight=Math.min(280, spaceBelow, window.innerHeight*0.46)+'px';
      // В модалке CMS overflow:auto обрезает absolute-панель — фиксируем к viewport.
      if(wrap.closest('.cms-modal-bg')){
        panel.style.position='fixed';
        panel.style.left=rect.left+'px';
        panel.style.width=rect.width+'px';
        panel.style.right='auto';
        panel.style.top=(rect.bottom+8)+'px';
        panel.style.zIndex='10050';
      } else {
        panel.style.position='';
        panel.style.left='';
        panel.style.width='';
        panel.style.right='';
        panel.style.top='';
        panel.style.zIndex='';
      }
    }
    function onScrollClose(){ if(open) close(); }
    function setOpen(v){
      open=!!v;
      if(open) placePanel();
      else {
        panel.style.maxHeight='';
        panel.style.position='';
        panel.style.left='';
        panel.style.width='';
        panel.style.right='';
        panel.style.top='';
        panel.style.zIndex='';
      }
      wrap.classList.toggle('is-open',open);
      btn.setAttribute('aria-expanded',open?'true':'false');
      var modalScroll=wrap.closest('.cms-modal');
      if(modalScroll){
        if(open) modalScroll.addEventListener('scroll',onScrollClose,{passive:true});
        else modalScroll.removeEventListener('scroll',onScrollClose);
      }
      if(open){
        active=sel.selectedIndex>=0?sel.selectedIndex:0;
        paintSelected();
        var cur=panel.querySelector('.csel-opt.is-selected');
        if(cur&&cur.scrollIntoView) cur.scrollIntoView({block:'nearest'});
        if(panel.children[active]) btn.setAttribute('aria-activedescendant',panel.children[active].id);
      }else{
        btn.removeAttribute('aria-activedescendant');
      }
    }
    function close(){ setOpen(false); }
    function toggle(){ setOpen(!open); }

    btn.addEventListener('click',function(e){
      e.preventDefault();
      toggle();
    });
    btn.addEventListener('keydown',function(e){
      var max=sel.options.length-1;
      if(e.key==='ArrowDown'||e.key==='ArrowUp'){
        e.preventDefault();
        if(!open){ setOpen(true); return; }
        active=e.key==='ArrowDown'?Math.min(max,active+1):Math.max(0,active-1);
        paintSelected();
        var el=panel.children[active];
        if(el) btn.setAttribute('aria-activedescendant',el.id);
        if(el&&el.scrollIntoView) el.scrollIntoView({block:'nearest'});
      } else if(e.key==='Enter'||e.key===' '){
        e.preventDefault();
        if(!open){ setOpen(true); return; }
        if(active>=0&&sel.options[active]&&!sel.options[active].disabled){
          sel.selectedIndex=active;
          sel.dispatchEvent(new Event('change',{bubbles:true}));
          syncBtn();
          paintSelected();
          close();
        }
      } else if(e.key==='Escape'){
        if(open){ e.preventDefault(); close(); }
      } else if(e.key==='Home'&&open){
        e.preventDefault(); active=0; paintSelected();
      } else if(e.key==='End'&&open){
        e.preventDefault(); active=max; paintSelected();
      }
    });

    document.addEventListener('click',function(e){
      if(open&&!wrap.contains(e.target)) close();
    });
    document.addEventListener('keydown',function(e){
      if(e.key==='Escape'&&open) close();
    });

    sel.addEventListener('change',function(){ syncBtn(); paintSelected(); });

    // следим за is-invalid с формы
    var mo=typeof MutationObserver==='function'?new MutationObserver(function(){
      btn.classList.toggle('is-invalid',sel.classList.contains('is-invalid'));
    }):null;
    if(mo) mo.observe(sel,{attributes:true,attributeFilter:['class']});

    wrap._csel={rebuild:rebuild,sync:syncBtn,close:close};
    rebuild();
  }

  function enhanceAllFormSelects(){
    document.querySelectorAll('.form select.form-select, .cms-modal select.form-select').forEach(enhanceFormSelect);
  }
  window.AMIR_formSelects={
    refresh:function(sel){
      if(sel) enhanceFormSelect(sel);
      else enhanceAllFormSelects();
    },
    sync:function(sel){
      if(sel&&sel.closest&&sel.closest('.select-wrap')&&sel.closest('.select-wrap')._csel)
        sel.closest('.select-wrap')._csel.sync();
      else enhanceAllFormSelects();
    }
  };
  enhanceAllFormSelects();

  // sticky header shrink
  var hdr=document.querySelector('.hdr');
  window.addEventListener('scroll',function(){
    if(hdr) hdr.classList.toggle('scrolled', window.scrollY>20);
  },{passive:true});

  // Тонкая линия сверху показывает прогресс по длинной странице.
  var scrollProgress=document.getElementById('scrollProgress');
  var hero=document.querySelector('.hero');
  var scrollFxQueued=false;
  function scrollFx(){
    scrollFxQueued=false;
    var max=Math.max(1,document.documentElement.scrollHeight-window.innerHeight);
    if(scrollProgress) scrollProgress.style.width=Math.min(100,window.scrollY/max*100)+'%';
  }
  function queueScrollFx(){
    if(scrollFxQueued)return;
    scrollFxQueued=true;
    requestAnimationFrame(scrollFx);
  }
  window.addEventListener('scroll',queueScrollFx,{passive:true});
  window.addEventListener('resize',queueScrollFx);
  scrollFx();

  // mobile menu
  var burger=document.querySelector('.burger'), nav=document.querySelector('.nav');
  if(burger&&nav){
    var menuWasOpen=false;
    var pageBehindMenu=Array.prototype.slice.call(document.body.children).filter(function(el){
      return el!==document.querySelector('.hdr')&&el.tagName!=='SCRIPT';
    });
    function setMobileMenu(open,restoreFocus){
      nav.classList.toggle('open',open);
      burger.classList.toggle('active',open);
      burger.setAttribute('aria-expanded',open?'true':'false');
      document.documentElement.classList.toggle('menu-open',open);
      pageBehindMenu.forEach(function(el){
        if('inert' in el) el.inert=open;
        if(open) el.setAttribute('aria-hidden','true');
        else el.removeAttribute('aria-hidden');
        el.querySelectorAll('a,button,input,select,textarea,[tabindex]').forEach(function(control){
          if(open){
            if(!control.hasAttribute('data-menu-tabindex')){
              control.setAttribute('data-menu-tabindex',control.getAttribute('tabindex')||'');
            }
            control.setAttribute('tabindex','-1');
          }else if(control.hasAttribute('data-menu-tabindex')){
            var old=control.getAttribute('data-menu-tabindex');
            if(old)control.setAttribute('tabindex',old);else control.removeAttribute('tabindex');
            control.removeAttribute('data-menu-tabindex');
          }
        });
      });
      if(open){
        menuWasOpen=true;
        var first=nav.querySelector('a,button,[tabindex]:not([tabindex="-1"])');
        if(first)setTimeout(function(){first.focus();},0);
      }else if(menuWasOpen&&restoreFocus!==false){
        menuWasOpen=false;
        burger.focus();
      }
    }
    burger.addEventListener('click',function(){ setMobileMenu(!nav.classList.contains('open')); });
    nav.querySelectorAll('a').forEach(function(a){a.addEventListener('click',function(){setMobileMenu(false,false);});});
    function blockBackgroundScroll(e){
      if(!nav.classList.contains('open'))return;
      if(e.type==='touchmove'&&nav.contains(e.target))return;
      e.preventDefault();
    }
    document.addEventListener('touchmove',blockBackgroundScroll,{passive:false});
    document.addEventListener('wheel',blockBackgroundScroll,{passive:false});
    document.addEventListener('keydown',function(e){
      if(e.key==='Escape'){setMobileMenu(false);return;}
      if(!nav.classList.contains('open'))return;
      if(e.key==='Tab'){
        var focusable=Array.prototype.slice.call(nav.querySelectorAll('a,button,[tabindex]:not([tabindex="-1"])')).filter(function(el){return !el.disabled&&el.offsetParent!==null;});
        if(!focusable.length)return;
        var first=focusable[0],last=focusable[focusable.length-1];
        if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
        else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
      }
    });
    window.addEventListener('resize',function(){if(window.innerWidth>860)setMobileMenu(false,false);});
  }

  // Свет на первом экране следует за курсором очень медленно: это создаёт
  // глубину вокруг врача, но не двигает текст и не мешает чтению.
  var reduceMotion=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(hero&&!reduceMotion&&window.matchMedia('(pointer:fine)').matches){
    hero.addEventListener('pointermove',function(e){
      var r=hero.getBoundingClientRect();
      var x=(e.clientX-r.left)/r.width, y=(e.clientY-r.top)/r.height;
      hero.style.setProperty('--hero-x',(x*100).toFixed(1)+'%');
      hero.style.setProperty('--hero-y',(y*100).toFixed(1)+'%');
      hero.style.setProperty('--hero-px',((x-.5)*18).toFixed(1)+'px');
      hero.style.setProperty('--hero-py',((y-.34)*12).toFixed(1)+'px');
    },{passive:true});
    hero.addEventListener('pointerleave',function(){
      hero.style.setProperty('--hero-x','50%');
      hero.style.setProperty('--hero-y','34%');
      hero.style.setProperty('--hero-px','0px');
      hero.style.setProperty('--hero-py','0px');
    },{passive:true});
  }

  // Появление блоков при прокрутке.
  // Раньше это делал только IntersectionObserver, и если браузер не присылал его
  // события (так бывает с некоторыми расширениями и в корпоративных сборках),
  // весь сайт ниже первого экрана оставался невидимым. Теперь видимость считается
  // по положению блока, а наблюдатель — лишь ускоритель. Плюс страховка: через
  // 2,5 секунды показываем всё, что осталось скрытым.
  var revealItems=Array.prototype.slice.call(document.querySelectorAll('.reveal'));
  // Прячем только сейчас, когда анимацией управляет скрипт
  revealItems.forEach(function(el,index){
    el.classList.add('armed');
    // Соседние карточки появляются волной, а одиночные блоки — без задержки.
    var parent=el.parentElement;
    if(parent&&(parent.classList.contains('why-grid')||parent.classList.contains('doc-grid')||parent.classList.contains('rev-grid'))){
      el.style.setProperty('--reveal-delay',Math.min(index%6,5)*70+'ms');
    }
  });
  function revealShow(el){ el.classList.add('in'); }
  function revealPass(){
    if(!revealItems.length) return;
    var limit=window.innerHeight*0.92;
    revealItems=revealItems.filter(function(el){
      if(el.classList.contains('in')) return false;
      var r=el.getBoundingClientRect();
      if(r.top<limit&&r.bottom>-80){ revealShow(el); return false; }
      return true;
    });
  }
  function revealAll(){
    // Класс armed снимаем, а не просто добавляем in: если переходы CSS почему-то
    // не проигрываются, значение прозрачности должно примениться сразу.
    revealItems.forEach(function(el){ el.classList.remove('armed'); });
    revealItems=[];
    document.querySelectorAll('.reveal.armed:not(.in)').forEach(function(el){
      el.classList.remove('armed');
    });
  }
  var revealQueued=false;
  function revealOnScroll(){
    if(revealQueued) return;
    revealQueued=true;
    requestAnimationFrame(function(){ revealQueued=false; revealPass(); });
  }
  revealPass();
  window.addEventListener('scroll',revealOnScroll,{passive:true});
  window.addEventListener('resize',revealOnScroll);
  window.addEventListener('load',revealPass);
  setTimeout(revealAll,2500);
  if(window.IntersectionObserver){
    var io=new IntersectionObserver(function(es){
      es.forEach(function(e){ if(e.isIntersecting){ revealShow(e.target); io.unobserve(e.target); } });
    },{threshold:.12});
    revealItems.forEach(function(el){ io.observe(el); });
  }

  // Счётчики в блоке статистики: с 1 до целевого значения.
  // Триггер — появление в зоне экрана (скролл + IntersectionObserver),
  // чтобы работало на мобильных, где IO с высоким threshold иногда молчит.
  var countNodes=[];
  var countIO=null;
  function countFormat(v, isInt){
    return isInt ? String(Math.round(v)) : v.toFixed(1);
  }
  function countAnimate(el){
    if(el._countDone || !el.isConnected) return;
    el._countDone=true;
    var target=el._countTarget;
    var isInt=el._countInt;
    if(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches){
      el.textContent=countFormat(target, isInt);
      return;
    }
    var from=1;
    var dur=target>=1000?1800:target>=100?1400:1100;
    var t0=performance.now();
    function tick(now){
      var p=Math.min((now-t0)/dur,1);
      var e=1-Math.pow(1-p,3);
      var v=from+(target-from)*e;
      el.textContent=countFormat(v, isInt);
      if(p<1) requestAnimationFrame(tick);
      else el.textContent=countFormat(target, isInt);
    }
    requestAnimationFrame(tick);
  }
  function countPass(){
    if(!countNodes.length) return;
    var vh=window.innerHeight||0;
    countNodes=countNodes.filter(function(el){
      if(!el.isConnected || el._countDone) return false;
      var r=el.getBoundingClientRect();
      if(r.top<vh*0.92 && r.bottom>0){ countAnimate(el); return false; }
      return true;
    });
  }
  function initCountUps(){
    countNodes=countNodes.filter(function(el){ return el.isConnected && !el._countDone; });
    document.querySelectorAll('[data-count]').forEach(function(el){
      if(el._countBound && el.isConnected) return;
      var raw=String(el.getAttribute('data-count')||'').trim();
      var target=parseFloat(raw);
      if(!isFinite(target) || target<=0) return;
      el._countBound=true;
      el._countDone=false;
      el._countTarget=target;
      /* Целое или дробное решаем по записи в разметке, а не по значению:
         у 5.0 дробная часть нулевая, и по значению рейтинг выводился как
         «5» — рядом с «5.0 на Яндексе» в первом экране это выглядело
         сломанным. Разряд после точки задаёт автор, а не арифметика. */
      el._countInt=raw.indexOf('.')<0;
      el.textContent=el._countInt?'1':'1.0';
      countNodes.push(el);
      if(countIO) countIO.observe(el);
    });
    countPass();
  }
  var countQueued=false;
  function countOnScroll(){
    if(countQueued) return;
    countQueued=true;
    requestAnimationFrame(function(){ countQueued=false; countPass(); });
  }
  if(window.IntersectionObserver){
    countIO=new IntersectionObserver(function(es){
      es.forEach(function(e){
        if(e.isIntersecting){ countAnimate(e.target); countIO.unobserve(e.target); }
      });
    },{threshold:0.15, rootMargin:'0px 0px -8% 0px'});
  }
  initCountUps();
  window.addEventListener('scroll', countOnScroll, {passive:true});
  window.addEventListener('resize', countOnScroll);
  window.addEventListener('load', countPass);
  window.AMIR_initCountUps=initCountUps;

  // Локальный блик на интерактивных карточках. Координаты уходят только в CSS,
  // поэтому эффект не вызывает перерасчёт раскладки страницы.
  if(!reduceMotion&&window.matchMedia('(pointer:fine)').matches){
    document.querySelectorAll('.pcard,.sgroup').forEach(function(card){
      card.addEventListener('pointermove',function(e){
        var r=card.getBoundingClientRect();
        card.style.setProperty('--spot-x',((e.clientX-r.left)/r.width*100).toFixed(1)+'%');
        card.style.setProperty('--spot-y',((e.clientY-r.top)/r.height*100).toFixed(1)+'%');
      },{passive:true});
    });
  }

  // price list search + filter
  var psearch=document.getElementById('priceSearch');
  var pfilters=document.querySelectorAll('.pf');
  var pempty=document.getElementById('priceEmpty');
  var curCat='all';

  function plural(n){
    var d=n%10, dd=n%100;
    if(d===1&&dd!==11) return 'услуга';
    if(d>=2&&d<=4&&(dd<12||dd>14)) return 'услуги';
    return 'услуг';
  }

  /* Категория прайса (data-cat) → колонка сайта из AMIR_SERVICES */
  function priceCatToGroupTitle(cat){
    if(cat==='ortho') return 'Ортодонтия';
    if(cat==='cosmo') return 'Космеология';
    return 'Стоматология';
  }

  function priceCatalog(){
    var data=window.AMIR_SERVICES;
    if(data && Array.isArray(data.groups) && data.groups.length){
      return data.groups.map(function(g){
        return {
          title:g.title,
          items:(g.items||[]).map(function(it){
            return {
              slug:it.slug,
              title:it.title,
              match:it.match||null
            };
          })
        };
      });
    }
    // запасной каталог, если services-data не загрузился
    return [
      { title:'Ортодонтия', items:[{ slug:'ortho-other', title:'Ортодонтия', match:{ cat:'ortho' } }] },
      { title:'Стоматология', items:[
        { slug:'therapy', title:'Терапия', match:{ cat:'therapy' } },
        { slug:'hygiene', title:'Гигиена', match:{ cat:'hygiene' } },
        { slug:'surgery', title:'Хирургия', match:{ cat:'surgery' } },
        { slug:'implant', title:'Имплантация', match:{ cat:'implant' } },
        { slug:'prosth', title:'Протезирование', match:{ cat:'prosth' } },
        { slug:'paro', title:'Пародонтология', match:{ cat:'paro' } },
        { slug:'kids', title:'Детская стоматология', match:{ cat:'kids' } }
      ]},
      { title:'Космеология', items:[{ slug:'cosmo-other', title:'Космеология', match:{ cat:'cosmo' } }] }
    ];
  }

  /* Подбираем подкатегорию: data-subcat → слова из match → запас «Другие». */
  function resolveSubcat(row, catalog){
    var forced=(row.getAttribute('data-subcat')||'').trim();
    var cat=(row.getAttribute('data-cat')||'').trim();
    var name=((row.getAttribute('data-name')||'')+' '+((row.querySelector('.pn')&&row.querySelector('.pn').textContent)||'')).toLowerCase();
    var groupTitle=priceCatToGroupTitle(cat);

    if(forced){
      for(var g=0;g<catalog.length;g++){
        var items=catalog[g].items||[];
        for(var i=0;i<items.length;i++){
          if(items[i].slug===forced){
            return { groupTitle:catalog[g].title, slug:forced, title:items[i].title };
          }
        }
      }
    }

    var best=null, bestScore=0;
    catalog.forEach(function(g){
      (g.items||[]).forEach(function(it){
        var m=it.match;
        if(!m) return;
        if(m.cat && cat && m.cat!==cat) return;
        var words=m.words;
        if(!words || !words.length) return;
        var hit=0, len=0;
        for(var w=0;w<words.length;w++){
          if(name.indexOf(words[w])>-1){
            hit++;
            if(words[w].length>len) len=words[w].length;
          }
        }
        if(!hit) return;
        var score=hit*100+len;
        if(score>bestScore){
          bestScore=score;
          best={ groupTitle:g.title, slug:it.slug, title:it.title };
        }
      });
    });
    if(best) return best;

    // Запас: подкатегория с match.cat без слов (вся «Гигиена» → «Чистка зубов» и т.п.)
    var fallback=null;
    catalog.forEach(function(g){
      (g.items||[]).forEach(function(it){
        var m=it.match;
        if(!m || !m.cat || m.cat!==cat) return;
        if(m.words && m.words.length) return;
        if(!fallback) fallback={ groupTitle:g.title, slug:it.slug, title:it.title };
      });
    });
    if(fallback) return fallback;

    return {
      groupTitle:groupTitle,
      slug:'__other__'+groupTitle,
      title:'Другие услуги'
    };
  }

  // Услуги в разметке идут плоско. Группы и подгруппы собираем из
  // AMIR_SERVICES + data-cat/data-subcat при каждой загрузке и после правок CMS.
  var priceList=document.querySelector('#services .price-list, .price-page .price-list, main .price-list');
  var priceObserver=null;
  function buildGroups(){
    if(!priceList) return;
    if(priceObserver) priceObserver.disconnect();
    priceList.querySelectorAll('.pgroup-h, .psub-h').forEach(function(h){ h.remove(); });

    var rows=Array.prototype.slice.call(priceList.querySelectorAll('.prow'));
    var catalog=priceCatalog();
    var frag=document.createDocumentFragment();

    // groupTitle → { order, subs: slug → { title, rows:[] } }
    var tree={};
    var groupOrder=[];
    catalog.forEach(function(g){
      groupOrder.push(g.title);
      tree[g.title]={ subs:{}, subOrder:[] };
      (g.items||[]).forEach(function(it){
        tree[g.title].subOrder.push(it.slug);
        tree[g.title].subs[it.slug]={ title:it.title, rows:[] };
      });
      tree[g.title].subOrder.push('__other__'+g.title);
      tree[g.title].subs['__other__'+g.title]={ title:'Другие услуги', rows:[] };
    });

    rows.forEach(function(r){
      var place=resolveSubcat(r, catalog);
      if(!tree[place.groupTitle]){
        groupOrder.push(place.groupTitle);
        tree[place.groupTitle]={ subs:{}, subOrder:[] };
      }
      var g=tree[place.groupTitle];
      if(!g.subs[place.slug]){
        g.subOrder.push(place.slug);
        g.subs[place.slug]={ title:place.title, rows:[] };
      }
      if(place.slug && place.slug.indexOf('__other__')!==0){
        r.setAttribute('data-subcat', place.slug);
      }
      r.setAttribute('data-group', place.groupTitle);
      g.subs[place.slug].rows.push(r);
    });

    groupOrder.forEach(function(gTitle){
      var g=tree[gTitle];
      if(!g) return;
      var allRows=[];
      g.subOrder.forEach(function(slug){
        var sub=g.subs[slug];
        if(sub && sub.rows.length) allRows=allRows.concat(sub.rows);
      });
      // подкатегории, добавленные на лету
      Object.keys(g.subs).forEach(function(slug){
        if(g.subOrder.indexOf(slug)<0 && g.subs[slug].rows.length){
          allRows=allRows.concat(g.subs[slug].rows);
          g.subOrder.push(slug);
        }
      });
      if(!allRows.length) return;

      var gh=document.createElement('div');
      gh.className='pgroup-h';
      gh.setAttribute('data-group-h', gTitle);
      gh.innerHTML='<h3>'+gTitle+'</h3><span class="pgroup-n">'+allRows.length+' '+plural(allRows.length)+'</span>';
      frag.appendChild(gh);

      g.subOrder.forEach(function(slug){
        var sub=g.subs[slug];
        if(!sub || !sub.rows.length) return;
        // «Другие» не показываем отдельным заголовком, если это единственная подгруппа
        var filled=g.subOrder.filter(function(s){ return g.subs[s]&&g.subs[s].rows.length; });
        var onlyOther=filled.length===1 && slug.indexOf('__other__')===0;
        if(!onlyOther){
          var sh=document.createElement('div');
          sh.className='psub-h';
          sh.setAttribute('data-sub-h', slug);
          sh.setAttribute('data-group-h', gTitle);
          var link=slug.indexOf('__other__')===0?'':('/uslugi/'+slug);
          sh.innerHTML=link
            ? '<a class="psub-title" href="'+link+'">'+sub.title+'</a><span class="psub-n">'+sub.rows.length+' '+plural(sub.rows.length)+'</span>'
            : '<span class="psub-title">'+sub.title+'</span><span class="psub-n">'+sub.rows.length+' '+plural(sub.rows.length)+'</span>';
          frag.appendChild(sh);
        }
        sub.rows.forEach(function(r){ frag.appendChild(r); });
      });
    });

    priceList.appendChild(frag);
    if(priceObserver){
      priceObserver.takeRecords();
      priceObserver.observe(priceList, {childList:true});
    }
  }

  // Админка перерисовывает список услуг целиком — тогда группы собираем заново
  if(priceList && window.MutationObserver){
    priceObserver=new MutationObserver(function(){
      buildGroups();
      applyPrice();
    });
    priceObserver.observe(priceList, {childList:true});
  }
  buildGroups();
  // CMS подставляет прайс после boot — пересоберём иерархию
  document.addEventListener('amir:cms-content-ready', function(){
    buildGroups();
    applyPrice();
  });

  function filterMatchesCat(rowCat, filter){
    if(filter==='all') return true;
    if(filter==='ortho') return rowCat==='ortho';
    if(filter==='cosmo') return rowCat==='cosmo';
    if(filter==='stoma'){
      return rowCat!=='ortho' && rowCat!=='cosmo';
    }
    return rowCat===filter;
  }

  function applyPrice(){
    if(!priceList) return;
    var q=(psearch&&psearch.value||'').trim().toLowerCase();
    var prows=priceList.querySelectorAll('.prow');
    var shown=0;
    var perGroup={}, perSub={};

    prows.forEach(function(r){
      var cat=r.getAttribute('data-cat')||'';
      var group=r.getAttribute('data-group')||priceCatToGroupTitle(cat);
      var sub=r.getAttribute('data-subcat')||('__other__'+group);
      var okCat=filterMatchesCat(cat, curCat);
      var okQ=!q||(r.getAttribute('data-name')||'').indexOf(q)>-1||((r.querySelector('.pn')&&r.querySelector('.pn').textContent)||'').toLowerCase().indexOf(q)>-1;
      var vis=okCat&&okQ;
      r.style.display=vis?'':'none';
      if(vis){
        shown++;
        perGroup[group]=(perGroup[group]||0)+1;
        perSub[group+'::'+sub]=(perSub[group+'::'+sub]||0)+1;
      }
    });

    priceList.querySelectorAll('.pgroup-h').forEach(function(h){
      var g=h.getAttribute('data-group-h')||'';
      var n=perGroup[g]||0;
      h.style.display=n?'':'none';
      var badge=h.querySelector('.pgroup-n');
      if(badge) badge.textContent=n+' '+plural(n);
    });
    priceList.querySelectorAll('.psub-h').forEach(function(h){
      var g=h.getAttribute('data-group-h')||'';
      var s=h.getAttribute('data-sub-h')||'';
      var n=perSub[g+'::'+s]||0;
      h.style.display=n?'':'none';
      var badge=h.querySelector('.psub-n');
      if(badge) badge.textContent=n+' '+plural(n);
    });
    if(pempty) pempty.hidden=shown>0;
  }
  // Названия в прайсе и на страницах услуг отличаются («Система Invisalign» против
  // «Элайнеры»), поэтому по запросу подсказываем подходящие страницы услуг.
  var suggestBox=document.getElementById('priceSuggest');
  function suggest(q){
    if(!suggestBox) return;
    var items=suggestBox.querySelector('.price-suggest-items');
    items.innerHTML='';
    var data=window.AMIR_SERVICES;
    if(!data||q.length<3){ suggestBox.hidden=true; return; }
    var found=[];
    data.groups.forEach(function(g){
      g.items.forEach(function(it){
        var hay=(it.title+' '+g.title+' '+(it.desc||'')).toLowerCase();
        if(hay.indexOf(q)>-1) found.push(it);
      });
    });
    found.slice(0,6).forEach(function(it){
      var a=document.createElement('a');
      a.href='/uslugi/'+it.slug;
      a.className='price-suggest-item';
      a.textContent=it.title;
      items.appendChild(a);
    });
    suggestBox.hidden=!found.length;
  }

  var pclear=document.querySelector('.price-search-clear');
  if(psearch){
    psearch.addEventListener('input',function(){
      var q=psearch.value.trim();
      // Ищем по всему прайсу: иначе запрос «брекеты» при выбранной «Гигиене»
      // не находил бы ничего, хотя услуга в списке есть.
      if(q && curCat!=='all'){
        pfilters.forEach(function(b){ b.classList.toggle('active', b.dataset.cat==='all'); });
        curCat='all';
      }
      if(pclear) pclear.hidden=!q;
      suggest(q.toLowerCase());
      applyPrice();
    });
  }
  if(pclear){
    pclear.addEventListener('click',function(){
      psearch.value='';
      pclear.hidden=true;
      suggest('');
      psearch.focus();
      applyPrice();
    });
  }
  function selectCat(cat){
    pfilters.forEach(function(b){ b.classList.toggle('active', b.dataset.cat===cat); });
    curCat=cat;
    applyPrice();
  }
  pfilters.forEach(function(btn){btn.addEventListener('click',function(){
    selectCat(btn.dataset.cat);
  });});
  applyPrice();

  // video reels lightbox
  var lb=document.getElementById('lb'), lbInner=document.getElementById('lbInner');
  function embed(url){
    if(!url) return '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#fff;text-align:center;padding:26px;font-family:sans-serif;font-size:15px;line-height:1.5">Здесь будет видео.<br><span style="opacity:.7;font-size:13px">Добавьте ссылку в атрибут data-video (VK Видео, Rutube, YouTube) или файл .mp4</span></div>';
    var y=url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([\w-]+)/);
    if(y) return '<iframe src="https://www.youtube.com/embed/'+y[1]+'?autoplay=1" allow="autoplay; fullscreen" allowfullscreen></iframe>';
    if(/\.mp4($|\?)/i.test(url)) return '<video src="'+url+'" controls autoplay playsinline></video>';
    return '<iframe src="'+url+'" allow="autoplay; fullscreen" allowfullscreen></iframe>';
  }
  function openLb(url){ if(!lb)return; lbInner.innerHTML=embed(url); lb.classList.add('open'); document.body.style.overflow='hidden'; }
  function closeLb(){ if(!lb)return; lb.classList.remove('open'); lbInner.innerHTML=''; document.body.style.overflow=''; }
  document.querySelectorAll('.reel').forEach(function(r){ r.addEventListener('click',function(){ openLb(r.getAttribute('data-video')); }); });
  if(lb){ lb.addEventListener('click',function(e){ if(e.target===lb||e.target.classList.contains('lb-close')) closeLb(); });
    document.addEventListener('keydown',function(e){ if(e.key==='Escape') closeLb(); }); }

  /* Клик по строке прайса → форма «Записаться онлайн» с этой услугой. */
  function selectBookingService(serviceName){
    var bookForm=document.getElementById('booking');
    if(!bookForm||!bookForm.service) return false;
    var name=String(serviceName||'').trim();
    if(!name) return false;
    var sel=bookForm.service;
    var found=false;
    for(var i=0;i<sel.options.length;i++){
      if((sel.options[i].text||'')===name || (sel.options[i].value||'')===name){
        sel.selectedIndex=i;
        found=true;
        break;
      }
    }
    if(!found){
      var opt=document.createElement('option');
      opt.value=name;
      opt.textContent=name;
      sel.appendChild(opt);
      sel.value=name;
    }
    if(window.AMIR_formSelects) AMIR_formSelects.refresh(sel);
    var zapis=document.getElementById('zapis');
    if(zapis){
      if(location.hash!=='#zapis') location.hash='zapis';
      zapis.scrollIntoView({ behavior:'smooth', block:'start' });
    }
    setTimeout(function(){
      if(bookForm.name) bookForm.name.focus();
    }, 350);
    return true;
  }
  window.AMIR_selectBookingService=selectBookingService;

  document.addEventListener('click', function(e){
    // В режиме правки клик по цене открывает CMS, не запись
    if(document.body.classList.contains('cms-admin')) return;
    var row=e.target&&e.target.closest
      ? e.target.closest('.price-list .prow, #dirList .prow, .dp-list .prow')
      : null;
    if(!row) return;
    var pn=row.querySelector('.pn');
    var name=pn?(pn.textContent||'').trim():'';
    if(!name) return;
    e.preventDefault();
    selectBookingService(name);
  });

  // booking -> Telegram (через api/lead.php)
  var form=document.getElementById('booking');
  if(form){
    var btn=form.querySelector('button[type=submit]');
    var note=document.getElementById('bookingNote');
    var phoneField=form.phone;

    function phoneDigits(v){
      var d=(v||'').replace(/\D/g,'');
      if(d.charAt(0)==='7'||d.charAt(0)==='8')d=d.slice(1);
      return d.slice(0,10);
    }
    function phoneFormat(v){
      var d=phoneDigits(v),out='+7';
      if(d.length)out+=' ('+d.slice(0,3);
      if(d.length>3)out+=') '+d.slice(3,6);
      if(d.length>6)out+='-'+d.slice(6,8);
      if(d.length>8)out+='-'+d.slice(8,10);
      return out;
    }
    if(phoneField){
      phoneField.value='+7 ';
      phoneField.addEventListener('input',function(){
        phoneField.value=phoneDigits(phoneField.value)?phoneFormat(phoneField.value):'+7 ';
      });
      phoneField.addEventListener('focus',function(){
        if(!phoneDigits(phoneField.value))phoneField.value='+7 ';
      });
    }
    function whatsappLink(name,phone,service){
      var t='Здравствуйте! Хочу записаться в АмирДент.%0AИмя: '+encodeURIComponent(name)+'%0AТелефон: '+encodeURIComponent(phone);
      if(service)t+='%0AУслуга: '+encodeURIComponent(service);
      return 'https://wa.me/79262031828?text='+t;
    }
    function say(msg,bad){
      if(!note)return;
      note.textContent=msg||'';
      note.classList.toggle('err',!!bad);
    }
    function markInvalid(el, on){
      if(!el)return;
      el.classList.toggle('is-invalid',!!on);
    }
    function sayFailed(name,phone,service){
      if(!note)return;
      note.textContent='Не удалось отправить заявку. ';
      var a=document.createElement('a');
      a.href=whatsappLink(name,phone,service);a.target='_blank';a.rel='noopener';
      a.textContent='Напишите нам в WhatsApp';
      note.appendChild(a);
      note.appendChild(document.createTextNode(' или позвоните +7 (926) 203-18-28.'));
      note.classList.add('err');
    }
    form.addEventListener('submit',function(ev){ev.preventDefault();
      var name=(form.name.value||'').trim(),service=form.service?form.service.value:'';
      var digits=phoneDigits(form.phone.value),phone=phoneFormat(form.phone.value);
      markInvalid(form.name,false);
      markInvalid(phoneField,false);
      if(name.length<2){
        say('Укажите имя — как к вам обращаться.',true);
        markInvalid(form.name,true);
        form.name.focus();
        return;
      }
      if(digits.length<10){
        say('Введите телефон полностью: +7 и 10 цифр, например +7 (926) 203-18-28.',true);
        markInvalid(phoneField,true);
        if(phoneField)phoneField.focus();
        return;
      }
      if(!LEAD_ENDPOINT){window.open(whatsappLink(name,phone,service),'_blank');form.reset();if(phoneField)phoneField.value='+7 ';if(window.AMIR_formSelects)AMIR_formSelects.sync(form.service);return;}
      if(btn){btn.disabled=true;btn.textContent='Отправляем…';}
      say('Отправляем заявку…',false);
      fetch(LEAD_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({name:name,phone:phone,service:service,company:form.company?form.company.value:'',page:location.href,consent:true,consentVersion:'2026-07-31-v1'})})
        // «Заявка принята» только если lead.php подтвердил отправку своим {"ok":true}.
        // Сервер без PHP отдаёт lead.php как текстовый файл с кодом 200, и по одному
        // коду ответа заявку можно было счесть отправленной, хотя её никто не получил.
        .then(function(r){return r.text().then(function(body){
          var data=null;
          try{data=JSON.parse(body);}catch(e){}
          if(!r.ok||!data||data.ok!==true)throw new Error('lead_failed '+r.status);
        });})
        .then(function(){
          say('Заявка принята — администратор перезвонит в течение 15 минут.',false);
          if(btn)btn.textContent='Заявка отправлена ✓';
          form.reset();
          if(phoneField)phoneField.value='+7 ';
          if(window.AMIR_formSelects) AMIR_formSelects.sync(form.service);
        })
        .catch(function(){ sayFailed(name,phone,service); })
        .finally(function(){
          if(btn){btn.disabled=false;setTimeout(function(){btn.textContent='Записаться на приём';},4000);}
        });
    });
  }

  // Лента отзывов: клоны + ширина 3-в-ряд + бесконечный скролл
  (function(){
    var root=document.getElementById('revMarquee');
    var track=document.getElementById('revTrack');
    if(!root||!track) return;

    root.classList.remove('reveal','armed','in');
    root.style.opacity='';
    root.style.transform='';

    track.querySelectorAll('.rev-clone').forEach(function(n){ n.parentNode.removeChild(n); });
    var originals=Array.prototype.slice.call(track.children).filter(function(el){
      return el.classList&&el.classList.contains('rev')&&!el.classList.contains('rev-clone');
    });
    if(!originals.length) return;

    originals.forEach(function(card){
      var clone=card.cloneNode(true);
      clone.classList.add('rev-clone');
      clone.setAttribute('aria-hidden','true');
      clone.querySelectorAll('a,button,[tabindex]').forEach(function(el){ el.setAttribute('tabindex','-1'); });
      track.appendChild(clone);
    });

    var gap=20;
    function showCount(){
      var w=window.innerWidth||1200;
      if(w<=640) return 1;
      if(w<=900) return 2;
      return 3;
    }
    function layout(){
      var padL=parseFloat(getComputedStyle(root).paddingLeft)||0;
      var padR=parseFloat(getComputedStyle(root).paddingRight)||0;
      var inner=Math.max(200, root.clientWidth-padL-padR);
      var show=showCount();
      var cardW=Math.floor((inner-(show-1)*gap)/show);
      root.style.setProperty('--rev-gap',gap+'px');
      root.style.setProperty('--rev-w',cardW+'px');
      // ~38px/сек — плавно и заметно
      var setW=originals.length*(cardW+gap);
      var dur=Math.max(28, setW/38);
      track.style.animationDuration=dur+'s';
      track.style.animationPlayState='running';
    }
    layout();
    window.addEventListener('resize',layout);
    // на всякий случай после шрифтов/CMS
    if(document.fonts&&document.fonts.ready) document.fonts.ready.then(layout);
    setTimeout(layout,300);
  })();
})();
