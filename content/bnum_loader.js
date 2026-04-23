// bnum_loader.js — demande au background de faire le login MEL via XHR
// chrome-privilégié (même jar de cookies que les onglets, identique legacy),
// puis de rediriger cet onglet vers les paramètres Bnum.

(async () => {
  console.log("[BnumLoader] démarrage");

  // Récupérer l'ID de cet onglet pour que le background puisse le rediriger
  let tabId = null;
  try {
    const tab = await browser.tabs.getCurrent();
    tabId = tab?.id ?? null;
    console.log("[BnumLoader] tabId =", tabId);
  } catch (e) {
    console.warn("[BnumLoader] tabs.getCurrent() erreur:", e);
  }

  // Demander au background : login chrome XHR + redirection
  try {
    await browser.runtime.sendMessage({ action: "openBnum", tabId });
    console.log("[BnumLoader] message openBnum envoyé");
  } catch (e) {
    console.error("[BnumLoader] sendMessage erreur:", e);
    // Fallback : redirection directe sans login
    window.location.href =
      "https://mel.din.developpement-durable.gouv.fr/?_task=settings&_action=plugin.mel_moncompte&_courrielleur=1";
  }
})();
