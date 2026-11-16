# Источники шрифтов и звуков (скачано 16.11.2026)

Всё здесь можно вшивать в приложение и в ролики. Ссылка на автора не обязательна ни для одного файла.
В сборку папка идёт через `extraResources`, чтобы ffmpeg читал файлы с диска.

## Шрифты — SIL Open Font License 1.1
Источник: https://github.com/google/fonts/tree/main/ofl. Лицензия каждого шрифта лежит рядом: `fonts/<Имя>-OFL.txt`.
Файлы — статические начертания, вырезанные из вариативных шрифтов через fontTools. Кириллица есть во всех.

| Файл | Роль |
|---|---|
| Montserrat-Black.ttf | подписи (главный) |
| Nunito-Black.ttf | мягкие подписи (calm, asmr) |
| Rubik-Black.ttf | крючок, счётчик №3…№1 |
| DelaGothicOne-Regular.ttf | обложка |
| Caveat-Bold.ttf | «мысли зверька» |

## Звуки — CC0 (общественное достояние)
Обработка: обрезана тишина в начале, пик выровнен до −1 дБ, 48 кГц стерео, Ogg Vorbis.

| Файл | Исходник | Набор | Адрес | Лицензия |
|---|---|---|---|---|
| pop.ogg | plop_01 | «100 CC0 SFX», rubberduck | https://opengameart.org/content/100-cc0-sfx | CC0, указано на странице |
| boom.ogg | hit_03 | «100 CC0 SFX», rubberduck | там же | CC0 |
| boing.ogg | spring_03 | «100 CC0 SFX», rubberduck | там же | CC0 |
| crunch.ogg | paper_01 (хруст бумаги вместо хруста еды) | «100 CC0 SFX», rubberduck | там же | CC0 |
| sparkle.ogg | glass_001 | Kenney Interface Sounds 1.0 | https://opengameart.org/content/interface-sounds | CC0, `sfx/LICENSE-kenney-interface-sounds.txt` |
| whoosh.ogg | maximize_006 | Kenney Interface Sounds 1.0 | там же | CC0 |

На слух звуки ещё не проверены человеком: если какой-то не подходит — заменить файл с тем же именем и дописать строку сюда.
