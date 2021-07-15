/**
 * zstddec_wrapper.js: Javascript wrapper around compiled zstd decompressor.
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
define(['zstddec'], function () {
    // DEV: zstddec.js has been compiled with `-s EXPORT_NAME="ZD" -s MODULARIZE=1` to avoid a clash with xzdec which uses "Module" as its exported object
    // Note that we include zstddec above in requireJS definition, but we cannot change the name in the function list
    // There is no longer any need to load it in index.html
    // For explanation of loading method below to avoid conflicts, see https://github.com/emscripten-core/emscripten/blob/master/src/settings.js

    /**
     * @typedef EMSInstanceExt An object type representing an Emscripten instance with extended properties
     * @property {Integer} _decHandle The decoder stream context object in asm memory (to be re-used for each decoder operation)
     * @property {Object} _inBuffer A JS copy of the inBuffer structure to be set in asm memory (malloc)
     * @property {Object} _outBuffer A JS copy of the outBuffer structure to be set in asm memory (malloc)
     * @property {Integer} _chunkSize The number of compressed bytes to feed to the decompressor in any one read loop
     */

    /**
     * The ZSTD Decoder instance
     * @type EMSInstanceExt
     */
    var zd;
    ZD().then(function (instance) {
        // Instantiate the zd object
        zd = instance;
        // Create JS API by wrapping C++ functions
        // DEV: Functions with simple types (integers, pointers) do not need to be wrapped
        zd.getErrorString = zd.cwrap('ZSTD_getErrorName', 'string', ['number']);
        // Get a permanent decoder handle (pointer to control structure)
        // NB there is no need to change this handle even between ZIM loads: zstddeclib encourages re-using assigned structures
        zd._decHandle = zd._ZSTD_createDStream();
        // In-built function below provides a max recommended chunk size 
        zd._chunkSize = zd._ZSTD_DStreamInSize();
        // Change _chunkSize if you need a more conservative memory environment, but you may need to experiment with INITIAL_MEMORY
        // in zstddec.js (see below) for this to make any difference
        // zd._chunkSize = 5 * 1024;

        // Initialize inBuffer
        zd._inBuffer = {
            ptr: null,              /* pointer to this inBuffer structure in w/asm memory */
            src: null,              /* void* src   < start of input buffer */
            size: zd._chunkSize,    /* size_t size < size of input buffer */
            pos: 0                  /* size_t pos; < position where reading stopped. Will be updated. Necessarily 0 <= pos <= size */
        };
        // Reserve w/asm memory for the inBuffer structure (we will populate assigned memory later)
        zd._inBuffer.ptr = mallocOrDie(3 << 2); // 3 x 32bit bytes
        // Reserve w/asm memory for the inBuffer data stream
        zd._inBuffer.src = mallocOrDie(zd._inBuffer.size);

        // DEV: Size of outBuffer is currently set as recommended by zd._ZSTD_DStreamOutSize() below; if you are running into
        // memory issues, it may be possible to reduce memory consumption by setting a smaller outBuffer size here and
        // reompiling zstddec.js with lower TOTAL_MEMORY (or just search for INITIAL_MEMORY in zstddec.js and change it)
        var outBufSize = zd._ZSTD_DStreamOutSize();

        // Initialize outBuffer
        zd._outBuffer = {
            ptr: null,           /* pointer to this outBuffer structure in asm/wasm memory */
            dst: null,           /* void* dst   < start of output buffer (pointer) */
            size: outBufSize,    /* size_t size < size of output buffer */
            pos: 0               /* size_t pos  < position where writing stopped. Will be updated. Necessarily 0 <= pos <= size */
        };
        // Reserve w/asm memory for the outBuffer structure
        zd._outBuffer.ptr = mallocOrDie(3 << 2); // 3 x 32bit bytes
        // Reserve w/asm memory for the outBuffer data steam
        zd._outBuffer.dst = mallocOrDie(zd._outBuffer.size);
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
     * @property {FileReader} _reader The filereader to use (uses plain blob reader defined in zimfile.js)
     * @property {Integer} _inStreamPos The current known position in the steam of compressed bytes 
     * @property {Integer} _inStreamChunkedPos The position once the currently loaded chunk will have been consumed
     * @property {Integer} _outStreamPos The position in the decoded byte stream (offset from start of cluster)
     * @property {Array} _outDataBuf The buffer that stores decoded bytes (it is set to the requested blob's length, and when full, the data are returned)
     * @property {Integer} _outDataBufPos The number of bytes of the requested blob decoded so far
     */

    /**
     * @constructor
     * @param {FileReader} reader The reader used to extract file slices (defined in zimfile.js)
     */
    function Decompressor(reader) {
        this._reader = reader;
    }

    /**
     * Set up the decompression stream, and initiate a read loop to decompress from the beginning of the cluster
     * until we reach <offset> in the decompressed byte stream
     * @param {Integer} offset Cluster offset (in decompressed stream) from which to start reading
     * @param {Integer} length Number of decompressed bytes to read
     * @returns {Promise<ArrayBuffer>} Promise for an ArrayBuffer with decoded data
     */
    Decompressor.prototype.readSlice = function (offset, length) {
        busy = true;
        this._inStreamPos = 0;
        this._inStreamChunkedPos = 0;
        this._outStreamPos = 0;
        this._outDataBuf = new Int8Array(new ArrayBuffer(length));
        this._outDataBufPos = 0;
        var ret = zd._ZSTD_initDStream(zd._decHandle);
        if (zd._ZSTD_isError(ret)) {
            return Promise.reject('Failed to initialize ZSTD decompression');
        }

        return this._readLoop(offset, length).then(function (data) {
            // DEV: We are re-using all the allocated w/asm memory, so we do not need to free any of structures assigned wiht _malloc
            // However, should you need to free assigned structures use, e.g., zd._free(zd._inBuffer.src);
            // Additionally, freeing zd._decHandle is not needed, and actually increases memory consumption (crashing zstddeclib)
            // Should you need to free the decoder stream handle, use command below, but be sure to create a new stream control object
            // before attempting further decompression
            // zd._ZSTD_freeDStream(zd._decHandle);
            busy = false;
            return data;
        });
    };

    /**
     * This function ensures that only one decompression runs at a time, launching readSlice() only when
     * the decompressor is no longer busy
     * @param {Integer} offset The cluster offset (in decompressed stream) at which the requested blob resides
     * @param {Integer} length The number of decompressed bytes to read
     * @returns {Promise} A Promise for the readSlice() function
     */
    Decompressor.prototype.readSliceSingleThread = function (offset, length) {
        if (!busy) {
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
     * The main loop for sending compressed data to the decompressor and retrieving decompressed bytes
     * Consecutive calls to readLoop may only advance in the stream and may not overlap
     * @param {Integer} offset The offset in the *decompressed* byte stream at which the requested blob resides
     * @returns {Promise<Int8Array>} A Promise for an Int8Array containing the requested blob's decompressed bytes
     */
    Decompressor.prototype._readLoop = function (offset) {
        var that = this;
        return this._fillInBuffer().then(function () {
            var finished = false;
            var ret = zd._ZSTD_decompressStream(zd._decHandle, zd._outBuffer.ptr, zd._inBuffer.ptr);
            if (zd._ZSTD_isError(ret)) {
                var errorMessage = "Failed to decompress data stream!\n" + zd.getErrorString(ret);
                return Promise.reject(errorMessage);
            }
            // Get updated outbuffer values
            var obxPtr32Bit = zd._outBuffer.ptr >> 2;
            var outPos = zd.HEAP32[obxPtr32Bit + 2];

            // If data have been decompressed, check to see whether the data are in the offset range we need
            if (outPos > 0 && that._outStreamPos + outPos >= offset) {
                var copyStart = offset - that._outStreamPos;
                if (copyStart < 0) copyStart = 0;
                for (var i = copyStart; i < outPos && that._outDataBufPos < that._outDataBuf.length; i++)
                    that._outDataBuf[that._outDataBufPos++] = zd.HEAP8[zd._outBuffer.dst + i];
            }
            if (that._outDataBufPos === that._outDataBuf.length) finished = true;
            // Return without further processing if decompressor has finished
            if (finished) return that._outDataBuf;

            // Get updated inbuffer values for processing on the JS sice
            // NB the zd.Decoder will read these values from its own buffers
            var ibxPtr32Bit = zd._inBuffer.ptr >> 2;
            zd._inBuffer.pos = zd.HEAP32[ibxPtr32Bit + 2];

            // Increment the byte stream positions
            that._inStreamPos += zd._inBuffer.pos;
            that._outStreamPos += outPos;
            // DEV: if outPos is > 0, then we have either copied all data from outBuffer, or we can now throw those data away
            // because they are before our required offset
            // Se we can now reset the asm outBuffer.pos field to 0
            // Testing outPos is not strictly necessary, but there may be an overhead in writing to HEAP32
            if (!outPos) zd.HEAP32[obxPtr32Bit + 2] = 0;
            return that._readLoop(offset);
        }).catch(function (err) {
            console.error(err);
        });
    };

    /**
     * Fills in the instream buffer
     * @returns {Promise<0>} A Promise for 0 when all data have been added to the stream
     */
    Decompressor.prototype._fillInBuffer = function () {
        var that = this;
        return this._reader(this._inStreamPos, zd._chunkSize).then(function (data) {
            // Populate inBuffer and assign asm/wasm memory if not already assigned
            zd._inBuffer.size = data.length;
            // Reset inBuffer
            zd._inBuffer.pos = 0;
            var inBufferStruct = new Int32Array([zd._inBuffer.src, zd._inBuffer.size, zd._inBuffer.pos]);
            // Write inBuffer structure to previously assigned w/asm memory
            zd.HEAP32.set(inBufferStruct, zd._inBuffer.ptr >> 2);
            var outBufferStruct = new Int32Array([zd._outBuffer.dst, zd._outBuffer.size, zd._outBuffer.pos]);
            // Write outBuffer structure to w/asm memory
            zd.HEAP32.set(outBufferStruct, zd._outBuffer.ptr >> 2);

            // Transfer the (new) data to be read to the inBuffer
            zd.HEAPU8.set(data, zd._inBuffer.src);
            that._inStreamChunkedPos += data.length;
            return 0;
        });
    };

    /**
     * Provision asm/wasm data block and get a pointer to the assigned location
     * Code used from excellent WASM tutorial here: https://marcoselvatici.github.io/WASM_tutorial/
     * @param {Integer} sizeOfData The number of bytes to be allocated
     * @returns {Integer} Pointer to the assigned data block
     */
    function mallocOrDie(sizeOfData) {
        const dataPointer = zd._malloc(sizeOfData);
        if (dataPointer === 0) { // error allocating memory
            var errorMessage = 'Failed allocation of ' + sizeOfData + ' bytes.';
            console.error(errorMessage);
            throw new Error(errorMessage);
        }
        return dataPointer;
    }

    return {
        Decompressor: Decompressor
    };
});