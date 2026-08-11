'use strict';

const fs = require('node:fs');
const path = require('node:path');

const directory = __dirname;
const moduleNames = [
  '00-core.js',
  '01-physics-predictor.js',
  '02-state-and-reachability.js',
  '03-defense.js',
  '04-offense.js',
  '05-serve-machine.js',
  '06-controller.js',
];
const banner = `/**
 * Generated modular power bot.
 * Paste this entire file into Bot Setup as JavaScript.
 * Source modules: ${moduleNames.join(', ')}
 */\n`;
const source =
  banner +
  moduleNames
    .map((name) => fs.readFileSync(path.join(directory, name), 'utf8').trim())
    .join('\n\n') +
  '\n';

fs.writeFileSync(path.join(directory, 'power-bot.js'), source);
