#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const API_ROOT = 'https://api.pixellab.ai/v2';
const POLL_MS = 7000;
const MAX_POLLS = 50;

function parseVars(text) {
  const vars = {};
  for (const sourceLine of text.split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return vars;
}

async function getToken() {
  if (process.env.PIXELLAB_API_TOKEN) return process.env.PIXELLAB_API_TOKEN;
  const vars = parseVars(await readFile('.dev.vars', 'utf8'));
  if (!vars.PIXELLAB_API_TOKEN) {
    throw new Error('PIXELLAB_API_TOKEN is not set in the environment or .dev.vars');
  }
  return vars.PIXELLAB_API_TOKEN;
}

async function api(token, endpoint, options = {}) {
  const response = await fetch(`${API_ROOT}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { message: text };
  }
  if (!response.ok) {
    throw new Error(`PixelLab ${response.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

function collectImages(value) {
  const encoded = [];
  const remote = [];
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (typeof node.base64 === 'string') {
      encoded.push({ kind: 'base64', value: node.base64, format: node.format || 'png' });
      return;
    }
    if (typeof node.image_url === 'string') {
      remote.push({ kind: 'url', value: node.image_url, format: 'png' });
    }
    for (const child of Array.isArray(node) ? node : Object.values(node)) visit(child);
  }
  visit(value);
  // PixelLab can return the same result both inline and as a storage URL.
  // Prefer the inline lossless payload so one generated frame becomes one file.
  return encoded.length ? encoded : remote;
}

async function imageBytes(image) {
  if (image.kind === 'base64') {
    const encoded = image.value.replace(/^data:image\/[^;]+;base64,/, '');
    return Buffer.from(encoded, 'base64');
  }
  const response = await fetch(image.value);
  if (!response.ok) throw new Error(`Could not download generated image (${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}

async function requestForBrief(brief) {
  if (!brief.edit_image) {
    return {
      endpoint: '/generate-image-v2',
      body: {
        description: brief.description,
        image_size: brief.image_size,
        seed: brief.seed,
        no_background: brief.no_background,
      },
    };
  }

  const source = await readFile(brief.edit_image);
  const encoded = `data:image/png;base64,${source.toString('base64')}`;
  const count = Math.max(1, Math.min(4, brief.variant_count || 1));
  return {
    endpoint: '/edit-images-v2',
    body: {
      method: 'edit_with_text',
      edit_images: Array.from({ length: count }, () => ({
        image: { base64: encoded },
        width: brief.image_size.width,
        height: brief.image_size.height,
      })),
      image_size: brief.image_size,
      description: brief.description,
      seed: brief.seed,
      no_background: brief.no_background,
    },
  };
}

async function main() {
  const briefPath = process.argv[2] || 'art/briefs/orakyn.json';
  const brief = JSON.parse(await readFile(briefPath, 'utf8'));
  const token = await getToken();
  const outputDir = path.join('art', 'concepts', brief.id);
  await mkdir(outputDir, { recursive: true });

  const request = await requestForBrief(brief);

  console.log(
    `Requesting ${brief.image_size.width}x${brief.image_size.height} candidates for ${brief.id}...`
  );
  const created = await api(token, request.endpoint, {
    method: 'POST',
    body: JSON.stringify(request.body),
  });
  const jobId = created.background_job_id;
  if (!jobId) throw new Error('PixelLab did not return a background job id');

  let job;
  for (let poll = 1; poll <= MAX_POLLS; poll++) {
    if (poll > 1) await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    job = await api(token, `/background-jobs/${encodeURIComponent(jobId)}`);
    console.log(`PixelLab job: ${job.status} (${poll}/${MAX_POLLS})`);
    if (job.status === 'completed') break;
    if (job.status === 'failed')
      throw new Error(`PixelLab generation failed: ${JSON.stringify(job.last_response)}`);
  }
  if (job?.status !== 'completed') throw new Error('PixelLab generation timed out');

  const images = collectImages(job.last_response);
  if (!images.length) {
    throw new Error(`PixelLab completed without readable images: ${JSON.stringify(job.last_response)}`);
  }

  const files = [];
  for (const [index, image] of images.entries()) {
    const extension = image.format === 'jpeg' ? 'jpg' : image.format;
    const filename = `${brief.id}-candidate-${index + 1}.${extension}`;
    await writeFile(path.join(outputDir, filename), await imageBytes(image));
    files.push(filename);
  }
  await writeFile(
    path.join(outputDir, 'generation.json'),
    `${JSON.stringify(
      {
        brief: path.relative(outputDir, briefPath),
        source: brief.edit_image || null,
        seed: brief.seed,
        job_id: jobId,
        usage: job.usage || created.usage || null,
        files,
      },
      null,
      2
    )}\n`
  );
  console.log(`Saved ${files.length} candidate(s) to ${outputDir}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
