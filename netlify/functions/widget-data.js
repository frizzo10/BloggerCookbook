const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Strips protocol, www, and any trailing path/slash so "https://www.Foo.com/"
// and "foo.com" and "http://foo.com/blog" all normalize to the same "foo.com"
// -- blog owners will type their domain inconsistently in the dashboard, and
// pages will report their URL inconsistently too, so this needs to be lenient
// on both sides of the match.
function normalizeDomain(input) {
  if (!input) return '';
  return String(input)
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0];
}

// Full-URL match (not just domain) for matching a specific recipe to a
// specific blog post -- strips protocol, www, and a trailing slash, but
// keeps the path since that's what distinguishes one recipe's post from
// another on the same blog.
function normalizeUrl(input) {
  if (!input) return '';
  return String(input)
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '');
}

exports.handler = async (event) => {
  // This runs on arbitrary third-party blogger sites, so CORS must allow
  // any origin -- there's no way to know every domain that will embed the
  // widget ahead of time. No auth token, deliberately: an anonymous visitor
  // on someone's blog has no Fern session to send.
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
    // Short cache so a blogger who edits a recipe's title sees it reflected
    // reasonably soon, but repeat page loads within the window don't all
    // hit the database.
    'Cache-Control': 'public, max-age=120',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const params = event.queryStringParameters || {};
    const blog = normalizeDomain(params.blog);
    const pageUrl = normalizeUrl(params.pageUrl);

    if (!blog) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing blog' }) };

    // Find the blogger by their registered domain. bc_profiles.blog is
    // stored however the blogger typed it at signup, so normalize both
    // sides before comparing rather than relying on an exact DB match.
    const { data: profiles, error: profileErr } = await supabase
      .from('bc_profiles')
      .select('id, blog, widget_config')
      .not('blog', 'is', null);
    if (profileErr) throw profileErr;

    const profile = (profiles || []).find(p => normalizeDomain(p.blog) === blog);
    if (!profile) {
      // Not a registered blogger domain -- nothing to show, and nothing to
      // treat as an error either (someone could have copy-pasted the embed
      // code with the wrong data-blog value).
      return { statusCode: 200, headers, body: JSON.stringify({ recipe: null, widget_config: null }) };
    }

    let recipe = null;
    if (pageUrl) {
      const { data: recipes, error: recipeErr } = await supabase
        .from('bc_recipes')
        .select('id, title, cuisine, time, emoji, url')
        .eq('user_id', profile.id);
      if (recipeErr) throw recipeErr;
      const match = (recipes || []).find(r => normalizeUrl(r.url) === pageUrl);
      if (match) {
        recipe = { title: match.title, cuisine: match.cuisine, time: match.time, emoji: match.emoji };
        // Real confirmation signal for the "missing widget" nudge on the
        // dashboard: this only runs when the widget script actually loaded
        // on a page whose URL matches a recipe -- i.e. proof the widget is
        // genuinely live there, not just a guess based on recipe age.
        // Fire-and-forget: a failure here shouldn't break serving the
        // recipe data itself.
        supabase.from('bc_recipes').update({ widget_confirmed_at: new Date().toISOString() }).eq('id', match.id).then(() => {}, () => {});
      }
    }

    let widgetConfig = null;
    try { widgetConfig = profile.widget_config ? JSON.parse(profile.widget_config) : null; } catch (e) { widgetConfig = null; }

    return { statusCode: 200, headers, body: JSON.stringify({ recipe, widget_config: widgetConfig }) };
  } catch (err) {
    console.error('widget-data error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server error' }) };
  }
};
