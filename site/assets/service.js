/* Страница направления: /uslugi/<направление> или service.html?dir=<код> */
(function(){
  // Единственное место, где заданы адреса направлений. Названия, описания и врачи
  // не дублируются: они берутся с главной страницы, из карточек направлений.
  var SLUGS={
    'ortodontiya':'ortho',
    'terapiya':'therapy',
    'gigiena':'hygiene',
    'parodontologiya':'paro',
    'hirurgiya':'surgery',
    'implantaciya':'implant',
    'protezirovanie':'prosth',
    'detskaya':'kids'
  };
  function slugOf(cat){
    for(var slug in SLUGS) if(SLUGS[slug]===cat) return slug;
    return '';
  }
  function currentCat(){
    var byQuery=new URLSearchParams(location.search).get('dir');
    if(byQuery) return byQuery;
    var last=location.pathname.replace(/\/+$/,'').split('/').pop().replace(/\.html$/,'');
    return SLUGS[last]||'';
  }
  function plural(n){
    var d=n%10, dd=n%100;
    if(d===1&&dd!==11) return 'услуга';
    if(d>=2&&d<=4&&(dd<12||dd>14)) return 'услуги';
    return 'услуг';
  }
  function el(id){ return document.getElementById(id); }

  var cat=currentCat();
  var note=el('dirNote');

  function fail(msg){
    if(note) note.textContent=msg;
  }

  if(!cat){
    fail('Направление не указано. Откройте каталог услуг на главной странице.');
    return;
  }

  // Каталог и описания живут на главной. Забираем их оттуда, чтобы цены и тексты
  // правились в одном месте, а не копировались на восемь страниц.
  fetch('/index.html', {cache:'no-cache'})
    .then(function(r){
      if(!r.ok) throw new Error('index '+r.status);
      return r.text();
    })
    .then(function(html){
      var doc=new DOMParser().parseFromString(html,'text/html');
      var card=doc.querySelector('.dir[data-dir="'+cat+'"]');
      if(!card) throw new Error('нет такого направления');
      render(card, doc);
      // Правки из админки хранятся отдельно — если они есть, цены берём из них
      return fetch('/assets/content.json?ts='+Date.now(),{cache:'no-store'})
        .then(function(r){ return r.ok?r.json():null; })
        .then(function(saved){
          if(!saved||typeof saved.priceHtml!=='string') return;
          var box=document.createElement('div');
          box.innerHTML=saved.priceHtml;
          var rows=box.querySelectorAll('.prow[data-cat="'+cat+'"]');
          if(rows.length) fillRows(rows);
        })
        .catch(function(){});
    })
    .catch(function(){
      fail('Не удалось загрузить услуги направления. Откройте каталог на главной странице.');
    });

  function fillRows(rows){
    var list=el('dirList');
    if(!list) return;
    list.innerHTML='';
    Array.prototype.forEach.call(rows,function(r){
      var row=r.cloneNode(true);
      row.style.display='';
      list.appendChild(row);
    });
    var count=el('dirCount');
    if(count) count.textContent=rows.length+' '+plural(rows.length);
    if(note) note.hidden=true;
  }

  function render(card, doc){
    var name=card.querySelector('.dir-name').textContent.trim();
    var desc=card.querySelector('.dir-desc').textContent.trim();

    document.title=name+' — цены и запись · АмирДент';
    var meta=document.querySelector('meta[name="description"]');
    if(meta) meta.setAttribute('content', desc);

    el('dirTitle').textContent=name;
    el('dirDesc').textContent=desc;
    el('dirCrumb').textContent=name;

    var docName=card.getAttribute('data-doc-name');
    if(docName){
      var box=el('dirDoc');
      el('dirDocName').textContent=docName;
      el('dirDocRole').textContent=card.getAttribute('data-doc-role')||'';
      var img=box.querySelector('img');
      img.src=card.getAttribute('data-doc-photo')||'';
      img.alt=docName;
      box.hidden=false;
    }

    fillRows(doc.querySelectorAll('.price-list .prow[data-cat="'+cat+'"]'));

    // Заявка с этой страницы должна уходить с нужным направлением
    var form=document.getElementById('booking');
    if(form&&form.service){
      var opts=Array.prototype.slice.call(form.service.options);
      for(var i=0;i<opts.length;i++){
        if(opts[i].text===name){ form.service.value=opts[i].text; break; }
      }
    }

    // Остальные направления — ссылками, чтобы не возвращаться на главную
    var other=el('dirOther');
    if(other){
      Array.prototype.forEach.call(doc.querySelectorAll('.dir'),function(c){
        var otherCat=c.getAttribute('data-dir');
        if(otherCat===cat) return;
        var a=document.createElement('a');
        a.className='dp-other-item';
        a.href='/uslugi/'+slugOf(otherCat);
        a.textContent=c.querySelector('.dir-name').textContent.trim();
        other.appendChild(a);
      });
    }
  }
})();
