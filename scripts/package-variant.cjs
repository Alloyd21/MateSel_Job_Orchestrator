const { spawnSync } = require('node:child_process')
const path = require('node:path')

const rootDir = path.resolve(__dirname, '..')
const variant = process.argv[2] ?? 'autoupdate'
const validVariants = new Set(['autoupdate', 'standalone'])

if (!validVariants.has(variant)) {
  console.error(`Unknown variant "${variant}". Use "autoupdate" or "standalone".`)
  process.exit(1)
}

const autoUpdate = variant === 'autoupdate'

// 1) Compile main/preload/renderer with the auto-update flag baked in.
function buildRenderer() {
  const electronViteBin = path.join(rootDir, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')
  const env = { ...process.env, MATESEL_AUTO_UPDATE: String(autoUpdate) }
  delete env.ELECTRON_RUN_AS_NODE

  const result = spawnSync(process.execPath, [electronViteBin, 'build'], {
    cwd: rootDir,
    stdio: 'inherit',
    env
  })

  if (result.error) {
    console.error(result.error.message)
    process.exit(1)
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

// 2) Package with electron-builder. The `config` passed to the Node API merges over the
//    `build` block in package.json (deepAssign), so we only override what differs per variant.
async function packageVariant() {
  const builder = require('electron-builder')
  const { Platform } = builder

  const publish = autoUpdate && process.env.CI ? 'always' : 'never'

  const config = autoUpdate
    ? {
        win: { target: ['nsis'] }
      }
    : {
        directories: { output: 'dist-standalone' },
        win: { target: ['nsis', 'portable'] },
        // Per-target names avoid the .exe filename collision between nsis and portable.
        nsis: { artifactName: 'MateSel-Orchestrator-Standalone-Setup-${version}.${ext}' },
        portable: { artifactName: 'MateSel-Orchestrator-Portable-${version}.${ext}' }
      }

  await builder.build({
    targets: Platform.WINDOWS.createTarget(),
    config,
    publish
  })
}

buildRenderer()
packageVariant()
  .then(() => {
    console.log(`Built ${variant} variant.`)
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
