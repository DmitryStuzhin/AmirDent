(function(){
  // sticky header shrink
  var hdr=document.querySelector('.hdr');
  window.addEventListener('scroll',function(){
    if(hdr) hdr.classList.toggle('scrolled', window.scrollY>20);
  },{passive:true});

  // mobile menu
  var burger=document.querySelector('.burger'), nav=document.querySelector('.nav');
  if(burger&&nav){burger.addEventListener('click',function(){nav.classList.toggle('open');burger.classList.toggle('active');});
    nav.querySelectorAll('a').forEach(function(a){a.addEventListener('click',function(){nav.classList.remove('open');});});}

  // scroll reveal
  var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target);}});},{threshold:.12});
  document.querySelectorAll('.reveal').forEach(function(el){io.observe(el);});

  // count up
  function animate(el){
    var target=parseFloat(el.dataset.count), dur=1500, start=performance.now();
    function tick(now){var p=Math.min((now-start)/dur,1),e=1-Math.pow(1-p,3),v=target*e;
      el.textContent=(target%1===0?Math.floor(v):v.toFixed(1));if(p<1)requestAnimationFrame(tick);}
    requestAnimationFrame(tick);
  }
  var co=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){animate(e.target);co.unobserve(e.target);}});},{threshold:.5});
  document.querySelectorAll('[data-count]').forEach(function(el){co.observe(el);});

  // before/after
  document.querySelectorAll('[data-ba]').forEach(function(ba){
    function setPos(x){var r=ba.getBoundingClientRect();var p=((x-r.left)/r.width)*100;p=Math.max(3,Math.min(97,p));ba.style.setProperty('--pos',p+'%');}
    var d=false;
    ba.addEventListener('pointerdown',function(e){d=true;setPos(e.clientX);try{ba.setPointerCapture(e.pointerId);}catch(x){}});
    ba.addEventListener('pointermove',function(e){if(d)setPos(e.clientX);});
    window.addEventListener('pointerup',function(){d=false;});
  });

  // hero chevron parallax
  var chev=document.querySelector('.chevrons');
  if(chev){window.addEventListener('scroll',function(){chev.style.transform='translateY('+(window.scrollY*0.06)+'px)';},{passive:true});}

  // price list search + filter
  var psearch=document.getElementById('priceSearch');
  var pfilters=document.querySelectorAll('.pf');
  var prows=document.querySelectorAll('.price-list .prow');
  var pempty=document.getElementById('priceEmpty');
  var curCat='all';
  function applyPrice(){
    var q=(psearch&&psearch.value||'').trim().toLowerCase();
    var shown=0;
    prows.forEach(function(r){
      var okCat=curCat==='all'||r.dataset.cat===curCat;
      var okQ=!q||(r.dataset.name||'').indexOf(q)>-1;
      var vis=okCat&&okQ;
      r.style.display=vis?'':'none';
      if(vis)shown++;
    });
    if(pempty)pempty.hidden=shown>0;
  }
  if(psearch)psearch.addEventListener('input',applyPrice);
  pfilters.forEach(function(btn){btn.addEventListener('click',function(){
    pfilters.forEach(function(b){b.classList.remove('active');});
    btn.classList.add('active');curCat=btn.dataset.cat;applyPrice();
  });});

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

  // booking -> WhatsApp
  var form=document.getElementById('booking');
  if(form){form.addEventListener('submit',function(ev){ev.preventDefault();
    var name=(form.name.value||'').trim(),phone=(form.phone.value||'').trim(),service=form.service?form.service.value:'';
    if(!name||!phone)return;
    var t='Здравствуйте! Хочу записаться в АмирДент.%0AИмя: '+encodeURIComponent(name)+'%0AТелефон: '+encodeURIComponent(phone);
    if(service)t+='%0AУслуга: '+encodeURIComponent(service);
    window.open('https://wa.me/79262031828?text='+t,'_blank');
    var b=form.querySelector('button[type=submit]');if(b){b.textContent='Заявка отправлена ✓';setTimeout(function(){b.textContent='Записаться на приём';},3000);}
    form.reset();
  });}
})();
