export const FORMATS = [
  { id: 'square', name: 'Квадрат', width: 1000, height: 1000 },
  { id: 'landscape', name: 'Альбомный', width: 1200, height: 630 },
  { id: 'portrait', name: 'Портретный', width: 800, height: 1200 },
];

export const PALETTE_SLOTS = Object.freeze({
  '#D7CDF5': 'surface',
  '#F9ECB0': 'yellow',
  '#AA9BF0': 'accent',
  '#F9A3AA': 'pink',
  '#7864D7': 'ink',
  '#FFE3E1': 'light',
  '#181817': 'outline',
});

const slots = Object.values(PALETTE_SLOTS);
const backgroundSlots = ['surface', 'accent', 'ink'];

export function validatePalette(value) {
  if (!value || typeof value !== 'object' || !value.colors) {
    throw new Error('Палитра должна содержать colors');
  }

  const colors = {};
  for (const slot of slots) {
    const color = value.colors[slot];
    if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) {
      throw new Error(`Неверный цвет: ${slot}`);
    }
    colors[slot] = color.toUpperCase();
  }

  const backgroundSlot = value.backgroundSlot || 'surface';
  if (!backgroundSlots.includes(backgroundSlot)) {
    throw new Error('Фон допускает только surface, accent, ink');
  }
  return {
    id: String(value.id || 'custom'),
    name: String(value.name || 'Своя палитра'),
    colors,
    backgroundSlot,
  };
}

function normalizeText(text) {
  return String(text).toLowerCase().replace(/ё/g, 'е');
}

function wordMatches(word, token) {
  let stem = word;
  if (word.length > 5) {
    stem = word.slice(0, -2);
  } else if (word.length === 5) {
    stem = word.slice(0, -1);
  }
  return token === word || (stem.length >= 4 && token.startsWith(stem));
}

export function localInterpret(text, assets) {
  const query = normalizeText(text);
  const words = query.match(/[a-zа-я0-9]+/g) || [];
  const themes = [
    {
      pattern: /уч[еёи]б|учит|образован|знан|школ|студент|экзамен/,
      tags: /книг|учеб|образован|карандаш|book|pencil|education/,
    },
    {
      pattern: /финанс|деньг|доход|бюджет|сбереж|инвест|богат|оплат/,
      tags: /деньг|монет|кошелек|финанс|money|coin|wallet|card/,
    },
    {
      pattern: /иде[яию]|вдохнов|озарен|придум|творч/,
      tags: /ламп|идея|мозг|light|idea|brain/,
    },
    {
      pattern: /связ|общен|коммуника|разговор|контакт|диалог/,
      tags: /телефон|сообщен|связ|чат|phone|message|chat/,
    },
    {
      pattern: /воедино|собрат|собир|соедин|целост|част[ьи]/,
      tags: /пазл|puzzle/,
    },
  ];
  const activeThemes = themes.filter(theme => theme.pattern.test(query));
  const matchedWords = new Set();
  const ranked = assets.map(asset => {
    const labels = [asset.id, asset.name, ...(asset.tags || [])].map(normalizeText);
    const labelTokens = labels.flatMap(label => label.split(/[^a-zа-я0-9]+/));
    let score = 0;

    for (const word of words) {
      if (word.length < 3) {
        continue;
      }
      if (labelTokens.some(token => wordMatches(word, token))) {
        score += 3;
        matchedWords.add(word);
      }
    }
    for (const theme of activeThemes) {
      if (labels.some(label => theme.tags.test(label))) {
        score += 2;
      }
    }
    return { id: asset.id, score };
  }).filter(item => item.score > 0).sort((first, second) => second.score - first.score);

  // A stray component word in an unfamiliar sentence is only a suggestion.
  // Explicit component lists and recognized themes can skip the remote adapter.
  const meaningfulWords = words.filter(word => word.length >= 3 && !['или', 'для', 'and'].includes(word));
  const explicitList = meaningfulWords.length > 0 && meaningfulWords.every(word => matchedWords.has(word));
  const confident = ranked.length > 0 && (activeThemes.length > 0 || explicitList);
  return {
    ids: ranked.slice(0, 6).map(item => item.id),
    confident,
    reason: confident
      ? 'Подобраны доступные компоненты по словам и теме.'
      : 'Не удалось уверенно сопоставить метафору. Нужна интерпретация или ручной выбор.',
  };
}

export function objectSize(asset, scene) {
  return {
    width: asset.canonicalSize.width * scene.globalScale,
    height: asset.canonicalSize.height * scene.globalScale,
  };
}

export function createScene(ids, assets, options = {}) {
  const {
    width = 1000,
    height = 1000,
    detail = 'L',
    layout = 'balanced',
    seed = 1,
  } = options;

  if (!(width > 0 && height > 0) || !Number.isFinite(width + height)) {
    throw new Error('Неверный размер холста');
  }
  if (!['L', 'S'].includes(detail) || !['balanced', 'offset', 'headline'].includes(layout)) {
    throw new Error('Неверный режим композиции');
  }
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 12) {
    throw new Error('Выберите от 1 до 12 компонентов');
  }
  const selected = ids.map(id => {
    const asset = assets.find(item => item.id === id);
    if (!asset || !(asset.canonicalSize.width > 0 && asset.canonicalSize.height > 0)) {
      throw new Error(`Неизвестный компонент: ${id}`);
    }
    return asset;
  });

  const area = {
    x: width * 0.06,
    y: height * (layout === 'headline' ? 0.32 : 0.06),
    width: width * 0.88,
    height: height * (layout === 'headline' ? 0.62 : 0.88),
  };
  const maximumWidth = Math.max(...selected.map(asset => asset.canonicalSize.width));
  const maximumHeight = Math.max(...selected.map(asset => asset.canonicalSize.height));
  let bestGrid;

  // Choose the grid with the largest shared scale. Every cell reserves a gap.
  for (let columns = 1; columns <= ids.length; columns++) {
    const rows = Math.ceil(ids.length / columns);
    const cellWidth = area.width / columns;
    const cellHeight = area.height / rows;
    const scale = Math.min(
      cellWidth * 0.78 / maximumWidth,
      cellHeight * 0.78 / maximumHeight,
    );
    if (!bestGrid || scale > bestGrid.scale) {
      bestGrid = { columns, cellWidth, cellHeight, scale };
    }
  }

  const { columns, cellWidth, cellHeight, scale } = bestGrid;
  const objects = selected.map((asset, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const rowCount = Math.min(columns, ids.length - row * columns);
    let shift = 0;
    if (layout === 'offset') {
      shift = ((row + Number(seed || 1)) % 2 ? 0.07 : -0.07) * cellWidth;
    }
    return {
      instanceId: `obj-${index + 1}`,
      assetId: asset.id,
      x: area.x + (columns - rowCount) * cellWidth / 2 + (column + 0.5) * cellWidth + shift,
      y: area.y + (row + 0.5) * cellHeight,
      rotation: 0,
      role: 'main',
    };
  });
  return {
    version: 1,
    width,
    height,
    detail,
    paletteId: 'lavender',
    globalScale: scale,
    objects,
  };
}

export function recolorSvg(svgText, palette) {
  const checked = validatePalette(palette);
  return svgText.replace(/#[0-9a-f]{6}\b/gi, hex => {
    return checked.colors[PALETTE_SLOTS[hex.toUpperCase()]] || hex;
  });
}

export function namespaceSvgIds(svgText, prefix) {
  const safePrefix = String(prefix).replace(/[^a-zA-Z0-9_-]/g, '_');
  const ids = new Map();
  svgText.replace(/\bid\s*=\s*(["'])(.*?)\1/g, (match, quote, id) => {
    ids.set(id, `${safePrefix}-${id}`);
    return match;
  });

  // Update definitions and both supported reference forms together.
  return svgText
    .replace(/\bid\s*=\s*(["'])(.*?)\1/g, (match, quote, id) => {
      return `id=${quote}${ids.get(id)}${quote}`;
    })
    .replace(/url\(\s*(["']?)#([^)'"\s]+)\1\s*\)/g, (match, quote, id) => {
      return ids.has(id) ? `url(${quote}#${ids.get(id)}${quote})` : match;
    })
    .replace(/\b((?:xlink:)?href)\s*=\s*(["'])#(.*?)\2/g, (match, attribute, quote, id) => {
      return ids.has(id) ? `${attribute}=${quote}#${ids.get(id)}${quote}` : match;
    });
}

function escapeXml(value) {
  const entities = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  };
  return String(value).replace(/[&<>"']/g, character => entities[character]);
}

export function assembleSvg(scene, assets, svgSources, palette) {
  const checked = validatePalette(palette);
  const pieces = scene.objects.map((object, index) => {
    const asset = assets.find(item => item.id === object.assetId);
    if (!asset) {
      throw new Error(`Неизвестный компонент: ${object.assetId}`);
    }
    const url = asset.variants[object.detail || scene.detail]?.[object.role || 'main'];
    const source = svgSources instanceof Map ? svgSources.get(url) : svgSources[url];
    if (typeof source !== 'string') {
      throw new Error(`Отсутствует SVG: ${url}`);
    }
    const match = source.match(/<svg\b([^>]*)>([\s\S]*?)<\/svg\s*>/i);
    if (!match || /<!DOCTYPE|<!ENTITY/i.test(source)) {
      throw new Error('Неверный SVG');
    }
    const viewBox = match[1].match(/\bviewBox\s*=\s*(["'])(.*?)\1/i)?.[2];
    if (!viewBox) {
      throw new Error('SVG должен иметь viewBox');
    }

    // Nest the original vector in its canonical box without changing geometry.
    const size = objectSize(asset, scene);
    const coloredSvg = recolorSvg(`<svg${match[1]}>${match[2]}</svg>`, checked);
    const normalizedSvg = namespaceSvgIds(coloredSvg, `asset-${index}`);
    const processed = normalizedSvg.match(/<svg\b([^>]*)>([\s\S]*?)<\/svg\s*>/i);
    const body = processed[2];
    const extraAttributes = processed[1].replace(
      /\s+(?:width|height|x|y|viewBox|preserveAspectRatio|xmlns(?::[\w-]+)?)\s*=\s*(["'])(.*?)\1/gi,
      '',
    );
    return [
      `<g data-instance-id="${escapeXml(object.instanceId)}"`,
      ` data-asset-id="${escapeXml(asset.id)}"`,
      ` transform="translate(${object.x} ${object.y}) rotate(${object.rotation || 0})">`,
      `<title>${escapeXml(asset.name)}</title>`,
      `<svg${extraAttributes} x="${-size.width / 2}" y="${-size.height / 2}"`,
      ` width="${size.width}" height="${size.height}"`,
      ` viewBox="${escapeXml(viewBox)}" preserveAspectRatio="xMidYMid meet">`,
      body,
      '</svg></g>',
    ].join('');
  });
  const metadata = escapeXml(JSON.stringify({
    version: 1,
    paletteId: checked.id,
    detail: scene.detail,
    globalScale: scene.globalScale,
  }));
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"',
    ` width="${scene.width}" height="${scene.height}"`,
    ` viewBox="0 0 ${scene.width} ${scene.height}">`,
    '<title>Векторная композиция</title>',
    `<metadata>${metadata}</metadata>`,
    `<rect width="${scene.width}" height="${scene.height}"`,
    ` fill="${checked.colors[checked.backgroundSlot]}"/>`,
    pieces.join(''),
    '</svg>',
  ].join('');
}
