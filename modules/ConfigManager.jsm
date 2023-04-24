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

const EXPORTED_SYMBOLS = ["ConfigManager"];

Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://gre/modules/NetUtil.jsm");
Components.utils.import("resource://webapptabs/modules/LogManager.jsm");
LogManager.createLogger(this, "ConfigManager");

const Cc = Components.classes;
const Ci = Components.interfaces;
const Ce = Components.Exception;
const Cr = Components.results;

const EXTPREFNAME = "extensions.webappsm2.webapps";

const WEBAPP_SCHEMA = 1;
const DEFAULT_WEBAPPS = [{
  'id': 'pegase',
  'name': 'P\u00E9gase',
  'href': 'https://mceweb2.si.minint.fr/pegase/',
  'icon': 'https://mceweb2.si.minint.fr/pegase/favicon.ico',
  'show': true,
  'login': true,
  'autologin': true,
  'login_page': 'https://mceweb2.si.minint.fr/pegase/?_p=login',
  'external_login_page': 'https://mceweb2.si.minint.fr/pegase/?_p=external_login',
  'login_params': 'username=%%username%%&password=%%password%%&timezone=%%timezone%%',
  'request_type': 'POST',
  'url': {
    'createPoll': 'https://mceweb2.si.minint.fr/pegase/?_p=edit&_a=new',
  },
}, {
  'id': 'export_agenda',
  'name': 'Export agenda',
  'href': 'https://mceweb2.si.minint.fr/?_task=calendar',
  'show': false,
  'login': false,
}, {
  'id': 'export_contacts',
  'name': 'Export contacts',
  'href': 'https://mceweb2.si.minint.fr/?_task=addressbook',
  'show': false,
  'login': false,
}, {
  'id': 'roundcube',
  'name': 'Mon compte',
  'href': 'https://mceweb2.si.minint.fr/?_task=settings',
  'icon': 'https://mceweb2.si.minint.fr/skins/mel_larry/images/favicon.ico',
  'show': true,
  'login': true,
  'autologin': true,
  'login_page': 'https://mceweb2.si.minint.fr/?_task=login&_courrielleur=1',
  'login_params': '_user=%%username%%&_pass=%%password%%&_task=login&_action=login&_keeplogin=1',
  'request_type': 'POST',
  'default_url': 'https://mceweb2.si.minint.fr/?_task=settings&_action=plugin.mel_moncompte&_courrielleur=1',
  'url': {
    'createFilter': 'https://mceweb2.si.minint.fr/?_task=settings&_action=plugin.managesieve&_courrielleur=1',
    'shareCalendar': 'https://mceweb2.si.minint.fr/?_task=settings&_action=plugin.mel_resources_agendas&_courrielleur=1',
    'shareTaskslist': 'https://mceweb2.si.minint.fr/?_task=settings&_action=plugin.mel_resources_tasks&_courrielleur=1',
    'shareAddressbook': 'https://mceweb2.si.minint.fr/?_task=settings&_action=plugin.mel_resources_contacts&_courrielleur=1',
  },
}];

const ConfigManager = {
  webappList: null,
  changeListeners: [],

  addChangeListener: function(aListener) {
    this.changeListeners.push(aListener);
  },

  removeChangeListener: function(aListener) {
    let pos = this.changeListeners.indexOf(aListener);
    this.changeListeners.splice(pos, 1);
  },

  isURLForWebApp: function(aURL, aDesc) {
    let descURL = NetUtil.newURI(aDesc.href);

//    function schemeMatches() {
//      // Allow http and https to mean the same thing for now
//      if (descURL.scheme == aURL.scheme)
//        return true;
//      if (descURL.scheme == "https" && aURL.scheme == "http")
//        return true;
//      if (descURL.scheme == "http" && aURL.scheme == "https")
//        return true;
//      return false;
//    }
//
//    function hostMatches() {
//      // Trim off any leading "www." before comparing hostnames
//      let descHost = descURL.hostPort;
//      if (descHost.substring(0, 4) == "www.")
//        descHost = descHost.substring(4);
//      let urlHost = aURL.hostPort;
//      if (urlHost.substring(0, 4) == "www.")
//        urlHost = urlHost.substring(4);
//
//      return urlHost == descHost;
//    }
//
//    if (!schemeMatches() || !hostMatches())
//      return false;
//
//    return aURL.path.substring(0, descURL.path.length) == descURL.path;
    return aURL.asciiSpec.substring(0, descURL.asciiSpec.length) == descURL.asciiSpec;
  },

  getWebAppForURL: function(aURL) {
    let descs = this.webappList.filter(this.isURLForWebApp.bind(this, aURL));
    if (descs.length > 0)
      return descs[0];
    return null;
  },

  updatePrefs: function() {
    this.webappList.forEach(function(aDesc) {
      if (!aDesc.id)
        aDesc.id = aDesc.name.replace(' ', '_', 'g');
    });

    this.changeListeners.forEach(function(aListener) {
      try {
        aListener();
      }
      catch (e) {
        ERROR("Exception calling config change listener", e);
      }
    }, this);
  },

//  persistPrefs: function() {
//    let jsondata = JSON.stringify({
//      schema: WEBAPP_SCHEMA,
//      webapps: this.webappList,
//    })
//    Services.prefs.setCharPref(EXTPREFNAME, jsondata);
//    Services.prefs.savePrefFile(null);
//  },

  loadPrefs: function() {
//    try {
//      let data = JSON.parse(Services.prefs.getCharPref(EXTPREFNAME));
//      let schema = 0;
//      if ("schema" in data)
//        schema = data.schema;
//
//      switch (schema) {
//      case WEBAPP_SCHEMA:
//        this.webappList = data.webapps;
//        break;
//      default:
//        throw new Ce("Unknown webapps data schema " + schema);
//      }
//
//      return;
//    }
//    catch (e) {
//      ERROR("Failed to read webapps from config", e);
//    }

    this.webappList = DEFAULT_WEBAPPS;
    this.webappList.forEach(function(aDesc) {
      if (!aDesc.id)
        aDesc.id = aDesc.name.replace(' ', '_', 'g');
    });
//    this.persistPrefs();
  }
};

ConfigManager.loadPrefs();
