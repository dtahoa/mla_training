import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanPageText, slugify, upsertAiSection, vttToText } from '../src/capture.ts';

test('vttToText strips headers, cue numbers, timings, tags and repeats', () => {
  const vtt = [
    'WEBVTT',
    '',
    '1',
    '00:00:00.000 --> 00:00:02.000',
    '<v Speaker>One plant changed its part numbering.</v>',
    '',
    '2',
    '00:00:02.000 --> 00:00:04.000',
    'The change never reached the feed &amp; the assistant.',
    '',
    '3',
    '00:00:04.000 --> 00:00:05.000',
    'The change never reached the feed &amp; the assistant.',
  ].join('\r\n');
  assert.equal(vttToText(vtt), 'One plant changed its part numbering. The change never reached the feed & the assistant.');
});

test('cleanPageText drops Coursera UI chrome and collapses blank lines', () => {
  const text = 'Mark as completed\nScoping matters\n\n\n  The work   nobody scoped.  \nGo to next item\nLike';
  assert.equal(cleanPageText(text), 'Scoping matters\n\nThe work nobody scoped.');
});

test('upsertAiSection keeps the learner notes and replaces only the AI block', () => {
  const base = '# Title\n\n## Ghi chú của mình\n\n- my idea\n';
  const once = upsertAiSection(base, 'v1');
  assert.ok(once.includes('- my idea'));
  assert.ok(once.includes('v1'));
  const twice = upsertAiSection(once, 'v2');
  assert.ok(twice.includes('- my idea'));
  assert.ok(twice.includes('v2'));
  assert.ok(!twice.includes('v1'));
  assert.equal(twice.split('ai-notes:start').length, 2);
});

test('slugify produces safe file names', () => {
  assert.equal(slugify('Problem: The decisive work nobody scoped'), 'problem-the-decisive-work-nobody-scoped');
  assert.equal(slugify('Tư vấn AI / Đánh giá'), 'tu-van-ai-anh-gia');
  assert.equal(slugify('???'), 'item');
});
