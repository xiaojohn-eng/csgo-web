/** Runtime ownership is separate from immutable conversion-time receipts. */
export function sourceMapCapabilities(manifestLimitations:readonly string[],world:{decorated:number;limitations:readonly string[]}|null){
  const legacyWorld='Original world directional bump lightmaps and secondary displacement textures pending';
  const limitations=manifestLimitations.filter(text=>text!==legacyWorld&&!(text.startsWith('Source sky clouds:')&&text.includes('still does not auto-expose')));
  if(world?.decorated===85)limitations.push(...world.limitations);
  else limitations.push('Original directional bump and secondary world material owner is disabled or not fully applied');
  return {limitations,sourceManifestLimitations:[...manifestLimitations],
    runtimeCapabilities:{worldLayers:{applied:world?.decorated===85,materials:world?.decorated??0},
      environment:{owner:'scene / WorldComposite',features:['autoExposure','sun','colorCorrectionLUT','independentSkyFog'],
        validation:'These features are implemented by the scene owner; consult its runtime audit for current enabled/ready state.'}}};
}
