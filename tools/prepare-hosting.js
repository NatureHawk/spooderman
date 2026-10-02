'use strict';
// Package the existing main game for static hosting without rebuilding variants.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'THREADLINE.html');
const directory = path.join(root, 'hosting', 'threadline');
const content = fs.readFileSync(source);
if (!content.toString('utf8', 0, 100).toLowerCase().includes('<!doctype html')) {
  throw new Error('The main game must be built before preparing hosting.');
}
fs.mkdirSync(directory, { recursive: true });
const destination = path.join(directory, 'index.html');
fs.writeFileSync(destination, content);
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
if (hash(fs.readFileSync(destination)) !== hash(content)) throw new Error('Hosting copy verification failed.');
console.log('Ready to upload:', directory);
console.log('Verified identical to THREADLINE.html; size:', (content.length / 1e6).toFixed(2), 'MB');
