# Notification audio

Six audio assets from THISUX Sound Kit, MIT license (see LICENSE.txt):
https://github.com/thisuxhq/soundkit

Source directory: full-volume-5db/notifications-and-alerts/
Files: notification-1.m4a, notification-3.m4a, notification-5.m4a,
alert-1.m4a, alert-3.m4a, alert-5.m4a.

The original audio bytes are bundled as base64 data URLs in catalog.json.
Playback uses locally served assets and Web Audio; no third-party requests.
The original dashboard tone remains the default until an admin saves a selection.
Settings are global, stored under notification_sound in app_settings.
The additive table can remain in place when restoring an earlier app version.
