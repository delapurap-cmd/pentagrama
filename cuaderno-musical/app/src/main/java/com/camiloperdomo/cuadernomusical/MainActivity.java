package com.camiloperdomo.cuadernomusical;

import android.Manifest;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMetadataRetriever;
import android.media.MediaPlayer;
import android.media.MediaRecorder;
import android.media.PlaybackParams;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.database.Cursor;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import androidx.appcompat.app.AppCompatActivity;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.app.ActivityCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import com.yausername.ffmpeg.FFmpeg;
import com.yausername.youtubedl_android.YoutubeDL;
import com.yausername.youtubedl_android.YoutubeDLRequest;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.ByteArrayOutputStream;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.text.SimpleDateFormat;
import java.util.Arrays;
import java.util.Date;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.nio.charset.StandardCharsets;

import kotlin.Unit;

public class MainActivity extends AppCompatActivity {
    private WebView web;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Handler timer = new Handler(Looper.getMainLooper());
    private SharedPreferences tracks;
    private File audioDir;
    private File voiceDir;
    private MediaPlayer player;
    private String playingId = "";
    private String playingSongId = "";
    private String playingKind = "song";
    private String playingPath = "";
    private String playingTitle = "";
    private long loopA = 0;
    private long loopB = Long.MAX_VALUE;
    private boolean loopEnabled = false;
    private float speed = 1f;
    private float pitch = 1f;
    private volatile boolean engineReady = false;
    private MediaRecorder recorder;
    private File recordingFile;
    private String recordingSongId = "";
    private String recordingSongTitle = "";
    private String pendingVoiceId = "";
    private String pendingVoiceTitle = "";
    private static final int REQUEST_RECORD_AUDIO = 4207;
    private static final int REQUEST_MEDIA_AUDIO = 4208;
    private volatile String pendingBackupJson;
    private volatile boolean backupQueued = false;
    private final ActivityResultLauncher<Intent> backupPicker = registerForActivityResult(
        new ActivityResultContracts.StartActivityForResult(), result -> {
            if (result.getResultCode() != RESULT_OK || result.getData() == null || result.getData().getData() == null) return;
            Uri uri = result.getData().getData();
            worker.execute(() -> {
                try (InputStream in = getContentResolver().openInputStream(uri)) {
                    if (in == null) throw new Exception("No se pudo abrir la copia");
                    String json = readStream(in);
                    sendJs("window.nativeBackupImported&&window.nativeBackupImported(" + JSONObject.quote(json) + ")");
                } catch (Exception e) {
                    sendBackup("error", "No se pudo importar la copia");
                }
            });
        });

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        tracks = getSharedPreferences("tracks", MODE_PRIVATE);
        audioDir = new File(getExternalFilesDir(Environment.DIRECTORY_MUSIC), "CuadernoMusical");
        audioDir.mkdirs();
        voiceDir = new File(audioDir, "NotasDeVoz");
        voiceDir.mkdirs();

        web = new WebView(this);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient());
        web.addJavascriptInterface(new NotebookBridge(), "Native");

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xff121418);
        root.addView(web, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ));
        setContentView(root);
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            Insets safe = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
            return insets;
        });
        ViewCompat.requestApplyInsets(root);
        web.loadUrl("file:///android_asset/cuaderno.html");
        if (Build.VERSION.SDK_INT >= 33 &&
            ActivityCompat.checkSelfPermission(this, Manifest.permission.READ_MEDIA_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.READ_MEDIA_AUDIO}, REQUEST_MEDIA_AUDIO);
        } else if (Build.VERSION.SDK_INT < 33 &&
            ActivityCompat.checkSelfPermission(this, Manifest.permission.READ_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.READ_EXTERNAL_STORAGE}, REQUEST_MEDIA_AUDIO);
        }

        worker.execute(() -> {
            try {
                YoutubeDL.getInstance().init(getApplication());
                FFmpeg.getInstance().init(getApplication());
                try {
                    YoutubeDL.getInstance().updateYoutubeDL(getApplicationContext(), YoutubeDL.UpdateChannel._STABLE);
                } catch (Exception ignored) {
                    // El motor incluido sigue disponible si no hay actualización o no hay red.
                }
                engineReady = true;
                sendJs("window.nativeEngineReady&&window.nativeEngineReady()") ;
            } catch (Exception e) {
                sendJs("window.nativeEngineError&&window.nativeEngineError(" + JSONObject.quote(e.getMessage()) + ")");
            }
        });
        timer.post(ticker);
    }

    private final Runnable ticker = new Runnable() {
        @Override public void run() {
            try {
                if (player != null) {
                    long position = player.getCurrentPosition();
                    if (loopEnabled && loopB > loopA && position >= loopB) {
                        player.seekTo((int) loopA);
                        position = loopA;
                    }
                    sendPlayerState(position);
                }
            } catch (Exception ignored) { }
            timer.postDelayed(this, 100);
        }
    };

    private void sendJs(String script) {
        runOnUiThread(() -> web.evaluateJavascript(script, null));
    }

    private void sendPlayerState(long position) {
        try {
            JSONObject data = new JSONObject();
            data.put("id", playingId);
            data.put("songId", playingSongId);
            data.put("kind", playingKind);
            data.put("title", playingTitle);
            data.put("position", position);
            data.put("duration", player == null ? 0 : player.getDuration());
            data.put("playing", player != null && player.isPlaying());
            data.put("loop", loopEnabled);
            sendJs("window.nativePlayerState&&window.nativePlayerState(" + data + ")");
        } catch (Exception ignored) { }
    }

    private final class NotebookBridge {
        @JavascriptInterface public boolean isEngineReady() {
            return engineReady;
        }

        @JavascriptInterface public String getTrackState(String id, String title) {
            try {
                String path = tracks.getString(id + ".path", "");
                if (path.isEmpty() || !new File(path).isFile()) {
                    File recovered = recoverPublicTrack(id, title);
                    path = recovered == null ? "" : recovered.getAbsolutePath();
                }
                if (path.isEmpty() || !new File(path).isFile()) return "{}";
                JSONObject o = new JSONObject();
                o.put("downloaded", true);
                o.put("path", path);
                o.put("duration", tracks.getLong(id + ".duration", 0));
                o.put("wave", new JSONArray(tracks.getString(id + ".wave", "[]")));
                return o.toString();
            } catch (Exception e) { return "{}"; }
        }

        @JavascriptInterface public void download(String id, String url, String title) {
            worker.execute(() -> downloadTrack(id, url, title));
        }

        @JavascriptInterface public void removeTrack(String id) {
            worker.execute(() -> deleteTrack(id));
        }

        @JavascriptInterface public void play(String id, String title) {
            runOnUiThread(() -> startTrack(id, title));
        }

        @JavascriptInterface public void toggle() {
            runOnUiThread(() -> {
                try {
                    if (player == null) return;
                    if (player.isPlaying()) player.pause(); else player.start();
                    sendPlayerState(player.getCurrentPosition());
                } catch (Exception ignored) { }
            });
        }

        @JavascriptInterface public void replay() {
            runOnUiThread(() -> {
                try {
                    if (player == null) return;
                    player.seekTo(0);
                    player.start();
                    sendPlayerState(0);
                } catch (Exception ignored) { }
            });
        }

        @JavascriptInterface public void pause() {
            runOnUiThread(() -> {
                try {
                    if (player != null && player.isPlaying()) {
                        player.pause();
                        sendPlayerState(player.getCurrentPosition());
                    }
                } catch (Exception ignored) { }
            });
        }

        @JavascriptInterface public void seek(long millis) {
            runOnUiThread(() -> { if (player != null) player.seekTo((int) millis); });
        }

        @JavascriptInterface public void setLoop(long a, long b, boolean enabled) {
            loopA = Math.max(0, a);
            loopB = Math.max(loopA, b);
            loopEnabled = enabled;
        }

        @JavascriptInterface public void setSpeed(double value) {
            speed = (float)Math.max(.5, Math.min(1.5, value));
            runOnUiThread(() -> applyPlaybackParams());
        }

        @JavascriptInterface public void setPitch(double semitones) {
            pitch = (float)Math.pow(2.0, Math.max(-6, Math.min(6, semitones)) / 12.0);
            runOnUiThread(() -> applyPlaybackParams());
        }

        @JavascriptInterface public void startVoiceNote(String songId, String title) {
            runOnUiThread(() -> requestVoiceRecording(songId, title));
        }

        @JavascriptInterface public void stopVoiceNote() {
            runOnUiThread(() -> stopVoiceRecording(true));
        }

        @JavascriptInterface public String getVoiceNotes(String songId) {
            return voiceNotesJson(songId);
        }

        @JavascriptInterface public void playVoiceNote(String songId, String path, String label) {
            runOnUiThread(() -> playVoiceRecording(songId, path, label));
        }

        @JavascriptInterface public void deleteVoiceNote(String songId, String path) {
            worker.execute(() -> deleteVoiceRecording(songId, path));
        }

        @JavascriptInterface public void autoBackup(String json) {
            queueAutomaticBackup(json);
        }

        @JavascriptInterface public String restoreBackup() {
            return readAutomaticBackup();
        }

        @JavascriptInterface public void exportBackup(String json) {
            worker.execute(() -> writeExportBackup(json));
        }

        @JavascriptInterface public void importBackup() {
            runOnUiThread(() -> {
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                backupPicker.launch(intent);
            });
        }
    }

    private void queueAutomaticBackup(String json) {
        synchronized (this) {
            pendingBackupJson = json;
            if (backupQueued) return;
            backupQueued = true;
        }
        worker.execute(() -> {
            while (true) {
                String latest;
                synchronized (MainActivity.this) {
                    latest = pendingBackupJson;
                    pendingBackupJson = null;
                    if (latest == null) { backupQueued = false; return; }
                }
                try { writeNamedBackup("reper-autobackup.json", latest, true); }
                catch (Exception e) { sendBackup("error", "No se pudo actualizar la copia automática"); }
            }
        });
    }

    private String readAutomaticBackup() {
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                Uri uri = findDownload("reper-autobackup.json", "Documents/Reper/");
                if (uri == null) return "";
                try (InputStream in = getContentResolver().openInputStream(uri)) {
                    return in == null ? "" : readStream(in);
                }
            }
            File file = new File(new File(Environment.getExternalStoragePublicDirectory(
                Environment.DIRECTORY_DOCUMENTS), "Reper"), "reper-autobackup.json");
            if (!file.isFile()) return "";
            try (InputStream in = new FileInputStream(file)) { return readStream(in); }
        } catch (Exception e) { return ""; }
    }

    private void writeExportBackup(String json) {
        String stamp = new SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(new Date());
        try {
            writeNamedBackup("Reper-copia-" + stamp + ".json", json, false);
            sendBackup("exported", "Copia guardada en Documentos/Reper");
        } catch (Exception e) {
            sendBackup("error", "No se pudo exportar la copia");
        }
    }

    private void writeNamedBackup(String name, String json, boolean replace) throws Exception {
        if (Build.VERSION.SDK_INT >= 29) {
            Uri uri = replace ? findDownload(name, "Documents/Reper/") : null;
            if (uri == null) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, name);
                values.put(MediaStore.Downloads.MIME_TYPE, "application/json");
                values.put(MediaStore.Downloads.RELATIVE_PATH, "Documents/Reper/");
                uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            }
            if (uri == null) throw new Exception("No se pudo crear la copia");
            try (OutputStream out = getContentResolver().openOutputStream(uri, "wt")) {
                if (out == null) throw new Exception("No se pudo escribir la copia");
                out.write(json.getBytes(StandardCharsets.UTF_8));
            }
            return;
        }
        File folder = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS), "Reper");
        if (!folder.exists() && !folder.mkdirs()) throw new Exception("No se pudo crear Reper");
        try (OutputStream out = new FileOutputStream(new File(folder, name), false)) {
            out.write(json.getBytes(StandardCharsets.UTF_8));
        }
    }

    private Uri findDownload(String name, String relativePath) {
        if (Build.VERSION.SDK_INT < 29) return null;
        String[] projection = { MediaStore.Downloads._ID };
        String selection = MediaStore.Downloads.DISPLAY_NAME + "=? AND " + MediaStore.Downloads.RELATIVE_PATH + "=?";
        try (Cursor cursor = getContentResolver().query(MediaStore.Downloads.EXTERNAL_CONTENT_URI,
            projection, selection, new String[]{name, relativePath}, MediaStore.Downloads.DATE_MODIFIED + " DESC")) {
            if (cursor != null && cursor.moveToFirst()) {
                return Uri.withAppendedPath(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cursor.getString(0));
            }
        } catch (Exception ignored) { }
        return null;
    }

    private String readStream(InputStream in) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[32 * 1024];
        int n;
        while ((n = in.read(buffer)) > 0) out.write(buffer, 0, n);
        return out.toString(StandardCharsets.UTF_8.name());
    }

    private void sendBackup(String state, String message) {
        try {
            JSONObject o = new JSONObject();
            o.put("state", state); o.put("message", message);
            sendJs("window.nativeBackupState&&window.nativeBackupState(" + o + ")");
        } catch (Exception ignored) { }
    }

    private File recoverPublicTrack(String id, String title) {
        if (Build.VERSION.SDK_INT < 29 || title == null || title.isEmpty()) return null;
        if (Build.VERSION.SDK_INT >= 33 &&
            ActivityCompat.checkSelfPermission(this, Manifest.permission.READ_MEDIA_AUDIO) != PackageManager.PERMISSION_GRANTED) return null;
        String display = safeTitle(title) + ".mp3";
        String[] projection = { MediaStore.Audio.Media._ID };
        String selection = MediaStore.Audio.Media.DISPLAY_NAME + "=? AND (" +
            MediaStore.Audio.Media.RELATIVE_PATH + "=? OR " + MediaStore.Audio.Media.RELATIVE_PATH + "=?)";
        try (Cursor cursor = getContentResolver().query(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
            projection, selection, new String[]{display, "Music/Reper/", "Music/Cuaderno Musical/"},
            MediaStore.Audio.Media.DATE_ADDED + " DESC")) {
            if (cursor == null || !cursor.moveToFirst()) return null;
            Uri uri = Uri.withAppendedPath(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, cursor.getString(0));
            File target = new File(audioDir, safeId(id) + ".mp3");
            try (InputStream in = getContentResolver().openInputStream(uri);
                 OutputStream out = new FileOutputStream(target, false)) {
                if (in == null) return null;
                byte[] buffer = new byte[128 * 1024]; int n;
                while ((n = in.read(buffer)) > 0) out.write(buffer, 0, n);
            }
            long duration = readDuration(target);
            tracks.edit().putString(id + ".path", target.getAbsolutePath()).putString(id + ".title", title)
                .putString(id + ".wave", "[]").putLong(id + ".duration", duration)
                .putString(id + ".publicUri", uri.toString()).commit();
            return target;
        } catch (Exception e) { return null; }
    }

    private void downloadTrack(String id, String url, String title) {
        sendDownload(id, 0, "downloading", "Preparando…");
        File target = new File(audioDir, safeId(id) + ".mp3");
        try {
            if (target.exists() && !target.delete()) throw new Exception("No se pudo reemplazar el audio anterior");
            YoutubeDLRequest request = new YoutubeDLRequest(url);
            request.addOption("--no-playlist");
            request.addOption("-x");
            request.addOption("--audio-format", "mp3");
            request.addOption("--audio-quality", "0");
            request.addOption("--embed-metadata");
            request.addOption("-o", target.getAbsolutePath());
            YoutubeDL.getInstance().execute(request, "download-" + id, (progress, eta, line) -> {
                // yt-dlp llega a 100 antes de terminar la conversión y el guardado.
                // La interfaz reserva 100 exclusivamente para un MP3 listo para reproducirse.
                sendDownload(id, Math.min(94, Math.round(progress * .94f)), "downloading", "Descargando…");
                return Unit.INSTANCE;
            });
            if (!target.isFile()) throw new Exception("La descarga no produjo un archivo MP3");
            sendDownload(id, 96, "processing", "Guardando MP3…");
            long duration = readDuration(target);
            Uri publicUri = copyToPublicMusic(target, title, id);
            tracks.edit()
                .putString(id + ".path", target.getAbsolutePath())
                .putString(id + ".title", title)
                .putString(id + ".wave", "[]")
                .putLong(id + ".duration", duration)
                .putString(id + ".publicUri", publicUri == null ? "" : publicUri.toString())
                .commit();
            sendDownload(id, 100, "ready", "MP3 listo");

            // La forma de onda se calcula después, sin mantener bloqueado el botón Play.
            String wave = extractWaveform(target, 180).toString();
            tracks.edit().putString(id + ".wave", wave).apply();
            sendDownload(id, 100, "waveform", "");
        } catch (Exception e) {
            sendDownload(id, 0, "error", e.getMessage() == null ? "Error de descarga" : e.getMessage());
        }
    }

    private void sendDownload(String id, int progress, String state, String message) {
        try {
            JSONObject o = new JSONObject();
            o.put("id", id); o.put("progress", progress); o.put("state", state); o.put("message", message);
            sendJs("window.nativeDownloadState&&window.nativeDownloadState(" + o + ")");
        } catch (Exception ignored) { }
    }

    private void startTrack(String id, String title) {
        String path = tracks.getString(id + ".path", "");
        if (path.isEmpty() || !new File(path).isFile()) {
            sendDownload(id, 0, "error", "Primero descarga esta canción");
            return;
        }
        startMediaFile(path, id, id, title, "song");
    }

    private void startMediaFile(String path, String id, String songId, String title, String kind) {
        try {
            if (player != null) {
                try { player.stop(); } catch (Exception ignored) { }
                player.release();
                player = null;
                sendPlayerState(0);          // la pista anterior deja de contar al instante
            }
            player = new MediaPlayer();
            player.setDataSource(path);
            player.prepare();
            playingId = id;
            playingSongId = songId;
            playingKind = kind;
            playingPath = path;
            playingTitle = title;
            loopA = 0;
            loopB = player.getDuration();
            loopEnabled = false;
            applyPlaybackParams();
            player.setOnCompletionListener(mp -> {
                if (loopEnabled) { mp.seekTo((int)loopA); mp.start(); }
                else {
                    sendPlayerState(mp.getDuration());
                    sendJs("window.nativeTrackEnded&&window.nativeTrackEnded(" + JSONObject.quote(playingId) + ")");
                }
            });
            player.start();
            sendPlayerState(0);
        } catch (Exception e) {
            if ("voice".equals(kind)) sendVoice("error", songId, id, null, "No se pudo reproducir la nota");
            else sendDownload(id, 0, "error", "No se pudo reproducir el archivo");
        }
    }

    private void requestVoiceRecording(String songId, String title) {
        if (recorder != null) return;
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            pendingVoiceId = songId;
            pendingVoiceTitle = title;
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.RECORD_AUDIO}, REQUEST_RECORD_AUDIO);
            return;
        }
        startVoiceRecording(songId, title);
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == REQUEST_MEDIA_AUDIO) {
            sendJs("window.nativeMediaPermission&&window.nativeMediaPermission()");
            return;
        }
        if (requestCode != REQUEST_RECORD_AUDIO) return;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) {
            startVoiceRecording(pendingVoiceId, pendingVoiceTitle);
        } else {
            sendVoice("error", pendingVoiceId, "", null, "Permiso de micrófono denegado");
        }
        pendingVoiceId = "";
        pendingVoiceTitle = "";
    }

    private void startVoiceRecording(String songId, String title) {
        try {
            if (player != null && player.isPlaying()) player.pause();
            File folder = new File(voiceDir, safeId(songId));
            if (!folder.exists() && !folder.mkdirs()) throw new Exception("No se pudo crear la carpeta de notas");
            recordingFile = new File(folder, "nota-" + System.currentTimeMillis() + ".m4a");
            recorder = Build.VERSION.SDK_INT >= 31 ? new MediaRecorder(this) : new MediaRecorder();
            recorder.setAudioSource(MediaRecorder.AudioSource.MIC);
            recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
            recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
            recorder.setAudioSamplingRate(48000);
            recorder.setAudioEncodingBitRate(256000);
            recorder.setAudioChannels(1);
            recorder.setOutputFile(recordingFile.getAbsolutePath());
            recorder.prepare();
            recorder.start();
            recordingSongId = songId;
            recordingSongTitle = title;
            sendVoice("recording", songId, "", null, "Grabando nota de voz…");
        } catch (Exception e) {
            releaseRecorder();
            if (recordingFile != null) recordingFile.delete();
            recordingFile = null;
            sendVoice("error", songId, "", null, "No se pudo iniciar el micrófono");
        }
    }

    private void stopVoiceRecording(boolean process) {
        if (recorder == null) return;
        File file = recordingFile;
        String songId = recordingSongId;
        try {
            recorder.stop();
        } catch (Exception e) {
            if (file != null) file.delete();
            process = false;
            sendVoice("error", songId, "", null, "La grabación fue demasiado corta");
        } finally {
            releaseRecorder();
            recordingFile = null;
            recordingSongId = "";
            recordingSongTitle = "";
        }
        if (!process || file == null || !file.isFile()) return;
        sendVoice("processing", songId, "", null, "Preparando nota…");
        worker.execute(() -> {
            long duration = readDuration(file);
            JSONArray wave = extractWaveform(file, 180);
            String key = voiceKey(songId, file);
            Uri publicUri = null;
            try { publicUri = copyVoiceToPublicMusic(file, songId); } catch (Exception ignored) { }
            tracks.edit().putLong(key + ".duration", duration).putString(key + ".wave", wave.toString())
                .putString(key + ".publicUri", publicUri == null ? "" : publicUri.toString()).apply();
            String id = "voice:" + safeId(songId) + ":" + file.getName();
            sendVoice("ready", songId, id, wave, "Nota de voz lista");
        });
    }

    private void releaseRecorder() {
        if (recorder == null) return;
        try { recorder.reset(); } catch (Exception ignored) { }
        try { recorder.release(); } catch (Exception ignored) { }
        recorder = null;
    }

    private String voiceNotesJson(String songId) {
        JSONArray out = new JSONArray();
        try {
            recoverPublicVoiceNotes(songId);
            File folder = new File(voiceDir, safeId(songId));
            File[] files = folder.listFiles((dir, name) -> name.endsWith(".m4a"));
            if (files == null) return out.toString();
            Arrays.sort(files, (a, b) -> Long.compare(b.lastModified(), a.lastModified()));
            SimpleDateFormat label = new SimpleDateFormat("'Nota' dd/MM HH:mm", Locale.getDefault());
            for (File file : files) {
                String key = voiceKey(songId, file);
                JSONObject o = new JSONObject();
                o.put("id", "voice:" + safeId(songId) + ":" + file.getName());
                o.put("path", file.getAbsolutePath());
                o.put("label", label.format(new Date(file.lastModified())));
                long duration = tracks.getLong(key + ".duration", -1);
                if (duration < 0) duration = readDuration(file);
                o.put("duration", duration);
                o.put("wave", new JSONArray(tracks.getString(key + ".wave", "[]")));
                out.put(o);
            }
        } catch (Exception ignored) { }
        return out.toString();
    }

    private void playVoiceRecording(String songId, String path, String label) {
        try {
            File file = validatedVoiceFile(songId, path);
            if (file == null || !file.isFile()) throw new Exception("missing");
            String id = "voice:" + safeId(songId) + ":" + file.getName();
            startMediaFile(file.getAbsolutePath(), id, songId, label, "voice");
        } catch (Exception e) {
            sendVoice("error", songId, "", null, "La nota de voz ya no existe");
        }
    }

    private void deleteVoiceRecording(String songId, String path) {
        try {
            File file = validatedVoiceFile(songId, path);
            if (file == null) return;
            if (file.getAbsolutePath().equals(playingPath)) runOnUiThread(() -> {
                if (player != null) { try { player.stop(); player.release(); } catch (Exception ignored) { } player = null; }
                playingId = ""; playingSongId = ""; playingPath = ""; playingTitle = "";
            });
            String key = voiceKey(songId, file);
            String publicUri = tracks.getString(key + ".publicUri", "");
            if (!publicUri.isEmpty()) try { getContentResolver().delete(Uri.parse(publicUri), null, null); } catch (Exception ignored) { }
            if (file.delete()) tracks.edit().remove(key + ".duration").remove(key + ".wave").remove(key + ".publicUri").apply();
            sendVoice("deleted", songId, "", null, "Nota eliminada");
        } catch (Exception e) {
            sendVoice("error", songId, "", null, "No se pudo eliminar la nota");
        }
    }

    private File validatedVoiceFile(String songId, String path) throws Exception {
        File folder = new File(voiceDir, safeId(songId)).getCanonicalFile();
        File file = new File(path).getCanonicalFile();
        return file.getPath().startsWith(folder.getPath() + File.separator) ? file : null;
    }

    private String voiceKey(String songId, File file) {
        return "voice." + safeId(songId) + "." + file.getName();
    }

    private void sendVoice(String state, String songId, String id, JSONArray wave, String message) {
        try {
            JSONObject o = new JSONObject();
            o.put("state", state); o.put("songId", songId); o.put("id", id); o.put("message", message);
            if (wave != null) o.put("wave", wave);
            sendJs("window.nativeVoiceState&&window.nativeVoiceState(" + o + ")");
        } catch (Exception ignored) { }
    }

    private void applyPlaybackParams() {
        if (player == null) return;
        try {
            boolean wasPlaying = player.isPlaying();
            PlaybackParams params = player.getPlaybackParams();
            params.setSpeed(speed);
            params.setPitch(pitch);
            player.setPlaybackParams(params);
            if (!wasPlaying) player.pause();
        } catch (Exception ignored) { }
    }

    private void deleteTrack(String id) {
        try {
            if (id.equals(playingId)) runOnUiThread(() -> {
                if (player != null) { player.stop(); player.release(); player = null; }
                playingId = ""; playingSongId = ""; playingPath = ""; playingTitle = "";
            });
            String path = tracks.getString(id + ".path", "");
            if (!path.isEmpty()) new File(path).delete();
            String uri = tracks.getString(id + ".publicUri", "");
            if (!uri.isEmpty()) getContentResolver().delete(Uri.parse(uri), null, null);
            tracks.edit().remove(id + ".path").remove(id + ".title").remove(id + ".wave")
                .remove(id + ".duration").remove(id + ".publicUri").apply();
            sendDownload(id, 0, "removed", "Audio eliminado");
        } catch (Exception ignored) { }
    }

    private Uri copyToPublicMusic(File source, String title, String id) throws Exception {
        String old = tracks.getString(id + ".publicUri", "");
        if (!old.isEmpty()) try { getContentResolver().delete(Uri.parse(old), null, null); } catch (Exception ignored) { }
        ContentValues values = new ContentValues();
        values.put(MediaStore.Audio.Media.DISPLAY_NAME, safeTitle(title) + ".mp3");
        values.put(MediaStore.Audio.Media.MIME_TYPE, "audio/mpeg");
        values.put(MediaStore.Audio.Media.RELATIVE_PATH, Environment.DIRECTORY_MUSIC + "/Reper");
        values.put(MediaStore.Audio.Media.IS_PENDING, 1);
        Uri uri = getContentResolver().insert(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, values);
        if (uri == null) throw new Exception("No se pudo crear la carpeta pública de música");
        try (FileInputStream in = new FileInputStream(source); OutputStream out = getContentResolver().openOutputStream(uri)) {
            if (out == null) throw new Exception("No se pudo guardar el archivo público");
            byte[] buffer = new byte[128 * 1024]; int n;
            while ((n = in.read(buffer)) > 0) out.write(buffer, 0, n);
        }
        values.clear(); values.put(MediaStore.Audio.Media.IS_PENDING, 0);
        getContentResolver().update(uri, values, null, null);
        return uri;
    }

    private Uri copyVoiceToPublicMusic(File source, String songId) throws Exception {
        String key = voiceKey(songId, source);
        String old = tracks.getString(key + ".publicUri", "");
        if (!old.isEmpty()) try { getContentResolver().delete(Uri.parse(old), null, null); } catch (Exception ignored) { }
        ContentValues values = new ContentValues();
        values.put(MediaStore.Audio.Media.DISPLAY_NAME, "reper-" + safeId(songId) + "-" + source.getName());
        values.put(MediaStore.Audio.Media.MIME_TYPE, "audio/mp4");
        values.put(MediaStore.Audio.Media.RELATIVE_PATH, Environment.DIRECTORY_MUSIC + "/Reper/Notas de voz");
        values.put(MediaStore.Audio.Media.IS_PENDING, 1);
        Uri uri = getContentResolver().insert(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, values);
        if (uri == null) throw new Exception("No se pudo guardar la nota externa");
        try (InputStream in = new FileInputStream(source); OutputStream out = getContentResolver().openOutputStream(uri)) {
            if (out == null) throw new Exception("No se pudo copiar la nota");
            byte[] buffer = new byte[128 * 1024]; int n;
            while ((n = in.read(buffer)) > 0) out.write(buffer, 0, n);
        }
        values.clear(); values.put(MediaStore.Audio.Media.IS_PENDING, 0);
        getContentResolver().update(uri, values, null, null);
        return uri;
    }

    private void recoverPublicVoiceNotes(String songId) {
        if (Build.VERSION.SDK_INT < 29) return;
        if (Build.VERSION.SDK_INT >= 33 &&
            ActivityCompat.checkSelfPermission(this, Manifest.permission.READ_MEDIA_AUDIO) != PackageManager.PERMISSION_GRANTED) return;
        File folder = new File(voiceDir, safeId(songId));
        folder.mkdirs();
        String prefix = "reper-" + safeId(songId) + "-";
        String[] projection = { MediaStore.Audio.Media._ID, MediaStore.Audio.Media.DISPLAY_NAME };
        String selection = MediaStore.Audio.Media.DISPLAY_NAME + " LIKE ? AND " +
            MediaStore.Audio.Media.RELATIVE_PATH + "=?";
        try (Cursor cursor = getContentResolver().query(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
            projection, selection, new String[]{prefix + "%", "Music/Reper/Notas de voz/"},
            MediaStore.Audio.Media.DATE_ADDED + " ASC")) {
            if (cursor == null) return;
            while (cursor.moveToNext()) {
                String display = cursor.getString(1);
                if (display == null || !display.startsWith(prefix)) continue;
                File target = new File(folder, display.substring(prefix.length()));
                Uri uri = Uri.withAppendedPath(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, cursor.getString(0));
                if (!target.isFile()) {
                    try (InputStream in = getContentResolver().openInputStream(uri);
                         OutputStream out = new FileOutputStream(target, false)) {
                        if (in == null) continue;
                        byte[] buffer = new byte[128 * 1024]; int n;
                        while ((n = in.read(buffer)) > 0) out.write(buffer, 0, n);
                    }
                }
                String key = voiceKey(songId, target);
                if (!tracks.contains(key + ".duration")) {
                    tracks.edit().putLong(key + ".duration", readDuration(target)).putString(key + ".wave", "[]")
                        .putString(key + ".publicUri", uri.toString()).apply();
                }
            }
        } catch (Exception ignored) { }
    }

    private long readDuration(File file) {
        MediaMetadataRetriever r = new MediaMetadataRetriever();
        try {
            r.setDataSource(file.getAbsolutePath());
            String value = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
            return value == null ? 0 : Long.parseLong(value);
        } catch (Exception e) { return 0; }
        finally { try { r.release(); } catch (Exception ignored) { } }
    }

    private JSONArray extractWaveform(File file, int buckets) {
        float[] peaks = new float[buckets];
        MediaExtractor extractor = new MediaExtractor();
        MediaCodec codec = null;
        try {
            extractor.setDataSource(file.getAbsolutePath());
            int track = -1; MediaFormat format = null;
            for (int i = 0; i < extractor.getTrackCount(); i++) {
                MediaFormat f = extractor.getTrackFormat(i);
                String mime = f.getString(MediaFormat.KEY_MIME);
                if (mime != null && mime.startsWith("audio/")) { track = i; format = f; break; }
            }
            if (track < 0 || format == null) return new JSONArray();
            long durationUs = format.containsKey(MediaFormat.KEY_DURATION) ? format.getLong(MediaFormat.KEY_DURATION) : 1;
            String mime = format.getString(MediaFormat.KEY_MIME);
            extractor.selectTrack(track);
            codec = MediaCodec.createDecoderByType(mime);
            codec.configure(format, null, null, 0); codec.start();
            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            boolean inputDone = false, outputDone = false;
            while (!outputDone) {
                if (!inputDone) {
                    int inIndex = codec.dequeueInputBuffer(10000);
                    if (inIndex >= 0) {
                        ByteBuffer input = codec.getInputBuffer(inIndex);
                        int size = input == null ? -1 : extractor.readSampleData(input, 0);
                        if (size < 0) {
                            codec.queueInputBuffer(inIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                            inputDone = true;
                        } else {
                            codec.queueInputBuffer(inIndex, 0, size, extractor.getSampleTime(), 0);
                            extractor.advance();
                        }
                    }
                }
                int outIndex = codec.dequeueOutputBuffer(info, 10000);
                if (outIndex >= 0) {
                    ByteBuffer out = codec.getOutputBuffer(outIndex);
                    if (out != null && info.size > 1) {
                        out.order(ByteOrder.LITTLE_ENDIAN);
                        int start = Math.max(0, Math.min(buckets - 1, (int)(info.presentationTimeUs * buckets / Math.max(1, durationUs))));
                        int samples = info.size / 2;
                        out.position(info.offset); out.limit(info.offset + info.size);
                        for (int i = 0; i < samples && out.remaining() >= 2; i++) {
                            int bucket = Math.min(buckets - 1, start + (i * Math.max(1, buckets / 80)) / Math.max(1, samples));
                            float amp = Math.abs((float)out.getShort() / 32768f);
                            if (amp > peaks[bucket]) peaks[bucket] = amp;
                        }
                    }
                    outputDone = (info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0;
                    codec.releaseOutputBuffer(outIndex, false);
                }
            }
        } catch (Exception ignored) { }
        finally {
            try { extractor.release(); } catch (Exception ignored) { }
            if (codec != null) try { codec.stop(); codec.release(); } catch (Exception ignored) { }
        }
        float max = .001f;
        for (float p : peaks) max = Math.max(max, p);
        JSONArray result = new JSONArray();
        for (float p : peaks) result.put(Float.valueOf(Math.max(.04f, p / max)));
        return result;
    }

    private String safeId(String id) { return id.replaceAll("[^A-Za-z0-9_-]", "_"); }
    private String safeTitle(String title) {
        String clean = title.replaceAll("[\\\\/:*?\"<>|]", " ").replaceAll("\\s+", " ").trim();
        if (clean.isEmpty()) clean = "Canción";
        return clean.length() > 90 ? clean.substring(0, 90).trim() : clean;
    }

    @Override public void onBackPressed() {
        web.evaluateJavascript("window.closeOverlay&&window.closeOverlay()", value -> {
            if ("false".equals(value)) super.onBackPressed();
        });
    }

    @Override protected void onDestroy() {
        timer.removeCallbacksAndMessages(null);
        worker.shutdownNow();
        if (recorder != null) stopVoiceRecording(false);
        if (player != null) { try { player.release(); } catch (Exception ignored) { } }
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
