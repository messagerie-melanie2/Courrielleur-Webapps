/*
 * WebApp2 — Background script
 *
 * Fonctionnement :
 *   1. Crée un bouton dans la SpacesToolbar (comme Pauline/Anais)
 *   2. Au clic : récupère les credentials Pacome via l'Experiment API,
 *      effectue le login POST silencieux sur Pégase,
 *      puis ouvre (ou donne le focus à) l'onglet Pégase.
 */

// -----------------------------------------------------------------------
// Configuration Pégase
// -----------------------------------------------------------------------
const PEGASE = {
  name:               "Pégase",
  href:               "https://pegase.din.developpement-durable.gouv.fr/",
  login_page:         "https://pegase.din.developpement-durable.gouv.fr/?_p=login",
  external_login_url: "https://pegase.din.developpement-durable.gouv.fr/?_p=external_login",
  // %%username%% et %%password%% sont substitués avant l'envoi
  login_params:       "username=%%username%%&password=%%password%%&timezone=%%timezone%%",
  request_type:       "POST",
};

// -----------------------------------------------------------------------
// Login POST silencieux sur Pégase
// -----------------------------------------------------------------------
async function loginPegase(creds) {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Paris";

  let params = PEGASE.login_params
    .replace(/%%username%%/g, encodeURIComponent(creds.user))
    .replace(/%%password%%/g, encodeURIComponent(creds.password))
    .replace(/%%timezone%%/g,  encodeURIComponent(timezone));

  try {
    await fetch(PEGASE.external_login_url, {
      method:      "POST",
      credentials: "include",
      headers:     { "Content-Type": "application/x-www-form-urlencoded" },
      body:        params,
    });
    console.log("[WebApp] loginPegase: login POST effectué");
  } catch (e) {
    console.warn("[WebApp] loginPegase: erreur lors du POST de login:", e);
    // On continue quand même — l'onglet s'ouvrira, Pégase demandera le login si besoin
  }
}

// -----------------------------------------------------------------------
// Ouverture de Pégase : login puis ouvre/focus l'onglet
// -----------------------------------------------------------------------
async function openPegase() {
  console.log("[WebApp] openPegase: démarrage");

  // Récupérer les credentials via l'Experiment API (contexte chrome)
  const creds = await browser.webappApi.getCredentials();

  if (creds) {
    await loginPegase(creds);
  } else {
    console.warn("[WebApp] openPegase: credentials Pacome introuvables, ouverture sans login");
  }

  // Ouvrir ou donner le focus à l'onglet Pégase
  await browser.webappApi.openOrFocusTab(PEGASE.href, PEGASE.href);
}

// -----------------------------------------------------------------------
// SpacesToolbar — Bouton Pégase (comme Pauline/Anais branche 140)
// -----------------------------------------------------------------------
async function createSpaceButton() {
  try {
    const space = await browser.spaces.create("Pegase", PEGASE.href, {
      title:        PEGASE.name,
      defaultIcons: {
        "16": "skin/images/favicon.ico",
        "32": "skin/images/favicon.ico",
      },
    });
    console.log("[WebApp] Bouton Pégase créé dans la SpacesToolbar, space.id:", space.id);
  } catch (e) {
    // Si le space existe déjà (ex: rechargement extension), on ignore l'erreur
    if (!e.message?.includes("already")) {
      console.error("[WebApp] Erreur création bouton SpacesToolbar:", e);
    }
  }
}

// -----------------------------------------------------------------------
// Initialisation
// -----------------------------------------------------------------------
function webappInit() {
  browser.webappApi.init();
}

// Attendre qu'un onglet mail soit disponible avant de créer le bouton
async function waitForMailTabAndRun() {
  const tabs = await browser.tabs.query({});
  for (const tab of tabs) {
    if (tab.mailTab) {
      webappInit();
      createSpaceButton();
      return;
    }
  }
  // Pas encore d'onglet mail → attendre
  browser.tabs.onCreated.addListener(async (tab) => {
    if (tab.mailTab) {
      webappInit();
      createSpaceButton();
    }
  });
}

// Lancer l'initialisation
waitForMailTabAndRun();
browser.runtime.onStartup.addListener(() => {
  webappInit();
  createSpaceButton();
});
browser.runtime.onInstalled.addListener(() => {
  webappInit();
  createSpaceButton();
});

// -----------------------------------------------------------------------
// Écouter les clics sur le bouton de la SpacesToolbar
// Thunderbird émet spaces.onClicked quand l'utilisateur clique sur
// un bouton créé par browser.spaces.create()
// -----------------------------------------------------------------------
if (browser.spaces?.onClicked) {
  browser.spaces.onClicked.addListener((space, tab) => {
    if (space.name === "Pegase") {
      openPegase();
    }
  });
}
