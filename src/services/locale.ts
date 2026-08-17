import arabic from "../locales/ar";
import bengali from "../locales/bn";
import chinese from "../locales/zh-CN";
import dutch from "../locales/nl";
import french from "../locales/fr";
import german from "../locales/de";
import hindi from "../locales/hi";
import indonesian from "../locales/id";
import italian from "../locales/it";
import japanese from "../locales/ja";
import korean from "../locales/ko";
import portuguese from "../locales/pt";
import russian from "../locales/ru";
import spanish from "../locales/es";
import turkish from "../locales/tr";

export const LOCALES = [
  "ar",
  "bn",
  "zh-CN",
  "nl",
  "en",
  "fr",
  "de",
  "hi",
  "id",
  "it",
  "ja",
  "ko",
  "fa",
  "pt",
  "ru",
  "es",
  "tr",
] as const;
export type Locale = (typeof LOCALES)[number];
export type LocalePreference = "system" | Locale;
export type Direction = "ltr" | "rtl";
export type MessageValues = Readonly<Record<string, string | number>>;

type Message = string | ((values: MessageValues) => string);

const ENGLISH = {
  "common.search": "Search",
  "common.settings": "Settings",
  "common.move": "Move",
  "common.open": "Open",
  "common.closeSettings": "Close settings",
  "common.changeIt": "Change it",
  "common.closeApp": "Close the app",
  "common.return": "Return",
  "common.ok": "OK",
  "common.watch": "Watch",
  "common.allChannels": "All channels",
  "common.anotherChannel": "Another channel",
  "common.backToChannels": "Back to the channels",
  "common.backToPicture": "Back to the picture",
  "common.channelNumber": "Channel number",
  "common.clear": "Clear",
  "common.save": "Save",
  "common.cancel": "Cancel",
  "common.addPlaylist": "Add a playlist",
  "common.refreshPlaylist": "Refresh playlist",
  "common.refreshing": "Refreshing…",
  "common.active": "Active",
  "common.edit": "Edit",
  "common.remove": "Remove",
  "common.keepIt": "Keep it",
  "common.close": "Close",
  "common.keepWatching": "Keep watching",
  "common.stayHere": "Stay here",
  "common.on": "On",
  "common.off": "Off",
  "common.play": "Play",
  "common.playPause": "Play or pause",
  "common.up": "Up",
  "common.right": "Right",
  "common.down": "Down",
  "common.left": "Left",
  "common.select": "Select",
  "common.returnKey": "Return",
  "common.volumeUp": "Volume up",
  "common.volumeDown": "Volume down",
  "common.channelUp": "Channel up",
  "common.channelDown": "Channel down",
  "common.rewind": "Rewind",
  "common.stop": "Stop",
  "common.fastForward": "Fast forward",
  "common.trackPrevious": "Track previous",
  "common.trackNext": "Track next",
  "common.red": "Red",
  "common.yellow": "Yellow",
  "common.blue": "Blue",
  "common.green": "Green",
  "remote.show": "Show Smart Remote",
  "remote.hide": "Hide the remote",
  "remote.keypad": "On-screen keypad",
  "remote.raiseKeypad": "Raise the on-screen keypad",
  "language.system": "System",
  "language.english": "English",
  "language.persian": "Persian",
  "language.arabic": "Arabic",
  "language.bengali": "Bengali",
  "language.chinese": "Chinese (Simplified)",
  "language.dutch": "Dutch",
  "language.french": "French",
  "language.german": "German",
  "language.hindi": "Hindi",
  "language.indonesian": "Indonesian",
  "language.italian": "Italian",
  "language.japanese": "Japanese",
  "language.korean": "Korean",
  "language.portuguese": "Portuguese",
  "language.russian": "Russian",
  "language.spanish": "Spanish",
  "language.turkish": "Turkish",
  "settings.title": "Settings",
  "settings.appearance": "Appearance",
  "settings.playback": "Playback",
  "settings.general": "General",
  "settings.playlists": "Playlists",
  "settings.diagnostics": "Diagnostics",
  "settings.about": "About",
  "settings.language": "Language",
  "settings.languageHint": "Choose the language used by the app",
  "settings.textSize": "Text size",
  "settings.small": "Small",
  "settings.medium": "Medium",
  "settings.large": "Large",
  "settings.extraLarge": "Extra large",
  "settings.textSizeHint": "Applies throughout the app",
  "settings.showNumbers": "Show channel numbers",
  "settings.showNumbersHint": "Display numbers beside channel names",
  "settings.showLogos": "Show channel logos",
  "settings.showLogosHint": "Load logos from playlist addresses",
  "settings.showClock": "Show clock",
  "settings.showClockHint": "Display a clock while the channel list is open",
  "settings.sortAlphabetically": "Sort channels alphabetically",
  "settings.sortAlphabeticallyHint": "Sort by channel name instead of playlist order",
  "settings.screenFit": "Screen fit",
  "settings.fill": "Fill",
  "settings.fillHint": "Fills the screen, cropping the edges of the picture",
  "settings.fit": "Fit",
  "settings.fitHint": "The whole picture, with bars if it does not fill the screen",
  "settings.stretch": "Stretch",
  "settings.stretchHint": "Fills the screen by distorting the picture",
  "settings.compatibility": "Compatibility mode",
  "settings.compatibilityHint":
    "Use this if a channel shows one frame, then stops. It may use additional data while repairing the stream.",
  "settings.resumeLast": "Resume last channel",
  "settings.resumeLastHint": "Open the last channel when the app starts",
  "settings.clearCache": "Clear cache",
  "settings.clearCacheHint":
    "Remove downloaded playlists, logos, and compatibility data from this device",
  "settings.resetData": "Reset app data",
  "settings.resetDataHint":
    "Remove playlists, favourites, settings, and cached data from this device",
  "settings.clearCacheQuestion": "Clear cache?",
  "settings.clearCacheBody":
    "Cached playlist data, channel logos, and compatibility data are removed from this device. Your playlists, settings, favourites, and last watched channel stay.",
  "settings.resetDataQuestion": "Reset app data?",
  "settings.resetDataBody":
    "This removes your playlists, favourites, preferences, cached data, and compatibility data from this device. It does not delete the source playlists, so you can add them again.",
  "settings.clearCacheDone": "Cache cleared.",
  "settings.resetDone": "App data reset.",
  "settings.close": "Close settings",
  "settings.change": "Change it",
  "settings.previewFallback": "The quick brown fox jumps over the lazy dog",
  "settings.playlistNamesPreserved":
    "Channel names appear exactly as the playlist writes them, in any language.",
  "app.loadingPlaylist": "Loading the playlist…",
  "app.emptyPlaylist": "That playlist has no channels in it.",
  "app.chooseAnotherPlaylist": "Choose another playlist",
  "app.closeApp": "Close the app",
  "app.noChannel": ({ number }) => `No channel ${number} in this playlist.`,
  "app.removedFavourite": "Removed from favourites",
  "app.addedFavourite": "Added to favourites",
  "banner.position": ({ at, of, list }) => `${at} of ${of} in ${list}`,
  "guide.addIt": "Add it",
  "guide.showMatches": "Show matches",
  "guide.clear": "Clear",
  "guide.changeChannel": "Change channel",
  "guide.favourite": "Favourite",
  "guide.hideThis": "Hide this",
  "guide.chooseAnotherPlaylist": "Choose another playlist",
  "guide.closeTheApp": "Close the app",
  "guide.anotherChannel": "Another channel",
  "guide.closeApp": "Close the app",
  "channel.categories": "Categories",
  "channel.channels": "Channels",
  "channel.favourites": "Favourites",
  "channel.uncategorised": "Uncategorised",
  "channel.unnamed": "Unnamed",
  "channel.noCategories": "No categories yet.",
  "channel.nothingInCategory": "Nothing in this category.",
  "channel.noMatches": ({ query }) => `No channel matches “${query}”.`,
  "channel.typeName": "Type a channel name.",
  "channel.playingNow": "Playing now",
  "channel.youAreOn": "The channel you are on",
  "search.channelName": "Channel name",
  "search.ariaLabel": "Search channels by name",
  "picture.paused": "Paused",
  "picture.pressPlay": "Press Play to carry on",
  "picture.connecting": "Connecting",
  "picture.connectingPercent": ({ percent }) => `Connecting ${percent}%`,
  "picture.slow": "This channel is being slow. Still trying…",
  "picture.tryingAgain": ({ seconds, attempt, attempts }) =>
    `Trying again${Number(seconds) > 0 ? ` in ${seconds} second${Number(seconds) === 1 ? "" : "s"}` : "…"}${Number(attempt) > 0 ? ` (${Number(attempt) + 1} of ${attempts})` : ""}`,
  "picture.failedAfterRetries":
    "Tried three times without success. Try another channel and come back later.",
  "error.broadcasterRefusing": "The broadcaster is refusing this connection.",
  "error.countryRestricted":
    "Streams are often restricted to the country they are broadcast in.",
  "error.addressStale": "The address in the playlist no longer points at a stream.",
  "error.refreshPlaylist": "Refresh the playlist in Settings to pull the current addresses.",
  "error.serverFailing": "This channel's server is failing.",
  "error.serverMayRecover": "Nothing here will fix it, and it often comes back on its own.",
  "error.cannotReachServer": "The TV could not reach this channel's server.",
  "error.checkNetwork": "It may be off the air. Check the network if other channels fail too.",
  "error.unsupportedFormat": "This channel sends a format the TV cannot decode.",
  "error.tryAnother": "Nothing here will fix it. Try another channel.",
  "error.stoppedBroadcasting": "This channel stopped broadcasting.",
  "error.mayReturn": "It may come back on its own.",
  "error.pictureFrozen": "The picture from this channel has frozen.",
  "error.serverStopped": "The server stopped sending. It often recovers.",
  "error.nothingPlayable": "Nothing playable arrived from this channel.",
  "error.offAirOrFormat": "It may be off the air, or sending a format the TV cannot decode.",
  "error.streamStopped": "The stream stopped unexpectedly.",
  "error.usuallyClears": "This usually clears on its own.",
  "onboarding.description":
    "Add the address of an M3U playlist to get started. Anything you add stays on this device, and you can add more or change it later in Settings.",
  "onboarding.playlistAddress": "Playlist address",
  "onboarding.playlistName": "Playlist name",
  "onboarding.nameOptional": "Name it (optional)",
  "onboarding.takenFromAddress": "Taken from the address",
  "onboarding.optionalAddress": "Optional, uses the address if blank",
  "onboarding.urlPlaceholder": "https://example.com/playlist.m3u",
  "playlist.saved": ({ name }) => `${name} saved.`,
  "playlist.loading": ({ name }) => `Loading ${name}…`,
  "playlist.loaded": ({ name, count }) =>
    `${name} loaded, ${count} channel${count === 1 ? "" : "s"}.`,
  "playlist.savedNoChannels": ({ name }) =>
    `${name} was saved, but no channels could be read from it.`,
  "playlist.refreshing": "Refreshing…",
  "playlist.refreshed": ({ count }) => `Refreshed, ${count} channel${count === 1 ? "" : "s"}.`,
  "playlist.nothingRead": "Nothing could be read from the active playlist.",
  "playlist.refreshFailed": ({ detail }) =>
    `Could not refresh: ${detail}. Showing the last saved copy.`,
  "playlist.loadFailed": ({ detail }) => `Could not load the playlist: ${detail}`,
  "playlist.loadingActive": "Loading the active playlist…",
  "playlist.loadedActive": ({ count }) =>
    `${count} channel${count === 1 ? "" : "s"} loaded from the active playlist.`,
  "playlist.addToStart": "Add an M3U playlist address to start watching.",
  "playlist.storedLocally": "Playlists are stored on this device only.",
  "playlist.editAria": ({ name }) => `Edit ${name}`,
  "playlist.removeAria": ({ name }) => `Remove ${name}`,
  "playlist.removeQuestion": ({ name }) => `Remove ${name}?`,
  "playlist.removeBody":
    "Its channels and the copy saved on this device go with it. The playlist itself is not touched, so it can be added again from the same address.",
  "playlist.removed": ({ name }) => (name ? `Removed ${name}.` : "Removed."),
  "validation.enterAddress": "Enter the address of a playlist.",
  "validation.startHttp": "Start the address with http:// or https://",
  "validation.completeAddress": "That is not a complete web address.",
  "validation.httpOnly": "Only http and https addresses can be loaded.",
  "validation.missingDomain": "The address is missing a domain, such as example.com.",
  "validation.noSpaces": "Addresses cannot contain spaces.",
  "diagnostics.title": "Diagnostics",
  "diagnostics.lead":
    "This device's platform and remote input. Use these details when something works on one device but not another.",
  "diagnostics.app": "App",
  "diagnostics.platform": "Platform",
  "diagnostics.engine": "Engine",
  "diagnostics.screen": "Screen",
  "diagnostics.memory": "Memory",
  "diagnostics.scriptHeap": "Script heap",
  "diagnostics.flexGap": "Flex gap",
  "diagnostics.keysGranted": "Keys granted",
  "diagnostics.refused": "Refused",
  "diagnostics.remoteHas": "Remote has",
  "diagnostics.cached": "Cached",
  "diagnostics.compatibility": "Compatibility",
  "diagnostics.remoteKeys": "Remote keys",
  "diagnostics.remoteLead":
    "Press a remote button. The last eight keys received by the app appear here, including keys the app does not use. If a button is missing, it did not reach the app.",
  "diagnostics.noKeys": "No keys received yet.",
  "diagnostics.reading": "reading…",
  "diagnostics.tizen": ({ version }) => `Tizen ${version}`,
  "diagnostics.notSamsung": "Not a Samsung TV",
  "diagnostics.chromium": ({ version }) => `Chromium ${version}`,
  "diagnostics.unknown": "unknown",
  "diagnostics.notReported": "not reported",
  "diagnostics.yes": "yes",
  "diagnostics.noMarginFallback": "no, using the margin fallback",
  "diagnostics.noneNotTv": "none, this is not a television",
  "diagnostics.keysCount": ({ count }) => `${count} key${count === 1 ? "" : "s"}`,
  "diagnostics.cacheUsage": ({ used, budget, share, entries }) =>
    `${used}MB of ${budget}MB, ${share}%, in ${entries}`,
  "diagnostics.knownHosts": ({ count }) => `, ${count} host${count === 1 ? "" : "s"} known`,
  "diagnostics.entryCount": ({ count }) => `${count} entr${count === 1 ? "y" : "ies"}`,
  "diagnostics.compatibilityServing": ({ port, known }) => `serving on port ${port}${known}`,
  "diagnostics.compatibilityListening": ({ port, known }) =>
    `listening on port ${port}, nothing to repair${known}`,
  "diagnostics.compatibilityStarting": ({ known }) => `starting${known}`,
  "diagnostics.compatibilityUnavailable": ({ reason }) => `not available on this TV: ${reason}`,
  "diagnostics.compatibilityIdle": ({ known }) => `idle${known}`,
  "about.title": "About",
  "about.version": ({ version }) => `Version ${version}`,
  "about.description":
    "OpenIPTV is a free, open source player for M3U playlists. It includes no channels and sends no analytics. The app connects only to the playlists, streams, and logos you choose. Your playlist addresses and settings stay on this device.",
  "about.disclaimer":
    "OpenIPTV is not affiliated with broadcasters or streaming services. Watch only content you are authorised to access.",
  "about.qr": "Scan the QR code to view the source code or report a problem.",
  "about.qrAlt": ({ url }) => `QR code linking to ${url}`,
  "exit.question": "Close OpenIPTV?",
  "exit.body": "You can open it again from the Apps row.",
} satisfies Record<string, Message>;

export type MessageKey = keyof typeof ENGLISH;

const PERSIAN: Partial<Record<MessageKey, Message>> = {
  "common.search": "جستجو",
  "common.settings": "تنظیمات",
  "common.move": "حرکت",
  "common.open": "باز کردن",
  "common.closeSettings": "بستن تنظیمات",
  "common.changeIt": "تغییر",
  "common.closeApp": "بستن برنامه",
  "common.return": "بازگشت",
  "common.ok": "تأیید",
  "common.watch": "تماشا",
  "common.allChannels": "همه کانال‌ها",
  "common.anotherChannel": "کانال دیگر",
  "common.backToChannels": "بازگشت به کانال‌ها",
  "common.backToPicture": "بازگشت به تصویر",
  "common.channelNumber": "شماره کانال",
  "common.clear": "پاک کردن",
  "common.save": "ذخیره",
  "common.cancel": "لغو",
  "common.addPlaylist": "افزودن فهرست",
  "common.refreshPlaylist": "تازه‌سازی فهرست",
  "common.refreshing": "در حال تازه‌سازی…",
  "common.active": "فعال",
  "common.edit": "ویرایش",
  "common.remove": "حذف",
  "common.keepIt": "نگه داشتن",
  "common.close": "بستن",
  "common.keepWatching": "ادامه تماشا",
  "common.stayHere": "ماندن در این صفحه",
  "common.on": "روشن",
  "common.off": "خاموش",
  "common.play": "پخش",
  "common.playPause": "پخش یا مکث",
  "common.up": "بالا",
  "common.right": "راست",
  "common.down": "پایین",
  "common.left": "چپ",
  "common.select": "انتخاب",
  "common.returnKey": "بازگشت",
  "common.volumeUp": "افزایش صدا",
  "common.volumeDown": "کاهش صدا",
  "common.channelUp": "کانال بعدی",
  "common.channelDown": "کانال قبلی",
  "common.rewind": "عقب بردن",
  "common.stop": "توقف",
  "common.fastForward": "جلو بردن",
  "common.trackPrevious": "ردیابی قبلی",
  "common.trackNext": "ردیابی بعدی",
  "common.red": "قرمز",
  "common.yellow": "زرد",
  "common.blue": "آبی",
  "common.green": "سبز",
  "remote.show": "نمایش کنترل هوشمند",
  "remote.hide": "پنهان کردن کنترل",
  "remote.keypad": "صفحه‌کلید روی صفحه",
  "remote.raiseKeypad": "نمایش صفحه‌کلید روی صفحه",
  "language.system": "سیستم",
  "language.english": "انگلیسی",
  "language.persian": "فارسی",
  "language.arabic": "عربی",
  "language.bengali": "بنگالی",
  "language.chinese": "چینی ساده",
  "language.dutch": "هلندی",
  "language.french": "فرانسوی",
  "language.german": "آلمانی",
  "language.hindi": "هندی",
  "language.indonesian": "اندونزیایی",
  "language.italian": "ایتالیایی",
  "language.japanese": "ژاپنی",
  "language.korean": "کره‌ای",
  "language.portuguese": "پرتغالی",
  "language.russian": "روسی",
  "language.spanish": "اسپانیایی",
  "language.turkish": "ترکی",
  "settings.title": "تنظیمات",
  "settings.appearance": "ظاهر",
  "settings.playback": "پخش",
  "settings.general": "عمومی",
  "settings.playlists": "فهرست‌ها",
  "settings.diagnostics": "عیب‌یابی",
  "settings.about": "درباره",
  "settings.language": "زبان",
  "settings.languageHint": "زبان مورد استفاده برنامه را انتخاب کنید",
  "settings.textSize": "اندازه متن",
  "settings.small": "کوچک",
  "settings.medium": "متوسط",
  "settings.large": "بزرگ",
  "settings.extraLarge": "خیلی بزرگ",
  "settings.textSizeHint": "در همه بخش‌های برنامه اعمال می‌شود",
  "settings.showNumbers": "نمایش شماره کانال‌ها",
  "settings.showNumbersHint": "نمایش شماره کنار نام کانال‌ها",
  "settings.showLogos": "نمایش لوگوی کانال‌ها",
  "settings.showLogosHint": "بارگذاری لوگو از آدرس‌های فهرست",
  "settings.showClock": "نمایش ساعت",
  "settings.showClockHint": "نمایش ساعت هنگام باز بودن فهرست کانال‌ها",
  "settings.sortAlphabetically": "مرتب‌سازی الفبایی کانال‌ها",
  "settings.sortAlphabeticallyHint": "مرتب‌سازی بر اساس نام کانال به جای ترتیب فهرست",
  "settings.screenFit": "اندازه تصویر",
  "settings.fill": "پر کردن",
  "settings.fillHint": "پر کردن صفحه با بریدن لبه‌های تصویر",
  "settings.fit": "اندازه کامل",
  "settings.fitHint": "نمایش کامل تصویر با نوارهای کناری در صورت نیاز",
  "settings.stretch": "کشیدن",
  "settings.stretchHint": "پر کردن صفحه با تغییر شکل تصویر",
  "settings.compatibility": "حالت سازگاری",
  "settings.compatibilityHint":
    "اگر کانال یک فریم نشان می‌دهد و سپس متوقف می‌شود از این گزینه استفاده کنید. ممکن است هنگام تعمیر جریان داده بیشتری مصرف شود.",
  "settings.resumeLast": "ادامه آخرین کانال",
  "settings.resumeLastHint": "باز کردن آخرین کانال هنگام شروع برنامه",
  "settings.clearCache": "پاک کردن حافظه موقت",
  "settings.clearCacheHint": "حذف فهرست‌ها، لوگوها و داده سازگاری بارگیری شده از این دستگاه",
  "settings.resetData": "بازنشانی داده‌های برنامه",
  "settings.resetDataHint": "حذف فهرست‌ها، علاقه‌مندی‌ها، تنظیمات و داده‌های موقت از این دستگاه",
  "settings.clearCacheQuestion": "حافظه موقت پاک شود؟",
  "settings.clearCacheBody":
    "داده فهرست‌ها، لوگوی کانال‌ها و داده سازگاری از این دستگاه حذف می‌شوند. فهرست‌ها، تنظیمات، علاقه‌مندی‌ها و آخرین کانال شما باقی می‌مانند.",
  "settings.resetDataQuestion": "داده‌های برنامه بازنشانی شود؟",
  "settings.resetDataBody":
    "فهرست‌ها، علاقه‌مندی‌ها، تنظیمات، داده‌های موقت و داده سازگاری از این دستگاه حذف می‌شوند. فهرست‌های اصلی حذف نمی‌شوند و می‌توانید دوباره آن‌ها را اضافه کنید.",
  "settings.clearCacheDone": "حافظه موقت پاک شد.",
  "settings.resetDone": "داده‌های برنامه بازنشانی شد.",
  "settings.close": "بستن تنظیمات",
  "settings.change": "تغییر",
  "settings.previewFallback": "روباه قهوه‌ای سریع از روی سگ تنبل می‌پرد",
  "settings.playlistNamesPreserved":
    "نام کانال‌ها دقیقاً همان‌طور که در فهرست نوشته شده‌اند و به هر زبانی نمایش داده می‌شوند.",
  "app.loadingPlaylist": "در حال بارگذاری فهرست…",
  "app.emptyPlaylist": "این فهرست کانالی ندارد.",
  "app.chooseAnotherPlaylist": "انتخاب فهرست دیگر",
  "app.closeApp": "بستن برنامه",
  "app.noChannel": ({ number }) =>
    `کانال ${formatNumber("fa", Number(number))} در این فهرست وجود ندارد.`,
  "app.removedFavourite": "از علاقه‌مندی‌ها حذف شد",
  "app.addedFavourite": "به علاقه‌مندی‌ها اضافه شد",
  "banner.position": ({ at, of, list }) => `${at} از ${of} در ${list}`,
  "guide.addIt": "افزودن",
  "guide.showMatches": "نمایش نتایج",
  "guide.clear": "پاک کردن",
  "guide.changeChannel": "تغییر کانال",
  "guide.favourite": "علاقه‌مندی",
  "guide.hideThis": "پنهان کردن",
  "guide.chooseAnotherPlaylist": "انتخاب فهرست دیگر",
  "guide.closeTheApp": "بستن برنامه",
  "guide.anotherChannel": "کانال دیگر",
  "guide.closeApp": "بستن برنامه",
  "channel.categories": "دسته‌ها",
  "channel.channels": "کانال‌ها",
  "channel.favourites": "علاقه‌مندی‌ها",
  "channel.uncategorised": "بدون دسته",
  "channel.unnamed": "بدون نام",
  "channel.noCategories": "هنوز دسته‌ای وجود ندارد.",
  "channel.nothingInCategory": "این دسته خالی است.",
  "channel.noMatches": ({ query }) => `هیچ کانالی با «${query}» مطابقت ندارد.`,
  "channel.typeName": "نام یک کانال را وارد کنید.",
  "channel.playingNow": "در حال پخش",
  "channel.youAreOn": "کانال فعلی شما",
  "search.channelName": "نام کانال",
  "search.ariaLabel": "جستجوی کانال‌ها بر اساس نام",
  "picture.paused": "مکث",
  "picture.pressPlay": "برای ادامه پخش را فشار دهید",
  "picture.connecting": "در حال اتصال",
  "picture.connectingPercent": ({ percent }) =>
    `در حال اتصال ${formatNumber("fa", Number(percent))}٪`,
  "picture.slow": "این کانال کند است. همچنان در حال تلاش هستیم…",
  "picture.tryingAgain": ({ seconds, attempt, attempts }) =>
    `تلاش دوباره${Number(seconds) > 0 ? ` تا ${formatNumber("fa", Number(seconds))} ثانیه دیگر` : "…"}${Number(attempt) > 0 ? ` (${formatNumber("fa", Number(attempt) + 1)} از ${formatNumber("fa", Number(attempts))})` : ""}`,
  "picture.failedAfterRetries":
    "سه بار تلاش انجام شد و موفق نبود. کانال دیگری را امتحان کنید و بعداً برگردید.",
  "error.broadcasterRefusing": "پخش‌کننده این اتصال را نمی‌پذیرد.",
  "error.countryRestricted": "جریان‌ها اغلب فقط در کشور محل پخش در دسترس هستند.",
  "error.addressStale": "آدرس موجود در فهرست دیگر به یک جریان اشاره نمی‌کند.",
  "error.refreshPlaylist": "برای دریافت آدرس‌های جدید، فهرست را در تنظیمات تازه‌سازی کنید.",
  "error.serverFailing": "سرور این کانال با مشکل روبه‌رو است.",
  "error.serverMayRecover":
    "کاری از اینجا برای رفع آن انجام نمی‌شود و مشکل اغلب خودبه‌خود برطرف می‌شود.",
  "error.cannotReachServer": "تلویزیون نتوانست به سرور این کانال دسترسی پیدا کند.",
  "error.checkNetwork":
    "ممکن است کانال خارج از پخش باشد. اگر کانال‌های دیگر هم مشکل دارند شبکه را بررسی کنید.",
  "error.unsupportedFormat":
    "این کانال قالبی را ارسال می‌کند که تلویزیون نمی‌تواند رمزگشایی کند.",
  "error.tryAnother": "کاری از اینجا برای رفع آن انجام نمی‌شود. کانال دیگری را امتحان کنید.",
  "error.stoppedBroadcasting": "پخش این کانال متوقف شده است.",
  "error.mayReturn": "ممکن است دوباره فعال شود.",
  "error.pictureFrozen": "تصویر این کانال ثابت مانده است.",
  "error.serverStopped": "سرور دیگر داده‌ای ارسال نمی‌کند. مشکل اغلب برطرف می‌شود.",
  "error.nothingPlayable": "چیز قابل پخشی از این کانال دریافت نشد.",
  "error.offAirOrFormat":
    "ممکن است کانال خارج از پخش باشد یا قالبی ارسال کند که تلویزیون نمی‌تواند رمزگشایی کند.",
  "error.streamStopped": "جریان به‌طور غیرمنتظره متوقف شد.",
  "error.usuallyClears": "این مشکل معمولاً خودبه‌خود برطرف می‌شود.",
  "onboarding.description":
    "برای شروع، آدرس یک فهرست M3U را اضافه کنید. هر چیزی که اضافه می‌کنید روی همین دستگاه می‌ماند و بعداً می‌توانید از تنظیمات موارد بیشتری اضافه کنید یا آن را تغییر دهید.",
  "onboarding.playlistAddress": "آدرس فهرست",
  "onboarding.playlistName": "نام فهرست",
  "onboarding.nameOptional": "نام فهرست (اختیاری)",
  "onboarding.takenFromAddress": "از آدرس گرفته می‌شود",
  "onboarding.optionalAddress": "اختیاری، در صورت خالی بودن از آدرس استفاده می‌شود",
  "onboarding.urlPlaceholder": "https://example.com/playlist.m3u",
  "playlist.saved": ({ name }) => `${name} ذخیره شد.`,
  "playlist.loading": ({ name }) => `در حال بارگذاری ${name}…`,
  "playlist.loaded": ({ name, count }) =>
    `${name} بارگذاری شد، ${formatNumber("fa", Number(count))} کانال.`,
  "playlist.savedNoChannels": ({ name }) => `${name} ذخیره شد، اما کانالی از آن خوانده نشد.`,
  "playlist.refreshing": "در حال تازه‌سازی…",
  "playlist.refreshed": ({ count }) =>
    `تازه‌سازی شد، ${formatNumber("fa", Number(count))} کانال.`,
  "playlist.nothingRead": "از فهرست فعال چیزی خوانده نشد.",
  "playlist.refreshFailed": ({ detail }) =>
    `تازه‌سازی ناموفق بود: ${detail}. آخرین نسخه ذخیره شده نمایش داده می‌شود.`,
  "playlist.loadFailed": ({ detail }) => `بارگذاری فهرست ناموفق بود: ${detail}`,
  "playlist.loadingActive": "در حال بارگذاری فهرست فعال…",
  "playlist.loadedActive": ({ count }) =>
    `${formatNumber("fa", Number(count))} کانال از فهرست فعال بارگذاری شد.`,
  "playlist.addToStart": "برای شروع تماشا یک آدرس فهرست M3U اضافه کنید.",
  "playlist.storedLocally": "فهرست‌ها فقط روی همین دستگاه ذخیره می‌شوند.",
  "playlist.editAria": ({ name }) => `ویرایش ${name}`,
  "playlist.removeAria": ({ name }) => `حذف ${name}`,
  "playlist.removeQuestion": ({ name }) => `‏${name} حذف شود؟`,
  "playlist.removeBody":
    "کانال‌های آن و نسخه ذخیره شده روی این دستگاه حذف می‌شوند. خود فهرست تغییری نمی‌کند و می‌توانید آن را از همان آدرس دوباره اضافه کنید.",
  "playlist.removed": ({ name }) => (name ? `${name} حذف شد.` : "حذف شد."),
  "validation.enterAddress": "آدرس یک فهرست را وارد کنید.",
  "validation.startHttp": "آدرس را با http:// یا https:// شروع کنید",
  "validation.completeAddress": "این یک آدرس کامل وب نیست.",
  "validation.httpOnly": "فقط آدرس‌های http و https قابل بارگذاری هستند.",
  "validation.missingDomain": "دامنه‌ای مانند example.com در آدرس وجود ندارد.",
  "validation.noSpaces": "آدرس‌ها نمی‌توانند فاصله داشته باشند.",
  "diagnostics.title": "عیب‌یابی",
  "diagnostics.lead":
    "پلتفرم و ورودی کنترل این دستگاه. وقتی چیزی روی یک دستگاه کار می‌کند و روی دستگاه دیگر کار نمی‌کند از این جزئیات استفاده کنید.",
  "diagnostics.app": "برنامه",
  "diagnostics.platform": "پلتفرم",
  "diagnostics.engine": "موتور",
  "diagnostics.screen": "صفحه",
  "diagnostics.memory": "حافظه",
  "diagnostics.scriptHeap": "حافظه اسکریپت",
  "diagnostics.flexGap": "فاصله فلکس",
  "diagnostics.keysGranted": "کلیدهای مجاز",
  "diagnostics.refused": "رد شده",
  "diagnostics.remoteHas": "کلیدهای کنترل",
  "diagnostics.cached": "ذخیره شده",
  "diagnostics.compatibility": "سازگاری",
  "diagnostics.remoteKeys": "کلیدهای کنترل",
  "diagnostics.remoteLead":
    "یک دکمه کنترل را فشار دهید. هشت کلید آخر دریافت شده توسط برنامه در اینجا نمایش داده می‌شوند، حتی کلیدهایی که برنامه استفاده نمی‌کند. اگر کلیدی وجود ندارد، به برنامه نرسیده است.",
  "diagnostics.noKeys": "هنوز کلیدی دریافت نشده است.",
  "diagnostics.reading": "در حال خواندن…",
  "diagnostics.tizen": ({ version }) => `Tizen ${version}`,
  "diagnostics.notSamsung": "تلویزیون سامسونگ نیست",
  "diagnostics.chromium": ({ version }) => `Chromium ${version}`,
  "diagnostics.unknown": "نامشخص",
  "diagnostics.notReported": "گزارش نشده",
  "diagnostics.yes": "بله",
  "diagnostics.noMarginFallback": "خیر، با جایگزین حاشیه‌ای",
  "diagnostics.noneNotTv": "هیچ‌کدام، این یک تلویزیون نیست",
  "diagnostics.keysCount": ({ count }) => `${formatNumber("fa", Number(count))} کلید`,
  "diagnostics.cacheUsage": ({ used, budget, share, entries }) =>
    `${used} مگابایت از ${budget} مگابایت، ${share}٪، در ${entries}`,
  "diagnostics.knownHosts": ({ count }) =>
    `، ${formatNumber("fa", Number(count))} میزبان شناخته شده`,
  "diagnostics.entryCount": ({ count }) => `${formatNumber("fa", Number(count))} مورد`,
  "diagnostics.compatibilityServing": ({ port, known }) =>
    `در حال سرو روی درگاه ${port}${known}`,
  "diagnostics.compatibilityListening": ({ port, known }) =>
    `در حال گوش دادن روی درگاه ${port}، چیزی برای تعمیر نیست${known}`,
  "diagnostics.compatibilityStarting": ({ known }) => `در حال شروع${known}`,
  "diagnostics.compatibilityUnavailable": ({ reason }) =>
    `روی این تلویزیون در دسترس نیست: ${reason}`,
  "diagnostics.compatibilityIdle": ({ known }) => `آماده${known}`,
  "about.title": "درباره",
  "about.version": ({ version }) => `نسخه ${version}`,
  "about.description":
    "OpenIPTV یک پخش‌کننده رایگان و متن‌باز برای فهرست‌های M3U است. هیچ کانالی در آن وجود ندارد و هیچ داده تحلیلی ارسال نمی‌کند. برنامه فقط به فهرست‌ها، جریان‌ها و لوگوهایی متصل می‌شود که شما انتخاب می‌کنید. آدرس فهرست‌ها و تنظیمات شما روی همین دستگاه می‌مانند.",
  "about.disclaimer":
    "OpenIPTV وابسته به پخش‌کنندگان یا سرویس‌های پخش نیست. فقط محتوایی را تماشا کنید که اجازه دسترسی به آن را دارید.",
  "about.qr": "برای دیدن کد منبع یا گزارش مشکل، کد QR را اسکن کنید.",
  "about.qrAlt": ({ url }) => `کد QR برای ${url}`,
  "exit.question": "OpenIPTV بسته شود؟",
  "exit.body": "می‌توانید آن را دوباره از ردیف برنامه‌ها باز کنید.",
};

const CATALOGS: Partial<Record<Locale, Partial<Record<MessageKey, Message>>>> = {
  ar: arabic,
  bn: bengali,
  "zh-CN": chinese,
  nl: dutch,
  fr: french,
  de: german,
  hi: hindi,
  id: indonesian,
  it: italian,
  ja: japanese,
  ko: korean,
  pt: portuguese,
  ru: russian,
  es: spanish,
  tr: turkish,
};

export interface LocaleOption {
  id: LocalePreference;
  nativeLabel: string;
  englishName: string;
}

const LANGUAGE_OPTIONS: LocaleOption[] = [
  { id: "ar", nativeLabel: "العربية", englishName: "Arabic" },
  { id: "bn", nativeLabel: "বাংলা", englishName: "Bengali" },
  { id: "zh-CN", nativeLabel: "简体中文", englishName: "Chinese (Simplified)" },
  { id: "nl", nativeLabel: "Nederlands", englishName: "Dutch" },
  { id: "en", nativeLabel: "English", englishName: "English" },
  { id: "fr", nativeLabel: "Français", englishName: "French" },
  { id: "de", nativeLabel: "Deutsch", englishName: "German" },
  { id: "hi", nativeLabel: "हिन्दी", englishName: "Hindi" },
  { id: "id", nativeLabel: "Bahasa Indonesia", englishName: "Indonesian" },
  { id: "it", nativeLabel: "Italiano", englishName: "Italian" },
  { id: "ja", nativeLabel: "日本語", englishName: "Japanese" },
  { id: "ko", nativeLabel: "한국어", englishName: "Korean" },
  { id: "fa", nativeLabel: "فارسی", englishName: "Persian" },
  { id: "pt", nativeLabel: "Português", englishName: "Portuguese" },
  { id: "ru", nativeLabel: "Русский", englishName: "Russian" },
  { id: "es", nativeLabel: "Español", englishName: "Spanish" },
  { id: "tr", nativeLabel: "Türkçe", englishName: "Turkish" },
];

LANGUAGE_OPTIONS.sort((a, b) => a.englishName.localeCompare(b.englishName, "en"));

export const LOCALE_OPTIONS: readonly LocaleOption[] = [
  { id: "system", nativeLabel: "System", englishName: "System" },
  ...LANGUAGE_OPTIONS,
];

const LANGUAGE_KEYS: Record<Locale, MessageKey> = {
  ar: "language.arabic",
  bn: "language.bengali",
  "zh-CN": "language.chinese",
  nl: "language.dutch",
  en: "language.english",
  fr: "language.french",
  de: "language.german",
  hi: "language.hindi",
  id: "language.indonesian",
  it: "language.italian",
  ja: "language.japanese",
  ko: "language.korean",
  fa: "language.persian",
  pt: "language.portuguese",
  ru: "language.russian",
  es: "language.spanish",
  tr: "language.turkish",
};

export function localeLabelKey(id: LocalePreference): MessageKey {
  return id === "system" ? "language.system" : LANGUAGE_KEYS[id];
}

const SYSTEM_LANGUAGE_MAP: Record<string, Locale> = {
  ar: "ar",
  bn: "bn",
  zh: "zh-CN",
  nl: "nl",
  en: "en",
  fr: "fr",
  de: "de",
  hi: "hi",
  id: "id",
  it: "it",
  ja: "ja",
  ko: "ko",
  fa: "fa",
  pt: "pt",
  ru: "ru",
  es: "es",
  tr: "tr",
};

export function detectSystemLocale(
  language = typeof navigator === "undefined" ? "en" : navigator.language,
): Locale {
  return SYSTEM_LANGUAGE_MAP[language.toLowerCase().split("-")[0]] ?? "en";
}

export function isLocalePreference(value: unknown): value is LocalePreference {
  return value === "system" || (typeof value === "string" && LOCALES.includes(value as Locale));
}

export function resolveLocale(preference: LocalePreference, systemLanguage?: string): Locale {
  return preference === "system" ? detectSystemLocale(systemLanguage) : preference;
}

export function directionFor(locale: Locale): Direction {
  return locale === "ar" || locale === "fa" ? "rtl" : "ltr";
}

export function applyDocumentLocale(locale: Locale): void {
  document.documentElement.lang = locale;
  document.documentElement.dir = directionFor(locale);
}

export function formatNumber(locale: Locale, value: number): string {
  try {
    return new Intl.NumberFormat(locale).format(value);
  } catch {
    return String(value);
  }
}

export function formatTime(locale: Locale, value: Date): string {
  try {
    return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(
      value,
    );
  } catch {
    return value.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
}

function interpolate(value: string, values: MessageValues): string {
  return value.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? `{${name}}`));
}

export function translate(locale: Locale, key: MessageKey, values: MessageValues = {}): string {
  const value = (locale === "fa" ? PERSIAN[key] : CATALOGS[locale]?.[key]) ?? ENGLISH[key];
  return typeof value === "function" ? value(values) : interpolate(value, values);
}

export function untranslatedKeys(locale: Locale): MessageKey[] {
  if (locale === "en") return [];
  const catalog = locale === "fa" ? PERSIAN : CATALOGS[locale];
  if (!catalog) return Object.keys(ENGLISH) as MessageKey[];
  return Object.keys(ENGLISH).filter((key) => !(key in catalog)) as MessageKey[];
}
