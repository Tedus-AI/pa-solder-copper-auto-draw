import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
await mkdir('public', { recursive: true });
await copyFile('../cad-app/src/pa_cad/creo.py', 'public/creo_runner.py');
await copyFile('../cad-app/src/pa_cad/resources/WINDOWS_CREO7.md', 'public/WINDOWS_CREO7.md');
await copyFile('../cad-app/examples/780-m1p.yaml', 'public/example.yaml');
const license = await readFile('node_modules/replicad-opencascadejs/LICENSE', 'utf8');
const pdfLib = await readFile('node_modules/pdf-lib/LICENSE.md', 'utf8');
await writeFile('public/THIRD_PARTY_LICENSES.txt', `Browser CAD uses Replicad (MIT) and OpenCascade / replicad-opencascadejs (LGPL-2.1).\nSource and build recipes: https://github.com/sgenoud/replicad/tree/main/packages/replicad-opencascadejs\nOpenCascade source: https://dev.opencascade.org/resources/download\nThe WebAssembly module is distributed as a separate replaceable asset.\n\n${license}\n\n────────\n2D drawing PDFs use pdf-lib (MIT), which includes pako, UPNG and @pdf-lib/standard-fonts (MIT).\n\n${pdfLib}`);
