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
  name: "Pégase",
  href: "https://pegase.din.developpement-durable.gouv.fr/",
  login_page: "https://pegase.din.developpement-durable.gouv.fr/?_p=login",
  external_login_url: "https://pegase.din.developpement-durable.gouv.fr/?_p=external_login",
  // %%username%% et %%password%% sont substitués avant l'envoi
  login_params: "username=%%username%%&password=%%password%%&timezone=%%timezone%%",
  request_type: "POST",
};

// -----------------------------------------------------------------------
// Login POST silencieux sur Pégase
// -----------------------------------------------------------------------
async function loginPegase(creds) {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Paris";
  console.log("[WebApp] loginPegase: user=", creds.user, "timezone=", timezone);
  console.log("[WebApp] loginPegase: target URL=", PEGASE.external_login_url);

  let params = PEGASE.login_params
    .replace(/%%username%%/g, encodeURIComponent(creds.user))
    .replace(/%%password%%/g, encodeURIComponent(creds.password))
    .replace(/%%timezone%%/g, encodeURIComponent(timezone));

  // Log sans le mot de passe
  console.log("[WebApp] loginPegase: params (mdp masqué)=",
    params.replace(/password=[^&]*/i, "password=***"));

  try {
    const response = await fetch(PEGASE.external_login_url, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });
    console.log("[WebApp] loginPegase: réponse HTTP", response.status, response.statusText);
    console.log("[WebApp] loginPegase: URL finale après redirections:", response.url);
  } catch (e) {
    console.warn("[WebApp] loginPegase: erreur fetch:", e.message || e);
    // On continue quand même — l'onglet s'ouvrira, Pégase demandera le login si besoin
  }
}

// -----------------------------------------------------------------------
// Ouverture de Pégase : login puis ouvre/focus l'onglet
// -----------------------------------------------------------------------
async function openPegase() {
  console.log("[WebApp] openPegase: démarrage");

  // Récupérer les credentials via l'Experiment API (contexte chrome)
  let creds;
  try {
    creds = await browser.webappApi.getCredentials();
    console.log("[WebApp] openPegase: getCredentials() →",
      creds ? `user=${creds.user}, password=${creds.password ? "(ok)" : "(vide)"}` : "null");
  } catch (e) {
    console.error("[WebApp] openPegase: getCredentials() a levé une exception:", e.message || e);
    creds = null;
  }

  if (creds) {
    await loginPegase(creds);
  } else {
    console.warn("[WebApp] openPegase: credentials Pacome introuvables, ouverture sans login");
  }

  // Ouvrir ou donner le focus à l'onglet Pégase
  console.log("[WebApp] openPegase: appel openOrFocusTab vers", PEGASE.href);
  await browser.webappApi.openOrFocusTab(PEGASE.href, PEGASE.href);
  console.log("[WebApp] openPegase: terminé");
}

// -----------------------------------------------------------------------
// SpacesToolbar — Bouton Pégase (comme Pauline/Anais branche 140)
// -----------------------------------------------------------------------
async function createSpaceButton() {
  try {
    // TB 140 : spaces.create avec une URL ouvre l'onglet automatiquement au clic.
    // spaces.onClicked n'existe pas dans cette version → on intercepte via tabs.onUpdated.
    const space = await browser.spaces.create("Pegase", PEGASE.href, {
      title: PEGASE.name,
      defaultIcons: {
        "16": "skin/images/bar-graph.png",
        "32": "skin/images/bar-graph.png",
      },
    });
    console.log("[WebApp] Bouton Pégase créé, space.id:", space.id, "space.name:", space.name);
  } catch (e) {
    if (!e.message?.includes("already")) {
      console.error("[WebApp] Erreur création bouton SpacesToolbar:", e);
    } else {
      console.log("[WebApp] Space Pegase déjà existant (rechargement extension)");
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
// Interception de la page de login Pégase (équivalent du _loadHandler legacy)
//
// TB 140 ne dispose pas de spaces.onClicked. Quand l'utilisateur clique sur
// le bouton Pégase, TB ouvre un onglet vers PEGASE.href. Si la session est
// expirée, Pégase redirige vers sa page de login (?_p=login). On détecte
// ce chargement via tabs.onUpdated et on effectue le login POST silencieux,
// exactement comme le faisait _loadHandler dans webtab.js (extension legacy TB 60).
// -----------------------------------------------------------------------
console.log("[WebApp] Enregistrement du listener tabs.onUpdated pour login automatique Pégase");

browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // On ne réagit qu'aux changements d'URL confirmés
  if (!changeInfo.url) return;

  const url = changeInfo.url;
  console.log("[WebApp] tabs.onUpdated tabId:", tabId, "url:", url);

  // Détecter la page de login Pégase
  if (!url.startsWith("https://pegase.din.developpement-durable.gouv.fr")) return;
  if (!url.includes("_p=login")) return;

  console.log("[WebApp] Page de login Pégase détectée sur tabId:", tabId, "→ login automatique");

  const creds = await browser.webappApi.getCredentials();
  console.log("[WebApp] getCredentials() →",
    creds ? `user=${creds.user}, password=${creds.password ? "(ok)" : "(vide)"}` : "null");

  if (!creds) {
    console.warn("[WebApp] Credentials introuvables, Pégase affichera sa page de login");
    return;
  }

  await loginPegase(creds);

  // Rediriger vers la page principale après le login POST
  console.log("[WebApp] Redirection vers", PEGASE.href);
  await browser.tabs.update(tabId, { url: PEGASE.href });
});
