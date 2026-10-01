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
    console.log(`[BnumLoader] [POST BNUM Mon Compte] Envoi du message openBnum au background (tabId=${tabId})`);
    await browser.runtime.sendMessage({ action: "openBnum", tabId });
    console.log("[BnumLoader] [POST BNUM Mon Compte] Message openBnum envoyé avec succès");
  } catch (e) {
    console.error("[BnumLoader] [POST BNUM Mon Compte] sendMessage erreur:", e);
    // Fallback : redirection directe sans login
    window.location.href =
      "https://bnum.din.gouv.fr/?_task=settings&_action=plugin.mel_moncompte&_courrielleur=1";
  }
})();
