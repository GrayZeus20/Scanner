# WebScanner

Aplikasi web scanner dokumen berbasis PWA dengan fitur kamera langsung, unggah file, dan konversi ke gambar/PDF. Mendukung penyimpanan lokal-only via IndexedDB.

## Fitur Utama

### Kamera & Pemindaian
- **3 Mode Flash**: Off, Auto (menyala sesaat saat capture), dan On (senter terus-menerus)
- **Switch Kamera**: Beralih antara kamera depan dan belakang dengan satu ketukan
- **Tap-to-Focus**: Ketuk di mana saja pada layar kamera untuk mengatur fokus
- **Frame Guide**: Panduan bingkai 3:4 untuk penyejajaran dokumen

### Editor Gambar
- **Manual Crop**: Pemotongan manual dengan 4 titik sudut dan kaca pembesar (magnifier)
- **Filter**: Kecerahan, Kontras, Saturasi, Ketajaman, Abu-abu, Sepia, Invert, dan Hitam-Putih (B&W)
- **Rotasi & Balik**: Putar kiri/kanan dan balik horizontal/vertikal
- **Zoom & Pan**: Kontrol zoom dengan scroll wheel atau pinch, serta navigasi gambar

### AI & OCR
- **OCR (Tesseract.js)**: Ekstrak teks dari gambar dokumen
- **Analisis AI (Gemini via Proxy)**: Identifikasi jenis dokumen, ekstrak data terstruktur (faktur, identitas, surat)
- **Hapus Objek AI (Inpaint)**: Hapus objek yang tidak diinginkan menggunakan AI

### Ekspor & Penyimpanan
- **PDF**: Simpan dokumen sebagai file PDF multi-halaman
- **PNG/JPG**: Ekspor gambar dalam format standar
- **Multi-Halaman**: Dukungan pemindaian multi-halaman dengan navigasi thumbnail
- **Riwayat**: Penyimpanan otomatis ke IndexedDB dengan pratinjau

### PWA & Aksesibilitas
- **Offline-First**: Bekerja tanpa koneksi internet setelah pertama kali dimuat
- **Dark Mode**: Mode gelap otomatis mengikuti pengaturan sistem
- **Multi-Bahasa**: Dukungan Bahasa Indonesia dan English
- **Responsif**: Tampilan optimal di perangkat mobile, tablet, dan desktop

## Struktur Proyek

```
Scanner/
├── index.html          # Halaman utama
├── manifest.json       # PWA manifest
├── sw.js              # Service Worker
├── css/
│   ├── style.css      # Gaya utama (Exaggerated Minimalism)
│   └── dark-mode.css  # Gaya dark mode
├── js/
│   ├── app.js         # Logika aplikasi utama
│   ├── camera.js      # Modul kamera dan capture
│   ├── manual-crop.js # Modul pemotongan manual
│   ├── inpaint.js     # Modul hapus objek AI
│   ├── ocr.js         # Modul OCR Tesseract
│   ├── ai.js          # Modul analisis AI Gemini
│   ├── i18n.js        # Dukungan multi-bahasa
│   ├── storage.js     # Penyimpanan IndexedDB
│   ├── pdf-export.js  # Ekspor PDF
│   └── edge-detection.js # Deteksi tepi otomatis
├── tests/
│   └── app.spec.js    # Pengujian Playwright
└── worker/            # Cloudflare Worker untuk proxy AI
```

## Instalasi & Pengembangan

### Prasyarat
- Node.js 18+
- Browser modern (Chrome, Firefox, Safari, Edge)

### Menjalankan Aplikasi
```bash
# Install dependencies untuk pengujian
npm install

# Jalankan server lokal
npx serve -l 3000 -s

# Buka http://localhost:3000
```

### Menjalankan Pengujian
```bash
# Install Playwright
npx playwright install chromium

# Jalankan semua test
npx playwright test

# Jalankan dengan UI
npx playwright test --headed
```

## Teknologi yang Digunakan

- **Frontend**: Vanilla JavaScript (tanpa framework)
- **Rendering**: Canvas API untuk manipulasi gambar
- **OCR**: Tesseract.js v5
- **AI**: Google Gemini via Cloudflare Worker Proxy
- **Penyimpanan**: IndexedDB via custom wrapper
- **PDF**: jsPDF
- **Ikon**: Lucide Icons
- **Font**: Plus Jakarta Sans
- **Pengujian**: Playwright Test

## Standar Kode

- Ikon: Gunakan SVG Lucide, bukan emoji
- Aksesibilitas: Kontras warna 4.5:1, label untuk ikon, navigasi keyboard
- Performa: Lazy loading gambar, virtualisasi daftar panjang
- Keamanan: API Key tersimpan lokal, tidak ada data dikirim ke server pihak ketiga selain AI proxy

## Lisensi

Proyek untuk keperluan akademik/pembelajaran.
