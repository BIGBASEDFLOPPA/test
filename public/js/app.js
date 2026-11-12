import {
  FORMATS,
  assembleSvg,
  createScene,
  localInterpret,
  objectSize,
  validatePalette,
} from './scene.js';

const $ = (selector) => document.querySelector(selector);
const assetsById = new Map();
const sources = new Map();
const history = [];
const future = [];
let assets = [];
let palettes = [];
let scene;
let selectedId = null;
let scaleBase = 1;
let seed = 1;
let busy = false;

function notify(message, isError = false) {
  $('#status').textContent = message;
  $('#status').classList.toggle('error', isError);
}

function palette() {
  return palettes.find((item) => item.id === scene.paletteId) || palettes[0];
}

function selectedObject() {
  return scene.objects.find((item) => item.instanceId === selectedId);
}

function checkpoint() {
  history.push(JSON.stringify(scene));
  if (history.length > 40) history.shift();
  future.length = 0;
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function resizeCanvas() {
  if (!scene) return;
  const area = $('.canvas-area');
  const ratio = Math.min((area.clientWidth - 42) / scene.width, (area.clientHeight - 42) / scene.height);
  $('#canvas-frame').style.width = `${scene.width * ratio}px`;
  $('#canvas-frame').style.height = `${scene.height * ratio}px`;
  renderSelection();
}

function renderSelection() {
  const object = selectedObject();
  const box = $('#selection-box');
  box.hidden = !object;
  $('#selection-empty').hidden = Boolean(object);
  $('#selection-controls').hidden = !object;
  if (!object) return;
  const asset = assetsById.get(object.assetId);
  const size = objectSize(asset, scene);
  const ratio = $('#canvas-frame').clientWidth / scene.width;
  Object.assign(box.style, {
    left: `${(object.x - size.width / 2) * ratio}px`,
    top: `${(object.y - size.height / 2) * ratio}px`,
    width: `${size.width * ratio}px`,
    height: `${size.height * ratio}px`,
    transform: `rotate(${object.rotation}deg)`,
  });
  $('#selected-name').textContent = asset.name;
  $('#role').value = object.role;
  $('#rotation').value = object.rotation;
  $('#rotation-value').textContent = `${object.rotation}°`;
}

function renderPalettes() {
  $('#palettes').replaceChildren(...palettes.map((item) => {
    const button = document.createElement('button');
    button.className = `palette${item.id === scene.paletteId ? ' active' : ''}`;
    const label = document.createElement('span');
    label.textContent = item.name;
    const swatches = document.createElement('span');
    swatches.className = 'swatches';
    for (const slot of ['surface', 'accent', 'yellow', 'pink', 'ink']) {
      const swatch = document.createElement('i');
      swatch.style.background = item.colors[slot];
      swatches.append(swatch);
    }
    button.append(label, swatches);
    button.onclick = () => {
      checkpoint();
      scene.paletteId = item.id;
      render();
    };
    return button;
  }));
}

function renderLibrary() {
  const query = $('#search').value.trim().toLowerCase();
  const filtered = assets.filter((asset) => [asset.name, ...asset.tags].join(' ').toLowerCase().includes(query));
  $('#asset-grid').replaceChildren(...filtered.map((asset) => {
    const button = document.createElement('button');
    button.className = 'asset-card';
    button.title = `Добавить: ${asset.name}`;
    const image = document.createElement('img');
    image.src = asset.variants[scene.detail].main;
    image.alt = '';
    const name = document.createElement('span');
    name.textContent = asset.name;
    const plus = document.createElement('b');
    plus.textContent = '+';
    button.append(image, name, plus);
    button.onclick = () => addAsset(asset.id);
    return button;
  }));
}

function renderLayers() {
  $('#layer-count').textContent = `· ${scene.objects.length}`;
  $('#layers').replaceChildren(...[...scene.objects].reverse().map((object) => {
    const button = document.createElement('button');
    button.className = `layer${object.instanceId === selectedId ? ' active' : ''}`;
    button.textContent = assetsById.get(object.assetId).name;
    const role = document.createElement('span');
    role.textContent = object.role === 'background' ? 'Фоновый' : 'Главный';
    button.append(role);
    button.onclick = () => {
      selectedId = object.instanceId;
      renderSelection();
      renderLayers();
    };
    return button;
  }));
}

function render() {
  $('#canvas').innerHTML = assembleSvg(scene, assets, sources, palette());
  $('#dimensions').textContent = `${scene.width} × ${scene.height}`;
  $('#scene-info').textContent = `${scene.objects.length} объектов · ${scene.detail} · ${palette().name}`;
  $('#undo').disabled = history.length === 0;
  $('#redo').disabled = future.length === 0;
  for (const button of document.querySelectorAll('[data-format]')) {
    const format = FORMATS.find((item) => item.id === button.dataset.format);
    button.classList.toggle('active', format.width === scene.width && format.height === scene.height);
  }
  for (const button of document.querySelectorAll('[data-detail]')) {
    button.classList.toggle('active', button.dataset.detail === scene.detail);
  }
  renderPalettes();
  renderLayers();
  resizeCanvas();
  try {
    localStorage.setItem('sostav-project', JSON.stringify({ scene, palettes }));
  } catch {
    // The current scene remains usable when browser storage is unavailable.
  }
}

function replaceComposition(ids, options = {}) {
  checkpoint();
  const paletteId = scene.paletteId;
  const previousObjects = [...scene.objects];
  scene = createScene(ids, assets, {
    width: scene.width,
    height: scene.height,
    detail: scene.detail,
    layout: $('#layout').value,
    seed: seed++,
    ...options,
  });
  scene.paletteId = paletteId;
  if (options.preserveRoles) {
    scene.objects.forEach((object, index) => {
      object.role = previousObjects[index]?.role || 'main';
    });
  }
  selectedId = null;
  resetScale();
  render();
}

function resetScale() {
  scaleBase = scene.globalScale;
  $('#scale').value = 100;
  $('#scale-value').textContent = '100%';
}

function addAsset(id) {
  if (scene.objects.length >= 12) return notify('На холсте может быть до 12 объектов.', true);
  checkpoint();
  const asset = assetsById.get(id);
  const size = objectSize(asset, scene);
  scene.objects.push({
    instanceId: crypto.randomUUID(),
    assetId: id,
    x: scene.width / 2,
    y: scene.height / 2,
    rotation: 0,
    role: 'main',
  });
  selectedId = scene.objects.at(-1).instanceId;
  if (size.width > scene.width || size.height > scene.height) {
    notify('Объект добавлен. Нажмите «Пересобрать», чтобы вписать все объекты.');
  } else {
    notify(`${asset.name}: добавлено на холст.`);
  }
  render();
}

async function compose() {
  if (busy) return;
  const text = $('#prompt').value.trim();
  if (!text) return notify('Введите заголовок, метафору или названия объектов.', true);
  busy = true;
  $('#compose').disabled = true;
  try {
    const local = localInterpret(text, assets);
    let ids = local.ids;
    let message = local.reason;
    if (!local.confident && $('#allow-ai').checked) {
      notify('Подбираем объекты: отправляется только короткий текст…');
      const response = await fetch('/api/interpret', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      ids = result.ids;
      message = result.cached ? 'Подбор из кэша: без нового вызова Cohere.' : 'Компоненты подобраны Cohere. Композиция собрана локально.';
    }
    if (!ids.length) return notify('Не нашли подходящих объектов. Попробуйте другие слова или добавьте объекты из библиотеки.', true);
    replaceComposition(ids);
    notify(message);
  } catch (error) {
    notify(error.message || 'Не удалось подобрать объекты. Библиотека доступна для ручной сборки.', true);
  } finally {
    busy = false;
    $('#compose').disabled = false;
  }
}

function editSelected(action) {
  const object = selectedObject();
  if (!object) return;
  checkpoint();
  action(object);
  render();
}

function moveLayer(direction) {
  const index = scene.objects.findIndex((object) => object.instanceId === selectedId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= scene.objects.length) return;
  checkpoint();
  [scene.objects[index], scene.objects[target]] = [scene.objects[target], scene.objects[index]];
  render();
}

function removeSelected() {
  if (!selectedObject()) return;
  checkpoint();
  scene.objects = scene.objects.filter((object) => object.instanceId !== selectedId);
  selectedId = null;
  render();
}

function validatedProject(value) {
  const candidate = value.scene;
  if (!candidate || candidate.version !== 1 || !['L', 'S'].includes(candidate.detail)) throw new Error('Неверный формат проекта.');
  const validNumber = (number) => typeof number === 'number' && Number.isFinite(number);
  if (![candidate.width, candidate.height, candidate.globalScale].every(validNumber)) throw new Error('Неверные размеры проекта.');
  if (candidate.width < 100 || candidate.width > 5000 || candidate.height < 100 || candidate.height > 5000 || candidate.globalScale <= 0 || candidate.globalScale > 10) throw new Error('Размеры проекта вне допустимого диапазона.');
  if (!Array.isArray(candidate.objects) || candidate.objects.length > 12) throw new Error('Слишком много объектов.');
  const instanceIds = new Set();
  const objects = candidate.objects.map((object) => {
    if (!assetsById.has(object.assetId) || ![object.x, object.y, object.rotation].every(validNumber) || !['main', 'background'].includes(object.role)) throw new Error('Проект содержит неверный объект.');
    const instanceId = String(object.instanceId);
    if (!/^[\w-]{1,80}$/.test(instanceId) || instanceIds.has(instanceId)) throw new Error('Неверный идентификатор объекта.');
    instanceIds.add(instanceId);
    return { instanceId, assetId: object.assetId, x: object.x, y: object.y, rotation: object.rotation, role: object.role };
  });
  if (value.palettes && (!Array.isArray(value.palettes) || value.palettes.length > 100)) {
    throw new Error('???????? ?????? ??????.');
  }
  const importedPalettes = (value.palettes || []).map(validatePalette);
  if (![...palettes, ...importedPalettes].some((item) => item.id === candidate.paletteId)) throw new Error('Не найдена палитра проекта.');
  return { scene: { version: 1, width: candidate.width, height: candidate.height, detail: candidate.detail, globalScale: candidate.globalScale, paletteId: candidate.paletteId, objects }, palettes: importedPalettes };
}

function attachControls() {
  $('#search').oninput = renderLibrary;
  $('#compose').onclick = compose;
  $('#prompt').onkeydown = (event) => { if (event.key === 'Enter') compose(); };
  document.querySelectorAll('[data-prompt]').forEach((button) => {
    button.onclick = () => { $('#prompt').value = button.dataset.prompt; compose(); };
  });
  $('#format-controls').replaceChildren(...FORMATS.map((format) => {
    const button = document.createElement('button');
    button.textContent = format.name;
    button.dataset.format = format.id;
    button.onclick = () => {
      if (scene.objects.length) replaceComposition(scene.objects.map((object) => object.assetId), { ...format, preserveRoles: true });
      else { checkpoint(); Object.assign(scene, { width: format.width, height: format.height }); render(); }
    };
    return button;
  }));
  document.querySelectorAll('[data-detail]').forEach((button) => {
    button.onclick = () => { checkpoint(); scene.detail = button.dataset.detail; render(); renderLibrary(); };
  });
  $('#reflow').onclick = () => {
    if (scene.objects.length) replaceComposition(scene.objects.map((object) => object.assetId), { preserveRoles: true });
  };
  $('#scale').onpointerdown = checkpoint;
  $('#scale').onkeydown = (event) => { if (event.key.startsWith('Arrow')) checkpoint(); };
  $('#scale').oninput = () => {
    scene.globalScale = scaleBase * Number($('#scale').value) / 100;
    $('#scale-value').textContent = `${$('#scale').value}%`;
    render();
  };
  $('#role').onchange = () => editSelected((object) => { object.role = $('#role').value; });
  $('#rotation').onpointerdown = checkpoint;
  $('#rotation').onkeydown = (event) => { if (event.key.startsWith('Arrow')) checkpoint(); };
  $('#rotation').oninput = () => {
    const object = selectedObject();
    if (object) { object.rotation = Number($('#rotation').value); render(); }
  };
  $('#duplicate').onclick = () => {
    if (scene.objects.length >= 12) return notify('Достигнут лимит 12 объектов.', true);
    editSelected((object) => {
      const copy = { ...object, instanceId: crypto.randomUUID(), x: object.x + 25, y: object.y + 25 };
      scene.objects.push(copy);
      selectedId = copy.instanceId;
    });
  };
  $('#delete').onclick = removeSelected;
  $('#backward').onclick = () => moveLayer(-1);
  $('#forward').onclick = () => moveLayer(1);
  $('#undo').onclick = () => {
    if (!history.length) return;
    future.push(JSON.stringify(scene));
    scene = JSON.parse(history.pop());
    selectedId = null;
    resetScale();
    render();
    renderLibrary();
  };
  $('#redo').onclick = () => {
    if (!future.length) return;
    history.push(JSON.stringify(scene));
    scene = JSON.parse(future.pop());
    selectedId = null;
    resetScale();
    render();
    renderLibrary();
  };
  $('#export').onclick = () => download('sostav-composition.svg', assembleSvg(scene, assets, sources, palette()), 'image/svg+xml');
  $('#save-project').onclick = () => download('sostav-project.json', JSON.stringify({ scene, palettes }, null, 2), 'application/json');
  $('#palette-example').onclick = () => download('palette-example.json', JSON.stringify(palette(), null, 2), 'application/json');
  $('#palette-import').onchange = async (event) => {
    try {
      const file = event.target.files[0];
      if (!file) return;
      if (file.size > 20000) throw new Error('Палитра должна быть меньше 20 КБ.');
      const item = validatePalette(JSON.parse(await file.text()));
      item.id = `custom-${crypto.randomUUID()}`;
      checkpoint();
      palettes.push(item);
      scene.paletteId = item.id;
      render();
      notify('Палитра загружена.');
    } catch (error) { notify(error.message, true); }
    event.target.value = '';
  };
  $('#open-project').onchange = async (event) => {
    try {
      const file = event.target.files[0];
      if (!file) return;
      if (file.size > 100000) throw new Error('Проект должен быть меньше 100 КБ.');
      const result = validatedProject(JSON.parse(await file.text()));
      checkpoint();
      for (const item of result.palettes) {
        if (!palettes.some((existing) => existing.id === item.id)) palettes.push(item);
      }
      scene = result.scene;
      selectedId = null;
      resetScale();
      render();
      renderLibrary();
      notify('Проект открыт.');
    } catch (error) { notify(error.message, true); }
    event.target.value = '';
  };
  document.addEventListener('keydown', (event) => {
    if (event.target.matches('input, textarea, select')) return;
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); removeSelected(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); $('#undo').click(); }
  });
}

function attachDragging() {
  let drag = null;
  $('#canvas').addEventListener('pointerdown', (event) => {
    const group = event.target.closest('[data-instance-id]');
    selectedId = group?.dataset.instanceId || null;
    renderSelection();
    renderLayers();
    if (!group) return;
    const object = selectedObject();
    checkpoint();
    drag = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, x: object.x, y: object.y };
    $('#canvas').setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  $('#canvas').addEventListener('pointermove', (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const ratio = scene.width / $('#canvas-frame').clientWidth;
    const object = selectedObject();
    object.x = Math.max(0, Math.min(scene.width, drag.x + (event.clientX - drag.clientX) * ratio));
    object.y = Math.max(0, Math.min(scene.height, drag.y + (event.clientY - drag.clientY) * ratio));
    render();
  });
  const finish = () => { drag = null; };
  $('#canvas').addEventListener('pointerup', finish);
  $('#canvas').addEventListener('pointercancel', finish);
  new ResizeObserver(resizeCanvas).observe($('.canvas-area'));
}

async function initialize() {
  const response = await fetch('/assets/catalog.json');
  if (!response.ok) throw new Error('Не удалось загрузить библиотеку.');
  const catalog = await response.json();
  assets = catalog.assets;
  palettes = catalog.palettes.map(validatePalette);
  assets.forEach((asset) => assetsById.set(asset.id, asset));
  await Promise.all(assets.flatMap((asset) => Object.values(asset.variants).flatMap(Object.values)).map(async (url) => {
    const result = await fetch(url);
    if (!result.ok) throw new Error('Не удалось загрузить SVG.');
    sources.set(url, await result.text());
  }));
  scene = createScene(['book', 'lamp', 'puzzle'], assets, { width: 1200, height: 630, layout: 'offset' });
  scene.paletteId = palettes[0].id;
  try {
    const saved = localStorage.getItem('sostav-project');
    if (saved) {
      const result = validatedProject(JSON.parse(saved));
      scene = result.scene;
      for (const item of result.palettes) {
        if (!palettes.some((existing) => existing.id === item.id)) {
          palettes.push(item);
        }
      }
    }
  } catch {
    // Old or damaged saved projects never prevent starting the editor.
  }
  resetScale();
  attachControls();
  attachDragging();
  renderLibrary();
  render();
  $('#asset-count').textContent = assets.length;
  notify('Начните с метафоры или добавьте объект из библиотеки.');
  try {
    const status = await (await fetch('/api/status')).json();
    $('#ai-status').textContent = status.cohereAvailable ? 'Cohere готов · только текст' : 'Локальный подбор · без API';
    $('#allow-ai').disabled = !status.cohereAvailable;
    $('#allow-ai').checked = status.cohereAvailable;
    $('#allow-ai').title = status.cohereAvailable ? 'Только для незнакомых выражений; файлы не отправляются' : 'Добавьте COHERE_TRIAL_KEY в .env и перезапустите сервер';
  } catch { notify('Сервер подбора недоступен. Ручной редактор продолжает работать.'); }
}

initialize().catch((error) => notify(error.message, true));
