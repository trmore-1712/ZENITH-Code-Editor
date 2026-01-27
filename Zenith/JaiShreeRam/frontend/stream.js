const { Readable, Writable, Transform } = require('stream');
const util = require('util');

// --- Example 1: Custom Readable Stream ---
console.log('--- Custom Readable Stream Example ---');
console.log('This stream generates numbers from 0 to 4.');

class MyCounterReadableStream extends Readable {
    constructor(options) {
        super(options);
        this.count = 0;
        this.maxCount = 5;
    }

    _read(size) {
        if (this.count < this.maxCount) {
            const data = `Number: ${this.count++}\n`;
            console.log(`  _read: Pushing "${data.trim()}"`);
            this.push(data);
        } else {
            console.log('  _read: No more data. Pushing null (end of stream).');
            this.push(null); // Signal the end of the stream
        }
    }
}

const readableStream = new MyCounterReadableStream();

readableStream.on('data', (chunk) => {
    process.stdout.write(`Received data from readable: ${chunk.toString()}`);
});

readableStream.on('end', () => {
    console.log('Readable stream finished. Initiating Writable Stream Example...\n');
    // Call the next example after this one ends
    runWritableStreamExample();
});

readableStream.on('error', (err) => {
    console.error('Readable stream error:', err);
});


// --- Example 2: Custom Writable Stream ---
function runWritableStreamExample() {
    console.log('--- Custom Writable Stream Example ---');
    console.log('This stream receives data and logs it.');

    class MyLoggingWritableStream extends Writable {
        constructor(options) {
            super(options);
            this.receivedChunks = [];
        }

        _write(chunk, encoding, callback) {
            const data = chunk.toString();
            this.receivedChunks.push(data);
            console.log(`  _write: Received "${data}"`);
            // Simulate some async operation
            setTimeout(() => {
                callback(); // Signal that the write operation is complete
            }, 100);
        }

        _final(callback) {
            console.log(`  _final: All data written to custom writable. Total chunks received: ${this.receivedChunks.length}`);
            console.log('  Final content received by writable:', this.receivedChunks.join(' | '));
            callback(); // Signal the end of the writable stream
        }
    }

    const writableStream = new MyLoggingWritableStream();

    writableStream.on('finish', () => {
        console.log('Writable stream finished. Initiating Transform Stream Example...\n');
        runTransformStreamExample();
    });

    writableStream.on('error', (err) => {
        console.error('Writable stream error:', err);
    });

    console.log('  Writing "Hello" to writable...');
    writableStream.write('Hello');
    console.log('  Writing "World" to writable...');
    writableStream.write('World');
    console.log('  Ending writable stream with "Node.js"...');
    writableStream.end('Node.js'); // Call end when no more data will be written
}


// --- Example 3: Custom Transform Stream (Uppercase Converter) ---
function runTransformStreamExample() {
    console.log('--- Custom Transform Stream Example (Uppercase Converter) ---');
    console.log('Type some text and press Enter. The stream will convert it to uppercase.');
    console.log('Press Ctrl+D (or Ctrl+Z then Enter on Windows) to end input.');

    class UppercaseTransformStream extends Transform {
        constructor(options) {
            super(options);
        }

        _transform(chunk, encoding, callback) {
            const transformedData = chunk.toString().toUpperCase();
            console.log(`  _transform: Input "${chunk.toString().trim()}", Output "${transformedData.trim()}"`);
            this.push(transformedData); // Push the transformed data
            callback(); // Signal that the transformation is complete
        }
    }

    const uppercaseTransformStream = new UppercaseTransformStream();

    // Pipe process.stdin (Readable) -> uppercaseTransformStream (Transform) -> process.stdout (Writable)
    // This creates a pipeline: input from console -> transform to uppercase -> output to console
    process.stdin
        .pipe(uppercaseTransformStream)
        .pipe(process.stdout);

    // Handle end of stdin (Ctrl+D)
    process.stdin.on('end', () => {
        console.log('\nStdin ended. Transform stream example complete.');
        console.log('All stream examples finished.');
        process.exit(0); // Explicitly exit after all examples
    });

    process.stdin.on('error', (err) => {
        console.error('Stdin error:', err);
        process.exit(1);
    });
}

// Note: The readableStream is created immediately and its 'end' event triggers the next example,
// which in turn triggers the final example. This ensures a clean, sequential execution.