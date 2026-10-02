# LATCHI SOCIAL HUB — Phase 1 Final Report
**التاريخ:** 2 أكتوبر 2026 · **الفرع:** feature/phase-1-platforms-expansion → **مُدمج بـmain (PR #1)** · **الإصدار:** v0.2.0 (a005eba)

---

## Status
✅ **مكتمل.** جميع بنود Phase 1 منفّذة ومختبرة ومُدمجة بـmain. الإصدار مرفوع إلى **0.2.0**. لا وسم ولا GitHub Release — بانتظار تأكيد المالك (ثم GitHub Actions).

## Changes Made
1. **المنصات (المجموع 8):** WhatsApp · Gmail · Outlook · YouTube أُضيفت بpartitions معزولة (`persist:whatsapp / google / microsoft / youtube`) مع locales AR/EN ونطاقات SSO شاملة (gmail: accounts.google.com + google.com؛ outlook: login.live.com + login.microsoftonline.com + microsoft.com؛ youtube: youtube.com + youtu.be + accounts.google.com).
2. **ربط جلسات Meta:** Instagram + Facebook + Messenger كلها `persist:meta` — **دخول واحد** للثلاثة. لا هجرة بيانات: **على المالك إعادة تسجيل الدخول مرة واحدة** عند أول تشغيل لـv0.2.0 (تمسح التخصيص القديم فئة persist:instagram فقط إن وجدت؛ جلسات المنصات الأخرى غير متأثرة).
3. **أداء Instagram:** GPU switches الأربعة بmain.js قبل ready (`ignore-gpu-blocklist`, `enable-gpu-rasterization`, `enable-zero-copy`, `VaapiVideoDecoder`) + `backgroundThrottling:false` لكل WebContentsView + LRU `_maybeTrimCaches` (clearCache للأقدم عند >5 منصة نشطة — لا يمس كوكيز/جلسات) + **Lazy loading محقق أصلاً** (المنشأة `_createView` لا تحدث إلا عند أول `select`).
4. **Export/Import مشفّر:** AES-256-GCM بامتداد `.latchi-backup` (ترويسة `LSHBKUP1` + salt 16B + IV 12B + tag 16B؛ مفتاح scrypt 32B). المحتوى: Cookies + Local Storage + IndexedDB لكل partition + settings.json + قائمة المنصات. **⛔ Login Data/Web Data غير مضمنة إطلاقاً** (مثبت بالاختبار). الاستيراد merge-only ويطلب إعادة تشغيل (`app:relaunch`). كلمة السر لا تُخزن ولا تُسجَّل. `.gitignore` += `*.latchi-backup` + `backups/`.
5. **الأصول البصرية (13 عنصراً):** 8 أيقونات 300×600 SVG (+PNG توأم) بـ`src/assets/platforms/` — تدرّج كحلي + إطار ذهبي + شعار متجهي مرسوم برمجياً + الاسم Latin؛ بانر 1200×400 بـ`src/assets/branding/banner.svg` يظهر بشاشة Home؛ 5 خلفيات 1920×1080 (mesh/stripes/dots/wave/hex) بـ`src/assets/backgrounds/`. **كلها متجهات برمجية** (مولّد قابل لإعادة التشغيل: `test-tools/gen_visual_assets.py`) — صفر إيموجي، صفر صور AI.
6. **Sidebar:** أزرار ثابتة استُبدلت بـ`#platformTiles` يُبنى ديناميكياً من المنصات الفعلية (IPC `platforms:list` + fallback) — 8 بلاطات 1:2 (64×128)، gap 12px، عمود scrollable، hover ذهبي، حد ذهبي للنشطة، RTL/LTR. عرض 224→128px (compact 64px). أزرار اللغة/الإعدادات باقية.
7. **Settings:** قسم «خلفية الشاشة الرئيسية» (6 خيارات بمصغّرات حية، تنعكس فوراً) + قسم «البيانات والنسخ الاحتياطي» (تصدير/استيراد + مودال كلمة سر + تحذير حساسية + مودال إعادة تشغيل). الإبقاء على كل الموجود.
8. **الأمان:** contextIsolation/sandbox/nodeIntegration=false حرفياً كما كانت؛ صلاحيات deny-all **إلا** camera/microphone/notifications **لـWhatsApp+Messenger فقط** — المنح مقيّد بURL الطالب (يحرس مجموعة Meta المشتركة)؛ popup universe موسّع (accounts.google.com، login.live.com، login.microsoftonline.com)؛ التنزيلات المعقمة والقفلات باقية.

## Files Changed (22 ملفاً)
| الملف | التغيير |
|---|---|
| `src/main/platform-manager.js` | +4 منصات، persist:meta، backgroundThrottling، LRU trim، onHomeBackgroundChanged، payload الأوفرلاي |
| `src/main/main.js` | GPU flags، IPC: platforms:list / backup:export / backup:import / app:relaunch، ربط homeBackground |
| `src/main/backup-manager.js` | **جديد** — AES-256-GCM export/import كامل |
| `src/main/settings-store.js` | PLATFORM_IDS=8، مفتاح homeBackground (مُتحقق) |
| `src/main/smoke.js` | مصفوفة 8 منصات + إثبات مشاركة meta + backup T5/T6 + خلفية T8 |
| `src/main/security-manager.js` | CALL_PERMISSIONS مقيدة بURL (WA+Messenger) |
| `src/preload/shell-preload.js` | getPlatforms / exportBackup / importBackup / relaunchApp |
| `src/renderer/shell/index.html` | بلاطات ديناميكية، بطاقتا الخلفية والنسخ، مودالا backup/restart |
| `src/renderer/shell/js/app.js` | renderPlatformTiles، bindBackup، renderBackgroundOptions |
| `src/renderer/shell/css/shell.css` | tiles + bg-options + backup + sidebar 128px |
| `src/renderer/overlay/{html,js,css}` | #ovBanner + #bgLayer (data-bg) + حارس [hidden] |
| `src/renderer/locales/{ar,en}.json` | +4 منصات + backup.* + خلفيات (78 مفتاحاً متطابقاً) |
| `src/assets/platforms/*` | **جديد** — 16 ملفاً (8 SVG + 8 PNG) |
| `src/assets/branding/banner.svg` | **جديد** |
| `src/assets/backgrounds/*` | **جديد** — 5 ملفات |
| `test-tools/gen_visual_assets.py` | **جديد** — مولّد الأصول |
| `test-tools/visual_click.py` | 8 منصات + تمرير الشريط |
| `.gitignore` / `package.json` / `package-lock.json` | backup entries / v0.2.0 |

## Session Sharing Meta (T2 — إثبات تقني)
كوكي `lsh_meta_share=via-instagram` كُتب عبر **كائن جلسة منصة Instagram الحية** ثم قُرئ من **منصة Messenger**:
- `sameSessionObject: true` — العرضان يشتركان نفس كائن session (persist:meta)
- `cookieVisibleFromMessenger: true` — الكوكي مرئي من ماسنجر
- `notVisibleFromTelegram: true` — غير مرئي من telegram (persist:telegram)
أي أن تسجيل الدخول بفيسبوك مرة واحدة يكفي الثلاثة. **الدخول بحساب حقيقي متروك للمالك** (لا حسابات اختبارية بالجلسة — قيد دائم). لا تضارب أمني: كل قواعد التصلب تنطبق على الـpartition المشتركة كوحدة واحدة، وصلاحيات المكالمات مقيدة بURL لا بpartition.

## Performance (P1–P3)
- **P1 GPU:** الفlags الأربعة مفعلة قبل app.ready؛ `backgroundThrottling:false` يمنع تجميد رندر Instagram عند إخفائها.
- **P2 الذاكرة:** `_maybeTrimCaches` يستدعي `clearCache()` فقط (لا يمس كوكيز/جلسات/تخزيناً محلياً) للأقدم استخداماً عند تجاوز 5 منصات نشطة، متخطياً شريك partition النشطة.
- **P3 Lazy:** المنصات لا تُنشأ إلا عند أول اختيار (`_createView` من `selectPlatform`) — التحقق: `viewIds` في الاختبار النهائي = 8 فقط بعد اختيار الثمانية فعلياً، والمقاييس: `webContentsStable: true`.
- **قياس كمي (smoke):** كل منصة من الثماني وصلت `ready` بلا مهلات، والتبديل round-trip ×3 بلا أي reload (`navigations` ثابتة).

## Backup Testing (T5/T6)
| الفحص | النتيجة |
|---|---|
| تصدير بملف مسار مباشر | ok=true، platformCount=8 |
| الترويسة `LSHBKUP1` | ✓ |
| فك تشفير مستقل (scrypt+AES-256-GCM بsmoke نفسه) | manifest.app='latchi-social-hub' ✓ |
| **لا Login Data/Web Data/Passwords بالحمولة** | ✓ (فُحصت كل مفاتيح الملفات) |
| كلمة سر خاطئة | `wrong-password` — خطأ واضح، لا crash (T6) ✓ |
| ملف تالف/غائب | `bad-file` ✓ |
| T5: حذف `Partitions/meta` كاملاً من القرص → استيراد | المجلد عاد، **Cookies مطابقة بايت-ببايت** للنسخة الأصلية، filesRestored>0، settings.json استعاد startupPlatform ✓ |

## Visual Assets
- 8 أيقونات 300×600 (نسبة 1:2 مثبتة قياساً = 2.00) بألوان المنصات المعتمدة (MS #00B2FF) + إطار ذهبي + الاسم.
- بانر LATCHI SOCIAL HUB (1200×400) — يظهر بشاشة Home دائماً بدل لوجو المحور (`bannerHidden:false, naturalWidth:1200`).
- 5 خلفيات داكنة subtle (كحلي + لمسات ذهبية 5–7٪) — كلها مُتحقق من رسم النمط فيها (stdev>2.5).

## Regression
- **فخ ج58 ([hidden]):** الحارس `[hidden]{display:none!important}` باقٍ، وقواعد المودالات الجديدة لا تلغيه (مُغطى بالفحص: المودالات تعمل)؛ أضفت الحارس نفسه لأوفرلاي البانر (`.ov-banner[hidden]`).
- **smoke الكامل: 23/23 ✓** (exit 0): 8 منصات ready+not-blank+URLs، عزل 6 partitions، مشاركة meta، round-trips بلا reload، خطأ/أوفلاين/إعادة محاولة، AR/RTL↔EN/LTR، Settings، حراسة التنقل (file:// وtg:// محجوبان)، popups معزولة، responsive (73px compact / 128px عادي)، ذاكرة ومؤقتات، مسح جلسات، كوكيز تبقى، خلفية T8، backup، بانر، بلاطات.
- **visual_click (نقرات فأرة X11 حقيقية):** 8/8 ACTIVATED — بما فيها البلاطات الثلاث التي تتطلب تمرير الشريط الجانبي (gmail/outlook/youtube).
- **ملاحظة سلوك موثقة:** بجلسة غير مسجلة، Gmail يعيد التوجيه لـaccounts.google.com (صفحة تسجيل الدخول) وOutlook لصفحة microsoft.com/marketing مع `deeplink=/mail/` — سلوك المواقع نفسها عند عدم وجود جلسة، وبعد دخول المالك تُفتح صناديق البريد مباشرة (نطاقات SSO كلها بالنطاق المسموح).

## Security Impact
- **تحسّن صافٍ:** لا مكتبات جديدة (crypto المدمج فقط)، لا تخفيف أي قاعدة، صلاحيات المكالمات أضيقت من «منصات معينة» إلى «منصات معينة + URL الطالب مطابق».
- كلمة سر الباكب تعبر IPC كوسيط مؤقت فقط؛ لا تُكتب لsettings ولا للسجلات.
- ملفات الباكب مستبعدة من git (`*.latchi-backup`, `backups/`) — وتأكد: لا ملفات باكب ولا كوكيز ولا PAT في المستودع.

## Git
```
a005eba chore(release): bump version to 0.2.0 after Phase 1 merge   ← main
18dbca0 Phase 1 — platforms expansion (PR #1, squash)
├─ 64d487d feat(platforms): WhatsApp/Gmail/Outlook/YouTube + locales + call permissions
├─ 02cc88d feat(session): share Meta partition for FB/Messenger/Instagram
├─ 47b843d perf: GPU decode flags, backgroundThrottling:false, LRU cache trim
├─ 60e04b7 feat(backup): encrypted export/import for sessions and settings
├─ 8f4aee3 feat(ui): rectangular 3:6 platform tiles + dynamic sidebar
└─ cf108ae feat(ui): home banner + selectable backgrounds + smoke matrix
```
PR #1: https://github.com/latchidz/latchi-social-hub/pull/1 (مُدمج). **⛔ لا وسم** — القيد القائم لا يُحرَّك إلا بتأكيد المالك.

## Known Issues
1. **إعادة دخول Meta مرة واحدة** بعد الترقية (تغيّر partition) — متوقع وموثّق.
2. Gmail/Outlook بجلسة فارغة يقعان على صفحات تسجيل دخول المواقع (طبيعي).
3. استيراد الباكب يتطلب إعادة تشغيل ليُحمّل Chromium ملفات الكوكيز — مُعلن بالمودال.
4. أول تشغيل لWhatsApp Web يعرض QR — طبيعي.

## Build Status
**BUILD NOT EXECUTED** — غير مصرح به محلياً (كل البناء على GitHub Actions بعد تأكيد المالك). ⛔ لا وسم، لا Release.

## Next Session (Phase 1 Session 2)
1. 5 خلفيات إضافية (المجموع 10) بنفس المولّد + إضافتها لقائمة الاختيار.
2. Fine-tuning أيقونات المنصات الثماني حسب ملاحظات المالك البصرية.
3. اختبارات إضافية: تشغيل مطوّل (soak) للتحقق من استقرار LRU trim، واختبار backup بحجم حقيقي أكبر.
4. بعد تأكيد المالك: وسم v0.2.0 + بناء Windows على GitHub Actions + Release (Setup + Portable + SHA256SUMS).
