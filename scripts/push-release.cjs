const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const rootDir = path.resolve(__dirname, '..')
const releaseArg = process.argv[2] ?? 'patch'
const validReleaseArgs = new Set(['major', 'minor', 'patch', 'premajor', 'preminor', 'prepatch', 'prerelease'])
const explicitVersionPattern = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

function commandName(command) {
  if (process.platform === 'win32' && command === 'npm') return 'npm.cmd'
  return command
}

function run(command, args, options = {}) {
  const result = spawnSync(commandName(command), args, {
    cwd: rootDir,
    stdio: 'inherit',
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
  const result = spawnSync(commandName(command), args, {
    cwd: rootDir,
    encoding: 'utf8'
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
  try {
    capture('git', ['--version'])
  } catch {
    console.error('Git is not available on PATH. Install Git or run this command from a shell where git works.')
    process.exit(1)
  }
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
  const local = spawnSync('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`], {
    cwd: rootDir,
    stdio: 'ignore'
  })
  if (local.status === 0) {
    console.error(`Tag ${tag} already exists locally.`)
    process.exit(1)
  }

  const remote = spawnSync('git', ['ls-remote', '--exit-code', '--tags', 'origin', tag], {
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
