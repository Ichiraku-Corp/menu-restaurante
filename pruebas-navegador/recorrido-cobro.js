// Cobro en varios pases: «pasa 5.000 aquí y 5.000 en la otra» cuadra al céntimo en bolívares.
// Uso: node pruebas-navegador/recorrido-cobro.js
"use strict";
const fs=require("fs"),path=require("path"),http=require("http"),{chromium}=require("playwright");
const ROOT=path.join(__dirname,"..");let fallos=0;function ok(c,m){if(c)console.log("ok: "+m);else{fallos++;console.log("FALLÓ: "+m);}}
const T={".html":"text/html; charset=utf-8",".js":"text/javascript",".css":"text/css",".json":"application/json",".svg":"image/svg+xml",".png":"image/png",".webp":"image/webp"};
const srv=http.createServer((q,r)=>{const f=path.join(ROOT,decodeURIComponent(q.url.split("?")[0]));if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end();}r.writeHead(200,{"Content-Type":T[path.extname(f)]||"application/octet-stream"});fs.createReadStream(f).pipe(r);});
(async()=>{await new Promise(r=>srv.listen(8795,r));const b=await chromium.launch();const p=await (await b.newContext({viewport:{width:1000,height:1000}})).newPage();
const err=[];p.on("pageerror",e=>err.push(e.message));p.on("dialog",d=>d.accept());
const menu=fs.readFileSync(path.join(ROOT,"data/menu.json"),"utf8");
await p.route("**/vendor/supabase-js-*/supabase.js",r=>r.fulfill({contentType:"application/javascript",body:"window.__MENU="+menu+";"+fs.readFileSync(path.join(ROOT,"pruebas-navegador/supabase-falso.js"),"utf8")}));
const pin=async(e,c)=>{await p.click(`#people [data-emp="${e}"]`);for(const k of c)await p.click(`#pad [data-k="${k}"]`);};
await p.goto("http://localhost:8795/pos.html");await p.fill("#devEmail","a@b.c");await p.fill("#devPass","x");await p.click("#device button");
await pin(2,"2222");await p.waitForSelector("#tablesView:not(.hidden)");await p.waitForTimeout(400);
if(await p.isVisible("#annDlg")) await p.keyboard.press("Escape");
await p.click("#btnCaja");await p.waitForTimeout(200);await p.click("#openCash");await p.waitForTimeout(300);await p.click("#cashClose").catch(()=>{});
await p.click('#areas [data-area="Feria"]');await p.click('#areaBody [data-table] .num:text-is("2")');await p.waitForSelector("#orderView:not(.hidden)");
await p.click('#cats button:has-text("Entradas")');await p.click('#dishes button:has-text("Gyozas")');await p.click("#send");await p.waitForTimeout(300);
await p.click("#pay");await p.waitForTimeout(300);await p.click('#payMethods [data-m="punto_debito"]');
const full=await p.inputValue("#payLines .amt");const half=(Number(full)/2).toFixed(2);
await p.fill("#payLines .amt",half);await p.locator("#payLines .amt").dispatchEvent("input");
const a1=await p.textContent("#payLines [data-after]");
await p.click("#payLines [data-again]");await p.waitForTimeout(200);
const v2=await p.locator("#payLines .amt").nth(1).inputValue();const a2=await p.locator("#payLines [data-after]").nth(1).textContent();
ok(/^Quedan Bs 144,37/.test(a1),"después del primer pase dice cuánto queda en Bs ("+a1+")");
ok(v2==="144.37"&&Number(half)+Number(v2)===Number(full),"«+ Otro pase» pone exactamente lo que falta en Bs: "+half+" + "+v2+" = "+full);
ok(a2==="Cubre todo ✓"&&(await p.textContent("#payRest"))==="✓","con los dos pases la cuenta queda completa");
await p.click("#payOk");await p.waitForTimeout(400);
ok(await p.evaluate(()=>window.__S.payments.filter(x=>x.method==="punto_debito").length===2),"se registran los dos pases de punto");
// En la tablet (1280×700): con un billete grande aparece «¿Cómo le das el vuelto?» (el pie crece) y el pago sigue a la vista
await p.setViewportSize({width:1280,height:700});
await p.click('#areas [data-area="Feria"]');await p.click('#areaBody [data-table] .num:text-is("4")');await p.waitForSelector("#orderView:not(.hidden)");
await p.click('#cats button:has-text("Entradas")');await p.click('#dishes button:has-text("Gyozas")');await p.click("#send");await p.waitForTimeout(300);
await p.click("#pay");await p.waitForTimeout(300);await p.click('#payMethods [data-m="efectivo_usd"]');await p.waitForTimeout(200);
const sinVuelto=await p.isHidden("#changeBox");
await p.$eval('#payLines [data-bill="20"]',x=>x.click());await p.waitForTimeout(250);
const vis=await p.evaluate(()=>{const l=document.querySelector("#payLines .pay").getBoundingClientRect(),f=document.querySelector("#payDlg .payfoot").getBoundingClientRect();return l.bottom<=f.top+1;});
ok(sinVuelto&&await p.isVisible("#changeBox")&&vis,"en la tablet, al aparecer «¿Cómo le das el vuelto?» el pago sigue a la vista (no lo tapa el pie)");
await p.click("#payCancel");
// Promoción de hoy (Gestión): la caja muestra el precio con la promo y el servidor lo cobra así
await p.evaluate(()=>{window.__PROMOS=[{name:"Happy hour",percent:20,start:"00:00",end:"23:59",dish_ids:[],category_ids:[1]}];loadPromos();});
await p.click("#back");await p.waitForTimeout(300);
await p.click('#areas [data-area="Feria"]');await p.click('#areaBody [data-table] .num:text-is("5")');await p.waitForSelector("#orderView:not(.hidden)");
await p.click('#cats button:has-text("Entradas")');await p.waitForTimeout(150);
ok(/Happy hour -20 %/.test(await p.textContent('#dishes button:has-text("Gyozas")'))&&/Ref 4,00/.test(await p.textContent('#dishes button:has-text("Gyozas")')),"el plato en promoción lo dice y muestra el precio con la promo (Ref 5 → Ref 4)");
await p.click('#dishes button:has-text("Gyozas")');
ok(/Happy hour -20 %/.test(await p.textContent("#lines .line.new"))&&/Ref 4,00/.test(await p.textContent("#lines .line.new")),"antes de enviar, la cuenta ya muestra el precio con la promo");
await p.click("#send");await p.waitForTimeout(400);
ok(await p.evaluate(()=>{const i=window.__S.items.filter(x=>x.name==="Gyozas").pop();return i.unit_price===4&&i.promo==="Happy hour -20 %";})&&/Happy hour -20 %/.test(await p.textContent("#lines")),"al enviar queda cobrado con la promo y la línea lo dice");
await p.evaluate(()=>{window.__PROMOS=[];loadPromos();});
ok(err.length===0,"sin errores de JavaScript"+(err.length?": "+err.join(" | "):""));
await b.close();srv.close();if(fallos){console.log(fallos+" prueba(s) fallaron");process.exit(1);}console.log("TODAS LAS PRUEBAS DE COBRO EN VARIOS PASES PASARON");})();
