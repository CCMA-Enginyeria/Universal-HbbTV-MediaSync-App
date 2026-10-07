# Meta Horizon Store — Listing for Meta Quest

Version **1.7.0**, the first Meta Horizon Store release. The app ships as a
**2D (panel) Android app**: the same native Android app as Google Play, built
with the `quest` build type (Horizon OS manifest, `minSdk` 29, `targetSdk` 34).

Character limits (Developer Dashboard → *Store* → *Details*): Name ≤ 40,
Short description ≤ 500, Long description ≤ 1500. One block per app language;
the Dashboard only localizes the store into the languages it lists, so if
Catalan or Basque are not offered, those blocks stay as a reference and those
users see the English listing.

Store requirements: <https://developers.meta.com/horizon/resources/publish-quest-req>
(column "Meta Horizon Store (2D)").

## 0. Pending before submitting

- [ ] **5 screenshots taken on the headset** (section 3).
- [ ] **Privacy policy** (VRC.Quest.Privacy.2–4): the page must say how to
      request data deletion (for example: "no data is collected, so there is
      nothing to delete; local settings are deleted when the app is uninstalled;
      for any request write to <contact>"). It also still lists `RECORD_AUDIO`
      and `VIBRATE`, which the native app no longer requests, and describes the
      camera as a QR scanner, while it is used by the companion web page.
- [ ] Test the `quest` build on a Quest 3/3S from the ALPHA channel: panel size,
      discovery, playback, XR subtitles and WebXR experiences.

## 1. Build

```sh
cd native/android
# MEDIASYNC_KEYSTORE* set: same upload key as Google Play
./gradlew :app:assembleQuest
# → app/build/outputs/apk/quest/app-quest.apk
```

On `v*` tags, `build-android.yml` also builds it and attaches
`universal-mediasync-<tag>-quest.apk` to the GitHub release.

Checked automatically when uploading (VRC.Quest.Packaging.*):

| Requirement | How the `quest` build meets it |
|---|---|
| Manifest for release builds | `app/src/quest/AndroidManifest.xml`: `installLocation="auto"`, `android.hardware.vr.headtracking` `required="false"`, `com.oculus.supportedDevices` = `quest2\|questpro\|quest3\|quest3s\|vrglasses`, `excludeFromRecents="true"`, default panel 1024×640 dp, no `com.oculus.intent.category.VR` |
| SDK levels | `minSdk` 29, `targetSdk` 34 (Play build keeps 24/36) |
| APK Signature Scheme v2 | AGP signs v1+v2 with the release key |
| 64-bit | `abiFilters` = `arm64-v8a` (the only native library is `androidx.graphics.path`) |
| Size < 1 GB | ~ a few MB |
| No unsupported Android features | no Google Play services; camera and Wi-Fi declared `required="false"` |

`versionCode` comes from the brand version (`1.7.0` → `10700`) and must grow
with every upload, as on Google Play.

## 2. Upload

Developer Dashboard → *Distribution* → *Release channels* → **ALPHA** →
*Upload build*, or with the Meta platform CLI:

```sh
ovr-platform-util upload-quest-build --app_id <APP_ID> --app_secret <APP_SECRET> \
  --apk native/android/app/build/outputs/apk/quest/app-quest.apk --channel ALPHA \
  --notes "Universal MediaSync 1.7.0"
```

Test from ALPHA on a headset, then promote the build to the **LIVE**
(store) channel and submit the app for review (about 1–2 weeks).

## 3. Store art

```sh
node store/meta-quest/build.cjs        # → store/meta-quest/out/
```

| Dashboard field | File | Size |
|---|---|---|
| Hero cover | `hero.png` | 3000×900, 24-bit |
| Cover landscape | `landscape.png` | 2560×1440, 24-bit |
| Cover square | `square.png` | 1440×1440, 24-bit |
| Cover portrait | `portrait.png` | 1008×1440, 24-bit |
| Mini landscape | `mini.png` | 1080×360, 24-bit |
| Icon | `icon.png` | 512×512, 24-bit |
| Logo (transparent) | `logo.png` | ≤ 9000×1440, 32-bit |
| Screenshots (exactly 5) | `screenshots/1..5.png` | 2560×1440, 24-bit |

Covers only carry the exact app name and the emblem, centred, with nothing in
the top or bottom 20% (VRC.Quest.Asset.2–4). The art is language-neutral, so
no localized versions are needed.

**Screenshots must be real captures from the headset** with no text, logos or
badges added (VRC.Quest.Asset.5). Suggested set, with the app connected to a
TV (or the `tools/tv-emulator`) and the panel visible in passthrough:

1. TV list (discovery screen)
2. Track selection with audio, video and subtitles checked
3. Playback with the docked player, sign-language video
4. XR subtitles in passthrough (*View in XR*)
5. An interactive experience open in the Meta Quest browser

```sh
sh store/meta-quest/capture.sh          # pulls the 5 newest headset screenshots
node store/meta-quest/build.cjs --only screenshots
```

Trailer: optional (MP4 H.264/AAC, 1080p–2K, 30 s–2 min, only Meta Quest
hardware on screen).

## 4. App metadata (shared across languages)

- **Publisher name**: Corporació Catalana de Mitjans Audiovisuals
- **Website**: <https://ccma-enginyeria.github.io/Universal-HbbTV-MediaSync-App/>
- **Privacy policy**: <https://ccma-enginyeria.github.io/Universal-HbbTV-MediaSync-App/privacy.html>
- **External support link**: <https://github.com/CCMA-Enginyeria/Universal-HbbTV-MediaSync-App/issues>
- **Terms of service**: none
- **Price**: free · **In-app purchases**: none · **Subscription**: no · **Ads**: none
- **Category**: Apps · **Genres**: Media (primary, type *Film & TV*), Utilities
- **Supported controllers / input**: Touch controllers and hand tracking
  (system pointer on a 2D panel)
- **Play area**: Seated, Standing · **Player modes**: Single user
- **Comfort level**: Comfortable
- **Internet connection**: Required (Wi-Fi on the same network as the TV;
  the extra audio and video stream from the broadcaster)
- **Social features**: none
- **Supported languages in app**: Catalan, Spanish, Basque, English, German,
  Italian, French
- **Search keywords**: HbbTV, second screen, accessibility, subtitles, audio
  description, sign language, private listening, TV, DVB, mediasync
- **Age rating (IARC questionnaire)**: no violence, sexual content, language,
  drugs, gambling or purchases; no user interaction or user-generated content;
  no location sharing; no unrestricted web browsing (only pages announced by the
  TV channel open). The app plays the broadcaster's own programmes. Expected
  result: the lowest rating in every region (as on Google Play and the App Store).
- **Data use / Data Use Checkup**: the app uses no Meta Platform SDK features
  and collects no user data (no accounts, analytics or advertising).

### Notes for the reviewer

```text
Universal MediaSync is a companion app for HbbTV televisions. It runs on Meta Quest as a 2D panel app. It finds HbbTV TVs on the local Wi-Fi network (SSDP/DIAL multicast) and plays extra audio, video and subtitle tracks offered by the TV channel, in sync with the TV using the DVB-CSS standard (ETSI TS 103 286-2). Subtitles can also be shown in mixed reality ("View in XR"), and interactive experiences open with WebXR in the Meta Quest browser.

A compatible HbbTV TV tuned to a channel with MediaSync enabled is required to see the synchronized playback. Without one, the app shows the empty TV list and the Help centre with compatible TVs and channels.

To test without a TV, run our open-source TV emulator on a computer on the same Wi-Fi network as the headset: https://github.com/CCMA-Enginyeria/Universal-HbbTV-MediaSync-App/tree/main/tools/tv-emulator (cd tools/tv-emulator && npm ci && EMU_IP=<computer LAN IP> node index.js). It then appears in the app's TV list.

No account or login is needed. The app collects no personal data.
```

### Build notes (ALPHA / LIVE)

```text
First Meta Quest release: HbbTV discovery, synchronized audio, video and subtitles, subtitles in mixed reality and WebXR interactive experiences.
```

## 5. Listing texts

<en-US>
Name: Universal MediaSync
Short description:
Turn your Meta Quest into a second screen in sync with your HbbTV TV: hear the TV in your headset, follow audio description, sign language or subtitles, also in mixed reality, and open the programme's interactive experiences, all in sync with what is playing on the big screen.
Long description:
Universal MediaSync connects your Meta Quest to the HbbTV TV on your Wi-Fi network and plays the extra content the programme offers, perfectly in sync with the big screen.

KEY FEATURES
• Automatic discovery of compatible TVs on your Wi-Fi network
• Private listening: the TV sound in your headset
• Accessibility: audio description, sign language video and subtitles
• Subtitles in mixed reality: they follow your view or stay where you place them in the room
• Alternative audio: original version and other languages
• Interactive experiences that open with WebXR in the Meta Quest browser
• Two sync modes: High precision, with the TV's native DVB-CSS service, and Compatibility, through the broadcaster's HbbTV app
• Available in Catalan, Spanish, Basque, English, German, Italian and French

HOW IT WORKS
1. Connect your Meta Quest to the same Wi-Fi network as your TV.
2. Tune in to a channel that offers HbbTV MediaSync.
3. Open the app and pick your TV.
4. Choose the audio, video, subtitles or experience you want.

Universal MediaSync is an open-source initiative maintained by the HbbTV community.

Requires a compatible HbbTV TV and a channel with MediaSync enabled, both on the same Wi-Fi network.
</en-US>

<ca>
Name: Universal MediaSync
Short description:
Converteix les Meta Quest en una segona pantalla sincronitzada amb el teu televisor HbbTV: escolta el so de la tele a les ulleres, segueix l'audiodescripció, la llengua de signes o els subtítols, també en realitat mixta, i obre les experiències interactives del programa, tot sincronitzat amb el que es veu a la pantalla gran.
Long description:
Universal MediaSync connecta les teves Meta Quest amb el televisor HbbTV de la teva xarxa wifi i reprodueix el contingut addicional que ofereix el programa, perfectament sincronitzat amb la pantalla gran.

CARACTERÍSTIQUES PRINCIPALS
• Detecció automàtica dels televisors compatibles de la teva xarxa wifi
• Escolta privada: el so del televisor a les teves ulleres
• Accessibilitat: audiodescripció, vídeo en llengua de signes i subtítols
• Subtítols en realitat mixta: segueixen la mirada o es queden on els col·loquis de l'habitació
• Àudio alternatiu: versió original i altres idiomes
• Experiències interactives que s'obren amb WebXR al navegador de Meta Quest
• Dos modes de sincronització: Alta precisió, amb el servei DVB-CSS natiu del televisor, i Compatibilitat, a través de l'aplicació HbbTV de l'emissora
• Disponible en català, castellà, basc, anglès, alemany, italià i francès

COM FUNCIONA
1. Connecta les Meta Quest a la mateixa xarxa wifi que el televisor.
2. Sintonitza un canal que ofereixi HbbTV MediaSync.
3. Obre l'app i tria el teu televisor.
4. Escull l'àudio, el vídeo, els subtítols o l'experiència que vulguis.

Universal MediaSync és una iniciativa de codi obert mantinguda per la comunitat HbbTV.

Requereix un televisor compatible amb HbbTV i un canal amb MediaSync activat, tots dos a la mateixa xarxa wifi.
</ca>

<es-ES>
Name: Universal MediaSync
Short description:
Convierte tus Meta Quest en una segunda pantalla sincronizada con tu televisor HbbTV: escucha el sonido de la tele en las gafas, sigue la audiodescripción, la lengua de signos o los subtítulos, también en realidad mixta, y abre las experiencias interactivas del programa, todo sincronizado con lo que se ve en la pantalla grande.
Long description:
Universal MediaSync conecta tus Meta Quest con el televisor HbbTV de tu red wifi y reproduce el contenido adicional que ofrece el programa, perfectamente sincronizado con la pantalla grande.

CARACTERÍSTICAS PRINCIPALES
• Detección automática de los televisores compatibles de tu red wifi
• Escucha privada: el sonido del televisor en tus gafas
• Accesibilidad: audiodescripción, vídeo en lengua de signos y subtítulos
• Subtítulos en realidad mixta: siguen tu mirada o se quedan donde los coloques en la habitación
• Audio alternativo: versión original y otros idiomas
• Experiencias interactivas que se abren con WebXR en el navegador de Meta Quest
• Dos modos de sincronización: Alta precisión, con el servicio DVB-CSS nativo del televisor, y Compatibilidad, a través de la aplicación HbbTV de la cadena
• Disponible en catalán, castellano, euskera, inglés, alemán, italiano y francés

CÓMO FUNCIONA
1. Conecta tus Meta Quest a la misma red wifi que el televisor.
2. Sintoniza un canal que ofrezca HbbTV MediaSync.
3. Abre la app y elige tu televisor.
4. Escoge el audio, el vídeo, los subtítulos o la experiencia que quieras.

Universal MediaSync es una iniciativa de código abierto mantenida por la comunidad HbbTV.

Requiere un televisor compatible con HbbTV y un canal con MediaSync activado, ambos en la misma red wifi.
</es-ES>

<eu-ES>
Name: Universal MediaSync
Short description:
Bihurtu zure Meta Quest HbbTV telebistarekin sinkronizatutako bigarren pantaila: entzun telebistaren soinua betaurrekoetan, jarraitu audiodeskribapena, zeinu-hizkuntza edo azpitituluak, baita errealitate mistoan ere, eta ireki programaren esperientzia interaktiboak, dena pantaila handian ikusten denarekin sinkronizatuta.
Long description:
Universal MediaSync-ek zure Meta Quest zure wifi sareko HbbTV telebistarekin konektatzen ditu eta programak eskaintzen duen eduki gehigarria erreproduzitzen du, pantaila handiarekin erabat sinkronizatuta.

EZAUGARRI NAGUSIAK
• Zure wifi sareko telebista bateragarrien detekzio automatikoa
• Entzute pribatua: telebistaren soinua zure betaurrekoetan
• Irisgarritasuna: audiodeskribapena, zeinu-hizkuntzako bideoa eta azpitituluak
• Azpitituluak errealitate mistoan: zure begiradari jarraitzen diote edo gelan jartzen dituzun lekuan geratzen dira
• Audio alternatiboa: jatorrizko bertsioa eta beste hizkuntza batzuk
• Meta Questen nabigatzailean WebXRrekin irekitzen diren esperientzia interaktiboak
• Bi sinkronizazio modu: Zehaztasun handia, telebistaren jatorrizko DVB-CSS zerbitzuarekin, eta Bateragarritasuna, kateko HbbTV aplikazioaren bidez
• Eskuragarri katalanez, gaztelaniaz, euskaraz, ingelesez, alemanez, italieraz eta frantsesez

NOLA FUNTZIONATZEN DUEN
1. Konektatu zure Meta Quest telebistaren wifi sare berera.
2. Sintonizatu HbbTV MediaSync eskaintzen duen kate bat.
3. Ireki aplikazioa eta hautatu zure telebista.
4. Aukeratu nahi duzun audioa, bideoa, azpitituluak edo esperientzia.

Universal MediaSync HbbTV komunitateak mantentzen duen kode irekiko ekimena da.

HbbTV-rekin bateragarria den telebista bat eta MediaSync gaituta duen kate bat behar dira, biak wifi sare berean.
</eu-ES>

<de-DE>
Name: Universal MediaSync
Short description:
Mach deine Meta Quest zum zweiten Bildschirm, synchron mit deinem HbbTV-Fernseher: Hör den TV-Ton im Headset, folge Audiodeskription, Gebärdensprache oder Untertiteln, auch in Mixed Reality, und öffne die interaktiven Erlebnisse der Sendung, alles synchron zu dem, was auf dem großen Bildschirm läuft.
Long description:
Universal MediaSync verbindet deine Meta Quest mit dem HbbTV-Fernseher in deinem WLAN und spielt die Zusatzinhalte der Sendung ab, perfekt synchron mit dem großen Bildschirm.

HAUPTFUNKTIONEN
• Automatische Erkennung kompatibler Fernseher in deinem WLAN
• Privat hören: der TV-Ton in deinem Headset
• Barrierefreiheit: Audiodeskription, Gebärdensprachvideo und Untertitel
• Untertitel in Mixed Reality: Sie folgen deinem Blick oder bleiben, wo du sie im Raum platzierst
• Alternativer Ton: Originalfassung und weitere Sprachen
• Interaktive Erlebnisse, die sich mit WebXR im Meta-Quest-Browser öffnen
• Zwei Synchronisationsmodi: Hohe Präzision mit dem nativen DVB-CSS-Dienst des Fernsehers und Kompatibilität über die HbbTV-App des Senders
• Verfügbar auf Katalanisch, Spanisch, Baskisch, Englisch, Deutsch, Italienisch und Französisch

SO FUNKTIONIERT ES
1. Verbinde deine Meta Quest mit demselben WLAN wie deinen Fernseher.
2. Wähle einen Sender, der HbbTV MediaSync anbietet.
3. Öffne die App und wähle deinen Fernseher.
4. Wähle Ton, Video, Untertitel oder das gewünschte Erlebnis.

Universal MediaSync ist eine Open-Source-Initiative der HbbTV-Community.

Erfordert einen kompatiblen HbbTV-Fernseher und einen Sender mit aktiviertem MediaSync, beide im selben WLAN.
</de-DE>

<it-IT>
Name: Universal MediaSync
Short description:
Trasforma il tuo Meta Quest in un secondo schermo sincronizzato con la tua TV HbbTV: ascolta l'audio della TV nel visore, segui l'audiodescrizione, la lingua dei segni o i sottotitoli, anche in realtà mista, e apri le esperienze interattive del programma, tutto in sincronia con ciò che va in onda sul grande schermo.
Long description:
Universal MediaSync collega il tuo Meta Quest alla TV HbbTV della tua rete Wi-Fi e riproduce i contenuti aggiuntivi offerti dal programma, perfettamente sincronizzati con il grande schermo.

CARATTERISTICHE PRINCIPALI
• Rilevamento automatico delle TV compatibili della tua rete Wi-Fi
• Ascolto privato: l'audio della TV nel tuo visore
• Accessibilità: audiodescrizione, video nella lingua dei segni e sottotitoli
• Sottotitoli in realtà mista: seguono il tuo sguardo o restano dove li posizioni nella stanza
• Audio alternativo: versione originale e altre lingue
• Esperienze interattive che si aprono con WebXR nel browser di Meta Quest
• Due modalità di sincronizzazione: Alta precisione, con il servizio DVB-CSS nativo della TV, e Compatibilità, tramite l'app HbbTV dell'emittente
• Disponibile in catalano, spagnolo, basco, inglese, tedesco, italiano e francese

COME FUNZIONA
1. Collega il Meta Quest alla stessa rete Wi-Fi della TV.
2. Sintonizzati su un canale che offre HbbTV MediaSync.
3. Apri l'app e scegli la tua TV.
4. Scegli l'audio, il video, i sottotitoli o l'esperienza che preferisci.

Universal MediaSync è un'iniziativa open source mantenuta dalla comunità HbbTV.

Richiede una TV compatibile HbbTV e un canale con MediaSync attivo, entrambi sulla stessa rete Wi-Fi.
</it-IT>

<fr-FR>
Name: Universal MediaSync
Short description:
Faites de votre Meta Quest un second écran synchronisé avec votre téléviseur HbbTV : écoutez le son de la télé dans le casque, suivez l'audiodescription, la langue des signes ou les sous-titres, aussi en réalité mixte, et ouvrez les expériences interactives du programme, le tout synchronisé avec ce qui passe sur le grand écran.
Long description:
Universal MediaSync relie votre Meta Quest au téléviseur HbbTV de votre réseau Wi-Fi et lit les contenus supplémentaires proposés par le programme, parfaitement synchronisés avec le grand écran.

FONCTIONNALITÉS PRINCIPALES
• Détection automatique des téléviseurs compatibles de votre réseau Wi-Fi
• Écoute privée : le son du téléviseur dans votre casque
• Accessibilité : audiodescription, vidéo en langue des signes et sous-titres
• Sous-titres en réalité mixte : ils suivent votre regard ou restent là où vous les placez dans la pièce
• Audio alternatif : version originale et autres langues
• Expériences interactives qui s'ouvrent avec WebXR dans le navigateur Meta Quest
• Deux modes de synchronisation : Haute précision, avec le service DVB-CSS natif du téléviseur, et Compatibilité, via l'application HbbTV de la chaîne
• Disponible en catalan, espagnol, basque, anglais, allemand, italien et français

COMMENT ÇA MARCHE
1. Connectez votre Meta Quest au même réseau Wi-Fi que le téléviseur.
2. Choisissez une chaîne qui propose HbbTV MediaSync.
3. Ouvrez l'app et sélectionnez votre téléviseur.
4. Choisissez l'audio, la vidéo, les sous-titres ou l'expérience de votre choix.

Universal MediaSync est une initiative open source maintenue par la communauté HbbTV.

Nécessite un téléviseur compatible HbbTV et une chaîne avec MediaSync activé, tous deux sur le même réseau Wi-Fi.
</fr-FR>
