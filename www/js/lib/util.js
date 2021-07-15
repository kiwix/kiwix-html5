/**
 * util.js : Utility functions
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
define([], function() {

    /**
     * A Regular Expression to match the first letter of a word even if preceded by Unicode punctuation
     * Includes currency signs and mathematical symbols: see https://stackoverflow.com/a/21396529/9727685
     * DEV: To maintain the list below, see https://github.com/slevithan/xregexp/blob/master/tools/output/categories.js
     * where all the different Unicode punctuation categories can be found (simplify double backspacing before using below)
     * Note that the XRegExp punctuation categories begin at !-# in list below
     * @type {RegExp} 
     */
    var regExpFindStringParts = /(?:^|.+?)(?:[\s$£€\uFFE5^+=`~<>{}[\]|\u3000-\u303F!-#%-\x2A,-/:;\x3F@\x5B-\x5D_\x7B}\u00A1\u00A7\u00AB\u00B6\u00B7\u00BB\u00BF\u037E\u0387\u055A-\u055F\u0589\u058A\u05BE\u05C0\u05C3\u05C6\u05F3\u05F4\u0609\u060A\u060C\u060D\u061B\u061E\u061F\u066A-\u066D\u06D4\u0700-\u070D\u07F7-\u07F9\u0830-\u083E\u085E\u0964\u0965\u0970\u0AF0\u0DF4\u0E4F\u0E5A\u0E5B\u0F04-\u0F12\u0F14\u0F3A-\u0F3D\u0F85\u0FD0-\u0FD4\u0FD9\u0FDA\u104A-\u104F\u10FB\u1360-\u1368\u1400\u166D\u166E\u169B\u169C\u16EB-\u16ED\u1735\u1736\u17D4-\u17D6\u17D8-\u17DA\u1800-\u180A\u1944\u1945\u1A1E\u1A1F\u1AA0-\u1AA6\u1AA8-\u1AAD\u1B5A-\u1B60\u1BFC-\u1BFF\u1C3B-\u1C3F\u1C7E\u1C7F\u1CC0-\u1CC7\u1CD3\u2010-\u2027\u2030-\u2043\u2045-\u2051\u2053-\u205E\u207D\u207E\u208D\u208E\u2329\u232A\u2768-\u2775\u27C5\u27C6\u27E6-\u27EF\u2983-\u2998\u29D8-\u29DB\u29FC\u29FD\u2CF9-\u2CFC\u2CFE\u2CFF\u2D70\u2E00-\u2E2E\u2E30-\u2E3B\u3001-\u3003\u3008-\u3011\u3014-\u301F\u3030\u303D\u30A0\u30FB\uA4FE\uA4FF\uA60D-\uA60F\uA673\uA67E\uA6F2-\uA6F7\uA874-\uA877\uA8CE\uA8CF\uA8F8-\uA8FA\uA92E\uA92F\uA95F\uA9C1-\uA9CD\uA9DE\uA9DF\uAA5C-\uAA5F\uAADE\uAADF\uAAF0\uAAF1\uABEB\uFD3E\uFD3F\uFE10-\uFE19\uFE30-\uFE52\uFE54-\uFE61\uFE63\uFE68\uFE6A\uFE6B\uFF01-\uFF03\uFF05-\uFF0A\uFF0C-\uFF0F\uFF1A\uFF1B\uFF1F\uFF20\uFF3B-\uFF3D\uFF3F\uFF5B\uFF5D\uFF5F-\uFF65]+|$)/g;

    /**
     * Generates an array of strings with all possible combinations of first-letter or all-letter case transformations
     * If caseMatchType is not 'full', then only combinations of first-letter cases for each word are calculated
     * If caseMatchType is 'full', then all-uppercase combinations of each word are added to the variations array
     * NB may produce duplicate strings if string begins with punctuation or if it is in a language with no case
     * @param {String} string The string to be converted
     * @param {String} caseMatchType ('basic'|'full') The type (complexity) of case variations to calculate 
     * @return {Array} An array containing strings with all possible combinations of case types
     */
    function allCaseFirstLetters(string, caseMatchType) {
        if (string) {
            var comboArray = [];
            // Split string into parts beginning with first word letters
            var strParts = string.match(regExpFindStringParts);
            // Set the base (binary or ternary) according to the complexity of the search
            var base = caseMatchType === 'full' ? 3 : 2;
            // If n = strParts.length, then the number of possible case combinations (numCombos) is base ^ n
            // For *basic* case calculation: think of numCombos as a binary number of n bits, with each bit representing lcase (0) or ucase (1)
            // For *full* case calculation: think of numCombos as a tertiary base number, e.g. 000, 111, 222,
            // with each bit representing all-lowercase (0), First-Letter-Uppercase (1) or ALL-UPPERCASE (2)
            var numCombos = Math.pow(base, strParts.length);
            var typeCase, mixedTypeCaseStr, bitmask, caseBit;
            // Iterate through every possible combination, starting with (base ^ n) - 1 and decreasing; we go from high to low,
            // because title case (e.g. binary 1111) is more common than all lowercase (0000) so will be found first
            for (var i = numCombos; i--;) {
                mixedTypeCaseStr = '';
                bitmask = 1;
                for (var j = 0; j < strParts.length; j++) {
                    // Get modulus of division (this is equivalent to bitwise AND for different bases)
                    // caseBit will be 0, 1 or 2 (latter only for 'full' case calcualation)
                    caseBit = ~~(i / bitmask % base);
                    if (caseBit === 2) {
                        // All uppercase
                        typeCase = strParts[j].toLocaleUpperCase();
                    } else {
                        // Modify only first letter
                        typeCase = strParts[j].replace(/^./, function (m) {
                            // 1 = uppercase, 0 = lowercase
                            return caseBit ? m.toLocaleUpperCase() : m.toLocaleLowerCase();
                        });
                    }
                    mixedTypeCaseStr += typeCase;
                    // Shift bitmask to the next higher bit
                    bitmask *= base;
                }
                comboArray.push(mixedTypeCaseStr);
            }
            return comboArray;
        } else {
            return [string];
        }
    }

    /**
     * Generates an array of Strings, where all duplicates have been removed
     * (without changing the order)
     * It is optimized for small arrays.
     * Source : http://codereview.stackexchange.com/questions/60128/removing-duplicates-from-an-array-quickly
     * @param {Array} array of String
     * @returns {Array} same array of Strings, without duplicates
     */
    function removeDuplicateStringsInSmallArray(array) {
        var unique = [];
        for (var i = 0; i < array.length; i++) {
            var current = array[i];
            if (unique.indexOf(current) < 0)
                unique.push(current);
        }
        return unique;
    }

    /**
     * Utility function : return true if the given string ends with the suffix
     * @param {String} str
     * @param {String} suffix
     * @returns {Boolean}
     */
    function endsWith(str, suffix) {
        return str.indexOf(suffix, str.length - suffix.length) !== -1;
    }

    /**
     * Read an integer encoded in 4 bytes, little endian
     * @param {Array} byteArray
     * @param {Integer} firstIndex
     * @returns {Integer}
     */
    function readIntegerFrom4Bytes(byteArray, firstIndex) {
        var dataView = new DataView(byteArray.buffer, firstIndex, 4);
        var integer = dataView.getUint32(0, true);
        return integer;
    }

    /**
     * Read an integer encoded in 2 bytes, little endian
     * @param {Array} byteArray
     * @param {Integer} firstIndex
     * @returns {Integer}
     */
    function readIntegerFrom2Bytes(byteArray, firstIndex) {
        var dataView = new DataView(byteArray.buffer, firstIndex, 2);
        var integer = dataView.getUint16(0, true);
        return integer;
    }

    /**
     * Read a float encoded in 2 bytes
     * @param {Array} byteArray
     * @param {Integer} firstIndex
     * @param {Boolean} littleEndian (optional)
     * @returns {Float}
     */
    function readFloatFrom4Bytes(byteArray, firstIndex, littleEndian) {
        var dataView = new DataView(byteArray.buffer, firstIndex, 4);
        var float = dataView.getFloat32(0, littleEndian);
        return float;
    }

    /**
     * Convert a Uint8Array to a lowercase hex string
     * @param {Array} byteArray
     * @returns {String}
     */
    function uint8ArrayToHex(byteArray) {
        var s = '';
        var hexDigits = '0123456789abcdef';
        for (var i = 0; i < byteArray.length; i++) {
            var v = byteArray[i];
            s += hexDigits[(v & 0xff) >> 4];
            s += hexDigits[v & 0xf];
        }
        return s;
    }

    /**
     * Convert a Uint8Array to base64
     * TODO : might be replaced by btoa() built-in function? https://developer.mozilla.org/en-US/docs/Web/API/window.btoa
     * @param {Array} byteArray
     * @returns {String}
     */
    function uint8ArrayToBase64(byteArray) {
        var b64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
        var bits, h1, h2, h3, h4, i = 0;
        var enc = "";

        for (var i = 0; i < byteArray.length; ) {
            bits = byteArray[i++] << 16;
            bits |= byteArray[i++] << 8;
            bits |= byteArray[i++];

            h1 = bits >> 18 & 0x3f;
            h2 = bits >> 12 & 0x3f;
            h3 = bits >> 6 & 0x3f;
            h4 = bits & 0x3f;

            enc += b64[h1] + b64[h2] + b64[h3] + b64[h4];
        }

        var r = byteArray.length % 3;

        return (r > 0 ? enc.slice(0, r - 3) : enc) + '==='.slice(r || 3);
    }

    /**
     * Reads a Uint8Array from the given file starting at byte offset begin until end
     * @param {File} file The file object to be read
     * @param {Integer} begin The offset in <File> at which to begin reading
     * @param {Integer} end The byte at whcih to stop reading (reads up to and including end - 1)
     * @returns {Promise<Uint8Array>} A Promise for an array buffer with the read data 
     */
    function readFileSlice(file, begin, end) {
        if ('arrayBuffer' in Blob.prototype) {
            // DEV: This method uses the native arrayBuffer method of Blob, if available, as it eliminates
            // the need to use FileReader and set up event listeners; it also uses the method's native Promise
            // rather than setting up potentially hundreds of new Q promises for small byte range reads
            return file.slice(begin, end).arrayBuffer().then(function (buffer) {
                return new Uint8Array(buffer);
            });
        } else {
            return new Promise(function (resolve, reject) {
                var reader = new FileReader();
                reader.readAsArrayBuffer(file.slice(begin, end));
                reader.addEventListener('load', function (e) {
                    resolve(new Uint8Array(e.target.result));
                });
                reader.addEventListener('error', reject);
                reader.addEventListener('abort', reject);
            });
        }
    }

    /**
     * Performs a binary search on indices begin <= i < end, utilizing query(i) to return where to
     * continue the search.
     * If lowerBound is not set, returns only indices where query returns 0 and null otherwise.
     * If lowerBound is set, returns the smallest index where query does not return > 0.
     * @param {Integer} begin The beginning of the search window
     * @param {Integer} end The end of the search window
     * @param {Function} query The query to run to test the current point in the window
     * @param {Boolean} lowerBound Determines the type of search
     * @returns {Promise} Promise for the lowest dirEntry that fulfils (or fails to fulfil) the query
     */
    function binarySearch(begin, end, query, lowerBound) {
        if (end <= begin)
            return lowerBound ? begin : null;
        var mid = Math.floor((begin + end) / 2);
        return query(mid).then(function(decision)
        {
            if (decision < 0)
                return binarySearch(begin, mid, query, lowerBound);
            else if (decision > 0)
                return binarySearch(mid + 1, end, query, lowerBound);
            else
                return mid;
        });
    }

    /**
     * Converts a Base64 Content to a Blob
     * From https://stackoverflow.com/questions/16245767/creating-a-blob-from-a-base64-string-in-javascript
     *
     * @param {String} b64Data Base64-encoded data
     * @param {String} contentType
     * @param {Integer} sliceSize
     * @returns {Blob}
     */
    function b64toBlob(b64Data, contentType, sliceSize) {
        contentType = contentType || '';
        sliceSize = sliceSize || 512;

        var byteCharacters = atob(b64Data);
        var byteArrays = [];

        for (var offset = 0; offset < byteCharacters.length; offset += sliceSize) {
            var slice = byteCharacters.slice(offset, offset + sliceSize);

            var byteNumbers = new Array(slice.length);
            for (var i = 0; i < slice.length; i++) {
                byteNumbers[i] = slice.charCodeAt(i);
            }

            var byteArray = new Uint8Array(byteNumbers);

            byteArrays.push(byteArray);
        }

        var blob = new Blob(byteArrays, {type: contentType});
        return blob;
    }

    /**
     * Converts a UInt Array to a UTF-8 encoded string
     * source : http://michael-rushanan.blogspot.de/2014/03/javascript-uint8array-hacks-and-cheat.html
     *
     * @param {UIntArray} uintArray
     * @returns {String}
     */
    function uintToString(uintArray) {
        var s = '';
        for (var i = 0; i < uintArray.length; i++) {
            s += String.fromCharCode(uintArray[i]);
        }
        return s;
    }

    /**
     * Does a "left shift" on an integer.
     * It is equivalent to int << bits (which works only on 32-bit integers),
     * but compatible with 64-bit integers.
     *
     * @param {Integer} int
     * @param {Integer} bits
     * @returns {Integer}
     */
    function leftShift(int, bits) {
        return int * Math.pow(2, bits);
    }

    /**
     * Functions and classes exposed by this module
     */
    return {
        allCaseFirstLetters: allCaseFirstLetters,
        removeDuplicateStringsInSmallArray: removeDuplicateStringsInSmallArray,
        endsWith: endsWith,
        readIntegerFrom4Bytes: readIntegerFrom4Bytes,
        readIntegerFrom2Bytes : readIntegerFrom2Bytes,
        readFloatFrom4Bytes : readFloatFrom4Bytes,
        uint8ArrayToHex : uint8ArrayToHex,
        uint8ArrayToBase64 : uint8ArrayToBase64,
        readFileSlice : readFileSlice,
        binarySearch: binarySearch,
        b64toBlob: b64toBlob,
        uintToString: uintToString,
        leftShift: leftShift
    };
});
