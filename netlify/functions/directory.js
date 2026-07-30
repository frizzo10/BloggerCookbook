// netlify/functions/directory.js
// Public, unauthenticated endpoint — serves the opt-in blogger directory.
// Deliberately separate from api.js, which requires a valid auth token for
// every action; this data is meant to be browsable by anyone, logged in or
// not, so it can't live behind that same auth check.
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const { data: profiles, error: profileErr } = await supabase
      .from('bc_profiles')
      .select('id, name, blog')
      .eq('directory_opt_in', true);
    if (profileErr) throw profileErr;
    if (!profiles || profiles.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ bloggers: [] }) };
    }

    const ids = profiles.map(p => p.id);
    const { data: recipes, error: recipeErr } = await supabase
      .from('bc_recipes')
      .select('user_id, title, cuisine, emoji, url, saves')
      .in('user_id', ids);
    if (recipeErr) throw recipeErr;

    const bloggers = profiles.map(p => {
      const own = (recipes || []).filter(r => r.user_id === p.id);
      // Top 3 by saves -- auto-selected, not a manual "featured" flag, so
      // there's nothing extra for the blogger to manage.
      const topRecipes = [...own].sort((a, b) => (b.saves || 0) - (a.saves || 0)).slice(0, 3)
        .map(r => ({ title: r.title, cuisine: r.cuisine, emoji: r.emoji, url: r.url }));
      // Cuisine tags derived from their actual recipes, not a separate
      // field the blogger has to fill in and keep in sync.
      const cuisineTags = [...new Set(own.map(r => r.cuisine).filter(Boolean))].slice(0, 4);
      return {
        name: p.name,
        blog: p.blog,
        recipeCount: own.length,
        cuisineTags,
        topRecipes,
      };
    })
    // Bloggers with zero recipes yet still show up (they opted in), but
    // sort them behind bloggers who actually have content to display.
    .sort((a, b) => b.recipeCount - a.recipeCount);

    return { statusCode: 200, headers, body: JSON.stringify({ bloggers }) };
  } catch (err) {
    console.error('[directory] error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
