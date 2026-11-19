# Turns the demo's sales export (make-demo-sales.mjs) into the workbook the demo opens (docs/DEMO.md): the same rows,
# saved as .xlsx so Excel shows no "possible data loss" bar, with columns sized to their contents (no ######## dates),
# a bold header and the top row frozen. Uses a hidden Excel of its own and closes it.
#   powershell -NoProfile -File scripts/make-demo-workbook.ps1
$ErrorActionPreference = "Stop"
$folder = Join-Path $PSScriptRoot "samples\demo"
$csv = Join-Path $folder "Regional sales.csv"
$xlsx = Join-Path $folder "Regional sales.xlsx"
$excel = New-Object -ComObject Excel.Application
try {
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $book = $excel.Workbooks.Open($csv)
  $sheet = $book.Worksheets.Item(1)
  $sheet.Name = "Regional sales"
  $sheet.Range("B:B").NumberFormat = "yyyy-mm-dd"
  $sheet.Rows.Item(1).Font.Bold = $true
  $sheet.UsedRange.Columns.AutoFit() | Out-Null
  # Freezing the top row is a window setting: it needs the sheet active in a window, even a hidden one.
  $sheet.Activate()
  $excel.ActiveWindow.SplitRow = 1
  $excel.ActiveWindow.FreezePanes = $true
  $sheet.Range("A1").Select() | Out-Null
  if (Test-Path $xlsx) { Remove-Item $xlsx }
  $book.SaveAs($xlsx, 51) # 51: an Excel workbook (.xlsx)
  $book.Close($false)
  "Wrote $xlsx"
} finally {
  $excel.Quit()
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
}
