// Gestión → WhatsApp (docs/whatsapp-ventas.md). Archivo propio para no mezclarse con el resto de Gestión.
// Ajustes del bot, horario, datos de pago y zonas de delivery (tablas wa_settings y wa_zones, solo dueño/admin
// con 2FA por sus políticas) y resultados: embudo y ventas por anuncio (función wa_stats).
// Usa la sesión de Gestión que publica la página en window.GESTION.
(function () {
  "use strict";
  var G = window.GESTION;
  var panel = document.querySelector('[data-panel="whatsapp"]');
  if (!G || !panel) return;
  var sb = G.sb, q = G.q, toast = G.toast, fail = G.fail, esc = G.esc, money = G.money;
  var DAYS = [[1, "Lunes"], [2, "Martes"], [3, "Miércoles"], [4, "Jueves"], [5, "Viernes"], [6, "Sábado"], [0, "Domingo"]];
  var S = { settings: null, zones: [], days: 30 };
  function $(id) { return document.getElementById(id); }
  function n(v) { var x = parseFloat(String(v == null ? "" : v).replace(",", ".")); return isFinite(x) ? x : 0; }

  panel.innerHTML =
    '<div id="waMissing" class="card" hidden><h2>Falta instalar WhatsApp</h2><p>En Supabase → <b>SQL Editor</b>, ejecuta <code>supabase/whatsapp.sql</code> y recarga esta página.</p></div>' +
    '<div id="waApp" hidden>' +
    '<div class="card"><div class="row between"><h2 style="margin:0">Resultados</h2>' +
      '<select id="waDays" style="width:auto" aria-label="Periodo"><option value="7">Últimos 7 días</option><option value="30" selected>Últimos 30 días</option><option value="90">Últimos 90 días</option></select></div>' +
      '<div class="kpis" id="waKpis" style="margin-top:12px"></div>' +
      '<h3 style="margin:16px 0 6px">Ventas por anuncio (Click to WhatsApp)</h3><div class="scroll" id="waAds"></div></div>' +
    '<div class="card"><h2>Bot</h2>' +
      '<label class="row" style="gap:8px;align-items:center"><input type="checkbox" id="waActive" style="width:auto"> <b>Bot encendido</b> <span class="muted">(apagado: los mensajes llegan a la bandeja de caja y nadie responde solo)</span></label>' +
      '<label for="waWelcome">Saludo</label><textarea id="waWelcome" rows="2" maxlength="300"></textarea>' +
      '<label for="waPay">Datos de pago que el bot le envía al cliente</label>' +
      '<textarea id="waPay" rows="5" maxlength="1000" placeholder="Pago móvil: Banco …, 0414-…, J-…&#10;Zelle: correo@…&#10;Binance Pay ID: …&#10;PayPal: correo@…"></textarea>' +
      '<p class="muted" style="margin:4px 0 0">Se guardan en la base de datos, no en el código (el repositorio es público).</p>' +
      '<div class="row" style="gap:12px;flex-wrap:wrap;margin-top:8px">' +
        '<label style="flex:1;min-width:160px">Pedido mínimo de delivery (Ref)<input id="waMin" inputmode="decimal"></label>' +
        '<label class="row" style="gap:8px;align-items:center;flex:1;min-width:200px"><input type="checkbox" id="waCash" style="width:auto"> Aceptar efectivo al recibir</label></div>' +
      '<label for="waAddr">Dirección del local</label><input id="waAddr" maxlength="200">' +
      '<label for="waMaps">Enlace de Google Maps</label><input id="waMaps" maxlength="300">' +
      '<label for="waMenu">Enlace de la carta</label><input id="waMenu" maxlength="300">' +
      '<h3 style="margin:16px 0 6px">Horario</h3><p class="muted" style="margin:0 0 6px">Fuera de horario el bot avisa que está cerrado y toma pedidos y reservas para cuando abran.</p><div id="waHours"></div>' +
      '<p style="margin-top:12px"><button class="primary" type="button" id="waSave">Guardar</button></p></div>' +
    '<div class="card"><h2>Zonas de delivery</h2><p class="muted">El cliente elige su zona en WhatsApp y el bot le da el total exacto. Desactiva una zona para dejar de ofrecerla sin borrarla.</p>' +
      '<div class="scroll" id="waZones"></div>' +
      '<div class="row" style="gap:8px;margin-top:8px;flex-wrap:wrap"><input id="waZName" placeholder="Nombre de la zona (p. ej. Centro de San Diego)" maxlength="60" style="flex:2;min-width:200px" aria-label="Nombre de la zona">' +
        '<input id="waZFee" placeholder="Precio Ref" inputmode="decimal" style="flex:1;min-width:110px" aria-label="Precio Ref"><button type="button" id="waZAdd">Añadir zona</button></div></div>' +
    "</div>";

  function load() {
    return Promise.all([
      q(sb.from("wa_settings").select("*").eq("id", 1).maybeSingle()),
      q(sb.from("wa_zones").select("*").order("position").order("name")),
    ]).then(function (r) {
      $("waMissing").hidden = true; $("waApp").hidden = false;
      S.settings = r[0] || {}; S.zones = r[1] || [];
      drawSettings(); drawZones(); loadStats();
    }).catch(function (e) {
      if (/wa_settings|wa_zones|does not exist|schema cache/i.test(String(e && e.message))) { $("waMissing").hidden = false; $("waApp").hidden = true; return; }
      fail(e);
    });
  }

  function drawSettings() {
    var s = S.settings;
    $("waActive").checked = s.bot_active !== false;
    $("waWelcome").value = s.welcome || ""; $("waPay").value = s.payment_info || "";
    $("waMin").value = s.delivery_min != null ? s.delivery_min : 10; $("waCash").checked = !!s.allow_cash;
    $("waAddr").value = s.address_text || ""; $("waMaps").value = s.maps_url || ""; $("waMenu").value = s.menu_url || "";
    var h = s.hours || {};
    $("waHours").innerHTML = DAYS.map(function (d) {
      var x = h[String(d[0])];
      return '<div class="row" style="gap:8px;align-items:center;margin:4px 0" data-day="' + d[0] + '" data-name="' + d[1] + '">' +
        '<label class="row" style="gap:6px;align-items:center;width:130px;margin:0"><input type="checkbox" data-open style="width:auto"' + (x ? " checked" : "") + "> " + d[1] + "</label>" +
        '<input type="time" data-from aria-label="Abre" value="' + esc(x ? x[0] : "11:30") + '" style="width:auto"' + (x ? "" : " disabled") + "> a " +
        '<input type="time" data-to aria-label="Cierra" value="' + esc(x ? x[1] : "20:30") + '" style="width:auto"' + (x ? "" : " disabled") + "></div>";
    }).join("");
  }
  $("waHours").addEventListener("change", function (e) {
    if (!e.target.matches("[data-open]")) return;
    e.target.closest("[data-day]").querySelectorAll('input[type="time"]').forEach(function (i) { i.disabled = !e.target.checked; });
  });

  $("waSave").addEventListener("click", function () {
    var hours = {}, bad = null;
    document.querySelectorAll("#waHours [data-day]").forEach(function (row) {
      if (!row.querySelector("[data-open]").checked) return;
      var a = row.querySelector("[data-from]").value, b = row.querySelector("[data-to]").value;
      if (!a || !b || a >= b) bad = row.dataset.name;
      hours[row.dataset.day] = [a, b];
    });
    if (bad) { toast("Revisa el horario del " + bad.toLowerCase() + ": la hora de cierre debe ser después de la de apertura"); return; }
    var maps = $("waMaps").value.trim(), menu = $("waMenu").value.trim();
    if ((maps && !/^https:\/\//.test(maps)) || (menu && !/^https:\/\//.test(menu))) { toast("Los enlaces deben empezar por https://"); return; }
    var row = { bot_active: $("waActive").checked, welcome: $("waWelcome").value.trim(), payment_info: $("waPay").value.trim(),
      delivery_min: Math.max(0, n($("waMin").value)), allow_cash: $("waCash").checked, address_text: $("waAddr").value.trim(),
      maps_url: maps, menu_url: menu, hours: hours, updated_at: new Date().toISOString() };
    $("waSave").disabled = true;
    q(sb.from("wa_settings").update(row).eq("id", 1).select()).then(function (r) {
      if (!r || !r.length) throw new Error("No se guardó: revisa que entraste con el código de verificación");
      S.settings = r[0]; toast("Ajustes de WhatsApp guardados");
    }).catch(fail).then(function () { $("waSave").disabled = false; });
  });

  function drawZones() {
    $("waZones").innerHTML = S.zones.length ? '<table class="tbl"><thead><tr><th>Zona</th><th class="n">Precio</th><th>Activa</th><th></th></tr></thead><tbody>' +
      S.zones.map(function (z) {
        return '<tr data-zone="' + z.id + '"><td><input data-f="name" value="' + esc(z.name) + '" maxlength="60" aria-label="Nombre"></td>' +
          '<td class="n"><input data-f="fee" value="' + esc(z.fee) + '" inputmode="decimal" style="width:90px;text-align:right" aria-label="Precio"></td>' +
          '<td><input type="checkbox" data-f="active" style="width:auto" aria-label="Activa"' + (z.active ? " checked" : "") + "></td>" +
          '<td><button type="button" data-zdel="' + z.id + '">Borrar</button></td></tr>';
      }).join("") + "</tbody></table>" : '<p class="muted">Todavía no hay zonas. Mientras no haya ninguna, el bot solo ofrece retiro en el local.</p>';
  }
  $("waZones").addEventListener("change", function (e) {
    var tr = e.target.closest("[data-zone]"); if (!tr) return;
    var f = e.target.dataset.f, patch = {}, id = Number(tr.dataset.zone);
    if (f === "name") { if (e.target.value.trim().length < 2) { toast("El nombre de la zona es muy corto"); return; } patch.name = e.target.value.trim(); }
    if (f === "fee") patch.fee = Math.max(0, n(e.target.value));
    if (f === "active") patch.active = e.target.checked;
    q(sb.from("wa_zones").update(patch).eq("id", id).select()).then(function (r) {
      var z = S.zones.find(function (x) { return x.id === id; }); if (z && r && r[0]) Object.assign(z, r[0]);
      toast("Zona guardada");
    }).catch(fail);
  });
  $("waZones").addEventListener("click", function (e) {
    var b = e.target.closest("[data-zdel]"); if (!b) return;
    if (!confirm("¿Borrar esta zona? Si solo quieres dejar de ofrecerla, desmarca «Activa».")) return;
    var id = Number(b.dataset.zdel);
    q(sb.from("wa_zones").delete().eq("id", id)).then(function () {
      S.zones = S.zones.filter(function (x) { return x.id !== id; }); drawZones(); toast("Zona borrada");
    }).catch(fail);
  });
  $("waZAdd").addEventListener("click", function () {
    var name = $("waZName").value.trim(), fee = n($("waZFee").value);
    if (name.length < 2) { toast("Escribe el nombre de la zona"); return; }
    q(sb.from("wa_zones").insert({ name: name, fee: Math.max(0, fee), position: S.zones.length + 1 }).select()).then(function (r) {
      S.zones.push(r[0]); $("waZName").value = ""; $("waZFee").value = ""; drawZones(); toast("Zona añadida");
    }).catch(fail);
  });

  function loadStats() {
    q(sb.rpc("wa_stats", { p_days: S.days })).then(function (st) {
      var f = st.funnel || {}, pct = function (a, b) { return b ? Math.round(a * 100 / b) + " %" : "—"; };
      var k = [["Conversaciones nuevas", f.conversaciones || 0], ["Pedidos enviados", f.pedidos || 0],
        ["Aceptados", (f.aceptados || 0) + " (" + pct(f.aceptados || 0, f.conversaciones || 0) + ")"],
        ["Ventas por WhatsApp", money(Number(st.ventas))], ["Ticket promedio", money(Number(st.ticket))],
        ["Rechazados", f.rechazados || 0], ["Reservas pedidas", f.reservas || 0], ["Pidieron una persona", f.humano || 0]];
      $("waKpis").innerHTML = k.map(function (x) { return '<div class="kpi"><span>' + esc(x[0]) + "</span><b>" + esc(String(x[1])) + "</b></div>"; }).join("");
      var ads = st.anuncios || [];
      $("waAds").innerHTML = (ads.length ? '<table class="tbl"><thead><tr><th>Anuncio</th><th class="n">Conversaciones</th><th class="n">Pedidos</th><th class="n">Ventas</th></tr></thead><tbody>' +
        ads.map(function (a) { return "<tr><td>" + esc(a.anuncio) + '</td><td class="n">' + a.conversaciones + '</td><td class="n">' + a.pedidos + '</td><td class="n">' + money(Number(a.ventas)) + "</td></tr>"; }).join("") +
        "</tbody></table>" : '<p class="muted">Aún no llegan clientes desde anuncios. Cuando lances anuncios «Click to WhatsApp», aquí verás cuánto vende cada uno.</p>') +
        '<p class="muted">Conversaciones que no vinieron de un anuncio: ' + (st.sin_anuncio || 0) + ".</p>";
    }).catch(fail);
  }
  $("waDays").addEventListener("change", function () { S.days = Number($("waDays").value) || 30; loadStats(); });

  // Se carga al abrir la pestaña (también si Gestión la abrió sola al entrar, por ser la última usada).
  function maybeLoad() { if (!panel.hidden && G.ready()) load(); }
  document.getElementById("tabs").addEventListener("click", function (e) {
    if (e.target.closest('button[data-tab="whatsapp"]')) setTimeout(maybeLoad, 0);
  });
  G.onReady.push(maybeLoad);
  maybeLoad();
})();
