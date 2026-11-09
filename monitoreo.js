/* Monitoreo de errores con Sentry para la caja, las tablets y Gestión.
   Solo se envían errores y tiempos de carga: nunca PINs, montos de pagos ni datos de clientes. */
(function () {
  "use strict";
  var C = window.MENU_CONFIG || {}, S = window.Sentry;
  if (!S || !C.SENTRY_DSN || navigator.webdriver) return;   // las pruebas automáticas no envían nada
  var host = location.hostname, port = location.port;
  var env = host === "localhost" || host === "127.0.0.1" ? "desarrollo" : port === "8080" ? "laptop" : "produccion";
  // Versión = huella del programa principal de la página (pos.js?v=…); se lee al enviar, cuando ya cargó
  function version() {
    var v = "", all = Array.prototype.map.call(document.scripts, function (s) { return s.src; });
    ["pos", "mfa", "reporte-cierre"].some(function (n) { return all.some(function (src) { var m = new RegExp("/" + n + "\\.js\\?v=([0-9a-f]+)").exec(src); if (m) v = m[1]; return !!m; }); });
    return "ichiraku-" + page + "@" + (v || "sin-version");
  }
  var page = (location.pathname.split("/").pop() || "index.html").replace(".html", "");
  var SECRET = /("?p_pin"?\s*[:=]\s*"?)\d+/gi;
  function scrub(x) { return typeof x === "string" ? x.replace(SECRET, "$1****") : x; }
  S.init({
    dsn: C.SENTRY_DSN,
    environment: env,
    sendDefaultPii: false,
    integrations: [S.browserTracingIntegration()],
    tracesSampleRate: 0.1,
    tracePropagationTargets: [],          // no añade cabeceras a Supabase
    beforeBreadcrumb: function (b) {
      if (b.category === "console" && b.message) b.message = scrub(b.message);
      if (b.data && b.data.url) b.data.url = scrub(b.data.url);
      return b;
    },
    beforeSend: function (e) {
      e.release = version();
      if (e.message) e.message = scrub(e.message);
      (e.exception && e.exception.values || []).forEach(function (x) { x.value = scrub(x.value); });
      if (e.request) { delete e.request.cookies; delete e.request.data; }
      return e;
    }
  });
  S.setTag("pagina", page);
  try { var dev = localStorage.getItem("pos-equipo"); if (dev) S.setTag("equipo", dev); } catch (e) { /* sin almacenamiento */ }
})();
