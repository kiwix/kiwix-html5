# Kiwix JS

Kiwix is an offline Wikipedia viewer. See the official site: https://www.kiwix.org/

This is a browser extension developed in HTML5/Javascript.

You can search among the article titles, and read any of them without any Internet access.
All the content of Wikipedia is inside your device (including the images).
It might also work with other content in the OpenZIM format: https://wiki.openzim.org/wiki/OpenZIM , but has been only tested on the Mediawiki-based (Wikipedia, Wikivoyage, etc) and StackExchange ZIM files.

If your Internet access is expensive/rare/slow/unreliable/watched/censored, you still can browse this amazing repository of knowledge and culture.

[![Build Status: Continuous Integration](https://github.com/kiwix/kiwix-js/workflows/CI/badge.svg?query=branch%3Amaster)](https://github.com/kiwix/kiwix-js/actions?query=branch%3Amaster)
[![Build Status: Release](https://github.com/kiwix/kiwix-js/workflows/Release/badge.svg?query=branch%3Amaster)](https://github.com/kiwix/kiwix-js/actions?query=branch%3Amaster)
[![CodeFactor](https://www.codefactor.io/repository/github/kiwix/kiwix-js/badge)](https://www.codefactor.io/repository/github/kiwix/kiwix-js)
[![Kiwix for Firefox](https://img.shields.io/amo/v/kiwix-offline?label=Kiwix%20for%20Firefox)](https://addons.mozilla.org/fr/firefox/addon/kiwix-offline/)
[![Kiwix for Chrome](https://img.shields.io/chrome-web-store/v/donaljnlmapmngakoipdmehbfcioahhk?label=Kiwix%20for%20Chrome)](https://chrome.google.com/webstore/detail/kiwix/donaljnlmapmngakoipdmehbfcioahhk)
[![Kiwix for Edge](https://img.shields.io/badge/dynamic/json?label=Kiwix%20for%20Edge&prefix=v&query=%24.version&url=https%3A%2F%2Fmicrosoftedge.microsoft.com%2Faddons%2Fgetproductdetailsbycrxid%2Fjlepddlenlljlnnhjinfaciabanbnjbp)](https://microsoftedge.microsoft.com/addons/detail/kiwix/jlepddlenlljlnnhjinfaciabanbnjbp)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

## Usage

It uses ZIM files that you can download from https://download.kiwix.org/zim/

You have to download them separately, store them in your filesystem, and manually select them after starting the application.
It is unfortunately not technically possible to "remember" the selected ZIM file and open it automatically (the browsers refuse that for security reasons).

## Some technical details

Technically, after reading an article from a ZIM file, there is a need to "inject" the dependencies (images, css, etc). For compatibility reasons, there are several ways to do it :

- the "jQuery" mode parses the DOM to find the HTML tags of these dependencies and modifies them to put the Base64 content in it. It is compatible with any browser. It works well on Mediawiki-based content but can miss some dependencies on some contents
- the "ServiceWorker" mode uses a Service Worker to catch any HTTP request the page would send and reply with content read from the ZIM file. It is a generic and much cleaner way than jQuery mode, but it does not work on all browsers. And ServiceWorkers are currently disabled by Mozilla in Firefox extensions.

## Compatibility

This is written in HTML/javascript so it should work on many recent browser engines.

### Officially supported platforms

- Mozilla Firefox >=45 (as an extension : https://addons.mozilla.org/fr/firefox/addon/kiwix-offline/)
- Google Chrome (or Chromium) >=58 (as an extension : https://chrome.google.com/webstore/detail/kiwix/donaljnlmapmngakoipdmehbfcioahhk)
- Firefox OS >=1.2 (needs to be installed manually on the device with WebIDE)
- Microsoft Edge (Chromium) >=80 (as an add-on : https://microsoftedge.microsoft.com/addons/detail/kiwix/jlepddlenlljlnnhjinfaciabanbnjbp)
- Universal Windows Platform (UWP) >=10.0.10240 (as an HTML/JS application : see https://github.com/kiwix/kiwix-js-windows/)
- Ubuntu Touch (as an application : https://open.uappexplorer.com/app/kiwix)

### Deprecated platforms

These platforms are deprecated. We still partially test against them, and we'll try to keep compatibility as long as it's not too complicated :

- Microsoft Edge Legacy >=40 (needs to run a local copy of the source code)
- Microsoft Internet Explorer 11 (needs to run a local copy of the source code)

## License

This application is released under the GPL v3 license. See http://www.gnu.org/licenses/ or the included LICENSE-GPLv3.txt file
The source code can be found at https://github.com/kiwix/kiwix-js

## Unit tests

Unit tests can be run by opening `tests/index.html` file in Firefox, Edge, or Chromium/Chrome.

## Public releases and nightly builds

The browser extensions are distributed through the stores of each vendor (see links above). But the packages are also saved in https://download.kiwix.org/release/browsers/ if necessary.

Some nightly builds are generated, and should only be used for testing purpose: https://download.kiwix.org/nightly/

## Previous versions

The first versions of this application were originally part of the Evopedia project: http://www.evopedia.info (now discontinued). There was a "articles nearby" feature, that was able to find articles around your location. It has been deleted from the source code with everything related to Evopedia (but still in git history in versions<=2.0.0)
These first versions were targeting Firefox OS (now discontinued too: we're not lucky ;-) ).
Some Phonegap/Cordova port was started but never finished (see in git history in versions<=2.0.0).

See [CHANGELOG.md](CHANGELOG.md) for the detail of previous versions.
