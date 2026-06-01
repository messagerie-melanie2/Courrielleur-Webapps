// Demande au background d'effectuer le login silencieux,
// d'ouvrir l'accueil Bnum dans le navigateur externe,
// puis de fermer cet onglet loader.
(async () => {
  const tab = await browser.tabs.getCurrent();
  browser.runtime.sendMessage({
    action: "openBnumHome",
    tabId: tab?.id,
  });
})();
