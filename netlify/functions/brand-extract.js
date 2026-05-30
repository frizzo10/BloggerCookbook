const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const body = JSON.parse(event.body || '{}');

    // ── MODE 1: URL extraction ──────────────────────────────
    if (body.url) {
      const url = body.url.startsWith('http') ? body.url : 'https://' + body.url;

      let html = '';
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BloggerCookbook/1.0)' },
          signal: AbortSignal.timeout(8000)
        });
        html = await res.text();
      } catch (e) {
        return { statusCode: 200, headers, body: JSON.stringify({ error: 'Could not reach that URL. Try the screenshot method instead.' }) };
      }

      // Pull inline styles, CSS custom props, and meta colors from HTML
      const colorMatches = [];
      // CSS custom properties
      const cssVarRe = /--[\w-]+\s*:\s*(#[0-9a-fA-F]{3,8}|rgb[a]?\([^)]+\))/g;
      let m;
      while ((m = cssVarRe.exec(html)) !== null) colorMatches.push(m[1]);
      // background-color / color declarations
      const bgRe = /background(?:-color)?\s*:\s*(#[0-9a-fA-F]{3,8})/g;
      while ((m = bgRe.exec(html)) !== null) colorMatches.push(m[1]);
      // hex colors generally
      const hexRe = /#([0-9a-fA-F]{6})\b/g;
      while ((m = hexRe.exec(html)) !== null) colorMatches.push('#' + m[1]);

      // Font families
      const fontMatches = [];
      const fontRe = /font-family\s*:\s*['"]?([^'",;{}]+)/gi;
      while ((m = fontRe.exec(html)) !== null) {
        const f = m[1].trim().replace(/['"]/g, '');
        if (f && !f.startsWith('var(') && f.length < 60) fontMatches.push(f);
      }

      // Dedupe and limit
      const uniqueColors = [...new Set(colorMatches)].slice(0, 40);
      const uniqueFonts = [...new Set(fontMatches)].slice(0, 10);

      // Ask Groq to intelligently pick the brand palette
      const prompt = `You are a brand color analyst. A food blogger's website has these colors found in its CSS: ${uniqueColors.join(', ')}

And these fonts: ${uniqueFonts.join(', ')}

Pick the BEST colors for their recipe widget that will match their blog. Return ONLY valid JSON, no markdown, no explanation:
{
  "bgColor": "#hex — the best background color for the widget (usually white or their light background)",
  "buttonColor": "#hex — their primary brand/accent color for the CTA button",  
  "textColor": "#hex — best text color (usually dark)",
  "borderColor": "#hex — a subtle border or secondary accent color",
  "font": "the most characteristic font name from the list, or 'Georgia' if none found",
  "confidence": "high|medium|low",
  "notes": "one sentence describing their aesthetic"
}

Choose colors that actually look good together and represent their brand. Avoid pure white (#fff) for buttonColor and pure black (#000) for bgColor unless genuinely appropriate.`;

      const completion = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300,
        temperature: 0.3
      });

      let result = completion.choices[0]?.message?.content?.trim() || '';
      result = result.replace(/```json|```/g, '').trim();

      try {
        const parsed = JSON.parse(result);
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true, ...parsed }) };
      } catch {
        return { statusCode: 200, headers, body: JSON.stringify({ error: 'Could not parse colors. Try the screenshot method.' }) };
      }
    }

    // ── MODE 2: Screenshot (base64 image) ──────────────────
    if (body.image) {
      const { image, mediaType } = body;

      const completion = await groq.chat.completions.create({
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:${mediaType};base64,${image}` }
            },
            {
              type: 'text',
              text: `You are a brand color analyst looking at a screenshot of a food blogger's website.

Identify the exact brand colors and typography. Return ONLY valid JSON, no markdown:
{
  "bgColor": "#hex — dominant background color of the site",
  "buttonColor": "#hex — primary accent/brand color used for buttons or highlights",
  "textColor": "#hex — main text color",
  "borderColor": "#hex — secondary color used for borders, dividers, or accents",
  "font": "name of the most prominent font style you see (Serif, Sans-serif, Script, etc — pick the closest standard name: Georgia, Playfair Display, DM Sans, Montserrat, Lato, etc)",
  "confidence": "high|medium|low",
  "notes": "one sentence describing their visual aesthetic"
}

Be precise with hex codes. Look carefully at button colors, link colors, and brand elements.`
            }
          ]
        }],
        max_tokens: 300,
        temperature: 0.2
      });

      let result = completion.choices[0]?.message?.content?.trim() || '';
      result = result.replace(/```json|```/g, '').trim();

      try {
        const parsed = JSON.parse(result);
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true, ...parsed }) };
      } catch {
        return { statusCode: 200, headers, body: JSON.stringify({ error: 'Could not analyze screenshot. Please try a clearer image of your blog header.' }) };
      }
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Provide url or image' }) };

  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
