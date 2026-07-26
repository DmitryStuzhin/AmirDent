/* Поэтапная подсветка шагов: когда блок попадает в кадр, шаги загораются по
   очереди, а отрезок до следующего заполняется. Работает и на главной
   («Как мы работаем»), и на страницах услуг.
   Если в системе включено «уменьшить движение» — показываем сразу, без анимации. */
(function(){
  var BLOCKS=[
    { box:'#dirSteps', item:'.dp-step' },
    { box:'.steps-grid', item:'.step' }
  ];

  var calm=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  BLOCKS.forEach(function(cfg){
    var box=document.querySelector(cfg.box);
    if(!box) return;
    var items=box.querySelectorAll(cfg.item);
    if(!items.length) return;

    if(calm||!window.IntersectionObserver){
      box.classList.add('steps-run','steps-done');
      items.forEach(function(i){ i.classList.add('is-on'); });
      return;
    }

    var started=false;
    function run(){
      if(started) return;
      started=true;
      box.classList.add('steps-run');
      items.forEach(function(item,i){
        setTimeout(function(){
          item.classList.add('is-on');
          if(i===items.length-1) box.classList.add('steps-done');
        }, 160+i*260);
      });
    }

    var io=new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        if(!e.isIntersecting) return;
        io.unobserve(e.target);
        run();
      });
    },{threshold:.3});
    io.observe(box);

    // Страховка: в отдельных браузерах и встроенных окнах наблюдатель не присылает
    // событие. Если блок уже виден, а анимация не началась — запускаем сами.
    setTimeout(function(){
      if(started) return;
      var r=box.getBoundingClientRect();
      if(r.top<window.innerHeight&&r.bottom>0) run();
    }, 900);
  });
})();
