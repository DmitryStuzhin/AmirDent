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

  var slug=slugFromUrl();
  var found=findService(slug);
  if(!found){
    fail('Такой услуги нет. Откройте прайс-лист, чтобы выбрать нужную.');
    return;
  }
  var item=found.item, group=found.group;

  // ---- текст и врачи ----
  document.title=item.title+' — цена и запись · АмирДент';
  var meta=document.querySelector('meta[name="description"]');
  if(meta) meta.setAttribute('content', item.desc);

  el('dirTitle').textContent=item.title;
  el('dirDesc').textContent=item.desc;
  el('dirCrumb').textContent=item.title;
  el('dirGroup').innerHTML='<span class="dot"></span>'+group.title;

  var docs=(item.doctors||[]).map(function(id){ return data.doctors[id]; }).filter(Boolean);
  if(docs.length){
    var main=docs[0];
    el('dirDocImg').src=main.photo;
    el('dirDocImg').alt=main.name;
    el('dirDocRole').textContent=main.role;
    el('dirDocName').textContent=main.name;
    el('dirDocExp').textContent=main.exp||'';
    el('dirDoc').hidden=false;
  } else {
    // Врача по услуге пока нет — вместо пустого места контакты и запись
    el('dirInfo').hidden=false;
    var hero=document.querySelector('.dp-hero');
    if(hero) hero.classList.add('dp-hero-info');
  }
  if(docs.length>1){
    var team=el('dirTeam');
    docs.forEach(function(d){
      var card=document.createElement('article');
      card.className='dp-team-card';
      card.innerHTML='<div class="dp-team-photo"><img src="'+d.photo+'" alt="'+d.name+'"></div>'+
        '<div class="dp-team-role">'+d.role+'</div>'+
        '<h3>'+d.name+'</h3>'+
        '<p>'+(d.exp||'')+'</p>';
      team.appendChild(card);
    });
    el('dirTeamWrap').hidden=false;
  }

  // ---- другие услуги направления ----
  var other=el('dirOther');
  group.items.forEach(function(other_item){
    if(other_item.slug===item.slug) return;
    var a=document.createElement('a');
    a.className='dp-other-item';
    a.href='/uslugi/'+other_item.slug;
    a.textContent=other_item.title;
    other.appendChild(a);
  });

  // ---- цены ----
  if(!item.match){
    // Косметология в прайс-лист пока не заведена — цену называет администратор
    el('dirPrices').hidden=true;
    return;
  }

  function matches(row){
    var name=(row.getAttribute('data-name')||row.textContent||'').toLowerCase();
    if(item.match.cat && (row.getAttribute('data-cat')||'')!==item.match.cat) return false;
    if(!item.match.words) return true;
    for(var i=0;i<item.match.words.length;i++){
      if(name.indexOf(item.match.words[i])>-1) return true;
    }
    return false;
  }

  function fillRows(rows){
    var list=el('dirList');
    if(!list) return false;
    var picked=Array.prototype.filter.call(rows, matches);
    if(!picked.length) return false;
    list.innerHTML='';
    picked.forEach(function(r){
      var row=r.cloneNode(true);
      row.style.display='';
      list.appendChild(row);
    });
    var count=el('dirCount');
    if(count) count.textContent=picked.length+' '+plural(picked.length);
    if(note) note.hidden=true;
    return true;
  }

  fetch('/prices.html',{cache:'no-cache'})
    .then(function(r){
      if(!r.ok) throw new Error('prices '+r.status);
      return r.text();
    })
    .then(function(html){
      var doc=new DOMParser().parseFromString(html,'text/html');
      var ok=fillRows(doc.querySelectorAll('.price-list .prow'));
      if(!ok) fail('Цены по этой услуге назовёт администратор — оставьте заявку или позвоните.');
      // Правки из админки лежат отдельно: если они есть, показываем их
      return fetch('/assets/content.json?ts='+Date.now(),{cache:'no-store'})
        .then(function(r){ return r.ok?r.json():null; })
        .then(function(saved){
          if(!saved||typeof saved.priceHtml!=='string') return;
          var box=document.createElement('div');
          box.innerHTML=saved.priceHtml;
          fillRows(box.querySelectorAll('.prow'));
        })
        .catch(function(){});
    })
    .catch(function(){
      fail('Не удалось загрузить цены. Позвоните нам или оставьте заявку — подскажем стоимость.');
    });

  // заявка с этой страницы уходит с названием услуги
  var form=document.getElementById('booking');
  if(form&&form.service){
    var opts=Array.prototype.slice.call(form.service.options), set=false;
    for(var i=0;i<opts.length;i++){
      if(opts[i].text===group.title){ form.service.value=opts[i].text; set=true; break; }
    }
    if(!set){
      var extra=document.createElement('option');
      extra.text=item.title;
      form.service.add(extra);
      form.service.value=item.title;
    }
  }
})();
