'use strict';

// Show files: JSON files, kept in Documents/LX Console Shows unless a full path is given.

const { app } = require('electron');
const fs = require('fs');
const path = require('path');

function showDirectory() {
  const directory = path.join(app.getPath('documents'), 'LX Console Shows');
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function resolveShowPath(filePath) {
  const requested = String(filePath || '').trim();
  if (!requested) throw new Error('No show path supplied');
  const resolved = path.isAbsolute(requested) ? path.resolve(requested) : path.resolve(showDirectory(), requested);
  if (!/\.json$/i.test(resolved)) throw new Error('Show files must use the .json extension');
  return resolved;
}

function save(filePath, show) {
  const target = resolveShowPath(filePath);
  if (!show || typeof show !== 'object') throw new Error('No show data supplied');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  // Write to a temporary file first so a crash mid-save can't leave a half-written show.
  const temporary = `${target}.saving`;
  fs.writeFileSync(temporary, JSON.stringify(show, null, 2), 'utf8');
  fs.renameSync(temporary, target);
  return { path: target };
}

function load(filePath) {
  const target = resolveShowPath(filePath);
  if (!fs.existsSync(target)) throw new Error(`Show file not found: ${target}`);
  try {
    return { path: target, show: JSON.parse(fs.readFileSync(target, 'utf8')) };
  } catch (err) {
    throw new Error(`Could not read show file: ${err.message}`);
  }
}

module.exports = { showDirectory, save, load };
