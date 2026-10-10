const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const { execFile } = require('child_process');
let win;
const ps = String.raw`$ErrorActionPreference = 'Stop'
try {
 Add-Type -AssemblyName System.Runtime.WindowsRuntime
 $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
 $methods = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq ('IAsyncOperation' + [char]96 + '1') }
 $asTask = $methods | Select-Object -First 1
 $op = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()
 $task = $asTask.MakeGenericMethod([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]).Invoke($null, @($op))
 $manager = $task.GetAwaiter().GetResult()
 $session = $manager.GetCurrentSession()
 if ($null -eq $session) { @{ playing=$false; title=''; artist='' } | ConvertTo-Json -Compress; exit }
 $op2 = $session.TryGetMediaPropertiesAsync()
 $task2 = $asTask.MakeGenericMethod([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]).Invoke($null, @($op2))
 $meta = $task2.GetAwaiter().GetResult()
 $status = $session.GetPlaybackInfo().PlaybackStatus.ToString()
 @{ playing=($status -eq 'Playing'); title=$meta.Title; artist=$meta.Artist; album=$meta.AlbumTitle; app=$session.SourceAppUserModelId; status=$status } | ConvertTo-Json -Compress
} catch { @{ playing=$false; title=''; artist=''; error=$_.Exception.Message } | ConvertTo-Json -Compress }`;
function nowPlaying() {
 return new Promise(resolve => execFile('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-Command',ps],{timeout:6000,windowsHide:true},(err,out)=>{
  try { resolve(JSON.parse(out.trim())); } catch { resolve({playing:false,title:'',artist:'',error:'Windows media session unavailable'}); }
 }));
}
function createWindow() {
 const {width}=screen.getPrimaryDisplay().workAreaSize;
 win=new BrowserWindow({width:390,height:150,minWidth:330,minHeight:120,maxWidth:500,maxHeight:230,x:Math.max(12,width-420),y:48,frame:false,transparent:true,resizable:true,alwaysOnTop:true,skipTaskbar:true,webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false}});
 win.loadFile('index.html');
 win.on('closed',()=>win=null);
}
app.whenReady().then(createWindow);
app.on('window-all-closed',()=>app.quit());
ipcMain.handle('now-playing',nowPlaying);
ipcMain.on('window:close',()=>app.quit());
ipcMain.on('window:minimize',()=>win?.minimize());
ipcMain.on('window:toggle-pin',()=>{if(win)win.setAlwaysOnTop(!win.isAlwaysOnTop());});
