'use strict';

/**
 * Word lists for human-typable session ids (see makeSessionId in daemon.js):
 * "<adjective>-<noun>", e.g. "imaginative-acceptance". Kept in-repo, no
 * dependency, in keeping with this project's zero-runtime-dependency rule.
 *
 * Deliberately: common, short-ish, unambiguous-to-type words only — no
 * homophones, no words that are easy to typo or hard to spell by ear.
 */

const ADJECTIVES = [
  'imaginative', 'amber', 'brave', 'calm', 'clever', 'cosmic', 'curious',
  'daring', 'dusty', 'eager', 'earnest', 'faithful', 'fearless', 'fluent',
  'fond', 'gentle', 'golden', 'happy', 'honest', 'humble', 'jolly', 'keen',
  'kind', 'lively', 'lucky', 'lunar', 'mellow', 'merry', 'mighty', 'modest',
  'noble', 'plucky', 'polite', 'proud', 'quiet', 'quick', 'radiant', 'rapid',
  'rustic', 'sandy', 'serene', 'sharp', 'shiny', 'silent', 'silver', 'simple',
  'sincere', 'smooth', 'solar', 'sound', 'spry', 'steady', 'stellar',
  'sturdy', 'sunny', 'swift', 'tidy', 'tranquil', 'trusty', 'vivid', 'warm',
  'wise', 'witty', 'zesty',
];

const NOUNS = [
  'acceptance', 'anchor', 'arrow', 'atlas', 'aurora', 'badge', 'banjo',
  'basil', 'beacon', 'bramble', 'canyon', 'cedar', 'cinder', 'clover',
  'comet', 'compass', 'coral', 'cove', 'crest', 'delta', 'dune', 'ember',
  'falcon', 'feather', 'fern', 'fjord', 'forest', 'garden', 'glacier',
  'harbor', 'hazel', 'heron', 'hollow', 'island', 'ivy', 'jasper', 'juniper',
  'lagoon', 'lantern', 'maple', 'meadow', 'mesa', 'mist', 'mosaic', 'oasis',
  'orbit', 'orchid', 'otter', 'peak', 'pebble', 'pine', 'plateau', 'prairie',
  'quartz', 'quill', 'reef', 'ridge', 'river', 'robin', 'saffron', 'sequoia',
  'shore', 'sparrow', 'spring', 'summit', 'thistle', 'tundra', 'valley',
  'willow', 'wren',
];

module.exports = { ADJECTIVES, NOUNS };
