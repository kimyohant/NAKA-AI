'use strict';
(() => {
  const journey = document.getElementById('journey');
  const chapters = [...document.querySelectorAll('.chapter')];
  const links = [...document.querySelectorAll('.chapter-nav a')];
  const frame = document.getElementById('world-frame');
  const status = document.getElementById('world-status');
  const load = document.getElementById('load-world');
  const pause = document.getElementById('pause-world');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  window.nakaSceneState = {chapter:0, pointer:0, paused:reduced.matches};
  let scheduled = false, timeout, loading = false;
  function update() {
    scheduled = false;
    const rect = journey.getBoundingClientRect();
    const center = innerHeight * .5;
    let index = 0;
    chapters.forEach((chapter, i) => { if (chapter.getBoundingClientRect().top <= center) index = i; });
    journey.dataset.chapter = String(index);
    window.nakaSceneState.chapter = index;
    document.body.classList.toggle('story-ended', rect.bottom < innerHeight * .3);
    links.forEach((link, i) => i === index ? link.setAttribute('aria-current','step') : link.removeAttribute('aria-current'));
  }
  function schedule(){ if (!scheduled){scheduled=true;requestAnimationFrame(update);} }
  addEventListener('scroll',schedule,{passive:true});addEventListener('resize',schedule);update();
  addEventListener('pointermove',event => {
    if(event.pointerType==='mouse' && !window.nakaSceneState.paused) window.nakaSceneState.pointer=(event.clientX/innerWidth-.5)*2;
  },{passive:true});
  function failure(){
    clearTimeout(timeout);loading=false;frame.hidden=true;frame.removeAttribute('src');
    document.body.classList.remove('world-ready');load.hidden=false;load.disabled=false;load.textContent='ลองเปิด 3D อีกครั้ง';pause.hidden=true;
    status.textContent='ใช้ภาพฉากแทน 3D ขณะนี้';if(document.body.classList.contains('three-ready'))pause.hidden=false;wakeScene();
  }
  function start(){
    if(loading)return;
    const probe=document.createElement('canvas');const gl=probe.getContext('webgl2');
    if(!gl){status.textContent='อุปกรณ์นี้แสดงฉากแบบภาพ';load.hidden=true;return;}
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    loading=true;load.disabled=true;load.textContent='กำลังเปิดฉาก…';status.textContent='กำลังเตรียมโลกของนาคา';
    frame.hidden=false;frame.src='/world/';timeout=setTimeout(failure,90000);
  }
  load.addEventListener('click',start);
  addEventListener('message',event=>{
    if(event.origin!==location.origin || event.source!==frame.contentWindow)return;
    if(event.data?.type==='naka-world-ready'){
      clearTimeout(timeout);document.body.classList.add('world-ready');load.hidden=true;pause.hidden=false;
      status.textContent='โลกของนาคา · 3D';syncPause();
    } else if(event.data?.type==='naka-world-error') failure();
  });
  function syncPause(){pause.setAttribute('aria-pressed',String(window.nakaSceneState.paused));pause.textContent=window.nakaSceneState.paused?'เล่นการเคลื่อนไหว':'พักการเคลื่อนไหว';}
  function wakeScene(){dispatchEvent(new Event('naka-scene-wake'));}
  pause.addEventListener('click',()=>{window.nakaSceneState.paused=!window.nakaSceneState.paused;syncPause();wakeScene();});
  reduced.addEventListener('change',()=>{window.nakaSceneState.paused=reduced.matches;syncPause();wakeScene();});
  // The real-time scene (scene3d.js) replaces the poster once WebGL is up.
  addEventListener('naka-3d-ready',()=>{pause.hidden=false;status.textContent='ฉาก 3D แบบเรียลไทม์';syncPause();});
  // Keep the seamless poster as the initial scene; 3D is an explicit immersive option.
})();
