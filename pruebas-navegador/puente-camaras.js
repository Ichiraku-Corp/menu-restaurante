// Puente: cámaras. Toma la foto del grabador (con autenticación Digest, como Hikvision y Dahua), la sube al bucket
// privado y avisa a Supabase; si el grabador falla, avisa el error; y borra las fotos viejas.
// Uso: node pruebas-navegador/puente-camaras.js   (no necesita grabador ni internet: se simulan los dos)
"use strict";
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http"), crypto = require("crypto");
let fallos = 0;
function ok(c, m) { if (c) console.log("ok: " + m); else { fallos++; console.log("FALLÓ: " + m); } }
const md5 = (t) => crypto.createHash("md5").update(t).digest("hex");

(async () => {
  // Grabador simulado: pide Digest (realm y nonce propios) y entrega un JPEG por canal
  const FOTO = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(3000), Buffer.from([0xff, 0xd9])]);
  const nvr = { usuario: "nex", clave: "clave-del-grabador", pedidos: [], autorizados: 0 };
  const grabador = http.createServer((req, res) => {
    nvr.pedidos.push(req.url);
    const a = req.headers.authorization || "";
    if (!/^Digest /.test(a)) {
      res.writeHead(401, { "WWW-Authenticate": 'Digest realm="IP Camera(C1234)", qop="auth", nonce="4e6f6e6365", opaque="abc123"' });
      return res.end();
    }
    const p = {}; a.slice(7).replace(/(\w+)=(?:"([^"]*)"|([^,\s]*))/g, (m, k, q, u) => { p[k] = q !== undefined ? q : u; return m; });
    const esperado = md5(`${md5(`${p.username}:${p.realm}:${nvr.clave}`)}:${p.nonce}:${p.nc}:${p.cnonce}:${p.qop}:${md5(`GET:${p.uri}`)}`);
    if (p.username !== nvr.usuario || p.response !== esperado || p.uri !== req.url || p.opaque !== "abc123") { res.writeHead(401); return res.end(); }
    nvr.autorizados++;
    if (/channels\/9/.test(req.url) || /channel=9/.test(req.url)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": "image/jpeg" }); res.end(FOTO);
  });
  await new Promise((r) => grabador.listen(0, "127.0.0.1", r));

  // Supabase simulado: sesión, funciones y el bucket de fotos
  const sb = { pendientes: [], listas: [], subidas: {}, borrado: null, borradas: null, estados: [] };
  const supa = http.createServer((req, res) => {
    const partes = []; req.on("data", (d) => partes.push(d)); req.on("end", () => {
      const cuerpo = Buffer.concat(partes), json = (o) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
      if (req.url.startsWith("/auth/v1/token")) return json({ access_token: "t", refresh_token: "r", expires_in: 3600 });
      const rpc = (req.url.match(/^\/rest\/v1\/rpc\/(\w+)/) || [])[1], args = rpc ? JSON.parse(cuerpo.toString() || "{}") : null;
      if (rpc === "cam_pendientes") { sb.estados.push(args.p_estado); const l = sb.pendientes; sb.pendientes = []; return json(l); }
      if (rpc === "cam_foto_lista") { sb.listas.push(args); return json(null); }
      if (rpc === "cam_viejas") return json([{ id: 3, path: "2026-11/3-aaaaaaaa.jpg" }, { id: 4, path: "2026-11/4-bbbbbbbb.jpg" }]);
      if (rpc === "cam_borradas") { sb.borradas = args.p_ids; return json(2); }
      if (req.method === "POST" && req.url.startsWith("/storage/v1/object/camaras/")) { sb.subidas[req.url.slice("/storage/v1/object/camaras/".length)] = { tipo: req.headers["content-type"], cuerpo }; return json({ Key: "ok" }); }
      if (req.method === "POST" && req.url === "/functions/v1/nex") { sb.nex = JSON.parse(cuerpo.toString()); return json({ camara: "Cocina", alerta: false, lo_que_se_ve: "Todo en orden" }); }
      if (req.method === "DELETE" && req.url === "/storage/v1/object/camaras") { sb.borrado = JSON.parse(cuerpo.toString()); return json([]); }
      res.writeHead(404); res.end();
    });
  });
  await new Promise((r) => supa.listen(0, "127.0.0.1", r));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "puente-camaras-"));
  fs.copyFileSync(path.join(__dirname, "..", "puente", "puente.js"), path.join(dir, "puente.js"));
  fs.copyFileSync(path.join(__dirname, "..", "puente", "logo.pbm"), path.join(dir, "logo.pbm"));
  const CFG = path.join(dir, "config.json");
  const config = (camaras) => {
    fs.writeFileSync(CFG, JSON.stringify({ supabase_url: "http://127.0.0.1:" + supa.address().port, anon_key: "x", email: "x", password: "x",
      printers: { cocina: { ip: "127.0.0.1", port: 9 }, caja: { ip: "127.0.0.1", port: 9 } }, camaras }));
    const t = new Date(Date.now() + Math.floor(Math.random() * 1e6)); fs.utimesSync(CFG, t, t);  // que el puente note el cambio
  };
  config({ marca: "hikvision", host: "127.0.0.1", puerto: grabador.address().port, usuario: "nex", clave: nvr.clave });
  process.env.PUENTE_CONFIG = CFG;
  const P = require(path.join(dir, "puente.js"));

  try {
    // 1) Hikvision: foto con Digest, subida al bucket y aviso a Supabase
    sb.pendientes = [{ id: 21, canal: 1, detalle: "normal", camara: "Cocina" }, { id: 22, canal: 2, detalle: "alto", camara: "Caja" }];
    await P.camTick();
    ok(nvr.pedidos.includes("/ISAPI/Streaming/channels/102/picture") && nvr.pedidos.includes("/ISAPI/Streaming/channels/201/picture"),
      "Hikvision: el detalle normal usa el flujo secundario (102) y el alto el principal (201)");
    ok(nvr.autorizados === 2, "entra al grabador con Digest (la clave no viaja, solo la huella)");
    const rutas = Object.keys(sb.subidas);
    ok(rutas.length === 2 && rutas.every((r) => /^\d{4}-\d{2}\/2[12]-[0-9a-f]{16}\.jpg$/.test(r)) && rutas.every((r) => sb.subidas[r].cuerpo.equals(FOTO) && sb.subidas[r].tipo === "image/jpeg"),
      "sube las dos fotos al bucket «camaras» tal cual (año-mes/id-azar.jpg)");
    const l21 = sb.listas.find((x) => x.p_id === 21);
    ok(l21 && l21.p_path === rutas.find((r) => r.includes("/21-")) && l21.p_bytes === FOTO.length && l21.p_error === "", "avisa a Supabase la ruta y el tamaño de cada foto");
    ok(sb.estados[0] && sb.estados[0].marca === "hikvision" && sb.estados[0].host === "127.0.0.1" && !JSON.stringify(sb.estados[0]).includes(nvr.clave),
      "cuenta cómo tiene configurado el grabador, sin mandar nunca la clave");

    // 2) Canal que no existe y clave equivocada: se avisa el error de cada foto
    sb.listas = []; sb.pendientes = [{ id: 23, canal: 9, detalle: "normal", camara: "Patio" }];
    await P.camTick();
    ok(sb.listas[0] && sb.listas[0].p_id === 23 && /no tiene el canal 9/.test(sb.listas[0].p_error), "un canal que el grabador no tiene se avisa como error");
    config({ marca: "hikvision", host: "127.0.0.1", puerto: grabador.address().port, usuario: "nex", clave: "otra" }); P.reloadConfig();
    sb.listas = []; sb.pendientes = [{ id: 24, canal: 1, detalle: "normal", camara: "Cocina" }];
    await P.camTick();
    ok(sb.listas[0] && /no aceptó el usuario o la clave/.test(sb.listas[0].p_error), "con la clave equivocada dice que el grabador no la aceptó");

    // 3) Dahua: otra dirección para la foto
    config({ marca: "dahua", host: "127.0.0.1", puerto: grabador.address().port, usuario: "nex", clave: nvr.clave }); P.reloadConfig();
    sb.listas = []; sb.pendientes = [{ id: 25, canal: 3, detalle: "normal", camara: "Salón" }];
    await P.camTick();
    ok(nvr.pedidos.includes("/cgi-bin/snapshot.cgi?channel=3") && sb.listas[0] && sb.listas[0].p_error === "", "Dahua: pide la foto a /cgi-bin/snapshot.cgi?channel=3 y la sube");

    // 4) Grabador apagado: error claro, sin tumbar el puente
    config({ marca: "hikvision", host: "127.0.0.1", puerto: 9, usuario: "nex", clave: nvr.clave }); P.reloadConfig();
    sb.listas = []; sb.pendientes = [{ id: 26, canal: 1, detalle: "normal", camara: "Cocina" }];
    await P.camTick();
    ok(sb.listas[0] && /no se llega al grabador/.test(sb.listas[0].p_error), "si el grabador no responde, avisa «no se llega al grabador»");

    // 4b) Revisión automática: después de subirla, le pide a Nex que la mire
    config({ marca: "hikvision", host: "127.0.0.1", puerto: grabador.address().port, usuario: "nex", clave: nvr.clave }); P.reloadConfig();
    sb.nex = null; sb.pendientes = [{ id: 30, canal: 1, detalle: "normal", camara: "Cocina", motivo: "revision" }];
    await P.camTick(); await new Promise((r) => setTimeout(r, 200));
    ok(sb.nex && sb.nex.action === "revisar_foto" && sb.nex.foto_id === 30, "una foto de revisión automática se manda a Nex para que la mire");

    // 5) Limpieza: borra del bucket las fotos viejas y lo anota
    await P.camLimpiar();
    ok(sb.borrado && sb.borrado.prefixes.join(",") === "2026-11/3-aaaaaaaa.jpg,2026-11/4-bbbbbbbb.jpg" && sb.borradas.join(",") === "3,4",
      "borra del bucket las fotos de más de 7 días y las anota como borradas");

    // 6) Sin cámaras en config.json no hace nada
    config(undefined); P.reloadConfig();
    const antes = sb.estados.length; sb.pendientes = [{ id: 27, canal: 1, detalle: "normal" }];
    await P.camTick();
    ok(sb.estados.length === antes, "sin cámaras en config.json el puente no pregunta nada");
  } catch (e) {
    fallos++; console.log("FALLÓ: " + e.message);
  }
  grabador.close(); supa.close();
  if (fallos) { console.log(fallos + " prueba(s) fallaron"); process.exit(1); }
  console.log("TODAS LAS PRUEBAS DE CÁMARAS DEL PUENTE PASARON");
  process.exit(0);
})();
