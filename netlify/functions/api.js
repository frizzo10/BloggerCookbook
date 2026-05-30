const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const { action, data, token } = JSON.parse(event.body || '{}');

    // Verify user token
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };

    if (action === 'get_recipes') {
      const { data: recipes, error } = await supabase
        .from('bc_recipes')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify({ recipes }) };
    }

    if (action === 'add_recipe') {
      const { title, cuisine, time, url, emoji } = data;
      if (!title) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Title required' }) };
      const { data: recipe, error } = await supabase
        .from('bc_recipes')
        .insert({ user_id: user.id, title, cuisine, time, url, emoji: emoji || '🍽', saves: 0, cooks: 0, clicks: 0 })
        .select().single();
      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify({ recipe }) };
    }

    if (action === 'delete_recipe') {
      const { error } = await supabase
        .from('bc_recipes')
        .delete()
        .eq('id', data.id)
        .eq('user_id', user.id);
      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (action === 'get_profile') {
      const { data: profile, error } = await supabase
        .from('bc_profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      if (error && error.code !== 'PGRST116') throw error;
      return { statusCode: 200, headers, body: JSON.stringify({ profile: profile || null }) };
    }

    if (action === 'save_widget') {
      const { widget_config } = data;
      const { error } = await supabase
        .from('bc_profiles')
        .upsert({ id: user.id, widget_config, updated_at: new Date().toISOString() });
      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (action === 'apply_revenue') {
      const { error } = await supabase
        .from('bc_profiles')
        .upsert({ id: user.id, revenue_status: 'pending', updated_at: new Date().toISOString() });
      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };

  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
