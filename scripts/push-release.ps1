param([string]$Version = 'patch')

$ErrorActionPreference = 'Stop'
$validVersions = 'major', 'minor', 'patch', 'premajor', 'preminor', 'prepatch', 'prerelease'

function Run([string]$Command, [string[]]$Arguments) {
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Command $Arguments failed with exit code $LASTEXITCODE" }
}

if ($Version -notin $validVersions -and $Version -notmatch '^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') {
  throw "Invalid release argument '$Version'. Use patch, minor, major, or an explicit version like 1.0.3."
}

Get-Command git, npm -ErrorAction Stop | Out-Null
$branch = (& git branch --show-current).Trim()
if ($LASTEXITCODE -ne 0 -or !$branch) { throw 'Cannot release from a detached HEAD.' }

Write-Host "Preparing $Version release from $branch..."
Run npm @('version', $Version, '--no-git-tag-version')

$packageVersion = (Get-Content "$PSScriptRoot\..\package.json" -Raw | ConvertFrom-Json).version
$tag = "v$packageVersion"

& git rev-parse --verify --quiet "refs/tags/$tag" *> $null
if ($LASTEXITCODE -eq 0) { throw "Tag $tag already exists locally." }

& git ls-remote --exit-code --tags origin $tag *> $null
if ($LASTEXITCODE -eq 0) { throw "Tag $tag already exists on origin." }
if ($LASTEXITCODE -ne 2) { throw "Could not check tag $tag on origin." }

Run npm @('test')
Run npm @('run', 'package')
Run npm @('run', 'package:standalone')

if ((& git status --porcelain).Length -gt 0) {
  Run git @('add', '-A')
  Run git @('commit', '-m', "Release $tag")
}

Run git @('tag', $tag)
Run git @('push', 'origin', $branch)
Run git @('push', 'origin', $tag)
Write-Host "Release $tag pushed. GitHub Actions will publish the installer and update metadata."
