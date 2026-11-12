import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { assembleSvg, createScene } from '../public/js/scene.js';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const catalog = JSON.parse(await readFile(resolve(projectRoot, 'public/assets/catalog.json'), 'utf8'));
const sources = new Map();

function pathGeometry(svg) {
  return [...svg.matchAll(/<path\b[^>]*>/gi)].map(([tag]) => {
    return tag.match(/\sd\s*=\s*(["'])(.*?)\1/s)?.[2] ?? '';
  });
}

function assertUniqueIds(svg) {
  const ids = [...svg.matchAll(/\sid\s*=\s*(["'])(.*?)\1/g)].map(match => match[2]);
  assert.equal(new Set(ids).size, ids.length, 'Every exported definition must have a unique id');
  for (const match of svg.matchAll(/url\(\s*["']?#([^\s)'"\s]+)/g)) {
    assert.ok(ids.includes(match[1]), 'Every URL reference resolves to an exported definition');
  }
}

test('real catalog has ten complete L/S × main/background variant sets', async () => {
  assert.equal(catalog.assets.length, 10);
  assert.equal(catalog.palettes.length, 3);
  for (const asset of catalog.assets) {
    assert.ok(asset.canonicalSize.width > 0 && asset.canonicalSize.height > 0);
    for (const detail of ['L', 'S']) {
      for (const role of ['main', 'background']) {
        const url = asset.variants[detail][role];
        assert.equal(typeof url, 'string');
        const source = await readFile(resolve(projectRoot, 'public', url), 'utf8');
        assert.match(source, /<svg\b/);
        assert.match(source, /\bviewBox=/);
        assert.doesNotMatch(source, /<image\b/i);
        sources.set(url, source);
      }
    }
  }
  assert.equal(sources.size, 40);
});

test('all 40 real variants export in all three palettes with unchanged path geometry', async () => {
  let exportedVariants = 0;
  for (const asset of catalog.assets) {
    for (const detail of ['L', 'S']) {
      for (const role of ['main', 'background']) {
        const url = asset.variants[detail][role];
        const source = sources.get(url) ?? await readFile(resolve(projectRoot, 'public', url), 'utf8');
        const sourceGeometry = pathGeometry(source);
        assert.ok(sourceGeometry.length > 0);
        for (const palette of catalog.palettes) {
          const scene = createScene([asset.id, asset.id], catalog.assets, { detail });
          scene.objects.forEach(object => {
            object.role = role;
          });
          const output = assembleSvg(scene, catalog.assets, new Map([[url, source]]), palette);
          assert.deepEqual(pathGeometry(output), [...sourceGeometry, ...sourceGeometry]);
          assertUniqueIds(output);
          assert.doesNotMatch(output, /<image\b|data:image/i);
          assert.match(output, /<metadata>/);
          exportedVariants++;
        }
      }
    }
  }
  assert.equal(exportedVariants, 120);
});
