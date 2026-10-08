/*
 * WebApp2 — Experiment API (contexte chrome privilégié)
 *
 * Fournit :
 *   - getCredentials()    : récupère uid + mdp Pacome depuis nsIMsgIncomingServer
 *                           ou le login store Mozilla (realm filelink-nextcloud-melanie2)
 *   - openOrFocusTab(url, urlPrefix) : ouvre ou donne le focus à un onglet Thunderbird
 */

var { classes: Cc, interfaces: Ci, utils: Cu } = Components;
const { ExtensionCommon } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionCommon.sys.mjs"
);

// Injecter fetch (version chrome-privilégiée) dans le sandbox de l'Experiment API.
// Par défaut, ni fetch ni XMLHttpRequest ne sont disponibles comme globaux dans ce contexte.
// Cu.importGlobalProperties importe la version systême, qui bypasse CORS et partage
// le jar de cookies avec les onglets Thunderbird.
Cu.importGlobalProperties(["fetch"]);

// Séparateur d'uid partagé Pacome (ex: "jean.dupont.-.partage" → uid réduit = "jean.dupont")
const PACOME_SEP_UID = ".-.";

// Login store : realm Filelink Pacome (source persistante du mot de passe)
const FILELINK_ORIGIN = "https://bnum.din.gouv.fr";
const FILELINK_REALM = "filelink-nextcloud-melanie2";

this.webappApi = class extends ExtensionAPI {

  getAPI(context) {

    return {
      webappApi: {

        // ----------------------------------------------------------------
        // init() — installe l'intercepteur de liens Pégase au niveau chrome.
        //
        // Architecture TB 140 (découverte par diagnostic) :
        //   mail:3pane (fenêtre chrome)
        //     └─ tabmail → tabInfo.chromeBrowser → about:3pane
        //          └─ #messageBrowser → about:message  ← liens traités ici
        //
        // On patche openLinkExternally (et variantes) sur chaque fenêtre
        // de la hiérarchie, y compris via un observateur chrome-document-loaded
        // pour les rechargements futurs (changement de message, nouvelle fenêtre).
        // ----------------------------------------------------------------
        init() {
          const PEGASE = {
            name: "Pégase",
            url_prefix: "https://pegase.din.developpement-durable.gouv.fr",
            href: "https://pegase.din.developpement-durable.gouv.fr/",
            login_page: "https://pegase.din.developpement-durable.gouv.fr/?_p=login",
            external_login_url: "https://pegase.din.developpement-durable.gouv.fr/?_p=external_login",
            // %%username%% et %%password%% sont substitués avant l’envoi
            login_params: "username=%%username%%&password=%%password%%&timezone=%%timezone%%",
            request_type: "POST",
          };
          const apiSelf = this;
          const CANDIDATES = [
            "openLinkExternally", "openURL", "openUILink",
            "openWebLinkIn", "openLinkIn", "openTrustedLinkIn",
          ];

          function patchWin(w, label) {
            if (!w || w._pegase_init_done) return;
            w._pegase_init_done = true;
            const makePatch = (name, orig) => function (url, ...args) {
              const s = (typeof url === "string") ? url
                : (url?.href ?? url?.spec ?? String(url));
              if (s && s.startsWith(PEGASE.url_prefix)) {
                Services.console.logStringMessage("[WebApp] Lien P\u00e9gase intercept\u00e9 (" + label + "." + name + "): " + s);
                // apiSelf.loginPegase() traverse le bridge Experiment API
                // et s'ex\u00e9cute en contexte chrome (bypass CORS, bon jar de cookies).
                (async () => {
                  try {
                    const creds = await apiSelf.getCredentials();
                    if (creds) {
                      await apiSelf.loginPegase(creds.user, creds.password);
                    }
                  } catch (e) {
                    Services.console.logStringMessage("[WebApp] loginP\u00e9gase erreur: " + e);
                  }
                  await apiSelf.openOrFocusTab(s, PEGASE.url_prefix);
                })().catch(e =>
                  Services.console.logStringMessage("[WebApp] openPegaseLink erreur: " + e));
                return;
              }
              return orig.apply(w, [url, ...args]);
            };
            const done = [];
            for (const fn of CANDIDATES) {
              if (typeof w[fn] === "function") {
                w[fn] = makePatch(fn, w[fn]);
                done.push(fn);
              }
            }
            if (done.length) {
              Services.console.logStringMessage("[WebApp] init: intercepteur installé sur " + label + " (" + done.join(", ") + ")");
            }
          }

          function patchBrowserHierarchy(tabInfo) {
            for (const prop of ["browser", "chromeBrowser", "linkedBrowser"]) {
              const b = tabInfo[prop];
              if (!b) continue;
              try {
                const bWin = b.contentWindow;
                if (!bWin) continue;
                patchWin(bWin, prop);
                // Browsers imbriqués (messageBrowser, etc.)
                for (const ib of bWin.document?.querySelectorAll("browser") || []) {
                  try {
                    const ibWin = ib.contentWindow;
                    if (ibWin) patchWin(ibWin, "innerBrowser[" + (ib.id || ib.getAttribute("src") || "?") + "]");
                  } catch (e) { }
                }
              } catch (e) { }
            }
          }

          function injectThemeOverrideStyle(w) {
            try {
              if (!w || !w.document) return;
              const STYLE_ID = "webapp-spaces-theme-override";
              if (!w.document.getElementById(STYLE_ID)) {
                const styleEl = w.document.createElementNS("http://www.w3.org/1999/xhtml", "style");
                styleEl.id = STYLE_ID;
                styleEl.textContent = `
                  /* 1. PAR DÉFAUT (thème clair) : toujours afficher l'icône sombre pour éviter clair sur clair */
                  .spaces-addon-button img,
                  .spaces-addon-menuitem {
                    content: var(--webextension-toolbar-image-dark, inherit) !important;
                    --menuitem-icon: var(--webextension-toolbar-image-dark, inherit) !important;
                  }

                  /* 2. THÈME SOMBRE : basculer sur l'icône claire */
                  :root[lwtheme-brighttext] .spaces-addon-button img,
                  :root[lwt-tree-brighttext] .spaces-addon-button img,
                  :root[data-spaces-theme-mode="dark"] .spaces-addon-button img,
                  #spacesToolbar[data-theme-mode="dark"] .spaces-addon-button img,
                  :root[lwtheme-brighttext] .spaces-addon-menuitem,
                  :root[lwt-tree-brighttext] .spaces-addon-menuitem,
                  :root[data-spaces-theme-mode="dark"] .spaces-addon-menuitem,
                  #spacesToolbar[data-theme-mode="dark"] .spaces-addon-menuitem {
                    content: var(--webextension-toolbar-image-light, inherit) !important;
                    --menuitem-icon: var(--webextension-toolbar-image-light, inherit) !important;
                  }

                  /* 3. THÈME CLAIR EXPLICITE */
                  :root[data-spaces-theme-mode="light"] .spaces-addon-button img,
                  #spacesToolbar[data-theme-mode="light"] .spaces-addon-button img,
                  :root[data-spaces-theme-mode="light"] .spaces-addon-menuitem,
                  #spacesToolbar[data-theme-mode="light"] .spaces-addon-menuitem {
                    content: var(--webextension-toolbar-image-dark, inherit) !important;
                    --menuitem-icon: var(--webextension-toolbar-image-dark, inherit) !important;
                  }

                  /* 4. MODE SOMBRE SYSTÈME (OS) si Thunderbird n'impose pas un thème clair */
                  @media (prefers-color-scheme: dark) {
                    :root:not([lwtheme]) .spaces-addon-button img,
                    :root[lwtheme-brighttext] .spaces-addon-button img,
                    :root:not([lwtheme]) .spaces-addon-menuitem,
                    :root[lwtheme-brighttext] .spaces-addon-menuitem {
                      content: var(--webextension-toolbar-image-light, inherit) !important;
                      --menuitem-icon: var(--webextension-toolbar-image-light, inherit) !important;
                    }
                  }
                `;
                (w.document.head || w.document.documentElement).appendChild(styleEl);
                Services.console.logStringMessage("[WebApp] Style de détection de thème injecté avec succès");
              }
            } catch (e) {
              Services.console.logStringMessage("[WebApp] Erreur injection style de thème: " + e);
            }
          }

          function setupSpacesToolbarObserver(w) {
            try {
              if (!w || !w.document) return;
              injectThemeOverrideStyle(w);

              const toolbar = w.document.getElementById("spacesToolbar");
              if (!toolbar) {
                Services.console.logStringMessage("[WebApp] setupSpacesToolbarObserver: spacesToolbar introuvable, nouvelle tentative différée...");
                w.setTimeout(() => setupSpacesToolbarObserver(w), 250);
                return;
              }

              // Déconnecter l'ancien observateur s'il existe pour éviter les conflits
              if (w._webapp_spaces_observer) {
                try {
                  w._webapp_spaces_observer.disconnect();
                  Services.console.logStringMessage("[WebApp] setupSpacesToolbarObserver: Ancien MutationObserver déconnecté avec succès");
                } catch (e) {
                  Services.console.logStringMessage("[WebApp] Erreur déconnexion ancien observer: " + e);
                }
                w._webapp_spaces_observer = null;
              }

              const updateToolbarTheme = () => {
                try {
                  let isDark = false;

                  // 1. Détection par colorScheme Gecko/CSS sur la barre d'espaces ou la racine
                  const tbCs = w.getComputedStyle(toolbar)?.colorScheme;
                  const rootCs = w.getComputedStyle(w.document.documentElement)?.colorScheme;
                  if (tbCs === "dark" || rootCs === "dark") {
                    isDark = true;
                  } else if (tbCs === "light" || rootCs === "light") {
                    isDark = false;
                  } else {
                    // 2. Détection par la luminosité de la couleur de texte / icône native de la SpacesToolbar
                    // (Thunderbird applique currentColor avec fill/stroke sur ses icônes SVG natives)
                    const sampleBtn = toolbar.querySelector(".spaces-toolbar-button") || toolbar.querySelector("button");
                    const sampleEl = sampleBtn || toolbar;
                    const computedColor = w.getComputedStyle(sampleEl)?.color || "";
                    const rgbMatch = computedColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
                    if (rgbMatch) {
                      const r = parseInt(rgbMatch[1], 10);
                      const g = parseInt(rgbMatch[2], 10);
                      const b = parseInt(rgbMatch[3], 10);
                      const brightness = (r * 299 + g * 587 + b * 114) / 1000;
                      isDark = brightness > 128;
                    } else {
                      // 3. Fallback sur le media query standard prefers-color-scheme
                      isDark = w.matchMedia?.("(prefers-color-scheme: dark)")?.matches || false;
                    }
                  }

                  const mode = isDark ? "dark" : "light";
                  if (toolbar.getAttribute("data-theme-mode") !== mode) {
                    toolbar.setAttribute("data-theme-mode", mode);
                    w.document.documentElement?.setAttribute("data-spaces-theme-mode", mode);
                    Services.console.logStringMessage(`[WebApp] Thème spacesToolbar détecté: ${mode}`);
                  }
                } catch (e) {
                  Services.console.logStringMessage("[WebApp] Erreur détection thème: " + e);
                }
              };

              // Écouter les changements de thème dynamique
              if (w._webapp_theme_listener) {
                try {
                  w.removeEventListener("windowlwthemeupdate", w._webapp_theme_listener);
                } catch (e) { }
                w._webapp_theme_listener = null;
              }
              w._webapp_theme_listener = updateToolbarTheme;
              w.addEventListener("windowlwthemeupdate", updateToolbarTheme);

              if (w._webapp_media_listener && w._webapp_mql?.removeEventListener) {
                try {
                  w._webapp_mql.removeEventListener("change", w._webapp_media_listener);
                } catch (e) { }
              }
              try {
                const mql = w.matchMedia("(prefers-color-scheme: dark)");
                if (mql?.addEventListener) {
                  w._webapp_mql = mql;
                  w._webapp_media_listener = updateToolbarTheme;
                  mql.addEventListener("change", updateToolbarTheme);
                }
              } catch (e) { }

              const cleanMisplacedButtons = () => {
                try {
                  const bottomContainer = w.document.querySelector(".spaces-toolbar-bottom-container");
                  const addonsContainer = w.document.getElementById("spacesToolbarAddonsContainer") ||
                    w.document.querySelector(".spaces-toolbar-container:not(.spaces-toolbar-top-container):not(.spaces-toolbar-bottom-container)");

                  if (bottomContainer && addonsContainer) {
                    const buttons = bottomContainer.querySelectorAll("button");
                    for (const btn of buttons) {
                      if (btn.id === "settingsButton" || btn.id === "collapseButton" || btn.id === "assistantPacome") {
                        continue;
                      }

                      const id = btn.id || "";
                      const title = (btn.title || btn.getAttribute("title") || btn.getAttribute("tooltiptext") || "").toLowerCase();
                      const imgSrc = (btn.querySelector("img")?.src || "").toLowerCase();
                      const imgStyle = (btn.querySelector("img")?.getAttribute("style") || "").toLowerCase();
                      const btnStyle = (btn.getAttribute("style") || "").toLowerCase();

                      // Mon Compte Bnum a pour ID de space "Bnum" (exactement), donc son ID de widget contient "Bnum" mais pas "BnumHome".
                      // Son titre contient "Mon Compte" et son icône contient "moncompte2".
                      const isMonCompte =
                        (id.toLowerCase().includes("bnum") && !id.toLowerCase().includes("bnumhome")) ||
                        title.includes("mon compte") ||
                        title.includes("moncompte") ||
                        imgSrc.includes("moncompte") ||
                        imgStyle.includes("moncompte") ||
                        btnStyle.includes("moncompte");

                      if (!isMonCompte) {
                        addonsContainer.appendChild(btn);
                        Services.console.logStringMessage(`[WebApp] Nettoyage : bouton ${id} (${title}) replacé en haut`);
                      }
                    }
                  }
                } catch (e) {
                  Services.console.logStringMessage("[WebApp] Erreur lors du nettoyage : " + e);
                }
              };

              const moveBnumButton = () => {
                try {
                  updateToolbarTheme();
                  cleanMisplacedButtons();
                  const buttons = toolbar.querySelectorAll("button");

                  let bnumBtn = null;
                  for (const btn of buttons) {
                    const id = btn.id || "";
                    const title = (btn.title || btn.getAttribute("title") || btn.getAttribute("tooltiptext") || "").toLowerCase();
                    const imgSrc = (btn.querySelector("img")?.src || "").toLowerCase();
                    const imgStyle = (btn.querySelector("img")?.getAttribute("style") || "").toLowerCase();
                    const btnStyle = (btn.getAttribute("style") || "").toLowerCase();

                    const isMonCompte =
                      (id.toLowerCase().includes("bnum") && !id.toLowerCase().includes("bnumhome")) ||
                      title.includes("mon compte") ||
                      title.includes("moncompte") ||
                      imgSrc.includes("moncompte") ||
                      imgStyle.includes("moncompte") ||
                      btnStyle.includes("moncompte");

                    if (isMonCompte) {
                      bnumBtn = btn;
                      break;
                    }
                  }
                  if (bnumBtn) {
                    const bottomContainer = w.document.querySelector(".spaces-toolbar-bottom-container");
                    const settingsBtn = w.document.getElementById("settingsButton");
                    if (bottomContainer && bnumBtn.parentNode !== bottomContainer) {
                      if (settingsBtn && settingsBtn.parentNode === bottomContainer) {
                        bottomContainer.insertBefore(bnumBtn, settingsBtn);
                      } else {
                        bottomContainer.appendChild(bnumBtn);
                      }
                      Services.console.logStringMessage("[WebApp] Observer: Bouton Mon Compte Bnum déplacé en bas");
                    }
                  }
                } catch (e) {
                  Services.console.logStringMessage("[WebApp] Erreur déplacement bouton: " + e);
                }
              };

              w._webapp_moveBnum = moveBnumButton;

              // Observer les changements dans le toolbar
              const observer = new (w.MutationObserver || MutationObserver)(moveBnumButton);
              observer.observe(toolbar, { childList: true, subtree: true });
              const addonsContainer = w.document.getElementById("spacesToolbarAddonsContainer");
              if (addonsContainer && addonsContainer !== toolbar) {
                observer.observe(addonsContainer, { childList: true, subtree: true });
              }
              w._webapp_spaces_observer = observer;

              // Tenter des déplacements et détections immédiats et différés
              updateToolbarTheme();
              moveBnumButton();
              w.setTimeout(() => {
                updateToolbarTheme();
                moveBnumButton();
              }, 200);
              w.setTimeout(() => {
                updateToolbarTheme();
                moveBnumButton();
              }, 500);
              w.setTimeout(() => {
                updateToolbarTheme();
                moveBnumButton();
              }, 1500);
              w.setTimeout(() => {
                updateToolbarTheme();
                moveBnumButton();
              }, 3000);
              w.setTimeout(() => {
                updateToolbarTheme();
                moveBnumButton();
              }, 6000);
            } catch (err) {
              Services.console.logStringMessage("[WebApp] Erreur dans setupSpacesToolbarObserver: " + err);
            }
          }

          try {
            function initSingleWindow(w) {
              if (!w) return;
              if (w._webapp_window_init_done) {
                if (w._webapp_moveBnum) {
                  w._webapp_moveBnum();
                }
                return;
              }
              w._webapp_window_init_done = true;

              patchWin(w, "mail:3pane");
              injectThemeOverrideStyle(w);

              // Masquer le bouton de messagerie instantanée (Chat) de la SpacesToolbar
              try {
                const chatBtn = w.document?.getElementById("chatButton");
                if (chatBtn) {
                  chatBtn.style.display = "none";
                  Services.console.logStringMessage("[WebApp] Bouton Discussion (chatButton) masqué");
                }
              } catch (err) {}

              try {
                setupSpacesToolbarObserver(w);
              } catch (err) {
                Services.console.logStringMessage("[WebApp] Erreur setupSpacesToolbarObserver: " + err);
              }

              const tabmail = w.document?.getElementById("tabmail");
              if (tabmail?.tabInfo) {
                for (const tabInfo of tabmail.tabInfo) {
                  try { patchBrowserHierarchy(tabInfo); } catch (e) {}
                }
              }
            }

            const WM = Cc["@mozilla.org/appshell/window-mediator;1"]
              .getService(Ci.nsIWindowMediator);

            // Initialiser les fenêtres déjà ouvertes
            const enumerator = WM.getEnumerator("mail:3pane");
            let winCount = 0;
            while (enumerator.hasMoreElements()) {
              const win = enumerator.getNext();
              initSingleWindow(win);
              winCount++;
            }
            Services.console.logStringMessage(`[WebApp] init: ${winCount} fenêtre(s) mail:3pane initialisée(s) au démarrage`);

            // Écouter les fenêtres futures via window-mediator
            const winListener = {
              onOpenWindow(xulWin) {
                try {
                  const domWin = xulWin.docShell?.domWindow;
                  if (domWin) {
                    domWin.addEventListener(
                      "DOMContentLoaded",
                      () => {
                        try {
                          const href = domWin.location?.href || "";
                          const winType = domWin.document?.documentElement?.getAttribute("windowtype") || "";
                          if (winType === "mail:3pane" || href.includes("messenger.xhtml") || href.includes("3pane")) {
                            domWin.setTimeout(() => initSingleWindow(domWin), 50);
                          }
                        } catch (e) {}
                      },
                      { once: true }
                    );
                  }
                } catch (e) {}
              },
              onCloseWindow() {},
              onWindowTitleChange() {},
            };
            WM.addListener(winListener);

            // Observer les futurs chargements de documents chrome
            const docObserver = {
              observe(subject, topic, data) {
                try {
                  const w = subject?.defaultView;
                  if (!w) return;
                  const href = w.location?.href || "";
                  if (href.includes("3pane") || href.includes("message") || href.includes("mail")) {
                    patchWin(w, "observed:" + href.split("/").pop());
                  }
                  if (href.includes("messenger.xhtml") || href.includes("3pane")) {
                    w.setTimeout(() => initSingleWindow(w), 50);
                  }
                } catch (e) {}
              }
            };
            Services.obs.addObserver(docObserver, "chrome-document-loaded");

            context.callOnClose({
              close() {
                try {
                  WM.removeListener(winListener);
                } catch (e) {}
                try {
                  Services.obs.removeObserver(docObserver, "chrome-document-loaded");
                } catch (e) {}
                try {
                  const enumerator = WM.getEnumerator("mail:3pane");
                  while (enumerator.hasMoreElements()) {
                    const w = enumerator.getNext();
                    if (w._webapp_spaces_observer) {
                      w._webapp_spaces_observer.disconnect();
                      w._webapp_spaces_observer = null;
                    }
                    if (w._webapp_theme_listener) {
                      w.removeEventListener("windowlwthemeupdate", w._webapp_theme_listener);
                      w._webapp_theme_listener = null;
                    }
                    if (w._webapp_media_listener && w._webapp_mql?.removeEventListener) {
                      w._webapp_mql.removeEventListener("change", w._webapp_media_listener);
                      w._webapp_media_listener = null;
                    }
                    w._webapp_window_init_done = false;
                  }
                } catch (e) {}
              }
            });

          } catch (e) {
            Services.console.logStringMessage("[WebApp] init: ERREUR: " + e + "
" + e.stack);
          }
        },

        // ----------------------------------------------------------------
        // getCredentials()
        // Cherche le compte Pacome principal (IMAP/POP3 avec pacome.confid).
        // Retourne { user: <uid_réduit>, password: <mdp> } ou null.
        //
        // Ordre de priorité :
        //   1) nsIMsgIncomingServer.password (en mémoire, mis à jour par Pacome au login)
        //   2) Services.logins (realm filelink-nextcloud-melanie2) — persisté sur disque
        // ----------------------------------------------------------------
        async getCredentials() {
          try {
            const { MailServices } = ChromeUtils.importESModule(
              "resource:///modules/MailServices.sys.mjs"
            );

            Services.console.logStringMessage("[WebApp] getCredentials: démarrage");

            // --- Trouver le compte Pacome principal ---
            let account = null;
            try {
              const def = MailServices.accounts.defaultAccount;
              const confid = def?.incomingServer?.getStringValue("pacome.confid");
              Services.console.logStringMessage("[WebApp] getCredentials: defaultAccount srv="
                + (def?.incomingServer?.hostName || "null")
                + " type=" + (def?.incomingServer?.type || "null")
                + " pacome.confid=" + (confid || "(vide)"));
              if (confid) account = def;
            } catch (e) {
              Services.console.logStringMessage("[WebApp] getCredentials: defaultAccount erreur: " + e);
            }

            if (!account) {
              Services.console.logStringMessage("[WebApp] getCredentials: parcours de tous les comptes...");
              for (const acc of MailServices.accounts.accounts) {
                const srv = acc.incomingServer;
                const confid = srv.getStringValue("pacome.confid");
                Services.console.logStringMessage("[WebApp] getCredentials: compte srv="
                  + srv.hostName + " type=" + srv.type + " pacome.confid=" + (confid || "(vide)"));
                if ((srv.type === "imap" || srv.type === "pop3") && confid) {
                  account = acc;
                  break;
                }
              }
            }

            if (!account) {
              Services.console.logStringMessage("[WebApp] getCredentials: aucun compte Pacome trouvé");
              return null;
            }

            const server = account.incomingServer;
            Services.console.logStringMessage("[WebApp] getCredentials: compte Pacome trouvé: "
              + server.hostName + " username=" + server.username);

            // Uid réduit
            const fullUid = server.username;
            const uid = fullUid.split(PACOME_SEP_UID)[0];
            Services.console.logStringMessage("[WebApp] getCredentials: fullUid=" + fullUid + " uid=" + uid);

            // --- Source 1 : mot de passe en mémoire ---
            let password = server.password;
            Services.console.logStringMessage("[WebApp] getCredentials: server.password "
              + (password ? "(rempli, longueur=" + password.length + ")" : "(vide ou null)"));

            // --- Source 2 : login store Mozilla ---
            if (!password) {
              Services.console.logStringMessage("[WebApp] getCredentials: tentative login store origin="
                + FILELINK_ORIGIN + " realm=" + FILELINK_REALM);
              try {
                const logins = Services.logins.findLogins(
                  FILELINK_ORIGIN, null, FILELINK_REALM
                );
                Services.console.logStringMessage("[WebApp] getCredentials: login store: "
                  + logins.length + " entrée(s) trouvée(s)");
                for (const login of logins) {
                  const loginUid = login.username.split(PACOME_SEP_UID)[0];
                  Services.console.logStringMessage("[WebApp] getCredentials: store entry username=" + login.username
                    + " loginUid=" + loginUid + " match=" + (loginUid === uid));
                  if (loginUid === uid) {
                    password = login.password;
                    break;
                  }
                }
              } catch (e) {
                Services.console.logStringMessage("[WebApp] getCredentials: erreur login store: " + e);
              }
            }

            if (!password) {
              Services.console.logStringMessage("[WebApp] getCredentials: mot de passe introuvable pour uid: " + uid);
              return null;
            }

            Services.console.logStringMessage("[WebApp] getCredentials: credentials OK pour uid: " + uid);
            return { user: uid, password };

          } catch (e) {
            Services.console.logStringMessage("[WebApp] getCredentials: exception générale: " + e);
            return null;
          }
        },

        // ----------------------------------------------------------------
        // openOrFocusTab(url, urlPrefix)
        // Parcourt les onglets Thunderbird existants. Si un onglet dont
        // l'URL commence par urlPrefix est trouvé, il reçoit le focus.
        // Sinon, crée un nouvel onglet avec url.
        // ----------------------------------------------------------------
        async openOrFocusTab(url, urlPrefix) {
          try {
            const WM = Cc["@mozilla.org/appshell/window-mediator;1"]
              .getService(Ci.nsIWindowMediator);
            const win = WM.getMostRecentWindow("mail:3pane");
            Services.console.logStringMessage("[WebApp] openOrFocusTab: url=" + url
              + " win=" + (win ? "ok" : "null"));
            if (!win) return;

            const tabmail = win.document.getElementById("tabmail");
            Services.console.logStringMessage("[WebApp] openOrFocusTab: tabmail=" + (tabmail ? "ok" : "null"));
            if (!tabmail) return;

            Services.console.logStringMessage("[WebApp] openOrFocusTab: " + tabmail.tabInfo.length + " onglet(s) ouverts");

            // Chercher un onglet existant dont l'URL correspond
            for (const tabInfo of tabmail.tabInfo) {
              const browser = tabInfo.browser;
              if (!browser) continue;
              const tabUrl = browser.currentURI?.spec || "";
              Services.console.logStringMessage("[WebApp] openOrFocusTab: onglet url=" + tabUrl
                + " match=" + tabUrl.startsWith(urlPrefix));
              if (tabUrl.startsWith(urlPrefix)) {
                tabmail.switchToTab(tabInfo);
                win.focus();
                Services.console.logStringMessage("[WebApp] openOrFocusTab: switch vers onglet existant");
                return;
              }
            }

            Services.console.logStringMessage("[WebApp] openOrFocusTab: ouverture nouvel onglet (différé)");
            win.setTimeout(() => {
              try {
                // TB 115+ : paramètre "url"
                tabmail.openTab("contentTab", { url });
              } catch (e1) {
                try {
                  // Fallback TB <115 : paramètre "contentPage"
                  tabmail.openTab("contentTab", { contentPage: url, clickHandler: "return true;" });
                } catch (e2) {
                  Services.console.logStringMessage("[WebApp] openTab erreur: " + e1 + " / " + e2);
                }
              }
              win.focus();
            }, 0);
            win.focus();

          } catch (e) {
            Services.console.logStringMessage("[WebApp] openOrFocusTab: exception: " + e);
          }
        },

        // ----------------------------------------------------------------
        // loginPegase(user, password)
        // Login POST silencieux sur Pégase via fetch() chrome-privilégié.
        // En contexte Experiment API, fetch() bypasse CORS et partage
        // le jar de cookies avec les onglets Thunderbird.
        // ----------------------------------------------------------------
        async loginPegase(user, password) {
          const LOGIN_URL = "https://pegase.din.developpement-durable.gouv.fr/?_p=external_login";
          const timezone = "Europe/Paris";
          const params = "username=" + encodeURIComponent(user)
            + "&password=" + encodeURIComponent(password)
            + "&timezone=" + encodeURIComponent(timezone);

          Services.console.logStringMessage("[WebApp] loginPegase: user=" + user);

          try {
            const response = await fetch(LOGIN_URL, {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: params,
              credentials: "include",
            });
            Services.console.logStringMessage("[WebApp] loginPegase: HTTP " + response.status
              + " url=" + response.url);
            return response.status;
          } catch (e) {
            Services.console.logStringMessage("[WebApp] loginPegase: exception: " + e);
            return 0;
          }
        },

        // ----------------------------------------------------------------
        // loginBnum(user, password)
        // Login POST MEL (Bnum/Roundcube) via fetch() chrome-privilégié.
        // Contexte chrome = bypass CORS + même jar de cookies que les onglets TB.
        // ----------------------------------------------------------------
        async loginBnum(user, password) {
          // Appel direct sur bnum.din.gouv.fr pour éviter la redirection cross-domain 307
          // (developpement-durable.gouv.fr -> din.gouv.fr) qui perd/partitionne les cookies de session.
          const LOGIN_URL = "https://bnum.din.gouv.fr/?_task=login&_courrielleur=1";

          Services.console.logStringMessage("[WebApp] [POST BNUM Mon Compte] loginBnum: Début authentification POST pour user=" + user);
          Services.console.logStringMessage("[WebApp] [POST BNUM Mon Compte] loginBnum: URL cible POST = " + LOGIN_URL);

          // Encodage ISO-8859-15 identique à la legacy
          let encodedUser, encodedPass;
          try {
            const encoder = Cc["@mozilla.org/intl/texttosuburi;1"]
              .getService(Ci.nsITextToSubURI);
            encodedUser = encoder.ConvertAndEscape("ISO-8859-15", user);
            encodedPass = encoder.ConvertAndEscape("ISO-8859-15", password);
            Services.console.logStringMessage("[WebApp] [POST BNUM Mon Compte] loginBnum: encodage ISO-8859-15 OK");
          } catch (e) {
            Services.console.logStringMessage("[WebApp] [POST BNUM Mon Compte] loginBnum: nsITextToSubURI indisponible, fallback UTF-8: " + e);
            encodedUser = encodeURIComponent(user);
            encodedPass = encodeURIComponent(password);
          }

          // Étape 1 : Initialisation de la session Roundcube via un GET préalable.
          // Roundcube exige qu'un cookie de session (roundcube_sessid) et un jeton CSRF (_token)
          // soient déjà initialisés AVANT le traitement du POST d'authentification.
          // Sans ce GET, le premier POST arrive sur une session vide et Roundcube répond "Déconnecté"
          // (ce qui forçait l'utilisateur à devoir insister au 2e essai quand le cookie était enfin présent).
          let token = null;
          try {
            Services.console.logStringMessage("[WebApp] [POST BNUM Mon Compte] Étape 1 : Initialisation session Roundcube via GET préalable...");
            const getResp = await fetch(LOGIN_URL, {
              method: "GET",
              credentials: "include",
            });
            const getHtml = await getResp.text();
            const tokenMatch = getHtml.match(/name="_token"\s+value="([^"]+)"/i) || getHtml.match(/_token:\s*'([^']+)'/i);
            if (tokenMatch) {
              token = tokenMatch[1];
              Services.console.logStringMessage("[WebApp] [POST BNUM Mon Compte] Jeton CSRF _token récupéré avec succès : " + token);
            } else {
              Services.console.logStringMessage("[WebApp] [POST BNUM Mon Compte] Aucun jeton _token trouvé dans le HTML du GET (poursuite sans token)");
            }
          } catch (getErr) {
            Services.console.logStringMessage("[WebApp] [POST BNUM Mon Compte] Avertissement échec du GET préalable : " + getErr);
          }

          let params = "_user=" + encodedUser
            + "&_pass=" + encodedPass
            + "&_task=login&_action=login&_keeplogin=1";
          if (token) {
            params += "&_token=" + encodeURIComponent(token);
          }

          const maskedParams = "_user=" + encodedUser + "&_pass=***&_task=login&_action=login&_keeplogin=1" + (token ? "&_token=" + token : "");
          Services.console.logStringMessage("[WebApp] [POST BNUM Mon Compte] Étape 2 : Paramètres POST (mdp masqué) = " + maskedParams + " (longueur body: " + params.length + " octets)");

          const startTime = Date.now();
          try {
            // Utiliser le fetch global de l'Experiment API (le fetch de win/messenger.xhtml est bloqué par le CSP 'default-src chrome:')
            Services.console.logStringMessage("[WebApp] [POST BNUM Mon Compte] Envoi de la requête fetch POST...");

            const response = await fetch(LOGIN_URL, {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: params,
              credentials: "include",
            });
            const elapsed = Date.now() - startTime;
            Services.console.logStringMessage("[WebApp] [POST BNUM Mon Compte] loginBnum: Réponse POST reçue en " + elapsed + "ms → HTTP "
              + response.status + " " + response.statusText + ", url finale = " + response.url);
            Services.console.logStringMessage("[WebApp] [POST BNUM Mon Compte] loginBnum: En-têtes réponse → Content-Type: "
              + (response.headers.get("content-type") || "non défini")
              + ", Location: " + (response.headers.get("location") || "aucune"));

            // Inspection des cookies enregistrés dans Services.cookies pour bnum.din.gouv.fr
            try {
              const cookieMgr = Services.cookies;
              const cookies = cookieMgr.getCookiesFromHost("bnum.din.gouv.fr", {});
              const list = [];
              if (cookies) {
                if (typeof cookies.hasMoreElements === "function") {
                  while (cookies.hasMoreElements()) {
                    const c = cookies.getNext().QueryInterface(Ci.nsICookie);
                    list.push(`${c.name}=${c.value ? c.value.substring(0, 8) : ""}... (host=${c.host || c.domain}, path=${c.path})`);
                  }
                } else {
                  for (const c of cookies) {
                    list.push(`${c.name}=${c.value ? c.value.substring(0, 8) : ""}... (host=${c.host || c.domain}, path=${c.path})`);
                  }
                }
              }
              Services.console.logStringMessage("[WebApp] [POST BNUM Mon Compte] Cookies stockés pour bnum.din.gouv.fr (" + list.length + ") : " + (list.join(" | ") || "AUCUN"));
            } catch (cookieErr) {
              Services.console.logStringMessage("[WebApp] [POST BNUM Mon Compte] Erreur lecture cookies: " + cookieErr);
            }

            // Vérifier si le login a réussi :
            // Ne pas tester _task=login car il peut être présent dans les liens d'une page valide.
            // On vérifie la présence d'erreurs réelles ou si le champ de mot de passe est encore affiché.
            const body = await response.text();
            const bodyLength = body ? body.length : 0;
            const hasInvalidCreds = body && body.includes("Invalid credentials");
            const hasLoginError = body && (body.includes("login_error") || body.includes("rcmloginerror") || body.includes("mot de passe incorrect"));
            const hasPasswordField = body && (body.includes('name="_pass"') || body.includes("rcmloginpwd"));
            const failed = hasInvalidCreds || hasLoginError || hasPasswordField;

            if (failed) {
              const reasons = [];
              if (hasInvalidCreds) reasons.push("'Invalid credentials'");
              if (hasLoginError) reasons.push("erreur de login détectée");
              if (hasPasswordField) reasons.push("formulaire de mot de passe toujours présent");
              Services.console.logStringMessage("[WebApp] [POST BNUM Mon Compte] loginBnum: Formulaire/erreur détecté (" + reasons.join(", ") + "), bodyLength=" + bodyLength);
            } else {
              Services.console.logStringMessage("[WebApp] [POST BNUM Mon Compte] loginBnum: Session authentifiée avec succès (pas de formulaire de login en retour), bodyLength=" + bodyLength);
            }
            return response.status;
          } catch (e) {
            const elapsed = Date.now() - startTime;
            Services.console.logStringMessage("[WebApp] [POST BNUM Mon Compte] loginBnum: Exception après " + elapsed + "ms: " + (e.stack || e.message || e));
            return 0;
          }
        },

        // ----------------------------------------------------------------
        // openInBrowser(url)
        // Ouvre une URL dans le navigateur externe par défaut du système.
        // Utilise nsIExternalProtocolService (API chrome Thunderbird).
        // ----------------------------------------------------------------
        openInBrowser(url) {
          try {
            const uri = Services.io.newURI(url);
            const eps = Cc["@mozilla.org/uriloader/external-protocol-service;1"]
              .getService(Ci.nsIExternalProtocolService);
            const handlerInfo = eps.getProtocolHandlerInfo("https");
            handlerInfo.launchWithURI(uri, null);
            Services.console.logStringMessage("[WebApp] openInBrowser: launchWithURI OK → " + url);
          } catch (e) {
            Services.console.logStringMessage("[WebApp] openInBrowser: launchWithURI échec (" + e + ") → fallback ShellExecute");
          }
          return;
        }
      }
    };
  }
};
