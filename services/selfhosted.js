'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');

function requestJsonStream(rawUrl, headers, body) {
  return new Promise((resolve, reject) => {
    const target = new URL(rawUrl);
    const transport = target.protocol === 'http:' ? http : https;
    const bodyStr = JSON.stringify(body);

    const req = transport.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === 'http:' ? 80 : 443),
      path: `${target.pathname}${target.search}`,
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(bodyStr) },
      timeout: 90000,
    }, resolve);

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
    req.write(bodyStr);
    req.end();
  });
}

function getSelfHostedConfig() {
  return {
    url: (process.env.SELF_HOSTED_MODEL_URL || '').trim(),
    name: (process.env.SELF_HOSTED_MODEL_NAME || 'verdict-private-legal').trim(),
    key: (process.env.SELF_HOSTED_MODEL_API_KEY || '').trim(),
  };
}

function hasSelfHostedModel() {
  const { url } = getSelfHostedConfig();
  return !!url;
}

async function selfHostedStream(system, user, maxTokens = 8000) {
  const { url, name, key } = getSelfHostedConfig();
  return requestJsonStream(
    url,
    { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    {
      model: name,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.1,
      max_tokens: maxTokens,
      stream: true,
    }
  );
}

module.exports = {
  requestJsonStream,
  getSelfHostedConfig,
  hasSelfHostedModel,
  selfHostedStream,
};
