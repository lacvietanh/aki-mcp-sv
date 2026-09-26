param(
  [Parameter(Mandatory=$true)]
  [ValidateSet('login','worker','logout')]
  [string]$Mode,

  [Parameter(Mandatory=$true)][string]$User,
  [Parameter(Mandatory=$true)][string]$CredentialFile,

  [string]$AgyBin,
  [string]$NodeBin,
  [string]$WorkerBin,
  [string]$Role,
  [int]$Port,
  [string]$Root,
  [string]$TokenFile,
  [string]$StartupErrorFile,
  [string]$AllowedModes,
  [string]$WorkingDirectory,
  [string]$ResultFile
)

$ErrorActionPreference = 'Stop'
$loginStage = 'load role credential'

function Write-Result([string]$Value) {
  if ($ResultFile) {
    [System.IO.File]::WriteAllText($ResultFile, $Value, [System.Text.Encoding]::UTF8)
  }
}

function Quote-ProcessArg([string]$Value) {
  if ($null -eq $Value) { return '""' }
  if ($Value -notmatch '[\s"]') { return $Value }
  return '"' + ($Value -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"'
}

function Test-LoopbackPort([int]$TargetPort) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $async = $client.BeginConnect('127.0.0.1', $TargetPort, $null, $null)
    if (-not $async.AsyncWaitHandle.WaitOne(200)) { return $false }
    $client.EndConnect($async)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

try {
  $storedCredential = Import-Clixml -LiteralPath $CredentialFile
  if (-not ($storedCredential -is [System.Management.Automation.PSCredential]) -or -not $storedCredential.Password) {
    throw 'invalid AGY role credential store'
  }
  $qualifiedUser = "$env:COMPUTERNAME\$User"
  $credential = [System.Management.Automation.PSCredential]::new($qualifiedUser, $storedCredential.Password)

  if (-not $WorkingDirectory) {
    $WorkingDirectory = [Environment]::GetFolderPath('UserProfile')
  }

  switch ($Mode) {
    'login' {
      $loginStage = 'open AGY CLI'
      if (-not $AgyBin) { throw 'AgyBin is required for login mode' }

      # User explicitly clicked Login: only this AGY CLI window is visible.
      # The helper PowerShell process itself remains hidden.
      $agyCommand = Quote-ProcessArg $AgyBin
      $proc = Start-Process -FilePath "$env:SystemRoot\System32\cmd.exe" -ArgumentList @('/d','/k',$agyCommand) -Credential $credential -LoadUserProfile -WindowStyle Normal -WorkingDirectory $WorkingDirectory -PassThru
      Start-Sleep -Milliseconds 700
      $proc.Refresh()
      if ($proc.HasExited -and $proc.ExitCode -ne 0) {
        throw "AGY CLI exited immediately with code $($proc.ExitCode)"
      }
      Write-Result "OK:$($proc.Id)"
      exit 0
    }

    'worker' {
      foreach ($required in @('NodeBin','WorkerBin','Role','Root','TokenFile','AllowedModes')) {
        if (-not (Get-Variable -Name $required -ValueOnly)) { throw "$required is required for worker mode" }
      }

      $rawArgs = @(
        $WorkerBin,
        '--name', $Role,
        '--port', [string]$Port,
        '--root', $Root,
        '--agy-bin', $AgyBin,
        '--token-file', $TokenFile,
        '--allowed-modes', $AllowedModes
      )
      if ($StartupErrorFile) { $rawArgs += @('--startup-error-file', $StartupErrorFile) }
      $argumentLine = ($rawArgs | ForEach-Object { Quote-ProcessArg ([string]$_) }) -join ' '
      $proc = Start-Process -FilePath $NodeBin -ArgumentList $argumentLine -Credential $credential -LoadUserProfile -WindowStyle Hidden -WorkingDirectory $WorkingDirectory -PassThru

      $deadline = [DateTime]::UtcNow.AddSeconds(25)
      while ([DateTime]::UtcNow -lt $deadline) {
        $proc.Refresh()
        if ($proc.HasExited) {
          $diagnostic = ''
          if ($StartupErrorFile -and [System.IO.File]::Exists($StartupErrorFile)) {
            try {
              $reader = [System.IO.File]::OpenText($StartupErrorFile)
              try {
                $chars = New-Object char[] 2048
                $count = $reader.Read($chars, 0, $chars.Length)
                if ($count -gt 0) { $diagnostic = (-join $chars[0..($count - 1)]).Trim() }
              } finally { $reader.Dispose() }
            } catch {}
          }
          if ($diagnostic) { throw "worker process exited immediately with code $($proc.ExitCode): $diagnostic" }
          throw "worker process exited immediately with code $($proc.ExitCode)"
        }
        if (Test-LoopbackPort $Port) {
          Write-Result "OK:$($proc.Id)"
          exit 0
        }
        Start-Sleep -Milliseconds 200
      }

      try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch {}
      throw "worker process did not open 127.0.0.1:$Port within 25s"
    }

    'logout' {
      $cmd = 'taskkill /f /im agy.exe >nul 2>&1 & cmdkey /delete:gemini:antigravity >nul 2>&1 & cmdkey /delete:gemini-cli-api-key/default-api-key >nul 2>&1 & exit /b 0'
      $proc = Start-Process -FilePath "$env:SystemRoot\System32\cmd.exe" -ArgumentList @('/d','/c',$cmd) -Credential $credential -LoadUserProfile -WindowStyle Hidden -Wait -PassThru
      if ($proc.ExitCode -ne 0) { throw "logout process exited with code $($proc.ExitCode)" }
      Write-Result 'OK'
      exit 0
    }
  }
}
catch {
  $detail = $_.Exception.Message
  if ($Mode -eq 'login') { $detail = "${loginStage}: $detail" }
  Write-Result ("ERROR:" + $detail)
  exit 1
}
