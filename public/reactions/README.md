# Reaction images

This folder is reserved for static reaction images if you want to serve them
from the app. The v1 UI stores uploaded images in browser IndexedDB.
OBS Browser Source has its own browser storage, so put PNG files here when OBS
does not see images uploaded from Chrome or Safari.

Recommended filenames:

- `normal.png`
- `joy.png`
- `surprised.png`
- `troubled.png`
- `explain.png`

Idle motion is handled by CSS animation, so it does not need a separate
blink or idle image.
