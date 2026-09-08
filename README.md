Tampermonkey userscript that removes `uk` and `passkey` from tracker URLs while preserving the info hash.

1. Install [Tampermonkey](https://www.tampermonkey.net/) 5.4.6226 or later.
2. Install the [userscript](https://raw.githubusercontent.com/sashokey/bt-passkey-cleaner/master/bt-passkey-cleaner.user.js).
3. Reload the release page and use its download button.

Allow access to the download host when prompted, enable downloads, and allow `.torrent` files in Tampermonkey settings.

Keep automatic updates enabled to receive new versions from this repository.

Only downloads triggered by the page button are processed. Trackers requiring a passkey may reject requests without it.
