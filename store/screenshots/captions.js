/**
 * Store screenshot captions, one entry per panel (in panel order) and per app
 * language. Loaded as a plain script by `stage.html` (file:// cannot fetch JSON).
 */
window.STORE_CAPTIONS = {
  en: [
    { title: 'Find your TV', subtitle: 'HbbTV TVs on your Wi-Fi are discovered automatically' },
    { title: 'Choose what to hear', subtitle: 'Audio description, original version and other languages' },
    { title: 'Private listening, in sync', subtitle: 'The TV sound in your headphones, even in the background' },
    { title: 'Second-screen video', subtitle: 'Sign language and extra video, frame-accurate with DVB-CSS' },
  ],
  ca: [
    { title: 'Troba el teu televisor', subtitle: 'Detecta automàticament els televisors HbbTV de la teva wifi' },
    { title: 'Tria què vols escoltar', subtitle: 'Audiodescripció, versió original i altres idiomes' },
    { title: 'Escolta privada, sincronitzada', subtitle: 'El so de la tele als teus auriculars, fins i tot en segon pla' },
    { title: 'Vídeo a la segona pantalla', subtitle: 'Llengua de signes i vídeo addicional, al fotograma amb DVB-CSS' },
  ],
  es: [
    { title: 'Encuentra tu televisor', subtitle: 'Detecta automáticamente los televisores HbbTV de tu wifi' },
    { title: 'Elige qué escuchar', subtitle: 'Audiodescripción, versión original y otros idiomas' },
    { title: 'Escucha privada, sincronizada', subtitle: 'El sonido de la tele en tus auriculares, incluso en segundo plano' },
    { title: 'Vídeo en la segunda pantalla', subtitle: 'Lengua de signos y vídeo adicional, al fotograma con DVB-CSS' },
  ],
  eu: [
    { title: 'Aurkitu zure telebista', subtitle: 'Zure wifiko HbbTV telebistak automatikoki detektatzen ditu' },
    { title: 'Aukeratu zer entzun', subtitle: 'Audiodeskribapena, jatorrizko bertsioa eta beste hizkuntza batzuk' },
    { title: 'Entzute pribatua, sinkronizatuta', subtitle: 'Telebistaren soinua zure entzungailuetan, bigarren planoan ere' },
    { title: 'Bideoa bigarren pantailan', subtitle: 'Zeinu-hizkuntza eta bideo gehigarria, DVB-CSSrekin zehatz-mehatz' },
  ],
  de: [
    { title: 'Finde deinen Fernseher', subtitle: 'HbbTV-Fernseher in deinem WLAN werden automatisch erkannt' },
    { title: 'Wähle, was du hörst', subtitle: 'Audiodeskription, Originalfassung und weitere Sprachen' },
    { title: 'Privat hören, synchron', subtitle: 'Der TV-Ton im Kopfhörer, auch im Hintergrund' },
    { title: 'Video auf dem zweiten Bildschirm', subtitle: 'Gebärdensprache und Zusatzvideo, bildgenau mit DVB-CSS' },
  ],
  it: [
    { title: 'Trova la tua TV', subtitle: 'Rileva automaticamente le TV HbbTV della tua rete Wi-Fi' },
    { title: 'Scegli cosa ascoltare', subtitle: 'Audiodescrizione, versione originale e altre lingue' },
    { title: 'Ascolto privato, sincronizzato', subtitle: "L'audio della TV nelle tue cuffie, anche in background" },
    { title: 'Video sul secondo schermo', subtitle: 'Lingua dei segni e video extra, al fotogramma con DVB-CSS' },
  ],
  fr: [
    { title: 'Trouvez votre téléviseur', subtitle: 'Les téléviseurs HbbTV de votre Wi-Fi sont détectés automatiquement' },
    { title: 'Choisissez quoi écouter', subtitle: 'Audiodescription, version originale et autres langues' },
    { title: 'Écoute privée, synchronisée', subtitle: 'Le son de la télé dans vos écouteurs, même en arrière-plan' },
    { title: 'La vidéo sur le second écran', subtitle: "Langue des signes et vidéo en plus, à l'image près avec DVB-CSS" },
  ],
};
