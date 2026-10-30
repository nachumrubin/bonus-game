package app.boost8ef11.twa;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

/**
 * The home screen's "יציאה" button (the exit question, src/main.js). A TWA page can't
 * close itself: window.close() is refused and there is no history entry to step back
 * into. The page opens {@code intent://exit#Intent;scheme=boost-ad;end} instead, and
 * this activity sends the app to the background, as the home key would.
 */
public class ExitActivity extends Activity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Intent home = new Intent(Intent.ACTION_MAIN);
        home.addCategory(Intent.CATEGORY_HOME);
        home.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            startActivity(home);
        } catch (RuntimeException ignored) {
            // No launcher to go to: just finish.
        }
        finish();
        overridePendingTransition(0, 0);
    }
}
