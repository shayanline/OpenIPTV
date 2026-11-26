/*
 * One reading interval for everything transient over the picture.
 *
 * The banner naming the channel and the playback deck are the same kind of thing to the
 * person watching: chrome that appeared over a programme and should go away on its own.
 * They used to keep separate clocks, eight seconds for the banner and five for the deck,
 * which meant the same gesture could leave one surface up while the other had gone. Both
 * now share this duration, so the last interaction decides for all of it at once.
 *
 * Eight seconds rather than the five the media player guidance fixes for controls, because
 * the banner is a caption that is read rather than operated, and a caption that leaves early
 * tells the viewer nothing. Nothing has to be waited out either: RETURN clears the screen at
 * once, so the timeout only decides when chrome goes if nobody asks.
 */
export const PLAYBACK_CHROME_TIMEOUT_MS = 8000;
