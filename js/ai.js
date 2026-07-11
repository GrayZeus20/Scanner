const aiEngine = {
  getApiKey() {
    return localStorage.getItem('scanner.openai_key');
  },

  saveApiKey(key) {
    localStorage.setItem('scanner.openai_key', key);
  },

  // --- LOCAL AI: Pattern-based classification (Fast & Private) ---
  async analyzeLocal(text) {
    return new Promise(resolve => {
      setTimeout(() => {
        let type = 'Umum';
        let summary = '';
        
        const lowerText = text.toLowerCase();
        
        if (lowerText.includes('faktur') || lowerText.includes('invoice') || lowerText.includes('total')) {
          type = 'Dokumen Keuangan / Faktur';
          summary = 'Terdeteksi adanya transaksi atau total pembayaran.';
        } else if (lowerText.includes('identitas') || lowerText.includes('nama') || lowerText.includes('ttl') || lowerText.includes('nik')) {
          type = 'Dokumen Identitas';
          summary = 'Dokumen ini tampaknya berisi data pribadi seseorang.';
        } else if (lowerText.includes('surat') || lowerText.includes('hal :') || lowerText.includes('kepada yth')) {
          type = 'Surat Resmi';
          summary = 'Dokumen surat dengan format formal.';
        } else if (lowerText.includes('skor') || lowerText.includes('nilai') || lowerText.includes('siswa')) {
          type = 'Dokumen Akademik';
          summary = 'Dokumen berisi data nilai atau akademik.';
        }
        
        resolve({
          mode: 'LOCAL',
          type: type,
          summary: summary || 'Analisis lokal selesai (Tidak ada pola spesifik terdeteksi).',
          fullAnalysis: null
        });
      }, 500); // Simulate processing time
    });
  },

  // --- CLOUD AI: Smart Analysis (Requires API Key) ---
  async analyzeCloud(text) {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error('API Key belum diatur. Silakan masukkan kunci di Pengaturan.');
    }

    const prompt = `Analisis dokumen berikut secara mendalam. Berikan:
1. Jenis Dokumen
2. Ringkasan Singkat
3. Poin-Poin Penting (dalam bentuk poin)
4. Data Terstruktur (jika ada: tanggal, nama, jumlah uang, dll dalam format JSON)
Teks: ${text}`;

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: "gpt-4o-mini", // Efficient and cheap model for scanner tasks
          messages: [{ role: "user", content: prompt }]
        })
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error.message || 'Gagal menghubungi OpenAI.');
      }

      const data = await response.json();
      const resultText = data.choices[0].message.content;

      return {
        mode: 'CLOUD',
        type: 'Analisis Cerdas',
        summary: 'Hasil analisis mendalam dari AI.',
        fullAnalysis: resultText
      };
    } catch (error) {
      throw error;
    }
  }
};
