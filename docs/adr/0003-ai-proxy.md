# ADR 0003: AI Service Proxy via Cloudflare Worker

## Status
Diterima

## Konteks
Fitur AI (analisis dokumen, hapus objek) membutuhkan akses ke Google Gemini API tanpa mengekspos API Key ke frontend.

## Keputusan
Menggunakan Cloudflare Worker sebagai proxy untuk Google Gemini API. Worker menangani:
1. **Ringkasan/Analisis Dokumen** dengan Gemini Vision API
2. **Inpainting (Hapus Objek)** — mengirimkan gambar dan mask ke servis AI

## Alternatif yang Dipertimbangkan
- **Panggil langsung Gemini dari client**: Tidak aman karena API Key terlihat di source code
- **Backend server sendiri**: Memerlukan hosting dan biaya tambahan
- **Edge Functions (Vercel/Deno)**: Berfungsi tetapi tanpa keuntungan isolasi Cloudflare

## Konsekuensi
- Memerlukan akun Cloudflare dan deployment worker terpisah
- Worker URL harus diupdate di `js/ai.js` sesuai endpoint yang di-deploy
- Saat worker tidak tersedia, fitur AI Analysis lokal masih berfungsi
