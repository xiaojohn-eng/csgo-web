// Original Deagle character stage, frozen after independent body/world graph validation.
// Re-frozen 2026-09-11 after merging the original looping jump_lower 9-way
// and the original non-looping Death1 full-body fall.
// Re-frozen 2026-09-11 after merging the original pin-pull preparation graph
// (Upper_GREN over Aim_GREN + HandPos_GREN) and the Shoot_GREN2/Shoot_GREN3
// medium/underhand release variants (scripts/merge-source-throw-variants.py).
export const SOURCE_DEAGLE_CHARACTERS = {
  "t-deagle": {
    "poseVersion": "csgo-t-deagle-12426148:9a619fd74e0564e6",
    "manifestSha256": "1b55f58732baa7dffb17f493ce9a7f6f9cb5415cec173078a2dc234206dcd7f4",
    "modelSha256": "7832d88c18c1f6304d9f0c062bc8b2d313490187f6d95adca432c13264e97ff2",
    "rigSha256": "631e5056ba5cacaa86eb585e67466b519a234e7339400783512a1ed9aaa34d7a"
  },
  "ct-deagle": {
    "poseVersion": "csgo-ct-deagle-12426148:b57163dd89896f64",
    "manifestSha256": "d62ebc9c45b9409dabfdb8bfba2aaf6264b5a22481eb2fdf6fa6c3c24d8a15eb",
    "modelSha256": "fcaf570ef65f9efabc12d458aff3c8a38f566fc32f0e4f4d3ec0a68a63530338",
    "rigSha256": "89ea3078a3b6b0f05c68fec9950c53bd9be0c4df17a63ad978b89626e12cf24d"
  }
} as const;

export type SourceDeagleCharacterManifest={format:'source-pistol-character-stage-v1';sourceApp:740;build:12426148;team:'t'|'ct';weaponId:'deagle';poseVersion:string;characterProfile:'tm_leet_varianta'|'ctm_idf';sourceCharacter:string;sourceAnimation:string;sourceWorldWeapon:string;bodyBoneCount:71|74;animationBoneCount:70|71;worldBoneCount:93;metersPerSourceUnit:.0254;actorYawOffsetRadians:number;model:string;rig:string;bodyPose:string;bodyFrames:string;worldPose:string;worldFrames:string;files:{path:string;bytes:number;sha256:string}[];limitations:string[]};
