// Misiones de Shibu en la tablet: bienvenida del día, celebración con el sello y las monedas que vuelan a la chapita,
// avisos de avance, Mi perfil (carnet y Top maid en podio olímpico), la tienda en máquina expendedora, el premio del mes
// de la Top maid y la pestaña «Maids».
// Uso: node pruebas-navegador/recorrido-shibu.js   (CAPTURA_SHIBU=carpeta guarda capturas a 1280×800)
"use strict";
const fs=require("fs"),path=require("path"),http=require("http"),{chromium}=require("playwright");
const ROOT=path.join(__dirname,"..");let fallos=0;function ok(c,m){if(c)console.log("ok: "+m);else{fallos++;console.log("FALLÓ: "+m);}}
const T={".html":"text/html; charset=utf-8",".js":"text/javascript",".css":"text/css",".json":"application/json",".svg":"image/svg+xml",".png":"image/png",".webp":"image/webp",".woff2":"font/woff2"};
const srv=http.createServer((q,r)=>{const f=path.join(ROOT,decodeURIComponent(q.url.split("?")[0]));if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end();}r.writeHead(200,{"Content-Type":T[path.extname(f)]||"application/octet-stream"});fs.createReadStream(f).pipe(r);});
const CAP=process.env.CAPTURA_SHIBU||"";if(CAP)fs.mkdirSync(CAP,{recursive:true});
// Las funciones de misiones y tienda, falsas, con estado en window.__MIS (la base de verdad se prueba en supabase/pruebas/99-misiones.sql)
const FALSO_MIS=`(function(){ var R=window.__R,S=window.__S;
  var M=window.__MIS={saludo:{},nuevos:{},puntos:{1:8,2:12},fichas:{1:1,2:0},canjes:[],marcar:[],seq:50,top:null,topVisto:[],
    misiones:[{nivel:1,texto:'Vende 3 postres',puntos:1,tipo:'unidades',actual:1,meta:3,hecha:false},
              {nivel:2,texto:'Comanda promedio de $18 o más (mínimo 8 comandas)',puntos:2,tipo:'promedio',actual:14.5,meta:18,hecha:false},
              {nivel:3,texto:'Equipo: el local pasa la meta del día por 20 %',puntos:3,tipo:'equipo_meta',actual:310,meta:540,hecha:false,equipo:true},
              {nivel:0,extra:true,texto:'Vende 3 artículos de la tienda del menú',puntos:1,tipo:'unidades',actual:1,meta:3,hecha:false}],
    tienda:[{id:1,nombre:'Refresco',puntos:6,dish_id:29},{id:2,nombre:'Taiyaki',puntos:7,dish_id:24},{id:3,nombre:'Amaterasu',puntos:10,dish_id:7}]};
  function quien(a){ var e=S.staff.find(function(x){return x.id===a.p_emp}); if(!e||e.pin!==a.p_pin) throw {message:'PIN incorrecto. Vuelve a entrar.'}; return e; }
  R.mis_estado=function(a){ var e=quien(a); return {juega:true,activo:true,fecha:'2026-11-24',tipo_dia:'normales',nombre:e.name,saludo_hoy:!!M.saludo[e.id],
    misiones:M.misiones,nuevos:M.nuevos[e.id]||[],puntos:M.puntos[e.id]||0,fichas:M.fichas[e.id]||0,tienda:M.tienda,
    canjes:M.canjes.filter(function(c){return c.emp===e.id;}),juegos:{activo:true,tope_dia:3,ganado_hoy:0},grupo:'meseras',
    ranking:[{puesto:1,nombre:'Sakura',puntos:34,yo:false},{puesto:2,nombre:e.name,puntos:20,yo:true},{puesto:3,nombre:'Hana',puntos:18,yo:false},{puesto:4,nombre:'Yumi',puntos:9,yo:false}],
    premios_top:[10,6,3],campeona:{mes:'2026-10-01',nombre:'Sakura'},top_premio:M.top&&M.topVisto.indexOf(M.top.id)<0?M.top:null}; };
  R.mis_top_visto=function(a){ quien(a); M.topVisto.push(a.p_id); return null; };
  R.mis_marcar=function(a){ var e=quien(a); M.marcar.push({emp:e.id,saludo:a.p_saludo,logros:a.p_logros}); if(a.p_saludo) M.saludo[e.id]=true;
    if(a.p_logros) M.nuevos[e.id]=(M.nuevos[e.id]||[]).filter(function(x){return a.p_logros.indexOf(x.id)<0;}); return null; };
  // Compra directa: el premio queda entregado (en la base sale a cocina en Ref 0 y queda en el cierre de caja)
  R.tienda_canjear=function(a){ var e=quien(a), t=M.tienda.find(function(x){return x.id===a.p_item;}); if((M.puntos[e.id]||0)<t.puntos) throw {message:'Te faltan puntos'};
    M.puntos[e.id]-=t.puntos; var c={id:++M.seq,emp:e.id,quien:e.name,nombre:t.nombre,puntos:t.puntos,estado:'entregado',at:new Date().toISOString()}; M.canjes.push(c);
    return {id:c.id,nombre:t.nombre,order_id:900+c.id,puntos:M.puntos[e.id]}; };
})();`;
(async()=>{await new Promise(r=>srv.listen(8797,r));const b=await chromium.launch();const p=await (await b.newContext({viewport:{width:1280,height:800}})).newPage();
const err=[];p.on("pageerror",e=>err.push(e.message));p.on("dialog",d=>d.accept());
const menu=fs.readFileSync(path.join(ROOT,"data/menu.json"),"utf8");
await p.route("**/vendor/supabase-js-*/supabase.js",r=>r.fulfill({contentType:"application/javascript",body:"window.__MENU="+menu+";"+fs.readFileSync(path.join(ROOT,"pruebas-navegador/supabase-falso.js"),"utf8")+"\n"+FALSO_MIS}));
const pin=async c=>{for(const k of c)await p.click(`#pad [data-k="${k}"]`);};
const foto=async n=>{if(CAP)await p.screenshot({path:path.join(CAP,n)});};
const M=()=>p.evaluate(()=>window.__MIS);
try{
await p.goto("http://localhost:8797/pos.html");await p.fill("#devEmail","a@b.c");await p.fill("#devPass","x");await p.click("#device button");
// 1) La mesera entra: primero los avisos, después Shibu con sus 3 misiones
await pin("1111");await p.waitForSelector("#tablesView:not(.hidden)");await p.waitForTimeout(300);
if(await p.isVisible("#annDlg")) await p.keyboard.press("Escape");
await p.waitForSelector("#shibuDlg[open]",{timeout:6000});await p.waitForTimeout(2200);
ok(await p.locator("#shibuBody .mis-card").count()===4&&/Tus misiones de hoy/.test(await p.textContent("#shibuBody")),"al entrar por primera vez en el día, Shibu la recibe con sus 3 misiones y la extra");
ok(await p.evaluate(()=>{const c=[...document.querySelectorAll("#shibuBody .mis-card")].pop();return c.classList.contains("n0")&&/Extra del día · 1 punto/.test(c.textContent)&&/Vende 3 artículos de la tienda del menú/.test(c.textContent)&&/1 de 3/.test(c.textContent);}),
  "la extra del día (la tienda del menú) va al final, con su punto y su avance");
const frase=await p.textContent("#shibuTxt");
const fr=JSON.parse(fs.readFileSync(path.join(ROOT,"data/shibu.json"),"utf8"));
ok(frase.length>5&&fr.manana.concat(fr.manana_fuerte).indexOf(frase)>=0,"la frase sale de data/shibu.json, letra por letra («"+frase+"»)");
ok(/Ref 14,50 de Ref 18,00/.test(await p.textContent("#shibuBody"))&&/1 de 3/.test(await p.textContent("#shibuBody"))&&/Equipo/.test(await p.textContent("#shibuBody")),
  "cada misión muestra su avance (en Ref cuando es plata) y cuáles son de equipo");
ok(await p.evaluate(()=>document.querySelector("#shibuBody .mis-card .mis-barra i").style.width)==="33%","las barras de la bienvenida se llenan hasta su avance (1 de 3 = 33 %)");
await foto("bienvenida.png");
await p.click("#shibuOk");await p.waitForTimeout(300);
ok((await M()).marcar.some(x=>x.emp===1&&x.saludo===true),"al cerrar, la base anota que ya la saludó hoy");
ok(await p.isVisible("#btnShibu")&&/★ 0\/4/.test(await p.textContent("#btnShibu"))&&/8 pts/.test(await p.textContent("#btnShibu")),"arriba queda la chapita de Shibu con su avance y sus puntos");
// 2) Al cumplir una misión, Shibu celebra (una sola vez)
await p.evaluate(()=>{window.__MIS.misiones[0].hecha=true;window.__MIS.misiones[0].actual=3;window.__MIS.nuevos[1]=[{id:9,nivel:1,texto:'Vende 3 postres',puntos:1}];window.__MIS.puntos[1]=9;window.__MIS.fichas[1]=2;});
await p.evaluate(()=>shibuPoll(false));await p.waitForSelector("#shibuDlg[open] .shibu-fiesta",{timeout:4000});await p.waitForTimeout(1600);
ok(/¡Misión cumplida!/.test(await p.textContent("#shibuBody"))&&/\+1\s*punto · \+1\s*ficha/.test(await p.textContent(".fiesta-premio")),"al cumplir una misión sale Shibu celebrando con sus puntos y su ficha");
ok(fr.mision.indexOf(await p.textContent("#shibuTxt"))>=0,"la frase de la celebración también sale del archivo de frases");
ok(await p.locator("#shibuBody .mis-card.fiesta .mis-sello.cae").count()===1&&/シブ\s*CUMPLIDA/.test(await p.textContent("#shibuBody .mis-sello"))&&/Vende 3 postres/.test(await p.textContent("#shibuBody .mis-card.fiesta")),
  "en la celebración cae el sello de Shibu («シブ CUMPLIDA») sobre la tarjeta de la misión");
ok(/8 pts/.test(await p.textContent("#btnShibu")),"mientras celebra, la chapita sigue en 8 puntos (los nuevos llegan volando)");
await foto("celebracion.png");
await p.click("#shibuOk");await p.waitForTimeout(250);
ok(await p.locator(".shibu-moneda").count()>=2,"al seguir, las monedas salen volando hacia la chapita ("+(await p.locator(".shibu-moneda").count())+")");
await p.waitForTimeout(2200);
ok(/9 pts/.test(await p.textContent("#btnShibu"))&&await p.locator(".shibu-moneda").count()===0,"cuando llegan, la chapita sube contando hasta 9 puntos");
ok((await M()).marcar.some(x=>x.emp===1&&x.logros&&x.logros[0]===9)&&/★ 1\/4/.test(await p.textContent("#btnShibu")),"la celebración se marca como vista y la chapita sube a 1/4");
await p.evaluate(()=>shibuPoll(false));await p.waitForTimeout(400);
ok(!(await p.isVisible("#shibuDlg")),"no vuelve a celebrar la misma misión");
await p.evaluate(()=>{window.__MIS.misiones[3].actual=2;window.__MIS.misiones[2].actual=320;});
await p.evaluate(()=>shibuPoll(false));await p.waitForSelector(".shibu-aviso",{timeout:4000});await p.waitForTimeout(1400);
ok(await p.locator(".shibu-aviso").count()===1&&/Vende 3 artículos de la tienda del menú/.test(await p.textContent(".shibu-aviso"))&&/2 de 3/.test(await p.textContent(".shibu-aviso"))
  &&await p.evaluate(()=>document.querySelector(".shibu-aviso .sa-barra i").style.width)==="67%","al avanzar una misión sale un aviso chico («2 de 3») sin abrir ventanas; la de equipo, que subió poco, no avisa");
await foto("aviso.png");
await p.waitForTimeout(5000);
ok(await p.locator(".shibu-aviso").count()===0,"el aviso se va solo");
// 3) Mi perfil: el carnet, sus misiones y el Top maid del mes en el podio olímpico
await p.click("#btnShibu");await p.waitForSelector("#perfilDlg[open]");await p.waitForTimeout(1000);
ok(/Mesera/.test(await p.textContent("#perfilBody .carnet"))&&/2\.º del Top maid/.test(await p.textContent("#perfilBody .carnet"))&&/9\s*puntos/.test(await p.textContent("#perfilBody .perfil-saldos"))
  &&/2\s*fichas/.test(await p.textContent("#perfilBody .perfil-saldos"))&&await p.isVisible("#perfilTienda")&&await p.isVisible("#perfilJugar"),
  "el carnet de la maid muestra su nombre, su puesto en el Top maid, sus puntos y fichas, y los botones Tienda y Jugar");
await foto("perfil.png");
ok(await p.evaluate(()=>{
    const s=document.querySelector("#perfilBody svg.olimpo"); if(!s) return false;
    const n=[...s.querySelectorAll(".ol-nombre")].map(x=>x.textContent);
    return /TOP MAID · NOVIEMBRE/.test(s.querySelector(".ol-friso").textContent)&&n.join(",")==="MESERA,HANA,SAKURA"
      &&!!s.querySelector(".ol-estatua.e1")&&!!s.querySelector(".ol-laurel")&&s.querySelectorAll(".ol-tu").length===1&&/1\.ª Sakura con 34 puntos/.test(s.getAttribute("aria-label"));}),
  "el Top maid es un podio olímpico: templo con el mes, la Top 1 al centro con su estatua de oro y laurel, y «TÚ» sobre su puesto");
ok(/4\.º\s*Yumi\s*9 pts/.test(await p.textContent("#perfilBody .olimpo-resto"))&&/Top maid de octubre:\s*Sakura/.test(await p.textContent("#perfilBody .olimpo-campeona"))
  &&/la 1\.ª gana \+10, la 2\.ª \+6 y la 3\.ª \+3 puntos/.test(await p.textContent("#perfilBody .olimpo-caja")),
  "desde el 4.º puesto sigue en tablillas, sale la campeona del mes pasado y el premio de fin de mes");
await p.evaluate(()=>{const d=document.getElementById("perfilDlg"),s=document.querySelector("#perfilBody .olimpo-caja");d.scrollTop=s.offsetTop-20;});await p.waitForTimeout(400);
await foto("top-maid.png");
// 4) La tienda: una máquina expendedora a pantalla completa
await p.click("#perfilTienda");await p.waitForSelector("#tiendaDlg[open]");await p.waitForTimeout(700);
ok(!(await p.isVisible("#perfilDlg"))&&await p.evaluate(()=>{const d=document.getElementById("tiendaDlg").getBoundingClientRect();return d.width>=1270&&d.height>=790;}),
  "la tienda es una máquina que cubre toda la pantalla");
ok(await p.locator("#vmSlots .vm-slot[data-i]").count()===3&&await p.locator("#vmSlots .vm-slot.vacio").count()===5
  &&await p.locator('#vmSlots .vm-slot img[src="assets/dishes/taiyaki.webp"]').count()===1&&/9/.test(await p.textContent("#vmSaldo")),
  "en el vidrio están los 3 premios con su foto (y 5 casillas «Pronto»); la pantalla muestra el saldo");
await p.click('#vmSlots .vm-slot[data-i="2"]');await p.waitForTimeout(200);
ok(/TE FALTAN 1 PTS/.test(await p.textContent("#vmMsg"))&&await p.isDisabled("#vmComprar"),"si elige algo que no le alcanza, la pantalla dice cuánto le falta y el botón no se prende");
await p.click('#vmTeclado [data-k="A"]');await p.click('#vmTeclado [data-k="2"]');await p.waitForTimeout(200);
ok(/A2 · TAIYAKI · 7 PTS/.test(await p.textContent("#vmMsg"))&&await p.isEnabled("#vmComprar")&&await p.evaluate(()=>document.querySelector('#vmSlots .vm-slot[data-i="1"]').classList.contains("sel")),
  "con el teclado (A y 2) elige el Taiyaki: se marca en el vidrio y el botón grande se prende");
await foto("maquina.png");
let dialogos=0;p.on("dialog",()=>{dialogos++;});
await p.click("#vmComprar");await p.waitForTimeout(300);
ok((await M()).canjes.length===0&&/MANTÉN HASTA QUE SE LLENE/.test(await p.textContent("#vmMsg")),"un toque no compra: la pantalla dice «Mantén hasta que se llene»");
await p.hover("#vmComprar");await p.mouse.down();await p.waitForTimeout(600);
ok(await p.evaluate(()=>document.getElementById("vmComprar").classList.contains("cargando")),"al mantenerlo presionado, el anillo del botón se va llenando");
await p.waitForTimeout(900);await p.mouse.up();
await p.waitForSelector("#vmHueco .vm-premio img",{timeout:6000});await p.waitForTimeout(1200);
ok(dialogos===0&&(await M()).canjes.length===1&&(await M()).canjes[0].estado==="entregado","la compra se hace manteniendo presionado (sin preguntas del navegador) y el premio sale a cocina");
ok(await p.locator('#vmHueco .vm-premio img[src="assets/dishes/taiyaki.webp"]').count()===1&&/¡LISTO! TAIYAKI VA A COCINA/.test(await p.textContent("#vmMsg"))
  &&/2/.test(await p.textContent("#vmSaldo"))&&/Taiyaki/.test(await p.textContent("#vmRecibo")),
  "el Taiyaki cae a la bandeja, la pantalla dice que va a cocina, el saldo baja a 2 y sale en el recibo");
ok(fr.canje_aprobado.indexOf(await p.textContent("#vmGlobo"))>=0,"Shibu lo entrega con una frase de data/shibu.json: «"+(await p.textContent("#vmGlobo"))+"»");
await foto("premio.png");
await p.click("#vmCerrar");await p.waitForTimeout(800);
ok(await p.isVisible("#perfilDlg")&&/2\s*puntos/.test(await p.textContent("#perfilBody .perfil-saldos"))&&/Taiyaki · 7 pts\s*A cocina/.test(await p.textContent("#perfilBody")),
  "al cerrar la máquina vuelve a su perfil: sus puntos bajaron y en «Mis premios» sale «A cocina»");
await p.click("#perfilClose");await p.waitForTimeout(200);
// 5) Al empezar el mes, la Top maid del mes pasado recibe su premio: su estatua y los puntos volando a la chapita
await p.evaluate(()=>{window.__MIS.top={id:77,mes:'2026-10-01',puesto:1,puntos:10};window.__MIS.puntos[1]+=10;});
await p.evaluate(()=>shibuPoll(false));await p.waitForSelector("#shibuDlg[open] .olimpo-estatua",{timeout:5000});await p.waitForTimeout(1500);
ok(/¡Fuiste la Top maid de octubre!/.test(await p.textContent("#shibuBody"))&&/\+10\s*puntos para la tienda/.test(await p.textContent("#shibuBody .fiesta-premio"))
  &&/2 pts/.test(await p.textContent("#btnShibu")),"la Top maid ve su estatua de oro con su premio de +10 puntos (la chapita espera)");
await foto("premio-del-mes.png");
await p.click("#shibuOk");await p.waitForTimeout(2600);
ok((await M()).topVisto.indexOf(77)>=0&&/12 pts/.test(await p.textContent("#btnShibu")),"al seguir, el premio queda visto y la chapita sube contando hasta 12 puntos");
await p.evaluate(()=>shibuPoll(false));await p.waitForTimeout(500);
ok(!(await p.isVisible("#shibuDlg")),"el premio del mes no se vuelve a celebrar");
// La pestaña «Maids» va junto a Edo; la maid ve su día con Shibu
const tabs=await p.$$eval("#areas [data-area]",l=>l.map(x=>x.dataset.area));
ok(tabs.indexOf("Maids")===tabs.indexOf("Edo")+1,"la pestaña «Maids» está junto a Edo ("+tabs.join(", ")+")");
await p.click('#areas [data-area="Maids"]');await p.waitForTimeout(300);
ok(/Tu día con Shibu/.test(await p.textContent("#areaBody"))&&await p.isVisible("#maidsPerfil")&&await p.isVisible("#maidsTienda")&&await p.isVisible("#maidsJugar")
  &&!(await p.isVisible('#areas [data-area="Maids"] .cnt')),"en «Maids» la maid ve su día con Shibu y entra a su perfil, la tienda o los juegos");
await foto("maids-mesera.png");
await p.click('#areas [data-area="Tokio"]');
// 4) Quien no juega (Gestión le apagó las misiones) no ve la pestaña ni la chapita
await p.evaluate(()=>{const o=window.__R.mis_estado;window.__R.mis_estado=function(a){const r=o(a);r.juega=false;return r;};});
await p.evaluate(()=>shibuPoll(false));await p.waitForTimeout(400);
await p.evaluate(()=>drawTables());await p.waitForTimeout(200);
ok(!(await p.isVisible("#btnShibu"))&&(await p.$$eval("#areas [data-area]",l=>l.map(x=>x.dataset.area))).indexOf("Maids")<0,"quien no juega no ve la chapita ni la pestaña «Maids»");
}catch(e){fallos++;console.log("FALLÓ: "+e.message);}
ok(err.length===0,"sin errores de JavaScript"+(err.length?": "+err.join(" | "):""));
await b.close();srv.close();if(fallos){console.log(fallos+" prueba(s) fallaron");process.exit(1);}console.log("TODAS LAS PRUEBAS DE SHIBU PASARON");})();
