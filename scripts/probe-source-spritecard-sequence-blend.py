"""Read the SpriteCard sequence-blend semantics out of the shipped client.

The rifle's smoke materials are `$dualsequence 1` / `$sequence_blend_mode 1`, and the
port's notes recorded the blend as the one unknown. It is not inferred here: the client
ships the shader's own VMT parameter documentation as strings beside the parameter
table, and it says what each mode means. This extracts those strings with their offsets
and a hash of the file, so the reading is traceable to the shipped bytes.

Run: python3 scripts/probe-source-spritecard-sequence-blend.py
"""
from __future__ import annotations
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CLIENT = ROOT / '.reference-assets/csgo-legacy/bin/stdshader_dx9_client.so'
OUT = ROOT / 'research/source-spritecard-sequence-blend.json'
# The parameter documentation the client ships for SpriteCard's own shader params. Each
# entry is the parameter name followed by its description, in the order the table holds
# them; the shader's static-combo names sit in the same block.
WANTED = ['$DUALSEQUENCE', '$SEQUENCE_BLEND_MODE', '$MAXLUMFRAMEBLEND1', '$MAXLUMFRAMEBLEND2',
          '$ZOOMANIMATESEQ2', '$BLENDFRAMES', '$STARTFADESIZE', '$ENDFADESIZE', '$ADDBASETEXTURE2',
          '$EXTRACTGREENALPHA', '$DISTANCEALPHA', '$SOFTEDGES', '$CROPFACTOR', '$OVERBRIGHTFACTOR',
          '$MULOUTPUTBYALPHA', '$OUTLINE', '$PERPARTICLEOUTLINE', '$INTENSITY']

data = CLIENT.read_bytes()
text = data.decode('latin-1')
strings = [(match.start(), match.group()) for match in re.finditer(r'[\x20-\x7e]{12,}', text)]
found: dict[str, dict] = {}
for offset, value in strings:
    for name in WANTED:
        if name in value and name not in found:
            found[name] = {'offset': offset, 'string': value}
# The two sentences that carry the semantics of the modes the shipped smoke materials use.
sentences = {}
for marker in ['defines the blend mode between the images un dual sequence particles',
               'instead of blending between animation frames for the first sequence',
               'instead of blending between animation frames for the 2nd sequence',
               'blend two separate animated sequences',
               'amount to gradually zoom between frames on the second sequence',
               'whether or not to smoothly blend between animated frames']:
    index = text.find(marker)
    if index < 0:
        raise SystemExit('The client does not document this shader parameter: ' + marker)
    sentences[marker] = {'offset': index, 'documentation': text[index:index + 200].split('..')[0]}
# The blend-mode description, verbatim and split, so the mode the materials use can be read
# off it without a paraphrase standing in for the shipped text.
blend = sentences['defines the blend mode between the images un dual sequence particles']['documentation']
body = blend.split('particles.', 1)[1]
marks = [(match.start(), match.end(), int(match.group(1))) for match in re.finditer(r'(?<!\d)([0-2])\s*=', body)]
if [mode for _, _, mode in marks] != [0, 1, 2]:
    raise SystemExit('The shipped blend-mode list does not read as modes 0..2: ' + body)
modes = [body[start:marks[index + 1][0] if index + 1 < len(marks) else len(body)]
         .split('\x00', 1)[0].strip().rstrip(',').strip()
         for index, (_, start, _) in enumerate(marks)]
combos = {name: text.find(name) for name in ['ANIMBLEND_OR_MAXLUMFRAMEBLEND1', 'bSecondSequence ? params[SEQUENCE_BLEND_MODE]->GetIntValue() : 0',
    'bBlendFrames || ( params[MAXLUMFRAMEBLEND1]->GetIntValue() != 0 )', 'bSecondSequence? params[MAXLUMFRAMEBLEND1]->GetIntValue() : 0']}
for name, offset in combos.items():
    if offset < 0:
        raise SystemExit('The client does not carry this shader branch: ' + name)
report = {
    'format': 'source-spritecard-sequence-blend-v1',
    'client': {'path': str(CLIENT.relative_to(ROOT)), 'bytes': len(data),
               'sha256': hashlib.sha256(data).hexdigest()},
    'scope': 'The shader parameter documentation the client ships beside SpriteCard\'s parameter table, '
             'and the branches that read those parameters.',
    'parameters': {name: found[name] for name in WANTED if name in found},
    'missingParameters': [name for name in WANTED if name not in found],
    'documentation': sentences,
    'sequenceBlendModes': modes,
    'sequenceBlendModeOne': modes[1],
    'branches': combos,
    'reading': {
        'blendMode': 1,
        'meaning': 'alpha from the first sequence\'s frame, rgb from the second sequence\'s frame',
        'secondSequenceFrame': 'with $maxlumframeblend2 the second sequence selects its pixels by max luminance '
                               'instead of blending between animated frames, which is the same frame twice when a '
                               'sequence holds one frame',
        'boundary': 'This reads the shipped parameter documentation and the branch conditions, not the compiled shader '
                    'assembly: it states what the client says each mode means, not a measurement of the blend itself.',
    },
}
OUT.write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
print(json.dumps(report, indent=2, ensure_ascii=False))
