/*
 * WebApp2 — Experiment API (contexte chrome privilégié)
 *
 * Fournit :
 *   - getCredentials()    : récupère uid + mdp Pacome depuis nsIMsgIncomingServer
 *                           ou le login store Mozilla (realm filelink-nextcloud-melanie2)
 *   - openOrFocusTab(url, urlPrefix) : ouvre ou donne le focus à un onglet Thunderbird
 */

var { classes: Cc, interfaces: Ci } = Components;
const { ExtensionCommon } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionCommon.sys.mjs"
);

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
        // init() — no-op, conservé pour compatibilité avec background.js
        // ----------------------------------------------------------------
        init() {
          // Rien à faire.
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

            // Aucun onglet existant → en ouvrir un nouveau
            Services.console.logStringMessage("[WebApp] openOrFocusTab: ouverture nouvel onglet");
            tabmail.openTab("contentTab", {
              contentPage: url,
              clickHandler: "return true;"
            });
            win.focus();

          } catch (e) {
            Services.console.logStringMessage("[WebApp] openOrFocusTab: exception: " + e);
          }
        }

      }
    };
  }
};
