# A test-owned native window with real accessibility controls and a simple chart. No files or user apps are opened.
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$contextForm = [Windows.Forms.Form]::new()
$contextForm.Text = 'Buddy visual context sample'
$contextForm.ClientSize = [Drawing.Size]::new(800, 600)
$contextForm.BackColor = [Drawing.Color]::White
$contextForm.StartPosition = 'CenterScreen'
$contextHeading = [Windows.Forms.Label]::new()
$contextHeading.Text = 'Quarterly sales'
$contextHeading.Font = [Drawing.Font]::new('Segoe UI', 24)
$contextHeading.Location = [Drawing.Point]::new(40, 30)
$contextHeading.AutoSize = $true
$contextForm.Controls.Add($contextHeading)
$contextBlue = [Windows.Forms.Panel]::new()
$contextBlue.BackColor = [Drawing.ColorTranslator]::FromHtml('#2f7aff')
$contextBlue.Location = [Drawing.Point]::new(70, 130)
$contextBlue.Size = [Drawing.Size]::new(140, 240)
$contextForm.Controls.Add($contextBlue)
$contextOrange = [Windows.Forms.Panel]::new()
$contextOrange.BackColor = [Drawing.ColorTranslator]::FromHtml('#c87525')
$contextOrange.Location = [Drawing.Point]::new(290, 250)
$contextOrange.Size = [Drawing.Size]::new(140, 120)
$contextForm.Controls.Add($contextOrange)
$contextButton = [Windows.Forms.Button]::new()
$contextButton.Text = 'Quarterly sales details'
$contextButton.Location = [Drawing.Point]::new(40, 420)
$contextButton.Size = [Drawing.Size]::new(280, 45)
$contextForm.Controls.Add($contextButton)
Write-Output "SAMPLE_READY $PID"
[void]$contextForm.ShowDialog()
$contextForm.Dispose()
