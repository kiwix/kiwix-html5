/**
 * zstdec_wrapper.js: Javascript wrapper around compiled zstd decompressor.
 *
 * Copyright 2020 Jaifroid, Mossroy and contributors
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
define(['q', 'zstdec'], function(Q) {
    // DEV: zstdec.js has been compiled with `-s EXPORT_NAME="ZD" -s MODULARIZE=1` to avoid a clash with xzdec which uses "Module" as its exported object
    // Note that we include zstdec above in requireJS definition, but we cannot change the name in the function list
    // There is no longer any need to load it in index.html
    // For explanation of loading method below to avoid conflicts, see https://github.com/emscripten-core/emscripten/blob/master/src/settings.js
    var zd;
    // var createDStream, initDStream, decompressStream, isError, freeDStream;
    ZD().then(function(instance) {
        // Instantiate the zd object
        zd = instance;
        // Create JS API by wrapping C++ functions
        // createDStream = zd.cwrap('ZSTD_createDStream');
        // initDStream = zd.cwrap('ZSTD_initDStream');
        // decompressStream = zd.cwrap('ZSTD_decompressStream');
        // isError = zd.cwrap('ZSTD_isError');
        // freeDStream = zd.cwrap('ZSTD_freeDStream');
    });
    
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
     * @property {unresolved} _stream.decoder_stream
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
     * @param {Integer} offset Offset from which to start reading
     * @param {Integer} length Number of bytes to read
     * @returns {Promise<ArrayBuffer>} Promise for an ArrayBuffer with decoded data
     */
    Decompressor.prototype.readSlice = function(offset, length) {
        busy = true;
        // Iniitialize stream tracking object (see https://github.com/openzim/libzim/blob/master/src/compression.cpp)
        this._stream = {
            next_in: null,
            avail_in: 0,
            next_out: null,
            avail_out: 0,
            total_out: 0,
            decoder_stream: null
        };
        // Initialize inBuffer
        this._inBuffer = {
            ptr: null, /* pointer to this inBuffer structure in w/asm memory */
            src: null, /* void* src   < start of input buffer */
            size: 0,   /* size_t size < size of input buffer */
            pos: 0     /* size_t pos; < position where reading stopped. Will be updated. Necessarily 0 <= pos <= size */
        };
        // Reserve w/asm memory for the outBuffer structure
        this._inBuffer.ptr = this._mallocOrDie(3 << 2); // 3 x 32bit bytes (IS THIS CORRECT? -> zstdec.js always uses HEAP32.set)
        // Write inBuffer control object to w/asm memory
        // zd.HEAP32.set([this._inBuffer.src, this._inBuffer.size, this._inBuffer.pos], this._inBuffer.ptr);
        // Initialize outBuffer
        this._outBuffer = {
            ptr: null, /* pointer to this outBuffer structure in asm/wasm memory */
            dst: null, /* void* dst   < start of output buffer (pointer) */
            size: 0,   /* size_t size < size of output buffer */
            pos: 0     /* size_t pos  < position where writing stopped. Will be updated. Necessarily 0 <= pos <= size */
        };
        this._outBuffer.ptr = this._mallocOrDie(3 << 2); // 3 x 32bit bytes
        // Write outBuffer control object to w/asm memory
        // zd.HEAP32.set([this._outBuffer.dst, this._outBuffer.size, this._outBuffer.pos], this._outBuffer.ptr >> 2);
        // Initialize stream decoder
        this._stream.decoder_stream = zd._ZSTD_createDStream();
        var ret = zd._ZSTD_initDStream(this._stream.decoder_stream);
        if (zd._ZSTD_isError(ret)) {
            return Q.reject('Failed to initialize ZSTD decompression');
        }
        this._inBuffer.size = ret;

        // this._inBufferPtr = zd.HEAPU32[(this._stream.decoder_stream >> 2) + 8];
        // TODO: Check which of these variables should be a _stream property
        // this._outStreamPos = 0;
        // this._outBuffer = new Int8Array(new ArrayBuffer(length));
        // this._outBufferPos = 0;
        var that = this;
        return this._readLoop(offset, length).then(function(data) {
            zd._ZSTD_freeDStream(that._stream.decoder_stream);
            busy = false;
            return data;
        });
    };

    /**
     * Provision asm/wasm data block and get a pointer to the assigned location
     * @param {Number} sizeOfData The number of bytes to be allocated
     * @returns {Number} Pointer to the assigned data block
     */
    Decompressor.prototype._mallocOrDie = function (sizeOfData) {
		const dataPointer = zd._malloc(sizeOfData);
        if (dataPointer === 0) { // error allocating memory
            var errorMessage = 'Failed allocation of ' + sizeOfData + ' bytes.';
            console.error(errorMessage);
            throw new Error(errorMessage);
		}
		return dataPointer;
	};
    
    /**
     * Reads stream of data from file offset for length of bytes to send to the decompresor
     * This function ensures that only one decompression runs at a time
     * @param {Integer} offset The file offset at which to begin reading compressed data
     * @param {Integer} length The amount of data to read
     * @returns {Promise} A Promise for the read data
     */
    Decompressor.prototype.readSliceSingleThread = function (offset, length) {
        if (!busy) {
            return this.readSlice(offset, length);
        } else {
            // The decompressor is already in progress.
            // To avoid using too much memory, we wait until it has finished
            // before using it for another decompression
            var that = this;
            return Q.Promise(function (resolve, reject) {
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
        return this._fillInBufferIfNeeded(offset + length).then(function() {
            var ret = zd._ZSTD_decompressStream(that._stream.decoder_stream, that._outBuffer.ptr, that._inBuffer.ptr);
            // var ret = zd._ZSTD_decompressStream_simpleArgs(that._stream.decoder_stream, that._outBuffer.ptr, that._outBuffer.size, 0, that._inBuffer.ptr, that._inBuffer.size, 0);
            if (zd._ZSTD_isError(ret)) {
                var errorMessage = "Failed to decompress data stream!";
                console.error(errorMessage);
                throw new Error(errorMessage);
            }
            var finished = false;
            if (ret === 0) {
                // stream ended
                finished = true;
            } else if (ret > 0) {
                // supply more data
            }

            // Get updated inbuffer values for processing on the JS sice
            // NB the zd.Decoder will read these values from its own buffers
            var ibx32ptr = that._inBuffer.ptr >> 2;
            //zd.HEAP32[ibx32ptr + 1] = that._inBuffer.size;
            that._inBuffer.pos = zd.HEAP32[ibx32ptr + 2];

            // Get update outbuffer values
            var obx32ptr = that._outBuffer.ptr >> 2;
            // that._outBuffer.size = zd.HEAP32[obx32ptr + 1];
            that._outBuffer.pos = zd.HEAP32[obx32ptr + 2];
            
            // var inBuffer32Array = zd.HEAP32.slice(that._inBuffer.ptr >> 2, (that._inBuffer.ptr >> 2) + 3);
            
            
            // var outPos = zd._get_out_pos(that._stream.decoder_stream);
            // if (outPos > 0 && that._outStreamPos + outPos >= offset)
            // {
            //     var outBuffer = zd._get_out_buffer(that._stream.decoder_stream);
            //     var copyStart = offset - that._outStreamPos;
            //     if (copyStart < 0)
            //         copyStart = 0;
            //     for (var i = copyStart; i < outPos && that._outBufferPos < that._outBuffer.length; i++)
            //         that._outBuffer[that._outBufferPos++] = zd.HEAP8[outBuffer + i];
            // }
            // that._outStreamPos += outPos;
            // if (outPos > 0)
            //     zd._out_buffer_cleared(that._stream.decoder_stream);
            if (finished)
                return that._outBuffer;
            else
                return that._readLoop(that._inBuffer.pos, that._inBuffer.size);
        });
    };
    
    /**
     * Fills in the instream buffer if needed
     * @param {Integer} pos The current read offset
     * @returns {Promise<0>} A Promise for 0 when all data have been added to the stream
     */
    Decompressor.prototype._fillInBufferIfNeeded = function(pos) {
        if (pos < this._stream.next_in) {
            // We still have enough data in the buffer
            // DEV: When converting to Promise/A+, use Promise.resolve(0) here
            return Q.when(0);
        }
        var that = this;
        return this._reader(this._stream.next_in, this._chunkSize).then(function(data) {
            if (data.length > that._chunkSize) data = data.slice(0, that._chunkSize);
            // Populate inBuffer and assign asm/wasm memory
            that._inBuffer.size = data.length + 256;
            if (!that._inBuffer.src) {
                // We add 256 bytes here to ensure we can re-use this inBuffer even if we have some bytes left at the end of the buffer
                that._inBuffer.src = that._mallocOrDie(that._inBuffer.size);
                var inBufferStruct = new Int32Array([that._inBuffer.src, that._inBuffer.size, that._inBuffer.pos]);
                // Write inBuffer structure to previously assigned w/asm memory
                zd.HEAP32.set(inBufferStruct, that._inBuffer.ptr >> 2);
            }
            if (!that._outBuffer.dst) {
                // DEV For now, guess compression ratio of 1:4 max ** IS THIS SAFE??? ***
                that._outBuffer.dst = that._mallocOrDie(data.length * 4);
                that._outBuffer.size = data.length * 4;
                var outBufferStruct = new Int32Array([that._outBuffer.dst, that._outBuffer.size, that._outBuffer.pos]);
                // Write outBuffer structure to w/asm memory
                zd.HEAP32.set(outBufferStruct, that._outBuffer.ptr >> 2);
            }
            // Transfer the (new) data to be read to the inBuffer
            zd.HEAPU8.set(data, that._inBuffer.src + that._inBuffer.pos);
            that._stream.next_in += data.length;
            // TODO: Need to make a new C++ function to set new instreamPos (below is old xz implementation) 
            // Although ZSTD seems to update this automatically, so we'll need to check it
            // zd._set_new_input(that._stream.decoder_stream, data.length);
            return 0;
        });
    };

    return {
        Decompressor: Decompressor
    };
});