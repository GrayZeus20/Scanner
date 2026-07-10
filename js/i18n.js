const i18n = {
  id: {
    appName: 'WebScanner',
    emptyTitle: 'Belum ada dokumen',
    emptyDesc: 'Ambil foto atau impor gambar untuk memulai',
    takePhoto: 'Ambil Foto',
    importFile: 'Impor File',
    autoCrop: 'Potong',
    filters: 'Filter',
    export: 'Simpan',
    brightness: 'Kecerahan',
    contrast: 'Kontras',
    saturation: 'Saturasi',
    sharpness: 'Ketajaman',
    grayscale: 'Abu-abu',
    bwThreshold: 'Hitam Putih',
    threshold: 'Ambang Batas',
    rotateLeft: 'Putar Kiri',
    rotateRight: 'Putar Kanan',
    flipH: 'Balik H',
    flipV: 'Balik V',
    sepia: 'Sepia',
    invert: 'Invert',
    resetFilter: 'Reset Filter',
    exportPdf: 'PDF',
    exportPdfDesc: 'Simpan sebagai dokumen PDF',
    exportPng: 'PNG',
    exportPngDesc: 'Gambar berkualitas tinggi',
    exportJpg: 'JPG',
    exportJpgDesc: 'Ukuran file lebih kecil',
    capture: 'Ambil',
    cancel: 'Batal',
    saving: 'Menyimpan...',
    saved: 'Tersimpan!',
    error: 'Terjadi kesalahan',
    permissionDenied: 'Izin kamera ditolak',
    cameraPermissionDenied: 'Izin kamera ditolak. Aktifkan akses kamera di pengaturan browser.',
    cameraNotFound: 'Kamera tidak ditemukan. Hubungkan perangkat kamera atau pilih sumber lain.',
    cameraUnsupported: 'Kamera tidak didukung di browser ini atau konteksnya tidak aman.',
    storageFull: 'Penyimpanan penuh. Hapus scan lama atau gunakan ruang yang lebih banyak.',
    noImage: 'Tidak ada gambar',
    processing: 'Memproses...',
    ocr: 'Teks (OCR)',
    copyText: 'Salin Teks',
    ocrDone: 'Teks berhasil diekstrak',
    cropSuccess: 'Berhasil dipotong',
    resetSuccess: 'Filter direset',
    confirmDelete: 'Hapus scan ini?',
  },
  en: {
    appName: 'WebScanner',
    emptyTitle: 'No document yet',
    emptyDesc: 'Take a photo or import an image to start',
    takePhoto: 'Take Photo',
    importFile: 'Import File',
    autoCrop: 'Crop',
    filters: 'Filters',
    export: 'Export',
    brightness: 'Brightness',
    contrast: 'Contrast',
    saturation: 'Saturation',
    sharpness: 'Sharpness',
    grayscale: 'Grayscale',
    bwThreshold: 'B&W',
    threshold: 'Threshold',
    rotateLeft: 'Rotate L',
    rotateRight: 'Rotate R',
    flipH: 'Flip H',
    flipV: 'Flip V',
    sepia: 'Sepia',
    invert: 'Invert',
    resetFilter: 'Reset Filters',
    exportPdf: 'PDF',
    exportPdfDesc: 'Save as PDF document',
    exportPng: 'PNG',
    exportPngDesc: 'High quality image',
    exportJpg: 'JPG',
    exportJpgDesc: 'Smaller file size',
    capture: 'Capture',
    cancel: 'Cancel',
    saving: 'Saving...',
    saved: 'Saved!',
    error: 'An error occurred',
    permissionDenied: 'Camera permission denied',
    cameraPermissionDenied: 'Camera permission denied. Please allow camera access in your browser settings.',
    cameraNotFound: 'No camera was found. Please connect a camera or choose another source.',
    cameraUnsupported: 'Camera is not supported in this browser or the context is not secure.',
    storageFull: 'Storage is full. Delete older scans or free up space.',
    noImage: 'No image',
    processing: 'Processing...',
    ocr: 'Text (OCR)',
    copyText: 'Copy Text',
    ocrDone: 'Text extracted successfully',
    cropSuccess: 'Cropped successfully',
    resetSuccess: 'Filters reset',
    confirmDelete: 'Delete this scan?',
  },
};

let currentLang = 'id';

function setLanguage(lang) {
  if (!i18n[lang]) return;
  currentLang = lang;
  const elements = document.querySelectorAll('[data-i18n]');
  elements.forEach(el => {
    const key = el.dataset.i18n;
    if (i18n[lang][key]) {
      el.textContent = i18n[lang][key];
    }
  });
}

function t(key) {
  return i18n[currentLang][key] || i18n['id'][key] || key;
}

function detectLanguage() {
  const lang = navigator.language || navigator.userLanguage || 'id';
  return lang.startsWith('id') ? 'id' : 'en';
}
