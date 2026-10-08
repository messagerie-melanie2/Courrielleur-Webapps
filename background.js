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
  url_prefix: "https://pegase.din.developpement-durable.gouv.fr",
  href: "https://pegase.din.developpement-durable.gouv.fr/",
  login_page: "https://pegase.din.developpement-durable.gouv.fr/?_p=login",
  external_login_url: "https://pegase.din.developpement-durable.gouv.fr/?_p=external_login",
  // %%username%% et %%password%% sont substitués avant l'envoi
  login_params: "username=%%username%%&password=%%password%%&timezone=%%timezone%%",
  request_type: "POST",
};

// -----------------------------------------------------------------------
// Configuration Bnum (paramètres MEL / bnum.din.gouv.fr)
// -----------------------------------------------------------------------
const BNUM = {
  name: "Mon Compte BNUM",
  href_prefix: "https://bnum.din.gouv.fr/",
  external_login_url: "https://bnum.din.gouv.fr/?_task=login&_courrielleur=1",
  //external_login_url: "https://bnum.din.gouv.fr/?_task=login&_courrielleur=1",
  login_params: "_user=%%username%%&_pass=%%password%%&_task=login&_action=login&_keeplogin=1",
  // Page d'accueil Bnum (bouton accueil)
  home_url: "https://bnum.din.gouv.fr/?_courrielleur=1",
  // Page paramètres Bnum (bouton paramètres)
  default_url: "https://bnum.din.gouv.fr/?_task=settings&_action=plugin.mel_moncompte&_courrielleur=1",
};

// URL cible Pégase mémorisée (lien cliqué depuis un mail) pour
// redirection après login automatique via tabs.onUpdated.
let pegasePendingUrl = null;

// Guard anti-boucle : tabIds pour lesquels un login Pégase est en cours.
// Empêche la boucle infinie si le XHR-login et la redirection ne synchronisent
// pas correctement avec tabs.onUpdated.
const pegaseLoginInProgress = new Set();

// Guard anti-boucle : tabIds pour lesquels un login Bnum est en cours.
const bnumLoginInProgress = new Set();

// URL cible mémorisée par tabId avant que Bnum redirige vers login.
// Permet au content script de savoir où rediriger après login réussi.
const bnumIntendedUrl = new Map();

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
// Login POST silencieux sur Bnum (bnum.din.gouv.fr)
// -----------------------------------------------------------------------
async function loginBnum(creds) {
  console.log("[WebApp] [POST BNUM Mon Compte] loginBnum: user=", creds.user, "→", BNUM.external_login_url);

  const params = BNUM.login_params
    .replace(/%%username%%/g, encodeURIComponent(creds.user))
    .replace(/%%password%%/g, encodeURIComponent(creds.password));

  console.log("[WebApp] [POST BNUM Mon Compte] loginBnum: body (mdp masqué)=",
    params.replace(/_pass=[^&]*/i, "_pass=***"));

  const startTime = Date.now();
  try {
    console.log("[WebApp] [POST BNUM Mon Compte] loginBnum: envoi de la requête fetch POST...");
    const response = await fetch(BNUM.external_login_url, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });
    const elapsed = Date.now() - startTime;
    console.log(`[WebApp] [POST BNUM Mon Compte] loginBnum: réponse HTTP ${response.status} ${response.statusText} en ${elapsed}ms → finalUrl:`, response.url);
    const text = await response.text();
    console.log("[WebApp] [POST BNUM Mon Compte] loginBnum: taille réponse =", text ? text.length : 0);
  } catch (e) {
    const elapsed = Date.now() - startTime;
    console.warn(`[WebApp] [POST BNUM Mon Compte] loginBnum: erreur fetch après ${elapsed}ms:`, e.message || e);
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
// Ouverture de Bnum : login chrome-privilégié (Experiment API) puis onglet
// Le login est fait via webappApi.loginBnum() qui utilise un XHR chrome
// (même jar de cookies que les onglets, identique à la legacy webtab.js).
// -----------------------------------------------------------------------
async function openBnum() {
  console.log("[WebApp] [POST BNUM Mon Compte] openBnum: démarrage ouverture Mon Compte Bnum");

  let creds;
  try {
    creds = await browser.webappApi.getCredentials();
    console.log("[WebApp] [POST BNUM Mon Compte] openBnum: getCredentials() →",
      creds ? `user=${creds.user}, password=${creds.password ? "(ok)" : "(vide)"}` : "null");
  } catch (e) {
    console.error("[WebApp] [POST BNUM Mon Compte] openBnum: getCredentials() exception:", e.message || e);
    creds = null;
  }

  if (creds) {
    // Login via XHR chrome-privilégié dans l'Experiment API
    console.log("[WebApp] [POST BNUM Mon Compte] openBnum: déclenchement du POST login via webappApi.loginBnum...");
    const status = await browser.webappApi.loginBnum(creds.user, creds.password);
    console.log("[WebApp] [POST BNUM Mon Compte] openBnum: retour webappApi.loginBnum status HTTP =", status);
  } else {
    console.warn("[WebApp] [POST BNUM Mon Compte] openBnum: credentials introuvables, ouverture sans login");
  }

  console.log("[WebApp] [POST BNUM Mon Compte] openBnum: ouverture/focus onglet vers", BNUM.default_url);
  await browser.webappApi.openOrFocusTab(BNUM.default_url, BNUM.href_prefix);
  console.log("[WebApp] [POST BNUM Mon Compte] openBnum: terminé");
}

// -----------------------------------------------------------------------
// Ouverture de Bnum Accueil dans le navigateur externe
// Login via XHR chrome-privilégié, puis ouverture du navigateur système.
// -----------------------------------------------------------------------
async function openBnumHome() {
  console.log("[WebApp] openBnumHome: démarrage");

  // Note : pas de loginBnum() ici — les cookies Thunderbird ne sont pas
  // partagés avec le navigateur externe (jar séparé). Le login est inutile.

  // Ouvrir l'accueil Bnum dans le navigateur externe (sans _courrielleur=1)
  const homeUrl = "https://bnum.din.gouv.fr/?_task=mail";
  console.log("[WebApp] openBnumHome: ouverture navigateur externe →", homeUrl);
  browser.webappApi.openInBrowser(homeUrl);
  console.log("[WebApp] openBnumHome: terminé");
}


// Helper pour créer un espace ou mettre à jour ses propriétés s'il existe déjà
async function registerOrUpdateSpace(name, url, buttonProperties) {
  try {
    const existingSpaces = await browser.spaces.query({ isSelfOwned: true });
    const existing = existingSpaces?.find(s => s.name === name);
    if (existing) {
      const spaceId = existing.id ?? existing.spaceId;
      console.log(`[WebApp] Space ${name} déjà existant (id: ${spaceId}), mise à jour des propriétés...`);
      await browser.spaces.update(spaceId, { url }, buttonProperties);
      console.log(`[WebApp] Space ${name} mis à jour avec succès`);
      return existing;
    }
    const created = await browser.spaces.create(name, url, buttonProperties);
    console.log(`[WebApp] Space ${name} créé avec succès, id:`, created?.id);
    return created;
  } catch (e) {
    if (e.message?.includes("already exists")) {
      console.log(`[WebApp] Space ${name} déjà existant lors du create, tentative de mise à jour...`);
      try {
        const existingSpaces = await browser.spaces.query({ isSelfOwned: true });
        const existing = existingSpaces?.find(s => s.name === name);
        if (existing) {
          const spaceId = existing.id ?? existing.spaceId;
          await browser.spaces.update(spaceId, { url }, buttonProperties);
          console.log(`[WebApp] Space ${name} mis à jour après exception`);
          return existing;
        }
      } catch (updateErr) {
        console.error(`[WebApp] Erreur lors de la mise à jour de ${name}:`, updateErr);
      }
    } else {
      console.error(`[WebApp] Erreur registerOrUpdateSpace (${name}):`, e);
    }
  }
}

// -----------------------------------------------------------------------
// SpacesToolbar — Boutons Pégase et Bnum
// -----------------------------------------------------------------------
async function createSpaceButtons() {

  // --- Bouton BnumHome (accueil Bnum dans le navigateur externe) ---
  // Le space pointe vers la page loader locale qui envoie un message
  // au background. Celui-ci effectue le login silencieux, ouvre le
  // navigateur système puis ferme l'onglet loader.
  await registerOrUpdateSpace(
    "BnumHome",
    browser.runtime.getURL("content/bnum_home_loader.html"),
    {
      title: "Accéder au Bnum",
      defaultIcons: {
        "16": "skin/images/bnum.svg",
        "32": "skin/images/bnum.svg",
      },
    }
  );

  // --- Bouton PSIN ---
  // Note sur themeIcons : dans le moteur WebExtensions de Mozilla (ExtensionParent.sys.mjs),
  // les propriétés 'light' et 'dark' sont résolues de manière inversée :
  // lightURL = resolve(dark) (injecté dans --webextension-toolbar-image-light pour le thème sombre)
  // darkURL = resolve(light) (injecté dans --webextension-toolbar-image-dark pour le thème clair).
  // Par conséquent, 'dark' doit contenir l'icône claire (_light.svg) et 'light' l'icône sombre (_dark.svg).
  await registerOrUpdateSpace(
    "PSIN",
    "https://psin.supervision.e2.rie.gouv.fr/",
    {
      title: "Accéder au portail PSIN",
      defaultIcons: {
        "16": "skin/images/psin_dark.svg",
        "32": "skin/images/psin_dark.svg",
      },
      themeIcons: [
        {
          "dark": "skin/images/psin_light.svg",
          "light": "skin/images/psin_dark.svg",
          "size": 16
        },
        {
          "dark": "skin/images/psin_light.svg",
          "light": "skin/images/psin_dark.svg",
          "size": 32
        }
      ],
    }
  );

  // --- Bouton Pégase (sondage) ---
  // TB 140+ : spaces.create avec une URL ouvre l'onglet automatiquement au clic.
  // spaces.onClicked n'existe pas dans cette version → on intercepte via tabs.onUpdated.
  await registerOrUpdateSpace(
    "Pegase",
    PEGASE.href,
    {
      title: "Sondage",
      defaultIcons: {
        "16": "skin/images/sondage_dark.svg",
        "32": "skin/images/sondage_dark.svg",
      },
      themeIcons: [
        {
          "dark": "skin/images/sondage_light.svg",
          "light": "skin/images/sondage_dark.svg",
          "size": 16
        },
        {
          "dark": "skin/images/sondage_light.svg",
          "light": "skin/images/sondage_dark.svg",
          "size": 32
        }
      ],
    }
  );

  // --- Bouton MonCompte Bnum (paramètres Bnum) ---
  // Le space pointe vers bnum_loader.html (page locale avec spinner).
  // Cela garantit que l'utilisateur voit un écran de chargement propre et élégant
  // pendant le login POST en arrière-plan, sans JAMAIS voir l'écran "Vous êtes déconnecté".
  await registerOrUpdateSpace(
    "Bnum",
    browser.runtime.getURL("content/bnum_loader.html"),
    {
      title: "Mon Compte Bnum",
      defaultIcons: {
        "16": "skin/images/moncompte2_dark.svg",
        "32": "skin/images/moncompte2_dark.svg",
      },
      themeIcons: [
        {
          "dark": "skin/images/moncompte2_light.svg",
          "light": "skin/images/moncompte2_dark.svg",
          "size": 16
        },
        {
          "dark": "skin/images/moncompte2_light.svg",
          "light": "skin/images/moncompte2_dark.svg",
          "size": 32
        }
      ],
    }
  );
}

// -----------------------------------------------------------------------
// Initialisation
// -----------------------------------------------------------------------
function webappInit() {
  browser.webappApi.init();
}

/**
 * Tente de créer les boutons SpacesToolbar, avec retries en cas d'échec.
 * La propriété tab.mailTab n'est pas fiable sur onCreated (onglet pas encore
 * initialisé), on utilise donc une stratégie de retry avec délai croissant.
 */
let _spaceButtonsCreated = false;
async function initWithRetry(attempt = 1) {
  if (_spaceButtonsCreated) return;

  // webappInit est indépendant : on ne laisse pas une erreur ici bloquer les boutons
  try {
    webappInit();
  } catch (e) {
    console.error("[WebApp] webappInit erreur:", e.message || e, e);
  }

  // Délai au premier essai pour laisser Anais/Pauline s'enregistrer au-dessus
  /*if (attempt === 1) {
    await new Promise(resolve => setTimeout(resolve, 1000));
  }*/

  try {
    await createSpaceButtons();
    _spaceButtonsCreated = true;
    console.log("[WebApp] Boutons SpacesToolbar créés (tentative", attempt, ")");
    try {
      webappInit();
    } catch (e) {
      console.error("[WebApp] webappInit post-creation erreur:", e);
    }
  } catch (e) {
    const delay = Math.min(1000 * attempt, 10000);
    console.warn("[WebApp] createSpaceButtons échec tentative", attempt,
      "— retry dans", delay, "ms:", e.message || e, e);
    if (attempt < 5) {
      setTimeout(() => initWithRetry(attempt + 1), delay);
    } else {
      console.error("[WebApp] Abandon après", attempt, "tentatives. Dernière erreur:", e);
    }
  }
}

// Lancer l'initialisation au démarrage
initWithRetry();
browser.runtime.onStartup.addListener(() => {
  _spaceButtonsCreated = false;
  initWithRetry();
});
browser.runtime.onInstalled.addListener(() => {
  _spaceButtonsCreated = false;
  initWithRetry();
});

// -----------------------------------------------------------------------
// Message depuis bnum_loader.html → login MEL puis redirection
//
// Quand l'utilisateur clique sur le bouton Bnum, TB ouvre la page locale
// bnum_loader.html. Ce script envoie le message { action: "openBnum" }.
// On effectue ici le login POST silencieux, puis on redirige l'onglet.
// -----------------------------------------------------------------------
browser.runtime.onMessage.addListener((message, sender) => {
  // ---------------------------------------------------------------
  // "openPegaseUrl" : le script d'interception des messages a détecté
  // un clic sur un lien Pégase. On ouvre l'URL dans l'onglet TB.
  // ---------------------------------------------------------------
  if (message?.action === "openPegaseUrl") {
    console.log("[WebApp] openPegaseUrl reçu:", message.url);
    pegasePendingUrl = message.url;
    openPegase();
    return;
  }

  // ---------------------------------------------------------------
  // "getCredentials" : la page bnum_loader.html demande les credentials
  // pour effectuer le login fetch dans son propre contexte d'onglet.
  // On retourne une Promise (valeur asynchrone) au message sender.
  // ---------------------------------------------------------------
  if (message?.action === "getCredentials") {
    return browser.webappApi.getCredentials();
  }

  // ---------------------------------------------------------------
  // "loginBnum" : bnum_login.js demande au background d'effectuer le
  // login via l'Experiment API (endpoint intranet, pas de restriction 2FA).
  // ---------------------------------------------------------------
  if (message?.action === "loginBnum") {
    const tabId = sender.tab?.id;
    console.log(`[WebApp] [POST BNUM Mon Compte] onMessage loginBnum reçu (tabId=${tabId}, user=${message?.user})`);
    return (async () => {
      try {
        console.log(`[WebApp] [POST BNUM Mon Compte] onMessage loginBnum: appel de webappApi.loginBnum...`);
        const status = await browser.webappApi.loginBnum(message.user, message.password);
        console.log(`[WebApp] [POST BNUM Mon Compte] onMessage loginBnum: webappApi.loginBnum terminé, status HTTP = ${status}`);
        return status;
      } catch (err) {
        console.error(`[WebApp] [POST BNUM Mon Compte] onMessage loginBnum: exception:`, err?.message || err);
        throw err;
      }
    })();
  }

  // ---------------------------------------------------------------
  // "getBnumIntendedUrl" : le content script bnum_login.js demande
  // l'URL cible (accueil ou paramètres) selon quel bouton a été cliqué.
  // L'URL a été mémorisée par tabs.onUpdated avant la redirection login.
  // ---------------------------------------------------------------
  if (message?.action === "getBnumIntendedUrl") {
    const tabId = sender.tab?.id;
    // Fallback vers default_url (paramètres Mon Compte) — destination la plus
    // sécurisée si l'URL cible n'a pas été mémorisée (ex: tabs.onUpdated non déclenché).
    const url = bnumIntendedUrl.get(tabId) || BNUM.default_url;
    bnumIntendedUrl.delete(tabId); // usage unique
    const isMonCompte = url.includes("mel_moncompte");
    console.log(`[WebApp] [POST BNUM Mon Compte] getBnumIntendedUrl tabId=${tabId} url=${url}${isMonCompte ? " (Page Mon Compte Bnum)" : ""}`);
    return Promise.resolve(url);
  }

  // ---------------------------------------------------------------
  // "openBnumHome" : la page loader BnumHome demande au background
  // de faire le login silencieux, d'ouvrir le navigateur externe,
  // puis de fermer l'onglet loader.
  // ---------------------------------------------------------------
  if (message?.action === "openBnumHome") {
    const tabId = message.tabId ?? sender.tab?.id;
    console.log("[WebApp] openBnumHome reçu, tabId=", tabId);
    (async () => {
      await openBnumHome();
      // Fermer l'onglet loader une fois le navigateur ouvert
      if (tabId != null) {
        try {
          await browser.tabs.remove(tabId);
          console.log("[WebApp] openBnumHome: onglet loader fermé (tabId=", tabId, ")");
        } catch (e) {
          console.warn("[WebApp] openBnumHome: impossible de fermer l'onglet:", e.message || e);
        }
      }
    })();
    return; // pas de valeur de retour attendue
  }

  // ---------------------------------------------------------------
  // "openBnum" : fallback — redirection directe depuis le background
  // (utilisé si le fetch depuis la page loader est impossible)
  // ---------------------------------------------------------------
  if (message?.action === "openBnum") {
    // Priorité : tabId envoyé par la page (browser.tabs.getCurrent), fallback sender.tab
    const tabId = message.tabId ?? sender.tab?.id;
    console.log("[WebApp] [POST BNUM Mon Compte] onMessage openBnum === REÇU ===");
    console.log("[WebApp] [POST BNUM Mon Compte] onMessage openBnum: message.tabId=", message.tabId,
      "sender.tab?.id=", sender.tab?.id, "tabId utilisé=", tabId);
    console.log("[WebApp] [POST BNUM Mon Compte] onMessage openBnum: sender.url=", sender.url);
    console.log("[WebApp] [POST BNUM Mon Compte] onMessage openBnum: sender.tab=", JSON.stringify(sender.tab));

    if (tabId == null) {
      console.error("[WebApp] [POST BNUM Mon Compte] openBnum: ABANDON — tabId introuvable");
      return;
    }

    (async () => {
      console.log("[WebApp] [POST BNUM Mon Compte] openBnum: getCredentials...");
      let creds;
      try {
        creds = await browser.webappApi.getCredentials();
        console.log("[WebApp] [POST BNUM Mon Compte] openBnum: getCredentials() →",
          creds ? `user=${creds.user}, password=${creds.password ? "(ok, longueur=" + creds.password.length + ")" : "(VIDE)"}` : "NULL");
      } catch (e) {
        console.error("[WebApp] [POST BNUM Mon Compte] openBnum: getCredentials() EXCEPTION:", e.message || e);
        creds = null;
      }

      if (creds) {
        console.log("[WebApp] [POST BNUM Mon Compte] openBnum: appel webappApi.loginBnum (POST login)...");
        const status = await browser.webappApi.loginBnum(creds.user, creds.password);
        console.log("[WebApp] [POST BNUM Mon Compte] openBnum: loginBnum retourné status HTTP =", status);
      } else {
        console.warn("[WebApp] [POST BNUM Mon Compte] openBnum: SKIP login — credentials null");
      }

      // Laisser un court délai (200ms) pour que le jar de cookies
      // de Thunderbird synchronise le cookie de session avant la navigation de l'onglet
      await new Promise(r => setTimeout(r, 200));
      console.log("[WebApp] [POST BNUM Mon Compte] openBnum: browser.tabs.update → tabId=", tabId, "url=", BNUM.default_url);
      try {
        await browser.tabs.update(tabId, { url: BNUM.default_url });
        console.log("[WebApp] [POST BNUM Mon Compte] openBnum: tabs.update OK");
      } catch (e) {
        console.error("[WebApp] [POST BNUM Mon Compte] openBnum: tabs.update ERREUR:", e.message || e);
      }
    })();
  }
});

// -----------------------------------------------------------------------
// Interception de la page de login Pégase (équivalent du _loadHandler legacy)
//
// TB 140 ne dispose pas de spaces.onClicked. Quand l'utilisateur clique sur
// le bouton Pégase, TB ouvre un onglet vers PEGASE.href. Si la session est
// expirée, Pégase redirige vers sa page de login (?_p=login). On détecte
// ce chargement via tabs.onUpdated et on effectue le login POST silencieux.
// -----------------------------------------------------------------------
console.log("[WebApp] Enregistrement du listener tabs.onUpdated pour login automatique Pégase");

browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // On ne réagit qu'aux changements d'URL confirmés
  if (!changeInfo.url) return;

  const url = changeInfo.url;
  console.log("[WebApp] tabs.onUpdated tabId:", tabId, "url:", url);

  // ---------------------------------------------------------------
  // Interception PSIN -> ouverture dans le navigateur externe
  // ---------------------------------------------------------------
  if (url.startsWith("https://psin.supervision.e2.rie.gouv.fr")) {
    console.log("[WebApp] PSIN détecté -> ouverture externe");
    try {
      browser.webappApi.openInBrowser(url);
      await browser.tabs.remove(tabId);
    } catch (e) {
      console.error("[WebApp] Erreur lors de l'ouverture externe ou fermeture onglet PSIN:", e);
    }
    return;
  }

  // ---------------------------------------------------------------
  // Cas 0 : La page loader BnumHome (moz-extension://) n'est pas
  // interceptée ici — le JS de la page envoie directement le message
  // "openBnumHome" au background (login + openInBrowser + fermeture onglet).
  // ---------------------------------------------------------------

  // Mémoriser toute URL Bnum non-login comme destination après login réussi.
  if (url.startsWith("https://bnum.din.gouv.fr") &&
    !url.includes("_task=login")) {
    const isMonCompte = url.includes("mel_moncompte");
    console.log(`[WebApp] [BNUM Mon Compte] destination mémorisée pour tabId ${tabId}: ${url}${isMonCompte ? " (Page Mon Compte Bnum)" : ""}`);
    bnumIntendedUrl.set(tabId, url);
  }

  // ---------------------------------------------------------------
  // Cas 1 : URL Pégase non-login → mémoriser comme destination après login
  // ---------------------------------------------------------------
  if (url.startsWith(PEGASE.url_prefix) && !url.includes("_p=login")) {
    // On mémorise cette URL comme destination potentielle après un login,
    // au cas où Pégase redirige vers ?_p=login juste après.
    pegasePendingUrl = url;
  }

  // ---------------------------------------------------------------
  // Cas 2 : Page de login Pégase (session expirée)
  // Guard : si un login est déjà en cours pour ce tab, ignorer pour
  // éviter la boucle infinie (tabs.onUpdated → login → redirect → tabs.onUpdated...).
  // ---------------------------------------------------------------
  if (url.startsWith(PEGASE.url_prefix) && url.includes("_p=login")) {

    if (pegaseLoginInProgress.has(tabId)) {
      console.log("[WebApp] Login Pégase déjà en cours pour tabId:", tabId, "— ignoré (boucle prévenue)");
      return;
    }
    pegaseLoginInProgress.add(tabId);

    console.log("[WebApp] Page de login Pégase détectée sur tabId:", tabId, "→ login automatique");

    try {
      const creds = await browser.webappApi.getCredentials();
      if (!creds) {
        console.warn("[WebApp] Credentials introuvables, Pégase affichera sa page de login");
        return;
      }

      // Login via l'Experiment API (XHR chrome-privilégié = bypass CORS)
      await browser.webappApi.loginPegase(creds.user, creds.password);

      // Rediriger vers l'URL cible mémorisée ou la page d'accueil
      const redirectTo = pegasePendingUrl || PEGASE.href;
      pegasePendingUrl = null;
      console.log("[WebApp] Redirection vers", redirectTo);
      await browser.tabs.update(tabId, { url: redirectTo });
    } finally {
      // Libérer le guard après un délai : la navigation de redirection
      // prend quelques instants, on laisse le temps à tabs.onUpdated de se
      // déclencher pour la nouvelle URL AVANT de re-accepter des logins.
      setTimeout(() => pegaseLoginInProgress.delete(tabId), 5000);
    }
    return;
  }

  // ---------------------------------------------------------------
  // Cas 3 : Page de login Bnum (Mon Compte / Roundcube)
  // Si un onglet existant se retrouve sur la page de login (ex: session expirée),
  // on le bascule immédiatement vers bnum_loader.html pour masquer la page "déconnecté"
  // et effectuer le re-login propre via openBnum.
  // ---------------------------------------------------------------
  if (url.startsWith("https://bnum.din.gouv.fr") && url.includes("_task=login")) {

    if (bnumLoginInProgress.has(tabId)) {
      console.log("[WebApp] [POST BNUM Mon Compte] Login Bnum déjà en cours pour tabId:", tabId, "— ignoré (boucle prévenue)");
      return;
    }
    bnumLoginInProgress.add(tabId);

    console.log("[WebApp] [POST BNUM Mon Compte] Page de login Bnum détectée sur tabId:", tabId, "→ bascule immédiate vers loader pour masquer l'écran");

    try {
      await browser.tabs.update(tabId, { url: browser.runtime.getURL("content/bnum_loader.html") });
    } catch (e) {
      console.error("[WebApp] [POST BNUM Mon Compte] Erreur bascule vers loader:", e.message || e);
    } finally {
      setTimeout(() => bnumLoginInProgress.delete(tabId), 5000);
    }
    return;
  }

});
