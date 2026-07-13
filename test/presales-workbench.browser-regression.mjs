import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const playwrightRoots = [
  process.env.MINOVA_PLAYWRIGHT_NODE_MODULES,
  join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules')
].filter(Boolean);

function loadPlaywright() {
  try {
    return createRequire(import.meta.url)('playwright');
  } catch (error) {
    for (const root of playwrightRoots) {
      try {
        return createRequire(join(root, 'package.json'))('playwright');
      } catch (ignored) {}
    }
    throw new Error(
      'Playwright is required for this browser regression. Install it or set MINOVA_PLAYWRIGHT_NODE_MODULES to its node_modules directory.'
    );
  }
}

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png'
};

async function startStaticServer() {
  const server = createServer(async (request, response) => {
    const requestPath = decodeURIComponent(new URL(request.url || '/', 'http://127.0.0.1').pathname);
    const relativePath = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
    const filePath = resolve(repoRoot, normalize(relativePath));
    if (!filePath.startsWith(`${repoRoot}/`) && filePath !== repoRoot) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    try {
      const body = await readFile(filePath);
      response.writeHead(200, { 'content-type': contentTypes[extname(filePath)] || 'application/octet-stream' });
      response.end(body);
    } catch (error) {
      response.writeHead(error?.code === 'ENOENT' ? 404 : 500).end('Not found');
    }
  });
  await new Promise((resolveServer, rejectServer) => {
    server.once('error', rejectServer);
    server.listen(0, '127.0.0.1', resolveServer);
  });
  const address = server.address();
  return {
    server,
    url: `http://127.0.0.1:${address.port}/index.html`
  };
}

const enumCoverage = {
  'presales-genset-use': ['unknown', 'outage', 'peak_shaving', 'continuous'],
  'presales-export-eligibility': ['unknown', 'confirmed', 'restricted', 'not_allowed'],
  'presales-evidence-utility-bills': ['complete', 'partial', 'missing'],
  'presales-evidence-load-profile': ['available', 'requested', 'missing'],
  'presales-evidence-site-photos': ['available', 'requested', 'missing'],
  'presales-evidence-existing-sld': ['available', 'requested', 'missing'],
  'presales-evidence-structural-report': ['available', 'requested', 'not_required', 'missing']
};

function nestedValue(project, fieldId) {
  const key = fieldId.replace(/^presales-(?:evidence-)?/, '').replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  const evidence = fieldId.startsWith('presales-evidence-');
  return project[evidence ? 'evidenceStatus' : 'intakeBasis'][key];
}

const { chromium } = loadPlaywright();
const { server, url } = await startStaticServer();
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.MINOVA_CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--no-sandbox', '--disable-gpu']
});

try {
  const page = await browser.newPage({ viewport: { width: 375, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForFunction(() => typeof window.saveCurrentPresalesProject === 'function', { timeout: 60000 });
  await page.evaluate(() => {
    window.__minovaAuth = { state: { user: { id: 'browser-regression' } } };
    window.switchTab('presales');
    window.createPresalesProject();
  });

  await page.locator('#presales-site-summary').fill(
    'First raw note line. Second raw note line. Third raw note line that must remain available through Expand/Edit.'
  );
  const notesBeforeExpand = await page.evaluate(() => {
    const summary = document.getElementById('presales-intake-notes-summary');
    const panel = document.getElementById('presales-intake-notes');
    const button = document.querySelector('[data-presales-intake-group="notes"]');
    const style = getComputedStyle(summary);
    const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.5;
    return {
      clamp: style.webkitLineClamp,
      height: summary.getBoundingClientRect().height,
      lineHeight,
      panelHidden: panel.classList.contains('hidden'),
      expanded: button.getAttribute('aria-expanded'),
      summary: summary.textContent
    };
  });
  assert.equal(notesBeforeExpand.clamp, '2');
  assert.ok(notesBeforeExpand.height <= (notesBeforeExpand.lineHeight * 2) + 1, 'raw notes summary exceeds two rendered lines');
  assert.equal(notesBeforeExpand.panelHidden, true);
  assert.equal(notesBeforeExpand.expanded, 'false');
  assert.match(notesBeforeExpand.summary, /First raw note line/);

  await page.locator('[data-presales-intake-group="notes"]').click();
  await page.locator('#presales-site-summary').fill('Edited raw note remains visible in the collapsed summary.');
  const notesAfterEdit = await page.evaluate(() => ({
    panelHidden: document.getElementById('presales-intake-notes').classList.contains('hidden'),
    expanded: document.querySelector('[data-presales-intake-group="notes"]').getAttribute('aria-expanded'),
    summary: document.getElementById('presales-intake-notes-summary').textContent
  }));
  assert.equal(notesAfterEdit.panelHidden, false);
  assert.equal(notesAfterEdit.expanded, 'true');
  assert.equal(notesAfterEdit.summary, 'Edited raw note remains visible in the collapsed summary.');

  for (const [fieldId, values] of Object.entries(enumCoverage)) {
    for (const value of values) {
      const roundTrip = await page.evaluate(({ fieldId, value }) => {
        const field = document.getElementById(fieldId);
        field.value = value;
        window.saveCurrentPresalesProject();
        const projects = JSON.parse(localStorage.getItem('minova_presales_projects_v1') || '[]');
        const project = projects[0];
        return { selected: field.value, project };
      }, { fieldId, value });
      assert.equal(roundTrip.selected, value, `${fieldId} must accept ${value}`);
      assert.equal(nestedValue(roundTrip.project, fieldId), value, `${fieldId} lost ${value} during save/normalize`);
    }
  }

  await page.locator('[aria-controls="presales-stage-mobile-menu"]').click();
  const mobileLayout = await page.evaluate(() => {
    const commandBar = document.getElementById('presales-command-bar').getBoundingClientRect();
    const selector = document.getElementById('presales-project-select').getBoundingClientRect();
    const actionRows = [...document.querySelectorAll('#presales-command-bar button')]
      .map(button => button.getBoundingClientRect());
    const stageButtons = [...document.querySelectorAll('#presales-stage-mobile-menu [data-presales-stage]')]
      .map(button => button.getBoundingClientRect().height);
    return {
      commandBar,
      selector,
      actionRows,
      stageButtons,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth
    };
  });
  assert.equal(mobileLayout.stageButtons.length, 6);
  assert.ok(mobileLayout.stageButtons.every(height => height >= 44), `mobile stage controls below 44px: ${mobileLayout.stageButtons.join(', ')}`);
  assert.ok(mobileLayout.selector.width >= 220, `project selector is over-compressed at ${mobileLayout.selector.width}px`);
  assert.ok(mobileLayout.actionRows.every(box => box.top >= mobileLayout.selector.bottom), 'project selector must occupy its own mobile command-bar row');
  assert.ok(mobileLayout.documentWidth <= mobileLayout.viewportWidth, 'mobile command bar must not cause horizontal overflow');
  assert.equal(pageErrors.length, 0, `browser errors: ${pageErrors.join('; ')}`);
} finally {
  await browser.close();
  await new Promise(resolveServer => server.close(resolveServer));
}

console.log('Presales browser regression passed.');
