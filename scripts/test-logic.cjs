#!/usr/bin/env node
// Pruebas de lógica de Fase 1 — sin dependencias nuevas.
//
// Cómo correrlas:   npm test        (o: node scripts/test-logic.cjs)
//
// Qué hace:
// 1. Compila lib/ con el `tsc` de devDependencies a una carpeta temporal del
//    sistema (os.tmpdir), nunca dentro del repo.
// 2. Corre tests/logic.test.cjs contra esa compilación, con las transcripciones
//    de prueba de testmedia/.
// 3. Borra la carpeta temporal.
// Sale con código 0 si todas pasan y 1 si alguna falla.

const { execFileSync } = require('child_process')
const { mkdtempSync, rmSync, writeFileSync, existsSync } = require('fs')
const { tmpdir } = require('os')
const { join } = require('path')

const root = join(__dirname, '..')
const outDir = mkdtempSync(join(tmpdir(), 'ai-editor-tests-'))
const files = [
  'lib/phrases.ts',
  'lib/timeline.ts',
  'lib/cues.ts',
  'lib/autocut.ts',
  'lib/contrast.ts',
  'lib/assBuilder.ts',
  'lib/styles/presets.ts',
  'types/project.ts',
]

let code = 1
try {
  // tsconfig temporal: resuelve el alias @/ y emite CommonJS para node
  const tsconfig = join(outDir, 'tsconfig.json')
  writeFileSync(
    tsconfig,
    JSON.stringify({
      compilerOptions: {
        target: 'ES2020',
        module: 'commonjs',
        moduleResolution: 'node',
        strict: true,
        skipLibCheck: true,
        esModuleInterop: true,
        lib: ['dom', 'es2020'],
        rootDir: root,
        outDir: join(outDir, 'build'),
        baseUrl: root,
        paths: { '@/*': ['./*'] },
      },
      files: files.map((f) => join(root, f)),
    })
  )
  const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc')
  if (!existsSync(tsc)) {
    console.error('Falta typescript: corre `npm install` primero.')
    process.exit(1)
  }
  execFileSync(process.execPath, [tsc, '-p', tsconfig], { stdio: 'inherit' })
  execFileSync(
    process.execPath,
    [join(root, 'tests', 'logic.test.cjs'), join(outDir, 'build', 'lib'), root],
    { stdio: 'inherit' }
  )
  code = 0
} catch {
  code = 1
} finally {
  rmSync(outDir, { recursive: true, force: true })
}
process.exit(code)
