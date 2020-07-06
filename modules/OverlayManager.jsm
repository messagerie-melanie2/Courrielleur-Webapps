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
 * The Original Code is WebApp Tabs.
 *
 * The Initial Developer of the Original Code is
 * Dave Townsend <dtownsend@oxymoronical.com>
 * Portions created by the Initial Developer are Copyright (C) 2011
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
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

const EXPORTED_SYMBOLS = ["OverlayManager"];

Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://webapptabs/modules/LogManager.jsm");
LogManager.createLogger(this, "OverlayManager");

const Cc = Components.classes;
const Ci = Components.interfaces;
const Ce = Components.Exception;
const Cr = Components.results;
const Cm = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);

const XMLURI_PARSE_ERROR = "http://www.mozilla.org/newlayout/xml/parsererror.xml"

function createSandbox(aPrincipal, aScriptURL, aPrototype) {
  let args = {
    sandboxName: aScriptURL
  };

  if (aPrototype)
    args.sandboxPrototype = aPrototype;

  let sandbox = Components.utils.Sandbox(aPrincipal, args);

  try {
    Components.utils.evalInSandbox(
      "Components.classes['@mozilla.org/moz/jssubscript-loader;1']" +
                ".createInstance(Components.interfaces.mozIJSSubScriptLoader)" +
                ".loadSubScript(" + JSON.stringify(aScriptURL) + ");",
      sandbox, "ECMAv5");
  }
  catch (e) {
    WARN("Exception loading script " + aScriptURL, e);
  }

  return sandbox
}

const OverlayManager = {
  addOverlays: function(aOverlayList) {
    OverlayManagerInternal.addOverlays(aOverlayList);
  },

  addComponent: function(aCid, aComponentURL, aContract) {
    OverlayManagerInternal.addComponent(aCid, aComponentURL, aContract);
  },

  addCategory: function(aCategory, aEntry, aValue) {
    OverlayManagerInternal.addCategory(aCategory, aEntry, aValue);
  },

  getScriptContext: function(aWindow, aScriptURL) {
    return OverlayManagerInternal.getScriptContext(aWindow, aScriptURL);
  },

  unload: function() {
    OverlayManagerInternal.unload();
  }
};

const OverlayManagerInternal = {
  windowEntryMap: new WeakMap(),
  windowEntries: {},
  overlays: {},
  components: [],
  categories: [],
  contracts: [],

  init: function() {
    LOG("init");
    Services.wm.addListener(this);
  },

  unload: function() {
    LOG("unload");
    try {
      Services.wm.removeListener(this);

      for (let windowURL in this.windowEntries) {
        this.windowEntries[windowURL].forEach(function(aWindowEntry) {
          this.destroyWindowEntry(aWindowEntry);
        }, this);
      }

      let cm = Cc["@mozilla.org/categorymanager;1"].
               getService(Ci.nsICategoryManager);
      this.categories.forEach(function([aCategory, aEntry]) {
        cm.deleteCategoryEntry(aCategory, aEntry, false);
      });

      this.components.forEach(function(aCid) {
        let factory = Cm.getClassObject(aCid, Ci.nsIFactory);
        Cm.unregisterFactory(aCid, factory);
      });

      this.contracts.forEach(function([aContract, aCid]) {
        Cm.registerFactory(aCid, null, aContract, null);
      });
    }
    catch (e) {
      ERROR("Exception during unload", e);
    }
  },

  createWindowEntry: function(aDOMWindow, aOverlays) {
    aDOMWindow.addEventListener("unload", this, false);

    let windowURL = aDOMWindow.location.toString();
    LOG("Creating window entry for " + windowURL);
    if (this.windowEntryMap.has(aDOMWindow))
      throw new Ce("Already registered window entry for " + windowURL);

    if (!(windowURL in this.windowEntries))
      this.windowEntries[windowURL] = [];

    let newEntry = {
      window: aDOMWindow,
      scripts: {},
      nodes: [],
    };

    this.windowEntries[windowURL].push(newEntry);
    this.windowEntryMap.set(aDOMWindow, newEntry);

    this.applyWindowEntryOverlays(newEntry, aOverlays);
    return newEntry
  },

  destroyWindowEntry: function(aWindowEntry) {
    aWindowEntry.window.removeEventListener("unload", this, false);

    let windowURL = aWindowEntry.window.location.toString();
    LOG("Destroying window entry for " + windowURL);

    this.windowEntryMap.delete(aWindowEntry.window);

    for (let [,sandbox] in Iterator(aWindowEntry.scripts)) {
      try {
        if ("OverlayListener" in sandbox && "unload" in sandbox.OverlayListener)
          sandbox.OverlayListener.unload();
      }
      catch (e) {
        ERROR("Exception calling script unload listener", e);
      }
    }
    aWindowEntry.scripts = {};

    aWindowEntry.nodes.forEach(function(aNode) {
      aNode.parentNode.removeChild(aNode);
    }, this);
    aWindowEntry.nodes = [];

    if (!(windowURL in this.windowEntries))
      throw new Ce("Missing window entry for " + windowURL);
    let pos = this.windowEntries[windowURL].indexOf(aWindowEntry);
    if (pos == -1)
      throw new Ce("Missing window entry for " + windowURL);

    this.windowEntries[windowURL].splice(pos, 1);
    if (this.windowEntries[windowURL].length == 0)
      delete this.windowEntries[windowURL];
  },

  applyWindowEntryOverlays: function(aWindowEntry, aOverlays) {
    if ("documents" in aOverlays) {
      aOverlays.documents.forEach(function(aDocumentURL) {
        this.loadDocumentOverlay(aWindowEntry, aDocumentURL);
      }, this);
    }

    if ("styles" in aOverlays) {
      aOverlays.styles.forEach(function(aStyleURL) {
        this.loadStyleOverlay(aWindowEntry, aStyleURL);
      }, this);
    }

    if ("scripts" in aOverlays) {
      aOverlays.scripts.forEach(function(aScriptURL) {
        this.loadScriptOverlay(aWindowEntry, aScriptURL);
      }, this);
    }
  },

  loadDocumentOverlay: function(aWindowEntry, aDocumentURL) {
    LOG("Loading document overlay " + aDocumentURL);

    // TODO make this async
    let xhr = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].
              createInstance(Ci.nsIXMLHttpRequest);
    xhr.open("GET", aDocumentURL, false);
    xhr.send();

    let overlayDoc = xhr.responseXML;
    if (overlayDoc.documentElement.namespaceURI == XMLURI_PARSE_ERROR)
      return;

    let targetDoc = aWindowEntry.window.document;

    function* walkDocumentNodes(aDocument) {
      let node = aDocument.documentElement;

      while (node) {
        let currentNode = node;

        // If possible to descend then do so
        if (node.firstChild) {
          node = node.firstChild;
        }
        else {
          // Otherwise find the next node in the document by walking up the tree
          // until there is a nextSibling (or we hit the documentElement)
          while (!node.nextSibling && node.parentNode != overlayDoc.documentElement)
            node = node.parentNode;

          // Select the nextSibling (or null if we hit the top)
          node = node.nextSibling;
        }

        yield currentNode;
      }
    }

    function* elementChildren(aElement) {
      let node = aElement.firstChild;
      while (node) {
        let currentNode = node;

        node = node.nextSibling;

        if (currentNode instanceof Ci.nsIDOMElement)
          yield currentNode;
      }
    }

    for (let node in walkDocumentNodes(overlayDoc)) {
      // Remove the node if it is an empty text node
      if (node.nodeType == Ci.nsIDOMNode.TEXT_NODE && node.nodeValue.trim() == "")
        node.parentNode.removeChild(node);
    }

    for (let containerElement in elementChildren(overlayDoc.documentElement)) {
      if (!containerElement.id)
        continue;

      let targetElement = targetDoc.getElementById(containerElement.id);
      if (!targetElement || targetElement.localName != containerElement.localName)
        continue;

      // TODO apply attributes to the target element

      for (let newElement in elementChildren(containerElement)) {
        let insertBefore = null;

        if (newElement.hasAttribute("insertbefore")) {
          insertBefore = targetDoc.getElementById(newElement.getAttribute("insertbefore"));
          if (insertBefore && insertBefore.parentNode != targetElement)
            insertBefore = null;
        }

        if (!insertBefore && newElement.hasAttribute("insertafter")) {
          insertBefore = targetDoc.getElementById(newElement.getAttribute("insertafter"));
          if (insertBefore) {
            if (insertBefore.parentNode != targetElement)
              insertBefore = null
            else
              insertBefore = insertBefore.nextSibling;
          }
        }

        targetElement.insertBefore(newElement, insertBefore);
        aWindowEntry.nodes.push(newElement);
      }
    }
  },

  loadStyleOverlay: function(aWindowEntry, aStyleURL) {
    LOG("Loading style overlay " + aStyleURL);

    let doc = aWindowEntry.window.document;
    let styleNode = doc.createProcessingInstruction("xml-stylesheet",
                                                    "href=\"" + aStyleURL + "\" " +
                                                    "type=\"text/css\"");
    doc.insertBefore(styleNode, doc.documentElement);

    aWindowEntry.nodes.push(styleNode);
  },

  loadScriptOverlay: function(aWindowEntry, aScriptURL) {
    LOG("Loading script overlay " + aScriptURL);

    let sandbox = createSandbox(aWindowEntry.window, aScriptURL, aWindowEntry.window);
    aWindowEntry.scripts[aScriptURL] = sandbox;

    if ("OverlayListener" in sandbox && "load" in sandbox.OverlayListener) {
      try {
        sandbox.OverlayListener.load();
      }
      catch (e) {
        WARN("Exception calling script load event " + aScriptURL, e);
      }
    }
  },

  addOverlays: function(aOverlayList) {
    try {
      // First check over the new overlays, merge them into the master list
      // and if any are for already tracked windows apply them
      for (let [windowURL, newOverlays] in Iterator(aOverlayList)) {
        let newOverlays = aOverlayList[windowURL];

        if (!(windowURL in this.overlays))
          this.overlays[windowURL] = {};
        let existingOverlays = this.overlays[windowURL];

        ["documents", "styles", "scripts"].forEach(function(aType) {
          if (!(aType in newOverlays))
            return;

          if (!(aType in existingOverlays))
            existingOverlays[aType] = newOverlays[aType].slice(0);
          else
            existingOverlays[aType].push(newOverlays[aType]);
        }, this);

        // Apply the new overlays to any already tracked windows
        if (windowURL in this.windowEntries) {
          this.windowEntries[windowURL].forEach(function(aWindowEntry) {
            this.applyWindowEntryOverlays(aWindowEntry, newOverlays);
          }, this);
        }
      }

      // Search over existing windows to see if any need to be tracked now
      let windows = Services.wm.getEnumerator(null);
      while (windows.hasMoreElements()) {
        let domWindow = windows.getNext().QueryInterface(Ci.nsIDOMWindow);
        let windowURL = domWindow.location.toString();

        // If we are adding overlays for this window and not already tracking
        // this window then start to track it and add the new overlays
        if ((windowURL in aOverlayList) && !(windowURL in this.windowEntries)) {
          let windowEntry = this.createWindowEntry(domWindow, aOverlayList[windowURL]);
        }
      }
    }
    catch (e) {
      ERROR("Exception adding overlay list", e);
    }
  },

  addComponent: function(aCid, aComponentURL, aContract) {
    if (aContract) {
      try {
        let cid = Cm.contractIDToCID(aContract);
        // It's possible to have a contract to CID mapping when the CID doesn't
        // exist
        if (Cm.isCIDRegistered(cid))
          this.contracts.push([aContract, cid]);
      }
      catch (e) {
      }
    }

    aCid = Components.ID(aCid);
    Cm.registerFactory(aCid, null, aContract, {
      _sandbox: null,

      createInstance: function(aOuter, aIID) {
        if (!this._sandbox) {
          let principal = Cc["@mozilla.org/systemprincipal;1"].
                          createInstance(Ci.nsIPrincipal);
          this._sandbox = createSandbox(principal, aComponentURL);
        }

        if (!("NSGetFactory" in this._sandbox)) {
          ERROR("Component " + aComponentURL + " is missing NSGetFactory");
          throw Cr.NS_ERROR_FACTORY_NOT_REGISTERED;
        }

        try {
          return this._sandbox.NSGetFactory(aCid).createInstance(aOuter, aIID);
        }
        catch (e) {
          ERROR("Exception initialising component " + aContract + " from " + aComponentURL, e);
          throw e;
        }
      }
    });

    this.components.push(aCid);
  },

  addCategory: function(aCategory, aEntry, aValue) {
    let cm = Cc["@mozilla.org/categorymanager;1"].
             getService(Ci.nsICategoryManager);
    cm.addCategoryEntry(aCategory, aEntry, aValue, false, true);
    this.categories.push([aCategory, aEntry]);
  },

  getScriptContext: function(aDOMWindow, aScriptURL) {
    if (!this.windowEntryMap.has(aDOMWindow))
      return null;
    let windowEntry = this.windowEntryMap.get(aDOMWindow);
    if (!(aScriptURL in windowEntry.scripts))
      return null;
    return windowEntry.scripts[aScriptURL];
  },

  // nsIEventListener implementation
  handleEvent: function(aEvent) {
    try {
      let domWindow = aEvent.currentTarget;

      switch (aEvent.type) {
      case "load":
        domWindow.removeEventListener("load", this, false);
        let windowURL = domWindow.location.toString();
        // Track this window if there are overlays for it
        if (windowURL in this.overlays) {
          let tm = Cc["@mozilla.org/thread-manager;1"].
                   getService(Ci.nsIThreadManager);

          let overlays = this.overlays[windowURL];

          // Defer adding overlays until immediately after the load events fire
          tm.mainThread.dispatch({
            run: function() {
              OverlayManagerInternal.createWindowEntry(domWindow, overlays);
            }
          }, Ci.nsIThread.DISPATCH_NORMAL);
        }
        break;
      case "unload":
        if (!this.windowEntryMap.has(domWindow)) {
          ERROR("Saw unload event for unknown window " + domWindow.location);
          return;
        }
        let windowEntry = this.windowEntryMap.get(domWindow);
        OverlayManagerInternal.destroyWindowEntry(windowEntry);
        break;
      }
    }
    catch (e) {
      ERROR("Error during window " + aEvent.type, e);
    }
  },

  // nsIWindowMediatorListener implementation
  onOpenWindow: function(aXULWindow) {
    let domWindow = aXULWindow.QueryInterface(Ci.nsIInterfaceRequestor)
                              .getInterface(Ci.nsIDOMWindow);

    // We can't get the window's URL until it is loaded
    domWindow.addEventListener("load", this, false);
  },

  onWindowTitleChange: function() { },
  onCloseWindow: function() { },
};

OverlayManagerInternal.init();
