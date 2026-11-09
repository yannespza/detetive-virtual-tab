/* Ajuda de instalação no celular (iPhone e Android).
   Aparece só no celular, só quando o app ainda não está instalado,
   e some por 14 dias se a pessoa fechar o aviso. */
(function () {
  var ua = navigator.userAgent || "";
  var ehIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var ehAndroid = /android/i.test(ua);
  var instalado = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
  if (instalado || (!ehIOS && !ehAndroid)) return;

  var CHAVE = "ajuda-instalar-fechado-em";
  var promptAndroid = null;
  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); promptAndroid = e; atualizarBotao(); });

  function lerFechado() { try { return Number(localStorage.getItem(CHAVE)) || 0; } catch (e) { return 0; } }
  function gravarFechado() { try { localStorage.setItem(CHAVE, String(Date.now())); } catch (e) {} }

  var tagScript = document.currentScript || document.querySelector('script[src*="instalar.js"]');
  var corMeta = document.querySelector('meta[name="theme-color"]');
  var corApp = tagScript && tagScript.getAttribute("data-cor");
  var corTema = corMeta && /^#[0-9a-f]{3,8}$/i.test(corMeta.content) && !/^#f/i.test(corMeta.content) ? corMeta.content : "";
  var cor = corApp || corTema || "#E8734A";
  var nomeMeta = document.querySelector('meta[name="apple-mobile-web-app-title"]');
  var nome = (nomeMeta && nomeMeta.content) || document.title || "este app";

  var css = document.createElement("style");
  css.textContent =
    ".ih-aviso{position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom));z-index:99998;max-width:520px;margin:0 auto;" +
    "background:#fff;color:#222;border-radius:16px;box-shadow:0 8px 30px rgba(0,0,0,.22);padding:12px 12px 12px 14px;display:flex;align-items:center;gap:10px;" +
    "font:15px/1.35 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;transform:translateY(150%);transition:transform .35s ease}" +
    ".ih-aviso.ih-on{transform:none}" +
    ".ih-aviso img{width:40px;height:40px;border-radius:10px;flex:none}" +
    ".ih-aviso .ih-tx{flex:1;min-width:0}.ih-aviso b{display:block;font-size:15px}.ih-aviso span{font-size:13px;color:#666}" +
    ".ih-btn{border:none;border-radius:10px;padding:9px 13px;font:700 14px system-ui,sans-serif;color:#fff;cursor:pointer;flex:none}" +
    ".ih-x{border:none;background:none;font-size:22px;line-height:1;color:#999;padding:4px 6px;cursor:pointer;flex:none}" +
    ".ih-fundo{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.5);display:flex;align-items:flex-end;justify-content:center}" +
    ".ih-folha{background:#fff;color:#222;width:100%;max-width:560px;border-radius:20px 20px 0 0;padding:20px 18px calc(20px + env(safe-area-inset-bottom));" +
    "font:16px/1.45 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;max-height:90vh;overflow:auto}" +
    ".ih-folha h3{margin:0 0 12px;font-size:20px}" +
    ".ih-abas{display:flex;background:#f1f1f1;border-radius:12px;padding:4px;margin-bottom:14px}" +
    ".ih-abas button{flex:1;border:none;background:none;padding:9px;border-radius:9px;font:700 14px system-ui,sans-serif;color:#666;cursor:pointer}" +
    ".ih-abas button.ih-sel{background:#fff;color:#222;box-shadow:0 1px 4px rgba(0,0,0,.12)}" +
    ".ih-folha ol{margin:0 0 14px;padding-left:22px}.ih-folha li{margin-bottom:10px}" +
    ".ih-folha .ih-dica{font-size:13.5px;color:#666;background:#f7f7f7;border-radius:10px;padding:10px 12px;margin-bottom:14px}" +
    ".ih-ok{width:100%;padding:13px;font-size:15px}" +
    "@media (prefers-color-scheme:dark){.ih-aviso,.ih-folha{background:#2a2a2a;color:#f2f2f2}.ih-aviso span,.ih-folha .ih-dica{color:#bbb}" +
    ".ih-folha .ih-dica{background:#333}.ih-abas{background:#383838}.ih-abas button.ih-sel{background:#4a4a4a;color:#fff}}";
  document.head.appendChild(css);

  var iconeLink = document.querySelector('link[rel="apple-touch-icon"]') || document.querySelector('link[rel="icon"]');
  var icone = iconeLink ? iconeLink.href : "";

  var COMPARTILHAR = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-3px">' +
    '<path d="M12 3v12M8 7l4-4 4 4"/><path d="M5 11v9h14v-9"/></svg>';

  var PASSOS = {
    iphone:
      "<ol><li>Abra este link no <b>Safari</b>.</li>" +
      "<li>Toque no botão <b>Compartilhar</b> " + COMPARTILHAR + " (na barra de baixo ou de cima).</li>" +
      "<li>Role a lista e toque em <b>Adicionar à Tela de Início</b>.</li>" +
      "<li>Toque em <b>Adicionar</b>. O ícone aparece junto dos seus apps.</li></ol>" +
      '<div class="ih-dica">Não achou a opção? Em alguns iPhones ela fica escondida: toque em <b>Editar Ações</b> no fim da lista e ative "Adicionar à Tela de Início".</div>',
    android:
      "<ol><li>Abra este link no <b>Chrome</b>.</li>" +
      "<li>Toque no menu <b>⋮</b> (três pontinhos, no canto de cima).</li>" +
      "<li>Toque em <b>Instalar app</b> (ou <b>Adicionar à tela inicial</b>).</li>" +
      "<li>Confirme em <b>Instalar</b>. O ícone aparece junto dos seus apps.</li></ol>" +
      '<div class="ih-dica">No Samsung Internet: menu <b>☰</b> → <b>Adicionar página a</b> → <b>Tela inicial</b>.</div>'
  };

  var aviso, botaoAviso;
  function atualizarBotao() { if (botaoAviso) botaoAviso.textContent = promptAndroid ? "Instalar" : "Como?"; }

  function mostrarAviso() {
    aviso = document.createElement("div");
    aviso.className = "ih-aviso";
    aviso.setAttribute("role", "dialog");
    aviso.innerHTML = (icone ? '<img src="' + icone + '" alt="">' : "") +
      '<div class="ih-tx"><b>Instale no seu celular</b><span>Abre como app, direto da tela inicial</span></div>';
    botaoAviso = document.createElement("button");
    botaoAviso.className = "ih-btn";
    botaoAviso.style.background = cor;
    botaoAviso.onclick = function () { promptAndroid ? instalarAgora() : abrirPassos(); };
    var x = document.createElement("button");
    x.className = "ih-x"; x.setAttribute("aria-label", "Fechar"); x.textContent = "×";
    x.onclick = function () { gravarFechado(); esconderAviso(); };
    aviso.appendChild(botaoAviso); aviso.appendChild(x);
    document.body.appendChild(aviso);
    atualizarBotao();
    setTimeout(function () { aviso.classList.add("ih-on"); }, 50);
  }
  function esconderAviso() {
    if (!aviso) return;
    aviso.classList.remove("ih-on");
    var a = aviso; aviso = null; setTimeout(function () { a.remove(); }, 400);
  }

  function instalarAgora() {
    if (!promptAndroid) return abrirPassos();
    promptAndroid.prompt();
    promptAndroid.userChoice.then(function (r) {
      promptAndroid = null; atualizarBotao();
      if (r && r.outcome === "accepted") esconderAviso();
    });
  }

  function abrirPassos(qual) {
    qual = qual || (ehIOS ? "iphone" : "android");
    var fundo = document.createElement("div");
    fundo.className = "ih-fundo";
    fundo.innerHTML =
      '<div class="ih-folha" role="dialog" aria-label="Como instalar">' +
      "<h3>Instalar " + nome.replace(/[<>&"]/g, "") + "</h3>" +
      '<div class="ih-abas"><button data-q="iphone">iPhone</button><button data-q="android">Android</button></div>' +
      '<div class="ih-passos"></div>' +
      '<button class="ih-btn ih-ok">Entendi</button></div>';
    var passos = fundo.querySelector(".ih-passos");
    function mostrar(q) {
      passos.innerHTML = PASSOS[q];
      fundo.querySelectorAll(".ih-abas button").forEach(function (b) { b.classList.toggle("ih-sel", b.getAttribute("data-q") === q); });
    }
    fundo.querySelectorAll(".ih-abas button").forEach(function (b) { b.onclick = function () { mostrar(b.getAttribute("data-q")); }; });
    var ok = fundo.querySelector(".ih-ok"); ok.style.background = cor;
    ok.onclick = function () { fundo.remove(); };
    fundo.onclick = function (e) { if (e.target === fundo) fundo.remove(); };
    mostrar(qual);
    document.body.appendChild(fundo);
  }

  // Permite abrir a ajuda de qualquer lugar do app: mostrarAjudaInstalacao()
  window.mostrarAjudaInstalacao = abrirPassos;

  window.addEventListener("appinstalled", esconderAviso);
  var quatorzeDias = 14 * 24 * 60 * 60 * 1000;
  function iniciar() { if (Date.now() - lerFechado() > quatorzeDias) setTimeout(mostrarAviso, 1500); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();
})();
