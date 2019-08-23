/**
 * service-worker.js : Service Worker implementation,
 * in order to capture the HTTP requests made by an article, and respond with the
 * corresponding content, coming from the archive
 * 
 * Copyright 2015 Mossroy and contributors
 * License GPL v3:
 * 
 * This file is part of Kiwix.
 * 
 * Kiwix is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * Kiwix is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 * 
 * You should have received a copy of the GNU General Public License
 * along with Kiwix (file LICENSE-GPLv3.txt).  If not, see <http://www.gnu.org/licenses/>
 */
'use strict';

var CACHE = 'kiwixjs-cache';
// DEV: add any Content-Types you wish to cache to the regexp below, separated by '|'
var cachedContentTypesRegexp = /text\/css|text\/javascript|application\/javascript/i;
// DEV: add any URL schemata that should be excluded from caching with the Cache API to the regex below
// As of 08-2019 the chrome-extension: schema is incompatible with the Cache API
// 'example-extension' is included to show how to add another schema if necessary
// You can test this code by temporarily changing 'example-extension' to 'http' and running on localhost
var excludedURLSchema = /^(?:chrome-extension|example-extension):/i;
// This Map will be used as a fallback volatile cache for the URL schemata not supported above
var assetsCache = new Map();

// Pattern for ZIM file namespace - see https://wiki.openzim.org/wiki/ZIM_file_format#Namespaces
// In our case, there is also the ZIM file name, used as a prefix in the URL
var regexpZIMUrlWithNamespace = /(?:^|\/)([^\/]+\/)([-ABIJMUVWX])\/(.+)/;

self.addEventListener('install', function (event) {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', function (event) {
    // "Claiming" the ServiceWorker is necessary to make it work right away,
    // without the need to reload the page.
    // See https://developer.mozilla.org/en-US/docs/Web/API/Clients/claim
    event.waitUntil(self.clients.claim());
});

var outgoingMessagePort = null;
var fetchCaptureEnabled = false;

self.addEventListener('fetch', function (event) {
    if (fetchCaptureEnabled &&
        regexpZIMUrlWithNamespace.test(event.request.url) &&
        event.request.method === "GET") {

        // The ServiceWorker will handle this request either from CACHE or from app.js

        event.respondWith(
            // First see if the content is in the cache
            fromCache(event.request).then(
                function (response) {
                    // The response was found in the cache so we respond with it 
                    console.log('[SW] Supplying ' + event.request.url + ' from CACHE...');
                    return response;
                },
                function () {
                    // The response was not found in the cache so we look for it in the ZIM
                    // and add it to the cache if it is an asset type (css or js)
                    return fetchRequestFromZIM(event).then(function (response) {
                        // Add css or js assets to CACHE (or update their cache entries) unless the URL schema is not supported
                        if (cachedContentTypesRegexp.test(response.headers.get('Content-Type')) &&
                                !excludedURLSchema.test(event.request.url)) {
                            console.log('[SW] Adding ' + event.request.url + ' to CACHE');
                            event.waitUntil(updateCache(event.request, response.clone()));
                        }
                        return response;
                    }).catch(function (msgPortData, title) {
                        console.error('Invalid message received from app.js for ' + title, msgPortData);
                        return msgPortData;
                    });
                }
            )
        );
    }
    // If event.respondWith() isn't called because this wasn't a request that we want to handle,
    // then the default request/response behavior will automatically be used.
});

self.addEventListener('message', function (event) {
    if (event.data.action === 'init') {
        // On 'init' message, we initialize the outgoingMessagePort and enable the fetchEventListener
        outgoingMessagePort = event.ports[0];
        fetchCaptureEnabled = true;
    }
    if (event.data.action === 'disable') {
        // On 'disable' message, we delete the outgoingMessagePort and disable the fetchEventListener
        outgoingMessagePort = null;
        fetchCaptureEnabled = false;
    }
});

/**
 * Handles fetch events that need to be extracted from the ZIM
 * 
 * @param {Event} fetchEvent The fetch event to be processed
 * @returns {Promise} A Promise for the Response or the rejected invalid message port data
 */
function fetchRequestFromZIM(fetchEvent) {
    return new Promise(function (resolve, reject) {
        var nameSpace;
        var title;
        var titleWithNameSpace;
        var regexpResult = regexpZIMUrlWithNamespace.exec(fetchEvent.request.url);
        var prefix = regexpResult[1];
        nameSpace = regexpResult[2];
        title = regexpResult[3];

        // We need to remove the potential parameters in the URL
        title = removeUrlParameters(decodeURIComponent(title));

        titleWithNameSpace = nameSpace + '/' + title;

        // Let's instantiate a new messageChannel, to allow app.js to give us the content
        var messageChannel = new MessageChannel();
        messageChannel.port1.onmessage = function (msgPortEvent) {
            if (msgPortEvent.data.action === 'giveContent') {
                // Content received from app.js
                var contentLength = msgPortEvent.data.content ? msgPortEvent.data.content.byteLength : null;
                var contentType = msgPortEvent.data.mimetype;
                var headers = new Headers();
                if (contentLength) headers.set('Content-Length', contentLength);
                if (contentType) headers.set('Content-Type', contentType);
                // Test if the content is a video or audio file
                // See kiwix-js #519 and openzim/zimwriterfs #113 for why we test for invalid types like "mp4" or "webm" (without "video/")
                // The full list of types produced by zimwriterfs is in https://github.com/openzim/zimwriterfs/blob/master/src/tools.cpp
                if (contentLength >= 1 && /^(video|audio)|(^|\/)(mp4|webm|og[gmv]|mpeg)$/i.test(contentType)) {
                    // In case of a video (at least), Chrome and Edge need these HTTP headers else seeking doesn't work
                    // (even if we always send all the video content, not the requested range, until the backend supports it)
                    headers.set('Accept-Ranges', 'bytes');
                    headers.set('Content-Range', 'bytes 0-' + (contentLength - 1) + '/' + contentLength);
                }
                var responseInit = {
                    status: 200,
                    statusText: 'OK',
                    headers: headers
                };

                // If we are dealing with an excluded schema, store the response in assetsCache instead of Cache
                // NB we have to store the data in its constitutent format, otherwise the Response is expired by the system 
                if (excludedURLSchema.test(fetchEvent.request.url) && cachedContentTypesRegexp.test(contentType)) {
                    console.log('[SW] Adding EXCLUDED schema URL ' + fetchEvent.request.url + ' to assetsCache');
                    assetsCache.set(fetchEvent.request.url, [msgPortEvent.data.content, responseInit]);
                }

                var httpResponse = new Response(msgPortEvent.data.content, responseInit);

                // Let's send the content back from the ServiceWorker
                resolve(httpResponse);
            } else if (msgPortEvent.data.action === 'sendRedirect') {
                resolve(Response.redirect(prefix + msgPortEvent.data.redirectUrl));
            } else {
                reject(msgPortEvent.data, titleWithNameSpace);
            }
        };
        outgoingMessagePort.postMessage({
            'action': 'askForContent',
            'title': titleWithNameSpace
        }, [messageChannel.port2]);
    });
}

/**
 * Removes parameters and anchors from a URL
 * @param {type} url The URL to be processed
 * @returns {String} The same URL without its parameters and anchors
 */
function removeUrlParameters(url) {
    return url.replace(/([^?#]+)[?#].*$/, '$1');
}

/**
 * Looks up a Request in CACHE and returns a Promise for the matched Response
 * @param {Request} request The Request to fulfill from CACHE
 * @returns {Response} The cached Response (as a Promise) 
 */
function fromCache(request) {
    // If the response has been stored in assetsCache, it is an excluded URL schema
    if (assetsCache.has(request.url)) {
        var data = assetsCache.get(request.url);
        var response = new Response(data[0], data[1]);
        return Promise.resolve(response);
    } else {
        return caches.open(CACHE).then(function (cache) {
            return cache.match(request).then(function (matching) {
                if (!matching || matching.status === 404) {
                    return Promise.reject("no-match");
                }
                return matching;
            });
        });
    }
}

/**
 * Stores or updates in CACHE the given Request/Response pair
 * @param {Request} request The original Request object
 * @param {Response} response The Response received from the server/ZIM
 * @returns {Promise} A Promise for the update action
 */
function updateCache(request, response) {
    return caches.open(CACHE).then(function (cache) {
        return cache.put(request, response);
    });
}