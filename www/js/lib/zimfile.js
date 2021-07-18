/**
 * zimfile.js: Low-level ZIM file reader.
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

define(['xzdec_wrapper', 'zstddec_wrapper', 'util', 'utf8', 'zimDirEntry', 'filecache'], function(xz, zstd, util, utf8, zimDirEntry, FileCache) {

    /**
     * A variable to keep track of the currently loaded ZIM archive, e.g., for labelling cache entries
     * The ID is temporary and is reset to 0 at each session start; it is incremented by 1 each time a new ZIM is loaded
     * @type {Integer} 
     */
    var tempFileId = 0;

    /**
     * A Map to keep track of temporary File IDs
     * @type {Map}
     */
    var fileIDs = new Map();

    var readInt = function (data, offset, size) {
        var r = 0;
        for (var i = 0; i < size; i++) {
            var c = (data[offset + i] + 256) & 0xff;
            r += util.leftShift(c, 8 * i);
        }
        return r;
    };
                
    /**
     * A ZIM File
     * 
     * See https://wiki.openzim.org/wiki/ZIM_file_format#Header
     * 
     * @typedef {Object} ZIMFile
     * @property {Array<File>} _files Array of ZIM files
     * @property {String} name Abstract archive name for file set
     * @property {Integer} id Arbitrary numeric ZIM id used to track the currently loaded archive
     * @property {Integer} entryCount Total number of entries in the URL pointerlist
     * @property {Integer} articleCount Total number of article titles in the v1 article-only pointerlist (async calculated entry)
     * @property {Integer} clusterCount Total number of clusters
     * @property {Integer} urlPtrPos Position of the directory pointerlist ordered by URL
     * @property {Integer} titlePtrPos Position of the legacy v0 pointerlist ordered by title
     * @property {Integer} articlePtrPos Position of the v1 article-only pointerlist ordered by title (async calculated entry)
     * @property {Integer} clusterPtrPos Position of the cluster pointer list
     * @property {Integer} mimeListPos Position of the MIME type list (also header size)
     * @property {Integer} mainPage Main page or 0xffffffff if no main page
     * @property {Integer} layoutPage Layout page or 0xffffffffff if no layout page
     * @property {Map} mimeTypes The ZIM file's MIME type table rendered as a Map (calculated entry)
     */
    
    /**
     * Abstract an array of one or more (split) ZIM archives
     * @param {Array<File>} abstractFileArray An array of ZIM file parts
     */
    function ZIMFile(abstractFileArray) {
        this._files = abstractFileArray;
    }

    /**
     * Read and decode an integer value from the ZIM archive
     * @param {Integer} offset The offset at which the integer is found
     * @param {Integer} size The size of data to read
     * @returns {Promise<Integer>} A Promise for the returned value 
     */
    ZIMFile.prototype._readInteger = function (offset, size) {
        return this._readSlice(offset, size).then(function (data) {
            return readInt(data, 0, size);
        });
    };

    /**
     * Read a slice from the FileCache or ZIM set, starting at offset for size of bytes
     * @param {Integer} offset The absolute offset from the start of the ZIM file or file set at which to start reading
     * @param {Integer} size The number of bytes to read
     * @returns {Promise<Uint8Array>} A Promise for a Uint8Array containing the requested data
     */
    ZIMFile.prototype._readSlice = function(offset, size) {
        return FileCache.read(this, offset, offset + size);
    };

    /**
     * Read a slice from a set of one or more ZIM files constituting a single archive, and concatenate the data parts
     * @param {Integer} begin The absolute byte offset from which to start reading 
     * @param {Integer} end The absolute byte offset where reading should stop (the end byte is not read)
     * @returns {Promise<Uint8Array>} A Promise for a Uint8Array containing the concatenated data 
     */
    ZIMFile.prototype._readSplitSlice = function (begin, end) {
        var file = this;
        var readRequests = [];
        var currentOffset = 0;
        for (var i = 0; i < file._files.length; currentOffset += file._files[i].size, ++i) {
            var currentSize = file._files[i].size;
            if (begin < currentOffset + currentSize && currentOffset < end) {
                // DEV: Math.max is used below because we could be reading the last part of a blob split across two files,
                // in which case (begin - currentOffset) could be negative!
                var readStart = Math.max(0, begin - currentOffset);
                var readEnd = Math.min(currentSize, end - currentOffset);
                readRequests.push(util.readFileSlice(file._files[i], readStart, readEnd));
            }
        }
        if (readRequests.length === 0) {
            return Promise.resolve(new Uint8Array(0).buffer);
        } else if (readRequests.length === 1) {
            return readRequests[0];
        } else {
            // Wait until all are resolved and concatenate.
            return Promise.all(readRequests).then(function (arrays) {
                var concatenated = new Uint8Array(end - begin);
                var offset = 0;
                arrays.forEach(function (item) {
                    concatenated.set(new Uint8Array(item), offset);
                    offset += item.byteLength;
                });
                return concatenated;
            });
        }
    };

    /**
     * Read and parse a Directory Entry at the given archive offset
     * @param {Integer} offset The offset at which the DirEntry is located
     * @returns {Promise<DirEntry>} A Promise for the requested DirEntry
     */
    ZIMFile.prototype.dirEntry = function (offset) {
        var that = this;
        return this._readSlice(offset, 2048).then(function (data) {
            var dirEntry = {
                offset: offset,
                mimetypeInteger: readInt(data, 0, 2),
                namespace: String.fromCharCode(data[3])
            };
            dirEntry.redirect = (dirEntry.mimetypeInteger === 0xffff);
            if (dirEntry.redirect) {
                dirEntry.redirectTarget = readInt(data, 8, 4);
            } else {
                dirEntry.cluster = readInt(data, 8, 4);
                dirEntry.blob = readInt(data, 12, 4);
            }
            var pos = dirEntry.redirect ? 12 : 16;
            if (data.subarray) {
                dirEntry.url = utf8.parse(data.subarray(pos), true);
                while (data[pos] !== 0)
                    pos++;
                dirEntry.title = utf8.parse(data.subarray(pos + 1), true);
                return new zimDirEntry.DirEntry(that, dirEntry);
            }
        });
    };

    /**
     * Find a Directory Entry based on its URL Pointer index
     * @param {Integer} index The URL Pointer index to the DirEntry
     * @returns {Promise<DirEntry>} A Promise for the requested DirEntry
     */
    ZIMFile.prototype.dirEntryByUrlIndex = function (index) {
        var that = this;
        return this._readInteger(this.urlPtrPos + index * 8, 8).then(function (dirEntryPos) {
            return that.dirEntry(dirEntryPos);
        });
    };

    /**
     * Find a Directory Entry based on its Title Pointer index
     * @param {Integer} index The Title Pointer index to the DirEntry
     * @returns {Promise<DirEntry>} A Promise for the requested DirEntry
     */
    ZIMFile.prototype.dirEntryByTitleIndex = function (index) {
        var that = this;
        // Use v1 title pointerlist if available, or fall back to legacy v0 list
        var ptrList = this.articlePtrPos || this.titlePtrPos;
        return this._readInteger(ptrList + index * 4, 4).then(function (urlIndex) {
            return that.dirEntryByUrlIndex(urlIndex);
        });
    };

    /**
     * Read and if necessary decompress a BLOB based on its cluster number and blob number
     * @param {Integer} cluster The cluster number where the blob is to be found
     * @param {Integer} blob The blob number within the cluster
     * @param {Boolean} meta If true, and if the cluster is uncompressed, the function will return only the blob's metadata
     *        (its archive offset and its size), otherwise return null
     * @returns {Promise<Uint8Array>} A Promise for the BLOB's data
     */
    ZIMFile.prototype.blob = function (cluster, blob, meta) {
        var that = this;
        return this._readSlice(this.clusterPtrPos + cluster * 8, 16).then(function (clusterOffsets) {
            var clusterOffset = readInt(clusterOffsets, 0, 8);
            var nextCluster = readInt(clusterOffsets, 8, 8);
            // DEV: The method below of calculating cluster size is not safe: see https://github.com/openzim/libzim/issues/84#issuecomment-612962250
            // var thisClusterLength = nextCluster - clusterOffset - 1;
            return that._readSlice(clusterOffset, 1).then(function (compressionType) {
                var decompressor;
                var plainBlobReader = function (offset, size, dataPass) {
                    // Check that we are not reading beyond the end of the cluster
                    var offsetStart = clusterOffset + 1 + offset;
                    if (offsetStart < nextCluster) {
                        // Gratuitous parentheses added for legibility
                        size = (offsetStart + size) <= nextCluster ? size : (nextCluster - offsetStart);
                        // DEV: This blob reader is called twice: on the first pass it reads the cluster's blob list,
                        // and on the second pass ("dataPass") it is ready to read the blob's data
                        if (meta && dataPass) {
                            // If only metadata were requested and we are on the data pass, we should now have them
                            return {
                                ptr: offsetStart,
                                size: size
                            };
                        } else {
                            return that._readSlice(offsetStart, size);
                        }
                    } else {
                        return Promise.resolve(new Uint8Array(0).buffer);
                    }
                };
                // If only metadata were requested and the cluster is compressed, return null (this is probably a ZIM format error)
                // DEV: This is because metadata are only requested for finding absolute offsets into uncompressed clusters,
                // principally for finding the start and size of a title pointer listing
                if (meta && compressionType[0] > 1) return null;
                if (compressionType[0] === 0 || compressionType[0] === 1) {
                    // uncompressed
                    decompressor = { readSliceSingleThread: plainBlobReader };
                } else if (compressionType[0] === 4) {
                    decompressor = new xz.Decompressor(plainBlobReader);
                } else if (compressionType[0] === 5) {
                    decompressor = new zstd.Decompressor(plainBlobReader);
                } else {
                    return new Uint8Array(); // unsupported compression type
                }
                return decompressor.readSliceSingleThread(blob * 4, 8, false).then(function (data) {
                    var blobOffset = readInt(data, 0, 4);
                    var nextBlobOffset = readInt(data, 4, 4);
                    return decompressor.readSliceSingleThread(blobOffset, nextBlobOffset - blobOffset, true);
                });
            });
        });
    };

    /**
     * A Directory Listing object
     * @typedef {Object} DirListing A list of pointers to directory entries (via the URL pointerlist)
     * @property {String} path The path (url) to the directory entry for the Listing
     * @property {String} ptrName The name of the pointer to the Listing's data that will be added to the ZIMFile obect
     * @property {String} countName The name of the key that will contain the number of entries in the Listing, to be added to the ZIMFile object 
     */

    /**
     * Read the metadata (archive offset pointer, and number of entiries) of one or more ZIM directory Listings.
     * This supports reading a subset of user content that might be ordered differently from the main URL pointerlist.
     * In particular, it supports the v1 article pointerlist, which contains articles sorted by title, superseding the article
     * namespace ('A') in legazy ZIM archives.  
     * @param {Array<DirListing>} listings An array of DirListing objects (see zimArchive.js for examples)  
     * @returns {Promise} A promise that populates calculated entries in the ZIM file header
     */
    ZIMFile.prototype.setListings = function (listings) {
        var that = this;
        // If we are in a legacy ZIM archive, we need to calculate the true article count (of entries in the A namespace)
        // This effectively emulates the v1 article pointerlist
        if (this.minorVersion === 0) {
            console.debug('ZIM DirListing version: 0 (legacy)', this);
            // Initiate a binary search for the first or last article
            var getArticleIndexByOrdinal = function (ordinal) {
                return util.binarySearch(0, that.entryCount, function(i) {
                    return that.dirEntryByTitleIndex(i).then(function(dirEntry) {
                        var ns = dirEntry.namespace;
                        var url = ns + '/' + dirEntry.getTitleOrUrl();
                        var prefix = ordinal === 'first' ? 'A' : 'B';
                        if (prefix < ns) return -1;
                        else if (prefix > ns) return 1;
                        return prefix < url ? -1 : 1;
                    });
                }, true).then(function(index) {
                    return index;
                });
            };
            return getArticleIndexByOrdinal('first').then(function(idxFirstArticle) {
                return getArticleIndexByOrdinal('last').then(function(idxLastArticle) {
                    // Technically idxLastArticle points to the entry after the last article in the 'A' namespace,
                    // We subtract the first from the last to get the number of entries in the 'A' namespace
                    that.articlePtrPos = that.titlePtrPos + idxFirstArticle * 4;
                    that.articleCount = idxLastArticle - idxFirstArticle;
                    console.debug('Calculated article count is: ' + that.articleCount);
                });
            });
        }
        var highestListingVersion = 0;
        var listingAccessor = function (listing) {
            if (!listing) {
                // No more listings, so exit
                console.debug('ZIM DirListing version: ' + highestListingVersion, that);
                console.debug('Article count is: ' + that.articleCount);
                return null;
            }
            // Check if we already have this listing's values, so we don't do redundant binary searches
            if (that[listing.ptrName] && that[listing.countName]) {
                highestListingVersion = Math.max(~~listing.path.replace(/.+(\d)$/, '$1'), highestListingVersion);
                // Get the next listing
                return listingAccessor(listings.pop());
            }
            // Initiate a binary search for the listing URL
            return util.binarySearch(0, that.entryCount, function(i) {
                return that.dirEntryByUrlIndex(i).then(function(dirEntry) {
                    var url = dirEntry.namespace + "/" + dirEntry.url;
                    if (listing.path < url)
                        return -1;
                    else if (listing.path > url)
                        return 1;
                    else
                        return 0;
                });
            }).then(function(index) {
                if (index === null) return null;
                return that.dirEntryByUrlIndex(index);
            }).then(function(dirEntry) {
                if (!dirEntry) return null;
                // Request the metadata for the blob represented by the dirEntry
                return that.blob(dirEntry.cluster, dirEntry.blob, true);
            }).then(function(metadata) {
                // Note that we do not accept a listing if its size is 0, i.e. if it contains no data
                // (although this should not occur, we have been asked to handle it - see kiwix-js #708)
                if (metadata && metadata.size) {
                    that[listing.ptrName] = metadata.ptr;
                    that[listing.countName] = metadata.size / 4; // Each entry uses 4 bytes
                    highestListingVersion = Math.max(~~listing.path.replace(/.+(\d)$/, '$1'), highestListingVersion);
                }
                // Get the next Listing
                return listingAccessor(listings.pop());
            }).catch(function(err) {
                console.error('There was an error accessing a Directory Listing', err);
            });
        };
        listingAccessor(listings.pop());
    };    

    /**
     * Reads the whole MIME type list and returns it as a populated Map
     * The mimeTypeMap is extracted once after the user has picked the ZIM file
     * and is stored as ZIMFile.mimeTypes
     * @param {File} file The ZIM file (or first file in array of files) from which the MIME type list 
     *      is to be extracted
     * @param {Integer} mimeListPos The offset in <file> at which the MIME type list is found
     * @param {Integer} urlPtrPos The offset of URL Pointer List in the archive
     * @returns {Promise} A promise for the MIME Type list as a Map
     */
    function readMimetypeMap(file, mimeListPos, urlPtrPos) {
        var typeMap = new Map;
        var size = urlPtrPos - mimeListPos;
        // ZIM archives produced since May 2020 relocate the URL Pointer List to the end of the archive
        // so we limit the slice size to max 1024 bytes in order to prevent reading the entire archive into an array buffer
        // See https://github.com/openzim/libzim/issues/353
        size = size > 1024 ? 1024 : size;
        return util.readFileSlice(file, mimeListPos, mimeListPos + size).then(function (data) {
            if (data.subarray) {
                var i = 0;
                var pos = -1;
                var mimeString;
                while (pos < size) {
                    pos++;
                    mimeString = utf8.parse(data.subarray(pos), true);
                    // If the parsed data is an empty string, we have reached the end of the MIME type list, so break 
                    if (!mimeString) break;
                    // Store the parsed string in the Map
                    typeMap.set(i, mimeString);
                    i++;
                    while (data[pos]) {
                        pos++;
                    }
                }
            }
            return typeMap;
        }).catch(function (err) {
            console.error('Unable to read MIME type list', err);
            return new Map;
        });
    }

    return {
        /**
         * @param {Array<File>} fileArray An array of picked archive files
         * @returns {Promise<Object>} A Promise for the ZimFile Object
         */
        fromFileArray: function (fileArray) {
            // Array of blob objects should be sorted by their name property
            fileArray.sort(function (a, b) {
                var nameA = a.name.toUpperCase();
                var nameB = b.name.toUpperCase();
                if (nameA < nameB) return -1;
                if (nameA > nameB) return 1;
                return 0;
            });
            return util.readFileSlice(fileArray[0], 0, 80).then(function (header) {
                var mimeListPos = readInt(header, 56, 8);
                var urlPtrPos = readInt(header, 32, 8);
                return readMimetypeMap(fileArray[0], mimeListPos, urlPtrPos).then(function (mapData) {
                    var zf = new ZIMFile(fileArray);
                    // Add an abstract archive name (ignoring split file extensions)
                    zf.name = fileArray[0].name.replace(/(\.zim)\w\w$/i, '$1');
                    // Provide a temporary, per-session numeric ZIM ID used in filecache.js
                    zf.id = fileIDs.get(zf.name);
                    if (zf.id === undefined) {
                        zf.id = tempFileId++;
                        fileIDs.set(zf.name, zf.id);
                    }
                    // For a description of these values, see https://wiki.openzim.org/wiki/ZIM_file_format
                    zf.majorVersion = readInt(header, 4, 2); // Not currently used by this implementation
                    zf.minorVersion = readInt(header, 6, 2); // Used to determine the User Content namespace
                    zf.entryCount = readInt(header, 24, 4);
                    zf.articleCount = null; // Calculated async by setListings() called from zimArchive.js 
                    zf.clusterCount = readInt(header, 28, 4);
                    zf.urlPtrPos = urlPtrPos;
                    zf.titlePtrPos = readInt(header, 40, 8);
                    zf.articlePtrPos = null; // Calculated async by setListings() 
                    zf.clusterPtrPos = readInt(header, 48, 8);
                    zf.mimeListPos = mimeListPos;
                    zf.mainPage = readInt(header, 64, 4);
                    zf.layoutPage = readInt(header, 68, 4);
                    zf.mimeTypes = mapData;
                    return zf;
                });
            });
        }
    };
});
