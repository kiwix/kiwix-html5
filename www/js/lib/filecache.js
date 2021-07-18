/**
 * filecache.js: Generic cache for small, frequently read file slices.
 * It discards cached blocks according to a least-recently-used algorithm.
 * It is used primarily for fast Directory Entry lookup, speeding up binary search.
 *
 * Copyright 2020 Mossroy, peter-x, jaifroid and contributors
 * License GPL v3:
 *
 * This file is part of Kiwix.
 *
 * Kiwix JS is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Kiwix JS is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Kiwix JS (file LICENSE).  If not, see <http://www.gnu.org/licenses/>
 */
'use strict';

define([], function () {
    /**
     * Set maximum number of cache blocks of BLOCK_SIZE bytes each
     * Maximum size of cache in bytes = MAX_CACHE_SIZE * BLOCK_SIZE
     * @constant
     * @type {Number}
     */
    const MAX_CACHE_SIZE = 4000;

    /**
     * The maximum blocksize to read or store via the block cache (bytes)
     * @constant
     * @type {Number}
     */
    const BLOCK_SIZE = 4096;

    /**
     * A Block Cache employing a Least Recently Used caching strategy
     * @typedef {Object} BlockCache
     * @property {Number} capacity The maximum number of entries in the cache 
     * @property {Map} cache A map to store the cache keys and data
     */

    /**
     * Creates a new cache with max size limit of MAX_CACHE_SIZE blocks
     * LRUCache implemnentation with Map adapted from https://markmurray.co/blog/lru-cache/
     */
    function LRUCache() {
        /** CACHE TUNING **/
        // console.log('Creating cache of size ' + MAX_CACHE_SIZE + ' * ' + BLOCK_SIZE + ' bytes');
        // Initialize persistent Cache properties
        this.capacity = MAX_CACHE_SIZE;
        this.cache = new Map();
    }

    /**
     * Tries to retrieve an element by its id. If it is not present in the cache, returns undefined; if it is present,
     * then the value is returned and the entry is moved to the bottom of the cache
     * @param {String} key The block cache entry key (file.id + ':' + byte offset)
     * @returns {Uint8Array | undefined} The requested cache data or undefined 
     */
    LRUCache.prototype.get = function (key) {
        var entry = this.cache.get(key);
        // If the key does not exist, return
        if (!entry) return entry;
        // Remove the key and re-insert it (this moves the key to the bottom of the Map: bottom = most recent)
        this.cache.delete(key);
        this.cache.set(key, entry);
        // Return the cached data
        return entry;
    };

    /**
     * Stores a value in the cache by id and prunes the least recently used entry if the cache is larger than MAX_CACHE_SIZE
     * @param {String} key The key under which to store the value (file.id + ':' + byte offset from start of ZIM archive)
     * @param {Uint8Array} value The value to store in the cache 
     */
    LRUCache.prototype.store = function (key, value) {
        // We get the existing entry's object for memory-management purposes; if it exists, it will contain identical data
        // to <value>, but <entry> is strongly referenced by the Map. (It should be rare that two async Promises attempt to
        // store the same data in the Cache, once the Cache is sufficiently populated.)
        var entry = this.cache.get(key);
        // If the key already exists, delete it and re-insert it, so that it will be added
        // to the bottom of the Map (bottom = most recent)
        if (entry) this.cache.delete(key);
        else entry = value;
        this.cache.set(key, entry);
        // If we've exceeded the cache capacity, then delete the least recently accessed value, 
        // which will be the item at the top of the Map, i.e the first position
        if (this.cache.size > this.capacity) {
            if (this.cache.keys) {
                var firstKey = this.cache.keys().next().value;
                this.cache.delete(firstKey);
            } else {
                // IE11 doesn't support the keys iterator, so we have to do a forEach loop through all 4000 entries
                // to get the oldest values. To prevent excessive iterations, we delete 25% at a time.
                var q = Math.floor(0.25 * this.capacity);
                var c = 0;
                // console.log('Deleteing ' + q + ' cache entries');
                this.cache.forEach(function (v, k, map) {
                    if (c > q) return;
                    map.delete(k);
                    c++;
                });
            }
        }
    };

    /**
     * A new Block Cache
     * @type {BlockCache}
     */
    var cache = new LRUCache();

    /** CACHE TUNING **/ 
    // DEV: Uncomment this block and blocks below marked 'CACHE TUNING' to measure Cache hit and miss rates for different Cache sizes
    // var hits = 0;
    // var misses = 0;

    /**
     * Read a certain byte range in the given file, breaking the range into chunks that go through the cache
     * If a read of more than BLOCK_SIZE * 2 (bytes) is requested, do not use the cache
     * @param {Object} file The requested ZIM archive to read from
     * @param {Number} begin The byte from which to start reading
     * @param {Number} end The byte at which to stop reading (end will not be read)
     * @return {Promise<Uint8Array>} A Promise that resolves to the correctly concatenated data from the cache 
     *     or from the ZIM archive
     */
    var read = function (file, begin, end) {
        // Read large chunks bypassing the block cache because we would have to
        // stitch together too many blocks and would clog the cache
        if (end - begin > BLOCK_SIZE * 2) return file._readSplitSlice(begin, end);
        var readRequests = [];
        var blocks = {};
        // Look for the requested data in the blocks: we may need to stitch together data from two or more blocks
        for (var id = Math.floor(begin / BLOCK_SIZE) * BLOCK_SIZE; id < end; id += BLOCK_SIZE) {
            var block = cache.get(file.id + ':' + id);
            if (block === undefined) {
                // Data not in cache, so read from archive
                /** CACHE TUNING **/
                // misses++;
                // DEV: This is a self-calling function, i.e. the function is called with an argument of <id> which then 
                // becomes the <offset> parameter
                readRequests.push(function (offset) {
                    return file._readSplitSlice(offset, offset + BLOCK_SIZE).then(function (result) {
                        cache.store(file.id + ':' + offset, result);
                        blocks[offset] = result;
                    });
                }(id));
            } else {
                /** CACHE TUNING **/
                // hits++;
                blocks[id] = block;
            }
        }
        /** CACHE TUNING **/
        // if (misses + hits > 2000) {
        //     console.log('** Block cache hit rate: ' + Math.round(hits / (hits + misses) * 1000) / 10 + '% [ hits:' + hits + 
        //         ' / misses:' + misses + ' ] Size: ' + cache.cache.size);
        //     hits = 0;
        //     misses = 0;
        // }
        // Wait for all the blocks to be read either from the cache or from the archive
        return Promise.all(readRequests).then(function () {
            var result = new Uint8Array(end - begin);
            var pos = 0;
            // Stitch together the data parts in the right order
            for (var i = Math.floor(begin / BLOCK_SIZE) * BLOCK_SIZE; i < end; i += BLOCK_SIZE) {
                var b = Math.max(i, begin) - i;
                var e = Math.min(end, i + BLOCK_SIZE) - i;
                if (blocks[i].subarray) result.set(blocks[i].subarray(b, e), pos);
                pos += e - b;
            }
            return result;
        });
    };

    return {
        read: read
    };
});