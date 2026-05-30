const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const { title, cuisine, time, url } = JSON.parse(event.body || '{}');
    if (!title) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Title required' }) };

    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{
        role: 'user',
        content: `You are a food blogger assistant. Given a recipe title, write a short 1-sentence hook description (max 15 words) that would make someone want to cook it. No quotes.

Recipe: "${title}"${cuisine ? `\nCuisine: ${cuisine}` : ''}${time ? `\nTime: ${time}` : ''}

Reply with only the hook sentence, nothing else.`
      }],
      max_tokens: 60,
      temperature: 0.8
    });

    const hook = completion.choices[0]?.message?.content?.trim() || '';
    return { statusCode: 200, headers, body: JSON.stringify({ hook }) };

  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
