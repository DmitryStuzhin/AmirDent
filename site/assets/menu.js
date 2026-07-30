/* Меню «Услуги» в шапке: колонки направлений со списком услуг.
   Собирается из assets/services-data.js, поэтому один и тот же список
   на всех страницах сайта. */
(function(){
  var data=window.AMIR_SERVICES;
  if(!data) return;
  var menu=document.querySelector('.nav-menu');

  function buildColumns(colClass, itemClass){
    var box=document.createDocumentFragment();
    data.groups.forEach(function(group){
      var col=document.createElement('div');
      col.className=colClass;
      var h=document.createElement('h4');
      h.textContent=group.title;
      col.appendChild(h);
      group.items.forEach(function(item){
        var a=document.createElement('a');
        a.href='/uslugi/'+item.slug+'/';
        a.textContent=item.title;
        if(itemClass) a.className=itemClass;
        col.appendChild(a);
      });
      box.appendChild(col);
    });
    return box;
  }

  function rebuild(){
    if(menu){
      var mega=document.createElement('div');
      mega.className='nav-mega';
      mega.appendChild(buildColumns('nav-col'));

      var all=document.createElement('a');
      all.className='nav-mega-all';
      all.href='/prices';
      all.textContent='Полный прайс-лист со всеми ценами';

      menu.innerHTML='';
      menu.appendChild(mega);
      menu.appendChild(all);
    }

    var groupsBox=document.getElementById('servicesGroups');
    if(groupsBox){
      groupsBox.innerHTML='';
      groupsBox.appendChild(buildColumns('sgroup','sgroup-item'));
    }
  }

  rebuild();

  // На телефоне меню раскрыто внутри бургера, поэтому по ссылке его надо закрыть
  var nav=document.querySelector('.nav');
  var burger=document.querySelector('.burger');
  if(menu) menu.addEventListener('click',function(e){
    if(e.target.tagName!=='A') return;
    if(nav) nav.classList.remove('open');
    if(burger) burger.classList.remove('active');
  });

  window.AMIR_rebuildServiceMenus=rebuild;
})();
