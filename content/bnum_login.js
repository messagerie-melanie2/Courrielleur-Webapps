// bnum_login.js — Content script injecté sur bnum.din.gouv.fr
//
// S'exécute dans le contexte de l'onglet (même-origine que bnum.din.gouv.fr).
// Détecte la page de login et effectue l'authentification via le background
// (Experiment API / endpoint intranet) pour contourner la restriction 2FA
// "depuis internet" imposée sur les logins directs depuis l'extérieur.
//
// L'URL cible après login est mémorisée par le background avant la redirection.

(async () => {
  console.log("[BnumLogin] content script démarré sur", window.location.href);

  // S'assurer qu'on est bien sur la page de login
  if (!window.location.search.includes("_task=login")) {
    console.log("[BnumLogin] pas sur la page de login, arrêt");
    return;
  }

  // ---------------------------------------------------------------
  // Guard anti-boucle infinie (temporel, 30 secondes).
  // Si un login a été tenté il y a moins de 30 s dans cet onglet,
  // on arrête immédiatement pour éviter la boucle login → redirect → login.
  // Après 30 s, un nouvel essai est permis (ex : expiration de session).
  // ---------------------------------------------------------------
  const GUARD_KEY = "bnum_login_attempted_ts";
  const now = Date.now();
  const lastAttempt = parseInt(sessionStorage.getItem(GUARD_KEY) || "0");
  if (now - lastAttempt < 30000) {
    console.warn("[BnumLogin] login déjà tenté récemment (" + Math.round((now - lastAttempt) / 1000) + "s) — arrêt pour éviter la boucle");
    document.documentElement.style.visibility = '';
    return;
  }
  sessionStorage.setItem(GUARD_KEY, String(now));

  // Masquer la page pour éviter que le formulaire soit visible pendant le login
  document.documentElement.style.visibility = 'hidden';

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
    document.documentElement.style.visibility = '';
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

  // Login via le background (Experiment API, chrome-privilégié).
  // L'Experiment API utilise l'endpoint intranet mel.din.developpement-durable.gouv.fr
  // qui ne soumet pas à la vérification 2FA "depuis internet" contrairement
  // à un fetch direct depuis le contexte de l'onglet (IP publique).
  console.log("[BnumLogin] login via background API (Experiment API)");
  try {
    const status = await browser.runtime.sendMessage({
      action: "loginBnum",
      user: creds.user,
      password: creds.password,
    });
    console.log("[BnumLogin] loginBnum via background → HTTP", status);
  } catch (e) {
    console.warn("[BnumLogin] loginBnum via background erreur:", e);
  }

  // Rediriger vers la destination prévue
  console.log("[BnumLogin] redirection →", targetUrl);
  window.location.href = targetUrl;
})();
