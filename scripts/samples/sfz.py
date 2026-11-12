"""A small SFZ reader: #define macros, #include files, comment lines and the
<control>/<global>/<master>/<group>/<region> hierarchy. It returns every region
with the opcodes it inherits, which is all the sample builders need."""
import os
import re

HEADER = re.compile(r'<(\w+)>')
OPCODE = re.compile(r'([A-Za-z0-9_$]+)=')
LEVELS = ['global', 'master', 'group', 'region']


def _expand(path, defines, root=None):
    out = []
    root = root or os.path.dirname(path)
    with open(path, encoding='utf-8', errors='replace') as handle:
        for raw in handle:
            line = raw.split('//', 1)[0].rstrip()
            stripped = line.strip()
            if stripped.startswith('#define'):
                # A later #define of the same name replaces the earlier one.
                parts = stripped.split(None, 2)
                defines[parts[1]] = parts[2].strip() if len(parts) > 2 else ''
                continue
            for name, value in sorted(defines.items(), key=lambda item: -len(item[0])):
                line = line.replace(name, value)
            pieces = re.split(r'(#include\s+"[^"]+")', line)
            for piece in pieces:
                match = re.match(r'#include\s+"([^"]+)"', piece)
                if match:
                    target = os.path.join(root, match.group(1).replace('\\', '/'))
                    out.append(_expand(target, defines, root))
                else:
                    out.append(piece)
            out.append('\n')
    return ''.join(out)


def parse(path):
    # Includes are relative to the top-level file's folder.
    text = _expand(path, {})
    control = {}
    current = {level: {} for level in LEVELS}
    active = None
    regions = []

    def flush():
        if active == 'region':
            merged = {}
            for level in LEVELS:
                merged.update(current[level])
            regions.append(merged)

    position = 0
    tokens = []
    for match in re.finditer(r'<\w+>|[A-Za-z0-9_$]+=', text):
        tokens.append((match.start(), match.end(), match.group(0)))
    for index, (start, end, token) in enumerate(tokens):
        if token.startswith('<'):
            flush()
            name = token[1:-1]
            if name == 'control' or name == 'curve' or name == 'effect':
                active = name
                continue
            if name in LEVELS:
                level = LEVELS.index(name)
                for lower in LEVELS[level:]:
                    current[lower] = {}
                active = name
            else:
                active = name
            continue
        key = token[:-1]
        stop = tokens[index + 1][0] if index + 1 < len(tokens) else len(text)
        value = text[end:stop]
        if key in ('sample', 'default_path'):
            value = value.split('\n')[0].strip()
        else:
            value = value.split()[0] if value.split() else ''
        if active == 'control':
            control[key] = value
        elif active in LEVELS:
            current[active][key] = value
    flush()
    return control, regions
