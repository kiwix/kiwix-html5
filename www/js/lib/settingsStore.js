'use strict';
define([], function () {
  /**
   * settingsStore.js
   * 
   * A reader/writer framework for cookies or localStorage with full unicode support based on the Mozilla cookies framework.
   * The Mozilla code has been adapted to test for the availability of the localStorage API, and to use it in preference to cookies.
   * 
   * Mozilla version information:
   * 
   * Revision #1 - September 4, 2014
   * 
   * https://developer.mozilla.org/en-US/docs/Web/API/document.cookie
   * https://developer.mozilla.org/User:fusionchess
   * 
   * This framework is released under the GNU Public License, version 3 or later.
   * http://www.gnu.org/licenses/gpl-3.0-standalone.html
   *
   * Syntaxes:
   *
   *  * settingsStore.setItem(name, value[, end[, path[, domain[, secure]]]])
   *  * settingsStore.getItem(name)
   *  * settingsStore.removeItem(name[, path[, domain]])
   *  * settingsStore.hasItem(name)
   *  * settingsStore.cookieKeys()
   * 
   */
  
  // Tests for localStorage or cookie support
  function testStorageSupport() {
    // DEV: In FF extensions, cookies are blocked since at least FF 68.6 but possibly since FF 55 [kiwix-js #612]
    var type = 'none';
    // First test for localStorage API support
    var localStorageTest;
    try {
      localStorageTest = 'localStorage' in window && window['localStorage'] !== null;
      // DEV: Above test returns true in IE11 running from file:// protocol, but attempting to write a key to
      // localStorage causes an exception; so to test fully, we must now attempt to write and remove a test key
      if (localStorageTest) {
        localStorage.setItem('tempKiwixStorageTest', '');
        localStorage.removeItem('tempKiwixStorageTest');
      }
    } catch (e) {
      localStorageTest = false;
    }
    // Now test for document.cookie API support
    document.cookie = 'tempKiwixCookieTest=working;expires=Fri, 31 Dec 9999 23:59:59 GMT';
    var kiwixCookieTest = /tempKiwixCookieTest=working/.test(document.cookie);
    // Remove test value by expiring the key
    document.cookie = 'tempKiwixCookieTest=;expires=Thu, 01 Jan 1970 00:00:00 GMT';
    if (kiwixCookieTest) type = 'cookie';
    // Prefer localStorage if supported due to some platforms removing cookies once the session ends in some contexts
    if (localStorageTest) type = 'local_storage';
    // If both cookies and localStorage are supported, and document.cookie has not already been voided, migrate settings to use localStorage
    if (kiwixCookieTest && localStorageTest && document.cookie !== '') _migrateStorageSettings(); 
    // Note that if this function returns 'none', the cookie implementations below will run anyway. This is because storing a cookie
    // does not cause an exception even if cookies are blocked in some contexts, whereas accessing localStorage may cause an exception
    return type;
  }

  var settingsStore = {
    getItem: function (sKey) {
      if (params.storeType !== 'local_storage') {
        if (!sKey) {
          return null;
        }
        return decodeURIComponent(document.cookie.replace(new RegExp("(?:(?:^|.*;)\\s*" + encodeURIComponent(sKey).replace(/[-.+*]/g, "\\$&") + "\\s*\\=\\s*([^;]*).*$)|^.*$"), "$1")) || null;
      } else {
        return localStorage.getItem(sKey);
      }
    },
    setItem: function (sKey, sValue, vEnd, sPath, sDomain, bSecure) {
      if (params.storeType !== 'local_storage') {
        if (!sKey || /^(?:expires|max-age|path|domain|secure)$/i.test(sKey)) {
          return false;
        }
        var sExpires = "";
        if (vEnd) {
          switch (vEnd.constructor) {
            case Number:
              sExpires = vEnd === Infinity ? "; expires=Fri, 31 Dec 9999 23:59:59 GMT" : "; max-age=" + vEnd;
              break;
            case String:
              sExpires = "; expires=" + vEnd;
              break;
            case Date:
              sExpires = "; expires=" + vEnd.toUTCString();
              break;
          }
        }
        document.cookie = encodeURIComponent(sKey) + "=" + encodeURIComponent(sValue) + sExpires + (sDomain ? "; domain=" + sDomain : "") + (sPath ? "; path=" + sPath : "") + (bSecure ? "; secure" : "");
      } else {
        localStorage.setItem(sKey, sValue);
      }
      return true;
    },
    removeItem: function (sKey, sPath, sDomain) {
      if (!this.hasItem(sKey)) {
        return false;
      }
      if (params.storeType !== 'local_storage') {
        document.cookie = encodeURIComponent(sKey) + "=; expires=Thu, 01 Jan 1970 00:00:00 GMT" + (sDomain ? "; domain=" + sDomain : "") + (sPath ? "; path=" + sPath : "");
      } else {
        localStorage.removeItem(sKey);
      }
      return true;
    },
    hasItem: function (sKey) {
      if (!sKey) {
        return false;
      }
      if (params.storeType !== 'local_storage') {
        return (new RegExp("(?:^|;\\s*)" + encodeURIComponent(sKey).replace(/[-.+*]/g, "\\$&") + "\\s*\\=")).test(document.cookie);
      } else {
        return localStorage.getItem(sKey) === null ? false : true;
      }
    },
    cookieKeys: function () {
      var aKeys = document.cookie.replace(/((?:^|\s*;)[^=]+)(?=;|$)|^\s*|\s*(?:=[^;]*)?(?:\1|$)/g, "").split(/\s*(?:=[^;]*)?;\s*/);
      for (var nLen = aKeys.length, nIdx = 0; nIdx < nLen; nIdx++) { aKeys[nIdx] = decodeURIComponent(aKeys[nIdx]); }
      return aKeys;
    }
  };

  // One-off migration of storage settings from cookies to localStorage
  function _migrateStorageSettings() {
    console.log('Migrating Settings Store from cookies to localStorage...');
    var cookieKeys = settingsStore.cookieKeys();
    // Note that because migration occurs before setting params.storeType, settingsStore.getItem() will get the item from
    // document.cookie instead of localStorage, which is the intended behaviour
    for (var i = 0; i < cookieKeys.length; i++) {
      localStorage.setItem(cookieKeys[i], settingsStore.getItem(cookieKeys[i]));
      settingsStore.removeItem(cookieKeys[i]);
      console.log('- ' + cookieKeys[i]);
    }
    console.log('Migration done.');
  }

  return {
    getItem: settingsStore.getItem,
    setItem: settingsStore.setItem,
    removeItem: settingsStore.removeItem,
    hasItem: settingsStore.hasItem,
    cookieKeys: settingsStore.cookieKeys,
    testStorageSupport: testStorageSupport
  };
});