package app.boost8ef11.twa;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import android.widget.Toast;

import androidx.annotation.NonNull;

import com.google.android.gms.ads.AdError;
import com.google.android.gms.ads.AdRequest;
import com.google.android.gms.ads.FullScreenContentCallback;
import com.google.android.gms.ads.LoadAdError;
import com.google.android.gms.ads.MobileAds;
import com.google.android.gms.ads.rewarded.RewardedAd;
import com.google.android.gms.ads.rewarded.RewardedAdLoadCallback;
import com.google.android.gms.ads.rewarded.ServerSideVerificationOptions;

/**
 * Rewarded video ad (AdMob) for the web app, which can't run the native ads SDK itself.
 *
 * The page opens {@code intent://reward?uid=<firebase uid>#Intent;scheme=boost-ad;end}
 * (src/game/account/rewardedAds.js). This activity loads and shows one rewarded ad with
 * the uid as the server-side-verification user id, then finishes back to the TWA.
 *
 * Nothing is credited from here: when the player earns the reward, AdMob calls the
 * worker's /admob/ssv with a signed callback and the worker adds the coins. The page
 * sees them through its profile watch.
 *
 * Ids come from gradle properties (app/build.gradle): admobAppId, admobRewardedUnitId.
 * Debug builds always use Google's test ids.
 */
public class RewardedAdActivity extends Activity {

    private boolean closed;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Uri data = getIntent().getData();
        String uid = data == null ? null : data.getQueryParameter("uid");
        if (uid == null || !uid.matches("[A-Za-z0-9_-]{6,128}")) {
            finish();
            return;
        }

        // A dimmed screen with a spinner while the ad loads (a second or two).
        getWindow().setBackgroundDrawable(new ColorDrawable(Color.argb(160, 0, 0, 0)));
        FrameLayout root = new FrameLayout(this);
        ProgressBar spinner = new ProgressBar(this);
        root.addView(spinner, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.CENTER));
        root.setOnClickListener(v -> close());   // tap outside while loading = give up
        setContentView(root);

        MobileAds.initialize(this, status -> { });
        RewardedAd.load(this, getString(R.string.admobRewardedUnitId), new AdRequest.Builder().build(),
                new RewardedAdLoadCallback() {
                    @Override
                    public void onAdLoaded(@NonNull RewardedAd ad) {
                        if (closed || isFinishing()) return;
                        ad.setServerSideVerificationOptions(
                                new ServerSideVerificationOptions.Builder().setUserId(uid).build());
                        ad.setFullScreenContentCallback(new FullScreenContentCallback() {
                            @Override
                            public void onAdDismissedFullScreenContent() {
                                close();
                            }

                            @Override
                            public void onAdFailedToShowFullScreenContent(@NonNull AdError error) {
                                toastAndClose();
                            }
                        });
                        ad.show(RewardedAdActivity.this, reward -> { /* credited server-side (SSV) */ });
                    }

                    @Override
                    public void onAdFailedToLoad(@NonNull LoadAdError error) {
                        toastAndClose();
                    }
                });
    }

    private void toastAndClose() {
        if (closed) return;
        Toast.makeText(this, "אין סרטון זמין כרגע, נסו שוב מאוחר יותר", Toast.LENGTH_LONG).show();
        close();
    }

    private void close() {
        if (closed) return;
        closed = true;
        finish();
    }
}
