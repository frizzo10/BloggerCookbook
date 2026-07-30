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

    if (action === 'apply_referral') {
      // Referral reward: 35% revenue share (up from 30%) for 90 days,
      // fired the moment a new blogger signs up through someone's link.
      // Called once from handleSignup() right after the new blogger's own
      // profile row is created.
      const { referrerId } = data || {};
      if (!referrerId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing referrerId' }) };
      if (referrerId === user.id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Cannot refer yourself' }) };

      // Idempotency guard -- signup only fires this once per new blogger,
      // but makes double-firing harmless regardless of client retries.
      const { data: ownProfile } = await supabase.from('bc_profiles').select('referred_by').eq('id', user.id).single();
      if (ownProfile && ownProfile.referred_by) {
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true, alreadyRewarded: true }) };
      }

      // Confirm the referrer is a real, existing blogger before rewarding
      // anyone -- a stale/fabricated referrerId should just no-op quietly.
      const { data: referrerProfile } = await supabase.from('bc_profiles').select('revenue_boost_until, referral_count').eq('id', referrerId).single();
      if (!referrerProfile) {
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true, referrerNotFound: true }) };
      }

      const now = Date.now();
      const boostMs = 90 * 24 * 60 * 60 * 1000; // 3 months
      const currentUntil = referrerProfile.revenue_boost_until ? new Date(referrerProfile.revenue_boost_until).getTime() : 0;
      // Extend from whichever is later -- their current boost expiry (if
      // still active) or right now -- so repeat referrals stack instead of
      // overwriting each other.
      const newUntil = new Date(Math.max(currentUntil, now) + boostMs).toISOString();
      const newCount = (referrerProfile.referral_count || 0) + 1;

      const { error: ownErr } = await supabase.from('bc_profiles').update({ referred_by: referrerId }).eq('id', user.id);
      if (ownErr) throw ownErr;

      const { error: refErr } = await supabase.from('bc_profiles').update({ revenue_boost_until: newUntil, referral_count: newCount }).eq('id', referrerId);
      if (refErr) throw refErr;

      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, referrerBoostUntil: newUntil, referrerCount: newCount }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };

  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
