/* Поэтапная подсветка шагов приёма: когда блок попадает в кадр, шаги
   загораются по очереди, а линия между ними прочерчивается.
   Если в системе включено «уменьшить движение» — показываем сразу без анимации. */
(function(){
  var steps=document.getElementById('dirSteps');
  if(!steps) return;

  var items=steps.querySelectorAll('.dp-step');
  if(!items.length) return;

  var calm=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(calm||!window.IntersectionObserver){
    steps.classList.add('steps-done');
    return;
  }

  var started=false;
  function run(){
    if(started) return;
    started=true;
    steps.classList.add('steps-run');
    items.forEach(function(item,i){
      setTimeout(function(){
        item.classList.add('is-on');
        if(i===items.length-1) steps.classList.add('steps-done');
      }, 160+i*260);
    });
  }

  var io=new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if(!e.isIntersecting) return;
      io.unobserve(e.target);
      run();
    });
  },{threshold:.35});
  io.observe(steps);

  // Страховка: в отдельных браузерах и встроенных окнах наблюдатель не присылает
  // событие. Если блок уже виден, а анимация не началась — запускаем сами.
  setTimeout(function(){
    if(started) return;
    var r=steps.getBoundingClientRect();
    if(r.top<window.innerHeight&&r.bottom>0) run();
  }, 900);
})();
