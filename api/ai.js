// api/ai.js
import fetch from 'node-fetch';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { message } = req.body || {};
    if (!message || typeof message !== 'string') return res.status(400).json({ error: 'Invalid message' });

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) return res.status(500).json({ error: 'OpenAI key not set in environment variables' });

    // You can change model to gpt-4 or gpt-3.5-turbo as preferred
    const payload = {
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'You are Gorilla Hub assistant. Provide concise, friendly, and accurate answers about Gorilla Tag, tutorials, cosmetics and site functionality.' },
        { role: 'user', content: message }
      ],
      max_tokens: 800,
      temperature: 0.7
    };

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify(payload)
    });

    if (!r.ok) {
      const text = await r.text();
      return res.status(500).json({ error: 'OpenAI error', details: text });
    }

    const json = await r.json();
    const reply = json.choices?.[0]?.message?.content || json?.choices?.[0]?.text || '';
    return res.status(200).json({ reply, raw: json });
  } catch (err) {
    console.error('AI handler error', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
}

