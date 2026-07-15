# ADR 0002: Implementasi Kamera dengan 3-Mode Flash

## Status
Diterima

## Konteks
Fitur pemindaian dokumen memerlukan akses kamera yang optimal dalam berbagai kondisi pencahayaan.

## Keputusan
Mengimplementasikan sistem flash 3-mode:
1. **Off**: Tanpa penerangan tambahan
2. **Auto**: Torch menyala sesaat (80ms) saat menekan tombol capture
3. **On**: Torch menyala terus menerus sebagai senter

## Alasan
- Memberikan fleksibilitas pengguna dalam kondisi cahaya berbeda
- Mode Auto meniru perilaku kamera native smartphone
- Mode On membantu pengguna melihat dokumen dalam kondisi gelap

## Konsekuensi
- Pengguna perlu dibiasakan dengan ikon "A" pada mode Auto
- Konsumsi baterai lebih tinggi pada mode On
- Kompatibilitas tergantung pada dukungan hardware perangkat (torch capability)
