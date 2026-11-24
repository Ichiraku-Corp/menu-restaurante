// Juegos con fichas (pos-juegos.js): tragamonedas, ruleta y blackjack con el Supabase falso, que decide lo que sale
// (la prueba lo fuerza con window.__JGO). Revisa que la animación termine justo en lo que dijo el servidor, que las
// fichas y los puntos se pongan al día, el aviso de «sin fichas», el tope del día, los juegos apagados, «reducir
// movimiento», el teléfono y que no haya errores de JavaScript. Lo que dice Shibu tiene que salir de data/shibu.json.
// Uso: node pruebas-navegador/recorrido-juegos.js   (CAPTURA_JUEGOS=carpeta guarda capturas a 1280×800)
"use strict";
const fs=require("fs"),path=require("path"),http=require("http"),{chromium}=require("playwright");
const ROOT=path.join(__dirname,"..");let fallos=0;function ok(c,m){if(c)console.log("ok: "+m);else{fallos++;console.log("FALLÓ: "+m);}}
const T={".html":"text/html; charset=utf-8",".js":"text/javascript",".css":"text/css",".json":"application/json",".svg":"image/svg+xml",".png":"image/png",".webp":"image/webp",".woff2":"font/woff2"};
const srv=http.createServer((q,r)=>{const f=path.join(ROOT,decodeURIComponent(q.url.split("?")[0]));if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end();}r.writeHead(200,{"Content-Type":T[path.extname(f)]||"application/octet-stream"});fs.createReadStream(f).pipe(r);});
const CAP=process.env.CAPTURA_JUEGOS;if(CAP)fs.mkdirSync(CAP,{recursive:true});
const RUEDA=[0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
(async()=>{await new Promise(r=>srv.listen(8796,r));const b=await chromium.launch();const p=await (await b.newContext({viewport:{width:1280,height:800}})).newPage();
const err=[];p.on("pageerror",e=>err.push(e.message));p.on("dialog",d=>d.accept());
const menu=fs.readFileSync(path.join(ROOT,"data/menu.json"),"utf8");
await p.route("**/vendor/supabase-js-*/supabase.js",r=>r.fulfill({contentType:"application/javascript",body:"window.__MENU="+menu+";"+fs.readFileSync(path.join(ROOT,"pruebas-navegador/supabase-falso.js"),"utf8")}));
const pin=async c=>{for(const k of c)await p.click(`#pad [data-k="${k}"]`);};
const foto=async n=>{if(CAP)await p.screenshot({path:path.join(CAP,n)});};
const txt=s=>p.textContent(s);
const libre=id=>p.waitForFunction(i=>!document.getElementById(i).classList.contains("girando"),id,{timeout:15000});
const cont=async()=>(await txt("#jgoFichas"))+" · "+(await txt("#jgoPuntos"))+" · "+(await txt("#jgoHoy"));
const burbuja=re=>p.waitForFunction(s=>new RegExp(s).test(document.getElementById("jgoBub").textContent),re.source,{timeout:8000}).then(()=>true,()=>false);
const FR=JSON.parse(fs.readFileSync(path.join(ROOT,"data/shibu.json"),"utf8"));
const dice=async k=>FR[k].includes((await txt("#jgoBub")).trim());   // ¿el globito dice una frase de Shibu de esa lista?
const ir=async(desde,a)=>{if(desde)await p.click(`#${desde} [data-volver]`);await p.click(`#jgoMenu [data-jgo="${a}"]`);};
try{
await p.goto("http://localhost:8796/pos.html");await p.fill("#devEmail","a@b.c");await p.fill("#devPass","x");await p.click("#device button");
await pin("2222");await p.waitForSelector("#tablesView:not(.hidden)");await p.waitForTimeout(300);
if(await p.isVisible("#annDlg"))await p.keyboard.press("Escape");
// ---- Abrir: cabecera con fichas y lo ganado hoy; tres tarjetas; Shibu sin imagen todavía → círculo con su nombre
await p.evaluate(()=>abrirJuegos());await p.waitForSelector("#jgoDlg[open]");
await p.waitForFunction(()=>/Fichas: 3/.test(document.getElementById("jgoFichas").textContent));
ok(/Fichas: 3/.test(await txt("#jgoFichas"))&&(await txt("#jgoHoy"))==="Hoy ganaste 0 de 3 puntos jugando","al abrir, la cabecera dice «Fichas: 3» y «Hoy ganaste 0 de 3 puntos jugando» ("+await cont()+")");
ok((await p.$$eval("#jgoMenu [data-jgo] b",x=>x.map(y=>y.textContent))).join(",")==="Tragamonedas,Ruleta,Blackjack","tres tarjetas grandes: Tragamonedas, Ruleta y Blackjack");
const cara=()=>p.evaluate(()=>{const i=document.querySelector("#jgoDlg .shibu-img"),c=document.querySelector("#jgoDlg .shibu-badge");
  return {img:!i.hidden&&i.complete&&i.naturalWidth>0,src:i.getAttribute("src")||"",circulo:getComputedStyle(c).display!=="none"&&!c.hidden,texto:c.textContent,color:getComputedStyle(c).backgroundColor};});
let k=await cara();
ok(!k.img&&!k.src&&k.circulo&&k.texto==="Shibu"&&k.color==="rgb(224, 138, 60)","Shibu: sin «imagen» en data/shibu.json queda el círculo naranja con «Shibu» y no se pide ningún archivo");
ok(await dice("juego_hola"),"Shibu saluda con una frase suya de data/shibu.json: «"+(await txt("#jgoBub"))+"»");
await foto("menu.png");
// Con «imagen» en data/shibu.json sale su imagen (la misma de la bienvenida) en vez del círculo
await p.evaluate(()=>{SHIBU.frases.imagen="assets/pos-192.png";});await p.click("#jgoCerrar");await p.evaluate(()=>abrirJuegos());
await p.waitForFunction(()=>!document.querySelector("#jgoDlg .shibu-img").hidden,null,{timeout:5000}).catch(()=>{});
k=await cara();
ok(k.img&&k.src==="assets/pos-192.png"&&!k.circulo,"con «imagen» en data/shibu.json sale su imagen y el círculo se esconde");
await p.evaluate(()=>{delete SHIBU.frases.imagen;});await p.click("#jgoCerrar");await p.evaluate(()=>abrirJuegos());
await p.waitForFunction(()=>/Fichas: 3/.test(document.getElementById("jgoFichas").textContent));
k=await cara();
ok(!k.img&&k.circulo,"sin «imagen» vuelve el círculo");
// ---- Tragamonedas con premio forzado (dos iguales = 1 punto): paran uno tras otro en lo que dijo el servidor
await ir(null,"slot");
ok(await p.isVisible("#jgoSlot")&&/3 iguales = 3 puntos · 2 iguales = 1 punto/.test(await txt("#jgoSlot .jgo-premios"))&&(await txt("#jgoGirar"))==="Girar (1 ficha)","la tragamonedas muestra sus premios y «Girar (1 ficha)»");
await p.evaluate(()=>{window.__JGO={carretes:["ramen","ramen","sushi"]};window.__paros=[];
  new MutationObserver(ms=>ms.forEach(m=>{if(m.target.classList.contains("jgo-carrete")&&m.target.dataset.sym)window.__paros.push(performance.now());})).observe(document.getElementById("jgoCarretes"),{attributes:true,subtree:true,attributeFilter:["data-sym"]});});
await p.click("#jgoGirar");
ok(await p.evaluate(()=>document.getElementById("jgoSlot").classList.contains("girando")&&document.getElementById("jgoGirar").disabled&&document.querySelectorAll("#jgoCarretes .gira").length===3),"al tocar «Girar» giran los tres carretes y el botón se apaga");
ok(await dice("juego_suerte"),"mientras gira, Shibu dice una de sus frases de «suerte»: «"+(await txt("#jgoBub"))+"»");
await p.waitForTimeout(150);
ok(/Fichas: 2/.test(await txt("#jgoFichas"))&&/Hoy ganaste 0 de 3/.test(await txt("#jgoHoy"))&&!(await txt("#jgoSlotRes")),"la ficha se gasta al girar, pero el premio no se ve antes de que paren ("+await cont()+")");
await libre("jgoSlot");
const centro=await p.$$eval("#jgoCarretes .jgo-carrete",cs=>cs.map(c=>c.dataset.sym+":"+(c.querySelector(".centro")||{}).textContent));
ok(centro.join(",")==="ramen:🍜,ramen:🍜,sushi:🍣","los carretes paran justo en lo que dijo el servidor: "+centro.join(", "));
const paros=await p.evaluate(()=>window.__paros),gaps=paros.slice(1).map((x,i)=>Math.round(x-paros[i]));
ok(paros.length===3&&gaps.every(g=>g>=480&&g<=760),"paran uno tras otro, unos 0,6 s entre cada uno ("+gaps.join(" ms y ")+" ms)");
ok(/¡Ganaste! \+1 punto/.test(await txt("#jgoSlotRes"))&&await p.evaluate(()=>[...document.querySelectorAll("#jgoCarretes .jgo-carrete")].map(c=>c.classList.contains("gana")).join()==="true,true,false"),
  "muestra el premio («"+(await txt("#jgoSlotRes"))+"») y resalta los dos ramen");
ok(await p.evaluate(()=>!!document.querySelector("#jgoSlot .jgo-confeti")),"festeja con confeti");
ok(/Fichas: 2/.test(await txt("#jgoFichas"))&&/Puntos: 1/.test(await txt("#jgoPuntos"))&&(await txt("#jgoHoy"))==="Hoy ganaste 1 de 3 puntos jugando","las fichas y los puntos se ponen al día ("+await cont()+")");
ok(await dice("juego_gana"),"con premio, Shibu dice una de sus frases de «gana»: «"+(await txt("#jgoBub"))+"»");
await p.waitForTimeout(300);await foto("tragamonedas.png");
// ---- Ruleta: apostar a rojo y sale el 17 (negro)
await ir("jgoSlot","rul");
ok(await p.isDisabled("#jgoRulGirar")&&await p.locator("#jgoNums button").count()===37,"en la ruleta «Girar» está apagado hasta elegir apuesta, y hay números del 0 al 36");
ok(/color o par\/impar = 1 punto · número exacto = 3 puntos/.test(await txt("#jgoRul .jgo-premios")),"la ruleta muestra sus premios");
await p.click('#jgoApuestas [data-ap="rojo"]');
ok(!(await p.isDisabled("#jgoRulGirar"))&&(await txt("#jgoTuAp"))==="Tu apuesta: Rojo"&&(await p.getAttribute('#jgoApuestas [data-ap="rojo"]',"aria-pressed"))==="true","al elegir «Rojo» queda marcada y se puede girar");
await p.evaluate(()=>{window.__JGO={numero:17};});
await p.click("#jgoRulGirar");
ok(await p.evaluate(()=>document.getElementById("jgoRul").classList.contains("girando")&&document.querySelector('#jgoApuestas [data-ap="negro"]').disabled),"mientras gira no se puede cambiar la apuesta");
await libre("jgoRul");
const bola=await p.evaluate(()=>{const g=el=>{const m=/rotate\(([-\d.]+)\)(?: translate\(0 ([-\d.]+)\))?/.exec(el.getAttribute("transform"));return [+m[1],m[2]==null?null:+m[2]];};
  const w=g(document.getElementById("jgoRueda")),bb=g(document.getElementById("jgoBola"));return {d:(((bb[0]-w[0])%360)+360)%360,r:bb[1]};});
const casilla=RUEDA[Math.round(bola.d/(360/37))%37];
ok(casilla===17&&Math.abs(bola.r+65.5)<0.6,"la bola cae en la casilla del 17 de la rueda (casilla "+casilla+", radio "+bola.r+")");
ok(/Salió el 17 negro · impar\. Sin premio esta vez/.test(await txt("#jgoRulRes"))&&(await txt("#jgoHubN"))==="17","dice «"+(await txt("#jgoRulRes"))+"» y el centro de la rueda muestra el 17");
ok(await dice("juego_pierde"),"sin premio, Shibu dice una de sus frases de «pierde»: «"+(await txt("#jgoBub"))+"»");
ok(/Fichas: 1/.test(await txt("#jgoFichas"))&&/Puntos: 1/.test(await txt("#jgoPuntos"))&&/Hoy ganaste 1 de 3/.test(await txt("#jgoHoy")),"apostó a rojo y salió negro: gasta la ficha y los puntos no cambian ("+await cont()+")");
ok(await p.evaluate(()=>document.querySelector('#jgoNums [data-ap="17"]').classList.contains("salio")&&/Últimos:17/.test(document.getElementById("jgoHist").textContent)),"el 17 queda marcado en la cuadrícula y en «Últimos»");
await p.waitForTimeout(600);await foto("ruleta.png");
// ---- Blackjack con mazo fijo: 5♠ 6♥ contra 10♣ y la tapada 7♦; pide (9♣ → 20) y se planta: gana
await ir("jgoRul","bj");
ok(await p.isVisible("#jgoRepartir")&&(await txt("#jgoRepartir"))==="Repartir (1 ficha)"&&!(await p.isVisible("#jgoPedir")),"el blackjack empieza con «Repartir (1 ficha)»");
ok(/ganar = 1 punto · blackjack = 2 puntos · empate = te devuelve la ficha/.test(await txt("#jgoBj .jgo-premios")),"el blackjack muestra sus premios");
await p.evaluate(()=>{window.__JGO={mazo:["5♠","10♣","6♥","7♦","9♣"]};});
await p.click("#jgoRepartir");
const animando=await p.waitForFunction(()=>{const c=document.querySelector("#jgoBjJ .jgo-carta");return c?c.getAnimations().length>0:false;},null,{polling:"raf",timeout:3000}).then(()=>true,()=>false);
await libre("jgoBj");
const mesa=()=>p.evaluate(()=>({j:[...document.querySelectorAll("#jgoBjJ .jgo-carta")].map(c=>c.dataset.carta).join(" "),c:[...document.querySelectorAll("#jgoBjC .jgo-carta")].map(c=>c.classList.contains("tapada")?"tapada":c.dataset.carta).join(" ")}));
let m=await mesa();
ok(animando&&m.j==="5♠ 6♥"&&m.c==="10♣ tapada","se reparten con animación dos cartas a cada uno y la segunda del crupier boca abajo ("+m.j+" / "+m.c+")");
ok((await txt("#jgoBjTotJ"))==="11"&&(await txt("#jgoBjTotC"))==="?"&&await p.isVisible("#jgoPedir")&&await p.isVisible("#jgoPlantarse")&&!(await p.isDisabled("#jgoPedir")),"total 11, el del crupier oculto, y se puede «Pedir» o «Plantarse»");
ok(/Fichas: 0/.test(await txt("#jgoFichas")),"la ficha de la mano ya se gastó");
await p.click("#jgoPedir");await libre("jgoBj");m=await mesa();
ok(m.j==="5♠ 6♥ 9♣"&&(await txt("#jgoBjTotJ"))==="20"&&m.c==="10♣ tapada","«Pedir» trae otra carta (9♣ → 20) y la del crupier sigue boca abajo");
await p.click("#jgoPlantarse");
const volteo=await p.waitForFunction(()=>{const c=document.querySelectorAll("#jgoBjC .jgo-carta")[1];if(!c||c.classList.contains("tapada"))return false;return {anim:c.querySelector(".jgo-carta-in").getAnimations().length};},null,{polling:"raf",timeout:4000}).then(h=>h.jsonValue(),()=>({anim:0}));
await libre("jgoBj");m=await mesa();
ok(m.c==="10♣ 7♦"&&volteo.anim>0&&(await txt("#jgoBjTotC"))==="17","al plantarse, la carta del crupier se voltea con animación (7♦ → 17)");
ok(/¡Ganaste la mano! \+1 punto/.test(await txt("#jgoBjRes"))&&await dice("juego_gana"),"20 contra 17: «"+(await txt("#jgoBjRes"))+"» y Shibu: «"+(await txt("#jgoBub"))+"»");
ok(/Fichas: 0/.test(await txt("#jgoFichas"))&&/Puntos: 2/.test(await txt("#jgoPuntos"))&&(await txt("#jgoHoy"))==="Hoy ganaste 2 de 3 puntos jugando","fichas y puntos al día ("+await cont()+")");
ok(await p.isVisible("#jgoOtra")&&/^Otra mano/.test(await txt("#jgoOtra"))&&!(await p.isVisible("#jgoPedir"))&&!(await p.isVisible("#jgoPlantarse")),"al terminar la mano se ofrece «Otra mano»");
ok(await p.evaluate(()=>window.__jgoLlamadas.every(a=>a.p_emp===2&&a.p_pin==="2222")),"cada jugada va con el empleado y su PIN");
await p.waitForTimeout(300);await foto("blackjack.png");
// ---- Sin fichas: el servidor lo rechaza y Shibu lo dice; todo sigue usable
await ir("jgoBj","slot");
await p.click("#jgoGirar");
const aviso=id=>p.waitForFunction(i=>document.getElementById(i).classList.contains("aviso"),id,{timeout:8000}).then(()=>true,()=>false);
ok(await aviso("jgoSlotRes")&&/No tienes fichas: cumple una misión para ganar una/.test(await txt("#jgoSlotRes"))&&await dice("sin_fichas"),
  "sin fichas: debajo dice «"+(await txt("#jgoSlotRes"))+"» y Shibu: «"+(await txt("#jgoBub"))+"»");
await libre("jgoSlot");
ok(await p.evaluate(()=>document.getElementById("jgoBub").classList.contains("info"))&&!(await p.isDisabled("#jgoGirar"))&&
  (await p.$$eval("#jgoCarretes .jgo-carrete",cs=>cs.map(c=>c.dataset.sym).join()))==="ramen,ramen,sushi","el aviso no sale como error, los carretes no se movieron y se puede seguir usando");
ok(await p.evaluate(()=>!document.getElementById("notice")||!document.getElementById("notice").classList.contains("show")),"no aparece el aviso grande de error (no hace falta tocar «Entendido»)");
// ---- Número exacto y tope del día: paga 3, pero solo suma lo que faltaba para el tope; después, el aviso del tope
await p.evaluate(()=>{window.__S.jgo.fichas=2;});
await ir("jgoSlot","rul");
await p.click('#jgoNums [data-ap="17"]');
ok((await txt("#jgoTuAp"))==="Tu apuesta: el 17"&&(await p.getAttribute('#jgoApuestas [data-ap="rojo"]',"aria-pressed"))==="false","se puede apostar a un número exacto (el 17) y «Rojo» se desmarca");
await p.evaluate(()=>{window.__JGO={numero:17};});
await p.click("#jgoRulGirar");await libre("jgoRul");
ok(/\+1 punto \(llegaste al tope de hoy\)/.test(await txt("#jgoRulRes"))&&(await txt("#jgoHoy"))==="Hoy ganaste 3 de 3 puntos jugando",
  "acertó el número: el servidor paga lo que falta para el tope y abajo lo dice: «"+(await txt("#jgoRulRes"))+"» ("+await cont()+")");
ok(await dice("tope"),"el tope recortó el premio: Shibu dice una de sus frases del «tope»: «"+(await txt("#jgoBub"))+"»");
await p.click("#jgoRulGirar");
ok(await aviso("jgoRulRes")&&/Ya ganaste el tope de hoy \(3 puntos\)\. ¡Vuelve mañana!/.test(await txt("#jgoRulRes"))&&await dice("tope"),
  "con el tope lleno no se juega: debajo dice «"+(await txt("#jgoRulRes"))+"» y Shibu: «"+(await txt("#jgoBub"))+"»");
ok(!(await p.isDisabled("#jgoRulGirar"))&&/Fichas: 1/.test(await txt("#jgoFichas")),"la ficha no se gastó y se puede seguir usando la ventana");
// ---- Juegos apagados
await p.evaluate(()=>{window.__S.jgo.activo=false;});
await p.click("#jgoCerrar");
ok(!(await p.isVisible("#jgoDlg")),"«Cerrar» cierra la ventana");
await p.evaluate(()=>abrirJuegos());
await p.waitForFunction(()=>!document.getElementById("jgoApagado").classList.contains("hidden"));
ok(/Los juegos están apagados por hoy/.test(await txt("#jgoApagado"))&&/Los juegos están apagados por hoy/.test(await txt("#jgoBub"))&&
  await p.evaluate(()=>[...document.querySelectorAll("#jgoMenu [data-jgo]")].every(x=>x.disabled)),"con los juegos apagados se avisa «Los juegos están apagados por hoy» y no se puede jugar");
// ---- Reducir movimiento: el resultado sale de una vez, sin girar
await p.evaluate(()=>{Object.assign(window.__S.jgo,{activo:true,ganado_hoy:0,fichas:1});window.__JGO={carretes:["estrella","estrella","estrella"]};});
await p.emulateMedia({reducedMotion:"reduce"});
await p.click("#jgoCerrar");await p.evaluate(()=>abrirJuegos());await p.waitForFunction(()=>/Fichas: 1/.test(document.getElementById("jgoFichas").textContent));
await ir(null,"slot");
const t1=Date.now();await p.click("#jgoGirar");await libre("jgoSlot");const dt=Date.now()-t1;
ok(dt<1000&&(await p.$$eval("#jgoCarretes .jgo-carrete",cs=>cs.map(c=>c.dataset.sym).join()))==="estrella,estrella,estrella"&&/\+3 puntos/.test(await txt("#jgoSlotRes"))&&
  await p.evaluate(()=>!document.querySelector("#jgoSlot .jgo-confeti")),"con «reducir movimiento» el resultado sale sin girar ni confeti ("+dt+" ms)");
ok(await dice("juego_mayor"),"tres iguales: Shibu dice una de sus frases del premio mayor: «"+(await txt("#jgoBub"))+"»");
await p.emulateMedia({reducedMotion:"no-preference"});
// ---- Empate en el blackjack (17 contra 17): vuelve la ficha y Shibu tiene frases propias para el empate
await p.evaluate(()=>{Object.assign(window.__S.jgo,{ganado_hoy:0,fichas:1});window.__JGO={mazo:["10♠","10♣","7♥","7♦"]};});
await ir("jgoSlot","bj");
await p.click(await p.isVisible("#jgoOtra")?"#jgoOtra":"#jgoRepartir");await libre("jgoBj");
await p.click("#jgoPlantarse");await libre("jgoBj");
ok(/Empate: te devolvemos la ficha/.test(await txt("#jgoBjRes"))&&await dice("juego_empate")&&/Fichas: 1/.test(await txt("#jgoFichas")),
  "17 contra 17: «"+(await txt("#jgoBjRes"))+"», la ficha vuelve ("+(await txt("#jgoFichas"))+") y Shibu: «"+(await txt("#jgoBub"))+"»");
await p.click("#jgoBj [data-volver]");await p.click('#jgoMenu [data-jgo="slot"]');
// ---- Tamaños: tablet (1280×800) y teléfono (390×844): nada se sale a lo ancho, los botones miden 44 px o más y en la
//      tablet cada juego cabe entero sin desplazar
await p.evaluate(()=>{Object.assign(window.__S.jgo,{ganado_hoy:0,fichas:3});});
const medir=()=>p.evaluate(()=>{const d=document.getElementById("jgoDlg"),r=d.getBoundingClientRect(),chicos=[...d.querySelectorAll("button")].filter(x=>x.offsetParent).map(x=>x.getBoundingClientRect()).filter(q=>q.width<44||q.height<44);
  return {ancho:d.scrollWidth<=d.clientWidth+1&&r.left>=-1&&r.right<=innerWidth+1,chicos:chicos.length,cabe:d.scrollHeight<=d.clientHeight+1};});
for(const [nombre,w,h] of [["la tablet",1280,800],["el teléfono",390,844]]){
  await p.setViewportSize({width:w,height:h});await p.click("#jgoCerrar");await p.evaluate(()=>abrirJuegos());await p.waitForTimeout(300);
  let bien=true;const detalle=[];
  for(const v of ["menu","slot","rul","bj"]){
    if(v!=="menu"){if(!(await p.isVisible("#jgoMenu")))await p.click(".jgo-vista:not(.hidden) [data-volver]");await p.click(`#jgoMenu [data-jgo="${v}"]`);}
    await p.waitForTimeout(350);const x=await medir();
    const mal=(x.ancho?"":" se sale a lo ancho")+(x.chicos?" con "+x.chicos+" botones chicos":"")+(w>1000&&!x.cabe?" no cabe sin desplazar":"");
    detalle.push(v+mal);if(mal)bien=false;
    if(CAP&&w<500)await p.screenshot({path:path.join(CAP,"telefono-"+{menu:"menu",slot:"tragamonedas",rul:"ruleta",bj:"blackjack"}[v]+".png")});}
  ok(bien,"en "+nombre+" ("+w+"×"+h+") "+(w>1000?"cada vista cabe entera, ":"")+"nada se sale a lo ancho y los botones miden 44 px o más ("+detalle.join(", ")+")");
}
await p.click("#jgoBj [data-volver]");
await p.click('#jgoMenu [data-jgo="rul"]');await p.click('#jgoNums [data-ap="36"]');
ok(await p.evaluate(()=>{const b=document.getElementById("jgoRulGirar").getBoundingClientRect();return b.bottom<=innerHeight&&b.top>=0;}),"en el teléfono «Girar» queda a la vista aunque la apuesta esté abajo");
}catch(e){fallos++;console.log("FALLÓ: la prueba se detuvo: "+e.message);}
ok(err.length===0,"sin errores de JavaScript"+(err.length?": "+err.join(" | "):""));
await b.close();srv.close();if(fallos){console.log(fallos+" prueba(s) fallaron");process.exit(1);}console.log("TODAS LAS PRUEBAS DE LOS JUEGOS PASARON");})();
