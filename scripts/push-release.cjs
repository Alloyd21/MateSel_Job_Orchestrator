const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const rootDir = path.resolve(__dirname, '..')
const releaseArg = process.argv[2] ?? 'patch'
const validReleaseArgs = new Set(['major', 'minor', 'patch', 'premajor', 'preminor', 'prepatch', 'prerelease'])
const explicitVersionPattern = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
let gitCommand = 'git'
const npmExecPath = process.env.npm_execpath

function findNpmCli() {
  const candidates = [
    npmExecPath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    process.platform === 'win32' && process.env.ProgramFiles
      ? path.join(process.env.ProgramFiles, 'nodejs', 'node_modules', 'npm', 'bin', 'npm-cli.js')
      : null
  ].filter(Boolean)

  return candidates.find(pathExists) ?? null
}

function pathExists(filePath) {
  try {
    return fs.existsSync(filePath)
  } catch {
    return false
  }
}

function findGitHubDesktopGit() {
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) return null

  const desktopDir = path.join(process.env.LOCALAPPDATA, 'GitHubDesktop')
  if (!pathExists(desktopDir)) return null

  const candidates = fs
    .readdirSync(desktopDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('app-'))
    .map((entry) => path.join(desktopDir, entry.name, 'resources', 'app', 'git', 'cmd', 'git.exe'))
    .filter(pathExists)
    .sort()

  return candidates.at(-1) ?? null
}

function findGitCommand() {
  const candidates = [
    'git',
    process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Git', 'cmd', 'git.exe') : null,
    process.platform === 'win32' ? 'C:\\Program Files\\Git\\cmd\\git.exe' : null,
    process.platform === 'win32' ? 'C:\\Program Files (x86)\\Git\\cmd\\git.exe' : null,
    findGitHubDesktopGit()
  ].filter(Boolean)

  for (const candidate of candidates) {
    const result = spawnSync(candidate, ['--version'], {
      cwd: rootDir,
      encoding: 'utf8'
    })
    if (!result.error && result.status === 0) return candidate
  }

  return null
}

function resolveCommand(command, args) {
  if (command === 'npm') {
    const npmCli = findNpmCli()
    if (npmCli) return { command: process.execPath, args: [npmCli, ...args] }

    if (process.platform === 'win32') return { command: 'npm.cmd', args, shell: true }
  }

  if (command === 'git') return { command: gitCommand, args }
  return { command, args }
}

function run(command, args, options = {}) {
  const resolved = resolveCommand(command, args)
  const result = spawnSync(resolved.command, resolved.args, {
    cwd: rootDir,
    stdio: 'inherit',
    shell: resolved.shell ?? false,
    ...options
  })

  if (result.error) {
    console.error(result.error.message)
    process.exit(1)
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

function capture(command, args) {
  const resolved = resolveCommand(command, args)
  const result = spawnSync(resolved.command, resolved.args, {
    cwd: rootDir,
    encoding: 'utf8',
    shell: resolved.shell ?? false
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    const message = result.stderr.trim() || result.stdout.trim()
    throw new Error(message || `${command} ${args.join(' ')} failed`)
  }

  return result.stdout.trim()
}

function packageVersion() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'))
  return packageJson.version
}

function validateReleaseArg(arg) {
  if (validReleaseArgs.has(arg) || explicitVersionPattern.test(arg)) return

  console.error(`Invalid release argument "${arg}". Use patch, minor, major, or an explicit version like 1.0.3.`)
  process.exit(1)
}

function ensureGitAvailable() {
  const resolvedGit = findGitCommand()
  if (!resolvedGit) {
    console.error('Git is not available. Install Git or run this command from a shell where git works.')
    process.exit(1)
  }

  gitCommand = resolvedGit
  console.log(`Using Git: ${resolvedGit}`)
}

function currentBranch() {
  const branch = capture('git', ['branch', '--show-current'])
  if (!branch) {
    console.error('Cannot release from a detached HEAD. Check out the branch you want to release first.')
    process.exit(1)
  }
  return branch
}

function ensureTagDoesNotExist(tag) {
  const localGit = resolveCommand('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`])
  const local = spawnSync(localGit.command, localGit.args, {
    cwd: rootDir,
    stdio: 'ignore'
  })
  if (local.status === 0) {
    console.error(`Tag ${tag} already exists locally.`)
    process.exit(1)
  }

  const remoteGit = resolveCommand('git', ['ls-remote', '--exit-code', '--tags', 'origin', tag])
  const remote = spawnSync(remoteGit.command, remoteGit.args, {
    cwd: rootDir,
    stdio: 'ignore'
  })
  if (remote.status === 0) {
    console.error(`Tag ${tag} already exists on origin.`)
    process.exit(1)
  }
}

function hasChanges() {
  return capture('git', ['status', '--porcelain']).length > 0
}

validateReleaseArg(releaseArg)
ensureGitAvailable()
const branch = currentBranch()

console.log(`Preparing ${releaseArg} release from ${branch}...`)
run('npm', ['version', releaseArg, '--no-git-tag-version'])

const version = packageVersion()
const tag = `v${version}`
ensureTagDoesNotExist(tag)

run('npm', ['test'])
run('npm', ['run', 'build'])
run('npm', ['run', 'package'])

if (hasChanges()) {
  run('git', ['add', '-A'])
  run('git', ['commit', '-m', `Release ${tag}`])
} else {
  console.log('No file changes to commit; tagging the current commit.')
}

run('git', ['tag', tag])
run('git', ['push', 'origin', branch])
run('git', ['push', 'origin', tag])

console.log(`Release ${tag} pushed. GitHub Actions will publish the installer and update metadata.`)
