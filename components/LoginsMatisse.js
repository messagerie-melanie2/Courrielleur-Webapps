/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/*
 * nsILoginManagerStorage implementation pour la messagerie Matisse
 * encapsule LoginManagerStorage_json (gestionnaire tb)
 *
 *	1 seul mot de passe par identifiant Matisse
 *  Si le mot de passe en mémorisé, il est stocké par le gestionnaire TB
 *  Sinon il est stocké dans le gestionnaire Matisse (en mémoire pour la durée de la session)
 *
 */

ChromeUtils.import("resource://gre/modules/XPCOMUtils.jsm");
ChromeUtils.import("resource://gre/modules/Services.jsm");

ChromeUtils.import("resource://gre/modules/pacomeAuthUtils.jsm");


const Cc=Components.classes;
const Ci=Components.interfaces;

const contractID_TB="@mozilla.org/login-manager/storage/json;1";

// 1 seul login pour un user Matisse
// le login est mémorisé avec PacomeAuthUtils.UrlDomainePacome pour nom d'hote (login.hostname)
// et PacomeAuthUtils.HTTP_REALM_MATISSE pour httpRealm
// exemple : une recherche avec "https://dev.dav.mce.interieur.rie.gouv.fr" cherchera le login avec hostname PacomeAuthUtils.UrlDomainePacome



function LoginsMatisse() {};

LoginsMatisse.prototype = {

  classDescription: "nsILoginManagerStorage implementation Matisse",
  contractID: "@mce.interieur.rie.gouv.fr/login-manager/storage/logins-matisse;1",
  classID: Components.ID("{12d18cc6-b30c-419a-957f-12d7abf83ce0}"),
  QueryInterface: XPCOMUtils.generateQI([Ci.nsILoginManagerStorage]),

  // This registers the category for overriding the built-in nsILoginManagerStorage
  _xpcom_categories: [
    {
      category: "login-manager-storage",
      entry: "nsILoginManagerStorage"
    }
  ],

	// instance nsILoginManagerStorage Thunderbird
	_storageTB: null,

  // mémorisation locale des logins Matisse (durée session)
  // Map d'objet logins
  _loginsMatisse: null,

	initialize() {

    this.log("LoginsMatisse initialize");

		try {

			this._storageTB=Cc[contractID_TB].createInstance(Ci.nsILoginManagerStorage);

			this._storageTB.initialize();

      this._loginsMatisse=new Map();

      // charger les logins Matisse depuis le gestionnaire TB
      let countTB={};
      let loginsTB=this._storageTB.getAllLogins(countTB);

      for (let i=0;i<countTB.value;i++) {

        let login=loginsTB[i];

        if (this._isLoginMatisse(login)) {

          let loginClone=this.cloneLoginMatisse(login);
          this.log("initialize chargement du login mémorisé:"+loginClone.username);
          this._loginsMatisse.set(loginClone.username, loginClone);
        }
      }

		} catch(ex) {
			this.log("LoginsMatisse exception dans initialize:"+ex);
			throw new Error("Initialization failed");
		}
	},

	terminate() {

		try {

			this._storageTB.terminate();

		} catch(ex) {
			this.log("LoginsMatisse exception dans terminate:"+ex);
			throw new Error("terminate failed");
		}
	},


  addLogin(login, preEncrypted = false) {

    this.log("addLogin username:'"+login.username+"' - hostname:'"+login.hostname+"'");

    if (this._isLoginMatisse(login)) {

      let loginMatisse=PacomeAuthUtils.CreeLoginMatisse(login.username, login.password, login.passwordField);

      // en mémoire locale
      this.log("addLogin Matisse:"+loginMatisse.username);
      this._loginsMatisse.set(loginMatisse.username, loginMatisse);

      // cas ajout depuis pacomemdp - verifier si doit être mémorisé dans le gestionnaire tb
      // passwordField contenant 'memo' si mémorisation
      this.log("addLogin Matisse passwordField:"+loginMatisse.passwordField);
      if (loginMatisse.passwordField=="memo") {

        this.log("addLogin Matisse ajout mémorisation pour:"+loginMatisse.username);
        loginMatisse.passwordField="";

        return this._storageTB.addLogin(loginMatisse, preEncrypted);
      }

      return loginMatisse;
    }

		return this._storageTB.addLogin(login, preEncrypted);
  },

  removeLogin(login) {

    this.log("removeLogin username:'"+login.username+"' - hostname:'"+login.hostname+"'");

    if (this._isLoginMatisse(login)) {

      // rechercher si existe déjà dans TB (cas mémorisé)
      let loginExist=this._searchLoginMatisseTB(login);

      if (loginExist) {

        this.log("removeLogin Thundebird");
        this._storageTB.removeLogin(loginExist);
      }

      this.log("removeLogin Matisse (session) pour:"+login.username);
      this._loginsMatisse.delete(login.username);

    } else {

      this._storageTB.removeLogin(login);
    }
  },

  modifyLogin(oldLogin, newLoginData) {

    this.log("modifyLogin username:'"+oldLogin.username+"' - hostname:'"+oldLogin.hostname+"'");

    if (this._isLoginMatisse(oldLogin)) {

      let loginClone=this.cloneLoginMatisse(oldLogin);
      let memo="nonmemo";

      if (newLoginData instanceof Ci.nsILoginInfo) {

        loginClone.password=newLoginData.password;
        memo=newLoginData.passwordField;

      } else {

        try {

          loginClone.password=newLoginData.getProperty("password");
          memo=newLoginData.getProperty("passwordField");

        } catch(e1){
        }
      }
      this.log("modifyLogin memo:"+memo);


      // rechercher si existe déjà dans TB
      // modifier mot de passe si passwordField=memo
      // ou le supprimer
      let loginExist=this._searchLoginMatisseTB(loginClone);

      if (loginExist) {

        this.log("modifyLogin login thunderbird existe:"+loginExist.username);

        if (memo=="nonmemo") {

          this.log("modifyLogin suppression login dans thunderbird pour:"+loginExist.username);
          this._storageTB.removeLogin(loginExist);

        } else {

          this.log("modifyLogin mise à jour login dans thunderbird pour:"+loginExist.username);
          this._storageTB.modifyLogin(loginExist, newLoginData);
        }
      }

      this.log("modifyLogin username:"+loginClone.username);
      this._loginsMatisse.set(loginClone.username, loginClone);

    } else {

      this._storageTB.modifyLogin(oldLogin, newLoginData);
    }
  },

  getAllLogins(count) {

    // retourner le total TB + _loginsMatisse
    // et tous les logins
    let countTB={};
    let loginsTB=this._storageTB.getAllLogins(countTB);

    let total=countTB.value;
    this.log("getAllLogins count TB:"+total);

    let loginsM=[];
    let nb=countTB.value;
    let i=0;
    for (let key of this._loginsMatisse.keys()) {

      let login=this._loginsMatisse.get(key);
      for (i=0;i<nb;i++) {
        if (loginsTB[i].username==login.username) break;
      }
      if (i==nb) {
        login.passwordField="nonmemo";
        loginsM.push(login);
        total++;
      }
    }

    count.value=total;

    this.log("getAllLogins count Matisse:"+loginsM.length);
    this.log("getAllLogins count:"+total);

    return loginsTB.concat(loginsM);
  },

	searchLogins(count, matchData) {

    let username="";
    if (matchData.hasKey("username")) username=matchData.getProperty("username");
    let hostname;
    if (matchData.hasKey("hostname")) hostname=matchData.getProperty("hostname");
    let formSubmitURL;
    if (matchData.hasKey("formSubmitURL")) username=matchData.getProperty("formSubmitURL");

    this.log("searchLogins username:'"+username+"' - hostname:'"+hostname+"'");

    let uid=PacomeAuthUtils.GetUidReduit(username);

    if (this._isHoteMatisse(hostname)) {

      let logins=[];

      if (""!=uid && this._loginsMatisse.has(uid)) {

        this.log("searchLogins login Matisse:"+uid);

        let loginClone=this._loginsMatisse.get(uid).clone();
        loginClone.hostname=hostname;
        loginClone.formSubmitURL=formSubmitURL;
        loginClone.username=username;
        logins.push(loginClone);
      }
      else {
        // tous les logins Matisse
        for (let key of this._loginsMatisse.keys()) {
          let loginClone=this._loginsMatisse.get(key).clone();
          loginClone.hostname=hostname;
          loginClone.formSubmitURL=formSubmitURL;
          loginClone.username=username;
          logins.push(loginClone);
        }
      }

      count.value=logins.length;

      return logins;
    }

		return this._storageTB.searchLogins(count, matchData);
	},

  removeAllLogins() {

    this.log("removeAllLogins");

    this._loginsMatisse.clear();

    this._storageTB.removeAllLogins();
  },

  findLogins(count, hostname, formSubmitURL, httpRealm) {

    this.log("findLogins hostname:"+hostname);
    this.log("findLogins formSubmitURL:"+formSubmitURL);
    this.log("findLogins httpRealm:"+httpRealm);

    if (this._isHoteMatisse(hostname) || this._isHoteMatisse(formSubmitURL)) {

      let logins=[];
      count.value=0;

      // tous les logins Matisse
      for (let key of this._loginsMatisse.keys()) {
        let loginClone=this._loginsMatisse.get(key).clone();
        loginClone.hostname=hostname;
        loginClone.formSubmitURL=formSubmitURL;
        logins.push(loginClone);
      }

      count.value=logins.length;
      this.log("findLogins count Matisse:"+count.value);

      return logins;
    }

    // cas Thunderbird
    return this._storageTB.findLogins(count, hostname, formSubmitURL, httpRealm);
  },

  countLogins(hostname, formSubmitURL, httpRealm) {

    if (this._isHoteMatisse(hostname)) {

      let nb=this._loginsMatisse.size;

      this.log("countLogins Matisse:"+nb);

      return nb;
    }

    return this._storageTB.countLogins(hostname, formSubmitURL, httpRealm);
  },

	get uiBusy() {
    return this._storageTB.uiBusy;
  },

  get isLoggedIn() {
    return this._storageTB.isLoggedIn;
  },

  /* fonctions spécifiques Matisse */
  _logs:null,
  log(msg) {
    if (null==this._logs)
      this._logs=Services.prefs.getBoolPref("signon.debug", false);
    if (this._logs)
      Services.console.logStringMessage("[LoginsMatisse] "+msg);
  },

  cloneLoginMatisse(login) {

    let loginClone=login.clone();
    loginClone.hostname=PacomeAuthUtils.UrlDomainePacome;
    loginClone.httpRealm=PacomeAuthUtils.HTTP_REALM_MATISSE;

    return loginClone;
  },

  // recherche un login Matisse dans le gestionnaire tb
  // retourne null si aucun
  _searchLoginMatisseTB(login) {

    this.log("_searchLoginMatisseTB username:"+login.username);

    let matchData=Cc["@mozilla.org/hash-property-bag;1"]
                    .createInstance(Ci.nsIWritablePropertyBag);
    matchData.setProperty("hostname", PacomeAuthUtils.UrlDomainePacome);

    let count={};
    let logins=this._storageTB.searchLogins(count, matchData);

    this.log("_searchLoginMatisseTB count:"+count.value);

    if (count.value>0) {

      // tester username
      for (let i=0;i<count.value;i++) {

        let loginTB=logins[i];
        this.log("_searchLoginMatisseTB loginTB username:"+loginTB.username);
        if (loginTB.username==login.username) {
          return loginTB;
        }
      }
    }

    return null;
  },

  // retourne true si login Matisse
  _isLoginMatisse(login) {

    return (PacomeAuthUtils.isMelanie2Host(login.hostname) ||
            PacomeAuthUtils.isHostProxyAmande(login.hostname));
  },

  // retourne true si hote Matisse
  _isHoteMatisse(hostname) {

    return (PacomeAuthUtils.isMelanie2Host(hostname) ||
            PacomeAuthUtils.isHostProxyAmande(hostname));
  },
};

this.NSGetFactory = XPCOMUtils.generateNSGetFactory([LoginsMatisse]);
