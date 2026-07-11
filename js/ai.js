const aiEngine = {
  // Ganti URL ini dengan URL Cloudflare Worker Anda setelah deploy
  _workerUrl: 'https://scanner-ai-proxy.ace-suka-main-game.workers.dev',
  _useCloudProxy: true, // Set false jika ingin langsung ke Gemini (tidak disarankan)
  
  isCloudAvailable() {
    return this._useCloudProxy && navigator.onLine;
  },

  async analyzeLocal(text) {
    return new Promise(resolve => {
      setTimeout(() => {
        let type = 'Umum';
        let summary = '';
        let structuredData = {};
        
        const lowerText = text.toLowerCase();
        
        if (lowerText.match(/faktur|invoice|total|bayar|beli|harga|struk|nota/)) {
          type = 'Dokumen Keuangan';
          structuredData = this.extractFinancialData(text);
          const itemCount = Array.isArray(structuredData.items) ? structuredData.items.length : 0;
          summary = `Dokumen ini adalah bukti transaksi. Ditemukan ${itemCount > 0 ? `${itemCount} item` : 'beberapa item'}.`;
        } else if (lowerText.match(/identitas|nama.*lahir|ttl|nik|ktp|sim|tempat.*lahir/)) {
          type = 'Kartu Identitas';
          structuredData = this.extractIdentityData(text);
          summary = 'Kartu identitas yang memuat data pribadi seseorang.';
        } else if (lowerText.match(/surat|kepada|perihal|hal\s*[:.]|dengan.*ini|tujuan/)) {
          type = 'Surat Resmi';
          structuredData = this.extractLetterData(text);
          summary = 'Dokumen surat resmi dari lembaga atau instansi.';
        } else if (lowerText.match(/skor|nilai|siswa|mahasiswa|nim|npm|ujian|penilaian/)) {
          type = 'Dokumen Akademik';
          summary = 'Dokumen yang berkaitan dengan data akademik atau pendidikan.';
        } else if (lowerText.match(/jadwal|waktu|jam|tanggal.*mulai|deadline|meeting/)) {
          type = 'Jadwal / Penjadwalan';
          summary = 'Dokumen yang berisi informasi jadwal atau rencana waktu.';
        } else {
          summary = 'Teks ditemukan namun tidak teridentifikasi sebagai format dokumen spesifik.';
        }

        structuredData.dates = this.extractDates(text);
        structuredData.phones = this.extractPhones(text);
        structuredData.emails = this.extractEmails(text);

        resolve({
          mode: 'LOCAL',
          type: type,
          summary: summary,
          structuredData: structuredData,
          fullAnalysis: this.formatLocalResult(type, summary, structuredData)
        });
      }, 400);
    });
  },

  extractFinancialData(text) {
    const prices = text.match(/(?:Rp|Rp\.|\$|USD|IDR)\s*[\d.,]+/g) || [];
    const totals = text.match(/total\s*[:.]?\s*[:.]?\s*(?:Rp|Rp\.|\$)?\s*[\d.,]+/gi) || [];
    return {
      currency: prices.length > 0 ? prices[0].replace(/[\d.,]/g, '').trim() : 'IDR',
      prices: prices.slice(0, 5),
      total: totals.length > 0 ? totals[totals.length - 1] : (prices.length > 0 ? prices[prices.length - 1] : '-'),
      items: text.match(/\d+\s*[xX*]\s*\w+/g) || []
    };
  },

  extractIdentityData(text) {
    return {
      name: (text.match(/(?:nama|name)\s*[:.]?\s*([A-Z][a-zA-Z\s]{2,})/i) || [])[1] || '-',
      nik: (text.match(/\b\d{16}\b/) || [])[0] || '-',
      ttl: (text.match(/\b\d{2}[\s-]\w+[\s-]\d{4}\b/) || [])[0] || '-'
    };
  },

  extractLetterData(text) {
    return {
      to: (text.match(/(?:kepada\s*yth\.?|to)\s*[:.]?\s*(.*)/i) || [])[1] || '-',
      subject: (text.match(/(?:perihal|hal)\s*[:.]\s*(.*)/i) || [])[1] || '-',
      date: (text.match(/\d{1,2}\s+\w+\s+\d{4}/) || [])[0] || '-'
    };
  },

  extractDates(text) {
    const datePatterns = [
      /\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/g,
      /\d{1,2}\s+(?:Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)\s+\d{4}/gi,
      /\d{4}-\d{2}-\d{2}/g
    ];
    let dates = [];
    datePatterns.forEach(p => dates.push(...text.match(p) || []));
    return [...new Set(dates)].slice(0, 3);
  },

  extractPhones(text) {
    return Array.from(text.matchAll(/(?:^|[^0-9])((?:08|\+62|62)\d{9,12})/g), (match) => match[1]).slice(0, 2);
  },

  extractEmails(text) {
    return (text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || []).slice(0, 2);
  },

  formatLocalResult(type, summary, data) {
    let output = `[ LOKAL ANALYSIS ]\nJenis: ${type}\n\n${summary}\n`;
    
    const keys = Object.keys(data).filter(k => data[k] && (Array.isArray(data[k]) ? data[k].length > 0 : true));
    if (keys.length > 0) {
      output += '\n--- Data Terstruktur ---\n';
      keys.forEach(key => {
        if (key === 'items' && Array.isArray(data[key]) && data[key].length > 0) {
          output += `- ITEMS:\n${data[key].map(item => `  \u2022 ${item}`).join('\n')}\n`;
          return;
        }
        const val = Array.isArray(data[key]) ? data[key].join(', ') : data[key];
        output += `- ${key.toUpperCase()}: ${val}\n`;
      });
    }
    
    return output;
  },

  async analyzeCloud(text) {
    if (!navigator.onLine) {
      throw new Error('Tidak ada koneksi internet.');
    }

    const prompt = `Analisis dokumen berikut secara mendalam. Berikan:
1. Jenis Dokumen
2. Ringkasan Singkat
3. Poin-Poin Penting (dalam bentuk poin)
4. Data Terstruktur (jika ada: tanggal, nama, jumlah uang, dll dalam format JSON)
Teks: ${text}`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(this._workerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!response.ok) {
        let errorMsg = 'Gagal menghubungi AI Service.';
        try {
          const err = await response.json();
          errorMsg = err.error || errorMsg;
        } catch (_) {}
        throw new Error(errorMsg);
      }

      const data = await response.json();
      const resultText = data.text || 'Tidak ada respon dari AI.';

      return {
        mode: 'CLOUD',
        type: 'Analisis Gemini AI',
        summary: 'Hasil analisis mendalam dari Google Gemini.',
        fullAnalysis: resultText
      };
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('Permintaan ke AI kehabisan waktu. Coba gunakan analisis lokal.');
      }
      throw error;
    }
  }
};
