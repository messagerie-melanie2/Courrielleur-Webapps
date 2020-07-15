/* ***** BEGIN LICENSE BLOCK *****
 *   Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is WebTabs.
 *
 * The Initial Developer of the Original Code is
 * David Ascher.
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Dave Townsend <dtownsend@oxymoronical.com>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
Components.utils.import("resource://gre/modules/NetUtil.jsm");
Components.utils.import("resource://webapptabs/modules/LogManager.jsm");
LogManager.createLogger(this, "webtab");
Components.utils.import("resource://webapptabs/modules/ConfigManager.jsm");
Components.utils.import("resource://gre/modules/Preferences.jsm");

ChromeUtils.import("resource://gre/modules/pacomeAuthUtils.jsm");

// var Cc = Components.classes;
// var Ci = Components.interfaces;
var Ce = Components.Exception;
var Cr = Components.results;

var webtabs = {
  // The UI element that contains the webapp buttons
  buttonContainer: null,
  // The back context menu item
  backButton: null,
  // The forward context menu item
  forwardButton: null,
  // The Thunderbird onBeforeLinkTraversal function
  oldOnBeforeLinkTraversal: null,
  // The Thunderbird browserDOMWindow
  oldBrowserDOMWindow: null,
  
  // PAMELA
  createFilterButton: null,
  roundcubeButton: null,
  pegaseButton: null,
  arianeButton: null,
  newPollButton: null,
  shareCalendarButton: null,
  shareTaskslistButton: null,
  shareAddressbookButton: null,

  onLoad: function() {
    this.buttonContainer = document.getElementById("webapptabs-buttons");

    ConfigManager.webappList.forEach(function(aDesc) {
      if (aDesc.show) {
        this.createWebAppButton(aDesc);
      }
    }, this);

    ConfigManager.addChangeListener(this.configChanged);

    let container = document.getElementById("tabpanelcontainer");
    container.addEventListener("click", this, true);

    document.getElementById("mailContext").addEventListener("popupshowing", this, false);

    this.backButton = document.getElementById("webapptabs-context-back")
    this.backButton.addEventListener("command", this, false);
    this.forwardButton = document.getElementById("webapptabs-context-forward")
    this.forwardButton.addEventListener("command", this, false);
    
    // PAMELA
    this.createFilterButton = document.getElementById("webapptabs-createfilter-server")
    this.createFilterButton.addEventListener("command", this, false);
    this.roundcubeButton = document.getElementById("webapptabs-roundcube")
    this.roundcubeButton.addEventListener("command", this, false);
    this.pegaseButton = document.getElementById("webapptabs-pegase")
    this.pegaseButton.addEventListener("command", this, false);
    this.arianeButton = document.getElementById("webapptabs-ariane")
    this.arianeButton.addEventListener("command", this, false);
    this.newPollButton = document.getElementById("webapptabs-new-poll")
    this.newPollButton.addEventListener("command", this, false);
    this.shareCalendarButton = document.getElementById("webapptabs-share-calendar")
    this.shareCalendarButton.addEventListener("command", this, false);
    this.shareTaskslistButton = document.getElementById("webapptabs-share-taskslist")
    this.shareTaskslistButton.addEventListener("command", this, false);
//    this.shareAddressbookButton = document.getElementById("webapptabs-share-addressbook")
//    this.shareAddressbookButton.addEventListener("command", this, false);

    this.oldOnBeforeLinkTraversal = MsgStatusFeedback.onBeforeLinkTraversal;
    MsgStatusFeedback.onBeforeLinkTraversal = this.onBeforeLinkTraversal.bind(this);

    this.oldBrowserDOMWindow = window.browserDOMWindow;
    window.browserDOMWindow = this;

    // Initialise all tabs that are webapps
    let tabmail = document.getElementById("tabmail");
    tabmail.tabInfo.forEach(this.onTabOpened.bind(this));

    tabmail.registerTabMonitor(this);   
  },

  onUnload: function() {
    let tabmail = document.getElementById("tabmail");
    tabmail.unregisterTabMonitor(this);

    tabmail.tabInfo.forEach(this.onTabClosing.bind(this));

    var browsers = document.querySelectorAll("browser.webapptab-browser");
    if (browsers.length > 0)
      WARN("Found unexpected browsers left in the document");

    for (let i = 0; i < browsers.length; i++)
      browsers[i].parentNode.removeChild(browsers[i]);

    window.browserDOMWindow = this.oldBrowserDOMWindow;

    MsgStatusFeedback.onBeforeLinkTraversal = this.oldOnBeforeLinkTraversal;

    this.backButton.removeEventListener("command", this, false);
    this.forwardButton.removeEventListener("command", this, false);
    document.getElementById("mailContext").removeEventListener("popupshowing", this, false);

    let container = document.getElementById("tabpanelcontainer");
    container.removeEventListener("click", this, true);

    ConfigManager.removeChangeListener(this.configChanged);

    ConfigManager.webappList.forEach(function(aDesc) {
      this.removeWebAppButton(aDesc);
    }, this);
  },

  // Called without a proper this
  configChanged: function() {
    webtabs.updateWebAppButtons();
  },

  initWebAppTab: function(aTabInfo) {
    LOG("initWebAppTab " + aTabInfo.browser.contentDocument.documentURIObject);
    aTabInfo.browser.setAttribute("tooltip", "aHTMLTooltip");
  },
  
  // Appelé a la fin du chargement d'une page
  // Permet de détected les demandes de login
  _loadHandler: function(event) {
    // this is the content document of the loaded page.    
    let doc = event.originalTarget;
    LOG("_loadHandler " + doc.defaultView.location.href);
    ConfigManager.webappList.forEach(function(aDesc) {
      if (aDesc.autologin && doc.defaultView.location.href.indexOf(aDesc.login_page) > -1) {
        webtabs.loginWebApp(aDesc, aDesc.href, function(url) {
          if (PreviousLink.url 
              && PreviousLink.url.indexOf(aDesc.href) > -1 
              && PreviousLink.url.indexOf(aDesc.login_page) == -1) {
            doc.defaultView.location.href = PreviousLink.url;
          }
          else if (aDesc.default_url) {
            doc.defaultView.location.href = aDesc.default_url;
          }
          else {
            doc.defaultView.location.href = url;
          }
          PreviousLink.url = null;
        });
        return;
      }
    }, this);
  },
  

  destroyWebAppTab: function(aTabInfo) {
    aTabInfo.browser.removeAttribute("tooltip");
  },

  updateWebAppButtons: function() {
    let before = this.buttonContainer.firstChild;

    // Loop through all webapps, for each either move it to the current position
    // or create it
    ConfigManager.webappList.forEach(function(aDesc) {
      if (before) {
        // Common case is the button will be the next in the list
        if (aDesc.id == before.id) {
          before = before.nextSibling;
          return;
        }

        let found = before.nextSibling;
        while (found && found.id != aDesc.id)
          found = found.nextSibling;
        if (found) {
          found.parentNode.insertBefore(found, before);
          return;
        }
      }

      if (aDesc.show) {
        // Webapp doesn't exist, create it and put it in the right place
        let button = this.createWebAppButton(aDesc, before);
      }        
    }, this);

    // Remove any remaining buttons
    while (before) {
      let next = before.nextSibling;
      this.removeWebAppButton(before.desc);
      before = next;
    }
  },

  createWebAppButton: function(aDesc, aBefore) {
    let button = document.createElement("toolbarbutton");
    button.setAttribute("id", aDesc.id);
    button.setAttribute("class", "webtab");
    button.setAttribute("image", aDesc.icon);
    button.setAttribute("tooltiptext", aDesc.name);
    this.buttonContainer.insertBefore(button, aBefore);
    button.desc = aDesc;

    button.addEventListener("command", function() {
      try {
        webtabs.openWebApp(aDesc);
      }
      catch (e) {
        ERROR("Failed to open webapp", e);
      }
    }, false);
  },

  removeWebAppButton: function(aDesc) {
    let button = document.getElementById(aDesc.id);
    if (button)
      button.parentNode.removeChild(button);
    else
      ERROR("Missing webapp button for " + aDesc.name);
  },

  getTabInfoForWebApp: function(aDesc) {
    let tabmail = document.getElementById('tabmail');

    let tabs = tabmail.tabInfo.filter(function(aTabInfo) {
      if (!("browser" in aTabInfo))
        return false;

      return ConfigManager.isURLForWebApp(aTabInfo.browser.currentURI, aDesc);
    }, this);

    if (tabs.length > 0)
      return tabs[0];

    return null;
  },

  openWebApp: function(aDesc, aURL) {
	// MANTIS 0005159: Proposer d'ouvrir Ariane dans le navigateur plutôt que dans le Courrielleur
    
    if (this.callPopupResult(aDesc)) {
      if (!aURL) {
        aURL = aDesc.href;
      }
      var ioservice = Components.classes["@mozilla.org/network/io-service;1"]
            .getService(Components.interfaces.nsIIOService);
      uri = ioservice.newURI(aURL, null, null);
      // Open URL in user's default browser.
        var extps = Components.classes["@mozilla.org/uriloader/external-protocol-service;1"]
            .getService(Components.interfaces.nsIExternalProtocolService);
        extps.loadURI(uri, null);
        return;
    }
    let tabmail = document.getElementById('tabmail');

    let info = this.getTabInfoForWebApp(aDesc);
    if (info) {
      tabmail.switchToTab(info);
      if (aURL)
        info.browser.loadURI(aURL, null, null);
      return;
    }
    
    // PAMELA
    if (!aURL) aURL = aDesc.href;
    if (aDesc.login) {
      this.loginWebApp(aDesc, aURL, function (url) {
        info = tabmail.openTab("contentTab", {
              contentPage: url,
              clickHandler: "return true;"
        });
      });
    }
    else {
      info = tabmail.openTab("contentTab", {
        contentPage: aURL,
        clickHandler: "return true;"
      });
    }
    // 0005824: Focus onglet pegase si ouverture en arrière plan
    window.focus();
  },
  // PAMELA - Ouvrir un pop up avant d'afficher la page web
  callPopupResult: function(aDesc) {
	  if (!aDesc.show_popup) {
		  return 0;
	  }
	  var id = aDesc.id;
	  // Vérifier si la popup doit être affichée
	  if (Preferences.get("webappsm2.popup." + id + ".hide", false)) {
		  return Preferences.get("webappsm2.popup." + id + ".choice", 0)
	  }
	  var promptSvc = Services.prompt;
	  var props = Services.strings.createBundle("chrome://webappsm2/locale/webtab.properties");
	  
	  var popupTitle = props.GetStringFromName('popupTitle' + id);
	  var popupText = props.GetStringFromName('popupText' + id);
	  var popupButton0Label = props.GetStringFromName('popupButton0Label' + id);
	  var popupButton1Label = props.GetStringFromName('popupButton1Label' + id);
	  var checkboxLabel = null;
	  var checkboxState = { value: false };
	  
	  // Si on doit ajouter une checkbox
	  if (aDesc.popup_checkbox) {
		  checkboxLabel = props.GetStringFromName('checkBoxLabel' + id);
	  }
	  
	  var popupButtonFlags = (promptSvc.BUTTON_POS_0 *
              promptSvc.BUTTON_TITLE_IS_STRING +
              promptSvc.BUTTON_POS_0_DEFAULT) +
              (promptSvc.BUTTON_POS_1 *
              promptSvc.BUTTON_TITLE_IS_STRING);
	  
	  // Ouvre le pop up
	  var choice = promptSvc.confirmEx(null,
			  popupTitle,
			  popupText,
			  popupButtonFlags,
			  popupButton0Label,
			  popupButton1Label,
              null, // No third button text
              checkboxLabel,
              checkboxState);
	  
	  if (checkboxState.value) {
		  Preferences.set("webappsm2.popup." + id + ".hide", true);
		  Preferences.set("webappsm2.popup." + id + ".choice", choice);
	  }
	  
	  return choice;
  },
  // PAMELA - Ouvre une URL M2 depuis les WebApps disponibles
  openWebAppTab: function(aId, aUrlType) {
    ConfigManager.webappList.forEach(function(aDesc) {
      if (aDesc.id == aId) {
        let aUrl = aDesc.url && aDesc.url[aUrlType] ? aDesc.url[aUrlType] : aDesc.default_url ? aDesc.default_url : aDesc.href;
        this.openWebApp(aDesc, aUrl);
        return;
      }
    }, this);
  },
  // PAMELA - Ouvre une URL en utilisant l'id de l'application M2
  openWebAppById: function(aId, aUrl) {
    ConfigManager.webappList.forEach(function(aDesc) {
      if (aDesc.id == aId) {
        this.openWebApp(aDesc, aUrl);
        return;
      }
    }, this);
  },
  // PAMELA - Ouverture d'une URL pegase
  openWebAppPegase: function(aUrl) {
    this.openWebAppById('pegase', aUrl);
  },
  // PAMELA - Log-in to the app, using the aDesc info 
  loginWebApp: function(aDesc, aUrl, aCallback) {
    try {
      window.setCursor("wait");
      // url
      if (!aUrl) aUrl = aDesc.href;
      if (aDesc.default_url && aUrl == aDesc.href)
        aUrl = aDesc.default_url;
      // Récupération de l'url de login
      if (aDesc.external_login_page)
        var aLoginUrl = aDesc.external_login_page;
      else if (aDesc.login_page)
        var aLoginUrl = aDesc.login_page;
      else
        var aLoginUrl = aUrl;
      
      // paramètres
      var usermdp = this.Cm2GetUserMdpPrincipal();
      if (null == usermdp || "" == usermdp["mdp"] || "" == usermdp["user"]) {
        window.setCursor("auto");
        // L'authentification n'est pas remplie, on attend 5 sec pour le refresh
        setTimeout(function() {
          aCallback(aUrl);  
        }, 5000);       
        return;
      }
      
      //cas uid partage
      var p = usermdp["user"].indexOf(".-.");
      if (-1 != p) {
        usermdp["user"] = usermdp["user"].substring(0, p);
      }
      var encodeur = Components.classes["@mozilla.org/intl/texttosuburi;1"]
        .getService(Components.interfaces.nsITextToSubURI);
      // Gestion des paramètres
      var params = aDesc.login_params;
      params = params.replace(/\%\%username\%\%/g, encodeur.ConvertAndEscape("ISO-8859-15", usermdp["user"]));
      params = params.replace(/\%\%password\%\%/g, encodeur.ConvertAndEscape("ISO-8859-15", usermdp["mdp"]));
      // Gestion du timezone par défaut
      if (params.indexOf('%%timezone%%') > 0) {
    	  Components.utils.import("resource://calendar/modules/calUtils.jsm");
    	  var timezone = cal.dtz.defaultTimezone;
    	  if (timezone.tzid) {
    		  params = params.replace(/\%\%timezone\%\%/g, timezone.tzid);
    	  }
      }
      
      // Type de requête POST ?
      if (aDesc.request_type == 'POST') {
	    var httpRequest = new XMLHttpRequest();
        httpRequest.open("POST", aLoginUrl, true);
        httpRequest.withCredentials = true;
        httpRequest.setRequestHeader("Content-Type","application/x-www-form-urlencoded");
        httpRequest.onreadystatechange = function() {  
          switch(httpRequest.readyState) {         
            case 4:
              window.setCursor("auto");
              aCallback(aUrl);
              break;
          }
        }
        httpRequest.send(params);
      }
      else if (aDesc.request_type == 'GET') {
        if (aLoginUrl.indexOf("?") == -1) {
          params = "?" + params;
        } else {
          params = "&" + params;
        }
        window.setCursor("auto");
        aCallback(aLoginUrl + params);
      }
    }
    catch (ex) {
      ERROR(ex);
      window.setCursor("auto");
    }
  },
  
  //Recupere le user et mot de passe
  Cm2GetUserMdpPrincipal: function cal_Cm2GetUserMdpPrincipal() {
  
    var cp=PacomeAuthUtils.GetComptePrincipal();
    
    if (null==cp){
      return null;
    }
    
    var usermdp=new Array();
    usermdp["user"]=cp.incomingServer.username;
    usermdp["mdp"]=cp.incomingServer.password;
    
    return usermdp;
  },

  onPopupShowing: function(aEvent) {
    let info = document.getElementById('tabmail').currentTabInfo;
    if (!info || !("browser" in info)) {
      this.backButton.hidden = true;
      this.forwardButton.hidden = true;
      return;
    }

    this.backButton.hidden = false;
    this.forwardButton.hidden = false;
    this.backButton.disabled = !info.browser.webNavigation.canGoBack;
    this.forwardButton.disabled = !info.browser.webNavigation.canGoForward;

    // If the context menu already detected the area as editable then bail out
    if (gContextMenu.onEditableArea)
      return;

    function initSpellchecking(aEditor) {
      gContextMenu.onTextInput = true;
      gContextMenu.onEditableArea = true;
      gSpellChecker.init(aEditor);
      gSpellChecker.initFromEvent(document.popupRangeParent, document.popupRangeOffset);
      gContextMenu.initSpellingItems();
    }

    let target = document.popupNode;

    // If the target is a text input with the spellcheck attribute then set it
    // up for spellchecking
    if (gContextMenu.onTextInput && target.getAttribute("spellcheck") == "true") {
      initSpellchecking(target.QueryInterface(Ci.nsIDOMNSEditableElement).editor);
      return;
    }

    let win = target.ownerDocument.defaultView;
    if (!win)
      return;

    try {
      var editingSession = win.QueryInterface(Ci.nsIInterfaceRequestor)
                              .getInterface(Ci.nsIWebNavigation)
                              .QueryInterface(Ci.nsIInterfaceRequestor)
                              .getInterface(Ci.nsIEditingSession);
      if (!editingSession.windowIsEditable(win))
        return;
      if (win.getComputedStyle(target, "").getPropertyValue("-moz-user-modify") != "read-write")
        return;
    }
    catch(ex) {
      // If someone built with composer disabled, we can't get an editing session.
      return;
    }

    initSpellchecking(editingSession.getEditorForWindow(win));
  },

  onContentClick: function(aEvent) {
    let info = document.getElementById('tabmail').currentTabInfo;
    if (!info)
      return;

    // Don't handle events that: a) aren't trusted, b) have already been
    // handled or c) aren't left-click.
    if (!aEvent.isTrusted || aEvent.defaultPrevented || aEvent.button)
      return;

    // If this is a click in a webapp then ignore it, onBeforeLinkTraversal and
    // the content policy will handle it
    if (("browser" in info) && ConfigManager.getWebAppForURL(info.browser.currentURI)) {
      // If the load is for the same webapp that the tab is already displaying
      // then just allow the event to proceed as normal.
      return;
    }

    let href = hRefForClickEvent(aEvent, true);
    if (!href)
      return;

    // If this URL isn't for a webapp then continue as normal
    let newDesc = ConfigManager.getWebAppForURL(NetUtil.newURI(href));
    if (!newDesc)
      return;

    LOG("Clicked on URL in content: " + href);
    
    // PAMELA
    PreviousLink.url = href;

    // Open this link as a webapp
    aEvent.preventDefault();
    aEvent.stopPropagation();
    this.openWebApp(newDesc, href);
  },

  onBackClick: function(aEvent) {
    let info = document.getElementById('tabmail').currentTabInfo;
    if (!info || !("browser" in info))
      return;

    info.browser.goBack();
  },

  onForwardClick: function(aEvent) {
    let info = document.getElementById('tabmail').currentTabInfo;
    if (!info || !("browser" in info))
      return;

    info.browser.goForward();
  },

  // nsIXULBrowserWindow bits
  onBeforeLinkTraversal: function(aOriginalTarget, aLinkURI, aLinkNode, aIsAppTab) {
    let newTarget = this.oldOnBeforeLinkTraversal.call(MsgStatusFeedback, aOriginalTarget, aLinkURI, aLinkNode, aIsAppTab);
    
    // PAMELA
    PreviousLink.url = aLinkURI.spec;

    function logResult(aTarget, aReason) {
      LOG("onBeforeLinkTraversal " + aLinkURI.spec + " targetted at " +
          "'" + newTarget + "': new target '" + aTarget + "' - " + aReason);
    }

    let originalWin = aLinkNode.ownerDocument.defaultView;
    let targetWin = originalWin;
    let docShell = originalWin.QueryInterface(Ci.nsIInterfaceRequestor)
                              .getInterface(Ci.nsIWebNavigation)
                              .QueryInterface(Ci.nsIDocShellTreeItem);
    
    let resultDocShell = originalWin.QueryInterface(Ci.nsIInterfaceRequestor)
    						  .getInterface(Ci.nsIWebNavigation)
    						  .QueryInterface(Ci.nsIDocShellTreeItem);

    let targetDocShell = docShell.findItemWithName(newTarget, docShell, docShell, resultDocShell);
    if (targetDocShell) {
      targetWin = docShell.QueryInterface(Ci.nsIInterfaceRequestor)
                          .getInterface(Ci.nsIDOMWindow);
    }

    // If this is attempting to load an inner frame then just continue
    if (targetWin.top != targetWin) {
      logResult(newTarget, "Inner frame load");
      return newTarget;
    }

    let originDesc = ConfigManager.getWebAppForURL(targetWin.document.documentURIObject);
    // If the target window isn't a webapp then allow the load as normal
    if (!originDesc) {
      logResult(newTarget, "Non-webapp origin");
      return newTarget;
    }

    if (aLinkURI.scheme == "javascript") {
      logResult("", "Javascript load");
      targetWin.location = aLinkURI.spec;
      return "";
    }

    let targetDesc = ConfigManager.getWebAppForURL(aLinkURI);

    // If this is a load of the same webapp then allow it to continue
    if (originDesc == targetDesc) {
      if (!targetDocShell) {
        logResult("_top", "Same-webapp load to an unknown docshell");
        return "_top";
      }
      logResult(newTarget, "Same-webapp load");
      return newTarget;
    }

    // If this isn't the load of a webapp then, the content policy will redirect
    // the load.
    if (!targetDesc) {
      logResult(newTarget, "Non-webapp load");
      return newTarget;
    }

    logResult("_top", "Different webapp load, retargetted");
    this.openWebApp(targetDesc, aLinkURI.spec);

    // Make sure the content policy will abort this by not opening a new tab
    // and doing a full document load
    return "_top";
  },

  // nsIBrowserDOMWindow implementation
  openURI: function(aURI, aOpener, aWhere, aContext) {
    function logResult(aReason) {
      LOG("openURI from " + (aOpener ? aOpener.document.documentURIObject.spec : null) +
          " - " + aReason);
    }

    // We don't know what the target URL is at this point. If the opener is a
    // webapp then open the link in a new browser, wait for it to be taken over
    // by the content policy
    let desc = ConfigManager.getWebAppForURL(aOpener.document.documentURIObject);
    if (desc) {
      let browser = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
                                             "browser");
      browser.setAttribute("type", "content");
      browser.setAttribute("style", "width: 0px; height: 0px");
      browser.setAttribute("class", "webapptab-browser");
      document.documentElement.appendChild(browser);

      logResult("Opener is a webapp, redirecting to hidden browser");
      return browser.contentWindow;
    }

    logResult("Opener is not a webapp, continuing as normal");
    return this.oldBrowserDOMWindow.openURI(aURI, aOpener, aWhere, aContext);
  },

  isTabContentWindow: function(aWindow) {
    return this.oldBrowserDOMWindow.isTabContentWindow(aWindow);
  },

  // nsIEventHandler implementation
  handleEvent: function(aEvent) {
    try {
      switch (aEvent.type) {
      case "popupshowing":
        this.onPopupShowing(aEvent);
        break;
      case "click":
        this.onContentClick(aEvent);
        break;
      case "command":
        if (aEvent.target == this.backButton)
          this.onBackClick(aEvent);
        else if (aEvent.target == this.forwardButton)
          this.onForwardClick(aEvent);
        else if (aEvent.target == this.createFilterButton)
          this.openWebAppTab('roundcube', 'createFilter');
        else if (aEvent.target == this.roundcubeButton)
          this.openWebAppTab('roundcube', null);
        else if (aEvent.target == this.pegaseButton)
          this.openWebAppTab('pegase', null);
        else if (aEvent.target == this.arianeButton)
          this.openWebAppById('ariane', null);
        else if (aEvent.target == this.newPollButton)
          this.openWebAppTab('pegase', 'createPoll');
        else if (aEvent.target == this.shareCalendarButton)
          this.openWebAppTab('roundcube', 'shareCalendar');
        else if (aEvent.target == this.shareTaskslistButton)
          this.openWebAppTab('roundcube', 'shareTaskslist');
        else if (aEvent.target == this.shareAddressbookButton)
          this.openWebAppTab('roundcube', 'shareAddressbook');
        break;
      }
    }
    catch (e) {
      ERROR("Exception during " + aEvent.type + " event", e);
    }
  },

  // Tab monitor implementation
  monitorName: "WebAppTabListener",

  onTabTitleChanged: function(aTabInfo) {
  },

  onTabSwitched: function(aTabInfo, aOldTabInfo) {
  },

  onTabOpened: function(aTabInfo, aIsFirstTab, aWasCurrentTab) {
    if (!aTabInfo.browser)
      return;
    
    // PAMELA
    aTabInfo.browser.addEventListener("load", this._loadHandler, true);

    // In some versions of Thunderbird we end up with a browser that has history
    // disabled, this code forcibly enables it
    if (aTabInfo.browser.hasAttribute("disablehistory")) {
    	if (aTabInfo.browser.webNavigation == null ||
    				aTabInfo.browser.webNavigation.sessionHistory == null) {
    		return;
    	}
      Services.obs.addObserver(aTabInfo.browser, "browser:purge-session-history", false);
      // wire up session history
      aTabInfo.browser.webNavigation.sessionHistory = Cc["@mozilla.org/browser/shistory;1"].
                                                      createInstance(Ci.nsISHistory);
      // enable global history
      if (aTabInfo.browser.docShell)
        aTabInfo.browser.docShell.QueryInterface(Ci.nsIDocShellHistory).useGlobalHistory = true;
      aTabInfo.browser.removeAttribute("disablehistory");
    }

    if (aTabInfo.pageLoading) {
      let listener = {
        onLocationChange: function(aWebProgress, aRequest, aLocation) {
          let webapp = ConfigManager.getWebAppForURL(aLocation);

          // Ignore tabs that aren't webapps
          if (!webapp) {
            aTabInfo.browser.removeProgressListener(this);
            return;
          }

          webtabs.initWebAppTab(aTabInfo);
        },

        onStateChange: function(aWebProgress, aRequest, aState, aStatus) {
          if (!(aState & Ci.nsIWebProgressListener.STATE_STOP))
            return;

          if (aState & Ci.nsIWebProgressListener.STATE_IS_NETWORK)
            aTabInfo.browser.removeProgressListener(listener);

          if (aState & Ci.nsIWebProgressListener.STATE_IS_REQUEST) {
            let icon = aTabInfo.tabNode.getAttribute("image");
            if (!icon)
              return;

            let webapp = ConfigManager.getWebAppForURL(aTabInfo.browser.contentDocument.documentURIObject);
            webapp.icon = icon;

            let button = document.getElementById(webapp.id);
            button.setAttribute("image", webapp.icon);
          }
        },

        onProgressChange: function() { },
        onSecurityChange: function() { },
        onStatusChange: function() { },
        QueryInterface: XPCOMUtils.generateQI([Ci.nsIWebProgressListener,
                                               Ci.nsISupportsWeakReference])
      };

      aTabInfo.browser.addProgressListener(listener);
    }
    else {
      if (!ConfigManager.getWebAppForURL(aTabInfo.browser.contentDocument.documentURIObject))
        return;

      this.initWebAppTab(aTabInfo);
    }
  },

  onTabClosing: function(aTabInfo) {
    if (!aTabInfo.browser)
      return;
      
    if (!ConfigManager.getWebAppForURL(aTabInfo.browser.contentDocument.documentURIObject))
      return;

    this.destroyWebAppTab(aTabInfo);
  },

  onTabPersist: function(aTabInfo) {
    return null;
  },

  onTabRestored: function(aTabInfo, aState, aIsFirstTab) {
  }
};

var OverlayListener = {
  load: function() {
    webtabs.onLoad();
  },

  unload: function() {
    webtabs.onUnload();
  }
};

window.addEventListener("load", function(e) {
    webtabs.onLoad();
}, false);

window.addEventListener("unload", function(e) {
  webtabs.onUnload();
}, false);

// PAMELA
// Stocker les liens précedents
var PreviousLink = {
  url: null  
};