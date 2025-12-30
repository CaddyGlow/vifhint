$Repo = "caddyglow/vifhint"
$ExtId = "gfhhpkidmnaglkonpomfpgcgknmpmchh"
$AssetRegex = "^vifhint-.*\.zip$"
$Dest = Join-Path $env:LOCALAPPDATA "vifhint\$ExtId"

$Headers = @{
	"User-Agent" = "vifhint-installer"
	"Accept"     = "application/vnd.github+json"
}
if ($env:GITHUB_TOKEN) {
	$Headers["Authorization"] = "Bearer $env:GITHUB_TOKEN"
}

$release = Invoke-RestMethod -Headers $Headers -Uri "https://api.github.com/repos/$Repo/releases/latest"
$asset = $release.assets |
	Where-Object { $_.name -match $AssetRegex -and $_.name -notmatch "firefox" } |
	Select-Object -First 1

if (-not $asset) {
	throw "No release asset matching $AssetRegex"
}

$tmp = New-TemporaryFile
Invoke-WebRequest -Headers $Headers -Uri $asset.browser_download_url -OutFile $tmp

if (Test-Path $Dest) {
	Remove-Item -Recurse -Force $Dest
}
New-Item -ItemType Directory -Path $Dest | Out-Null
Expand-Archive -Path $tmp -DestinationPath $Dest -Force

Write-Host "Extracted to $Dest"
Write-Host "First install: chrome://extensions -> Developer mode -> Load unpacked -> $Dest"
Write-Host "Update: re-run this script, then click Reload on the extension."
