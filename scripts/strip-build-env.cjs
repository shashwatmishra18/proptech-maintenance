// Next.js traces local .env files into standalone output. Remove them before
// packaging so deployments must receive secrets through their environment.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve('.next/standalone');

function strip(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const filename = path.join(directory, entry.name);
        if (entry.isDirectory()) strip(filename);
        else if (entry.isFile() && /^\.env(?:\.|$)/.test(entry.name)) fs.unlinkSync(filename);
    }
}

if (!fs.existsSync(path.join(root, 'server.js'))) throw new Error('Standalone build output is missing');
strip(root);
console.log('Standalone output prepared without environment files.');
