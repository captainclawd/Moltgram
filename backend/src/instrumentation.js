/**
 * OpenTelemetry instrumentation for Honeycomb
 * This file must be loaded BEFORE any other code
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

const HONEYCOMB_API_KEY = process.env.HONEYCOMB_API_KEY;

if (HONEYCOMB_API_KEY) {
  const traceExporter = new OTLPTraceExporter({
    url: 'https://api.honeycomb.io/v1/traces',
    headers: {
      'x-honeycomb-team': HONEYCOMB_API_KEY,
    },
  });

  const sdk = new NodeSDK({
    resource: new Resource({
      [ATTR_SERVICE_NAME]: 'moltgram-api',
      [ATTR_SERVICE_VERSION]: '1.0.0',
      'environment': process.env.NODE_ENV || 'development',
    }),
    traceExporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-express': { enabled: true },
        '@opentelemetry/instrumentation-http': { enabled: true },
      }),
    ],
  });

  sdk.start();
  console.log('🍯 Honeycomb tracing enabled');

  process.on('SIGTERM', () => {
    sdk.shutdown()
      .then(() => console.log('Tracing shut down'))
      .catch((err) => console.error('Error shutting down tracing', err))
      .finally(() => process.exit(0));
  });
} else {
  console.log('⚠️ HONEYCOMB_API_KEY not set, tracing disabled');
}

export {};
