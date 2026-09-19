/** Frozen after native autolayer, independent Python pose and actual Three skin verification.
 * Re-frozen 2026-09-11 after merging the original looping jump_lower 9-way
 * and the original non-looping Death1 full-body fall.
 * Re-frozen 2026-09-11 after merging the original pin-pull preparation graph
 * (Upper_GREN over Aim_GREN + HandPos_GREN) and the Shoot_GREN2/Shoot_GREN3
 * medium/underhand release variants (scripts/merge-source-throw-variants.py). */
export const SOURCE_PISTOL_CHARACTERS = {
  "t-glock": {
    "manifestSha256": "e0ffd59196d272132fe8c26bb4ad38a5da450e14549dfbcd25ff41f4ecc3bbbb",
    "modelSha256": "4b5f0c520cec2584853980e991e675b888241373e5da3ff386149d04f219bf0f",
    "rigSha256": "77297e0b68e0c51574e09efcf19262fa369171457707efcf8f4abdc2be4815fb",
    "poseVersion": "csgo-t-glock-12426148:11d06bd01a7ad88f"
  },
  "t-usp": {
    "manifestSha256": "3adef13302a8b07591d20d134d62bfe4b7fb3f961ecf4dd57870088a26c2187f",
    "modelSha256": "80d39a5d99afd4e2a9eda077f3d4278bda6cef145a7739948aea166238ee4e0a",
    "rigSha256": "927e7a5f5900af6edb132909d700bac844f269aa858b0cbf8c34d0668884d4de",
    "poseVersion": "csgo-t-usp-12426148:dca710fa88aff839"
  },
  "ct-glock": {
    "manifestSha256": "9e888a42fe7385da64e88c9cc86061740744ba81bd76471763a05674701a9623",
    "modelSha256": "249364ef60f9de87fe2cdf186e2344f341d879872a969c4fc87a9302ee634cf6",
    "rigSha256": "872bf893eb73ad04409eca31a970d2516a79bd281d7d83a0c8451744efcbb935",
    "poseVersion": "csgo-ct-glock-12426148:bcdd0f1b6b453dfe"
  },
  "ct-usp": {
    "manifestSha256": "95d3be3221e7c735cf98bb352c2ed418757746b03d63903bc6eaf1d3f30eb755",
    "modelSha256": "4864cbf5b05b6ffb8f07ddc53cb4d6ef2b766586a8519da98fe293015af1863a",
    "rigSha256": "8a6a1de40a1428371ac22d7724775581a5747879f8d0863f8e86ef6604bc8688",
    "poseVersion": "csgo-ct-usp-12426148:f57a33152e6a193c"
  }
} as const;

export type SourcePistolCharacterManifest={format:'source-pistol-character-stage-v1';sourceApp:740;build:12426148;team:'t'|'ct';weaponId:'glock'|'usp';poseVersion:string;characterProfile:'tm_leet_varianta'|'ctm_idf';sourceCharacter:string;sourceAnimation:string;sourceWorldWeapon:string;bodyBoneCount:71|74;animationBoneCount:70|71;worldBoneCount:93|95;metersPerSourceUnit:.0254;actorYawOffsetRadians:number;model:string;rig:string;bodyPose:string;bodyFrames:string;worldPose:string;worldFrames:string;files:{path:string;bytes:number;sha256:string}[];limitations:string[]};
