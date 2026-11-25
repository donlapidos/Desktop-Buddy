param([string]$Title = 'Buddy starter sample')
# A test-owned stand-in for Windows' Calculator, for the first-minute check: the two controls the starter lesson
# (src/lessons.js STARTER) points at, with the same names. "Open Navigation" shows "Scientific Calculator", as
# Calculator's menu does; choosing it closes the menu. Launching and closing the real Calculator over and over (a
# Store app) proved too unreliable for a check: its start-up time varies and its windows outlive the process.
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
# Comes to the front as a window the user just asked for does (the check's click isn't real input, so Windows wouldn't
# give it the foreground by itself).
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class StarterWindowFocus {
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
$form = [Windows.Forms.Form]::new()
$form.Text = $Title
$form.ClientSize = [Drawing.Size]::new(420, 360)
$form.BackColor = [Drawing.Color]::White
$form.StartPosition = 'CenterScreen'
$open = [Windows.Forms.Button]::new()
$open.Text = 'Open Navigation'
$open.Location = [Drawing.Point]::new(20, 20)
$open.Size = [Drawing.Size]::new(180, 40)
$form.Controls.Add($open)
$mode = [Windows.Forms.Label]::new()
$mode.Text = 'Standard'
$mode.Font = [Drawing.Font]::new('Segoe UI', 18)
$mode.Location = [Drawing.Point]::new(220, 24)
$mode.AutoSize = $true
$form.Controls.Add($mode)
$scientific = [Windows.Forms.Button]::new()
$scientific.Text = 'Scientific Calculator'
$scientific.Location = [Drawing.Point]::new(20, 90)
$scientific.Size = [Drawing.Size]::new(220, 40)
$scientific.Visible = $false
$form.Controls.Add($scientific)
$open.Add_Click({ $scientific.Visible = $true })
$scientific.Add_Click({
    $scientific.Visible = $false
    $mode.Text = 'Scientific'
})
$form.Add_Shown({ [StarterWindowFocus]::Activate($form.Handle) })
[void]$form.ShowDialog()
