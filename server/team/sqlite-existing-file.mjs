import path from 'node:path';
import {pathToFileURL} from 'node:url';

// The caller validates the ordinary absolute path and its filesystem identity.
export function sqliteExistingFileUri(filename, mode, {immutable = false} = {}) {
  if ((mode !== 'ro' && mode !== 'rw') || (immutable && mode !== 'ro')) {
    throw new TypeError('Expected an existing SQLite file mode.');
  }
  // Keep the Windows namespace prefix in SQLite's decoded filename. A WHATWG
  // file URL would interpret its leading backslashes and question mark as URL syntax.
  const uri = process.platform === 'win32'
    ? `file:${encodeURIComponent(path.toNamespacedPath(filename))}`
    : pathToFileURL(filename).href;
  return `${uri}?mode=${mode}${immutable ? '&immutable=1' : ''}`;
}
