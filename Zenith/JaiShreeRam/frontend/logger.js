// logger.js

/**
 * @deprecated This class is for demonstration of replacement.
 * Please use AdvancedLogger instead.
 */
class OldLogger {
    constructor(prefix = 'App') {
        this.prefix = prefix;
    }

    log(message) {
        console.log(`[OLD][${this.prefix}] ${message}`); // Added 'OLD' to distinguish output
    }
}

// The NEW and more useful class
class AdvancedLogger {
    constructor(prefix = 'App') {
        this.prefix = prefix;
    }

    _getTimestamp() {
        return new Date().toISOString();
    }

    log(message) {
        console.log(`[${this._getTimestamp()}][INFO][${this.prefix}] ${message}`);
    }

    warn(message) {
        console.warn(`[${this._getTimestamp()}][WARN][${this.prefix}] ${message}`);
    }

    error(message) {
        console.error(`[${this._getTimestamp()}][ERROR][${this.prefix}] ${message}`);
    }
}

// --- THE REPLACEMENT PART ---
// We now export the AdvancedLogger, effectively replacing OldLogger as the primary export
module.exports = AdvancedLogger;