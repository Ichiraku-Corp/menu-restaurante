// Recorre Gestión en un navegador real con un Supabase falso (gestion-falso.js).
// Uso: node pruebas-navegador/recorrido-gestion.js   (necesita Playwright y Chromium)
"use strict";
const fs = require("fs");
const path = require("path");
const http = require("http");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp" };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
});

let fallos = 0;
function ok(cond, msg) { if (cond) console.log("ok: " + msg); else { fallos++; console.log("FALLÓ: " + msg); } }

(async () => {
  await new Promise((r) => server.listen(8798, r));
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true })).newPage();
  const errores = [];
  page.on("pageerror", (e) => errores.push(e.message));
  page.on("dialog", (d) => d.accept().catch(() => {}));
  const menu = fs.readFileSync(path.join(ROOT, "data", "menu.json"), "utf8");
  await page.route("**/vendor/supabase-js-*/supabase.js", (r) => r.fulfill({ contentType: "application/javascript",
    body: "window.__MENU=" + menu + ";" + fs.readFileSync(path.join(__dirname, "gestion-falso.js"), "utf8") }));
  await page.route("**/vendor/sentry-*/**", (r) => r.fulfill({ contentType: "application/javascript", body: "" }));

  try {
    await page.goto("http://localhost:8798/gestion.html");
    await page.waitForSelector("#app:not(.hidden)", { timeout: 8000 });
    ok(true, "entra a Gestión (sesión verificada)");

    // Cargar datos: plantilla, pegar desde Excel, revisar y cargar
    // Entra por «Inicio» y navega por secciones
    ok(await page.isVisible('#secs [data-sec="inicio"].on') && await page.isVisible("#iniKpis") && !(await page.isVisible("#tabs")), "Gestión abre en «Inicio», sin la fila de pestañas");
    ok(/Ventas de hoy/.test(await page.textContent("#iniKpis")) && /Laptop de caja/.test(await page.textContent("#iniEstado")), "Inicio muestra ventas de hoy y el estado de la laptop");
    await page.waitForSelector("#iniMeta:not([hidden])", { timeout: 3000 }).catch(() => {});
    const ini = await page.textContent("#iniMeta");
    ok(/Meta de hoy/.test(ini) && /Ref 320,45 de Ref 620,00 · 52 %/.test(ini) && /Faltan Ref 299,55/.test(ini) && /promedio de los últimos 8 (lunes|martes|miércoles|jueves|viernes|sábados|domingos) \(Ref 617,94\)/.test(ini),
      "Inicio muestra la meta del día: lo cobrado, la meta, cuánto falta y de dónde sale");
    // Ventas por hora y día (Dinero › Histórico)
    await page.click('#secs [data-sec="dinero"]'); await page.click('#tabs [data-tab="historico"]');
    await page.waitForSelector("#vhMap .vh-grid", { timeout: 5000 });
    const vh = await page.evaluate(() => ({ celdas: document.querySelectorAll("#vhMap .vh-grid .c").length, fuerte: document.querySelectorAll("#vhMap .vh-grid .c.l5").length,
      top: document.querySelector("#vhMap .vh-top li").textContent, horas: [...document.querySelectorAll("#vhMap .vh-grid .hd")].map((x) => x.textContent).join(",") }));
    ok(vh.celdas === 7 * 10 && vh.horas === "12,13,14,15,16,17,18,19,20,21", "el mapa tiene los 7 días y las horas con ventas (12 a 21)");
    ok(/^Sábado 13:00 · Ref 85,20 · 6,5 pedidos$/.test(vh.top) && vh.fuerte >= 1, "la hora más fuerte sale primera y en el tono más oscuro (" + vh.top + ")");
    await page.hover('#vhMap .c[data-k="6-13"]');
    ok(/Sábado 13:00 a 14:00[\s\S]*Ref 85,20 de promedio[\s\S]*8 sábados con ventas/.test(await page.textContent("#vhMap .tip")), "al pasar o tocar un cuadro dice el promedio, los pedidos y cuántos días cuenta");
    await page.click('#vhWeeks [data-w="4"]'); await page.waitForTimeout(300);
    ok(await page.evaluate(() => window.__G.calls.filter((c) => c.rpc === "gestion_ventas_hora").pop().args.p_weeks) === 4, "se puede ver el promedio de 4 semanas");
    // Promociones (Clientes › Promociones)
    await page.click('#secs [data-sec="clientes"]'); await page.click('#tabs [data-tab="promos"]'); await page.waitForTimeout(200);
    ok(/Happy hour[\s\S]*20 %[\s\S]*Lun · Mar · Mié · Jue[\s\S]*3:00 p\. m\. a 6:00 p\. m\./.test(await page.textContent("#promoList")), "Promociones muestra la de happy hour con días y horario");
    await page.click("#addPromo"); await page.waitForSelector("#dlg[open]");
    await page.fill("#f_name", "Martes de ramen"); await page.fill("#f_percent", "15");
    await page.locator("#prDays input").evaluateAll((l) => l.forEach((i) => { i.checked = i.value === "2"; }));
    await page.click('#dlgForm button[type="submit"]'); await page.waitForTimeout(200);
    ok(/categorías o los platos/.test(await page.textContent("#dlgErr")), "pide elegir a qué platos o categorías aplica");
    await page.fill("#prDishQ", "gyo"); await page.waitForTimeout(100);
    ok(await page.locator("#prDishes label:not([hidden])").count() === 1, "el buscador de platos filtra la lista");
    await page.locator("#prDishes label:not([hidden]) input").check();
    await page.click('#dlgForm button[type="submit"]'); await page.waitForTimeout(300);
    const pg = await page.evaluate(() => window.__G.calls.filter((c) => c.rpc === "gestion_promo_guardar").pop());
    ok(pg && pg.args.p.name === "Martes de ramen" && pg.args.p.percent === 15 && JSON.stringify(pg.args.p.days) === "[2]" && pg.args.p.dish_ids.length === 1 && pg.args.p.start_time === "15:00",
      "guarda la promoción con nombre, %, días, horario y platos");
    // Alertas al correo (Dinero › Ventas › Ajustes)
    await page.click('#secs [data-sec="dinero"]'); await page.click('#tabs [data-tab="ventas"]'); await page.waitForTimeout(200);
    ok(await page.isVisible("#sAlerts") && (await page.inputValue("#sAlertDiff")) === "5", "Ajustes tiene los correos de alertas y desde cuánto avisa un cierre (Ref 5)");
    await page.fill("#sAlerts", "dueno@ejemplo.test"); await page.fill("#sAlertDiff", "15"); await page.fill("#sMetaPct", "10"); await page.click("#saveSettings"); await page.waitForTimeout(300);
    ok(await page.evaluate(() => window.__G.calls.some((c) => c.table === "gestion_settings" && c.op === "update" && c.value.alert_emails === "dueno@ejemplo.test" && c.value.alert_cash_diff === 15)),
      "guarda a quién le llegan las alertas y el límite del cierre");
    ok(await page.evaluate(() => window.__G.calls.some((c) => c.table === "gestion_settings" && c.op === "update" && c.value.meta_pct === 10)), "guarda la meta del día como «promedio + 10 %»");
    // Facturas de la caja (Dinero › Gastos)
    await page.click('#tabs [data-tab="gastos"]'); await page.waitForSelector("#facList [data-fac]", { timeout: 5000 });
    ok(/Salida de caja[\s\S]*Compra de hielo · \$ 5,00/.test(await page.textContent("#facList")) && /Agua \(botella\) 12 unidades/.test(await page.textContent("#facList")), "Gastos muestra las facturas de la caja: salida con motivo y mercancía");
    await page.click('#facList [data-fac="1"]'); await page.waitForSelector("#facDlg[open]", { timeout: 3000 });
    ok(await page.evaluate(() => { const c = window.__G.calls.filter((x) => x.storage).pop(); return c.storage === "facturas" && c.path === "2026-11/0123456789abcdef0123456789abcdef.jpg" && c.secs === 300; }) &&
       /^data:image/.test(await page.getAttribute("#facImg", "src")), "«Ver foto» abre la factura con un enlace privado que vence en 5 minutos");
    await page.click("#facClose");
    // Excel para el contador (Dinero › Ventas): un .xlsx con resumen, ventas por día, cobros, gastos y nómina
    await page.click('#secs [data-sec="dinero"]'); await page.click('#tabs [data-tab="ventas"]'); await page.waitForTimeout(200);
    const [dlx] = await Promise.all([page.waitForEvent("download", { timeout: 8000 }), page.click("#xlsContador")]);
    const xb = fs.readFileSync(await dlx.path()), X = {};
    for (let i = 0; xb.readUInt32LE(i) === 0x04034b50;) {
      const sz = xb.readUInt32LE(i + 18), nl = xb.readUInt16LE(i + 26), el = xb.readUInt16LE(i + 28);
      X[xb.slice(i + 30, i + 30 + nl).toString()] = xb.slice(i + 30 + nl + el, i + 30 + nl + el + sz).toString(); i += 30 + nl + el + sz;
    }
    if (process.env.XLSX_OUT) fs.writeFileSync(process.env.XLSX_OUT, xb);
    const malos = await page.evaluate((docs) => docs.filter((s) => new DOMParser().parseFromString(s, "application/xml").getElementsByTagName("parsererror").length).length, Object.values(X));
    ok(/^ichiraku-contador-\d{4}-\d{2}\.xlsx$/.test(dlx.suggestedFilename()) && ["Resumen", "Ventas por día", "Cobros por día", "Gastos", "Nómina"].every((n) => X["xl/workbook.xml"].includes('name="' + n + '"')) && !malos,
      "descarga el Excel del mes con sus 5 hojas (XML válido)");
    const r1 = X["xl/worksheets/sheet1.xml"];
    ok(/IVA 16 %/.test(r1) && /<v>1535.79<\/v>/.test(r1) && /<v>1323.96<\/v>/.test(r1) && /<v>211.83<\/v>/.test(r1), "el resumen trae ventas, base imponible e IVA del mes (Ref 1.535,79 = 1.323,96 + 211,83)");
    ok(/base del IGTF/.test(r1) && /<v>588<\/v>/.test(r1) && /<v>17.64<\/v>/.test(r1) && /1 día viene de Syth/.test(r1), "suma lo cobrado en divisas (base del IGTF) y avisa los días de Syth sin métodos");
    ok(/Compra de hielo &amp; agua &lt;2&gt;/.test(X["xl/worksheets/sheet4.xml"]) && /<v>905<\/v>/.test(X["xl/worksheets/sheet4.xml"]) && /Ana Pérez/.test(X["xl/worksheets/sheet5.xml"]) && /<v>121120.96<\/v>/.test(X["xl/worksheets/sheet5.xml"]),
      "gastos (con caracteres especiales) y nómina pagada en su hoja");
    // Nómina: tasa euro del día, faltas y descuentos de la quincena, a pagar en Bs y la casilla de pagado
    await page.click('#secs [data-sec="personal"]'); await page.click('#tabs [data-tab="nomina"]'); await page.waitForTimeout(300);
    const tasa = await page.textContent("#nomTasa");
    ok(/Tasa euro BCV de hoy/.test(tasa) && /Bs 1\.009,34 por 1 €/.test(tasa) && /Desde el .*Bs 1\.010,56/.test(tasa), "Nómina muestra la tasa euro BCV de hoy (y la de mañana si ya salió): " + tasa.replace(/\s+/g, " "));
    const fila = (n) => page.locator("#empList tr", { hasText: n }).first();
    ok(/Ref 173,00/.test(await fila("Luis Gómez").textContent()) && /Bs 174\.616,04/.test(await fila("Luis Gómez").textContent()) && /cuenta/.test(await fila("Luis Gómez").textContent()),
      "a pagar = quincena − lo que su cuenta pasa a la quincena, también en Bs a la tasa de hoy");
    await page.click("#addAdj"); await page.waitForSelector("#dlg[open]");
    await page.selectOption("#f_employee_id", "11"); await page.selectOption("#f_kind", "falta"); await page.fill("#f_days", "1"); await page.dispatchEvent("#f_days", "input");
    ok((await page.inputValue("#f_amount")) === "10.00" && /quincena ÷ 15/.test(await page.textContent("#adjHint")), "una falta propone quincena ÷ 15 por día (Ref 10 de Ref 150)");
    await page.fill("#f_days", "2"); await page.dispatchEvent("#f_days", "input"); await page.fill("#f_reason", "No vino viernes y sábado");
    await page.click('#dlgForm button[type="submit"]'); await page.waitForTimeout(400);
    ok(await page.evaluate(() => { const a = window.__G.tables.payroll_adjustments[0]; return !!a && a.employee_id === 11 && a.kind === "falta" && a.days === 2 && a.amount_ref === 20 && /^\d{4}-\d{2}-(01|16)$/.test(a.period); }),
      "anota la falta de 2 días (Ref 20) en la quincena");
    ok(/−Ref 20,00/.test(await fila("Ana Pérez").textContent()) && /2 días de falta/.test(await fila("Ana Pérez").textContent()) && /Ref 130,00/.test(await fila("Ana Pérez").textContent()),
      "la fila muestra la falta y lo que queda a pagar (Ref 130)");
    await fila("Ana Pérez").locator(".adjcol [data-adj]").click(); await page.waitForSelector("#dlg[open]");
    ok(/No vino viernes y sábado/.test(await page.textContent("#dlgFields")) && /1 día = Ref 10,00/.test(await page.textContent("#dlgFields")), "tocar los descuentos muestra el detalle de la quincena");
    await page.click('#dlgFields [data-addadj="descuento"]'); await page.waitForTimeout(150);
    ok((await page.inputValue("#f_employee_id")) === "11" && (await page.inputValue("#f_kind")) === "descuento" && !(await page.isVisible("#f_days")), "«+ Descuento» abre el formulario de esa persona, sin días");
    await page.fill("#f_amount", "15.5"); await page.fill("#f_reason", "Adelanto"); await page.click('#dlgForm button[type="submit"]'); await page.waitForTimeout(400);
    ok(/Ref 114,50/.test(await fila("Ana Pérez").textContent()) && /1 descuento/.test(await fila("Ana Pérez").textContent()), "con el adelanto queda Ref 114,50 a pagar");
    await fila("Ana Pérez").locator(".paychk").check(); await page.waitForTimeout(400);
    ok(await page.evaluate(() => { const p = window.__G.tables.payroll_payments[0]; return !!p && p.employee_id === 11 && p.amount_ref === 114.5 && p.rate === 1009.3413 && p.amount_bs === 115569.58; }) &&
       /Pagado \d\d\/\d\d/.test(await fila("Ana Pérez").textContent()) && /Bs 115\.569,58/.test(await fila("Ana Pérez").textContent()),
      "la casilla marca el pago con el monto, la tasa del día y los Bs");
    ok(/Falta por pagar: Ref 173,00/.test(await page.textContent("#nomCosto")) && /1 de 2 pagados/.test(await fila("Total").textContent()), "dice cuánto falta por pagar y cuántos van pagados (los inactivos no cuentan)");
    await fila("Ana Pérez").locator(".paychk").uncheck(); await page.waitForTimeout(400);
    ok(await page.evaluate(() => window.__G.tables.payroll_payments.length === 0) && !(await fila("Ana Pérez").locator(".paychk").isChecked()), "desmarcar la casilla (con confirmación) borra el pago");
    await fila("Ana Pérez").locator(".adjcol [data-adj]").click(); await page.waitForSelector("#dlg[open]");
    await page.locator("#dlgFields tr", { hasText: "Adelanto" }).locator("[data-deladj]").click(); await page.waitForTimeout(400);
    ok(await page.evaluate(() => window.__G.tables.payroll_adjustments.length === 1) && !/Adelanto/.test(await page.textContent("#dlgFields")) && /Ref 130,00/.test(await fila("Ana Pérez").textContent()),
      "se puede borrar un descuento mal anotado y la cuenta vuelve a Ref 130");
    await page.click("#dlgCancel");
    await page.click('#secs [data-sec="ajustes"]');
    ok(await page.isVisible('#tabs [data-tab="importar"]') && !(await page.isVisible('#tabs [data-tab="recetas"]')), "cada sección muestra solo sus pestañas");
    await page.click('#tabs [data-tab="importar"]');
    ok(/stock_minimo/.test(await page.textContent("#impCols")), "muestra los títulos de la plantilla de insumos");
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#impTpl")]);
    const tpl = fs.readFileSync(await dl.path(), "utf8");
    ok(dl.suggestedFilename() === "plantilla-insumos.csv" && tpl.includes("nombre;unidad;cantidad_compra;precio_ref"), "descarga la plantilla en CSV");
    await page.fill("#impText", "Nombre\tUnidad\tPrecio REF\tColor\nHarina\tkg\t1,50\trojo\nSal\tbolsa\t1\tazul\n");
    await page.click("#impCheck"); await page.waitForSelector("#impSum .pill");
    ok(/1 nuevos[\s\S]*1 con error/.test(await page.textContent("#impSum")), "revisa: 1 nuevo y 1 con error");
    ok(/Unidad no reconocida/.test(await page.textContent("#impPrev")), "muestra el error de la fila");
    ok(/Color/.test(await page.textContent("#impSum")), "avisa las columnas que no se usan");
    const sent = await page.evaluate(() => window.__G.calls.filter((c) => c.rpc === "import_data")[0].args);
    ok(sent.p_dry === true && sent.p_rows[0].precio === "1,50" && sent.p_rows[0].nombre === "Harina", "entiende los títulos aunque estén escritos distinto");
    ok(!(await page.isDisabled("#impGo")) && (await page.textContent("#impGo")) === "Cargar 1 fila", "ofrece cargar solo las filas buenas");
    await page.click("#impGo"); await page.waitForTimeout(400);
    ok(await page.evaluate(() => window.__G.calls.some((c) => c.rpc === "import_data" && c.args.p_dry === false)), "carga de verdad al confirmar");
    await page.selectOption("#impKind", "clientes");
    ok(/cedula/.test(await page.textContent("#impCols")) && await page.isDisabled("#impGo"), "al cambiar de tipo, cambia la plantilla y pide revisar de nuevo");
    await page.fill("#impText", 'nombre,telefono\n"Pérez, Ana",0414-1234567\n');
    await page.click("#impCheck"); await page.waitForTimeout(300);
    const cli = await page.evaluate(() => window.__G.calls.filter((c) => c.rpc === "import_data").pop().args.p_rows[0]);
    ok(cli.nombre === "Pérez, Ana" && cli.telefono === "0414-1234567", "lee CSV con comas y comillas");

    // Recetas: rentabilidad del menú
    await page.click('#secs [data-sec="cocina"]'); await page.click('#tabs [data-tab="recetas"]'); await page.waitForTimeout(400);
    ok(/Gyozas/.test(await page.textContent("#meList")) && /Ganancia de los platos/.test(await page.textContent("#meKpis")), "muestra la rentabilidad del menú con lo vendido");
    ok(/Estrella|Popular|Deja bien|Vende poco/.test(await page.textContent("#meList")), "clasifica el plato y dice qué hacer");
  } catch (e) {
    fallos++; console.log("FALLÓ: " + e.message.split("\n")[0]);
  }
  ok(errores.length === 0, "sin errores de JavaScript" + (errores.length ? ": " + errores.join(" | ") : ""));
  await browser.close(); server.close();
  if (fallos) { console.log(fallos + " prueba(s) fallaron"); process.exit(1); }
  console.log("TODAS LAS PRUEBAS DE GESTIÓN PASARON");
})();
