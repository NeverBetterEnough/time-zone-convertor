Add-Type -AssemblyName System.Drawing
$taskIconRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'icons'
foreach ($taskIconSize in @(16,32,48,128)) {
  $taskBitmap = [System.Drawing.Bitmap]::new($taskIconSize,$taskIconSize)
  $taskGraphics = [System.Drawing.Graphics]::FromImage($taskBitmap)
  $taskGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $taskGraphics.ScaleTransform($taskIconSize / 128.0,$taskIconSize / 128.0)
  $taskGraphics.Clear([System.Drawing.Color]::Transparent)
  $taskPath = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $taskPath.AddArc(0,0,52,52,180,90)
  $taskPath.AddArc(76,0,52,52,270,90)
  $taskPath.AddArc(76,76,52,52,0,90)
  $taskPath.AddArc(0,76,52,52,90,90)
  $taskPath.CloseFigure()
  $taskBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#13786b'))
  $taskGraphics.FillPath($taskBrush,$taskPath)
  $taskPen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml('#cce8d9'),5)
  $taskGraphics.DrawEllipse($taskPen,25,25,78,78)
  $taskPen.Color = [System.Drawing.Color]::White
  $taskPen.Width = 7
  $taskPen.StartCap = $taskPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $taskGraphics.DrawLine($taskPen,64,37,64,65)
  $taskGraphics.DrawLine($taskPen,64,65,82,76)
  $taskBrush.Color = [System.Drawing.ColorTranslator]::FromHtml('#e4bd76')
  $taskGraphics.FillEllipse($taskBrush,86,16,26,26)
  $taskPen.Color = [System.Drawing.ColorTranslator]::FromHtml('#26594b')
  $taskPen.Width = 3
  $taskGraphics.DrawLine($taskPen,99,22,99,36)
  $taskGraphics.DrawLine($taskPen,92,29,106,29)
  $taskBitmap.Save((Join-Path $taskIconRoot "icon$taskIconSize.png"),[System.Drawing.Imaging.ImageFormat]::Png)
  $taskPen.Dispose(); $taskBrush.Dispose(); $taskPath.Dispose(); $taskGraphics.Dispose(); $taskBitmap.Dispose()
}
Write-Output 'Generated 16/32/48/128px extension icons.'
