"""Writes the help's Shortcut reference page from the default shortcuts in the code.

Usage: python scripts/help/shortcut_list.py
Reads apps/web/src/commands/keys.ts (DEFAULT_KEYS) and the command labels in
apps/web/src/commands/appCommands.ts, and writes apps/web/public/help/pages/shortcut-list.md.
"""
import os
import re

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
KEYS = os.path.join(ROOT, 'apps/web/src/commands/keys.ts')
COMMANDS = os.path.join(ROOT, 'apps/web/src/commands/appCommands.ts')
OUT = os.path.join(ROOT, 'apps/web/public/help/pages/shortcut-list.md')

# Tool labels (tool.* commands take their names from the tool table).
TOOL_LABELS = {
    'select': 'Select', 'lasso': 'Lasso', 'line': 'Line', 'arrow': 'Arrow', 'polyline': 'Polyline', 'arc': 'Arc',
    'rect': 'Rectangle', 'ellipse': 'Ellipse', 'polygon': 'Polygon', 'cloud': 'Cloud', 'pen': 'Pen',
    'highlighter': 'Highlight', 'textHighlight': 'Text Highlight', 'eraser': 'Eraser', 'underline': 'Underline', 'strikeout': 'Strikethrough',
    'squiggly': 'Squiggly', 'text': 'Text Box', 'callout': 'Callout', 'typewriter': 'Typewriter', 'note': 'Note',
    'image': 'Image', 'flag': 'Flag', 'stamp': 'Stamp', 'snapshot': 'Snapshot', 'redaction': 'Mark for Redaction',
    'dimension': 'Dimension', 'cloudPlus': 'Cloud+', 'calibrate': 'Calibrate',
    'length': 'Length', 'polylength': 'Polylength', 'area': 'Area', 'perimeter': 'Perimeter', 'count': 'Count',
    'angle': 'Angle', 'diameter': 'Diameter', 'radius': 'Radius', 'volume': 'Volume', 'dynamicFill': 'Dynamic Fill',
    'hyperlink': 'Hyperlink', 'attachment': 'File Attachment', 'pan': 'Pan', 'zoomBox': 'Zoom',
    'dynamicZoom': 'Dynamic Zoom',
}
GROUPS = [('File', 'file.'), ('Edit', 'edit.'), ('View', 'view.'), ('Document', 'document.'), ('Tools', 'tool'), ('Window', 'window.'), ('Help', 'help.')]


def keycap(combo):
    parts = re.split(r'\+(?=.)', combo)
    # Brackets cannot sit inside [[ ]], which ends at the first ].
    faces = {'Plus': 'Plus', 'Minus': '-', '[': 'BracketLeft', ']': 'BracketRight'}
    return '+'.join(f'[[{faces.get(p, p)}]]' for p in parts)


def main():
    keys_src = open(KEYS, encoding='utf8').read()
    block = keys_src[keys_src.index('DEFAULT_KEYS'):]
    block = block[: block.index('};')]
    # Greedy to the line's last ], so a shortcut of Ctrl+] is not cut off at the bracket.
    defaults = re.findall(r"'([\w.]+)':\s*\[(.*)\]", block)
    cmd_src = open(COMMANDS, encoding='utf8').read()
    labels = dict(re.findall(r"cmd\('([\w.]+)',\s*'\w+',\s*'((?:[^'\\]|\\.)*)'", cmd_src))
    labels['edit.lock'] = 'Lock'
    labels.update({f'tool.{k}': v for k, v in TOOL_LABELS.items()})
    labels['help.docs'] = 'Help'
    out = ['# Shortcut reference', '', 'The standard keyboard shortcuts. You can change any of them: see [Keyboard shortcuts](#shortcuts).', '']
    for title, prefix in GROUPS:
        rows = [(labels.get(cid, cid), keys) for cid, keys in defaults if cid.startswith(prefix)]
        if not rows:
            continue
        out += [f'## {title}', '', '| Command | Shortcut |', '|---|---|']
        for label, keys in rows:
            combos = re.findall(r"'([^']+)'", keys)
            out.append(f"| {label.replace('…', '')} | {' or '.join(keycap(c) for c in combos)} |")
        out.append('')
    out += [
        '## While drawing',
        '',
        '| Key | Does |',
        '|---|---|',
        '| [[Esc]] | Cancel what you are drawing; press again for the Select tool |',
        '| [[Enter]] | Finish a click-by-click shape or measurement |',
        '| [[Backspace]] | Remove the last point clicked |',
        '| Hold [[Shift]] | Keep lines straight or at 45°; draw squares and circles |',
        '| Hold [[Alt]] | Don\'t snap this point |',
        '| [[Ctrl+Enter]] | Finish typing in a text box |',
        '',
    ]
    open(OUT, 'w', encoding='utf8').write('\n'.join(out))
    print('wrote', OUT)


if __name__ == '__main__':
    main()
