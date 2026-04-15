# Repository Guidelines

## Project Structure & Module Organization
`index.js` is the Electron main process entry point. `config.js` manages persisted app settings. The `preload/` directory contains the injected web-side runtime: `preload/index.js` loads feature modules from `preload/modules/`, while shared helpers live in `preload/util/`. UI assets and app icons are stored in `assets/`. Translations live in `locale/*.json`. Flatpak packaging metadata and screenshots are in `flatpak/`. GitHub Actions release automation lives in `.github/workflows/build-and-release.yml`.

## Build, Test, and Development Commands
Install dependencies with `npm ci` for a clean, lockfile-based setup.

- `npm run start` starts the app locally with Electron.
- `npm run windows:build` creates Windows packages with `electron-builder`.
- `npm run mac:build` creates macOS artifacts.
- `npm run linux:build` creates Linux release artifacts.
- `npm run linux:build-unpacked` builds an unpacked Linux app for quick inspection.
- `npm run linux:build-appimage` builds only the Linux AppImage target.

Build outputs are written to `dist/`.
