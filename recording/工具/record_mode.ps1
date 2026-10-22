# record_mode.ps1 - 只在录屏期间关通知，录完必须还原
param([ValidateSet('on','off','status')][string]$Action = 'status')
$k = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Notifications\Settings'
$n = 'NOC_GLOBAL_SETTING_TOASTS_ENABLED'
switch ($Action) {
  'on'   { New-Item -Path $k -Force | Out-Null
           Set-ItemProperty -Path $k -Name $n -Value 0 -Type DWord
           Write-Output 'toasts=OFF (recording started)' }
  'off'  { New-Item -Path $k -Force | Out-Null
           Set-ItemProperty -Path $k -Name $n -Value 1 -Type DWord
           Write-Output 'toasts=ON  (restored)' }
  'status' { $v = (Get-ItemProperty -Path $k -Name $n -ErrorAction SilentlyContinue).$n
           Write-Output ("toasts=" + $(if ($v -eq 0) { 'OFF' } else { 'ON' })) }
}
