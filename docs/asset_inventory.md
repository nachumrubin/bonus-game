# Asset Inventory

## Missing (bespoke art — interim icons are in place, nothing is broken)

The three boosts below used bare emoji in the award overlay, which rendered as
meaningless gold discs. They now use **interim** icons; bespoke Boost-family art
is still wanted so they match `assets/rewards/extra turn.png`. Generation prompts
are in `docs-md/CHANGELOG.md`. Swapping in real art is a one-line `image:` change
each in `describeBoost` (`src/ui/screens/gameScreen.js`).

* assets/rewards/skip turn.png — `skip_opponent_turn`.
  Interim: `assets/ui/pause.png` (already Boost-family; reads as "turn halted").
* assets/rewards/tile swap.png — `free_tile_swap`.
  Interim: `assets/ui/rematch.png` (already Boost-family; circular swap arrows —
  a genuinely good fit, lowest priority to replace).
* assets/rewards/cancel boost.png — `cancel_next_opponent_bonus`.
  Interim: 🛡️ emoji (no usable shield asset exists — the achievements shield is a
  multi-object sheet with a baked-in background). **Highest priority**: it's the
  only boost still without an icon.

* (stats-letter-icon.png was proposed for the favorite-letter card, but that card
  renders the actual Hebrew letter dynamically — no static icon needed.)

## Existing

* assets/achievements/crown and dimond shield.png
* assets/achievements/אגדה.png
* assets/achievements/אלוף.png
* assets/achievements/אמן המילים.png
* assets/achievements/אספן.png
* assets/achievements/בלתי מנוצח.png
* assets/achievements/בלתי נתפס.png
* assets/achievements/בעל אגדה.png
* assets/achievements/ברק חי.png
* assets/achievements/גאון מילים.png
* assets/achievements/האחד.png
* assets/achievements/ותיק.png
* assets/achievements/חבר מביא חבר.png
* assets/achievements/חבר של כולם.png
* assets/achievements/מילון מהלך.png
* assets/achievements/מנצח.png
* assets/achievements/על-אנושי.png
* assets/achievements/צעדים ראשונים.png
* assets/achievements/קנייה ראשונה.png
* assets/achievements/רצף מנצחים.png
* assets/achievements/שועל ותיק.png
* assets/achievements/שחקן מנוסה.png
* assets/achievements/תורם מילים.png
* assets/avatars/anonymous player.png
* assets/avatars/bot.png
* assets/avatars/green bot.png
* assets/avatars/red bot.png
* assets/avatars/yellow bot.png
* assets/avatars_v2/common/basketball_player.png
* assets/avatars_v2/common/common_1_1.png
* assets/avatars_v2/common/common_1_2.png
* assets/avatars_v2/common/common_1_3.png
* assets/avatars_v2/common/common_1_4.png
* assets/avatars_v2/common/common_2_split.png
* assets/avatars_v2/common/doctor.png
* assets/avatars_v2/common/fire_dep.png
* assets/avatars_v2/common/gamer.png
* assets/avatars_v2/common/hacker.png
* assets/avatars_v2/common/police.png
* assets/avatars_v2/common/shef.png
* assets/avatars_v2/common/soccer_fan.png
* assets/avatars_v2/common/soccer_player.png
* assets/avatars_v2/common/soldier.png
* assets/avatars_v2/common/su_shef.png
* assets/avatars_v2/rare/david_ben_gur.png
* assets/avatars_v2/rare/golda.png
* assets/avatars_v2/rare/hertzel.png
* assets/avatars_v2/rare/ilan_ramon.png
* assets/avatars_v2/rare/miriam_peretz.png
* assets/avatars_v2/rare/moshe dayan.png
* assets/avatars_v2/rare/ofra_haza.png
* assets/avatars_v2/rare/rabin.png
* assets/avatars_v2/rare/rare_1_bottom_left.png
* assets/avatars_v2/rare/rare_1_bottom_right.png
* assets/avatars_v2/rare/rare_1_top_left.png
* assets/avatars_v2/rare/rare_1_top_right.png
* assets/avatars_v2/epic/esther.PNG
* assets/avatars_v2/epic/jacob.png
* assets/avatars_v2/epic/rachel.png
* assets/avatars_v2/epic/ruth.PNG
* assets/avatars_v2/epic/shmoel.png
* assets/avatars_v2/epic/מרדכי היהודי.PNG
* assets/avatars_v2/epic/joshua.png
* assets/avatars_v2/epic/rambam.png
* assets/avatars_v2/epic/adam.png
* assets/avatars_v2/epic/yehuda_hamaccabi.png
* assets/avatars_v2/legendary/aharon.png
* assets/avatars_v2/legendary/david.png
* assets/avatars_v2/legendary/joseph.png
* assets/avatars_v2/legendary/moses.png
* assets/avatars_v2/legendary/samson.png
* assets/icons/1v1.png
* assets/icons/5_references.png
* assets/icons/acheivments.png
* assets/icons/dice.png
* assets/icons/friends.png
* assets/icons/globe.png
* assets/icons/statistics.png
* assets/icons/stats-average-icon.png
* assets/icons/stats-games-icon.png
* assets/icons/stats-performance-icon.png
* assets/icons/stats-records-icon.png
* assets/icons/stats-rivals-icon.png
* assets/icons/stats-streak-icon.png
* assets/icons/stats-style-icon.png
* assets/icons/stats-wins-icon.png
* assets/navigation/bell.png
* assets/navigation/friends_nav.png
* assets/navigation/help.png
* assets/navigation/home.png
* assets/navigation/more_navigation_buttons.png
* assets/navigation/my_games.png
* assets/navigation/navigation_buttons.png
* assets/navigation/search.png
* assets/navigation/serach.png
* assets/navigation/settings.png
* assets/navigation/sound_off.png
* assets/navigation/sound_on.png
* assets/navigation/statistics_nav.png
* assets/rewards/bronze medal.png
* assets/rewards/extra turn.png
* assets/rewards/gold coin.png
* assets/rewards/gold medal.png
* assets/rewards/silver medal.png
* assets/rewards/trophy.png
* assets/ui/+.png
* assets/ui/hourglass.png
* assets/ui/key.png
* assets/ui/lock.png
* assets/ui/logout.png
* assets/ui/pause.png
* assets/ui/play.png
* assets/ui/rematch.png
* assets/ui/remote.png
* assets/ui/store.png
