/**
 * init.js : Configuration for the library require.js
 * This file handles the dependencies between javascript libraries, for the unit tests
 * 
 * Copyright 2013-2014 Mossroy and contributors
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

// Define global params needed for tests to run on existing app code
var params = {};
var webpMachine = true;

require.config({
    baseUrl: (window.__karma__ ? 'base/' : '') + 'www/js/lib/',
    paths: {
        'jquery': 'jquery-3.2.1.slim',
        'webpHeroBundle': 'webpHeroBundle_0.0.0-dev.27'
    },
    shim: {
        'webpHeroBundle': ''
    }
});

requirejs(['arrayFromPolyfill', 'promisePolyfill'], function () {
    requirejs(['../../../tests/tests']);
});