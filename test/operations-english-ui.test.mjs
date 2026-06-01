import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function snippetBetween(start, end) {
  const s = html.indexOf(start);
  assert.notEqual(s, -1, `Missing snippet start: ${start}`);
  const e = html.indexOf(end, s + start.length);
  assert.notEqual(e, -1, `Missing snippet end: ${end}`);
  return html.slice(s, e);
}

function htmlText(fragment) {
  return fragment
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scriptText(fragment) {
  return fragment
    .replace(/\/\/.*$/gm, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

test('operations tabs and modals expose English visible UI text', () => {
  const fragments = [
    snippetBetween('<nav class="app-shell-nav flex">', '</nav>'),
    snippetBetween('<main id="view-inventory"', '<main id="view-transport"'),
    snippetBetween('<main id="view-transport"', '<main id="view-database"'),
    snippetBetween('<main id="view-pvcalc"', '<main id="view-costcalc"'),
    snippetBetween('<main id="view-costcalc"', '<div id="install-modal"'),
    snippetBetween('<div id="install-modal"', '<div id="battery-program-modal"'),
    snippetBetween('<div id="battery-program-modal"', '<div id="supplier-modal"'),
    snippetBetween('<div id="inventory-modal"', '<div id="sales-out-modal"'),
    snippetBetween('<div id="sales-out-modal"', '<div id="historical-inventory-modal"'),
    snippetBetween('<div id="historical-inventory-modal"', '<!-- 全局浮窗容器 -->'),
    snippetBetween('<div id="inventory-edit-modal"', '<div id="import-modal"')
  ].join('\n');

  const text = htmlText(fragments);
  assert.equal(/[\u4e00-\u9fff]/.test(text), false, text.match(/.{0,20}[\u4e00-\u9fff].{0,20}/)?.[0] || 'Chinese UI text remains');
});

test('runtime-rendered operations UI strings are English', () => {
  const fragments = [
    snippetBetween('window.renderInventory =', 'window.renderTransportInventoryPicker'),
    snippetBetween('function getTransportMethodLabel', 'window.saveTransportFromModal'),
    snippetBetween('window.saveTransportFromModal', 'window.showInventoryTooltip'),
    snippetBetween('window.showInventoryTooltip', 'window.hideInventoryTooltip'),
    snippetBetween('window.openInstallModal', 'window.changeInventoryHistoryPage'),
    snippetBetween('window.exportInventoryHistory', 'function computeSalesCustomsFeeByType'),
    snippetBetween('window.renderHistoricalInventory', 'window.exportHistoricalInventory'),
    snippetBetween('window.exportHistoricalInventory', 'window.editSalesRecord'),
    snippetBetween('let costData =', 'window.generateQuoteNo')
  ].join('\n');

  const text = scriptText(fragments);
  assert.equal(/[\u4e00-\u9fff]/.test(text), false, text.match(/.{0,20}[\u4e00-\u9fff].{0,20}/)?.[0] || 'Chinese runtime UI text remains');
});
