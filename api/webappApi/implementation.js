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

          function setupSpacesToolbarObserver(w) {
            try {
              const toolbar = w.document?.getElementById("spacesToolbar");
              if (!toolbar) {
                Services.console.logStringMessage("[WebApp] setupSpacesToolbarObserver: spacesToolbar introuvable dans cette fenêtre");
                return;
              }

              // Déconnecter l'ancien observateur s'il existe pour éviter le détournement par l'ancien code sur reload
              if (w._webapp_spaces_observer) {
                try {
                  w._webapp_spaces_observer.disconnect();
                  Services.console.logStringMessage("[WebApp] setupSpacesToolbarObserver: Ancien MutationObserver déconnecté avec succès");
                } catch (e) {
                  Services.console.logStringMessage("[WebApp] Erreur déconnexion ancien observer: " + e);
                }
                w._webapp_spaces_observer = null;
              }

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
                      const title = btn.getAttribute("title") || btn.getAttribute("tooltiptext") || "";
                      const imgSrc = btn.querySelector("img")?.src || "";

                      // Mon Compte Bnum a pour ID de space "Bnum" (exactement), donc son ID de widget contient "Bnum" mais pas "BnumHome".
                      // Son titre contient "Mon Compte" et son icône contient "moncompte2".
                      const isMonCompte = (id.includes("Bnum") && !id.includes("BnumHome")) ||
                        title.toLowerCase().includes("mon compte") ||
                        imgSrc.toLowerCase().includes("moncompte2");

                      //Services.console.logStringMessage(`[WebApp DEBUG] Nettoyage - Bouton en bas : ID="${id}" Title="${title}" ImgSrc="${imgSrc}" isMonCompte=${isMonCompte}`);

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
                  cleanMisplacedButtons();
                  const buttons = toolbar.querySelectorAll("button");

                  //Services.console.logStringMessage(`[WebApp DEBUG] moveBnumButton: parcours de ${buttons.length} boutons`);

                  let bnumBtn = null;
                  for (const btn of buttons) {
                    const id = btn.id || "";
                    const title = btn.getAttribute("title") || btn.getAttribute("tooltiptext") || "";
                    const imgSrc = btn.querySelector("img")?.src || "";

                    const isMonCompte = (id.includes("Bnum") && !id.includes("BnumHome")) ||
                      title.toLowerCase().includes("mon compte") ||
                      imgSrc.toLowerCase().includes("moncompte2");

                    //Services.console.logStringMessage(`[WebApp DEBUG] Bouton analysé : ID="${id}" Title="${title}" ImgSrc="${imgSrc}" isMonCompte=${isMonCompte} Parent="${btn.parentNode?.id || btn.parentNode?.className}"`);

                    if (isMonCompte) {
                      bnumBtn = btn;
                      break;
                    }
                  }
                  if (bnumBtn) {
                    const bottomContainer = w.document.querySelector(".spaces-toolbar-bottom-container");
                    const settingsBtn = w.document.getElementById("settingsButton");
                    if (bottomContainer && settingsBtn && bnumBtn.parentNode !== bottomContainer) {
                      bottomContainer.insertBefore(bnumBtn, settingsBtn);
                      Services.console.logStringMessage("[WebApp] Observer: Bouton Mon Compte Bnum déplacé en bas");
                    }
                  }
                } catch (e) {
                  Services.console.logStringMessage("[WebApp] Erreur déplacement bouton: " + e);
                }
              };

              // Observer les changements dans le toolbar
              const observer = new (w.MutationObserver || MutationObserver)(moveBnumButton);
              observer.observe(toolbar, { childList: true, subtree: true });
              w._webapp_spaces_observer = observer;

              // Tenter des déplacements immédiats et différés
              moveBnumButton();
              w.setTimeout(moveBnumButton, 500);
              w.setTimeout(moveBnumButton, 1500);
              w.setTimeout(moveBnumButton, 3000);
            } catch (err) {
              Services.console.logStringMessage("[WebApp] Erreur dans setupSpacesToolbarObserver: " + err);
            }
          }

          try {
            const WM = Cc["@mozilla.org/appshell/window-mediator;1"]
              .getService(Ci.nsIWindowMediator);
            const win = WM.getMostRecentWindow("mail:3pane");
            if (!win) {
              Services.console.logStringMessage("[WebApp] init: fenêtre mail:3pane introuvable");
              return;
            }

            patchWin(win, "mail:3pane");

            // Masquer le bouton de messagerie instantanée (Chat) de la SpacesToolbar
            try {
              const chatBtn = win.document.getElementById("chatButton");
              if (chatBtn) {
                chatBtn.style.display = "none";
                Services.console.logStringMessage("[WebApp] Bouton Discussion (chatButton) masqué");
              }
            } catch (err) {
              Services.console.logStringMessage("[WebApp] Erreur lors du masquage de chatButton: " + err);
            }

            try {
              setupSpacesToolbarObserver(win);
            } catch (err) {
              Services.console.logStringMessage("[WebApp] Erreur setup observer principal: " + err);
            }

            const tabmail = win.document.getElementById("tabmail");
            if (tabmail) {
              for (const tabInfo of tabmail.tabInfo) {
                try { patchBrowserHierarchy(tabInfo); } catch (e) { }
              }
            }

            // Observer les futurs chargements de documents chrome
            // (about:message se recharge à chaque changement de message sélectionné)
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
                    w.setTimeout(() => {
                      try {
                        const chatBtn = w.document?.getElementById("chatButton");
                        if (chatBtn) {
                          chatBtn.style.display = "none";
                          Services.console.logStringMessage("[WebApp] Bouton Discussion masqué sur nouvelle fenêtre");
                        }
                      } catch (e) { }
                      try {
                        setupSpacesToolbarObserver(w);
                      } catch (e) { }
                    }, 100);
                  }
                } catch (e) { }
              }
            };
            Services.obs.addObserver(docObserver, "chrome-document-loaded");
            context.callOnClose({
              close() {
                Services.obs.removeObserver(docObserver, "chrome-document-loaded");
              }
            });

          } catch (e) {
            Services.console.logStringMessage("[WebApp] init: ERREUR: " + e + "\n" + e.stack);
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
          const LOGIN_URL = "https://mel.din.developpement-durable.gouv.fr/?_task=login&_courrielleur=1";

          Services.console.logStringMessage("[WebApp] loginBnum: user=" + user);

          // Encodage ISO-8859-15 identique à la legacy
          let encodedUser, encodedPass;
          try {
            const encoder = Cc["@mozilla.org/intl/texttosuburi;1"]
              .getService(Ci.nsITextToSubURI);
            encodedUser = encoder.ConvertAndEscape("ISO-8859-15", user);
            encodedPass = encoder.ConvertAndEscape("ISO-8859-15", password);
            Services.console.logStringMessage("[WebApp] loginBnum: encodage ISO-8859-15 OK");
          } catch (e) {
            Services.console.logStringMessage("[WebApp] loginBnum: nsITextToSubURI indisponible, fallback UTF-8: " + e);
            encodedUser = encodeURIComponent(user);
            encodedPass = encodeURIComponent(password);
          }

          const params = "_user=" + encodedUser
            + "&_pass=" + encodedPass
            + "&_task=login&_action=login&_keeplogin=1";

          try {
            const response = await fetch(LOGIN_URL, {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: params,
              credentials: "include",
            });
            Services.console.logStringMessage("[WebApp] loginBnum: HTTP " + response.status
              + " url=" + response.url);
            // Vérifier si login réussi (pas de page login dans la réponse)
            const body = await response.text();
            const failed = body && (body.includes("Invalid credentials") ||
              body.includes("_task=login") || body.includes("login_error"));
            Services.console.logStringMessage("[WebApp] loginBnum: login "
              + (failed ? "ÉCHOUÉ" : "OK"));
            return response.status;
          } catch (e) {
            Services.console.logStringMessage("[WebApp] loginBnum: exception: " + e);
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
