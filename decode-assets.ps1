# Decodes the base64 image assets in public\ into real PNGs, verifies each
# against a known-good hash, and cleans up after itself.
$expected = @{
  "logo.png"              = "f12a408f6652efa6f9cdeee837c00a4a"
  "icon-192.png"          = "6177367b37ce6260c24db68d1f1e31e3"
  "icon-512.png"          = "49dee50f10c4aae5b12a5bc6b05d360d"
  "icon-maskable-512.png" = "dbbf91cca3433e59912b8e470d376655"
  "apple-touch-icon.png"  = "8af680eaa84b90bd527817a1d81a2cdd"
}

$failed = $false
Get-ChildItem -Path "$PSScriptRoot\public" -Filter *.b64 | ForEach-Object {
  $out = $_.FullName -replace '\.b64$', ''
  $name = [IO.Path]::GetFileName($out)
  $b64 = (Get-Content $_.FullName -Raw) -replace '\s', ''
  [IO.File]::WriteAllBytes($out, [Convert]::FromBase64String($b64))
  $hash = (Get-FileHash -Algorithm MD5 $out).Hash.ToLower()
  if ($hash -eq $expected[$name]) {
    Write-Host "OK      $name" -ForegroundColor Green
    Remove-Item $_.FullName
  } else {
    Write-Host "CORRUPT $name (hash mismatch - tell Claude)" -ForegroundColor Red
    $script:failed = $true
  }
}

if (-not $failed) {
  Write-Host "All images verified. Deleting this script."
  Remove-Item $PSCommandPath
} else {
  Write-Host "Some files failed verification - do not commit them." -ForegroundColor Red
}
