# Third-party notices and licensing scope

The root MIT license applies to original project code and documentation only. It does not relicense third-party code, reference data, game assets, names, or trademarks. Reference metadata is retained for interoperability and provenance; no ownership of Valve material is claimed.

- CS:GO, Counter-Strike, Dust II and associated artwork belong to Valve and their respective rights holders. This is an unofficial community project, not endorsed by Valve.
- Original models, maps, animations, textures, skin artwork, audio, fonts, game binaries, extracted item catalog, copied web pages and raw shader-token listings are not distributed here. Obtain necessary rights before using or distributing third-party material. Owning an installation is not a redistribution license.
- The implementation documents references to Source SDK 2013. The SDK has its own license, not MIT: https://github.com/ValveSoftware/source-sdk-2013/blob/master/LICENSE . Its license and notices govern any SDK portions or derivatives; this repository does not grant additional rights to them.
- `scripts/convert-vfont.py` uses the MIT-licensed ValveResourceFormat algorithm. Preserve `docs/licenses/ValveResourceFormat-MIT.txt`.
- npm dependencies retain their own licenses. See their package distributions and the exact versions in `package-lock.json`; they are not vendored here.
- Imported third-party UI components retain their upstream licensing. shadcn/ui: https://github.com/shadcn-ui/ui/blob/main/LICENSE.md (MIT); full notice in `docs/licenses/shadcn-ui-MIT.txt`.

See `docs/public-export.json` for the export boundary. Local reference evidence and asset-dependent tests are not a promise that a fresh clone reproduces the private asset installation.

Source SDK license and third-party notices are retained in `docs/licenses/Source-SDK-2013.txt` and `docs/licenses/Source-SDK-thirdpartylegalnotices.txt` for reference and any applicable portions.

## Public asset release (2026-09-20)

The separate GitHub Release distributes project-original resources and explicitly documented MIT/CC0 components. Original contributions use the root MIT license to the extent the project owner holds applicable rights. Microsoft Rocketbox derivative character assets retain their enclosed Microsoft MIT notice; Poly Haven components retain CC0 as documented in the map provenance. This does not license Valve-derived assets. Exact scope and file hashes: `docs/public-assets-manifest.json`.
