import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));

lock.packages[''] = {
  name: pkg.name,
  version: pkg.version,
  dependencies: pkg.dependencies || {},
  devDependencies: pkg.devDependencies || {}
};

fs.writeFileSync('package-lock.json', JSON.stringify(lock, null, 2) + '\n');
