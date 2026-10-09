# Tasks — DeepScan + Session History + Download Center + PWA polish

## Plan checklist (approved: drifting-tinkering-newell.md)
- [x] 1. State: session model di storage.js (IDB v2: sessions/kv stores, migrasi legacy)
- [x] 2. Event registry: session:create/open/delete/rename/refresh, deepscan:run, export:save + dumpState
- [x] 3. DeepScan: js/deepscan.js (scanFile/scanDataURL/scanDirectory/batchImport, validasi tipe+ukuran)
- [x] 4. Import path (fileInput/drop) → deepscan batch, append 1 sesi, auto-create session
- [x] 5. Home: historyView = riwayat per sesi (kartu cover/nama/count/tanggal), buka/hapus/rename
- [x] 6. Guard modal: sesi terbuka + dirty → Simpan/Buang/Batal (mode open/import/new)
- [x] 7. Camera finish → session:create (1 burst = 1 sesi)
- [x] 8. Download Center: preview strip, folder row, format grid, progress, saveToFolderBtn
- [x] 9. Folder Scanner/: FS Access API + IDB dir handle, fallback anchor prefix Scanner-
- [x] 10. pdf-export.js: toPdfBlob/toImageBlob (path folder), export lama tetap fallback
- [x] 11. PWA: mobile-web-app-capable, black-translucent, launch_handler, offline badge, sw v14 + deepscan
- [x] 12. i18n id+en keys sesi/unduh/offline, t() support fungsi
- [x] 13. tests/session.spec.js (happy/edge/error)
- [x] 14. Runtime proof: node --check semua + npx playwright test (seluruh suite) — 47/47 hijau
- [x] 15. Cleanup artifact .playwright-mcp/ + worker/.wrangler/cache dari tracking — CLEANUP_OK
- [x] 16. Install button single: buang #emptyInstallBtn (index.html + initPwaInstall), test assert count=0
- [x] 17. Lang switcher compact "ID/ENG" + menu full label (ID Indonesia / Eng English), aria-selected sync, .lang-menu CSS
- [x] 18. Suite hijau setelah #16+#17 — 46/46 passed (1.1m)

## Verification gate
- npm test (playwright) harus hijau sebelum DONE
