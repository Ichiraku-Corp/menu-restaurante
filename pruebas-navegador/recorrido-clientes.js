// Datos del cliente en la caja: buscador único (teléfono, cédula o nombre), ficha con la tarjeta de puntos y «¿es la misma persona?».
// Uso: node pruebas-navegador/recorrido-clientes.js
"use strict";
const fs=require("fs"),path=require("path"),http=require("http"),{chromium}=require("playwright");
const ROOT=path.join(__dirname,"..");let fallos=0;function ok(c,m){if(c)console.log("ok: "+m);else{fallos++;console.log("FALLÓ: "+m);}}
const T={".html":"text/html; charset=utf-8",".js":"text/javascript",".css":"text/css",".json":"application/json",".svg":"image/svg+xml",".png":"image/png",".webp":"image/webp"};
const srv=http.createServer((q,r)=>{const f=path.join(ROOT,decodeURIComponent(q.url.split("?")[0]));if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end();}r.writeHead(200,{"Content-Type":T[path.extname(f)]||"application/octet-stream"});fs.createReadStream(f).pipe(r);});
(async()=>{await new Promise(r=>srv.listen(8796,r));const b=await chromium.launch();const p=await (await b.newContext({viewport:{width:1000,height:1000}})).newPage();
const err=[];p.on("pageerror",e=>err.push(e.message));p.on("dialog",d=>d.accept());
const menu=fs.readFileSync(path.join(ROOT,"data/menu.json"),"utf8");
await p.route("**/vendor/supabase-js-*/supabase.js",r=>r.fulfill({contentType:"application/javascript",body:"window.__MENU="+menu+";"+fs.readFileSync(path.join(ROOT,"pruebas-navegador/supabase-falso.js"),"utf8")}));
const pin=async(c)=>{for(const k of c)await p.click(`#pad [data-k="${k}"]`);};
const mesa=async(n)=>{await p.click('#areas [data-area="Feria"]');await p.click(`#areaBody [data-table] .num:text-is("${n}")`);await p.waitForSelector("#orderView:not(.hidden)");
  await p.click('#cats button:has-text("Entradas")');await p.click('#dishes button:has-text("Gyozas")');await p.click("#send");await p.waitForTimeout(300);await p.click("#pay");await p.waitForSelector("#cliDlg[open]");};
const volver=async()=>{await p.click("#payCancel").catch(()=>{});await p.click("#back").catch(()=>{});await p.waitForTimeout(200);};
try{
await p.goto("http://localhost:8796/pos.html");await p.fill("#devEmail","a@b.c");await p.fill("#devPass","x");await p.click("#device button");
await pin("2222");await p.waitForSelector("#tablesView:not(.hidden)");await p.waitForTimeout(400);
if(await p.isVisible("#annDlg")) await p.keyboard.press("Escape");
await p.click("#btnCaja");await p.waitForTimeout(200);await p.click("#openCash");await p.waitForTimeout(300);await p.click("#cashClose").catch(()=>{});
// 1) Con el teléfono completo de una clienta conocida: se elige sola y sale su ficha
await mesa("3");
ok(await p.isVisible("#cQ")&&!(await p.isVisible("#cName"))&&await p.isDisabled("#cOk"),"la ventana abre con el buscador (teléfono, cédula o nombre) y sin elegir no deja guardar");
await p.fill("#cQ","0414 123 4567");await p.waitForSelector("#cFicha:not(.hidden)");
const f1=await p.textContent("#cFicha");
ok(/Ana Frecuente/.test(f1)&&/0414 ••• 4567/.test(f1)&&/V-•••678/.test(f1)&&!/1234567/.test(f1.replace("4567","")),"con su teléfono completo aparece su ficha, con el teléfono y la cédula tapados");
ok(/3 visitas/.test(f1)&&/Ref 45,00/.test(f1)&&/Gyozas/.test(f1)&&/2 de 3 sellos/.test(f1)&&/le falta 1/.test(f1)&&(await p.$$("#cFicha .dots i.on")).length===2,"la ficha dice sus visitas, lo gastado, lo que suele pedir y la tarjeta de puntos (2 de 3 sellos)");
await p.click("#cOk");await p.waitForSelector("#payDlg[open]");
ok(await p.evaluate(()=>window.__cliente.p_customer===7&&window.__S.orders.find(x=>x.id===cur.order).client.phone==="04141234567"),"«Guardar y cobrar» la une al pedido sin volver a escribir sus datos y abre el cobro");
await volver();
// 2) Por nombre: lista con los datos tapados; se elige
await mesa("4");
await p.fill("#cQ","ana frec");await p.waitForSelector("#cRes .cres-it");
const l2=await p.textContent("#cRes");
ok(/Ana Frecuente/.test(l2)&&/0414 ••• 4567/.test(l2)&&/3 visitas/.test(l2)&&/registrar cliente nuevo/.test(l2),"por nombre (sin acentos ni mayúsculas) la lista la muestra con sus datos tapados, y la opción de cliente nuevo");
await p.click("#cRes .cres-it");await p.waitForSelector("#cFicha:not(.hidden)");
await p.click('#cFicha [data-cli="cambiar"]');
ok(await p.isVisible("#cQ")&&!(await p.isVisible("#cFicha")),"«Cambiar» vuelve al buscador");
// 3) Cliente nuevo con el teléfono de Ana: pregunta si es la misma persona
await p.fill("#cQ","Anita");await p.waitForSelector("#cRes [data-nuevo]");await p.click("#cRes [data-nuevo]");
await p.fill("#cPhone","0414-123.45.67");await p.click("#cOk");await p.waitForSelector("#cConf:not(.hidden)");
ok(/Ese teléfono ya es de Ana Frecuente/.test(await p.textContent("#cConfTxt"))&&/Ana Frecuente/.test(await p.textContent("#cFicha"))&&!(await p.isVisible('#cFicha [data-cli]')),"si el teléfono ya es de alguien, pregunta «¿es la misma persona?» y muestra su ficha");
await p.click("#cConfSi");await p.waitForSelector("#payDlg[open]");
ok(await p.evaluate(()=>window.__cliente.p_customer===7&&window.__S.clientes.length===1),"«Sí, es la misma persona»: usa a Ana y no crea otra clienta");
await volver();
// 4) Otra persona con el mismo teléfono
await mesa("5");
await p.fill("#cQ","Hermana de Ana");await p.waitForSelector("#cRes [data-nuevo]");await p.click("#cRes [data-nuevo]");
await p.fill("#cPhone","04141234567");await p.click("#cOk");await p.waitForSelector("#cConf:not(.hidden)");
await p.click("#cConfNo");await p.waitForSelector("#payDlg[open]");
ok(await p.evaluate(()=>window.__cliente.p_modo==="nuevo"&&window.__S.clientes.length===2),"«No, es otra persona»: la registra aparte");
await volver();
// 5) Una clienta sin teléfono (del sistema anterior): para cobrar lo pide
await p.evaluate(()=>window.__S.clientes.push({id:8,name:'Beatriz Syth',phone:'',doc_id:'V7654321',email:'',acepta:true,visitas:0}));
await mesa("6");
await p.fill("#cQ","V-7.654.321");await p.waitForSelector("#cRes .cres-it");await p.click("#cRes .cres-it");
ok(await p.isVisible("#cPhone")&&!(await p.isVisible("#cName"))&&/Falta su teléfono/.test(await p.textContent("#cHelp"))&&/sin visitas cobradas/.test(await p.textContent("#cFicha")),"si la clienta no tiene teléfono, la ficha pide solo el teléfono para cobrar");
await p.click("#cOk");await p.waitForTimeout(200);
ok(/teléfono/.test(await p.textContent("#cErr")),"sin el teléfono no deja seguir");
await p.fill("#cPhone","0412 9998877");await p.click("#cOk");await p.waitForSelector("#payDlg[open]");
ok(await p.evaluate(()=>window.__cliente.p_customer===8&&window.__S.clientes.find(c=>c.id===8).phone==="04129998877"),"con el teléfono la guarda en su ficha y cobra");
await volver();
// 6) El pedido que ya tiene cliente abre directo su ficha
await p.click('#areas [data-area="Feria"]');await p.click('#areaBody [data-table] .num:text-is("6")');await p.waitForSelector("#orderView:not(.hidden)");
await p.click("#btnClient");await p.waitForSelector("#cFicha:not(.hidden)");
ok(/Beatriz Syth/.test(await p.textContent("#cFicha"))&&!(await p.isVisible("#cQ")),"si el pedido ya tiene cliente, la ventana abre con su ficha");
await p.click('#cFicha [data-cli="corregir"]');
ok(await p.isVisible("#cName")&&await p.isVisible("#cDoc")&&/vacío/.test(await p.getAttribute("#cPhone","placeholder")),"«Corregir sus datos» muestra los campos: lo que quede vacío se mantiene");
await p.click("#cCancel");
// 7) Actualización automática: con una versión nueva avisa; con algo a medio hacer no se recarga; en el PIN, sí
const html=fs.readFileSync(path.join(ROOT,"pos.html"),"utf8").replace(/pos-base\.js\?v=[0-9a-f]+/,"pos-base.js?v=0000000000");
await p.route(/pos\.html\?act=/,r=>r.fulfill({contentType:"text/html; charset=utf-8",body:html}));
await p.evaluate(()=>actRevisar());await p.waitForSelector("#actAviso");
ok(/versión nueva/.test(await p.textContent("#actAviso")),"si hay una versión nueva, avisa que se actualiza sola en un momento libre");
await p.click("#btnClient");await p.waitForSelector("#cliDlg[open]");
await p.evaluate(()=>{ACT.toque=0;actQuizas();});await p.waitForTimeout(300);
ok(await p.isVisible("#cliDlg"),"con una ventana abierta no se recarga");
await p.click("#cCancel");
await p.evaluate(()=>lock());await p.waitForTimeout(200);
await Promise.all([p.waitForURL(/pos\.html\?act=/,{timeout:5000}),p.evaluate(()=>{ACT.toque=0;actQuizas();})]);
await p.waitForLoadState("load");
ok(/act=/.test(p.url()),"en la pantalla del PIN y sin tocarla se recarga sola con la versión nueva");
}catch(e){fallos++;console.log("FALLÓ: "+e.message.split("\n")[0]);}
ok(err.length===0,"sin errores de JavaScript"+(err.length?": "+err.join(" | "):""));
await b.close();srv.close();if(fallos){console.log(fallos+" prueba(s) fallaron");process.exit(1);}console.log("TODAS LAS PRUEBAS DE CLIENTES EN LA CAJA PASARON");})();
