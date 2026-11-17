# Klipper für FlexBar

## Kurzbeschreibung

FlexDesigner-Plugin für 3D-Drucker mit **Klipper und Moonraker**. Es zeigt Druckstatus,
Fortschritt, Temperaturen und Sensorwerte auf der FlexBar an und ermöglicht die
wichtigsten Druckeraktionen direkt über konfigurierbare Tasten.

![Beispielansicht der FlexBar mit Klipper-Status- und Steuertasten](Flexbar-Klipper.png)

## Installationsanweisungen inkl. Voraussetzungen

### Voraussetzungen

- FlexDesigner **2.2 oder neuer** auf macOS oder Windows
- Ein 3D-Drucker mit Klipper und Moonraker, erreichbar über das Netzwerk
- Für den Build aus dem Quellcode: Node.js **20 oder neuer**, npm und FlexCLI
  (`npm install -g @eniac/flexcli`)

### Plugin installieren

Ein fertiges Paket `de.teddielike.flexbar-klipper.flexplugin` kann in FlexDesigner
über die Plugin-Verwaltung installiert werden. Für einen lokalen Build:

1. FlexDesigner starten.
2. Im Projektstamm `./build.sh` ausführen. Das Skript installiert Abhängigkeiten,
   baut und testet das Plugin, validiert es, erstellt das `.flexplugin`-Paket und
   versucht, dieses in FlexDesigner zu installieren.
3. Falls die automatische Installation nicht möglich ist, das erzeugte Paket
   unter `de.teddielike.flexbar-klipper.flexplugin` manuell in
   FlexDesigner installieren.

Das Paket enthält keine lokalen Drucker-Zugangsdaten oder Logs.

### Drucker einrichten

1. In FlexDesigner **Klipper → Einstellungen** öffnen.
2. Hostname oder IP-Adresse und Port eintragen. **7125** verbindet direkt mit
   Moonraker; **80** kann für den Zugriff über einen Fluidd-Webserver mit
   entsprechendem Proxy verwendet werden.
3. Falls Moonraker geschützt ist, die passende Anmeldung wählen: keine,
   Benutzername/Passwort oder API-Key.
4. **Verbindung testen** und anschließend **Speichern** wählen. Weitere Drucker
   lassen sich hinzufügen.
5. Gewünschte Tasten aus der Klipper-Bibliothek auf die FlexBar ziehen und ihre
   Einstellungen anpassen. Jede Taste kann einem Drucker zugeordnet werden.

Für die Taste **Druckerstatus** kann unter **Programm / App öffnen (optional)**
ein Programmname oder Pfad hinterlegt werden. Mit dem Anwendung-öffnen-Symbol
daneben lässt sich das Programm bequem über den nativen Dateiauswahldialog
auswählen. Beim Tippen auf die Taste wird das gewählte Programm geöffnet.

## Langbeschreibung inkl. Funktionserklärung

Das Plugin fragt Drucker- und Sensordaten über die Moonraker-API ab. Die Oberfläche
übernimmt Deutsch oder Englisch aus FlexDesigner. Mehrere Drucker können gleichzeitig
hinterlegt und für jede Taste einzeln ausgewählt werden.

### Anzeigen und Sensoren

- **Druckerstatus:** bereit, druckend, pausiert, fertig, Fehler oder offline; Fehler
  können mit einer Druckermeldung ergänzt werden.
- **Programm öffnen:** Die Druckerstatus-Taste kann beim Tippen optional ein
  konfiguriertes Programm wie QIDI Studio oder OrcaSlicer öffnen; die Auswahl
  ist auch über den nativen Dateiauswahldialog möglich.
- **Druckauftrag:** Dateiname, Fortschritt, geschätzte Restzeit und Fortschrittsbalken;
  optional auch Fertig-Zeitpunkt, Druckzeit und Layer.
- **Druck-Einzelwert:** wahlweise Fortschritt, Restzeit, Fertig-Zeitpunkt, Dateiname,
  Druckzeit, Layer, Filamentverbrauch oder Status.
- **Hotend, Druckbett und Bauraum:** Ist- und Solltemperatur, optional Heizleistung
  und farbliche Anzeige für Aufheizen, Solltemperatur und Abkühlen. Der Bauraumsensor
  kann automatisch gefunden oder manuell gewählt werden.
- **Sensor (frei):** bis zu drei Werte aus Klipper-Objekten oder Moonraker-Sensoren,
  etwa Temperatur, Luftfeuchte, Druck, Leistung oder Drehzahl. Einheit, Faktor und
  Beschriftung lassen sich konfigurieren.
- **QIDI Box:** Temperatur, Luftfeuchtigkeit und Trocknungs-Sollwert für die
  konfigurierbare Box-Nummer.
- **Beleuchtung und Polar-Cooler:** zeigen den Schaltzustand unterstützter
  `output_pin`-Objekte an.

### Steuerung

- **Pause / Fortsetzen:** pausiert einen laufenden Druck oder setzt ihn fort.
- **Druck stoppen:** bricht den aktuellen Druck ab; standardmäßig ist eine
  Bestätigung durch zweimaliges Tippen erforderlich.
- **Not-Aus:** löst Klippers Emergency Stop aus; standardmäßig mit Bestätigung durch
  zweimaliges Tippen. Die Standardbreite der Taste beträgt 120 Pixel.
- **Firmware-Neustart:** sendet `FIRMWARE_RESTART`, zum Beispiel nach einem Not-Aus.
- **G-Code / Makro:** sendet frei konfigurierbare G-Code-Befehle oder Makros. Für
  geeignete Temperatur-, Sensor-, Licht-, Cooler- und Box-Tasten können zusätzlich
  getrennte Aktionen für einfaches und doppeltes Tippen festgelegt werden.

Aktionen mit potenziell weitreichenden Folgen wie Druckabbruch und Not-Aus verlangen
standardmäßig ein zweites Tippen. Weitere Bestätigungen und Einschränkungen, etwa
G-Code nur im Leerlauf auszuführen, können in den Tasteneinstellungen angepasst werden.
Bei Temperatur- und Sensortasten wird ein einfaches Tippen kurz verzögert, damit ein
doppeltes Tippen erkannt werden kann.

Die Tastenbreite und weitere Darstellungsoptionen lassen sich pro Taste konfigurieren.
Eine globale Schriftarten-Prioritätsliste kann unter **Klipper → Einstellungen →
Schriftarten für die FlexBar** angegeben werden; nicht verfügbare Schriften werden
übersprungen.

### Plugin aus dem Quellcode bauen

Im Projektstamm:

```bash
./build.sh
```

Alternativ einzelne Schritte im Verzeichnis ausführen:

```bash
npm ci
npm run build
npm test
npm run plugin:validate
```

Manifest und UI-Dateien werden aus `tools/gen-manifest.cjs` und
`ui-src/` generiert; Änderungen an generierten Dateien werden beim
nächsten Build überschrieben.

## Lizenz

Dieses Projekt steht unter der [MIT-Lizenz](LICENSE).

Klipper, Moonraker, Fluidd, Mainsail und FlexDesigner sind eigenständige
Projekte und nicht Bestandteil dieses Projekts.
