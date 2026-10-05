// SPAでトップへ戻るたびに初期化し、古い監視とアニメーションを片付ける。
window.__mnInitFormGallery=function(){
  if(window.__mnFormGalleryCleanup)window.__mnFormGalleryCleanup();
  var rail=document.getElementById('form-gallery-rail');
  if(!rail)return;
  var root=rail.closest('.fg-gallery'),controls=root.querySelector('.fg-controls');
  var pause=controls.querySelector('.fg-pause'),arrows=controls.querySelectorAll('[data-fg-dir]');
  var originals=Array.prototype.slice.call(rail.children),reduce=window.matchMedia('(prefers-reduced-motion: reduce)');
  var frame=0,lastTime=0,position=null,cycle=0,inView=false,hover=false,focused=false,manual=false,observer,imageObserver;
  // ループの継ぎ目を埋める複製は読み上げ・Tab移動から除外する。
  for(var copy=0;copy<2;copy++)originals.forEach(function(item,index){
    var clone=item.cloneNode(true),link=clone.querySelector('a');
    clone.classList.add('fg-copy');clone.setAttribute('aria-hidden','true');
    link.tabIndex=-1;
    link.addEventListener('mousedown',function(e){e.preventDefault();});
    link.addEventListener('focus',function(){originals[index].querySelector('a').focus();});
    rail.appendChild(clone);
  });
  function measure(){
    var firstCopy=rail.querySelector('.fg-copy');
    cycle=firstCopy?firstCopy.offsetLeft-originals[0].offsetLeft:0;
    position=null;update();
  }
  function canPlay(){return inView&&!manual&&!hover&&!focused&&!reduce.matches&&!document.hidden&&cycle>0;}
  function tick(time){
    frame=0;
    if(!rail.isConnected){cleanup();return;}
    if(!canPlay()){lastTime=0;return;}
    if(position===null)position=rail.scrollLeft%cycle;
    // 画面外・別タブから戻った際に距離が跳ばないよう、経過時間を制限する。
    if(lastTime)position=(position+Math.min(time-lastTime,64)*.022)%cycle;
    lastTime=time;rail.scrollLeft=position;
    frame=requestAnimationFrame(tick);
  }
  function update(){
    pause.textContent=manual?'再生':'一時停止';
    pause.setAttribute('aria-pressed',String(manual));
    pause.setAttribute('aria-label','連絡票の自動スクロールを'+(manual?'再開':'一時停止'));
    arrows.forEach(function(button){
      button.disabled=reduce.matches&&(button.dataset.fgDir==='-1'?rail.scrollLeft<1:rail.scrollLeft>=rail.scrollWidth-rail.clientWidth-1);
    });
    if(canPlay()){if(!frame){lastTime=0;frame=requestAnimationFrame(tick);}}
    else{cancelAnimationFrame(frame);frame=0;lastTime=0;position=null;}
  }
  function stopManually(){manual=true;update();}
  function move(dir){
    stopManually();
    var step=originals[1].offsetLeft-originals[0].offsetLeft;
    var next=rail.scrollLeft+dir*step;
    if(!reduce.matches&&cycle){
      if(next<0){rail.scrollLeft+=cycle;next+=cycle;}
      if(next>=cycle*2){rail.scrollLeft-=cycle;next-=cycle;}
    }
    rail.scrollTo({left:next,behavior:reduce.matches?'auto':'smooth'});
  }
  pause.addEventListener('click',function(){manual=!manual;update();});
  arrows.forEach(function(button){button.addEventListener('click',function(){move(Number(button.dataset.fgDir));});});
  rail.addEventListener('mouseenter',function(){hover=true;update();});
  rail.addEventListener('mouseleave',function(){hover=false;update();});
  rail.addEventListener('focusin',function(){focused=true;update();});
  rail.addEventListener('focusout',function(e){focused=rail.contains(e.relatedTarget);update();});
  rail.addEventListener('pointerdown',stopManually,{passive:true});
  rail.addEventListener('wheel',stopManually,{passive:true});
  rail.addEventListener('keydown',function(e){
    if(e.target!==rail)return;
    if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();move(e.key==='ArrowRight'?1:-1);}
  });
  rail.addEventListener('scroll',function(){if(reduce.matches)update();},{passive:true});
  function visibility(){if(!rail.isConnected){cleanup();return;}update();}
  function cleanup(){
    cancelAnimationFrame(frame);frame=0;
    if(observer)observer.disconnect();
    if(imageObserver)imageObserver.disconnect();
    window.removeEventListener('resize',measure);
    document.removeEventListener('visibilitychange',visibility);
    reduce.removeEventListener('change',measure);
  }
  window.__mnFormGalleryCleanup=cleanup;
  window.addEventListener('resize',measure,{passive:true});
  document.addEventListener('visibilitychange',visibility);
  reduce.addEventListener('change',measure);
  controls.hidden=false;
  measure();
  // 見本レールが画面に入ったときに読み込み、タイトルとイラストの表示を優先する。
  function loadImages(){
    rail.querySelectorAll('img[data-src]').forEach(function(img){img.src=img.dataset.src;delete img.dataset.src;});
    if(imageObserver)imageObserver.disconnect();
  }
  if('IntersectionObserver' in window){
    imageObserver=new IntersectionObserver(function(entries){if(entries[0].isIntersecting)loadImages();},{rootMargin:'0px 0px',threshold:0});
    imageObserver.observe(rail);
  }else loadImages();
  if('IntersectionObserver' in window){
    observer=new IntersectionObserver(function(entries){
      if(!rail.isConnected){cleanup();return;}
      inView=entries[0].isIntersecting;update();
    },{threshold:.05});observer.observe(rail);
  }else{inView=true;update();}
};
