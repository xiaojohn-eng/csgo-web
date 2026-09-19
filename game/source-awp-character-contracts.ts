// Frozen after original AWP graph, source-frame and raw IBM validation.
// Re-frozen 2026-09-11 after merging the original looping jump_lower 9-way
// and the original non-looping Death1 full-body fall.
// Re-frozen 2026-09-11 after merging the original pin-pull preparation graph
// (Upper_GREN over Aim_GREN + HandPos_GREN) and the Shoot_GREN2/Shoot_GREN3
// medium/underhand release variants (scripts/merge-source-throw-variants.py).
export const SOURCE_AWP_CHARACTERS = {
  "t-awp": {
    "poseVersion": "csgo-t-awp-12426148:bccaba6e57bf239d",
    "manifestSha256": "df3fc0bcbae2f9107836a43722ac38ee8fb6c293c1bc597e66261cc96d154017",
    "modelSha256": "a1abe332dc23d94cd5a8d64699c5c648ebc99dbf7bb1cb3f65c04fb83168ab8e",
    "rigSha256": "6e169820d5a81922cb4b82faf2c8487073bad620a9784e13bb7bb1dabf0b70d4"
  },
  "ct-awp": {
    "poseVersion": "csgo-ct-awp-12426148:adac9c4329700e4e",
    "manifestSha256": "09e2e22c7f84f21ba45b8b9624a6e3094684579c9134737598a3ff31ebb1882d",
    "modelSha256": "fb69640610397fe8414e2f10faeb2699670e8709171d7e627de1bd2ac45eb768",
    "rigSha256": "9038ad98e81a169a6f51c59e8ea63d00f3eeded6b6f8d3035a451f0934aca2ac"
  }
} as const;

export type SourceAWPCharacterManifest={format:'source-awp-character-stage-v1';sourceApp:740;build:12426148;team:'t'|'ct';weaponId:'awp';poseVersion:string;characterProfile:'tm_leet_varianta'|'ctm_idf';sourceCharacter:string;sourceAnimation:string;sourceWorldWeapon:string;bodyBoneCount:71|74;animationBoneCount:70|71;worldBoneCount:94;metersPerSourceUnit:.0254;actorYawOffsetRadians:number;model:string;rig:string;bodyPose:string;bodyFrames:string;worldPose:string;worldFrames:string;files:{path:string;bytes:number;sha256:string}[];limitations:string[]};
