// Verificación en dos pasos (2FA) obligatoria para el panel y la gestión.
//
// IchirakuMFA.gate(sb, caja) devuelve una promesa que se cumple cuando la sesión
// está verificada con el código de la app del teléfono (nivel aal2):
//  - si el usuario aún no tiene la app vinculada, muestra el QR para vincularla;
//  - si ya la tiene, pide el código de 6 dígitos.
// La base de datos (can_manage) exige ese nivel: sin código no entrega datos sensibles.
(function () {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function q(p) { return p.then(function (r) { if (r.error) throw r.error; return r.data; }); }

  function codeForm(box, opts) {
    box.innerHTML =
      "<h2>" + esc(opts.title) + "</h2>" + (opts.body || "") +
      '<form class="mfa-form" autocomplete="off">' +
      '<label for="mfaCode">Código de 6 dígitos de la app</label>' +
      '<input id="mfaCode" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required ' +
      'style="font-size:24px;letter-spacing:.3em;text-align:center">' +
      '<p><button class="primary" type="submit" style="width:100%">Verificar</button></p>' +
      '<p class="muted mfa-err" role="alert" style="color:var(--danger, #b3261e)"></p>' +
      '</form><p class="muted" style="margin-bottom:0">¿Perdiste el teléfono? Mira la ayuda en <code>docs/verificacion-en-dos-pasos.md</code>.</p>';
    var form = box.querySelector("form"), input = box.querySelector("#mfaCode"), err = box.querySelector(".mfa-err");
    setTimeout(function () { input.focus(); }, 50);
    return new Promise(function (resolve) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var code = input.value.replace(/\D/g, "");
        if (code.length !== 6) { err.textContent = "El código tiene 6 dígitos."; return; }
        var btn = form.querySelector("button"); btn.disabled = true; err.textContent = "";
        opts.verify(code).then(resolve, function (e2) {
          btn.disabled = false; input.value = ""; input.focus();
          err.textContent = /invalid|expired|code/i.test(e2 && e2.message || "")
            ? "Código incorrecto o vencido. Espera el siguiente y vuelve a intentarlo."
            : "No se pudo verificar: " + (e2 && e2.message || e2);
        });
      });
    });
  }

  function enroll(sb, box) {
    // Limpia vinculaciones a medias de intentos anteriores.
    return q(sb.auth.mfa.listFactors()).then(function (f) {
      var pending = (f.all || []).filter(function (x) { return x.factor_type === "totp" && x.status !== "verified"; });
      return Promise.all(pending.map(function (x) { return q(sb.auth.mfa.unenroll({ factorId: x.id })); }));
    }).then(function () {
      return q(sb.auth.mfa.enroll({ factorType: "totp", friendlyName: "Ichiraku " + new Date().toISOString().slice(0, 10) }));
    }).then(function (e) {
      var qr = String((e.totp && e.totp.qr_code) || "");
      var img = /^data:image\//.test(qr) ? '<img alt="Código QR para la app de verificación" src="' + esc(qr) + '" style="width:200px;height:200px;background:#fff;padding:8px;border-radius:8px;display:block;margin:10px auto">' : "";
      return codeForm(box, {
        title: "Protege tu cuenta",
        body: '<p class="muted">Paso obligatorio, solo la primera vez:</p>' +
          '<ol class="muted" style="padding-left:20px;margin:6px 0">' +
          "<li>Abre tu app de verificación (Google Authenticator, Microsoft Authenticator o Authy).</li>" +
          "<li>Añade una cuenta y escanea este código QR.</li>" +
          "<li>Escribe abajo el código de 6 dígitos que aparece.</li></ol>" + img +
          '<p class="muted" style="text-align:center;word-break:break-all">¿No puedes escanear? Escribe esta clave en la app:<br><code>' + esc(e.totp && e.totp.secret) + "</code></p>",
        verify: function (code) { return q(sb.auth.mfa.challengeAndVerify({ factorId: e.id, code: code })); },
      });
    });
  }

  function verify(sb, box, factor) {
    return codeForm(box, {
      title: "Verificación en dos pasos",
      body: '<p class="muted">Escribe el código que muestra tu app de verificación para «Ichiraku».</p>',
      verify: function (code) { return q(sb.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code })); },
    });
  }

  window.IchirakuMFA = {
    gate: function (sb, box) {
      box.innerHTML = '<p class="muted">Comprobando la seguridad de la sesión…</p>';
      return q(sb.auth.mfa.getAuthenticatorAssuranceLevel()).then(function (aal) {
        if (aal.currentLevel === "aal2") return;
        return q(sb.auth.mfa.listFactors()).then(function (f) {
          var ok = (f.totp || []).filter(function (x) { return x.status === "verified"; });
          return ok.length ? verify(sb, box, ok[0]) : enroll(sb, box);
        });
      }).then(function () { box.innerHTML = ""; });
    },
  };
})();
