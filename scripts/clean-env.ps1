<#
.SYNOPSIS
    Limpa o arquivo .env.local removendo conteúdo colado do browser (UI do GitHub/Supabase/etc.)

.DESCRIPTION
    Ao copiar tokens de interfaces web, o usuário pode acidentalmente incluir
    texto da UI (menus, rodapés, breadcrumbs). Este script remove tudo que
    vier após a última linha válida do formato KEY=VALUE ou comentário (#).

.USAGE
    Na raiz do projeto ZAEA, execute:
        .\scripts\clean-env.ps1

    Para especificar outro arquivo:
        .\scripts\clean-env.ps1 -EnvFile ".env.production"

.PARAMETER EnvFile
    Caminho para o arquivo .env a ser limpo. Padrão: .env.local
#>

param(
    [string]$EnvFile = ".env.local"
)

# Resolve o caminho absoluto a partir da raiz do projeto
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$TargetFile  = Join-Path $ProjectRoot $EnvFile

# Validação
if (-not (Test-Path $TargetFile)) {
    Write-Error "Arquivo não encontrado: $TargetFile"
    exit 1
}

# Lê todas as linhas
$AllLines = Get-Content $TargetFile -Encoding UTF8

# Padrão de linha válida em um .env:
#   - Linha em branco (só whitespace)
#   - Comentário: começa com #
#   - Variável: KEY=VALUE (KEY pode conter letras, números e _)
$EnvLinePattern  = '^[A-Z_][A-Z0-9_]*\s*='
$CommentPattern  = '^\s*#'
$BlankPattern    = '^\s*$'

# Filtra: mantém linhas válidas, para na primeira linha de conteúdo de browser.
# Linhas em branco NÃO causam parada — são puladas e incluídas normalmente.
# Apenas uma linha NOT-blank e NOT-env e NOT-comment causa o break.
$CleanLines = @()
$FoundInvalid = $false

foreach ($line in $AllLines) {
    $trimmed = $line.TrimEnd()
    if ($trimmed -match $BlankPattern -or $trimmed -match $CommentPattern -or $trimmed -match $EnvLinePattern) {
        $CleanLines += $trimmed
    } else {
        # Linha não vazia e não .env → conteúdo de browser UI
        $FoundInvalid = $true
        Write-Warning "Linha removida (conteúdo de browser): $trimmed"
        break
    }
}

# Se encontrou inválidas, avisa e salva. Se não, apenas confirma que está limpo.
if ($FoundInvalid) {
    # Remove linhas em branco do final
    while ($CleanLines.Count -gt 0 -and $CleanLines[-1] -eq '') {
        $CleanLines = $CleanLines[0..($CleanLines.Count - 2)]
    }

    # Escreve de volta com encoding UTF8 sem BOM
    $Utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllLines($TargetFile, $CleanLines, $Utf8NoBom)

    Write-Host ""
    Write-Host "✔ .env limpo com sucesso!" -ForegroundColor Green
    Write-Host "  Linhas válidas mantidas: $($CleanLines.Count)"  -ForegroundColor Cyan
} else {
    Write-Host "✔ Arquivo já está limpo. Nenhuma alteração necessária." -ForegroundColor Green
    Write-Host "  Total de linhas: $($CleanLines.Count)" -ForegroundColor Cyan
}
