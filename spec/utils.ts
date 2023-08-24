import * as fs from 'fs';
import * as path from 'path';

/**
 * Helper util to load JSON fixtures. This is necessary because
 * loading them through the handy "require('foo.json')" shortcut
 * can be problematic due to module caching - modifying a fixture
 * in one test can bleed over into another test, coupling them
 */
export function loadFixture(filePath: string) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', filePath), 'utf-8'));
}
