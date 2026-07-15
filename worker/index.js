export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

    try {
      const body = await request.json();
      
      // Inpaint path
      if (body.type === 'inpaint') {
        if (!env.AI) return new Response(JSON.stringify({ error: 'AI binding not configured' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

        // Convert base64 to Uint8Array directly (fetch(dataURI) is not supported in Workers)
        const imageBytes = base64ToUint8Array(body.image);
        const maskBytes = base64ToUint8Array(body.mask);

        // Run Inpainting
        try {
          const aiResponse = await env.AI.run('@cf/runwayml/stable-diffusion-v1-5-inpainting', {
            prompt: "a clean patch of the surrounding area, matching textures and colors",
            image: Array.from(imageBytes),
            mask: Array.from(maskBytes)
          });

          // Handle different response types from Cloudflare AI
          let imageBytesResult;
          if (aiResponse instanceof Uint8Array) {
            imageBytesResult = aiResponse;
          } else if (aiResponse && aiResponse.image) {
            imageBytesResult = new Uint8Array(aiResponse.image);
          } else if (typeof aiResponse === 'string') {
            // Sometimes it returns base64 directly
            return new Response(JSON.stringify({ image: aiResponse }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
          } else {
            throw new Error('Unexpected AI response format');
          }
          
          const base64Image = uint8ArrayToBase64(imageBytesResult);
          return new Response(JSON.stringify({ image: `data:image/png;base64,${base64Image}` }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        } catch (aiErr) {
          throw new Error('AI processing failed: ' + aiErr.message);
        }
      }

      // Existing Text Analysis path (Groq)
      const { prompt } = body;
      if (!prompt || prompt.trim().length === 0) {
        return new Response(JSON.stringify({ error: 'Prompt tidak boleh kosong.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.GROQ_API_KEY}`
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: 'Anda adalah asisten AI yang ahli dalam menganalisis dokumen. Analisis teks OCR dengan akurat, ekstrak data terstruktur, dan berikan ringkasan yang jelas dalam bahasa Indonesia.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.3,
          max_tokens: 4096
        })
      });

      if (!response.ok) throw new Error(`Groq API error: ${response.status}`);
      const data = await response.json();
      const text = data.choices?.[0]?.message?.content || 'Tidak ada respon dari AI.';

      return new Response(JSON.stringify({ text }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
};

// Helper functions for base64 conversion
function base64ToUint8Array(base64) {
  const dataUrlRegex = /^data:image\/\w+;base64,/;
  const raw = base64.replace(dataUrlRegex, '');
  const binaryStr = atob(raw);
  const len = binaryStr.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return bytes;
}

function uint8ArrayToBase64(uint8Array) {
  let binary = '';
  const len = uint8Array.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(uint8Array[i]);
  }
  return btoa(binary);
}
