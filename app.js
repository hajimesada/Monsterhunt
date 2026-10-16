(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const screens = ["startScreen","gameScreen","resultScreen","dexScreen"];

  const MONSTERS = [
    {id:"moko", name:"モコ", emoji:"🟢", stars:1, finds:1, catchChance:.92, weight:36, desc:"ころころ転がる、いたずら好きの小さなモンスター。"},
    {id:"pyon", name:"ピョンタ", emoji:"🐸", stars:2, finds:2, catchChance:.78, weight:27, desc:"見つかるとすぐに別の場所へジャンプして逃げる。"},
    {id:"gosumi", name:"ゴースミ", emoji:"👻", stars:3, finds:3, catchChance:.62, weight:20, desc:"気配を消すのが得意。何度も見つけないと姿を見せない。"},
    {id:"chibidra", name:"チビドラ", emoji:"🐲", stars:4, finds:4, catchChance:.48, weight:12, desc:"素早く逃げ回るレアモンスター。狙いをよく定めよう。"},
    {id:"kingmoko", name:"キングモコ", emoji:"🦁", stars:5, finds:5, catchChance:.34, weight:5, desc:"めったに現れない伝説級。何度も追い詰めて捕まえよう。"}
  ];

  const state = {
    stream:null,
    playing:false,
    sensorGranted:false,
    sensorReceived:false,
    heading:0,
    virtualHeading:0,
    targetHeading:0,
    current:null,
    foundCount:0,
    balls:5,
    canTap:false,
    captureMode:false,
    caughtThisRun:0,
    returnTo:"startScreen",
    sensorFallbackTimer:null,
    toastTimer:null
  };

  function showScreen(id){
    screens.forEach(s => $(s).classList.toggle("active", s === id));
  }

  function stars(n){
    return "★".repeat(n) + "☆".repeat(5-n);
  }

  function angleDiff(a,b){
    let d = ((a-b+540)%360)-180;
    return d;
  }

  function clamp(v,min,max){ return Math.min(max, Math.max(min,v)); }

  function toast(text){
    clearTimeout(state.toastTimer);
    $("toast").textContent = text;
    $("toast").classList.add("show");
    state.toastTimer = setTimeout(() => $("toast").classList.remove("show"), 1800);
  }

  function saveDex(monster){
    const data = getDex();
    data[monster.id] = (data[monster.id] || 0) + 1;
    localStorage.setItem("monster-hunt-dex", JSON.stringify(data));
  }

  function getDex(){
    try{
      return JSON.parse(localStorage.getItem("monster-hunt-dex") || "{}");
    }catch{
      return {};
    }
  }

  function pickMonster(){
    const total = MONSTERS.reduce((s,m)=>s+m.weight,0);
    let r = Math.random()*total;
    for(const m of MONSTERS){
      r -= m.weight;
      if(r <= 0) return m;
    }
    return MONSTERS[0];
  }

  function randomTarget(minDelta=55){
    const base = state.sensorReceived ? state.heading : state.virtualHeading;
    const sign = Math.random() < .5 ? -1 : 1;
    const delta = minDelta + Math.random()*(160-minDelta);
    state.targetHeading = (base + sign*delta + 360) % 360;
  }

  async function requestSensors(){
    try{
      if(typeof DeviceOrientationEvent !== "undefined" &&
         typeof DeviceOrientationEvent.requestPermission === "function"){
        const result = await DeviceOrientationEvent.requestPermission();
        state.sensorGranted = result === "granted";
      }else{
        state.sensorGranted = "DeviceOrientationEvent" in window;
      }
    }catch(err){
      console.warn("orientation permission:", err);
      state.sensorGranted = false;
    }

    if(state.sensorGranted){
      window.addEventListener("deviceorientation", onOrientation, {passive:true});
      window.addEventListener("deviceorientationabsolute", onOrientation, {passive:true});
    }
  }

  function onOrientation(e){
    const alpha = Number(e.alpha);
    if(!Number.isFinite(alpha)) return;
    state.sensorReceived = true;
    state.heading = (360-alpha)%360;
    $("fallbackControls").classList.add("hidden");
    updateSearch();
  }

  async function startCamera(){
    if(!navigator.mediaDevices?.getUserMedia){
      toast("このブラウザではカメラを利用できません");
      return false;
    }
    try{
      state.stream = await navigator.mediaDevices.getUserMedia({
        video:{facingMode:{ideal:"environment"}, width:{ideal:1280}, height:{ideal:720}},
        audio:false
      });
      $("camera").srcObject = state.stream;
      return true;
    }catch(err){
      console.warn("camera:", err);
      toast("カメラを許可するとAR探索で遊べます");
      return false;
    }
  }

  function stopCamera(){
    if(state.stream){
      state.stream.getTracks().forEach(t=>t.stop());
      state.stream = null;
    }
    $("camera").srcObject = null;
  }

  async function startGame(){
    $("startBtn").disabled = true;
    $("startBtn").textContent = "準備中…";

    // Both calls are intentionally started from this user gesture.
    const sensorPromise = requestSensors();
    const cameraPromise = startCamera();
    await Promise.allSettled([sensorPromise,cameraPromise]);

    $("startBtn").disabled = false;
    $("startBtn").textContent = "探索スタート";

    state.playing = true;
    state.caughtThisRun = 0;
    $("caughtCount").textContent = "0";
    showScreen("gameScreen");
    nextMonster();

    clearTimeout(state.sensorFallbackTimer);
    state.sensorFallbackTimer = setTimeout(() => {
      if(!state.sensorReceived && state.playing){
        $("fallbackControls").classList.remove("hidden");
        $("message").textContent = "向きセンサーが使えないので、左右ボタンで探そう！";
      }
    }, 2200);
  }

  function nextMonster(){
    state.current = pickMonster();
    state.foundCount = 0;
    state.balls = 5;
    state.canTap = false;
    state.captureMode = false;

    $("monsterStars").textContent = stars(state.current.stars);
    $("monsterEmoji").textContent = state.current.emoji;
    $("monsterName").textContent = state.current.name;
    $("monster").classList.add("hidden");
    $("monster").classList.remove("escape");
    $("targetRing").classList.add("hidden");
    $("ballZone").classList.add("hidden");
    $("scanArrow").classList.remove("hidden");
    $("message").textContent = "スマホをゆっくり左右に動かして探そう！";
    updateBalls();
    resetBall();
    randomTarget(45);
    updateSearch();
  }

  function updateSearch(){
    if(!state.playing || state.captureMode || !state.current) return;

    const h = state.sensorReceived ? state.heading : state.virtualHeading;
    const diff = Math.abs(angleDiff(state.targetHeading,h));
    const proximity = 1 - clamp(diff/115,0,1);
    const meters = Math.max(.8, 9.8 - proximity*9);
    $("distanceText").textContent = meters.toFixed(1)+" m";
    $("radarFill").style.width = `${Math.round(8+proximity*92)}%`;

    if(diff < 16){
      $("radarText").textContent = "発見！";
      revealMonster();
    }else if(diff < 35){
      $("radarText").textContent = "すぐ近く！";
      $("message").textContent = diff < 24 ? "かなり近い！ゆっくり探して！" : "気配が強くなってきた！";
      hideMonsterIfSearching();
    }else if(diff < 70){
      $("radarText").textContent = "気配あり";
      $("message").textContent = angleDiff(state.targetHeading,h) > 0 ? "右の方から気配がする…" : "左の方から気配がする…";
      hideMonsterIfSearching();
    }else{
      $("radarText").textContent = "遠い";
      $("message").textContent = angleDiff(state.targetHeading,h) > 0 ? "もっと右を探してみよう" : "もっと左を探してみよう";
      hideMonsterIfSearching();
    }
  }

  function hideMonsterIfSearching(){
    if(!state.canTap) $("monster").classList.add("hidden");
  }

  function revealMonster(){
    if(state.canTap || state.captureMode) return;
    state.canTap = true;
    $("monster").classList.remove("hidden");
    $("scanArrow").classList.add("hidden");
    $("message").textContent = `${state.current.name}を見つけた！タップ！`;
    if(navigator.vibrate) navigator.vibrate([40,40,80]);
  }

  function onMonsterTap(){
    if(!state.canTap || state.captureMode) return;
    state.canTap = false;
    state.foundCount++;

    if(state.foundCount < state.current.finds){
      $("monster").classList.add("escape");
      $("message").textContent = `逃げられた！ あと${state.current.finds-state.foundCount}回見つけよう！`;
      if(navigator.vibrate) navigator.vibrate([30,60,30]);
      setTimeout(()=>{
        $("monster").classList.add("hidden");
        $("monster").classList.remove("escape");
        $("scanArrow").classList.remove("hidden");
        randomTarget(65);
        updateSearch();
      },650);
      return;
    }

    enterCaptureMode();
  }

  function enterCaptureMode(){
    state.captureMode = true;
    $("scanArrow").classList.add("hidden");
    $("monster").classList.remove("hidden");
    $("targetRing").classList.remove("hidden");
    $("ballZone").classList.remove("hidden");
    $("message").textContent = "チャンス！ボールをモンスターへ投げよう！";
    $("radarText").textContent = "捕獲チャンス";
    $("distanceText").textContent = "0.8 m";
    $("radarFill").style.width = "100%";
  }

  function updateBalls(){
    $("ballsLeft").textContent = Array.from({length:5},(_,i)=>i<state.balls?"●":"○").join(" ");
  }

  function resetBall(){
    const b = $("ball");
    b.style.left = "50%";
    b.style.bottom = "5px";
    b.style.transform = "translateX(-50%)";
    b.style.opacity = "1";
    b.classList.remove("dragging","throwing");
    b.disabled = false;
  }

  let drag = null;
  function ballPointerDown(e){
    if(!state.captureMode || state.balls <= 0) return;
    e.preventDefault();
    const ball = $("ball");
    ball.setPointerCapture?.(e.pointerId);
    const r = ball.getBoundingClientRect();
    drag = {id:e.pointerId, startX:e.clientX, startY:e.clientY, baseX:r.left+r.width/2, baseY:r.top+r.height/2};
    ball.classList.add("dragging");
  }

  function ballPointerMove(e){
    if(!drag || e.pointerId !== drag.id) return;
    e.preventDefault();
    const dx = e.clientX-drag.startX;
    const dy = e.clientY-drag.startY;
    $("ball").style.transform = `translate(calc(-50% + ${dx}px), ${dy}px) rotate(${dx*1.4}deg)`;
  }

  function ballPointerUp(e){
    if(!drag || e.pointerId !== drag.id) return;
    e.preventDefault();
    const dx = e.clientX-drag.startX;
    const dy = e.clientY-drag.startY;
    drag = null;
    $("ball").classList.remove("dragging");

    if(dy > -75){
      resetBall();
      toast("上にスワイプして投げよう！");
      return;
    }
    throwBall(e.clientX,e.clientY,dx,dy);
  }

  function throwBall(endX,endY,dx,dy){
    const ball = $("ball");
    ball.classList.add("throwing");
    ball.disabled = true;
    state.balls--;
    updateBalls();

    const monsterRect = $("monster").getBoundingClientRect();
    const targetX = monsterRect.left + monsterRect.width/2;
    const targetY = monsterRect.top + monsterRect.height*.48;
    const distance = Math.hypot(endX-targetX, endY-targetY);
    const upwardPower = Math.min(1, Math.abs(dy)/260);
    const aimBonus = clamp(1-distance/180,0,1);
    const hit = distance < 190 || (upwardPower>.72 && Math.abs(endX-targetX)<110);

    ball.style.transform = `translate(calc(-50% + ${dx}px), ${Math.min(dy,-220)}px) scale(.58) rotate(${dx*2}deg)`;
    ball.style.opacity = ".25";

    setTimeout(()=>{
      if(hit){
        resolveCapture(aimBonus);
      }else{
        $("message").textContent = "おしい！もう一度ねらおう！";
        if(navigator.vibrate) navigator.vibrate(35);
        if(state.balls <= 0) failCapture();
        else resetBall();
      }
    },340);
  }

  function resolveCapture(aimBonus){
    const chance = clamp(state.current.catchChance + aimBonus*.17, .18, .98);
    const success = Math.random() < chance;
    if(success){
      if(navigator.vibrate) navigator.vibrate([60,70,60,70,120]);
      saveDex(state.current);
      state.caughtThisRun++;
      $("caughtCount").textContent = String(state.caughtThisRun);
      showResult();
    }else{
      $("message").textContent = "ボールから飛び出した！もう一回！";
      $("monster").animate?.([
        {transform:"translate(-50%,-50%) scale(.9)"},
        {transform:"translate(-50%,-50%) scale(1.15)"},
        {transform:"translate(-50%,-50%) scale(1)"}
      ],{duration:420});
      if(state.balls <= 0) failCapture();
      else resetBall();
    }
  }

  function failCapture(){
    $("message").textContent = `${state.current.name}に逃げられた…`;
    $("monster").classList.add("escape");
    setTimeout(()=>nextMonster(),1100);
  }

  function showResult(){
    const m = state.current;
    $("resultEmoji").textContent = m.emoji;
    $("resultTitle").textContent = m.name;
    $("resultStars").textContent = stars(m.stars);
    $("resultDesc").textContent = m.desc;
    showScreen("resultScreen");
  }

  function quitGame(){
    state.playing = false;
    state.captureMode = false;
    clearTimeout(state.sensorFallbackTimer);
    stopCamera();
    showScreen("startScreen");
  }

  function renderDex(){
    const data = getDex();
    const caughtKinds = MONSTERS.filter(m => data[m.id]).length;
    const total = Object.values(data).reduce((s,n)=>s+Number(n||0),0);
    $("dexStats").innerHTML = `<span>発見 ${caughtKinds}/${MONSTERS.length}種</span><span>GET ${total}体</span>`;
    $("dexGrid").innerHTML = MONSTERS.map(m=>{
      const count = Number(data[m.id]||0);
      const locked = !count;
      return `<article class="dex-card ${locked?"locked":""}">
        <div class="emoji">${locked?"❔":m.emoji}</div>
        <h3>${locked?"？？？":m.name}</h3>
        <div class="stars">${stars(m.stars)}</div>
        <div class="count">${locked?"まだ見つけていない":`GET × ${count}`}</div>
      </article>`;
    }).join("");
  }

  function openDex(from){
    state.returnTo = from;
    renderDex();
    showScreen("dexScreen");
  }

  function backFromDex(){
    showScreen(state.returnTo || "startScreen");
  }

  function installHint(){
    const standalone = window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone;
    if(standalone){
      $("installHint").textContent = "ホーム画面アプリとして起動中";
      return;
    }
    const ua = navigator.userAgent;
    if(/iPhone|iPad|iPod/i.test(ua)){
      $("installHint").textContent = "iPhone/iPad：Safariの共有 →「ホーム画面に追加」でアプリ化できます。";
    }else if(/Android/i.test(ua)){
      $("installHint").textContent = "Android：ブラウザメニューの「ホーム画面に追加 / インストール」でアプリ化できます。";
    }
  }

  $("startBtn").addEventListener("click", startGame);
  $("dexBtn").addEventListener("click", ()=>openDex("startScreen"));
  $("resultDexBtn").addEventListener("click", ()=>openDex("resultScreen"));
  $("dexBackBtn").addEventListener("click", backFromDex);
  $("quitBtn").addEventListener("click", quitGame);
  $("monster").addEventListener("click", onMonsterTap);
  $("continueBtn").addEventListener("click", ()=>{
    showScreen("gameScreen");
    nextMonster();
  });

  $("leftBtn").addEventListener("click", ()=>{
    state.virtualHeading = (state.virtualHeading-18+360)%360;
    updateSearch();
  });
  $("rightBtn").addEventListener("click", ()=>{
    state.virtualHeading = (state.virtualHeading+18)%360;
    updateSearch();
  });

  const ball = $("ball");
  ball.addEventListener("pointerdown", ballPointerDown);
  ball.addEventListener("pointermove", ballPointerMove);
  ball.addEventListener("pointerup", ballPointerUp);
  ball.addEventListener("pointercancel", ()=>{ drag=null; resetBall(); });

  $("resetBtn").addEventListener("click", ()=>{
    if(confirm("図鑑の捕獲データをすべてリセットしますか？")){
      localStorage.removeItem("monster-hunt-dex");
      renderDex();
      toast("図鑑をリセットしました");
    }
  });

  document.addEventListener("visibilitychange", ()=>{
    if(document.hidden && state.playing && state.stream){
      // Camera track is left to the browser while hidden; no upload/recording occurs.
    }
  });

  window.addEventListener("pagehide", stopCamera);

  if("serviceWorker" in navigator){
    window.addEventListener("load", ()=>{
      navigator.serviceWorker.register("./sw.js").catch(err=>console.warn("SW:",err));
    });
  }

  installHint();
})();
