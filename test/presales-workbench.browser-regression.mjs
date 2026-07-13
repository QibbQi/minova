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

async function activatePresalesWorkspace(page, userId) {
  await page.evaluate(id => {
    window.__minovaAuth = {
      state: { user: { id } },
      canPerformAction: () => true
    };
    window.switchTab('presales');
  }, userId);
  await page.waitForFunction(() => {
    const view = document.getElementById('view-presales');
    const box = view?.getBoundingClientRect();
    return Boolean(
      view &&
      !view.classList.contains('hidden') &&
      getComputedStyle(view).display !== 'none' &&
      box.width > 0 &&
      box.height > 0
    );
  });
  await page.evaluate(() => window.createPresalesProject());
}

function assertRenderedSurface(box, name) {
  assert.ok(box.width > 0, `${name} width must be non-zero`);
  assert.ok(box.height > 0, `${name} height must be non-zero`);
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
  await activatePresalesWorkspace(page, 'browser-regression');

  const initialSnapshot = await page.evaluate(() => ({
    presalesView: document.getElementById('view-presales').getBoundingClientRect(),
    score: document.getElementById('presales-readiness-score').textContent,
    kpiCount: document.querySelectorAll('#presales-kpi-strip > div').length,
    architecture: document.getElementById('presales-energy-architecture').textContent,
    hasAccessibleArchitecture: Boolean(document.querySelector('#presales-energy-architecture svg[role="img"][aria-label]'))
  }));
  assertRenderedSurface(initialSnapshot.presalesView, 'mobile Presales workspace');
  assert.match(initialSnapshot.score, /^\d+%$/);
  assert.equal(initialSnapshot.kpiCount, 6);
  assert.match(initialSnapshot.architecture, /(Pending EPC|EPC draft)/);
  assert.match(initialSnapshot.architecture, /Energy concept: PV Pending/);
  assert.equal(initialSnapshot.hasAccessibleArchitecture, true);

  const actionNavigation = await page.evaluate(() => {
    window.focusPresalesGap('quote', 'Select Quote Draft');
    const quoteSelection = {
      activeElement: document.activeElement?.id,
      presalesVisible: document.getElementById('view-presales').offsetParent !== null
    };
    window.focusPresalesGap('quote');
    const quote = {
      quoteVisible: document.getElementById('view-quotation').offsetParent !== null,
      presalesHidden: document.getElementById('view-presales').offsetParent === null
    };
    window.switchTab('presales');
    window.focusPresalesGap('epc', 'Select Hybrid EPC Design');
    const epcSelection = {
      activeElement: document.activeElement?.id,
      presalesVisible: document.getElementById('view-presales').offsetParent !== null
    };
    window.focusPresalesGap('epc');
    const epc = {
      epcVisible: document.getElementById('view-epcdesign').offsetParent !== null,
      presalesHidden: document.getElementById('view-presales').offsetParent === null
    };
    window.switchTab('presales');
    return { quoteSelection, quote, epcSelection, epc };
  });
  assert.deepEqual(actionNavigation.quoteSelection, { activeElement: 'presales-quote-link', presalesVisible: true });
  assert.deepEqual(actionNavigation.quote, { quoteVisible: true, presalesHidden: true });
  assert.deepEqual(actionNavigation.epcSelection, { activeElement: 'presales-epc-link', presalesVisible: true });
  assert.deepEqual(actionNavigation.epc, { epcVisible: true, presalesHidden: true });

  await page.locator('#presales-customer-name').fill('North Plant');
  await page.locator('#presales-monthly-consumption-kwh').fill('186000');
  await page.waitForTimeout(160);
  const refreshedSnapshot = await page.evaluate(() => {
    window.setPresalesStage('Risk');
    return {
      monthlyConsumption: document.querySelector('#presales-kpi-strip').textContent,
      currentStage: document.querySelector('#presales-stage-rail [aria-current="step"]')?.getAttribute('data-presales-stage'),
      completedStage: document.querySelector('#presales-stage-rail [data-presales-stage="Intake"]')?.getAttribute('aria-label'),
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth
    };
  });
  assert.match(refreshedSnapshot.monthlyConsumption, /186,000 kWh/);
  assert.equal(refreshedSnapshot.currentStage, 'Risk');
  assert.match(refreshedSnapshot.completedStage, /completed/);
  assert.ok(refreshedSnapshot.documentWidth <= refreshedSnapshot.viewportWidth, 'snapshot must not cause mobile horizontal overflow');

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
  const mobileSnapshotLayout = await page.evaluate(() => {
    const rect = id => {
      const box = document.getElementById(id).getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, width: box.width };
    };
    const snapshot = rect('presales-opportunity-snapshot');
    const evidence = rect('presales-evidence-gaps');
    const quote = rect('presales-quote-detail');
    const epc = rect('presales-epc-detail');
    const energyLabels = [...document.querySelectorAll('#presales-energy-architecture [data-presales-energy-label]')]
      .map(label => ({
        text: label.textContent.trim(),
        fontSize: Number.parseFloat(getComputedStyle(label).fontSize),
        box: label.getBoundingClientRect()
      }));
    return { snapshot, evidence, quote, epc, energyLabels, documentWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth };
  });
  for (const [name, box] of Object.entries({ snapshot: mobileSnapshotLayout.snapshot, evidence: mobileSnapshotLayout.evidence, quote: mobileSnapshotLayout.quote, epc: mobileSnapshotLayout.epc })) {
    assertRenderedSurface(box, `mobile ${name} surface`);
  }
  assert.ok(mobileSnapshotLayout.documentWidth <= mobileSnapshotLayout.viewportWidth, 'mobile snapshot must not cause horizontal overflow');
  assert.ok(mobileSnapshotLayout.snapshot.bottom <= mobileSnapshotLayout.evidence.top + 1, 'evidence strip overlaps the mobile snapshot');
  assert.ok(mobileSnapshotLayout.evidence.bottom <= Math.min(mobileSnapshotLayout.quote.top, mobileSnapshotLayout.epc.top) + 1, 'linked detail surfaces overlap the mobile evidence strip');
  assert.ok([mobileSnapshotLayout.snapshot, mobileSnapshotLayout.evidence, mobileSnapshotLayout.quote, mobileSnapshotLayout.epc].every(box => box.width <= mobileSnapshotLayout.viewportWidth), 'mobile snapshot surface exceeds viewport width');
  assert.equal(mobileSnapshotLayout.energyLabels.length, 4, 'mobile energy architecture must render four readable labels');
  assert.ok(mobileSnapshotLayout.energyLabels.every(label => label.box.width > 0 && label.box.height > 0 && label.fontSize >= 12), `mobile energy labels must be visible at 12px or larger: ${JSON.stringify(mobileSnapshotLayout.energyLabels)}`);
  await page.screenshot({ path: '/private/tmp/presales-task3-mobile.png', fullPage: true });

  const desktopPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await desktopPage.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await desktopPage.waitForFunction(() => typeof window.saveCurrentPresalesProject === 'function', { timeout: 60000 });
  await activatePresalesWorkspace(desktopPage, 'desktop-visual-regression');
  await desktopPage.locator('#presales-customer-name').fill('Desktop Visual Plant');
  await desktopPage.locator('#presales-monthly-consumption-kwh').fill('186000');
  await desktopPage.waitForTimeout(160);
  const desktopSnapshotLayout = await desktopPage.evaluate(() => {
    const rect = id => {
      const box = document.getElementById(id).getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, width: box.width };
    };
    const snapshot = rect('presales-opportunity-snapshot');
    const evidence = rect('presales-evidence-gaps');
    const quote = rect('presales-quote-detail');
    const epc = rect('presales-epc-detail');
    return {
      presalesView: rect('view-presales'),
      score: document.getElementById('presales-readiness-score').textContent,
      kpiCount: document.querySelectorAll('#presales-kpi-strip > div').length,
      hasArchitecture: Boolean(document.querySelector('#presales-energy-architecture svg[role="img"][aria-label]')),
      snapshot,
      evidence,
      quote,
      epc,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth
    };
  });
  assertRenderedSurface(desktopSnapshotLayout.presalesView, 'desktop Presales workspace');
  for (const [name, box] of Object.entries({ snapshot: desktopSnapshotLayout.snapshot, evidence: desktopSnapshotLayout.evidence, quote: desktopSnapshotLayout.quote, epc: desktopSnapshotLayout.epc })) {
    assertRenderedSurface(box, `desktop ${name} surface`);
  }
  assert.match(desktopSnapshotLayout.score, /^\d+%$/);
  assert.equal(desktopSnapshotLayout.kpiCount, 6);
  assert.equal(desktopSnapshotLayout.hasArchitecture, true);
  assert.ok(desktopSnapshotLayout.documentWidth <= desktopSnapshotLayout.viewportWidth, 'desktop snapshot must not cause horizontal overflow');
  assert.ok(desktopSnapshotLayout.snapshot.bottom <= desktopSnapshotLayout.evidence.top + 1, 'desktop evidence strip overlaps the snapshot');
  assert.ok(desktopSnapshotLayout.evidence.bottom <= Math.min(desktopSnapshotLayout.quote.top, desktopSnapshotLayout.epc.top) + 1, 'desktop linked detail surfaces overlap the evidence strip');
  await desktopPage.screenshot({ path: '/private/tmp/presales-task3-desktop.png', fullPage: true });
  await desktopPage.close();
  assert.equal(pageErrors.length, 0, `browser errors: ${pageErrors.join('; ')}`);
} finally {
  await browser.close();
  await new Promise(resolveServer => server.close(resolveServer));
}

console.log('Presales browser regression passed.');
