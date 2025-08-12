// api/[...supabase].js
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if(!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY){
  console.warn('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in environment.');
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// helper: extract route parts from req.query.slug (Vercel returns array)
function getRouteParts(req) {
  const slug = req.query?.supabase || req.query?.slug || req.query?.['...supabase'];
  // depending on server, query name might differ; try fallback.
  let parts = [];
  if (Array.isArray(slug)) parts = slug;
  else if (typeof slug === 'string') parts = [slug];
  else if (req.url) parts = req.url.split('/').filter(Boolean).slice(1); // fallback
  return parts;
}

export default async function handler(req, res) {
  // Vercel supplies params differently; we can also parse req.url
  // Determine path
  const url = req.url || '';
  const path = url.replace(/^\/api\/?/, '');
  // Simple router
  try {
    // Data routes
    if (req.method === 'GET' && path.startsWith('supabase/data/site')) {
      const { data, error } = await supabaseAdmin.from('settings').select('*').limit(1).single();
      if (error && error.code !== 'PGRST116') return res.status(500).json({ error: error.message || error });
      return res.status(200).json(data || { title:'Gorilla Hub', about:'Welcome' });
    }

    if (req.method === 'GET' && path.startsWith('supabase/data/tutorials')) {
      const { data, error } = await supabaseAdmin.from('tutorials').select('*').order('title', { ascending: true });
      if (error) return res.status(500).json({ error: error.message || error });
      return res.status(200).json(data);
    }

    if (req.method === 'GET' && path.startsWith('supabase/data/cosmetics')) {
      const { data, error } = await supabaseAdmin.from('cosmetics').select('*').order('name', { ascending:true });
      if (error) return res.status(500).json({ error: error.message || error });
      return res.status(200).json(data);
    }

    // sync_user: ensure there is a users row for this auth user (frontend calls this after signUp or signIn)
    if (req.method === 'POST' && path.startsWith('supabase/data/sync_user')) {
      const authHeader = req.headers.authorization || '';
      const token = authHeader.replace('Bearer ', '') || null;
      // get user info via service client
      if(!token) return res.status(400).json({ error:'Missing token' });
      const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
      if(userErr) return res.status(401).json({ error: 'Invalid token' });
      const user = userData.user;
      if(!user) return res.status(404).json({ error:'User not found' });
      // upsert into users table
      const { email } = req.body || {};
      const row = { id: user.id, email: user.email || email || '', role: 'user', name: user.user_metadata?.full_name || user.email?.split('@')[0] };
      const { error: upErr } = await supabaseAdmin.from('users').upsert(row, { onConflict: ['id'] });
      if(upErr) return res.status(500).json({ error: upErr.message || upErr });
      return res.status(200).json({ ok:true });
    }

    // me: return user row from users table for current token
    if (req.method === 'GET' && path.startsWith('supabase/data/me')) {
      const authHeader = req.headers.authorization || '';
      const token = authHeader.replace('Bearer ', '') || null;
      if(!token) return res.status(401).json({ error:'Not authenticated' });
      const { data:userData, error:userErr } = await supabaseAdmin.auth.getUser(token);
      if(userErr) return res.status(401).json({ error:'Invalid token' });
      const id = userData.user.id;
      const { data, error } = await supabaseAdmin.from('users').select('*').eq('id', id).maybeSingle();
      if(error) return res.status(500).json({ error:error.message || error });
      return res.status(200).json(data || { id, email:userData.user.email, role:'user', name: userData.user.email?.split('@')[0] || 'User' });
    }

    // Admin update endpoint (writes). Path: POST /api/supabase/admin/update
    if (req.method === 'POST' && path.startsWith('supabase/admin/update')) {
      const authHeader = req.headers.authorization || '';
      const token = authHeader.replace('Bearer ', '') || null;
      if(!token) return res.status(401).json({ error:'Missing token' });
      // verify token -> get user id from Supabase
      const { data: ud, error: ue } = await supabaseAdmin.auth.getUser(token);
      if (ue || !ud.user) return res.status(401).json({ error: 'Invalid token' });
      const uid = ud.user.id;
      // get user's role from users table
      const { data: row, error: rowErr } = await supabaseAdmin.from('users').select('role').eq('id', uid).maybeSingle();
      if (rowErr) return res.status(500).json({ error: rowErr.message || rowErr });
      const role = row?.role || 'user';
      if (!(role === 'admin' || role === 'dev')) return res.status(403).json({ error:'Insufficient privileges' });

      // perform requested update
      const body = req.body || {};
      const { type, payload } = body;
      if (!type) return res.status(400).json({ error:'Missing type' });

      if (type === 'site') {
        // upsert into settings table (we keep a single row; assume id is known or upsert by id)
        // We'll use id=1 or insert new row if empty
        const settingsRow = Array.isArray(payload) ? payload[0] : payload;
        const { data, error } = await supabaseAdmin.from('settings').upsert({ id: 1, ...settingsRow }, { onConflict: ['id'] });
        if (error) return res.status(500).json({ error: error.message || error });
        return res.status(200).json(data);
      }

      if (type === 'tutorials') {
        // payload is array of tutorials; we'll delete and re-insert for simplicity
        const arr = Array.isArray(payload) ? payload : [];
        // Delete all then insert (alternative: upsert)
        await supabaseAdmin.from('tutorials').delete();
        if (arr.length) {
          const { data, error } = await supabaseAdmin.from('tutorials').insert(arr);
          if (error) return res.status(500).json({ error: error.message || error });
        }
        return res.status(200).json({ ok:true });
      }

      if (type === 'cosmetics') {
        const arr = Array.isArray(payload) ? payload : [];
        await supabaseAdmin.from('cosmetics').delete();
        if(arr.length){
          const { data, error } = await supabaseAdmin.from('cosmetics').insert(arr);
          if(error) return res.status(500).json({ error: error.message || error });
        }
        return res.status(200).json({ ok:true });
      }

      return res.status(400).json({ error:'Unknown update type' });
    }

    return res.status(404).json({ error:'Not found' });
  } catch (err) {
    console.error('supabase catch-all error', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
}
