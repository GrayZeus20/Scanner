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

## Plan batch 2 (7 request: riwayat home, back-home, import bug, reverse lock, permission helper, security, saran+execute)
- [x] 19. Home button Riwayat: `#homeHistoryBtn` di `.empty-actions` → showHistory [index.html, app.js, test]
- [x] 20. Back ke Beranda: `#homeBackBtn` header (tampil di edit+riwayat, sembunyi di home/kamera) + guard mode 'home' (peringatan data belum tersimpan: Simpan&Beranda / Buang&Beranda / Batal) [index.html, app.js guard save/discard + label per mode, i18n, camera.js visibility, test]
- [x] 21. Import bug: (a) camera.stop() jangan unhide emptyState saat historyView tampil (double-view), (b) _applyBatch clear canvas sebelum render page baru (hilangkan flash gambar lama), (c) undo/redo dikunci (`_importing`) selama proses import [app.js, camera.js, test]
- [x] 22. Permission helper: modal `#permissionModal` jelaskan izin folder Scanner sebelum `showDirectoryPicker` (Izinkan/Batal), i18n id+en [index.html, app.js pickDownloadFolder, i18n, test]
- [x] 23. Security local-only: CSP meta + referrer no-referrer; inline script → app.init (CSP tanpa unsafe-inline); sw v14→v15; audit js/ = 0 fetch (bukti: grep) [index.html, app.js, sw.js] + `.empty-actions` flex-wrap (3 tombol home)
- [x] 24. Suite hijau penuh (46 lama + test baru) — via user `!` → **50/50 passed (58.6s)**, ML+CSP lolos


## Plan batch 3 (crop preview visibility + titik pas)
- [x] 25. Titik pas: 4 lingkaran SVG `#cropDotTl/Tr/Bl/Br` di cropSvg, posisi = corner polygon persis, render di renderQuadrilateral [index.html, css/style.css, js/manual-crop.js]
- [x] 26. Handle clamp: handleOffset 27→25 (tengah handle = corner), handle visual di-clamp dalam wrapper bounds (tidak over keluar / ke-clip overflow:hidden) [js/manual-crop.js]
- [x] 27. Magnifier clamp: posisi magnifier di-clamp dalam wrapper (kiri/atas/bawah), fix magSize 120→110 (sinkron CSS width) [js/manual-crop.js]
- [x] 28. Test crop: dots ikut corner, handle tetap dalam wrapper setelah drag ke tepi [tests/crop.spec.js]
- [x] 29. sw v15→v16 + ?v= bump, suite hijau [sw.js, index.html] — bump done, crop suite 7/7 passed

## Verification gate
- npm test (playwright) harus hijau sebelum DONE
