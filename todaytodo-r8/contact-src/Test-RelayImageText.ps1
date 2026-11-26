param([Parameter(Mandatory)][string]$ImagePath, [Parameter(Mandatory)][string]$Needle)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
[void][Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]
[void][Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
[void][Windows.Globalization.Language,Windows.Globalization,ContentType=WindowsRuntime]
$method = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1
function Read-Operation($operation, $type) {
    $task = $method.MakeGenericMethod($type).Invoke($null, @($operation))
    return $task.GetAwaiter().GetResult()
}
$stream = [IO.File]::OpenRead($ImagePath)
$random = $null
$bitmap = $null
try {
    $random = [IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream($stream)
    $decoder = Read-Operation ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($random)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Read-Operation ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new('zh-Hans-CN'))
    if (!$engine) { throw 'Chinese OCR unavailable' }
    $result = Read-Operation ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    $normalized = $result.Text -replace '\s',''
    $target = $Needle -replace '\s',''
    $rows = @(
        foreach ($line in $result.Lines) {
            if (($line.Text -replace '\s','') -eq $target) {
                $rect = @($line.Words | ForEach-Object BoundingRect)[0]
                [int]($rect.Top + $rect.Height / 2)
            }
        }
    )
    [pscustomobject]@{ matches = $normalized.Contains($target); rows = $rows } | ConvertTo-Json -Compress
} finally {
    if ($bitmap) {$bitmap.Dispose()}
    if ($random) {$random.Dispose()}
    $stream.Dispose()
}
