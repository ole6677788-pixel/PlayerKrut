const { app, BrowserWindow, ipcMain, screen, shell } = require('electron');
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
 if ($null -eq $session) { @{ playing=$false; title=''; artist=''; album=''; app=''; thumbnail='' } | ConvertTo-Json -Compress; exit }
 $op2 = $session.TryGetMediaPropertiesAsync()
 $task2 = $asTask.MakeGenericMethod([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]).Invoke($null, @($op2))
 $meta = $task2.GetAwaiter().GetResult()
 $status = $session.GetPlaybackInfo().PlaybackStatus.ToString()
 $thumbnail = ''
 $thumbnailType = 'image/jpeg'
 try {
   if ($null -ne $meta.Thumbnail) {
     $streamOp = $meta.Thumbnail.OpenReadAsync()
     $streamTask = $asTask.MakeGenericMethod([Windows.Storage.Streams.IRandomAccessStreamWithContentType]).Invoke($null, @($streamOp))
     $stream = $streamTask.GetAwaiter().GetResult()
     if ($stream.ContentType) { $thumbnailType = $stream.ContentType }
     if ($stream.Size -gt 0 -and $stream.Size -lt 5000000) {
       $reader = [Windows.Storage.Streams.DataReader]::new($stream.GetInputStreamAt(0))
       $loadOp = $reader.LoadAsync([uint32]$stream.Size)
       $loadTask = $asTask.MakeGenericMethod([uint32]).Invoke($null, @($loadOp))
       $null = $loadTask.GetAwaiter().GetResult()
       $bytes = New-Object byte[] ([int]$stream.Size)
       $reader.ReadBytes($bytes)
       $thumbnail = [Convert]::ToBase64String($bytes)
       $reader.Dispose()
     }
   }
 } catch { $thumbnail = '' }
 @{ playing=($status -eq 'Playing'); title=$meta.Title; artist=$meta.Artist; album=$meta.AlbumTitle; app=$session.SourceAppUserModelId; status=$status; thumbnail=$thumbnail; thumbnailType=$thumbnailType } | ConvertTo-Json -Compress
} catch { @{ playing=$false; title=''; artist=''; album=''; app=''; thumbnail=''; error=$_.Exception.Message } | ConvertTo-Json -Compress }`;
function runPowerShell(script, timeout = 8000) {
 return new Promise(resolve => execFile('powershell.exe', ['-NoProfile','-ExecutionPolicy','Bypass','-Command',script], {timeout, windowsHide:true, maxBuffer: 10 * 1024 * 1024}, (err,out) => resolve({err,out})));
}
async function nowPlaying() {
 const {out} = await runPowerShell(ps);
 try { return JSON.parse(out.trim()); }
 catch { return {playing:false,title:'',artist:'',album:'',app:'',thumbnail:'',error:'Windows media session unavailable'}; }
}
async function mediaControl(action) {
 const script = `$ErrorActionPreference='Stop'
try {
 Add-Type -AssemblyName System.Runtime.WindowsRuntime
 $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
 $methods = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq ('IAsyncOperation' + [char]96 + '1') }
 $asTask = $methods | Select-Object -First 1
 $op = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()
 $task = $asTask.MakeGenericMethod([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]).Invoke($null, @($op))
 $manager = $task.GetAwaiter().GetResult()
 $session = $manager.GetCurrentSession()
 if ($null -eq $session) { 'NO_SESSION'; exit }
 switch ('ACTION_PLACEHOLDER') {
  'playpause' { $null = $session.TryTogglePlayPauseAsync() }
  'next' { $null = $session.TrySkipNextAsync() }
  'previous' { $null = $session.TrySkipPreviousAsync() }
 }
 'OK'
} catch { 'ERROR: ' + $_.Exception.Message }`;
 const safeScript = script.replace('ACTION_PLACEHOLDER', action);
 const {out} = await runPowerShell(safeScript, 6000);
 return {ok:out.trim()==='OK',message:out.trim()};
}
async function openSourceApp() {
 const d = await nowPlaying();
 const appId = String(d.app || '').trim();
 if (!appId) return {ok:false};
 const escaped = appId.replace(/'/g, "''");
 if (appId.includes('!')) {
   const packaged = `$id = 'APP_ID_PLACEHOLDER'; try { Start-Process explorer.exe -ArgumentList ('shell:AppsFolder\\' + $id); 'OK' } catch { 'ERROR' }`;
   const {out:launchOut} = await runPowerShell(packaged.replace('APP_ID_PLACEHOLDER', escaped), 5000);
   if (launchOut.trim() === 'OK') return {ok:true};
 }
 const script = `$id = 'APP_ID_PLACEHOLDER'
try {
 $entry = Get-StartApps | Where-Object { $_.AppID -eq $id -or $_.Name -like ('*' + [IO.Path]::GetFileNameWithoutExtension($id) + '*') } | Select-Object -First 1
 if ($entry) { Start-Process explorer.exe -ArgumentList ('shell:AppsFolder\\' + $entry.AppID); 'OK' } else { 'NOT_FOUND' }
} catch { 'ERROR' }`;
 const {out} = await runPowerShell(script.replace('APP_ID_PLACEHOLDER', escaped), 5000);
 return {ok:out.trim()==='OK'};
}
function createWindow() {
 const {width}=screen.getPrimaryDisplay().workAreaSize;
 win=new BrowserWindow({width:480,height:390,minWidth:360,minHeight:300,maxWidth:760,maxHeight:600,x:Math.max(12,width-460),y:48,frame:false,transparent:true,resizable:true,alwaysOnTop:true,skipTaskbar:true,webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false}});
 win.loadFile('index.html');
 win.on('closed',()=>win=null);
}
app.whenReady().then(createWindow);
app.on('window-all-closed',()=>app.quit());
ipcMain.handle('now-playing',nowPlaying);
ipcMain.handle('media-control',(_event,action)=>['playpause','next','previous'].includes(action)?mediaControl(action):{ok:false});
ipcMain.handle('open-source-app',openSourceApp);
ipcMain.on('window:close',()=>app.quit());
ipcMain.on('window:minimize',()=>win?.minimize());
ipcMain.on('window:toggle-pin',()=>{if(win)win.setAlwaysOnTop(!win.isAlwaysOnTop());});
ipcMain.on('window:scale',(_event,delta)=>{if(!win)return;const [w,h]=win.getSize();const step=Number(delta)||0;const nw=Math.max(360,Math.min(760,w+step));const nh=Math.max(300,Math.min(600,h+Math.round(step*0.65)));win.setMinimumSize(360,300);win.setMaximumSize(760,600);win.setSize(nw,nh,true);win.center();});
