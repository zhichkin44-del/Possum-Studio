# Font and sound sources (downloaded 16.11.2026)

Everything here may be embedded in the app and in the videos. No file requires author attribution.
The folder goes into the build through `extraResources`, so ffmpeg reads the files from disk.

## Fonts: SIL Open Font License 1.1
Source: https://github.com/google/fonts/tree/main/ofl. Each font's licence sits next to it: `fonts/<Name>-OFL.txt`.
The files are static styles cut from variable fonts with fontTools. All of them include Cyrillic.

| File | Role |
|---|---|
| Montserrat-Black.ttf | captions (main) |
| Nunito-Black.ttf | soft captions (calm, asmr) |
| Rubik-Black.ttf | hook, countdown #3…#1 |
| DelaGothicOne-Regular.ttf | cover |
| Caveat-Bold.ttf | "the critter's thoughts" |

## Sounds: CC0 (public domain)
Processing: leading silence trimmed, peak normalised to −1 dB, 48 kHz stereo, Ogg Vorbis.

| File | Original | Pack | URL | Licence |
|---|---|---|---|---|
| pop.ogg | plop_01 | "100 CC0 SFX", rubberduck | https://opengameart.org/content/100-cc0-sfx | CC0, stated on the page |
| boom.ogg | hit_03 | "100 CC0 SFX", rubberduck | same | CC0 |
| boing.ogg | spring_03 | "100 CC0 SFX", rubberduck | same | CC0 |
| crunch.ogg | paper_01 (paper crunch instead of a food crunch) | "100 CC0 SFX", rubberduck | same | CC0 |
| sparkle.ogg | glass_001 | Kenney Interface Sounds 1.0 | https://opengameart.org/content/interface-sounds | CC0, `sfx/LICENSE-kenney-interface-sounds.txt` |
| whoosh.ogg | maximize_006 | Kenney Interface Sounds 1.0 | same | CC0 |

The sounds have not been checked by ear yet: if one does not fit, replace the file under the same name and add a line here.
