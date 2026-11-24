# Stack app icons (option A: yellow "s.")

The "s" is the Outfit 900 glyph, converted to an outline so it doesn't depend on the font. Colors: yellow `oklch(92% 0.17 100)`, ink `oklch(22% 0.04 300)`, pink `oklch(55% 0.22 350)`.

| File | Size | Use |
|---|---|---|
| `stack-icon.svg` | vector | Source mark: rounded square with the ink outline |
| `favicon.svg` | vector | Browser tab icon (modern browsers) |
| `favicon.ico` | 16, 32 | Browser tab fallback |
| `favicon-16.png`, `favicon-32.png` | 16, 32 | PNG favicons |
| `apple-touch-icon.png` | 180 | iPhone and iPad Home Screen (full square; iOS rounds the corners) |
| `icon-192.png`, `icon-512.png` | 192, 512 | Web app manifest, Android and desktop install |
| `icon-maskable-512.png` | 512 | Manifest `purpose: "maskable"` (the mark sits inside the safe zone so circle crops don't clip it) |

## HTML head

```html
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#fcf9ea">
```

## manifest.webmanifest

```json
{
  "name": "Stack",
  "short_name": "Stack",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#fcf9ea",
  "theme_color": "#fcf9ea",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

`#fcf9ea` is the app's cream background (`oklch(98% 0.02 95)`) written as hex, for places that don't accept OKLCH.
