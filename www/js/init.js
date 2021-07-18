/**
 * init.js : Configuration for the library require.js
 * This file handles the dependencies between javascript libraries
 * 
 * Copyright 2013-2020 Mossroy and contributors
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

/**
 * A global parameter object for storing variables that need to be remembered between page loads,
 * or across different functions and modules
 * 
 * @type Object
 */
var params = {};

require.config({
    baseUrl: 'js/lib',
    paths: {
        'jquery': 'jquery-3.2.1.slim',
        'bootstrap': 'bootstrap.bundle',
        'webpHeroBundle': 'webpHeroBundle_0.0.0-dev.27',
        'fontawesome': 'fontawesome/fontawesome',
        'fontawesome-solid': 'fontawesome/solid'
    },
    shim: {
        'jquery': {
            exports: '$'
        },
        'bootstrap': {
            deps: ['jquery', 'fontawesome', 'fontawesome-solid']
        },
        'webpHeroBundle': ''
    }
});

requirejs(['bootstrap', 'arrayFromPolyfill', 'promisePolyfill'], function () {
    requirejs(['../app']);
});

// Test if WebP is natively supported, and if not, set webpMachine to true. The value of webpMachine
// will determine whether the WebP Polyfills will be loaded (currently only used in uiUtil.js)
var webpMachine = false;

// We use a self-invoking function here to avoid defining unnecessary global functions and variables
(function (callback) {
    // Tests for native WebP support
    var webP = new Image();
    webP.onload = webP.onerror = function () {
        callback(webP.height === 2);
    };
    webP.src = 'data:image/webp;base64,UklGRjoAAABXRUJQVlA4IC4AAACyAgCdASoCAAIALmk0mk0iIiIiIgBoSygABc6WWgAA/veff/0PP8bA//LwYAAA';
})(function (support) {
    if (!support) {
        webpMachine = true;
    }
});