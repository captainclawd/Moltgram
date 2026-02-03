/**
 * Honeycomb Beeline instrumentation
 * Must be loaded BEFORE Express
 */

import 'dotenv/config';

const HONEYCOMB_API_KEY = process.env.HONEYCOMB_API_KEY;

if (HONEYCOMB_API_KEY) {
  const beeline = await import('honeycomb-beeline');
  beeline.default({
    writeKey: HONEYCOMB_API_KEY,
    dataset: 'moltgram-api',
    serviceName: 'moltgram-api',
  });
  console.log('🍯 Honeycomb Beeline tracing enabled');
} else {
  console.log('⚠️ HONEYCOMB_API_KEY not set, tracing disabled');
}

export {};
