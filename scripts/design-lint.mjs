import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const publicScreens = new Set(['LandingPage.jsx', 'LoginPage.jsx']);
const components = readdirSync(join(root, 'src/components'), { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name.endsWith('.jsx') && !publicScreens.has(entry.name))
  .map(entry => join(entry.parentPath, entry.name));
const styles = readdirSync(join(root, 'src/styles'))
  .filter(name => name.endsWith('.css') && name !== 'global.css')
  .map(name => join(root, 'src/styles', name));
const files = [join(root, 'src/App.jsx'), ...components, ...styles];
const rawColor = /#(?:[\da-f]{8}|[\da-f]{6}|[\da-f]{4}|[\da-f]{3})\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/gi;
const fontDeclaration = /\b(?:font-family|fontFamily|font)\s*:\s*([^;\n},]+)/g;
const paintDeclaration = /\b(?:color|background(?:-color)?|border(?:-(?:color|inline-start|block-start))?|box-shadow|outline(?:-color)?|fill|stroke|accent-color)\s*:\s*([^;\n}]+)/g;
const componentPaint = /\b(?:color|background(?:Color)?|border(?:Color)?|fill|stroke)\s*[:=]\s*['"]([^'"]+)['"]/g;

let violations = 0;
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  const report = (match, message) => {
    const line = source.slice(0, match.index).split('\n').length;
    console.error(`${relative(root, file)}:${line} ${message}`);
    violations++;
  };
  for (const match of source.matchAll(rawColor)) report(match, 'Use a theme color token.');
  for (const match of source.matchAll(fontDeclaration)) {
    if (!match[1].includes('var(--font-') && !/^['"]?inherit['"]?$/.test(match[1].trim())) report(match, 'Use a theme font token.');
  }
  const declarations = file.endsWith('.css') ? paintDeclaration : componentPaint;
  for (const match of source.matchAll(declarations)) {
    const value = match[1].trim().replace(/\s+!important$/, '');
    if (!value.includes('var(--') && !/^(?:0|none|transparent|currentColor|inherit|initial|unset)$/.test(value)) {
      report(match, 'Use a theme token for this paint declaration.');
    }
  }
}

if (violations > 0) process.exitCode = 1;
else console.log('Signed-in styles use theme colors and fonts.');
