"""Compile the installed CustomWeapon pixel shader for every paint style and report
what each permutation actually reads.

The shipped composition path was exported for style 7 only. The native selector
arithmetic (`probe-source-redline-programs.py`) is deterministic:

    combined = 5*style + 50*exponentMode + 200*preview + 400*(preview&&tint) + 800*(albedoFactor<1)
    static   = combined // 5

so a non-preview style's colour pass is `static = style` and its exponent pass is
`static = style + 10`. This compiles exactly those permutations out of the same
official VCS and reads the token stream back: the sampler each pass binds, the
opcodes it uses, and the constants it declares. Nothing is inferred from a style's
name, and the already-exported style-7 pair is re-derived here and compared byte for
byte as the control.

Run: python3 scripts/probe-source-redline-style-programs.py
"""
from pathlib import Path
import hashlib
import importlib.util
import json
import re
import struct
import sys

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.reference-assets/source-exports/customweapon-style-programs'
DEFINED = ROOT / '.reference-assets/source-exports/ak47-redline-programs'
RESEARCH = ROOT / 'research/customweapon-style-programs.json'


def module(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / file)
    loaded = importlib.util.module_from_spec(spec)
    sys.modules[name] = loaded
    spec.loader.exec_module(loaded)
    return loaded


def main():
    encoding = module('style_encoding', 'inspect-source-vhv-encoding.py')
    vpk = module('style_vpk', 'inventory-source-map.py')
    OUT.mkdir(parents=True, exist_ok=True)
    index = vpk.VPKIndex(ROOT / '.reference-assets/csgo-legacy/platform/platform_pak01_dir.vpk')
    source = index.read('shaders/fxc/customweapon_ps30.vcs')
    (OUT / 'customweapon_ps30.vcs').write_bytes(source)
    # The style families are named by the game's own material tree, not invented here:
    # `paints/master.vmt` heads each family with a `// TEST <NAME> (n)` line and then
    # lists that family's own material directories.
    content = vpk.VPKIndex(ROOT / '.reference-assets/csgo-legacy/csgo/pak01_dir.vpk')
    master_path = 'materials/models/weapons/customization/paints/master.vmt'
    master = content.read(master_path).decode('utf-8', 'replace')
    families = {}
    for line in master.splitlines():
        heading = re.match(r'\s*//\s*TEST\s+(.+?)\s*\((\d+)\)\s*$', line)
        if not heading:
            continue
        directories = re.findall(r'paints[\\/]([a-z_]+)[\\/]', line)
        families[int(heading.group(2))] = dict(family=heading.group(1).strip(),
                                               directoriesFromHeading=directories)
    # The include lines that follow a heading name that family's directories.
    bodies = re.split(r'\s*//\s*TEST\s+.+?\(\d+\)\s*$', master, flags=re.MULTILINE)[1:]
    for (number, family), body in zip(sorted(families.items()), bodies):
        family['directories'] = sorted({d for d in re.findall(r'paints[\\/]([a-z_]+)[\\/]', body)})
    print('style families from the original material tree:',
          {n: f['family'] for n, f in sorted(families.items())})
    if sorted(families) != list(range(1, 9)):
        raise SystemExit('the original material tree no longer names nine style families')

    def ctab(code):
        """The program's own constant table: which sampler register holds which named
        texture, and which float constants it declares. This is where a style's real
        inputs are stated, so nothing is inferred from a style's name."""
        at = code.index(b'CTAB') + 4
        _, _, _, count, info, _, _ = struct.unpack_from('<7I', code, at)

        def text(offset):
            return code[at + offset:code.index(b'\0', at + offset)].decode()

        samplers, constants = {}, []
        for i in range(count):
            name, register_set, register, size, _, _, _ = struct.unpack_from('<I4H2I', code, at + info + 20 * i)
            if register_set == 3:
                samplers[register] = text(name)
            else:
                constants.append(dict(registerSet=register_set, register=register, count=size, name=text(name)))
        return samplers, constants

    def samplers(tokens):
        """Every sampler the program binds: the `dcl_2d sN` declarations and, as a
        second, independent reading, the sampler operand of each texture load."""
        declared, loaded = set(), set()
        for row in tokens:
            op = row[0] & 65535
            if op == 31 and len(row) > 2:
                register = row[2]
                if ((register >> 28) & 7) | ((register >> 8) & 24) == 10:
                    declared.add(register & 2047)
            elif op == 66 and len(row) > 3:
                loaded.add(row[3] & 2047)
        return declared, loaded

    def opcodes(tokens):
        return sorted({row[0] & 65535 for row in tokens})

    # The numeric token streams, so the runtime's own translator can be pointed at another
    # style's permutation without re-compiling anything from Python.
    tokenStreams = {}

    styles = {}
    for style in range(1, 10):
        passes = {}
        for pass_name, static in (('color', style), ('exponent', style + 10)):
            # Not every permutation is shipped: the compiler emits the combos the
            # shipped content reaches, so a style with no exponent permutation is
            # itself a fact about the original rather than a failure here.
            try:
                code, proof = encoding.vcs_combo(source, static, 0)
            except StopIteration:
                passes[pass_name] = dict(static=static, present=False)
                continue
            name = f'customweapon_ps30-static{static}-dynamic0'
            (OUT / f'{name}.dx9').write_bytes(code)
            (OUT / f'{name}.tokens.txt').write_text(encoding.shader_text(code))
            tokens = [list(row) for row in encoding.instructions(code).values()]
            declared, loaded = samplers(tokens)
            sampler_names, constants = ctab(code)
            tokenStreams.setdefault(str(style), {})[pass_name] = tokens
            passes[pass_name] = dict(static=static, present=True, programBytes=len(code),
                                     programSha256=hashlib.sha256(code).hexdigest(),
                                     tokenCount=len(tokens),
                                     declaredSamplers=sorted(declared), loadedSamplers=sorted(loaded),
                                     ctabSamplers={str(k): v for k, v in sorted(sampler_names.items())},
                                     ctabConstants=constants, opcodes=opcodes(tokens))
        styles[style] = passes
        def show(row):
            return 'absent' if not row['present'] else f's{row["static"]:<3d} {sorted(row["declaredSamplers"])}'
        print('style %d  color %-28s exponent %s' % (style, show(passes['color']), show(passes['exponent'])))

    # The control: the already-exported style-7 pair has to come back identical from
    # this route, or the two derivations are not the same program and neither should
    # be trusted.
    control = {}
    for name, static in (('color', 7), ('exponent', 17)):
        published = (DEFINED / f'customweapon_ps30-static{static}-dynamic0.dx9').read_bytes()
        here = (OUT / f'customweapon_ps30-static{static}-dynamic0.dx9').read_bytes()
        same = hashlib.sha256(published).hexdigest() == hashlib.sha256(here).hexdigest()
        control[name] = dict(static=static, matchesPublishedProgram=same,
                             publishedSha256=hashlib.sha256(published).hexdigest())
        print('control %-8s static %-3d identical to the published export: %s' % (name, static, same))
    if not all(row['matchesPublishedProgram'] for row in control.values()):
        raise SystemExit('the style-7 control pair did not reproduce')

    # Which samplers a style binds, per pass, is what decides whether this port can
    # compose that style from the inputs it already stages.
    distinct = {}
    for style, passes in styles.items():
        for pass_name, row in passes.items():
            if not row['present']:
                continue
            key = tuple(row['declaredSamplers'])
            distinct.setdefault(key, []).append(f'{style}{"c" if pass_name == "color" else "e"}')
    print('distinct declared-sampler sets:', {str(k): v for k, v in distinct.items()})

    # The port's own input roles, so the report can say which styles its staged inputs
    # already cover and which texture each missing slot is named after.
    staged = {0: 'ao', 1: 'paintWear', 2: 'weaponExponent', 3: 'weaponAlbedo', 5: 'gunGrunge', 8: 'pattern'}
    names = {0: 'AOSampler', 1: 'ScratchesSampler', 2: 'ExponentSampler', 3: 'BaseSampler',
             4: 'MasksSampler', 5: 'GrungeSampler', 6: 'NormalsSampler', 7: 'OSPosSampler', 8: 'PatternSampler'}
    requirements = {}
    for style, passes in sorted(styles.items()):
        needed = set()
        for row in passes.values():
            if row['present']:
                needed |= set(row['declaredSamplers'])
        missing = sorted(s for s in needed if s not in staged)
        requirements[str(style)] = dict(
            family=families.get(style, {}).get('family'),
            colorPermutation=passes['color']['present'],
            exponentPermutation=passes['exponent']['present'],
            samplers=sorted(needed),
            missingInputs=[dict(sampler=s, name=names.get(s), stagedRole=staged.get(s)) for s in missing])
        print('style %d %-22s needs %s  missing %s' % (
            style, requirements[str(style)]['family'] or '(no heading in master.vmt)',
            sorted(needed), [f's{s}={names.get(s)}' for s in missing]))

    evidence = dict(format='source-customweapon-style-programs-v1',
                    status='installed_platform_shader_compiled_per_style',
                    platformVpk=dict(path='.reference-assets/csgo-legacy/platform/platform_pak01_dir.vpk',
                                     bytes=len((ROOT / '.reference-assets/csgo-legacy/platform/'
                                                'platform_pak01_dir.vpk').read_bytes()),
                                     sha256=hashlib.sha256((ROOT / '.reference-assets/csgo-legacy/platform/'
                                                            'platform_pak01_dir.vpk').read_bytes()).hexdigest()),
                    vcsFile=dict(path='shaders/fxc/customweapon_ps30.vcs',
                                 bytes=len(source), sha256=hashlib.sha256(source).hexdigest()),
                    selectorRule='static = style + 10*exponentMode (non-preview, albedoFactor>=1)',
                    styleFamilies={str(k): v for k, v in sorted(families.items())},
                    styleFamiliesFile=dict(path=master_path,
                                           sha256=hashlib.sha256(content.read(master_path)).hexdigest()),
                    stagedInputRoles={str(k): v for k, v in staged.items()},
                    samplerNames={str(k): v for k, v in names.items()},
                    requirements=requirements,
                    control=control, styles={str(k): v for k, v in styles.items()},
                    distinctDeclaredSamplers={str(k): v for k, v in distinct.items()},
                    boundary='Compiled permutations and what their own constant tables declare. '
                             'How the original uploads a permutation\'s palette constants is not '
                             'measured here, and neither is the texture a missing slot carries.')
    (OUT / 'evidence.json').write_text(json.dumps(evidence, indent=1) + '\n')
    (OUT / 'tokens.json').write_text(json.dumps(tokenStreams) + '\n')
    RESEARCH.write_text(json.dumps(evidence, indent=1) + '\n')

    # The runtime data module: every shipped permutation's own token stream, samplers and
    # float constants, so the composition path can be pointed at another style without
    # anything being re-derived at run time.
    lines = ["// Generated from the installed platform CustomWeapon DX9 tokens.",
              "// Regenerate: python3 scripts/probe-source-redline-style-programs.py",
              "export const SOURCE_CUSTOMWEAPON_PROGRAM_VERSION =",
              "  'app740-12426148-customweapon-all-styles-token-candidate-r1';",
              "/** Every shipped permutation of the original CustomWeapon shader, by style and",
              " * pass, with the sampler registers and float constants that permutation's own",
              " * constant table declares. A style with no exponent entry has no exponent",
              " * permutation in this build. */",
              "export const SOURCE_CUSTOMWEAPON_PROGRAMS = {"]
    for style in sorted(styles, key=int):
        lines.append(f"  {style}: {{")
        for pass_name in ('color', 'exponent'):
            row = styles[style][pass_name]
            if not row['present']:
                continue
            tokens = json.dumps(tokenStreams[str(style)][pass_name], separators=(',', ':'))
            lines.append(f"    {pass_name}: {{ static: {row['static']}, "
                          f"samplers: {json.dumps(row['declaredSamplers'])}, "
                          f"constants: {json.dumps([c['register'] for c in row['ctabConstants']])}, "
                          f"tokens: {tokens} }},")
        lines.append("  },")
    lines.append("} as const;\n")
    generated = "\n".join(lines)
    (ROOT / 'game/source-customweapon-programs.ts').write_text(generated)
    print('runtime module: game/source-customweapon-programs.ts', len(generated), 'bytes')
    print('evidence:', (OUT / 'evidence.json').relative_to(ROOT))
    print('tokens:', (OUT / 'tokens.json').relative_to(ROOT))
    print('research:', RESEARCH.relative_to(ROOT))


if __name__ == '__main__':
    main()
