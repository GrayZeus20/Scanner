/**
 * ai.js / document-analysis.js
 * On-Device Machine Learning & Document Intelligence Engine
 * 
 * Powered by:
 * - Convolutional Neural Network (CNN): TensorFlow.js + MobileNet v2 for visual document classification
 * - Local NLP & Heuristic Rule Engine: Structured extraction for financial, identity, and official documents
 * - 100% Client-Side: 0 server dependency, 0 API costs, 100% private (no document leaves user device)
 */
const aiEngine = {
  // Flag status
  isLocalOnly: true,

  isCloudAvailable() {
    return false; // Standalone on-device engine
  },

  /**
   * Main unified analysis entry point
   * @param {string} text - OCR text
   * @param {HTMLCanvasElement|null} canvas - Current document canvas for CNN analysis
   */
  async analyze(text = '', canvas = null) {
    let cnnInfo = null;

    // 1. Run Convolutional Neural Network (CNN) visual analysis if canvas is provided
    if (canvas && typeof window.MLDetector !== 'undefined' && window.MLDetector.classifyDocument) {
      try {
        cnnInfo = await window.MLDetector.classifyDocument(canvas);
      } catch (e) {
        console.warn('CNN analysis warning:', e);
      }
    }

    // 2. Run local document heuristic & semantic extraction
    return this.analyzeLocal(text, cnnInfo);
  },

  /**
   * Analyze document using local heuristics combined with CNN visual classification
   */
  async analyzeLocal(text = '', cnnInfo = null) {
    const cleanText = (text || '').trim();
    const lowerText = cleanText.toLowerCase();

    let docType = 'Dokumen Umum';
    let summary = '';
    let structuredData = {};

    // Analyze text semantics
    if (lowerText.match(/faktur|invoice|total|bayar|beli|harga|struk|nota|subtotal|tunai|kembalian|kasir|pembayaran/)) {
      docType = 'Dokumen Keuangan (Invoice / Struk)';
      structuredData = this.extractFinancialData(cleanText);
      const itemCount = Array.isArray(structuredData.items) ? structuredData.items.length : 0;
      const totalStr = structuredData.total !== '-' ? ` senilai ${structuredData.total}` : '';
      summary = `Bukti transaksi atau pembayaran${totalStr}. Ditemukan ${itemCount > 0 ? `${itemCount} item barang/jasa` : 'rincian transaksi'}.`;

    } else if (lowerText.match(/identitas|nama.*lahir|ttl|nik|ktp|sim|paspor|tempat.*lahir|gol.*darah|warga\s*negara/)) {
      docType = 'Kartu Identitas (KTP / SIM / ID)';
      structuredData = this.extractIdentityData(cleanText);
      const nameStr = structuredData.name !== '-' ? ` atas nama ${structuredData.name}` : '';
      summary = `Dokumen identitas resmi${nameStr}.`;

    } else if (lowerText.match(/surat|kepada|perihal|hal\s*[:.]|dengan\s*hormat|nomor\s*[:.]|lampiran|dinas|instansi/)) {
      docType = 'Surat Resmi / Korespondensi';
      structuredData = this.extractLetterData(cleanText);
      summary = 'Dokumen surat resmi dari lembaga, instansi, atau korespondensi formal.';

    } else if (lowerText.match(/skor|nilai|siswa|mahasiswa|nim|npm|ujian|penilaian|transkrip|ijazah|semester|prodi/)) {
      docType = 'Dokumen Akademik (Ijazah / Transkrip)';
      summary = 'Dokumen yang berkaitan dengan catatan akademik, penilaian, atau institusi pendidikan.';

    } else if (lowerText.match(/jadwal|waktu|jam\s*\d|tanggal.*mulai|deadline|meeting|agenda|rundown/)) {
      docType = 'Jadwal / Agenda';
      summary = 'Dokumen rencana agenda, jadwal acara, atau linimasa kegiatan.';

    } else if (cleanText.length > 0) {
      summary = 'Teks berhasil diekstrak dan dianalisis secara lokal di perangkat.';
    } else {
      summary = 'Tidak ada teks OCR terdeteksi. Klasifikasi visual dilakukan oleh model CNN.';
    }

    // Common extractions
    structuredData.dates = this.extractDates(cleanText);
    structuredData.phones = this.extractPhones(cleanText);
    structuredData.emails = this.extractEmails(cleanText);

    // Incorporate CNN predictions if available
    if (cnnInfo) {
      structuredData.visualClassification = {
        kategoriCNN: cnnInfo.category,
        akurasi: Math.round(cnnInfo.confidence * 100) + '%',
        topClass: cnnInfo.topClass,
        engine: cnnInfo.engine
      };
      if (docType === 'Dokumen Umum' && cnnInfo.category) {
        docType = cnnInfo.category;
      }
    }

    const fullAnalysis = this.formatLocalResult(docType, summary, structuredData, cnnInfo);

    return {
      mode: 'LOCAL_CNN',
      type: docType,
      summary,
      cnn: cnnInfo,
      structuredData,
      fullAnalysis
    };
  },

  /**
   * Extract financial transaction data (totals, items, currency)
   */
  extractFinancialData(text) {
    const prices = text.match(/(?:Rp|Rp\.|\$|USD|IDR)\s*[\d.,]+/gi) || [];
    const totalMatch = text.match(/(?:grand\s*total|total|jumlah|tagihan|bayar|netto)\s*[:.]?\s*(?:Rp|Rp\.|\$|IDR)?\s*([\d.,]+)/i);
    const itemMatches = text.match(/\d+\s*[xX*]\s*[A-Za-z0-9\s-]{3,25}/g) || [];

    let totalVal = '-';
    if (totalMatch && totalMatch[1]) {
      totalVal = totalMatch[0].trim();
    } else if (prices.length > 0) {
      totalVal = prices[prices.length - 1];
    }

    return {
      currency: prices.length > 0 ? (prices[0].match(/Rp|\$|USD|IDR/i) || ['IDR'])[0].toUpperCase() : 'IDR',
      total: totalVal,
      prices: prices.slice(0, 5),
      items: itemMatches.slice(0, 8)
    };
  },

  /**
   * Extract identity data (NIK, Name, TTL)
   */
  extractIdentityData(text) {
    const nikMatch = text.match(/(?:nik|no|nomor)\s*[:.]?\s*(\d{16})/i) || text.match(/\b\d{16}\b/);
    const nameMatch = text.match(/(?:nama|name)\s*[:.]?\s*([A-Za-z\s]{3,35})/i);
    const ttlMatch = text.match(/(?:tempat.*tgl.*lahir|ttl|lahir)\s*[:.]?\s*([A-Za-z0-9\s,/-]{5,40})/i);

    return {
      nik: nikMatch ? (nikMatch[1] || nikMatch[0]) : '-',
      name: nameMatch ? nameMatch[1].trim() : '-',
      ttl: ttlMatch ? ttlMatch[1].trim() : '-'
    };
  },

  /**
   * Extract official letter metadata
   */
  extractLetterData(text) {
    const toMatch = text.match(/(?:kepada\s*(?:yth\.?)?|to|tujuan)\s*[:.]?\s*([A-Za-z0-9\s.,]{3,50})/i);
    const subjectMatch = text.match(/(?:perihal|hal|re)\s*[:.]\s*([A-Za-z0-9\s.,-]{3,60})/i);
    const noMatch = text.match(/(?:nomor|no\.)\s*[:.]\s*([A-Za-z0-9\s./-]{4,40})/i);

    return {
      to: toMatch ? toMatch[1].trim() : '-',
      subject: subjectMatch ? subjectMatch[1].trim() : '-',
      nomorSurat: noMatch ? noMatch[1].trim() : '-'
    };
  },

  /**
   * Extract dates formatted in Indonesian or ISO format
   */
  extractDates(text) {
    if (!text) return [];
    const datePatterns = [
      /\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b/g,
      /\b\d{1,2}\s+(?:Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember|Jan|Feb|Mar|Apr|Mei|Jun|Jul|Agu|Sep|Okt|Nov|Des)\s+\d{4}\b/gi,
      /\b\d{4}-\d{2}-\d{2}\b/g
    ];
    let dates = [];
    datePatterns.forEach(p => {
      const m = text.match(p);
      if (m) dates.push(...m);
    });
    return [...new Set(dates)].slice(0, 3);
  },

  /**
   * Extract Indonesian & international phone numbers
   */
  extractPhones(text) {
    if (!text) return [];
    const matches = Array.from(text.matchAll(/(?:^|[^0-9])((?:\+62|62|08)\d{8,12})/g), (m) => m[1]);
    return [...new Set(matches)].slice(0, 2);
  },

  /**
   * Extract emails
   */
  extractEmails(text) {
    if (!text) return [];
    const emails = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
    return [...new Set(emails)].slice(0, 2);
  },

  /**
   * Format human-readable result
   */
  formatLocalResult(type, summary, data, cnnInfo) {
    let output = `[ HASIL ANALISIS DOKUMEN ON-DEVICE ]\n`;
    output += `Tipe: ${type}\n`;

    if (cnnInfo) {
      const confPct = Math.round(cnnInfo.confidence * 100);
      output += `Model Visual: CNN MobileNet (${confPct}% - ${cnnInfo.category})\n`;
    }

    output += `\nRingkasan:\n${summary}\n`;

    const keys = Object.keys(data).filter(k => {
      if (k === 'visualClassification') return false;
      const v = data[k];
      if (Array.isArray(v)) return v.length > 0;
      return v && v !== '-';
    });

    if (keys.length > 0) {
      output += '\n--- Data Penting Terdeteksi ---\n';
      keys.forEach(k => {
        if (k === 'items' && Array.isArray(data[k])) {
          output += `• Items:\n${data[k].map(i => `   - ${i}`).join('\n')}\n`;
        } else if (Array.isArray(data[k])) {
          output += `• ${k.toUpperCase()}: ${data[k].join(', ')}\n`;
        } else {
          output += `• ${k.toUpperCase()}: ${data[k]}\n`;
        }
      });
    }

    return output;
  },

  /**
   * Backward-compatibility wrapper for any legacy call to analyzeCloud
   */
  async analyzeCloud(text, imageDataUrl = null) {
    return this.analyzeLocal(text);
  }
};

window.aiEngine = aiEngine;
