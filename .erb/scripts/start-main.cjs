// Electron's default loader can import .ts as native ESM on modern Node.
// Keep the existing TypeScript/CommonJS configuration explicit in development.
require('ts-node/register/transpile-only');
require('../../src/main/main.ts');
