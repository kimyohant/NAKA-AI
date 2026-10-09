// /go/studio/<menu> opens that Naka Studio menu; the retired /review/, /create/, /chatbot/ and old /studio/
// pages send visitors to whatever replaced them.
const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const { execFileSync } = require('node:child_process');
const { rmSync } = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, '.wrangler', `studio-links-tests-${process.pid}`);
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', root,
  '--noEmit', 'false', '--module', 'node16', '--moduleResolution', 'node16', '--rootDir', path.join(root, 'src'), '--outDir', buildDir], { stdio: 'inherit' });
const { handleStudioLinks } = require(path.join(buildDir, 'studio-links.js'));
after(() => { assert.equal(path.dirname(buildDir), path.join(root, '.wrangler')); rmSync(buildDir, { recursive: true, force: true }); });

const on = { STUDIO_URL: 'https://studio.naka.test', STUDIO_ACCESS: 'members' };
const go = (url, env = on, method = 'GET') => {
  const u = new URL(url, 'https://naka.test');
  const res = handleStudioLinks(new Request(u, { method }), env, u);
  return res && { status: res.status, location: res.headers.get('Location') };
};

test('each studio menu opens on STUDIO_URL', () => {
  assert.deepEqual(go('/go/studio/'), { status: 302, location: 'https://studio.naka.test/' });
  assert.deepEqual(go('/go/studio'), { status: 302, location: 'https://studio.naka.test/' });
  assert.deepEqual(go('/go/studio/skills'), { status: 302, location: 'https://studio.naka.test/studio' });
  assert.deepEqual(go('/go/studio/drama'), { status: 302, location: 'https://studio.naka.test/drama' });
  assert.deepEqual(go('/go/studio/viral-clone'), { status: 302, location: 'https://studio.naka.test/viral-clone' });
  assert.deepEqual(go('/go/studio/live'), { status: 302, location: 'https://studio.naka.test/live' });
  assert.deepEqual(go('/go/studio/seller'), { status: 302, location: 'https://studio.naka.test/seller' });
  assert.deepEqual(go('/go/studio/marketer'), { status: 302, location: 'https://studio.naka.test/marketer' });
});

test('an unknown menu goes to the studio home, never to an arbitrary path', () => {
  assert.deepEqual(go('/go/studio/admin'), { status: 302, location: '/go/studio/' });
  assert.equal(go('/go/studio/drama/../../evil'), null);
});

test('with the studio switched off or misconfigured the member area takes over', () => {
  assert.deepEqual(go('/go/studio/drama', { STUDIO_URL: 'https://studio.naka.test', STUDIO_ACCESS: 'off' }), { status: 302, location: '/app/' });
  assert.deepEqual(go('/go/studio/drama', {}), { status: 302, location: '/app/' });
  assert.deepEqual(go('/go/studio/drama', { STUDIO_URL: 'http://studio.naka.test' }), { status: 302, location: '/app/' });
});

test('retired pages send visitors to what replaced them', () => {
  assert.deepEqual(go('/review/?demo=1'), { status: 301, location: '/go/studio/skills' });
  assert.deepEqual(go('/review/review.js'), { status: 301, location: '/go/studio/skills' });
  assert.deepEqual(go('/create/'), { status: 301, location: '/go/studio/' });
  assert.deepEqual(go('/create/?workflow=sales'), { status: 301, location: '/go/studio/skills' });
  assert.deepEqual(go('/create/?workflow=drama'), { status: 301, location: '/go/studio/drama' });
  assert.deepEqual(go('/create/?workflow=live'), { status: 301, location: '/go/studio/live' });
  assert.deepEqual(go('/create/?workflow=bot'), { status: 301, location: '/app/inbox/' });
  assert.deepEqual(go('/chatbot/'), { status: 301, location: '/app/inbox/' });
  assert.deepEqual(go('/studio/marketer/'), { status: 301, location: '/go/studio/marketer' });
});

test('everything else, and anything but GET or HEAD, passes through', () => {
  assert.equal(go('/'), null);
  assert.equal(go('/app/'), null);
  assert.equal(go('/reviews/'), null);
  assert.equal(go('/api/affiliate/reviews'), null);
  assert.equal(go('/go/studio/drama', on, 'POST'), null);
});
