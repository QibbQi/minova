import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const stateDoc = JSON.parse(readFileSync(new URL('../minova-data/state.json', import.meta.url), 'utf8'));

const englishCategories = new Set([
  'PV Module',
  'Inverter',
  'Battery',
  'Accessory',
  'All-in-One System',
  'C&I Storage',
  'Uncategorized'
]);

const englishSubcategories = new Set([
  'Bifacial',
  'Three-Phase',
  'Stackable Single-Phase Inverter',
  'Stackable Home Storage',
  'Stackable Product Accessory',
  'Single-Phase All-in-One',
  'Energy Storage Cabinet'
]);

const legacyChineseCategories = ['光伏组件', '逆变器', '电池', '配件', '一体机', '工商储', '未分类'];
const legacyChineseSubcategories = ['双面', '三相', '堆叠式单相逆变器', '堆叠式家储', '堆叠式产品配件', '单相一体机', '储能柜'];

function embeddedState() {
  const marker = '<script id="minova-embedded-state" type="application/json">';
  const start = html.indexOf(marker);
  assert.notEqual(start, -1, 'Missing embedded state');
  const end = html.indexOf('</script>', start + marker.length);
  assert.notEqual(end, -1, 'Missing embedded state end');
  return JSON.parse(html.slice(start + marker.length, end).trim());
}

function collectCategories(data) {
  const values = [];
  (data.products || []).forEach((product) => values.push(product.category));
  (data.marketPrices?.records || []).forEach((record) => values.push(record.category));
  values.push(...Object.keys(data.marketPrices?.categoryUnits || {}));
  values.push(...Object.keys(data.subcategoriesByCategory || {}));
  Object.values(data.profitSettings?.enabled || {}).forEach(() => {});
  values.push(...Object.keys(data.profitSettings?.enabled || {}));
  Object.values(data.profitSettings?.categoryProfitPct || {}).forEach((company) => {
    values.push(...Object.keys(company.home || {}));
    values.push(...Object.keys(company.biz || {}));
  });
  Object.values(data.profitSettings?.subcatProfitPct || {}).forEach((company) => {
    Object.values(company.home || {}).forEach((map) => values.push(...Object.keys(map || {})));
    Object.values(company.biz || {}).forEach((map) => values.push(...Object.keys(map || {})));
    values.push(...Object.keys(company.home || {}));
    values.push(...Object.keys(company.biz || {}));
  });
  return values.filter(Boolean);
}

function collectSubcategories(data) {
  const values = [];
  (data.products || []).forEach((product) => values.push(product.scenario));
  Object.values(data.subcategoriesByCategory || {}).forEach((subs) => values.push(...(subs || [])));
  Object.values(data.profitSettings?.enabled || {}).forEach((subs) => values.push(...Object.keys(subs || {})));
  Object.values(data.profitSettings?.subcatProfitPct || {}).forEach((company) => {
    Object.values(company.home || {}).forEach((map) => values.push(...Object.keys(map || {})));
    Object.values(company.biz || {}).forEach((map) => values.push(...Object.keys(map || {})));
  });
  return values.filter(Boolean);
}

test('published and embedded state use English category and subcategory keys', () => {
  for (const source of [stateDoc, embeddedState()]) {
    const data = source.data;
    for (const category of collectCategories(data)) {
      assert.equal(legacyChineseCategories.includes(category), false, `Legacy Chinese category remains: ${category}`);
      assert.equal(englishCategories.has(category), true, `Unexpected category value: ${category}`);
    }
    for (const subcategory of collectSubcategories(data)) {
      assert.equal(legacyChineseSubcategories.includes(subcategory), false, `Legacy Chinese subcategory remains: ${subcategory}`);
      assert.equal(englishSubcategories.has(subcategory), true, `Unexpected subcategory value: ${subcategory}`);
    }
  }
});

test('quote From Inventory category filter is English and keeps legacy normalization hooks', () => {
  const pickerStart = html.indexOf('<select id="picker-category"');
  assert.notEqual(pickerStart, -1, 'Missing quote picker category select');
  const pickerEnd = html.indexOf('</select>', pickerStart);
  const pickerHtml = html.slice(pickerStart, pickerEnd);

  for (const category of englishCategories) {
    if (category === 'Uncategorized') continue;
    const escaped = category.replace('&', '&amp;');
    assert.match(pickerHtml, new RegExp(`value="${escaped.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`), `Missing picker option: ${category}`);
  }
  for (const category of legacyChineseCategories) {
    assert.equal(pickerHtml.includes(`value="${category}"`), false, `Picker still exposes legacy category: ${category}`);
  }

  assert.match(html, /function normalizeProductCategory\(/, 'Missing category normalization helper');
  assert.match(html, /function normalizeProductSubcategory\(/, 'Missing subcategory normalization helper');
  assert.match(html, /\['光伏组件', 'PV Module'\]/, 'Missing legacy category alias');
  assert.match(html, /\['堆叠式家储', 'Stackable Home Storage'\]/, 'Missing legacy subcategory alias');
  assert.match(html, /normalizeProductCategory\(category\)/, 'Import duty classification should use normalized categories');
  assert.match(html, /normalizeProductCategory\(p\.category\) === 'PV Module'/, 'PV quantity classification should use normalized categories');
  assert.equal(html.includes("String(p.category || '').includes('光伏组件')"), false, 'PV quantity still checks legacy Chinese category directly');
  assert.equal(/\bc\.includes\('光伏组件'\)/.test(html), false, 'Import duty still checks legacy Chinese category directly');
});

test('saved quote picker snapshots do not persist legacy category filters', () => {
  const quoteDir = new URL('../minova-data/quotes', import.meta.url);
  const files = readdirSync(quoteDir).filter((file) => file.endsWith('.json') && file !== 'index.json');
  for (const file of files) {
    const doc = JSON.parse(readFileSync(new URL(`../minova-data/quotes/${file}`, import.meta.url), 'utf8'));
    const value = doc.snapshot?.fields?.['picker-category']?.v || '';
    assert.equal(legacyChineseCategories.includes(value), false, `${file} keeps legacy picker category ${value}`);
  }
});
