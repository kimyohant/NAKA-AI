// Prepare local auth without overwriting existing values or printing secrets.
const { readFileSync, appendFileSync, existsSync } = require('node:fs');
const { randomBytes } = require('node:crypto');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const file = path.join(root, '.dev.vars');
const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
const defaults = {
  APP_ORIGIN: 'http://127.0.0.1:8789',
  SESSION_SECRET: randomBytes(32).toString('base64url'),
  SMS_PROVIDER: 'mock',
};
const additions = Object.entries(defaults).filter(([name]) => !new RegExp(`^\\s*${name}\\s*=`, 'm').test(current));
if (additions.length) {
  appendFileSync(file, `\n# Local auth: mock SMS is allowed only on loopback HTTP.\n${additions.map(([name, value]) => `${name}=${JSON.stringify(value)}`).join('\n')}\n`, { mode: 0o600 });
}
console.log(additions.length ? `Added local auth settings: ${additions.map(([name]) => name).join(', ')}. Secret values are hidden.` : 'Local auth settings already exist; no changes made.');
console.log('Next: npm run db:migrate:local, then npx wrangler dev --ip 127.0.0.1 --port 8789. Mock OTPs appear only in the local server log.');
