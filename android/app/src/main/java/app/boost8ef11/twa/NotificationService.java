package app.boost8ef11.twa;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationManagerCompat;

import com.google.androidbrowserhelper.trusted.DelegationService;

/**
 * Custom TWA notification-delegation service.
 *
 * The default androidx.browser {@code TrustedWebActivityService} posts delegated
 * web-push notifications on a channel created with {@code IMPORTANCE_DEFAULT}
 * (see NotificationApiHelperForO). DEFAULT alerts (sound/vibration) but does
 * NOT show a heads-up banner or wake the screen — which is exactly the
 * "vibrate only" behaviour we want to avoid for game invites / turn alerts.
 *
 * Channel importance can't be raised after creation, so we override delivery
 * to post on our OWN {@code IMPORTANCE_HIGH} channel. Created once; a no-op on
 * subsequent pushes. Users can still mute it from Android settings.
 *
 * NOTE: `bubblewrap update` regenerates AndroidManifest.xml and would reset the
 * DelegationService `android:name` back to the library default — re-point it at
 * this class after any Bubblewrap regeneration.
 */
public class NotificationService extends DelegationService {

    private static final String CHANNEL_ID = "boost_push_high";
    private static final CharSequence CHANNEL_NAME = "התראות משחק";

    @Override
    public boolean onNotifyNotificationWithChannel(@NonNull String platformTag, int platformId,
            @NonNull Notification notification, @NonNull String channelName) {
        if (!NotificationManagerCompat.from(this).areNotificationsEnabled()) {
            return false;
        }

        NotificationManager manager =
                (NotificationManager) getSystemService(NOTIFICATION_SERVICE);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_HIGH);
            channel.enableVibration(true);
            manager.createNotificationChannel(channel);

            // Respect a user who has muted our channel.
            NotificationChannel existing = manager.getNotificationChannel(CHANNEL_ID);
            if (existing != null
                    && existing.getImportance() == NotificationManager.IMPORTANCE_NONE) {
                return false;
            }

            Notification.Builder builder =
                    Notification.Builder.recoverBuilder(this, notification);
            builder.setChannelId(CHANNEL_ID);
            notification = builder.build();
        }

        manager.notify(platformTag, platformId, notification);
        return true;
    }
}
