// The site's static pages live in kimyohant/naka-ai-landing (public/). Tests that also run page scripts
// find them in the sibling checkout (../naka-ai-landing next to naka-ai-backend) or NAKA_LANDING_PUBLIC,
// and skip those page checks when it is absent. The Worker itself does not read these files.
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC_DIR = path.resolve(process.env.NAKA_LANDING_PUBLIC
  || path.join(__dirname, '..', '..', '..', '..', 'naka-ai-landing', 'public'));
const hasPublic = fs.existsSync(path.join(PUBLIC_DIR, 'index.html'));
const publicPath = (rel) => path.join(PUBLIC_DIR, rel);
/** pass as `{ skip: skipNoPublic }` to page-level tests */
const skipNoPublic = hasPublic ? false : `landing pages not found at ${PUBLIC_DIR} (clone naka-ai-landing next to naka-ai-backend or set NAKA_LANDING_PUBLIC)`;

module.exports = { PUBLIC_DIR, hasPublic, publicPath, skipNoPublic };
