// bnum_login.js — Content script injecté sur bnum.din.gouv.fr
//
// S'exécute dans le contexte de l'onglet (même-origine que bnum.din.gouv.fr).
// Détecte la page de login et effectue l'authentification automatique via
// un fetch POST same-origin (cookies dans le jar de l'onglet → session OK).
//
// L'URL cible après login (accueil ou paramètres) est mémorisée par le
// background avant la redirection, et récupérée via getBnumIntendedUrl.

(async () => {
  console.log("[BnumLogin] content script démarré sur", window.location.href);

  // S'assurer qu'on est bien sur la page de login
  if (!window.location.search.includes("_task=login")) {
    console.log("[BnumLogin] pas sur la page de login, arrêt");
    return;
  }

  // Récupérer les credentials depuis le background
  let creds = null;
  try {
    creds = await browser.runtime.sendMessage({ action: "getCredentials" });
    console.log("[BnumLogin] getCredentials →", creds ? `user=${creds.user}` : "null");
  } catch (e) {
    console.error("[BnumLogin] getCredentials erreur:", e);
  }

  if (!creds?.user || !creds?.password) {
    console.warn("[BnumLogin] credentials introuvables, abandon");
    return;
  }

  // Récupérer l'URL cible mémorisée par le background
  // (accueil vs paramètres selon quel bouton a été cliqué)
  let targetUrl = "https://bnum.din.gouv.fr/?_task=settings&_action=plugin.mel_moncompte&_courrielleur=1";
  try {
    const intended = await browser.runtime.sendMessage({ action: "getBnumIntendedUrl" });
    if (intended) targetUrl = intended;
    console.log("[BnumLogin] URL cible →", targetUrl);
  } catch (e) {
    console.warn("[BnumLogin] getBnumIntendedUrl erreur:", e, "— fallback vers", targetUrl);
  }

  // Login POST en SAME-ORIGIN (même contexte que l'onglet → cookies OK)
  const LOGIN_URL = "https://bnum.din.gouv.fr/?_task=login&_courrielleur=1";
  const params = "_user=" + encodeURIComponent(creds.user)
               + "&_pass=" + encodeURIComponent(creds.password)
               + "&_task=login&_action=login&_keeplogin=1";

  console.log("[BnumLogin] fetch POST →", LOGIN_URL);
  try {
    const resp = await fetch(LOGIN_URL, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });
    console.log("[BnumLogin] login POST →", resp.status, resp.url);
  } catch (e) {
    console.warn("[BnumLogin] login fetch erreur:", e);
  }

  // Rediriger vers la destination prévue
  console.log("[BnumLogin] redirection →", targetUrl);
  window.location.href = targetUrl;
})();
