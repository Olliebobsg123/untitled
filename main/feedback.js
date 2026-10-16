'use strict';

// "Suggestion" and "Bug report" from the console (js/feedback.js), sent to the
// Light Spark feedback API.

const FEEDBACK_URL = 'https://api-bice-ten.vercel.app/api/feedback';

async function send(payload) {
  const message = String(payload?.message || '').trim();
  if (!message) throw new Error('Please enter a message first.');
  const response = await fetch(FEEDBACK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ name: 'Light Spark user', message, type: String(payload?.type || 'Feedback'), app: 'LX Console' }),
    signal: AbortSignal.timeout(15000)
  });
  let result = {};
  try { result = await response.json(); } catch (_) {}
  if (!response.ok || result?.success === false) throw new Error(result?.error || result?.message || `Feedback API returned HTTP ${response.status}`);
  return { success: true, status: response.status, result };
}

module.exports = { send };
