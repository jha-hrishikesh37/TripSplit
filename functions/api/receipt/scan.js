export async function onRequestPost(context) {
  const apiKey = context.env?.GEMINI_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'Receipt scanning is not configured on this server (missing GEMINI_API_KEY).'
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return new Response(JSON.stringify({
      ok: false,
      error: 'Invalid receipt image payload'
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const imageBase64 = body?.imageBase64;
  const mimeType = body?.mimeType || 'image/jpeg';

  if (!imageBase64 || typeof imageBase64 !== 'string' || !imageBase64.trim() || imageBase64.length > 4000000) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'Invalid receipt image payload'
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const promptText = "You are an expert receipt parser for Indian and international restaurant bills, including crumpled or faded thermal receipts. Extract: (1) merchant/restaurant name, (2) all individual ordered food/drink/bill line items where priceRupees is the FINAL line amount (Quantity x Unit Rate, NOT the unit price if quantity > 1; include quantity in the item name like 'Garlic Naan x3' if qty > 1), and (3) taxTipRupees as the sum of all taxes and extra charges (CGST + SGST + IGST + VAT + Service Charge + Packaging/Delivery + Tip + Round Off). Do NOT include Subtotal, Net Total, or Grand Total rows inside the items array. Return strict JSON matching the schema.";

    const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: promptText },
              {
                inlineData: {
                  mimeType,
                  data: imageBase64
                }
              }
            ]
          }
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              merchant: { type: 'STRING' },
              items: {
                type: 'ARRAY',
                items: {
                  type: 'OBJECT',
                  properties: {
                    name: { type: 'STRING' },
                    priceRupees: { type: 'NUMBER' }
                  },
                  required: ['name', 'priceRupees']
                }
              },
              taxTipRupees: { type: 'NUMBER' }
            },
            required: ['items', 'taxTipRupees']
          }
        }
      })
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error('Gemini API error:', geminiRes.status, errText);
      return new Response(JSON.stringify({
        ok: false,
        error: 'Failed to parse receipt image'
      }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const data = await geminiRes.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error('Missing candidates text from Gemini response');
    }

    const parsed = JSON.parse(text);
    const rawItems = Array.isArray(parsed?.items) ? parsed.items : [];
    const filteredItems = rawItems.filter(it => it && typeof it.priceRupees === 'number' && it.priceRupees > 0);

    return new Response(JSON.stringify({
      ok: true,
      receipt: {
        merchant: parsed?.merchant || '',
        items: filteredItems,
        taxTipRupees: Math.max(0, Number(parsed?.taxTipRupees || 0))
      }
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      }
    });
  } catch {
    return new Response(JSON.stringify({
      ok: false,
      error: 'Failed to parse receipt image'
    }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
