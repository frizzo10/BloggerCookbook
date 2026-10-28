// cookbook.js: lets a blogger turn their own recipes into a print-ready cookbook PDF.
// Fern and BloggerCookbook share one Supabase project and one cookbook engine (Fern's Netlify functions:
// fetch-recipe, share-cookbook, cookbook-pdf-background). This function is the server-to-server bridge, because
// Fern's functions send no CORS headers and so cannot be called from bloggercookbook.com in a browser.
// Nothing is hosted or sold here: the output is a PDF file the blogger sells on their own account.
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const FERN = 'https://app.clickpickandcook.com/.netlify/functions';
const MAX_RECIPES = 40;

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json'
};
const reply = (code, obj) => ({ statusCode: code, headers, body: JSON.stringify(obj) });
const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = Math.floor(Math.random() * 16); return (c === 'x' ? r : (r % 4) + 8).toString(16);
});
const list = (v) => (Array.isArray(v) ? v : []).map((x) => String(x == null ? '' : x).trim()).filter(Boolean).slice(0, 80);
const txt = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(200, {});
  try {
    const { action, token, data = {} } = JSON.parse(event.body || '{}');
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return reply(401, { error: 'Please sign in again.' });

    // Read one of the blogger's own recipe pages into full recipe text. Only URLs saved in THEIR catalog are
    // accepted, so this cannot be used to read arbitrary pages.
    if (action === 'read_recipe') {
      const url = txt(data.url, 600);
      const { data: own } = await supabase.from('bc_recipes').select('id,title').eq('user_id', user.id).eq('url', url).limit(1);
      if (!own || !own.length) return reply(403, { error: 'That recipe is not in your catalog.' });
      const r = await fetch(`${FERN}/fetch-recipe`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return reply(502, { error: j.error || 'Could not read that page.' });
      const rec = j.recipe || j;
      const ingredients = list(rec.ingredients), instructions = list(rec.instructions);
      if (!ingredients.length || !instructions.length) return reply(422, { error: 'No ingredients or steps found on that page.' });
      return reply(200, { recipe: {
        title: txt(rec.title || own[0].title, 120), emoji: txt(rec.emoji, 8), cuisine: txt(rec.cuisine, 40),
        mealType: txt(rec.mealType, 30), time: txt(rec.time, 30), difficulty: txt(rec.difficulty, 20),
        description: txt(rec.description, 400), ingredients, instructions, notes: txt(rec.notes, 400)
      } });
    }

    // Hand the finished recipes to the shared PDF engine. Returns a jobId to poll.
    if (action === 'start_pdf') {
      const recipes = Array.isArray(data.recipes) ? data.recipes.slice(0, MAX_RECIPES) : [];
      if (recipes.length < 3) return reply(400, { error: 'Pick at least 3 recipes.' });
      if (data.rights !== true) return reply(400, { error: 'Please confirm these are your own recipes.' });
      const title = txt(data.title, 80) || 'My Cookbook';
      const author = txt(data.author, 80);
      const trim = ['8x10', '6x9', '8.5x11'].includes(data.trim) ? data.trim : '8x10';
      const sh = await fetch(`${FERN}/share-cookbook`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookbook: { name: title, recipes }, senderName: author, siteUrl: 'https://app.clickpickandcook.com' })
      });
      const sj = await sh.json().catch(() => ({}));
      const shareId = sj.url ? String(sj.url).split('/').pop() : '';
      if (!sh.ok || !/^[a-z0-9]{6,16}$/i.test(shareId)) return reply(502, { error: 'Could not prepare the cookbook.' });
      const jobId = uuid();
      const go = await fetch(`${FERN}/cookbook-pdf-background`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, shareId, token, author, trim })
      });
      if (!go.ok && go.status !== 202) return reply(502, { error: 'Could not start the PDF.' });
      return reply(200, { jobId });
    }

    if (action === 'pdf_status') {
      const jobId = txt(data.jobId, 60);
      if (!/^[0-9a-f-]{36}$/i.test(jobId)) return reply(400, { error: 'Bad job.' });
      const r = await fetch(`${FERN}/scan-circular-status?jobId=${encodeURIComponent(jobId)}`);
      return reply(200, await r.json().catch(() => ({ status: 'not_found' })));
    }

    return reply(400, { error: 'Unknown action' });
  } catch (e) {
    return reply(500, { error: e.message || 'Server error' });
  }
};
