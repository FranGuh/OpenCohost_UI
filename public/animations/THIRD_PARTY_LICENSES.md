# Third-Party Animation Licenses & Credits

The VRM animation assets included in this directory are sourced from third-party creators under their respective licensing terms:

## 1. fm_vrma_motion_pack_01
- **Files**:
  - `001_motion_pose.vrma` (Base idle / breathing posture)
  - `002_dogeza.vrma`
  - `003_humidai.vrma`
  - `004_hello_1.vrma` (Wake-up greeting)
  - `005_smartphone.vrma`
  - `006_drinkwater.vrma`
  - `007_gekirei.vrma`
  - `008_gatan.vrma`
- **Creator**: へすい / rerofumi ([@rerofumi](https://x.com/rerofumi))
- **License**: Creative Commons Zero v1.0 Universal (CC0 1.0) — Public Domain Dedication.
- **Summary**: Free for any use (personal or commercial), modification, and redistribution; attribution is not required.
- **Credit**: OpenCohost credits the creator anyway: "VRMA motion pack by へすい / rerofumi (@rerofumi), CC0 1.0".

## 2. VRMA_MotionPack (NOT distributed)
- **Status**: These files are **not part of this repository or of any release build**. The pack's terms prohibit raw redistribution, so `VRMA_*.vrma` is git-ignored and untracked. The maintainer keeps a private copy on their own machine for personal use only.
- **Behavior without them**: the avatar falls back to CC0 clips (see `CLIP_FALLBACKS` in `src/features/avatar-vrm/domain/vrmAnimator.ts`): greeting uses `004_hello_1`, the speech gesture uses `007_gekirei`.
- **Files (local only)**: `VRMA_01.vrma` .. `VRMA_07.vrma`
- **Creator / Copyright**: pixiv Inc. - VRoid Project
- **Terms of Use** (summary): customization and personal or commercial use are allowed with the credit "Animation credits to pixiv Inc.'s VRoid Project" (Japanese: "キャラクターアニメーション: ピクシブ株式会社 VRoidプロジェクト"). Prohibited: "Distributing these motions or their alterations without permission in a way that can be rigged or extracted". Loose `.vrma` files in a public repository or an installer are extractable, so they are not distributed without pixiv's permission (inquiry: https://www.pixiv.net/support?type=45&mode=inquiry&service=vroid-feedback).

## 3. idle.vrma (CC0, creator unidentified)
- **File**: `idle.vrma` (base idle loop)
- **License**: CC0 1.0 per the maintainer (2026-11-16).
- **Origin**: exported with the VRM Add-on for Blender v3.17.1 (glTF `asset.generator`). It does not match the CC0 pack above (UniGLTF) or the VRoid pack (THREE.GLTFExporter). The original creator has not been identified.
- **Status**: distributed by owner decision (2026-11-16). If the creator is found, credit them here; if the CC0 status cannot be confirmed, replace it with a CC0 or first-party idle.
