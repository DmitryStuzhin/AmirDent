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
      var delay=window.matchMedia&&window.matchMedia('(max-width: 560px)').matches?150:260;
      items.forEach(function(item,i){
        setTimeout(function(){
          item.classList.add('is-on');
          if(i===items.length-1) box.classList.add('steps-done');
        }, 120+i*delay);
      });
      // Если анимация почему-то не доиграла, доводим блок до конечного вида,
      // чтобы приглушённые этапы не остались приглушёнными навсегда.
      setTimeout(function(){
        box.classList.add('steps-done');
        items.forEach(function(item){ item.classList.add('is-on'); });
      }, 120+items.length*delay+1000);
    }

    // Наблюдатель за прокруткой — лишь ускоритель: в некоторых браузерах он не
    // присылает события, поэтому основной способ — положение блока при прокрутке.
    function check(){
      var r=box.getBoundingClientRect();
      if(r.top<window.innerHeight*0.85&&r.bottom>0){
        run();
        window.removeEventListener('scroll',check);
      }
    }
    check();
    window.addEventListener('scroll',check,{passive:true});
    window.addEventListener('load',check);

    if(window.IntersectionObserver){
      var io=new IntersectionObserver(function(entries){
        entries.forEach(function(e){
          if(!e.isIntersecting) return;
          io.unobserve(e.target);
          run();
        });
      },{threshold:.3});
      io.observe(box);
    }
  });
})();
