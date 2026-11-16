param([switch]$Focus, [string]$Title = 'Buddy visual context sample')
# A test-owned native window with real accessibility controls and a simple chart. No files or user apps are opened.
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
if ($Focus) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SampleWindowFocus {
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, IntPtr process);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint from, uint to, bool attach);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr window);
    public static void Activate(IntPtr window) {
        uint current = GetCurrentThreadId();
        uint foreground = GetWindowThreadProcessId(GetForegroundWindow(), IntPtr.Zero);
        bool attached = current != foreground && AttachThreadInput(current, foreground, true);
        try { BringWindowToTop(window); SetForegroundWindow(window); }
        finally { if (attached) AttachThreadInput(current, foreground, false); }
    }
}
'@
}
$contextForm = [Windows.Forms.Form]::new()
$contextForm.Text = $Title
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
$contextDestination = [Windows.Forms.Button]::new()
$contextDestination.Text = 'Destination'
$contextDestination.Location = [Drawing.Point]::new(400, 420)
$contextDestination.Size = [Drawing.Size]::new(200, 45)
$contextForm.Controls.Add($contextDestination)
$contextButton.Add_Click({
    $contextDestination.Text = 'Details opened'
    $contextDestination.Left += 20
})
if ($Focus) {
    $contextForm.Add_Shown({ [SampleWindowFocus]::Activate($contextForm.Handle) })
}
Write-Output "SAMPLE_READY $PID"
[void]$contextForm.ShowDialog()
$contextForm.Dispose()
