"""Build a deterministic catalog; original SVG bytes and geometry stay untouched."""
from pathlib import Path
import sys
import json
import shutil
import xml.etree.ElementTree as ET

PROJECT = Path(__file__).resolve().parents[1]
ROOT = PROJECT.parent
SOURCE = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT / 'исходные материалы' / 'Библиотека компонентов'
DEST = PROJECT / 'public' / 'assets'
SLOTS = ['surface', 'yellow', 'accent', 'pink', 'ink', 'light', 'outline', 'white']
NAMES = {
    'book': ('Книга', ['книга', 'чтение', 'учеба', 'знания']),
    'wallet': ('Кошелек', ['кошелек', 'деньги', 'финансы']),
    'lamp': ('Лампа', ['лампа', 'свет', 'идея']),
    'coin': ('Монета', ['монета', 'деньги', 'доход']),
    'headphones': ('Наушники', ['наушники', 'музыка', 'звук']),
    'puzzle': ('Пазлы', ['пазл', 'пазлы', 'решение', 'команда']),
    'folder': ('Папка', ['папка', 'документы', 'работа']),
    'pen': ('Ручка', ['ручка', 'письмо', 'творчество']),
    'phone': ('Телефон', ['телефон', 'связь', 'общение']),
    'object': ('Объект', ['объект', 'предмет']),
}
GROUPS = {
    ('L', 'main', 'object'): 6344, ('L', 'background', 'object'): 6347,
    ('S', 'main', 'book'): 6335, ('S', 'main', 'pen'): 6336,
    ('S', 'main', 'folder'): 6337, ('S', 'main', 'object'): 6345,
    ('S', 'background', 'book'): 6341, ('S', 'background', 'folder'): 6342,
    ('S', 'background', 'pen'): 6343, ('S', 'background', 'object'): 6346,
}


def build():
    DEST.mkdir(parents=True, exist_ok=True)
    copied = set()

    def copy(source, filename):
        root = ET.parse(source).getroot()
        nodes = list(root.iter())
        metadata = {
            'viewBox': root.get('viewBox'),
            'raster': any(node.tag.split('}')[-1] == 'image' for node in nodes),
            'unsafe': any(
                node.tag.split('}')[-1] == 'script'
                or any(key.lower().startswith('on') for key in node.attrib)
                for node in nodes
            ),
        }
        if metadata['raster'] or metadata['unsafe']:
            raise ValueError(f'Unsafe or raster asset: {source.name}')
        shutil.copyfile(source, DEST / filename)
        copied.add(source)
        return 'assets/' + filename, metadata

    assets = []
    for asset_id, (name, tags) in NAMES.items():
        asset = {'id': asset_id, 'name': name, 'tags': tags, 'variants': {}}
        for detail in ['L', 'S']:
            asset['variants'][detail] = {}
            for role, directory in [('main', 'Главные обьекты'), ('background', 'Фоновые обьекты')]:
                group = GROUPS.get((detail, role, asset_id))
                filename = f'Group 213613{group}.svg' if group else name + '.svg'
                url, metadata = copy(SOURCE / f'{directory} {detail}' / filename, f'{asset_id}-{detail.lower()}-{role}.svg')
                asset['variants'][detail][role] = url
                if detail == 'L' and role == 'main':
                    box = [float(value) for value in metadata['viewBox'].split()]
                    asset['canonicalSize'] = {'width': box[2], 'height': box[3]}
        assets.append(asset)

    palettes = []
    for index, name in enumerate(['Сиреневая', 'Персиковая', 'Бирюзовая']):
        source = SOURCE / 'Фон L' / f'Group 213613{6332 + index}.svg'
        rects = [node for node in ET.parse(source).getroot().iter() if node.tag.split('}')[-1] == 'rect']
        colors = dict(zip(SLOTS, [node.attrib['fill'].upper() for node in rects]))
        if len(colors) != 8:
            raise ValueError('Palette must contain eight swatches')
        colors['white'] = '#FFFFFF'
        palettes.append({'id': ['lilac', 'peach', 'teal'][index], 'name': name, 'colors': colors,
                         'allowedBackgroundSlots': ['surface', 'accent', 'ink', 'white']})

    # Preserve the remaining background samples and palette cards as reference assets.
    for detail in ['L', 'S']:
        for index, source in enumerate(sorted((SOURCE / f'Фон {detail}').glob('*.svg'))):
            copy(source, f'background-reference-{detail.lower()}-{index + 1}.svg')
    expected = {p for p in SOURCE.rglob('*.svg') if 'svg-drop' not in p.parts}
    if copied != expected:
        raise ValueError(f'Unmapped library assets: {len(expected - copied)}')
    catalog = {'assets': assets, 'palettes': palettes, 'sourceColors': palettes[0]['colors']}
    (DEST / 'catalog.json').write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Prepared {len(assets)} objects, {len(palettes)} palettes, {len(copied)} unchanged SVG files.')


if __name__ == '__main__':
    build()
