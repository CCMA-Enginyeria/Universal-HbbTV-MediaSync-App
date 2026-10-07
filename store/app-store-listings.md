# Apple App Store — Listing texts

Version **1.6.0**, the first App Store release of the native iOS app. One block
per App Store Connect localization. Character limits: Name ≤ 30,
Subtitle ≤ 30, Promotional text ≤ 170, Keywords ≤ 100 (comma-separated, no
spaces after commas), Description ≤ 4000.

App Store Connect has no Basque localization, so Basque users see the primary
language. Use the same English block for English (U.K.) and English (U.S.).
Keywords name the local digital terrestrial TV term in each language (TDT,
TNT, DVB-T, DTT).

"What's New" cannot be edited on the first version of an app; it is only
needed from the next update onwards (see `release-notes-<version>.md`).

## App information (shared across languages)

- **Privacy Policy URL**:
  <https://ccma-enginyeria.github.io/Universal-HbbTV-MediaSync-App/privacy.html>
- **Support URL**:
  <https://github.com/CCMA-Enginyeria/Universal-HbbTV-MediaSync-App/issues>
- **Marketing URL** (optional):
  <https://ccma-enginyeria.github.io/Universal-HbbTV-MediaSync-App/>
- **Primary category**: Entertainment · **Secondary**: Utilities
- **Copyright**: 2026 Corporació Catalana de Mitjans Audiovisuals
- **Age rating**: 4+ (no objectionable content; the app plays the broadcaster's content)

## App Review information → Notes

```text
Universal MediaSync is a companion app for HbbTV televisions. It finds HbbTV TVs on the local Wi-Fi network (SSDP/DIAL multicast, hence the Local Network permission and the multicast entitlement) and plays extra audio, video and subtitle tracks offered by the TV channel, in sync with the TV using the DVB-CSS standard (ETSI TS 103 286-2).

A compatible HbbTV TV tuned to a channel with MediaSync enabled is required to see the synchronized playback. Without one, the app shows the empty TV list and the Help centre with compatible TVs and channels.

To test without a TV, run our open-source TV emulator on a computer on the same Wi-Fi network as the device: https://github.com/CCMA-Enginyeria/Universal-HbbTV-MediaSync-App/tree/main/tools/tv-emulator (cd tools/tv-emulator && npm ci && EMU_IP=<computer LAN IP> node index.js). It then appears in the app's TV list.

No account or login is needed. The app collects no personal data.
```

<en-GB>
Name: Universal MediaSync
Subtitle: Synchronized HbbTV experiences
Promotional text: Hear the TV in your headphones, follow audio description, sign language or subtitles, and open the programme's interactive experiences, all in sync with your TV.
Keywords: second screen,accessibility,TV,DTT,HbbTV,mediasync
Description:
Universal MediaSync turns your iPhone or iPad into a second screen perfectly synchronized with your television.

Find the HbbTV TVs on your Wi-Fi network and enjoy the extra content the programme offers — the TV sound in your headphones, audio description, sign language, subtitles, the original version, other audio tracks or interactive experiences — all in sync with what is playing on the big screen.

KEY FEATURES
• Automatic discovery of compatible TVs on your Wi-Fi network
• Private listening: the TV sound straight to your headphones
• Accessibility: audio description, sign language video and subtitles
• Alternative audio: original version and other languages
• Second-screen video, also in full screen
• Interactive experiences: open the web experiences that come with the programme, and choose your language when several are offered
• Two synchronization modes: High precision, with the TV's native DVB-CSS service, and Compatibility, through the broadcaster's HbbTV app, to work with more TVs
• Playback follows the TV, pauses included, and keeps playing with the app in the background
• Help centre with compatible TVs and channels
• Available in Catalan, Spanish, Basque, English, German, Italian and French

HOW IT WORKS
1. Connect your iPhone or iPad to the same Wi-Fi network as your TV.
2. Tune in to a channel that offers HbbTV MediaSync or private listening.
3. Open the app, allow access to the local network and pick your TV from the list of detected devices.
4. Choose the audio, video or experience you want and enjoy it in sync.

Universal MediaSync is an open-source initiative maintained by the HbbTV community: a single companion app for every broadcaster that wants to offer second-screen experiences, with no need to build a dedicated app.

Note: requires a compatible HbbTV television and a channel with MediaSync enabled, both connected to the same Wi-Fi network.
</en-GB>

<ca>
Name: Universal MediaSync
Subtitle: Experiències HbbTV síncrones
Promotional text: Escolta la tele amb auriculars, segueix l'audiodescripció, la llengua de signes o els subtítols i obre les experiències interactives del programa, tot sincronitzat.
Keywords: segona pantalla,accessibilitat,TV,TDT,HbbTV,mediasync
Description:
Universal MediaSync converteix el teu iPhone o iPad en una segona pantalla perfectament sincronitzada amb el televisor.

Troba els televisors HbbTV de la teva xarxa wifi i gaudeix del contingut addicional que ofereix el programa —el so de la tele als auriculars, audiodescripció, llengua de signes, subtítols, versió original, altres pistes d'àudio o experiències interactives—, tot sincronitzat amb el que es veu a la pantalla gran.

CARACTERÍSTIQUES PRINCIPALS
• Detecció automàtica dels televisors compatibles de la teva xarxa wifi
• Escolta privada: el so del televisor directament als teus auriculars
• Accessibilitat: audiodescripció, vídeo en llengua de signes i subtítols
• Àudio alternatiu: versió original i altres idiomes
• Vídeo a la segona pantalla, també a pantalla completa
• Experiències interactives: obre les experiències web que acompanyen el programa i tria el teu idioma quan se n'ofereixen diversos
• Dos modes de sincronització: Alta precisió, amb el servei DVB-CSS natiu del televisor, i Compatibilitat, a través de l'aplicació HbbTV de l'emissora, per funcionar amb més televisors
• La reproducció segueix el televisor, pauses incloses, i continua amb l'app en segon pla
• Centre d'ajuda amb els televisors i canals compatibles
• Disponible en català, castellà, basc, anglès, alemany, italià i francès

COM FUNCIONA
1. Connecta l'iPhone o l'iPad a la mateixa xarxa wifi que el televisor.
2. Sintonitza un canal que ofereixi HbbTV MediaSync o escolta privada.
3. Obre l'app, permet l'accés a la xarxa local i tria el teu televisor de la llista de dispositius detectats.
4. Escull l'àudio, el vídeo o l'experiència que vulguis i gaudeix-ne sincronitzat.

Universal MediaSync és una iniciativa de codi obert mantinguda per la comunitat HbbTV: una única aplicació complementària per a totes les emissores que vulguin oferir experiències de segona pantalla, sense haver de desenvolupar-ne una de pròpia.

Nota: requereix un televisor compatible amb HbbTV i un canal amb MediaSync activat, tots dos connectats a la mateixa xarxa wifi.
</ca>

<es-ES>
Name: Universal MediaSync
Subtitle: Experiencias HbbTV sincrónicas
Promotional text: Escucha la tele con auriculares, sigue la audiodescripción, la lengua de signos o los subtítulos y abre las experiencias interactivas del programa, todo sincronizado.
Keywords: segunda pantalla,accesibilidad,TV,TDT,HbbTV,mediasync
Description:
Universal MediaSync convierte tu iPhone o iPad en una segunda pantalla perfectamente sincronizada con el televisor.

Encuentra los televisores HbbTV de tu red wifi y disfruta del contenido adicional que ofrece el programa —el sonido de la tele en tus auriculares, audiodescripción, lengua de signos, subtítulos, versión original, otras pistas de audio o experiencias interactivas—, todo sincronizado con lo que se ve en la pantalla grande.

CARACTERÍSTICAS PRINCIPALES
• Detección automática de los televisores compatibles de tu red wifi
• Escucha privada: el sonido del televisor directamente en tus auriculares
• Accesibilidad: audiodescripción, vídeo en lengua de signos y subtítulos
• Audio alternativo: versión original y otros idiomas
• Vídeo en la segunda pantalla, también a pantalla completa
• Experiencias interactivas: abre las experiencias web que acompañan al programa y elige tu idioma cuando se ofrecen varios
• Dos modos de sincronización: Alta precisión, con el servicio DVB-CSS nativo del televisor, y Compatibilidad, a través de la aplicación HbbTV de la cadena, para funcionar con más televisores
• La reproducción sigue al televisor, pausas incluidas, y continúa con la app en segundo plano
• Centro de ayuda con los televisores y canales compatibles
• Disponible en catalán, español, euskera, inglés, alemán, italiano y francés

CÓMO FUNCIONA
1. Conecta el iPhone o el iPad a la misma red wifi que el televisor.
2. Sintoniza un canal que ofrezca HbbTV MediaSync o escucha privada.
3. Abre la app, permite el acceso a la red local y elige tu televisor en la lista de dispositivos detectados.
4. Elige el audio, el vídeo o la experiencia que quieras y disfrútalo sincronizado.

Universal MediaSync es una iniciativa de código abierto mantenida por la comunidad HbbTV: una única aplicación complementaria para todas las cadenas que quieran ofrecer experiencias de segunda pantalla, sin necesidad de desarrollar una propia.

Nota: requiere un televisor compatible con HbbTV y un canal con MediaSync activado, ambos conectados a la misma red wifi.
</es-ES>

<de-DE>
Name: Universal MediaSync
Subtitle: Synchrone HbbTV-Erlebnisse
Promotional text: Höre den TV-Ton im Kopfhörer, folge Audiodeskription, Gebärdensprache oder Untertiteln und öffne die interaktiven Erlebnisse der Sendung – alles synchron zum TV.
Keywords: Second Screen,Barrierefreiheit,TV,DVB-T,HbbTV,mediasync
Description:
Universal MediaSync verwandelt dein iPhone oder iPad in einen zweiten Bildschirm, der perfekt mit deinem Fernseher synchronisiert ist.

Finde die HbbTV-Fernseher in deinem WLAN und genieße die Zusatzinhalte der Sendung – den TV-Ton im Kopfhörer, Audiodeskription, Gebärdensprache, Untertitel, die Originalfassung, weitere Tonspuren oder interaktive Erlebnisse –, alles synchron zu dem, was auf dem großen Bildschirm läuft.

HAUPTFUNKTIONEN
• Automatische Erkennung kompatibler Fernseher in deinem WLAN
• Privat hören: der TV-Ton direkt auf deinen Kopfhörer
• Barrierefreiheit: Audiodeskription, Gebärdensprachvideo und Untertitel
• Alternativer Ton: Originalfassung und weitere Sprachen
• Video auf dem zweiten Bildschirm, auch im Vollbild
• Interaktive Erlebnisse: Öffne die Web-Erlebnisse zur Sendung und wähle deine Sprache, wenn mehrere angeboten werden
• Zwei Synchronisationsmodi: Hohe Präzision mit dem nativen DVB-CSS-Dienst des Fernsehers und Kompatibilität über die HbbTV-App des Senders, damit mehr Fernseher unterstützt werden
• Die Wiedergabe folgt dem Fernseher, auch beim Pausieren, und läuft im Hintergrund weiter
• Hilfebereich mit kompatiblen Fernsehern und Sendern
• Verfügbar auf Katalanisch, Spanisch, Baskisch, Englisch, Deutsch, Italienisch und Französisch

SO FUNKTIONIERT ES
1. Verbinde dein iPhone oder iPad mit demselben WLAN wie deinen Fernseher.
2. Wähle einen Sender, der HbbTV MediaSync oder privates Hören anbietet.
3. Öffne die App, erlaube den Zugriff auf das lokale Netzwerk und wähle deinen Fernseher aus der Liste der erkannten Geräte.
4. Wähle den gewünschten Ton, das Video oder das Erlebnis und genieße es synchron.

Universal MediaSync ist eine Open-Source-Initiative der HbbTV-Community: eine einzige Begleit-App für alle Sender, die Second-Screen-Erlebnisse anbieten möchten, ohne eine eigene App entwickeln zu müssen.

Hinweis: erfordert einen kompatiblen HbbTV-Fernseher und einen Sender mit aktiviertem MediaSync, beide im selben WLAN.
</de-DE>

<it-IT>
Name: Universal MediaSync
Subtitle: Esperienze HbbTV sincronizzate
Promotional text: Ascolta la TV in cuffia, segui audiodescrizione, lingua dei segni o sottotitoli e apri le esperienze interattive del programma, tutto sincronizzato con la TV.
Keywords: secondo schermo,accessibilità,TV,DTT,HbbTV,mediasync
Description:
Universal MediaSync trasforma il tuo iPhone o iPad in un secondo schermo perfettamente sincronizzato con il televisore.

Trova i televisori HbbTV della tua rete Wi-Fi e goditi i contenuti aggiuntivi offerti dal programma —l'audio della TV nelle tue cuffie, audiodescrizione, lingua dei segni, sottotitoli, versione originale, altre tracce audio o esperienze interattive—, tutto sincronizzato con ciò che va in onda sullo schermo grande.

CARATTERISTICHE PRINCIPALI
• Rilevamento automatico dei televisori compatibili della tua rete Wi-Fi
• Ascolto privato: l'audio del televisore direttamente nelle tue cuffie
• Accessibilità: audiodescrizione, video in lingua dei segni e sottotitoli
• Audio alternativo: versione originale e altre lingue
• Video sul secondo schermo, anche a schermo intero
• Esperienze interattive: apri le esperienze web che accompagnano il programma e scegli la tua lingua quando ne vengono offerte diverse
• Due modalità di sincronizzazione: Alta precisione, con il servizio DVB-CSS nativo del televisore, e Compatibilità, tramite l'app HbbTV dell'emittente, per funzionare con più televisori
• La riproduzione segue il televisore, pause comprese, e continua con l'app in background
• Centro assistenza con i televisori e i canali compatibili
• Disponibile in catalano, spagnolo, basco, inglese, tedesco, italiano e francese

COME FUNZIONA
1. Collega l'iPhone o l'iPad alla stessa rete Wi-Fi del televisore.
2. Sintonizzati su un canale che offre HbbTV MediaSync o l'ascolto privato.
3. Apri l'app, consenti l'accesso alla rete locale e scegli il tuo televisore dall'elenco dei dispositivi rilevati.
4. Scegli l'audio, il video o l'esperienza che preferisci e goditela sincronizzata.

Universal MediaSync è un'iniziativa open source gestita dalla comunità HbbTV: un'unica app companion per tutte le emittenti che vogliono offrire esperienze di secondo schermo, senza dover sviluppare un'app dedicata.

Nota: richiede un televisore compatibile con HbbTV e un canale con MediaSync attivato, entrambi collegati alla stessa rete Wi-Fi.
</it-IT>

<fr-FR>
Name: Universal MediaSync
Subtitle: Expériences HbbTV synchrones
Promotional text: Écoutez la télé au casque, suivez l'audiodescription, la langue des signes ou les sous-titres et ouvrez les expériences interactives du programme, en synchro.
Keywords: second écran,accessibilité,TV,TNT,HbbTV,mediasync
Description:
Universal MediaSync transforme votre iPhone ou iPad en un second écran parfaitement synchronisé avec votre téléviseur.

Trouvez les téléviseurs HbbTV de votre réseau Wi-Fi et profitez des contenus supplémentaires proposés par le programme — le son de la télé dans vos écouteurs, l'audiodescription, la langue des signes, les sous-titres, la version originale, d'autres pistes audio ou des expériences interactives —, le tout synchronisé avec ce qui passe sur le grand écran.

FONCTIONNALITÉS PRINCIPALES
• Détection automatique des téléviseurs compatibles de votre réseau Wi-Fi
• Écoute privée : le son du téléviseur directement dans vos écouteurs
• Accessibilité : audiodescription, vidéo en langue des signes et sous-titres
• Audio alternatif : version originale et autres langues
• La vidéo sur le second écran, aussi en plein écran
• Expériences interactives : ouvrez les expériences web qui accompagnent le programme et choisissez votre langue lorsque plusieurs sont proposées
• Deux modes de synchronisation : Haute précision, avec le service DVB-CSS natif du téléviseur, et Compatibilité, via l'application HbbTV de la chaîne, pour fonctionner avec plus de téléviseurs
• La lecture suit le téléviseur, pauses comprises, et continue lorsque l'application est en arrière-plan
• Centre d'aide avec les téléviseurs et les chaînes compatibles
• Disponible en catalan, espagnol, basque, anglais, allemand, italien et français

COMMENT ÇA MARCHE
1. Connectez votre iPhone ou iPad au même réseau Wi-Fi que votre téléviseur.
2. Réglez une chaîne qui propose HbbTV MediaSync ou l'écoute privée.
3. Ouvrez l'application, autorisez l'accès au réseau local et sélectionnez votre téléviseur dans la liste des appareils détectés.
4. Choisissez l'audio, la vidéo ou l'expérience souhaitée et profitez-en en parfaite synchronisation.

Universal MediaSync est une initiative open source maintenue par la communauté HbbTV : une seule application compagnon pour tous les diffuseurs qui souhaitent proposer des expériences de second écran, sans avoir à développer leur propre application.

Remarque : nécessite un téléviseur compatible HbbTV et une chaîne avec MediaSync activé, tous deux connectés au même réseau Wi-Fi.
</fr-FR>
