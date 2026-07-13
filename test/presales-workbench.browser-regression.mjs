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

function cssDurationSeconds(value) {
  return Math.max(...String(value || '')
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const duration = Number.parseFloat(part);
      if (!Number.isFinite(duration)) return 0;
      return part.endsWith('ms') ? duration / 1000 : duration;
    }), 0);
}

async function activatePresalesWorkspace(page, userId) {
  await page.evaluate(id => {
    const permission = {
      tabs: ['presales', 'epcdesign', 'quotation'],
      actions: {
        epcDesign: ['read', 'edit'],
        epcDesignEngineering: ['read', 'edit'],
        presales: ['read', 'edit']
      }
    };
    Object.assign(window.__minovaAuth.state, {
      user: { id },
      ready: true,
      locked: false,
      permission
    });
    Object.defineProperties(window.__minovaAuth.state, {
      ready: { configurable: true, get: () => true, set: () => {} },
      locked: { configurable: true, get: () => false, set: () => {} },
      permission: { configurable: true, get: () => permission, set: () => {} }
    });
    const overlay = document.getElementById('minova-auth-overlay');
    if (overlay) overlay.style.setProperty('display', 'none', 'important');
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
  assert.ok(box.width > 0, `${name} width must be non-zero: ${JSON.stringify(box)}`);
  assert.ok(box.height > 0, `${name} height must be non-zero: ${JSON.stringify(box)}`);
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

  const initialSnapshot = await page.evaluate(() => {
    const box = document.getElementById('view-presales').getBoundingClientRect();
    return {
      presalesView: { top: box.top, bottom: box.bottom, width: box.width, height: box.height },
      score: document.getElementById('presales-readiness-score').textContent,
      kpiCount: document.querySelectorAll('#presales-kpi-strip > div').length,
      architecture: document.getElementById('presales-energy-architecture').textContent,
      hasAccessibleArchitecture: Boolean(document.querySelector('#presales-energy-architecture svg[role="img"][aria-label]'))
    };
  });
  assertRenderedSurface(initialSnapshot.presalesView, 'mobile Presales workspace');
  assert.match(initialSnapshot.score, /^\d+%$/);
  assert.equal(initialSnapshot.kpiCount, 6);
  assert.match(initialSnapshot.architecture, /(Pending EPC|EPC draft)/);
  assert.match(initialSnapshot.architecture, /Energy architecture: PV Pending/);
  assert.equal(initialSnapshot.hasAccessibleArchitecture, true);

  const chineseDynamicContent = await page.evaluate(() => {
    window.toggleLanguage();
    window.openPresalesHandoff();
    const values = {
      readiness: document.querySelector('#presales-opportunity-snapshot').textContent,
      quote: document.getElementById('presales-quote-detail').textContent,
      epc: document.getElementById('presales-epc-detail').textContent,
      evidence: document.getElementById('presales-evidence-gaps').textContent,
      energy: document.getElementById('presales-energy-architecture').textContent,
      handoff: document.getElementById('presales-handoff-preview').textContent
    };
    window.setPresalesHandoffTab('internal');
    values.internalHandoff = document.getElementById('presales-handoff-preview').textContent;
    window.setPresalesHandoffTab('customer');
    window.closePresalesHandoff();
    window.toggleLanguage();
    return values;
  });
  assert.match(chineseDynamicContent.readiness, /商务就绪度/);
  assert.match(chineseDynamicContent.quote, /未关联报价/);
  assert.match(chineseDynamicContent.epc, /工程草案|未关闭高风险/);
  assert.match(chineseDynamicContent.evidence, /待补证据/);
  assert.match(chineseDynamicContent.energy, /能源架构/);
  assert.match(chineseDynamicContent.energy, /交流母线 \/ PCS/);
  assert.match(chineseDynamicContent.energy, /客户负荷/);
  assert.match(chineseDynamicContent.handoff, /客户输出已阻止/);
  assert.match(chineseDynamicContent.internalHandoff, /客户\/现场基础/);
  assert.match(chineseDynamicContent.internalHandoff, /电价/);

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
  await page.locator('[data-presales-intake-group="energy"]').click();
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
  assert.match(refreshedSnapshot.monthlyConsumption, /186,?000 kWh/);
  assert.equal(refreshedSnapshot.currentStage, 'Risk');
  assert.match(refreshedSnapshot.completedStage, /completed/);
  assert.ok(refreshedSnapshot.documentWidth <= refreshedSnapshot.viewportWidth, 'snapshot must not cause mobile horizontal overflow');

  await page.evaluate(text => {
    const field = document.getElementById('presales-site-summary');
    field.value = text;
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }, 'First raw note line. Second raw note line. Third raw note line that must remain available through Expand/Edit.');
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

  await page.locator('button[data-presales-copy="handoff"]').click();
  await page.waitForFunction(() => document.activeElement?.id === 'presales-handoff-close');
  const drawerCustomer = await page.evaluate(() => ({
    visible: !document.getElementById('presales-handoff-drawer').classList.contains('hidden'),
    modal: document.getElementById('presales-handoff-drawer').getAttribute('aria-modal'),
    bodyLocked: document.body.classList.contains('presales-handoff-open'),
    activeElement: document.activeElement?.id,
    preview: document.getElementById('presales-handoff-preview').textContent,
    copyHeight: document.querySelector('#presales-handoff-drawer button[data-presales-copy="copy"]').getBoundingClientRect().height,
    plainTextHeight: document.querySelector('#presales-handoff-drawer summary[data-presales-copy="viewPlainText"]').getBoundingClientRect().height
  }));
  assert.equal(drawerCustomer.visible, true);
  assert.equal(drawerCustomer.modal, 'true');
  assert.equal(drawerCustomer.bodyLocked, true);
  assert.equal(drawerCustomer.activeElement, 'presales-handoff-close');
  assert.doesNotMatch(drawerCustomer.preview, /Edited raw note/);
  assert.ok(drawerCustomer.copyHeight >= 44, 'handoff copy action must have a 44px target');
  assert.ok(drawerCustomer.plainTextHeight >= 44, 'View plain text summary must have a 44px target');

  await page.locator('#presales-handoff-internal-tab').click();
  const drawerInternal = await page.evaluate(() => ({
    preview: document.getElementById('presales-handoff-preview').textContent,
    plainText: document.getElementById('presales-handoff-plain-text').value,
    selected: document.getElementById('presales-handoff-internal-tab').getAttribute('aria-selected')
  }));
  assert.match(drawerInternal.preview, /Raw customer and site notes: Edited raw note/);
  assert.equal(drawerInternal.preview, drawerInternal.plainText);
  assert.equal(drawerInternal.selected, 'true');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#presales-handoff-drawer').evaluate(drawer => drawer.classList.contains('hidden')), true);
  assert.equal(await page.evaluate(() => document.activeElement?.dataset?.presalesCopy), 'handoff');

  const blockedCustomerHandoff = await page.evaluate(() => {
    const epcSelect = document.getElementById('presales-epc-link');
    const linkedEpcId = [...epcSelect.options].find(option => option.value)?.value || '';
    epcSelect.value = linkedEpcId;
    const detail = window.getPresalesEpcDetail(linkedEpcId);
    const reportBlocked = Boolean(detail?.reportBlocked);
    const copied = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: text => { copied.push(text); return Promise.resolve(); } }
    });
    window.openPresalesHandoff();
    window.setPresalesHandoffTab('customer');
    const customer = {
      copyDisabled: document.querySelector('#presales-handoff-drawer button[data-presales-copy="copy"]').disabled,
      plainTextDisabled: document.getElementById('presales-handoff-plain-text').disabled,
      reason: document.getElementById('presales-handoff-block-reason').textContent
    };
    const denied = window.copyActivePresalesHandoff();
    window.setPresalesHandoffTab('internal');
    const internal = {
      copyDisabled: document.querySelector('#presales-handoff-drawer button[data-presales-copy="copy"]').disabled,
      plainTextDisabled: document.getElementById('presales-handoff-plain-text').disabled
    };
    const allowed = window.copyActivePresalesHandoff();
    return Promise.all([denied, allowed]).then(() => ({ linkedEpcId, reportBlocked, customer, internal, copied }));
  });
  assert.ok(blockedCustomerHandoff.linkedEpcId, 'test fixture must link a real EPC project');
  assert.equal(blockedCustomerHandoff.reportBlocked, true, 'default EPC risk state must exercise the customer-output block');
  assert.deepEqual(blockedCustomerHandoff.customer, {
    copyDisabled: true,
    plainTextDisabled: true,
    reason: 'Customer-facing output blocked by open High risk. Resolve or acknowledge the High risk in EPC before release.'
  });
  assert.deepEqual(blockedCustomerHandoff.internal, { copyDisabled: false, plainTextDisabled: false });
  assert.equal(blockedCustomerHandoff.copied.length, 1, 'blocked customer copy must not reach the clipboard while internal handoff stays available');
  assert.match(blockedCustomerHandoff.copied[0], /Internal Engineering Handoff/);
  await page.keyboard.press('Escape');

  const unrelatedGlobalEpcBlock = await page.evaluate(() => {
    window.__lastEpcDesignResult = { ...(window.__lastEpcDesignResult || {}), reportGate: { blocked: true } };
    const epcSelect = document.getElementById('presales-epc-link');
    epcSelect.insertAdjacentHTML('beforeend', '<option value="not-current-linked-epc">Unavailable safe-link test EPC</option>');
    epcSelect.value = 'not-current-linked-epc';
    window.openPresalesHandoff();
    window.setPresalesHandoffTab('customer');
    const state = {
      copyDisabled: document.querySelector('#presales-handoff-drawer button[data-presales-copy="copy"]').disabled,
      reason: document.getElementById('presales-handoff-block-reason').textContent
    };
    window.closePresalesHandoff();
    return state;
  });
  assert.deepEqual(unrelatedGlobalEpcBlock, { copyDisabled: false, reason: '' });

  const saveAndSwitchPending = await page.evaluate(async () => {
    window.__minovaBusiness = null;
    await window.saveCurrentPresalesProject();
    const firstId = document.getElementById('presales-project-select').value;
    const secondId = window.createPresalesProject().id;
    window.selectPresalesProject(firstId);
    document.getElementById('presales-customer-name').value = 'Persist before switching';
    window.markPresalesDirty();
    window.selectPresalesProject(secondId);
    let resolveSave;
    window.__minovaBusiness = {
      upsertEntity: () => new Promise(resolve => { resolveSave = resolve; })
    };
    window.__presalesResolveSave = resolveSave;
    window.saveAndSwitchPresalesProject();
    await Promise.resolve();
    window.__presalesResolveSave = resolveSave;
    return {
      firstId,
      secondId,
      activeId: document.getElementById('presales-project-select').value,
      saveDisabled: document.querySelector('#presales-unsaved-switch-banner button[data-presales-copy="saveAndSwitch"]').disabled
    };
  });
  assert.equal(saveAndSwitchPending.activeId, saveAndSwitchPending.firstId, 'Save & Switch must keep the current project selected while D1 is pending');
  assert.equal(saveAndSwitchPending.saveDisabled, true, 'Save & Switch must prevent duplicate requests while D1 is pending');
  await page.evaluate(() => window.__presalesResolveSave({ ok: true }));
  await page.waitForFunction(secondId => document.getElementById('presales-project-select').value === secondId, saveAndSwitchPending.secondId);

  const saveAndSwitchRejected = await page.evaluate(async () => {
    const currentId = document.getElementById('presales-project-select').value;
    const nextId = JSON.parse(localStorage.getItem('minova_presales_projects_v1') || '[]').find(project => project.id !== currentId).id;
    document.getElementById('presales-customer-name').value = 'Keep this draft after rejection';
    window.markPresalesDirty();
    window.selectPresalesProject(nextId);
    let rejectSave;
    window.__minovaBusiness = {
      upsertEntity: () => new Promise((resolve, reject) => { rejectSave = reject; })
    };
    window.__presalesRejectSave = rejectSave;
    window.saveAndSwitchPresalesProject();
    await Promise.resolve();
    window.__presalesRejectSave = rejectSave;
    return { currentId, nextId };
  });
  await page.evaluate(() => window.__presalesRejectSave(new Error('D1 rejected this save')));
  await page.waitForFunction(currentId => {
    const status = document.getElementById('presales-updated-at');
    return document.getElementById('presales-project-select').value === currentId && status.dataset.presalesSaveState === 'error';
  }, saveAndSwitchRejected.currentId);
  const rejectedSaveState = await page.evaluate(() => ({
    activeId: document.getElementById('presales-project-select').value,
    draft: document.getElementById('presales-customer-name').value,
    bannerVisible: !document.getElementById('presales-unsaved-switch-banner').classList.contains('hidden'),
    saveDisabled: document.querySelector('#presales-unsaved-switch-banner button[data-presales-copy="saveAndSwitch"]').disabled,
    status: document.getElementById('presales-updated-at').textContent
  }));
  assert.equal(rejectedSaveState.activeId, saveAndSwitchRejected.currentId);
  assert.equal(rejectedSaveState.draft, 'Keep this draft after rejection');
  assert.equal(rejectedSaveState.bannerVisible, true);
  assert.equal(rejectedSaveState.saveDisabled, false);
  assert.match(rejectedSaveState.status, /Save failed/);
  await page.evaluate(() => window.discardAndSwitchPresalesProject());

  const saveAndSwitchResolvedFailure = await page.evaluate(async () => {
    const currentId = document.getElementById('presales-project-select').value;
    const nextId = JSON.parse(localStorage.getItem('minova_presales_projects_v1') || '[]').find(project => project.id !== currentId).id;
    document.getElementById('presales-customer-name').value = 'Keep this draft after resolved failure';
    window.markPresalesDirty();
    window.selectPresalesProject(nextId);
    window.__minovaBusiness = {
      upsertEntity: () => Promise.resolve({ ok: false, queued: true, error: 'D1 queued this save' })
    };
    await window.saveAndSwitchPresalesProject();
    return {
      currentId,
      nextId,
      activeId: document.getElementById('presales-project-select').value,
      draft: document.getElementById('presales-customer-name').value,
      bannerVisible: !document.getElementById('presales-unsaved-switch-banner').classList.contains('hidden'),
      status: document.getElementById('presales-updated-at').textContent
    };
  });
  assert.equal(saveAndSwitchResolvedFailure.activeId, saveAndSwitchResolvedFailure.currentId);
  assert.equal(saveAndSwitchResolvedFailure.draft, 'Keep this draft after resolved failure');
  assert.equal(saveAndSwitchResolvedFailure.bannerVisible, true);
  assert.match(saveAndSwitchResolvedFailure.status, /Save failed/);
  await page.evaluate(() => window.discardAndSwitchPresalesProject());

  const switchGuard = await page.evaluate(() => {
    const firstId = document.getElementById('presales-project-select').value || JSON.parse(localStorage.getItem('minova_presales_projects_v1') || '[]')[0].id;
    const newProject = window.createPresalesProject();
    const secondId = newProject.id;
    window.selectPresalesProject(firstId);
    document.getElementById('presales-customer-name').value = 'Unsaved switch value';
    window.markPresalesDirty();
    window.selectPresalesProject(secondId);
    const guarded = {
      selected: document.getElementById('presales-project-select').value,
      visible: !document.getElementById('presales-unsaved-switch-banner').classList.contains('hidden')
    };
    window.cancelPresalesProjectSwitch();
    const cancelled = document.getElementById('presales-project-select').value;
    window.selectPresalesProject(secondId);
    window.discardAndSwitchPresalesProject();
    return {
      firstId,
      secondId,
      guarded,
      cancelled,
      discarded: document.getElementById('presales-project-select').value,
      bannerHidden: document.getElementById('presales-unsaved-switch-banner').classList.contains('hidden')
    };
  });
  assert.equal(switchGuard.guarded.visible, true);
  assert.equal(switchGuard.guarded.selected, switchGuard.firstId);
  assert.equal(switchGuard.cancelled, switchGuard.firstId);
  assert.equal(switchGuard.discarded, switchGuard.secondId);
  assert.equal(switchGuard.bannerHidden, true);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('button[data-presales-copy="handoff"]').click();
  const reducedMotion = await page.locator('#presales-handoff-customer-tab').evaluate(tab => getComputedStyle(tab).transitionDuration);
  assert.ok(cssDurationSeconds(reducedMotion) <= 0.001, `reduced motion transition must be near-zero, got ${reducedMotion}`);
  await page.keyboard.press('Escape');

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
    const actionRows = [...document.querySelectorAll('#presales-command-actions button')]
      .filter(button => button.offsetParent !== null)
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
      return { top: box.top, bottom: box.bottom, width: box.width, height: box.height };
    };
    const plainRect = box => {
      return { top: box.top, bottom: box.bottom, width: box.width, height: box.height };
    };
    const snapshot = rect('presales-opportunity-snapshot');
    const evidence = rect('presales-evidence-gaps');
    const quote = rect('presales-quote-detail');
    const epc = rect('presales-epc-detail');
    const energyLabels = [...document.querySelectorAll('#presales-energy-architecture [data-presales-energy-label]')]
      .map(label => ({
        text: label.textContent.trim(),
        fontSize: Number.parseFloat(getComputedStyle(label).fontSize),
        box: plainRect(label.getBoundingClientRect())
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
  await desktopPage.locator('[data-presales-intake-group="energy"]').click();
  await desktopPage.locator('#presales-monthly-consumption-kwh').fill('186000');
  await desktopPage.waitForTimeout(160);
  const desktopSnapshotLayout = await desktopPage.evaluate(() => {
    const rect = id => {
      const box = document.getElementById(id).getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, width: box.width, height: box.height };
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
