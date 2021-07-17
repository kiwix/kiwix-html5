/**
 * xzdec_wrapper.js: Javascript wrapper around compiled xz decompressor.
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
define(['xzdec'], function() {
    // DEV: xzdec.js emits a global Module variable, which cannot be set in requireJS function line above, though it can be loaded in definition
    var xzdec = Module;
    xzdec._init();
    
    /**
     * Number of milliseconds to wait for the decompressor to be available for another chunk
     * @type Integer
     */
    var DELAY_WAITING_IDLE_DECOMPRESSOR = 50;
    
    /**
     * Is the decompressor already working?
     * @type Boolean
     */
    var busy = false;
    
    /**
     * @typedef Decompressor
     * @property {Integer} _chunkSize
     * @property {FileReader} _reader
     * @property {unresolved} _decHandle
     * @property {Integer} _inStreamPos
     * @property {Integer} _outStreamPos
     * @property {Array} _outBuffer
     */
    
    /**
     * @constructor
     * @param {FileReader} reader
     * @param {Integer} chunkSize
     * @returns {Decompressor}
     */
    function Decompressor(reader, chunkSize) {
        this._chunkSize = chunkSize || 1024 * 5;
        this._reader = reader;
    };
    /**
     * Read length bytes, offset into the decompressed stream. Consecutive calls may only
     * advance in the stream and may not overlap.
     * @param {Integer} offset
     * @param {Integer} length
     */
    Decompressor.prototype.readSlice = function(offset, length) {
        busy = true;
        var that = this;
        this._inStreamPos = 0;
        this._outStreamPos = 0;
        this._decHandle = xzdec._init_decompression(this._chunkSize);
        this._outBuffer = new Int8Array(new ArrayBuffer(length));
        this._outBufferPos = 0;
        return this._readLoop(offset, length).then(function(data) {
            xzdec._release(that._decHandle);
            busy = false;
            return data;
        });
    };
    
    /**
     * Reads stream of data from file offset for length of bytes to send to the decompresor
     * This function ensures that only one decompression runs at a time
     * @param {Integer} offset The file offset at which to begin reading compressed data
     * @param {Integer} length The amount of data to read
     * @returns {Promise} A Promise for the read data
     */
    Decompressor.prototype.readSliceSingleThread = function (offset, length) {
        // Tests whether the decompressor is ready (initiated) and not busy
        if (xzdec && !busy) {
            return this.readSlice(offset, length);
        } else {
            // The decompressor is already in progress.
            // To avoid using too much memory, we wait until it has finished
            // before using it for another decompression
            var that = this;
            return new Promise(function (resolve, reject) {
                setTimeout(function () {
                    that.readSliceSingleThread(offset, length).then(resolve, reject);
                }, DELAY_WAITING_IDLE_DECOMPRESSOR);
            });
        }
    };

    /**
     * 
     * @param {Integer} offset
     * @param {Integer} length
     * @returns {Array}
     */
    Decompressor.prototype._readLoop = function(offset, length) {
        var that = this;
        return this._fillInBufferIfNeeded().then(function() {
            var ret = xzdec._decompress(that._decHandle);
            var finished = false;
            if (ret === 0) {
                // supply more data or free output buffer
            } else if (ret === 1) {
                // stream ended
                finished = true;
            } else {
                // error @todo handle
                finished = true;
            }

            var outPos = xzdec._get_out_pos(that._decHandle);
            if (outPos > 0 && that._outStreamPos + outPos >= offset)
            {
                var outBuffer = xzdec._get_out_buffer(that._decHandle);
                var copyStart = offset - that._outStreamPos;
                if (copyStart < 0)
                    copyStart = 0;
                for (var i = copyStart; i < outPos && that._outBufferPos < that._outBuffer.length; i++)
                    that._outBuffer[that._outBufferPos++] = xzdec.HEAP8[outBuffer + i];
            }
            that._outStreamPos += outPos;
            if (outPos > 0)
                xzdec._out_buffer_cleared(that._decHandle);
            if (finished || that._outStreamPos >= offset + length)
                return that._outBuffer;
            else
                return that._readLoop(offset, length);
        });
    };
    
    /**
     * 
     * @returns {Promise}
     */
    Decompressor.prototype._fillInBufferIfNeeded = function() {
        if (!xzdec._input_empty(this._decHandle)) {
            return Promise.resolve(0);
        }
        var that = this;
        return this._reader(this._inStreamPos, this._chunkSize).then(function(data) {
            if (data.length > that._chunkSize)
                data = data.slice(0, that._chunkSize);
            // For some reason, xzdec.writeArrayToMemory does not seem to be available, and is equivalent to xzdec.HEAP8.set
            xzdec.HEAP8.set(data, xzdec._get_in_buffer(that._decHandle));
            that._inStreamPos += data.length;
            xzdec._set_new_input(that._decHandle, data.length);
            return 0;
        });
    };

    return {
        Decompressor: Decompressor
    };
});
