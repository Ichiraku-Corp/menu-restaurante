// Fallas forzadas de Shibu en la tablet (revisión del 25/11): si las misiones, la máquina o los juegos fallan o no
// contestan, la tablet sigue tomando pedidos. Nada queda trabado, la máquina se libera sola y la maid que entra no
// hereda lo que quedó a medias de la anterior.
// Uso: node pruebas-navegador/recorrido-shibu-fallas.js
"use strict";
const fs=require("fs"),path=require("path"),http=require("http"),{chromium}=require("playwright");
const ROOT=path.join(__dirname,"..");let fallos=0;function ok(c,m){if(c)console.log("ok: "+m);else{fallos++;console.log("FALLÓ: "+m);}}
const T={".html":"text/html; charset=utf-8",".js":"text/javascript",".css":"text/css",".json":"application/json",".svg":"image/svg+xml",".png":"image/png",".webp":"image/webp",".woff2":"font/woff2"};
const srv=http.createServer((q,r)=>{const f=path.join(ROOT,decodeURIComponent(q.url.split("?")[0]));if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end();}r.writeHead(200,{"Content-Type":T[path.extname(f)]||"application/octet-stream"});fs.createReadStream(f).pipe(r);});
// Las mismas funciones falsas de misiones, tienda y comodines que usa recorrido-shibu.js
const FALSO_MIS=(fs.readFileSync(path.join(__dirname,"recorrido-shibu.js"),"utf8").match(/const FALSO_MIS=`([\s\S]*?)`;\n/)||[])[1];
if(!FALSO_MIS){console.log("FALLÓ: no encontré las funciones falsas de recorrido-shibu.js");process.exit(1);}
(async()=>{await new Promise(r=>srv.listen(8797,r));const b=await chromium.launch();const p=await (await b.newContext({viewport:{width:1280,height:800}})).newPage();
const err=[];p.on("pageerror",e=>err.push(e.message));p.on("dialog",d=>d.accept());
const menu=fs.readFileSync(path.join(ROOT,"data/menu.json"),"utf8");
await p.route("**/vendor/supabase-js-*/supabase.js",r=>r.fulfill({contentType:"application/javascript",body:"window.__MENU="+menu+";"+fs.readFileSync(path.join(ROOT,"pruebas-navegador/supabase-falso.js"),"utf8")+"\n"+FALSO_MIS}));
const pin=async c=>{for(const k of c)await p.click(`#pad [data-k="${k}"]`);};
// Falla a pedido solo en las funciones que digan: «error» (como sin internet), «cuelga» (nunca contesta) o «lento» (1,2 s)
const falla=(re,modo)=>p.evaluate(([re,modo])=>{
  if(!window.__rpcOrig){window.__rpcOrig=sb.rpc.bind(sb);sb.rpc=function(n,a){const f=window.__FALLA;
    if(f&&new RegExp(f.re).test(n)){if(f.modo==="cuelga")return new Promise(function(){});
      if(f.modo==="lento")return new Promise(function(r){setTimeout(function(){r(window.__rpcOrig(n,a));},1200);});
      return Promise.resolve({data:null,error:{message:"TypeError: Failed to fetch"}});}
    return window.__rpcOrig(n,a);};}
  window.__FALLA=re?{re:re,modo:modo}:null;},[re,modo]);
const saludo=async()=>{if(await p.waitForSelector("#shibuDlg[open]",{timeout:6000}).then(()=>true,()=>false)){await p.waitForTimeout(300);await p.click("#shibuOk");await p.waitForTimeout(400);}};
const entra=async c=>{await pin(c);await p.waitForSelector("#tablesView:not(.hidden)");await p.waitForTimeout(300);if(await p.isVisible("#annDlg"))await p.keyboard.press("Escape");};
const mantener=async()=>{await p.hover("#vmComprar");await p.mouse.down();await p.waitForTimeout(1500);await p.mouse.up();};
const abreMaquina=async()=>{await p.click("#btnShibu");await p.waitForSelector("#perfilDlg[open]");await p.click('#perfilLado [data-hub="tienda"]');await p.waitForSelector("#perfilBody .vm");await p.waitForTimeout(400);};
try{
await p.goto("http://localhost:8797/pos.html");await p.fill("#devEmail","a@b.c");await p.fill("#devPass","x");await p.click("#device button");
await entra("1111");await saludo();
// 1) Las misiones dejan de contestar: la tablet sigue igual
await falla("^(mis_|com_|tienda_|jgo_)","error");
await p.evaluate(()=>shibuPoll(false));await p.waitForTimeout(600);
ok(await p.isVisible("#btnShibu")&&!(await p.isVisible("#shibuDlg"))&&err.length===0,"si las misiones no responden, la tablet sigue igual: sin ventanas, sin errores y con el botón «Mi perfil»");
// 2) Una compra sin internet: no se sabe si llegó, así que la máquina lo revisa en la base antes de dejar comprar otra vez
await falla(null);await abreMaquina();
await p.click('#vmSlots .vm-slot[data-i="0"]');await p.waitForTimeout(200);
await falla("^tienda_canjear$","error");await mantener();
await p.waitForFunction(()=>/NO SE COMPRÓ/.test(document.getElementById("vmMsg").textContent),null,{timeout:4000}).catch(()=>{});
ok(/NO SE COMPRÓ · PUEDES INTENTAR DE NUEVO/.test(await p.textContent("#vmMsg"))&&await p.evaluate(()=>!VM.ocupada&&!VM.revisando),
  "si la compra se corta, la máquina revisa en la base si llegó y dice «no se compró» (sin cobrar dos veces)");
// 3) Una compra que nunca contesta: al rato la máquina se libera y Mi perfil se puede cerrar
await p.evaluate(()=>{VM_ESPERA_MS=1500;});
await falla("^tienda_canjear$","cuelga");
await p.click('#vmSlots .vm-slot[data-i="0"]');await p.waitForTimeout(200);await mantener();
ok(await p.evaluate(()=>VM.ocupada),"mientras espera la respuesta, la máquina está ocupada");
await p.waitForTimeout(1800);
await p.waitForFunction(()=>/SE COMPRÓ/.test(document.getElementById("vmMsg").textContent),null,{timeout:4000}).catch(()=>{});
ok(await p.evaluate(()=>!VM.ocupada)&&/NO SE COMPRÓ/.test(await p.textContent("#vmMsg")),"si la base no contesta, a los segundos la máquina se libera y revisa si la compra llegó");
await p.click("#perfilClose");await p.waitForTimeout(300);
ok(!(await p.isVisible("#perfilDlg")),"y Mi perfil se cierra para seguir trabajando");
// 4) Sale la maid con una compra colgada: la que entra encuentra todo libre
await p.evaluate(()=>{VM_ESPERA_MS=60000;});await falla(null);await abreMaquina();
await p.click('#vmSlots .vm-slot[data-i="0"]');await p.waitForTimeout(200);
await falla("^tienda_canjear$","cuelga");await mantener();
ok(await p.evaluate(()=>VM.ocupada),"la compra quedó esperando");
await p.evaluate(()=>{const d=document.getElementById("perfilDlg");if(d.open)d.close();lock();});await p.waitForTimeout(300);
await falla(null);await entra("2222");await saludo();
ok(await p.evaluate(()=>!VM.ocupada&&VM.sel==null),"si sale con una compra colgada, la que entra encuentra la máquina libre");
await p.click("#btnShibu");await p.waitForTimeout(500);
ok(await p.isVisible("#perfilDlg")&&/Cajera/.test(await p.textContent("#perfilLado")),"y abre su propio Mi perfil");
await p.click("#perfilClose");await p.waitForTimeout(300);
// 4b) Una respuesta atrasada de la maid que salió no se le muestra a nadie
await falla("^mis_estado$","lento");
await p.click("#btnShibu");await p.waitForTimeout(100);
await p.evaluate(()=>{const d=document.getElementById("perfilDlg");if(d.open)d.close();lock();});
await p.waitForTimeout(1500);
ok(await p.evaluate(()=>!SHIBU.est&&document.getElementById("btnShibu").classList.contains("hidden")),"lo que contesta tarde de la maid que salió no aparece en la pantalla del PIN");
await falla(null);await entra("2222");await saludo();
ok(await p.evaluate(()=>SHIBU.est&&SHIBU.est.nombre==="Cajera"),"y la que entra ve lo suyo");
// 4c) Una celebración no tapa un pedido: espera a que vuelva al mapa de mesas
await p.click('#areas [data-area="Feria"]');await p.click('#areaBody [data-table] .num:text-is("2")');await p.waitForSelector("#orderView:not(.hidden)");
await p.evaluate(()=>{window.__MIS.nuevos[2]=[{id:77,nivel:1,texto:'Vende 3 postres',puntos:1}];window.__MIS.puntos[2]+=1;shibuPoll(false);});
await p.waitForTimeout(3500);
ok(!(await p.isVisible("#shibuDlg")),"mientras toma un pedido, la celebración espera (no tapa la cuenta)");
await p.evaluate(()=>goTables());
await p.waitForSelector("#shibuDlg[open] .shibu-fiesta",{timeout:6000}).catch(()=>{});
ok(await p.isVisible("#shibuDlg"),"de vuelta en el mapa de mesas, Shibu celebra");
await p.click("#shibuOk");await p.waitForTimeout(600);
ok(await p.evaluate(()=>getComputedStyle(document.getElementById("shibuAvisos")||document.body).pointerEvents==="none"||!document.getElementById("shibuAvisos")),
  "los avisos de avance no se pueden tocar: nunca tapan un botón");
// 5) Con todo lo de Shibu caído, el pedido sale a cocina igual
await falla("^(mis_|com_|tienda_|jgo_)","error");
await p.click('#areas [data-area="Feria"]');await p.click('#areaBody [data-table] .num:text-is("3")');await p.waitForSelector("#orderView:not(.hidden)");
await p.click('#cats button:has-text("Entradas")');await p.click('#dishes button:has-text("Gyozas")');
await p.click("#send");await p.waitForTimeout(700);
ok(/Enviado a cocina/.test(await p.textContent("#toast")),"con las misiones caídas, el pedido sale a cocina igual («"+(await p.textContent("#toast"))+"»)");
await p.waitForTimeout(3000);   // el aviso rápido de Shibu (shibuPronto) también falla, sin molestar
ok(!(await p.isVisible("#shibuDlg"))&&err.length===0,"el aviso rápido de Shibu después de enviar falla en silencio");
// 6) Los juegos que no contestan se pueden cerrar
await falla("^jgo_","cuelga");await p.evaluate(()=>abrirJuegos());await p.waitForSelector("#jgoDlg[open]");await p.waitForTimeout(500);
await p.click("#jgoCerrar");await p.waitForTimeout(300);
ok(!(await p.isVisible("#jgoDlg")),"si los juegos no contestan, se cierran igual");
ok(err.length===0,"sin errores de JavaScript"+(err.length?" ("+err.join(" | ")+")":""));
}catch(e){fallos++;console.log("FALLÓ: "+e.message);}
await b.close();srv.close();
if(fallos){console.log(fallos+" prueba(s) fallaron");process.exit(1);}
console.log("TODAS LAS PRUEBAS DE FALLAS DE SHIBU PASARON");
})();
