import test from 'node:test';
import assert from 'node:assert/strict';
import { FORMATS, PALETTE_SLOTS, createScene, objectSize, validatePalette, localInterpret, recolorSvg, namespaceSvgIds, assembleSvg } from '../public/js/scene.js';
const assets = [
  { id: 'book', name: 'Книга', tags: ['учеба', 'book'], canonicalSize: { width: 200, height: 300 }, variants: { L: { main: 'bookL' }, S: { main: 'bookS' } } },
  { id: 'coin', name: 'Монета', tags: ['деньги', 'coin'], canonicalSize: { width: 100, height: 100 }, variants: { L: { main: 'coinL' }, S: { main: 'coinS' } } },
  { id: 'lamp', name: 'Лампа', tags: ['идея'], canonicalSize: { width: 120, height: 220 }, variants: { L: { main: 'lampL' } } },
  { id: 'phone', name: 'Телефон', tags: ['связь'], canonicalSize: { width: 100, height: 200 }, variants: { L: { main: 'phoneL' } } },
];
const palette = { id: 'test', name: 'Тест', colors: Object.fromEntries(Object.values(PALETTE_SLOTS).map((slot, i) => [slot, `#${String(i + 1).repeat(6)}`])) };
test('layouts fit all canonical boxes and retain a common scale for 1–12 objects', () => {
  for (const format of FORMATS) for (const layout of ['balanced', 'offset', 'headline']) for (let count = 1; count <= 12; count++) {
    const ids = Array.from({ length: count }, (_, i) => assets[i % 2].id);
    const scene = createScene(ids, assets, { ...format, layout });
    for (const object of scene.objects) {
      const asset = assets.find(a => a.id === object.assetId);
      const size = objectSize(asset, scene);
      assert.ok(object.x >= size.width / 2 && object.x + size.width / 2 <= scene.width);
      assert.ok(object.y >= size.height / 2 && object.y + size.height / 2 <= scene.height);
      assert.ok(Math.abs(size.width / asset.canonicalSize.width - scene.globalScale) < 1e-10);
    }
  }
});
test('layout variants differ, repeatable seed and details preserve canonical sizes', () => {
  const opts = { width: 800, height: 1200 };
  const balanced = createScene(['book', 'coin'], assets, opts);
  const offset = createScene(['book', 'coin'], assets, { ...opts, layout: 'offset' });
  const headline = createScene(['book', 'coin'], assets, { ...opts, layout: 'headline' });
  assert.notDeepEqual(offset.objects, balanced.objects);
  assert.notDeepEqual(headline.objects, balanced.objects);
  assert.deepEqual(offset, createScene(['book', 'coin'], assets, { ...opts, layout: 'offset' }));
  assert.equal(createScene(['book', 'coin'], assets, { ...opts, detail: 'S' }).globalScale, balanced.globalScale);
  assert.throws(() => createScene(['missing'], assets));
});
test('palette validates full schema and restricts background slots', () => {
  assert.equal(validatePalette(palette).colors.surface, '#111111');
  assert.throws(() => validatePalette({ ...palette, backgroundSlot: 'pink' }));
  assert.throws(() => validatePalette({ colors: { surface: 'red' } }));
  const source = '<path fill="#d7cdf5" stroke="#181817" d="M1 2L3 4"/>';
  assert.equal(recolorSvg(source, palette), '<path fill="#111111" stroke="#777777" d="M1 2L3 4"/>');
});
test('local metaphor selection uses available assets and admits unknown themes', () => {
  for (const [text, id] of [['Учеба открывает двери', 'book'], ['Финансовая свобода', 'coin'], ['Пришла идея', 'lamp'], ['Связь с командой', 'phone']]) {
    const result = localInterpret(text, assets);
    assert.ok(result.confident);
    assert.ok(result.ids.includes(id));
    assert.ok(result.ids.every(id => assets.some(a => a.id === id)));
  }
  assert.equal(localInterpret('Сиреневый горизонт тишины', assets).confident, false);
  assert.deepEqual(localInterpret('книги', assets).ids, ['book']);
});
test('SVG export namespaces repeated definitions and keeps vectors editable', () => {
  const source = '<svg viewBox="10 20 200 300"><defs><clipPath id="clip"><path d="M0 0L10 10"/></clipPath></defs><g clip-path="url(#clip)"><use href="#clip"/><path fill="#D7CDF5" d="M1 2L3 4"/></g></svg>';
  const scene = createScene(['book', 'book'], assets, { detail: 'S' });
  const output = assembleSvg(scene, assets, new Map([['bookS', source]]), palette);
  assert.ok(output.includes('viewBox="10 20 200 300"'));
  assert.ok(output.includes('id="asset-0-clip"'));
  assert.ok(output.includes('id="asset-1-clip"'));
  assert.ok(output.includes('url(#asset-1-clip)'));
  assert.ok(output.includes('href="#asset-0-clip"'));
  assert.ok(output.includes('d="M1 2L3 4"'));
  assert.ok(!output.includes('<image'));
  assert.ok(output.includes('fill="#111111"'));
  assert.equal((output.match(/id="asset-\d-clip"/g) || []).length, 2);
  assert.ok(namespaceSvgIds("<g id='a'><use xlink:href='#a'/></g>", 'p').includes("xlink:href='#p-a'"));
});

test('partial unfamiliar metaphor defers to AI while lists and known combinations stay local', () => {
  const puzzle = {
    id: 'puzzle',
    name: 'Пазл',
    tags: ['puzzle', 'части'],
    canonicalSize: { width: 150, height: 150 },
    variants: { L: { main: 'puzzleL' } },
  };
  const fixtureAssets = [...assets, puzzle];
  const unfamiliar = localInterpret('Книга скользит по сиреневому горизонту тишины', fixtureAssets);
  assert.ok(unfamiliar.ids.includes('book'));
  assert.equal(unfamiliar.confident, false);
  assert.equal(localInterpret('Книга, монета', fixtureAssets).confident, true);
  const knowledge = localInterpret('Собрать знания воедино', fixtureAssets);
  assert.equal(knowledge.confident, true);
  assert.ok(knowledge.ids.includes('book'));
  assert.ok(knowledge.ids.includes('puzzle'));
});
