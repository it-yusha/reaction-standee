# Reaction images

This folder is reserved for optional static fallback reaction images.

The settings UI can store uploaded images in the browser. In local development,
the app also mirrors them to `.reaction-standee/assets/` through the local Vite
API so Safari, Chrome, WKWebView, and OBS-related views can share the same local
assets more easily.

GitHub Pages does not have that local API, so the public demo primarily uses the
browser's own storage for uploaded images. If you want default images to be
available without uploading them, place PNG files here using the names below.

Recommended filenames:

- `normal.png`
- `joy.png`
- `surprised.png`
- `troubled.png`
- `explain.png`

Do not commit private, paid, internal, or rights-uncleared character assets to
this folder.
