import { access } from 'node:fs/promises';
for (const path of ['engine/src/lib.rs', 'windows/src/main.rs', 'macos/Package.swift'])
  await access(new URL('../' + path, import.meta.url));
console.log('Native app sources ready; use the platform build workflow to compile installers.');
