# Klipper for FlexBar

## Short description

A FlexDesigner plugin for 3D printers running **Klipper and Moonraker**. It displays
printer status, print progress, temperatures, and sensor readings on the FlexBar,
and provides configurable keys for common printer controls.

![Example FlexBar layout with Klipper printer status and control keys](Flexbar-Klipper.png)

## Installation instructions and requirements

### Requirements

- FlexDesigner **2.2 or later** on macOS or Windows
- A network-accessible 3D printer running Klipper and Moonraker
- To build from source: Node.js **20 or later**, npm, and FlexCLI
  (`npm install -g @eniac/flexcli`)

### Install the plugin

A prebuilt `de.teddielike.flexbar-klipper.flexplugin` package can be installed through
FlexDesigner's plugin manager. To build it locally:

1. Start FlexDesigner.
2. Run `./build.sh` from the project root. The script installs dependencies, builds
   and tests the plugin, validates it, creates the `.flexplugin` package, and attempts
   to install it in FlexDesigner.
3. If automatic installation is unavailable, manually install the generated package
   at `de.teddielike.flexbar-klipper.flexplugin` through FlexDesigner.

The package does not include local printer credentials or logs.

### Configure a printer

1. In FlexDesigner, open **Klipper → Settings**.
2. Enter the hostname or IP address and port. **7125** connects directly to Moonraker;
   **80** can be used through a Fluidd web server when its proxy is configured
   accordingly.
3. If Moonraker requires authentication, choose the appropriate method: none,
   username/password, or API key.
4. Select **Test connection**, then **Save**. You can add additional printers.
5. Drag the desired keys from the Klipper library onto the FlexBar and adjust their
   settings. Each key can be assigned to a printer.

## Detailed description and features

The plugin retrieves printer and sensor data through the Moonraker API. Its interface
follows the language selected in FlexDesigner (German or English). Multiple printers
can be configured, and each key can use a different printer.

### Displays and sensors

- **Printer status:** ready, printing, paused, complete, error, or offline; errors
  can include a message from the printer.
- **Print job:** filename, progress, estimated time remaining, and a progress bar;
  optionally also the estimated completion time, print duration, and layer.
- **Single print value:** choose progress, time remaining, completion time, filename,
  print duration, layer, filament usage, or status.
- **Hotend, build plate, and chamber:** current and target temperatures, optional
  heater power, and color indicators for heating, at target, and cooling. The chamber
  sensor can be detected automatically or selected manually.
- **Custom sensor:** display up to three values from Klipper objects or Moonraker
  sensors, such as temperature, humidity, pressure, power, or fan speed. Units,
  scaling factors, and labels are configurable.
- **QIDI Box:** temperature, humidity, and drying target for a selectable box number.
- **Lighting and Polar Cooler:** show the state of supported `output_pin` objects.

### Controls

- **Pause / Resume:** pauses an active print or resumes it.
- **Stop print:** cancels the current print; by default, this requires a second tap
  for confirmation.
- **Emergency stop:** triggers Klipper's emergency stop; by default, this also
  requires a second tap. The default key width is 120 pixels.
- **Firmware restart:** sends `FIRMWARE_RESTART`, for example after an emergency stop.
- **G-code / macro:** sends configurable G-code commands or macros. Compatible
  temperature, sensor, lighting, cooler, and box keys can also have separate actions
  for a single or double tap.

Actions with potentially significant effects, such as canceling a print or triggering
an emergency stop, require a second tap by default. Other confirmation options and
restrictions—such as running G-code only while idle—can be adjusted in the key settings.
For temperature and sensor keys, a single tap is briefly delayed so that a double tap
can be recognized.

Key width and other display options can be configured per key. A global font priority
list is available under **Klipper → Settings → FlexBar fonts**; unavailable fonts are
skipped.

### Build the plugin from source

Run this from the project root:

```bash
./build.sh
```

Alternatively, run individual steps from the directory:

```bash
npm ci
npm run build
npm test
npm run plugin:validate
```

The manifest and UI files are generated from `tools/gen-manifest.cjs` and
`ui-src/`. Changes made directly to generated files will be overwritten
by the next build.

## License

This project is licensed under the [MIT License](LICENSE).

Klipper, Moonraker, Fluidd, Mainsail, and FlexDesigner are separate projects
and are not part of this project.
