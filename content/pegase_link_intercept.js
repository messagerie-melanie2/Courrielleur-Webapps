/*
 * pegase_link_intercept.js
 *
 * Injecté dans le contexte d'affichage des messages Thunderbird
 * via browser.messageDisplayScripts.register() (background.js).
 *
 * Intercepte les clics sur les liens Pégase avant que Thunderbird
 * ne les transmette au navigateur externe, et demande au background
 * de les ouvrir dans un onglet Thunderbird.
 */

const PEGASE_PREFIX = "https://pegase.din.developpement-durable.gouv.fr";

document.addEventListener("click", (event) => {
  // Remonter jusqu'au <a> le plus proche (clic sur un enfant du lien)
  const link = event.target.closest("a[href]");
  if (!link) return;

  const href = link.href;
  if (!href || !href.startsWith(PEGASE_PREFIX)) return;

  // Annuler l'ouverture dans le navigateur externe
  event.preventDefault();
  event.stopPropagation();

  console.log("[WebApp] pegase_link_intercept: lien Pégase intercepté →", href);

  // Demander au background d'ouvrir l'URL dans un onglet Thunderbird
  browser.runtime.sendMessage({ action: "openPegaseUrl", url: href })
    .catch((e) => console.warn("[WebApp] pegase_link_intercept: sendMessage erreur:", e));

}, true /* capture phase — avant les handlers de TB */);

console.log("[WebApp] pegase_link_intercept: listener installé");
