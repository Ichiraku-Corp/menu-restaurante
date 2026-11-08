# Envía un archivo ESC/POS tal cual (RAW) a una impresora instalada en Windows (por ejemplo, por USB).
# Uso: powershell -NoProfile -ExecutionPolicy Bypass -File imprimir-usb.ps1 -Impresora "Nombre" -Archivo "ruta.bin"
param([Parameter(Mandatory=$true)][string]$Impresora, [Parameter(Mandatory=$true)][string]$Archivo)
$ErrorActionPreference = "Stop"
if (-not ("IchirakuRaw" -as [type])) {
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class IchirakuRaw {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO { [MarshalAs(UnmanagedType.LPWStr)] public string pDocName; [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile; [MarshalAs(UnmanagedType.LPWStr)] public string pDataType; }
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] public static extern bool OpenPrinter(string name, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] public static extern int StartDocPrinter(IntPtr h, int level, [In] DOCINFO di);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool WritePrinter(IntPtr h, IntPtr p, int n, out int written);
  public static void Send(string printer, byte[] data) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) throw new Exception("No encuentro la impresora '" + printer + "' (error " + Marshal.GetLastWin32Error() + ")");
    try {
      var di = new DOCINFO { pDocName = "Ichiraku", pDataType = "RAW" };
      if (StartDocPrinter(h, 1, di) == 0) throw new Exception("No se pudo iniciar la impresion (error " + Marshal.GetLastWin32Error() + ")");
      StartPagePrinter(h);
      IntPtr p = Marshal.AllocCoTaskMem(data.Length);
      try { Marshal.Copy(data, 0, p, data.Length); int w; if (!WritePrinter(h, p, data.Length, out w)) throw new Exception("Error al escribir (error " + Marshal.GetLastWin32Error() + ")"); }
      finally { Marshal.FreeCoTaskMem(p); }
      EndPagePrinter(h); EndDocPrinter(h);
    } finally { ClosePrinter(h); }
  }
}
"@
}
# Protección: si Windows tiene un documento de esta impresora trabado en error (papel, tapa, cable),
# lo reintenta desde el principio una y otra vez y la impresora imprime lo mismo sin parar.
# Se quita ese documento y se avisa; el puente vuelve a intentar este ticket más tarde.
$trabados = @()
try { $trabados = @(Get-PrintJob -PrinterName $Impresora -ErrorAction Stop | Where-Object { "$($_.JobStatus)" -match 'Error|Restart' }) } catch { }
if ($trabados.Count -gt 0) {
  foreach ($j in $trabados) { try { Remove-PrintJob -InputObject $j -ErrorAction Stop } catch { } }
  throw "La impresora '$Impresora' tenía un documento trabado en error (se quitó). Revisa papel, tapa y cable; se reintenta solo."
}
[IchirakuRaw]::Send($Impresora, [System.IO.File]::ReadAllBytes($Archivo))
