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

        // Convert base64 to Blob
        const imageRes = await fetch(body.image);
        const imageBlob = await imageRes.blob();
        
        const maskRes = await fetch(body.mask);
        const maskBlob = await maskRes.blob();

        // Run Inpainting
        const response = await env.AI.run('@cf/runwayml/stable-diffusion-v1-5-inpainting', {
          prompt: "a clean patch of the surrounding area, matching textures and colors",
          image: Array.from(new Uint8Array(await imageBlob.arrayBuffer())),
          mask: Array.from(new Uint8Array(await maskBlob.arrayBuffer()))
        });

        return new Response(JSON.stringify({ image: response }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Existing Text Analysis path (Groq)
      const { prompt } = body;
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