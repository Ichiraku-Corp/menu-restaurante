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
await p.click('#cats button:has-text("Entradas")');await p.click('#dishes button:has-text("Gyozas")');await p.click("#dishAdd");await p.click("#send");await p.waitForTimeout(300);
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
ok(err.length===0,"sin errores de JavaScript"+(err.length?": "+err.join(" | "):""));
await b.close();srv.close();if(fallos){console.log(fallos+" prueba(s) fallaron");process.exit(1);}console.log("TODAS LAS PRUEBAS DE COBRO EN VARIOS PASES PASARON");})();
