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
const FILELINK_REALM  = "filelink-nextcloud-melanie2";

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

            // --- Trouver le compte Pacome principal ---
            // Pacome marque ses comptes avec la préférence serveur "pacome.confid".
            // On cherche d'abord le compte par défaut, puis on parcourt tous les comptes.
            let account = null;
            try {
              const def = MailServices.accounts.defaultAccount;
              if (def?.incomingServer?.getStringValue("pacome.confid")) {
                account = def;
              }
            } catch (e) { /* defaultAccount peut lever si aucun compte */ }

            if (!account) {
              for (const acc of MailServices.accounts.accounts) {
                const srv = acc.incomingServer;
                if ((srv.type === "imap" || srv.type === "pop3") &&
                    srv.getStringValue("pacome.confid")) {
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

            // Uid réduit : partie gauche du séparateur .-.
            // Exemple : "jean.dupont.-.partage" → "jean.dupont"
            const fullUid  = server.username;
            const uid      = fullUid.split(PACOME_SEP_UID)[0];

            // --- Source 1 : mot de passe en mémoire ---
            let password = server.password;

            // --- Source 2 : login store Mozilla (realm filelink Pacome) ---
            if (!password) {
              try {
                const logins = Services.logins.findLogins(
                  FILELINK_ORIGIN, null, FILELINK_REALM
                );
                // Le username dans le store est l'uid complet (pas réduit pour filelink)
                // On cherche celui dont l'uid réduit correspond
                for (const login of logins) {
                  const loginUid = login.username.split(PACOME_SEP_UID)[0];
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

            Services.console.logStringMessage("[WebApp] getCredentials: credentials trouvés pour uid: " + uid);
            return { user: uid, password };

          } catch (e) {
            Services.console.logStringMessage("[WebApp] getCredentials: exception: " + e);
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
            if (!win) return;

            const tabmail = win.document.getElementById("tabmail");
            if (!tabmail) return;

            // Chercher un onglet existant dont l'URL correspond
            for (const tabInfo of tabmail.tabInfo) {
              const browser = tabInfo.browser;
              if (!browser) continue;
              const tabUrl = browser.currentURI?.spec || "";
              if (tabUrl.startsWith(urlPrefix)) {
                tabmail.switchToTab(tabInfo);
                win.focus();
                return;
              }
            }

            // Aucun onglet existant → en ouvrir un nouveau
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
