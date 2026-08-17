# Publishing

Two different things are called publishing here, and it is worth separating them before anything
else.

**A GitHub release** is fully automated. Tag a version, and `.github/workflows/release.yml` runs the
gates, builds, signs the widget with the certificates in this repository's secrets, and attaches it
with a checksum.

**A Samsung store release** is not, and cannot be. The TV Seller Office has no API, no CLI and no
supported automation of any kind: Samsung publishes a real publishing API, but only for the Galaxy
Store and Android applications, and the two stores share nothing. Companies that submit TV apps for
their customers do it by asking for the customer's login and clicking through the forms themselves,
which is the clearest evidence there is that no other route exists. So everything from uploading the
package onwards is a person filling in a web form, and the useful thing this repository can do is
make that person's job short. That is what `npm run store:assets` is for.

## Before any of it: what a store account actually allows

Read this first, because it decides whether the rest is worth doing.

Membership is free to open with an ordinary Samsung account, and an individual qualifies: a business
registration number is required only if the account type is Company, so no company is needed. What is
needed is a representative name, a support email, a telephone number and a postal address, because
those are published on the television alongside the listing.

Then the part that matters most. A new account is a **Public Seller**, and a Public Seller can
**only launch an application in the United States**. Releasing anywhere else, the United Kingdom
included, requires becoming a **Partner Seller**, which means signing a contract offline with Samsung
or one of its subsidiaries and then being approved by a Samsung content manager. That is a commercial
negotiation rather than a technical step, and no amount of tooling shortens it.

Review takes as long as it takes. Samsung declines to commit to a number and says it depends on
tester availability and on how many rounds of defects a submission generates. Reports from other
projects suggest weeks rather than days, and more than four weeks is not unusual.

## Certificates

A Tizen application is signed twice, and the difference between the two signatures explains most of
what is confusing here.

The **author certificate** is the identity of whoever wrote the application. It produces
`author-signature.xml`, and an update is accepted only when its author signature matches the previous
version's. **Back it up, with its password, somewhere you will still have it in five years.** Lose it
and the application can never be updated again: the only remedy is to register a new application, with
a new name and a new id, and ask everybody to install it instead.

The **distributor certificate** is a claim about who distributed the application. The one created
locally is a pseudo distributor certificate, it carries the device unique identifiers of specific
televisions, and that is why a sideloaded build installs on those sets and refuses everywhere else.
For a store submission it does not matter at all, because Samsung strips this signature and applies
its own, so the identifiers in it place no limit on who can install from the store.

Three prerequisites that are easy to miss, each of which stops the process dead:

- Certificate Manager only offers the **Samsung** certificate type once the Samsung Certificate
  Extension is installed through the Tizen Studio Package Manager. Without it the only option is the
  generic Tizen type, which signs perfectly happily and is then refused by a retail television.
- Creating a Samsung distributor certificate requires signing in with a **Samsung account**.
- The **television has to be switched on, in developer mode and connected** at that moment, because
  that is when its identifier is read.

Samsung also warns that certificates cannot be created at all on Samsung Certificate Extension
versions before 2.0.73, so an old Tizen Studio may simply refuse.

## The four secrets the release workflow needs

Set these on the `release` environment rather than as plain repository secrets, so a pull request
cannot reach them:

| Secret | What it is |
|:--|:--|
| `TIZEN_AUTHOR_P12` | The author certificate, base64 encoded |
| `TIZEN_AUTHOR_PASSWORD` | Its password |
| `TIZEN_DISTRIBUTOR_P12` | The distributor certificate, base64 encoded |
| `TIZEN_DISTRIBUTOR_PASSWORD` | Its password |

Both certificates live in `~/SamsungCertificate/<profile>/` after Certificate Manager creates them.
Encode them without newlines:

```bash
base64 -i ~/SamsungCertificate/OpenIPTV/author.p12 | tr -d '\n' | pbcopy
```

The workflow writes them under `RUNNER_TEMP`, never into the workspace, and deletes them in a step
that runs even when the build fails or is cancelled.

## Cutting a release

Write the entry in [CHANGELOG.md](../CHANGELOG.md) first, under the version about to be cut, because
the release notes are read from it and a tag cannot be moved once anybody has pulled it.

```bash
npm version patch          # or minor, which writes package.json and makes the commit
git push && git push --tags
```

The tag carries no `v`. `.npmrc` sets `tag-version-prefix` to nothing so `npm version` writes `1.0.0`
rather than `v1.0.0`, and the workflow triggers on a tag beginning with a digit. The reason is that
Samsung's version is the one that has to be right and Samsung accepts no prefix, so keeping the two
identical means there is nothing to strip and nothing to get wrong.

The workflow then checks that the tag and `package.json` agree and that the version fits what Samsung
accepts, which is `major.minor.micro` bounded at 255, 255 and 65535, with each release strictly
greater than the last one uploaded. A four part version is only legal for multi architecture packages
and a build suffix is refused outright, so `1.0.0-beta.1` is not available even as a private
rehearsal. A beta belongs in the alpha test and the phased rollout described below, not in the
version string.

## Then the manual half, in the order the forms come

1. **Applications, then Create.** Choose Tizen Web Application, and enter a management name.

2. **App Package.** Upload `OpenIPTV.wgt` from the release. An automated pre test runs immediately
   and only a package that passes it can be registered. Three things in this repository exist to get
   past that test: the `<feature>` element declaring the screen size in `public/config.xml`, which a
   hand written manifest has nothing to inject and whose absence is the pre test failure Samsung's own
   guide walks through, the `<name>` element, which must match the App Title you type for the default
   language **character for character**, and the version, which must be higher than any already
   uploaded.

3. **App information.** Title, description of up to 4000 characters, at least three tags, category,
   age rating, service countries, and a support email. A privacy policy address is required only if
   the application collects personal data, and this one collects none, which is worth stating in the
   description rather than leaving to be assumed.

4. **The pictures.** `npm run store:assets` writes all six into `build/store/`, at the sizes the form
   demands: four screenshots at 1920 by 1080 as JPEG under 500KB each, and the two icon layers at
   1920 by 1080 as PNG under 300KB, with the mark inside the middle 512 by 423 that Samsung crops the
   smaller sizes from.

   One honest limitation. The video on a television is drawn on a hardware plane underneath the page,
   so it is absent from any capture of the application: a screenshot of a channel playing is a
   screenshot of a black rectangle with the banner over it. The four this script produces are
   therefore interface screens, which is why they are the channel list, the categories, the search and
   Settings. If a filled picture is wanted behind the interface, composite a still by hand.

   Whatever you do, keep real broadcasters out of them. Samsung checks intellectual property in store
   artwork, and a player that ships no content has no reason to show a channel it does not provide.
   The script uses invented names for exactly this reason.

5. **The UI description.** A PowerPoint file, from Samsung's own template, documenting every screen
   and every remote key the application remaps. Samsung says twice on its own page that this document
   is a frequent cause of rejection, and it has to be updated and resubmitted with every update. The
   template is behind the Seller Office login. Two things to state in it explicitly, because they are
   the ones testers check: **Return** goes back one screen and shows an exit confirmation on the home
   screen, and **Exit** is never intercepted at all.

6. **Distribute.** Choose the model groups, and provide a test account or, for this application, a
   **working playlist address for testing**. This is the requirement most likely to trip up an app
   that deliberately ships with nothing: every feature needs live content to exercise, and a
   playlist that expires halfway through testing is untestable.

   This repository publishes a one channel NASA TV Public demo playlist at
   [the Pages demo address](https://shayanline.github.io/OpenIPTV/demo/nasa.m3u). It is added to the
   Pages artifact rather than `public/`, so it is available for testing without becoming part of the
   widget or a default playlist. Confirm that the current NASA programming is suitable before using
   it, because NASA notes that some programming may include material from third parties.

7. **Request New Release**, then wait, then answer whatever comes back under Defect Resolve.

## Two things worth using before the first full submission

An **alpha test** installs an unreviewed build onto up to fifty named televisions for thirty days,
which is the closest thing to TestFlight here and much cheaper than burning a review cycle on
something avoidable.

A **phased rollout** releases to 3 percent of sets, then 10 percent, then everybody, and can be
stopped and rolled back. For a first published version that is simply free insurance.

## What this application already satisfies

Checked against Samsung's mandatory feature list, and true in the code today rather than aspirational:

- **The Return key** goes back one screen everywhere and, on the home screen, opens a confirmation
  built as an HTML element that exits through `getCurrentApplication().exit()`, which is exactly the
  prescribed behaviour.
- **The Exit key** is never registered, which is what the checklist demands: no popup, no handler, no
  interception.
- **Multitasking**, which is mandatory on television. `hide()` calls `webapis.avplay.suspend()` and
  `show()` restores, rather than pausing and playing, so a set that backgrounds the application during
  playback resumes where it was.
- **No crashes on suspend, resume or relaunch**, and remote presses during buffering are answered.
- **Launch inside ten seconds.** The launch marks are measured rather than assumed, and
  [testing and measurement](testing.md) describes how.

## The rejection risk nobody can engineer away

A player for user supplied playlists is a category under pressure. Smart IPTV and IPTV Smarters Pro
have both been removed from television stores, attributed to pressure from rights holders rather than
to any technical defect, while other players remain listed. Samsung can suspend a listing unilaterally
and a seller cannot restore it, only a content manager can.

Nothing in this repository changes that, and it is not a reason to avoid submitting. It is a reason to
describe the application accurately as a player that provides no content, to keep other people's
trademarks out of the listing, and to keep the sideload route in the README working, since it is the
route that cannot be withdrawn by anybody.
