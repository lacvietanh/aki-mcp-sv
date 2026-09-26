param(
  [Parameter(Mandatory=$true)][string]$AgyRoot,
  [Parameter(Mandatory=$true)][string]$WorkspaceRoot,
  [Parameter(Mandatory=$true)][string]$CredentialFile,
  [Parameter(Mandatory=$true)][string]$OwnerHome,
  [Parameter(Mandatory=$true)][string]$OwnerSid,
  [string]$ResultFile
)

$ErrorActionPreference = 'Stop'

function Resolve-Directory([string]$Value) {
  if (-not [System.IO.Path]::IsPathRooted($Value) -or -not (Test-Path -LiteralPath $Value -PathType Container)) {
    throw "directory does not exist: $Value"
  }
  return [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $Value).ProviderPath).TrimEnd([char]'\')
}

function Test-SameOrAncestor([string]$Candidate, [string]$Protected) {
  return [string]::Equals($Candidate, $Protected, [StringComparison]::OrdinalIgnoreCase) -or
    $Protected.StartsWith($Candidate + '\', [StringComparison]::OrdinalIgnoreCase)
}

function Assert-NoReparsePath([string]$Value) {
  $directory = [System.IO.DirectoryInfo]::new($Value)
  while ($directory) {
    if ($directory.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
      throw "unsafe path contains a reparse point: $($directory.FullName)"
    }
    $directory = $directory.Parent
  }
}

try {
  $workspacePath = Resolve-Directory $WorkspaceRoot
  $ownerHomePath = Resolve-Directory $OwnerHome
  $dataDirPath = Resolve-Directory (Split-Path -Path $CredentialFile -Parent)
  $ownerIdentity = [System.Security.Principal.SecurityIdentifier]::new($OwnerSid)
  Assert-NoReparsePath $workspacePath
  Assert-NoReparsePath $ownerHomePath
  Assert-NoReparsePath $dataDirPath
  $volumeRoot = [System.IO.Path]::GetPathRoot($workspacePath).TrimEnd([char]'\')
  if ([string]::Equals($workspacePath, $volumeRoot, [StringComparison]::OrdinalIgnoreCase) -or
      (Test-SameOrAncestor $workspacePath $ownerHomePath) -or
      (Test-SameOrAncestor $workspacePath $dataDirPath)) {
    throw "unsafe workspace root: $WorkspaceRoot"
  }
  $defaultWorkspace = [string]::Equals($workspacePath, (Join-Path $dataDirPath 'agy-workspaces'), [StringComparison]::OrdinalIgnoreCase)
  if ($defaultWorkspace -and -not $dataDirPath.StartsWith($ownerHomePath + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'default AGY workspace is outside the owner home; grant ancestor access manually or choose a workspace inside the owner home'
  }

  $users = @('agy-executor','agy-experiment','agy-reviewer')
  $roleSids = @{}
  $storedCredential = Import-Clixml -LiteralPath $CredentialFile
  if (-not ($storedCredential -is [System.Management.Automation.PSCredential]) -or -not $storedCredential.Password) { throw 'invalid AGY role credential store' }
  $password = $storedCredential.Password
  $usersGroup = Get-LocalGroup -SID 'S-1-5-32-545'
  $adminsGroup = Get-LocalGroup -SID 'S-1-5-32-544'

  foreach ($u in $users) {
    $existing = Get-LocalUser -Name $u -ErrorAction SilentlyContinue
    if (-not $existing) {
      New-LocalUser -Name $u -Password $password -AccountNeverExpires -PasswordNeverExpires -Description "AKIMCP AGY credential identity: $u" | Out-Null
    } else {
      Set-LocalUser -Name $u -Password $password -AccountNeverExpires -PasswordNeverExpires $true
      Enable-LocalUser -Name $u -ErrorAction SilentlyContinue
    }

    $roleSids[$u] = (Get-LocalUser -Name $u).SID
    $userSid = $roleSids[$u].Value
    $inUsers = Get-LocalGroupMember -Group $usersGroup.Name -ErrorAction SilentlyContinue | Where-Object { $_.SID.Value -eq $userSid }
    if (-not $inUsers) {
      Add-LocalGroupMember -Group $usersGroup.Name -Member $u
    }

    $inAdmins = Get-LocalGroupMember -Group $adminsGroup.Name -ErrorAction SilentlyContinue | Where-Object { $_.SID.Value -eq $userSid }
    if ($inAdmins) {
      Remove-LocalGroupMember -Group $adminsGroup.Name -Member $u
    }
  }

  foreach ($u in $users) {
    & icacls.exe $AgyRoot /grant:r "${u}:(OI)(CI)RX" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "icacls failed for $u on AGY root: exit $LASTEXITCODE" }
  }

  if ($defaultWorkspace) {
    $traverseRights = [System.Security.AccessControl.FileSystemRights]::Traverse -bor
      [System.Security.AccessControl.FileSystemRights]::ReadAttributes -bor
      [System.Security.AccessControl.FileSystemRights]::Synchronize
    $ancestor = [System.IO.DirectoryInfo]::new($dataDirPath)
    while ($ancestor -and -not [string]::Equals($ancestor.FullName.TrimEnd([char]'\'), $ownerHomePath, [StringComparison]::OrdinalIgnoreCase)) {
      if ($ancestor.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
        throw "unsafe path contains a reparse point: $($ancestor.FullName)"
      }
      $ancestorAcl = Get-Acl -LiteralPath $ancestor.FullName
      foreach ($u in $users) {
        $ancestorAcl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
          $roleSids[$u], $traverseRights,
          [System.Security.AccessControl.InheritanceFlags]::None,
          [System.Security.AccessControl.PropagationFlags]::None,
          [System.Security.AccessControl.AccessControlType]::Allow
        ))
      }
      Set-Acl -LiteralPath $ancestor.FullName -AclObject $ancestorAcl
      $ancestor = $ancestor.Parent
    }

    $acl = Get-Acl -LiteralPath $workspacePath
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($rule in @($acl.Access)) { $acl.RemoveAccessRuleSpecific($rule) }
    $inheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
    $propagation = [System.Security.AccessControl.PropagationFlags]::None
    $allow = [System.Security.AccessControl.AccessControlType]::Allow
    $full = [System.Security.AccessControl.FileSystemRights]::FullControl
    $modify = [System.Security.AccessControl.FileSystemRights]::Modify
    $read = [System.Security.AccessControl.FileSystemRights]::ReadAndExecute
    $grants = @(
      @{ Sid = $ownerIdentity; Rights = $full },
      @{ Sid = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18'); Rights = $full },
      @{ Sid = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'); Rights = $full },
      @{ Sid = $roleSids['agy-executor']; Rights = $modify },
      @{ Sid = $roleSids['agy-experiment']; Rights = $modify },
      @{ Sid = $roleSids['agy-reviewer']; Rights = $read }
    )
    foreach ($grant in $grants) {
      $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($grant.Sid, $grant.Rights, $inheritance, $propagation, $allow))
    }
    Set-Acl -LiteralPath $workspacePath -AclObject $acl
  } else {
    & icacls.exe $workspacePath /grant:r "agy-executor:(OI)(CI)M" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "icacls failed for agy-executor on workspace: exit $LASTEXITCODE" }
    & icacls.exe $workspacePath /grant:r "agy-experiment:(OI)(CI)M" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "icacls failed for agy-experiment on workspace: exit $LASTEXITCODE" }
    & icacls.exe $workspacePath /grant:r "agy-reviewer:(OI)(CI)RX" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "icacls failed for agy-reviewer on workspace: exit $LASTEXITCODE" }
  }

  if ($ResultFile) {
    [System.IO.File]::WriteAllText($ResultFile, 'OK', [System.Text.Encoding]::UTF8)
  }
  exit 0
}
catch {
  if ($ResultFile) {
    try {
      [System.IO.File]::WriteAllText($ResultFile, $_.Exception.Message, [System.Text.Encoding]::UTF8)
    } catch {}
  }
  exit 1
}
