"""Which original fire variants a weapon has, and what the model says about choosing between them.

A weapon model can carry several sequences for one activity (`ak47_fire1/2/3`, USP
`shoot1/2/3`, and the same in the world models), and the engine picks one per shot:
`SelectWeightedSequence` sums the weights of the sequences that match the activity and draws
against that sum. The port plays one fixed sequence today, so this reads each original view
model through the same SourceIO reader this repository already uses for the player models and
reports every sequence's activity and weight -- the data the choice is made from, with no
field named from a sequence's own name.

Run: .tools/source-binary-venv/bin/python scripts/probe-source-weapon-activities.py
"""
from pathlib import Path
import json
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.tools'))
from SourceIO.library.models.mdl.v49 import MdlV49  # noqa: E402
from SourceIO.library.shared.app_id import SteamAppId  # noqa: E402
from SourceIO.library.shared.content_manager import ContentManager  # noqa: E402
from SourceIO.library.shared.content_manager.providers.vpk_provider import VPKContentProvider  # noqa: E402
from SourceIO.library.utils import TinyPath, MemoryBuffer  # noqa: E402

OUT = ROOT / 'research/source-weapon-activities.json'
EXPORTS = ROOT / '.reference-assets/source-exports'
# The view models the port draws, named as the install names them (the USP's own view model
# is `v_pist_223`, not `v_pist_usp`).
WEAPONS = {
    'vandal': 'models/weapons/v_rif_ak47.mdl',
    'm4a4': 'models/weapons/v_rif_m4a1.mdl',
    'glock': 'models/weapons/v_pist_glock18.mdl',
    'usp': 'models/weapons/v_pist_223.mdl',
    'deagle': 'models/weapons/v_pist_deagle.mdl',
    'awp': 'models/weapons/v_snip_awp.mdl',
}
# The activities whose variants a shot chooses between.
FIRE_ACTIVITY = 'ACT_VM_PRIMARYATTACK'


def audit_for(model: str):
    """The audit this repository already read *of this same model*, found by the source model
    it records rather than by a guessed directory."""
    for path in sorted(EXPORTS.rglob('audit.json')):
        if 'section-before-' in str(path):
            continue
        try:
            document = json.loads(path.read_text())
        except (OSError, ValueError):
            continue
        sequences = document.get('sequences') or []
        if sequences and all(row.get('source_model') == model for row in sequences):
            return path, document
    return None, None


def main():
    content = ContentManager()
    content.clean()
    provider = VPKContentProvider(
        TinyPath(str(ROOT / '.reference-assets/csgo-legacy/csgo/pak01_dir.vpk')), SteamAppId.COUNTER_STRIKE_GO)
    content.add_child(provider)
    content.priority_list = [provider]

    report = {}
    for weapon, path in WEAPONS.items():
        raw = content.find_file(TinyPath(path))
        data = raw.read()
        mdl = MdlV49.from_buffer(MemoryBuffer(data))
        sequences = [dict(index=i, name=sequence.name, activity=int(sequence.activity),
                          activityName=sequence.activity_name,
                          activityWeight=int(sequence.activity_weight),
                          flags=int(sequence.flags), blendCount=int(sequence.blend_count),
                          fadeIn=float(sequence.fade_in_time), fadeOut=float(sequence.fade_out_time))
                     for i, sequence in enumerate(mdl.sequences)]
        audit_path, audit = audit_for(path)
        fire = [row for row in sequences if row['activityName'] == FIRE_ACTIVITY]
        total = sum(row['activityWeight'] for row in fire)
        report[weapon] = dict(model=path, present=True, sequences=sequences,
                              auditPath=str(audit_path.relative_to(ROOT)) if audit_path else None,
                              fireVariants=[row['name'] for row in fire],
                              fireWeights=[row['activityWeight'] for row in fire],
                              fireWeightTotal=total,
                              fireWeightsAllEqual=len({row['activityWeight'] for row in fire}) <= 1,
                              fireVariantCount=len(fire))
        print(f'{weapon:8} {len(sequences)} sequences, {len(fire)} fire variants '
              f'weights {[row["activityWeight"] for row in fire]} total {total}')
        for row in sequences:
            if row['activityName'] == FIRE_ACTIVITY:
                print(f'    fire  {row["name"]:24} activity field {row["activity"]:4d} '
                      f'weight {row["activityWeight"]:3d}')

    # Cross-check the name lists against the audits this repository already read: the model
    # has to be the same one, or nothing here applies to the port.
    checks = []
    for weapon, path in WEAPONS.items():
        audit_path, audit = audit_for(path)
        mine = [row['name'] for row in report[weapon]['sequences']]
        names = [row['name'] for row in audit['sequences']] if audit else []
        checks.append(dict(weapon=weapon, compared=bool(audit),
                           audit=str(audit_path.relative_to(ROOT)) if audit_path else None,
                           matches=names == mine, auditNames=names, modelNames=mine))
        print(f'{weapon:8} names match the audit: {names == mine}')
    report['auditCrossCheck'] = checks
    report['format'] = 'source-weapon-activities-v1'
    report['note'] = ('Sequences are read with the same SourceIO reader this repository uses for '
                      'player models. `activity` is the model\'s raw field; the activity a shot '
                      'matches is the model\'s own activity *name*, which is what the audits and '
                      'the port already key on. The weights are the model\'s `actweight`.')
    report['boundary'] = ('This reads which variants exist and what each weighs. It does not measure '
                          'the engine\'s draw itself, so whether the choice avoids repeating the '
                          'previous variant is not decided here.')
    OUT.write_text(json.dumps(report, indent=1) + '\n')

    # The runtime data the weighted choice reads: per weapon, the variants this build's own
    # model gives the fire activity, with their weights, named as the model names them.
    lines = ['/** Generated by `scripts/probe-source-weapon-activities.py` from the original',
             ' * view models. Do not edit by hand; run the script instead.',
             ' *',
             ' * A weapon model can carry several sequences for one activity, and a shot chooses',
             ' * between them by the model\'s own `actweight`: these are those sequences, named as',
             ' * the model names them, for the port to resolve against its own sequence tables.',
             ' */',
             'export const SOURCE_WEAPON_FIRE_VARIANTS = {']
    for weapon in WEAPONS:
        fire = [row for row in report[weapon]['sequences'] if row['activityName'] == FIRE_ACTIVITY]
        lines.append(f'  {weapon}: [')
        for row in fire:
            lines.append(f"    Object.freeze({{ name: {json.dumps(row['name'])}, "
                         f"weight: {row['activityWeight']} }}),")
        lines.append('  ],')
    lines.append('} as const;\n')
    module = ROOT / 'game/source-weapon-fire-variants.ts'
    module.write_text('\n'.join(lines))
    print('runtime module:', module.relative_to(ROOT), len('\n'.join(lines)), 'bytes')
    print('research:', OUT.relative_to(ROOT))


if __name__ == '__main__':
    main()
