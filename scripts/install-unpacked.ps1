param(
	[ValidateSet("dev", "release")]
	[string]$Mode = "dev"
)

$Repo = "caddyglow/vifhint"
$Branch = "dev/v0.1"
$ExtId = "gfhhpkidmnaglkonpomfpgcgknmpmchh"
$Dest = Join-Path $env:LOCALAPPDATA "vifhint\$ExtId"

$Headers = @{
	"User-Agent" = "vifhint-installer"
	"Accept"     = "application/vnd.github+json"
}
if ($env:GITHUB_TOKEN) {
	$Headers["Authorization"] = "Bearer $env:GITHUB_TOKEN"
}

if ($Mode -eq "release") {
	$release = Invoke-RestMethod -Headers $Headers -Uri "https://api.github.com/repos/$Repo/releases/latest"
	$asset = $release.assets |
		Where-Object { $_.name -match "^vifhint-.*\.zip$" -and $_.name -notmatch "firefox" } |
		Select-Object -First 1
	if (-not $asset) {
		throw "No matching release asset found. Try: -Mode dev"
	}
	$Url = $asset.browser_download_url
} else {
	$Url = "https://github.com/$Repo/archive/refs/heads/$Branch.zip"
}

$tmp = New-TemporaryFile
Invoke-WebRequest -Headers $Headers -Uri $Url -OutFile $tmp

if (Test-Path $Dest) {
	Remove-Item -Recurse -Force $Dest
}
New-Item -ItemType Directory -Path $Dest | Out-Null

if ($Mode -eq "dev") {
	Expand-Archive -Path $tmp -DestinationPath $Dest -Force
	$inner = Get-ChildItem -Path $Dest -Directory | Select-Object -First 1
	$distPath = Join-Path $inner.FullName "dist"
	if (Test-Path $distPath) {
		Get-ChildItem -Path $distPath | Move-Item -Destination $Dest
		Remove-Item -Recurse -Force $inner.FullName
	} else {
		if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
			Remove-Item -Recurse -Force $Dest
			Remove-Item -Force $tmp
			throw "bun is required to build from source. Install it from https://bun.sh"
		}
		Write-Host "Building from source..."
		Push-Location $inner.FullName
		bun install
		bun run build
		Pop-Location
		Get-ChildItem -Path $distPath | Move-Item -Destination $Dest
		Remove-Item -Recurse -Force $inner.FullName
	}
} else {
	Expand-Archive -Path $tmp -DestinationPath $Dest -Force
}

Remove-Item -Force $tmp

Write-Host "Installed to $Dest (mode: $Mode)"
Write-Host "First install: chrome://extensions -> Developer mode -> Load unpacked -> $Dest"
Write-Host "Update: re-run this script, then click Reload on the extension."
