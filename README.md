# 📄 WebScanner — Smart & Private Document Scanner

[![PWA Ready](https://img.shields.io/badge/PWA-Ready-blue?logo=pwa)](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps)
[![ML](https://img.shields.io/badge/Machine%20Learning-CNN%20(MobileNet%20v2)-orange?logo=tensorflow)](https://js.tensorflow.org)
[![Privacy](https://img.shields.io/badge/Privacy-100%25%20On--Device-success)]()
[![License](https://img.shields.io/badge/License-MIT-green)]()
[![CI Pipeline](https://img.shields.io/badge/CI%20Pipeline-Passing-brightgreen)]()

A modern, production-ready, client-side web document scanner designed for **100% privacy, zero cloud costs, and full offline functionality**.

Unlike traditional scanners that upload your sensitive documents (ID cards, invoices, receipts, contracts) to cloud AI APIs, **WebScanner runs entirely in your browser using on-device Machine Learning (Convolutional Neural Networks - CNNs) and local computer vision**.

---

## ✨ Fitur Utama (Key Features)

1. **Pemindaian Kamera & Deteksi Sudut Otomatis (Auto Edge Detection)**
   - Akses kamera perangkat dengan kontrol resolusi tinggi, senter/flash, dan pergantian kamera (depan/belakang).
   - Deteksi kontur dokumen otomatis menggunakan Classical Computer Vision (Otsu Threshold, Douglas-Peucker) diperkuat oleh validasi CNN.
   - Pemotongan perspektif (Perspective Warp) untuk meluruskan dokumen secara instan.

2. **Machine Learning CNN On-Device (TensorFlow.js + MobileNet v2)**
   - Klasifikasi visual tipe dokumen (struk, surat, buku, dokumen cetak, kartu identitas) langsung di GPU/CPU browser via WebGL.
   - Penilaian kualitas dokumen (kecerahan, kontras, ketajaman).
   - **100% Privat**: Dokumen tidak pernah dikirim ke server pihak ketiga.

3. **Ekstraksi Data Terstruktur Lokal (Document Intelligence)**
   - **Dokumen Keuangan**: Ekstraksi total tagihan, mata uang, daftar harga, dan item transaksi.
   - **Kartu Identitas**: Deteksi NIK (16 digit), nama, tempat/tanggal lahir.
   - **Surat Resmi**: Ekstraksi nomor surat, perihal, tujuan/penerima, dan tanggal.
   - **Kontak & Tanggal**: Deteksi nomor telepon (+62/08), email, dan tanggal dalam format Indonesia/ISO.

4. **Penghapus Noda / Objek Lokal (Smart Digital Eraser)**
   - Hapus stempel, coretan, tanda tangan, atau noda menggunakan algoritma difusi batas digital (Telea-inspired inpainting).
   - Bekerja 100% di browser tanpa bergantung pada API Stable Diffusion cloud.

5. **OCR Teks Lokal (Tesseract.js WebAssembly)**
   - Ekstraksi teks dari gambar secara lokal menggunakan Neural Network LSTM/CNN yang terkompilasi ke WebAssembly.

6. **Ekspor Multi-Halaman ke PDF & Gambar**
   - Gabungkan beberapa halaman hasil scan menjadi satu dokumen PDF ukuran A4.
   - Ekspor dalam format PNG atau JPG berkualitas tinggi dengan rasio kompresi yang dapat diatur.

7. **PWA (Progressive Web App) & Siap Offline**
   - Service Worker (`sw.js`) dengan cache-first untuk model ML dan aset statis.
   - Dapat diinstal di Android, iOS, Windows, dan macOS seperti aplikasi native.

8. **Dukungan Dua Bahasa & Mode Gelap**
   - Bahasa Indonesia & English.
   - Mode Terang (Light) dan Gelap (Dark).

---

## 🏛️ Arsitektur Sistem (On-Device Architecture)

```
┌─────────────────────────────────────────────────────────────┐
│                 Client Browser (100% On-Device)             │
│                                                             │
│   [ Camera / File Upload ]                                  │
│              │                                              │
│              ▼                                              │
│   [ Classical CV & Edge Detection ] ◄── [ MobileNet CNN ]   │
│              │                                              │
│              ▼                                              │
│   [ Manual Crop / Perspective Warp ]                        │
│              │                                              │
│              ▼                                              │
│   [ Canvas Filters & Digital Eraser ]                       │
│              │                                              │
│              ├──────────────────────┬───────────────────┐   │
│              ▼                      ▼                   ▼   │
│   [ Tesseract.js (OCR) ]   [ Local NLP / Heuristic ] [ PDF] │
│              │                      │                       │
│              └──────────┬───────────┘                       │
│                         ▼                                   │
│              [ IndexedDB Storage ]                          │
└─────────────────────────────────────────────────────────────┘
```

---

## 🚀 Panduan Deploy Publik (Public Deployment)

Karena seluruh aplikasi berbasis **static client-side (HTML, CSS, JS)** tanpa backend server, aplikasi ini dapat di-host **100% gratis selamanya** di berbagai platform hosting statis:

### 1. GitHub Pages (Direkomendasikan)
1. Push repositori ini ke GitHub:
   ```bash
   git add .
   git commit -m "feat: production ready on-device ML scanner"
   git push origin main
   ```
2. Buka repositori Anda di GitHub -> **Settings** -> **Pages**.
3. Di bagian **Build and deployment**:
   - Source: **Deploy from a branch**
   - Branch: **main** / folder: **/ (root)**
4. Klik **Save**. Dalam 1-2 menit, situs Anda akan aktif di:
   `https://<username>.github.io/<repository-name>/`

### 2. Cloudflare Pages
1. Masuk ke dashboard Cloudflare Pages.
2. Hubungkan repositori GitHub Anda.
3. Build command: *(kosongkan)*
4. Output directory: `.`
5. Klik **Deploy site**.

### 3. Vercel / Netlify
- Cukup hubungkan repositori GitHub Anda dan pilih framework preset **Other / Static HTML**.
- Klik deploy!

---

## 🧪 Menjalankan Pengujian (Testing)

Proyek ini dilengkapi dengan 19 automated end-to-end tests menggunakan Playwright:

```bash
# Menjalankan seluruh test suite
npm test

# Menjalankan test dalam mode visual UI
npx playwright test --ui
```

---

## 🔒 Privasi & Keamanan (Privacy First)

- **Zero Cloud Leak**: Semua gambar diproses secara lokal di memori Canvas peramban pengguna.
- **Offline First**: Setelah pemuatan pertama, aplikasi tetap dapat memindai dokumen tanpa koneksi internet sama sekali.
- **Penyimpanan Lokal**: Riwayat dokumen disimpan secara aman di IndexedDB perangkat pengguna (`WebScannerDB`).

---

## 📄 Lisensi
MIT License. Bebas digunakan untuk keperluan pribadi maupun komersial.
