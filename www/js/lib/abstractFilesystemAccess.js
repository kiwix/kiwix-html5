/**
 * abstractFilesystemAccess.js: Abstraction layer for file access.
 * This is currently only implemented for FirefoxOS, but could be extended to
 * Cordova, Electron or other ways to directly browse and read files from the
 * filesystem.
 * It is unfortunately not possible to do that inside a standard browser
 * (even inside an extension).
 * 
 * Copyright 2014 Kiwix developers
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
define([], function() {
    
    /**
     * Storage implemented by Firefox OS
     * 
     * @typedef StorageFirefoxOS
     * @property {DeviceStorage} _storage DeviceStorage
     * @property {String} storageName Name of the storage
     */
    
    /**
     * Creates an abstraction layer around the FirefoxOS storage.
     * @param storage FirefoxOS DeviceStorage object
     */
    function StorageFirefoxOS(storage) {
        this._storage = storage;
        this.storageName = storage.storageName;
    };
    /**
     * Access the given file.
     * @param {String} path absolute path to the file
     * @return {Promise} Promise which is resolved with a HTML5 file object and
     *         rejected with an error message.
     */
    StorageFirefoxOS.prototype.get = function(path) {
        var that = this;
        return new Promise(function (resolve, reject){
            var request = that._storage.get(path);
            request.onsuccess = function() { resolve(this.result); };
            request.onerror = function() { reject(this.error.name); };
        });
    };
    
    // We try to match both a standalone ZIM file (.zim) or
    // the first file of a split ZIM files collection (.zimaa)
    var regexpZIMFileName = /\.zim(aa)?$/i;
    
    /**
     * Searches for archive files or directories.
     * @return {Promise} Promise which is resolved with an array of
     *         paths and rejected with an error message.
     */
    StorageFirefoxOS.prototype.scanForArchives = function() {
        var that = this;
        return new Promise(function (resolve, reject){
            var directories = [];
            var cursor = that._storage.enumerate();
            cursor.onerror = function () {
                reject(cursor.error);
            };
            cursor.onsuccess = function () {
                if (!cursor.result) {
                    resolve(directories);
                    return;
                }
                var file = cursor.result;

                if (regexpZIMFileName.test(file.name)) {
                    directories.push(file.name);
                }

                cursor.continue();
            };
        });
    };
    
    /**
     * Browse a path through DeviceStorage API
     * @param path Path where to look for files
     * @return {DOMCursor} Cursor of files found in given path
     */
    StorageFirefoxOS.prototype.enumerate = function(path) {
        return this._storage.enumerate();
    };


    return {
        StorageFirefoxOS: StorageFirefoxOS
    };
});
