// Misiones de Shibu en la tablet: bienvenida del día, celebración, Mi perfil con la tienda (compra directa) y la pestaña «Maids».
// Uso: node pruebas-navegador/recorrido-shibu.js   (CAPTURA_SHIBU=carpeta guarda capturas a 1280×800)
"use strict";
const fs=require("fs"),path=require("path"),http=require("http"),{chromium}=require("playwright");
const ROOT=path.join(__dirname,"..");let fallos=0;function ok(c,m){if(c)console.log("ok: "+m);else{fallos++;console.log("FALLÓ: "+m);}}
const T={".html":"text/html; charset=utf-8",".js":"text/javascript",".css":"text/css",".json":"application/json",".svg":"image/svg+xml",".png":"image/png",".webp":"image/webp",".woff2":"font/woff2"};
const srv=http.createServer((q,r)=>{const f=path.join(ROOT,decodeURIComponent(q.url.split("?")[0]));if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end();}r.writeHead(200,{"Content-Type":T[path.extname(f)]||"application/octet-stream"});fs.createReadStream(f).pipe(r);});
const CAP=process.env.CAPTURA_SHIBU||"";if(CAP)fs.mkdirSync(CAP,{recursive:true});
// Las funciones de misiones y tienda, falsas, con estado en window.__MIS (la base de verdad se prueba en supabase/pruebas/99-misiones.sql)
const FALSO_MIS=`(function(){ var R=window.__R,S=window.__S;
  var M=window.__MIS={saludo:{},nuevos:{},puntos:{1:8,2:12},fichas:{1:1,2:0},canjes:[],marcar:[],seq:50,
    misiones:[{nivel:1,texto:'Vende 3 postres',puntos:1,tipo:'unidades',actual:1,meta:3,hecha:false},
              {nivel:2,texto:'Comanda promedio de $18 o más (mínimo 8 comandas)',puntos:2,tipo:'promedio',actual:14.5,meta:18,hecha:false},
              {nivel:3,texto:'Equipo: el local pasa la meta del día por 20 %',puntos:3,tipo:'equipo_meta',actual:310,meta:540,hecha:false,equipo:true},
              {nivel:0,extra:true,texto:'Vende 3 artículos de la tienda del menú',puntos:1,tipo:'unidades',actual:1,meta:3,hecha:false}],
    tienda:[{id:1,nombre:'Refresco',puntos:6},{id:2,nombre:'Taiyaki',puntos:7},{id:3,nombre:'Amaterasu',puntos:10}]};
  function quien(a){ var e=S.staff.find(function(x){return x.id===a.p_emp}); if(!e||e.pin!==a.p_pin) throw {message:'PIN incorrecto. Vuelve a entrar.'}; return e; }
  R.mis_estado=function(a){ var e=quien(a); return {juega:true,activo:true,fecha:'2026-11-24',tipo_dia:'normales',nombre:e.name,saludo_hoy:!!M.saludo[e.id],
    misiones:M.misiones,nuevos:M.nuevos[e.id]||[],puntos:M.puntos[e.id]||0,fichas:M.fichas[e.id]||0,tienda:M.tienda,
    canjes:M.canjes.filter(function(c){return c.emp===e.id;}),juegos:{activo:true,tope_dia:3,ganado_hoy:0}}; };
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
await foto("bienvenida.png");
await p.click("#shibuOk");await p.waitForTimeout(300);
ok((await M()).marcar.some(x=>x.emp===1&&x.saludo===true),"al cerrar, la base anota que ya la saludó hoy");
ok(await p.isVisible("#btnShibu")&&/★ 0\/4/.test(await p.textContent("#btnShibu"))&&/8 pts/.test(await p.textContent("#btnShibu")),"arriba queda la chapita de Shibu con su avance y sus puntos");
// 2) Al cumplir una misión, Shibu celebra (una sola vez)
await p.evaluate(()=>{window.__MIS.misiones[0].hecha=true;window.__MIS.misiones[0].actual=3;window.__MIS.nuevos[1]=[{id:9,nivel:1,texto:'Vende 3 postres',puntos:1}];window.__MIS.puntos[1]=9;window.__MIS.fichas[1]=2;});
await p.evaluate(()=>shibuPoll(false));await p.waitForSelector("#shibuDlg[open] .shibu-fiesta",{timeout:4000});await p.waitForTimeout(1600);
ok(/¡Misión cumplida!/.test(await p.textContent("#shibuBody"))&&/\+1\s*punto · \+1\s*ficha/.test(await p.textContent(".fiesta-premio")),"al cumplir una misión sale Shibu celebrando con sus puntos y su ficha");
ok(fr.mision.indexOf(await p.textContent("#shibuTxt"))>=0,"la frase de la celebración también sale del archivo de frases");
await foto("celebracion.png");
await p.click("#shibuOk");await p.waitForTimeout(300);
ok((await M()).marcar.some(x=>x.emp===1&&x.logros&&x.logros[0]===9)&&/★ 1\/4/.test(await p.textContent("#btnShibu")),"la celebración se marca como vista y la chapita sube a 1/4");
await p.evaluate(()=>shibuPoll(false));await p.waitForTimeout(400);
ok(!(await p.isVisible("#shibuDlg")),"no vuelve a celebrar la misma misión");
// 3) Mi perfil: puntos, fichas, misiones y tienda; canjea lo que le alcanza
await p.click("#btnShibu");await p.waitForSelector("#perfilDlg[open]");await p.waitForTimeout(1000);
const cards=p.locator("#perfilBody .premio-card");
ok(await cards.count()===3&&await p.isEnabled('#perfilBody [data-canje="2"]')&&await p.isDisabled('#perfilBody [data-canje="3"]')&&/Te faltan 1/.test(await p.textContent('#perfilBody [data-canje="3"]')),
  "en la tienda se canjea lo que le alcanza (9 puntos: Taiyaki sí, Amaterasu le faltan 1)");
await foto("perfil.png");
// Comprar pregunta antes (no tiene vuelta atrás) y Shibu entrega el premio con una frase suya: sale a cocina sin esperar a nadie
let pregunta="";p.once("dialog",d=>{pregunta=d.message();});
await p.click('#perfilBody [data-canje="2"]');
await p.waitForSelector("#shibuDlg[open] .shibu-fiesta",{timeout:4000});await p.waitForTimeout(1800);
ok(/¿Comprar Taiyaki por 7 puntos\? Sale a cocina de una vez\./.test(pregunta),"antes de comprar pregunta: «"+pregunta+"»");
ok((await M()).canjes.length===1&&(await M()).canjes[0].estado==="entregado"&&/¡Premio comprado!/.test(await p.textContent("#shibuBody"))&&/Taiyaki va a cocina/.test(await p.textContent("#shibuBody")),
  "al comprar, el premio sale a cocina de una vez (sin esperar a la cajera)");
ok(fr.canje_aprobado.indexOf(await p.textContent("#shibuTxt"))>=0,"Shibu lo entrega con una frase de data/shibu.json: «"+(await p.textContent("#shibuTxt"))+"»");
await foto("premio.png");
await p.click("#shibuOk");await p.waitForTimeout(400);
ok(await p.isVisible("#perfilDlg")&&/2 puntos/.test(await p.textContent("#perfilBody .perfil-saldos"))&&/Taiyaki · 7 pts\s*A cocina/.test(await p.textContent("#perfilBody")),
  "vuelve a su perfil: sus puntos bajan y en «Mis premios» sale «A cocina»");
await p.click("#perfilClose");await p.waitForTimeout(200);
// La pestaña «Maids» va junto a Edo; la maid ve su día con Shibu
const tabs=await p.$$eval("#areas [data-area]",l=>l.map(x=>x.dataset.area));
ok(tabs.indexOf("Maids")===tabs.indexOf("Edo")+1,"la pestaña «Maids» está junto a Edo ("+tabs.join(", ")+")");
await p.click('#areas [data-area="Maids"]');await p.waitForTimeout(300);
ok(/Tu día con Shibu/.test(await p.textContent("#areaBody"))&&await p.isVisible("#maidsPerfil")&&await p.isVisible("#maidsJugar")&&!(await p.isVisible('#areas [data-area="Maids"] .cnt')),
  "en «Maids» la maid ve su día con Shibu, su perfil con la tienda y «Jugar» (sin nada que esperar)");
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
