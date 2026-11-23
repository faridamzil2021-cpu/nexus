package com.nexusroyale.game;

import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        ensureFirebaseInitialized();
        super.onCreate(savedInstanceState);
        enableImmersiveFullscreen();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            enableImmersiveFullscreen();
        }
    }

    private void enableImmersiveFullscreen() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }
        WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        if (controller != null) {
            controller.setSystemBarsBehavior(
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            );
            controller.hide(WindowInsetsCompat.Type.systemBars());
        }
    }

    private void ensureFirebaseInitialized() {
        try {
            if (!FirebaseApp.getApps(this).isEmpty()) {
                return;
            }
            // Read public Firebase client config synced from firebase-applet-config.json or fallback
            String projectId = "gen-lang-client-0708282100";
            String appId = "1:371656752061:web:a84c6205ce2875346f30d4";
            String apiKey = "";
            String storageBucket = "gen-lang-client-0708282100.firebasestorage.app";
            String senderId = "371656752061";

            try (InputStream is = getAssets().open("firebase-client-config.json")) {
                byte[] buf = new byte[is.available()];
                int read = is.read(buf);
                if (read > 0) {
                    JSONObject obj = new JSONObject(new String(buf, 0, read, StandardCharsets.UTF_8));
                    apiKey = obj.optString("apiKey", apiKey);
                    projectId = obj.optString("projectId", projectId);
                    appId = obj.optString("appId", appId);
                    storageBucket = obj.optString("storageBucket", storageBucket);
                    senderId = obj.optString("messagingSenderId", senderId);
                }
            } catch (Exception ignored) {
                // Fallback to android/app/google-services.json if provided
            }

            if (apiKey != null && !apiKey.isEmpty()) {
                FirebaseOptions options = new FirebaseOptions.Builder()
                    .setApiKey(apiKey)
                    .setApplicationId(appId)
                    .setProjectId(projectId)
                    .setStorageBucket(storageBucket)
                    .setGcmSenderId(senderId)
                    .build();
                FirebaseApp.initializeApp(this, options);
            }
        } catch (Exception ignored) {
            // FirebaseApp may already be initialized by google-services ContentProvider
        }
    }
}
