# Доверие ОС, подпись кода и нотаризация

Runbook по проблеме «после релиза все платформы расценивают Talkis как вредоносное ПО».

## Диагноз (корень проблемы)

Сборки Talkis **не подписаны платными сертификатами и не нотаризованы** ни под одну платформу.
ОС реагируют на это предупреждениями о «непроверённом» приложении — это **не** реальная
детекция вируса и **не** регрессия конкретного релиза.

- Единственная «подпись» в пайплайне — ключ апдейтера `TAURI_SIGNING_PRIVATE_KEY` (minisign).
  Он нужен только авто-апдейтеру для проверки подлинности обновлений и **не влияет на доверие ОС**.
- **macOS** (`scripts/postprocess-macos-release.sh`): `codesign --force --deep --sign -` — это
  **ad-hoc** подпись без Apple Developer ID и **без нотаризации**. Скачанный `.dmg` получает
  атрибут `com.apple.quarantine`, и Gatekeeper показывает «Не удалось проверить, что приложение
  не содержит вредоносного ПО».
- **Windows** (`.github/workflows/release.yml`): NSIS `.exe` **полностью без подписи** → SmartScreen
  «Система Windows защитила ваш компьютер». Бандл из нативных бинарей (`talkis-llm` = llama.cpp,
  `talkis-ffmpeg`, whisper-STT, открывают локальные порты 8011/18200) повышает шанс эвристического
  флага у Defender/сторонних AV.
- **Linux**: AppImage/deb без подписи; обычно «вредоносом» не зовётся.

**Почему «после нового релиза».** Пайплайн никогда не подписывал нормально (v0.3.0 был таким же).
Каждая новая неподписанная сборка — это новый неизвестный хеш: репутация в SmartScreen/Defender
обнуляется, а релиз пошёл к реальным пользователям, которые скачивают файл (с quarantine-битом),
а не собирают локально.

## Фаза 1 — бесплатные меры (сделано / делается)

Не убирают предупреждение полностью, но снимают трение и страх у пользователей.

- [x] Инструкция «как открыть» в `README.ru.md` / `README.md` (раздел «Если ОС блокирует первый запуск»).
- [x] Та же инструкция в теле GitHub-релиза (`release.yml`, шаг *Publish GitHub release assets*).
- [x] Блок «Первый запуск» на статической странице сайта (`site/index.html`) рядом со ссылками на загрузку.
- [ ] Проверить сборку на [VirusTotal](https://www.virustotal.com/) — убедиться, что нет **реальных**
      детекций (а только репутационные предупреждения). Если конкретный движок флагит — отправить
      false-positive репорт (см. ниже).

### Инструкции для пользователей

**macOS** («не удалось проверить»):
1. В диалоге — **«Готово»** (не «Переместить в Корзину»).
2. **Системные настройки → Конфиденциальность и безопасность → «Всё равно открыть»**.
3. Подтвердить паролем/Touch ID, ещё раз **«Открыть»**.
   Терминал-альтернатива: `xattr -dr com.apple.quarantine /Applications/Talkis.app`

> На macOS 15 Sequoia правый клик → «Открыть» больше не обходит Gatekeeper — нужен путь через
> «Системные настройки». На Sonoma и раньше правый клик → «Открыть» ещё работает.

**Windows** (SmartScreen): **«Подробнее» → «Выполнить в любом случае»**.
Либо ПКМ по `.exe` → Свойства → галочка **«Разблокировать»** → Применить.

### False-positive репорты (если есть реальная детекция)

- Microsoft Defender: https://www.microsoft.com/en-us/wdsi/filesubmission (как разработчик ПО).
- VirusTotal: открыть отчёт по файлу, у флагнувших движков использовать форму «contact / false positive».

## Фаза 2 — настоящая подпись (когда будет бюджет)

Полностью убирает предупреждения. Здесь же — конкретные шаги, чтобы не вспоминать заново.

### macOS — Developer ID + нотаризация (~$99/год)

1. Apple Developer Program → сертификат **Developer ID Application**.
2. В CI (`release.yml`, шаг сборки macOS) задать Tauri-переменные:
   - `APPLE_CERTIFICATE` (base64 .p12), `APPLE_CERTIFICATE_PASSWORD`
   - `APPLE_SIGNING_IDENTITY` (`Developer ID Application: … (TEAMID)`)
   - `APPLE_ID`, `APPLE_PASSWORD` (app-specific), `APPLE_TEAM_ID`
   Tauri тогда сам подпишет Developer ID и **нотаризует** бандл.
3. Убрать/заменить ad-hoc `postprocess-macos-release.sh`. Если оставляем ручную подпись —
   **не использовать `--deep`** (deprecated, ломает подпись бандла с сайдкарами): подписывать
   вложенные бинарники по отдельности (inside-out), приложение — последним, с
   `--options runtime --timestamp --entitlements entitlements.plist`, затем `xcrun notarytool submit`
   и `xcrun stapler staple`.

### Windows — подпись installer'а

- Варианты: **EV-сертификат** (мгновенная репутация SmartScreen, дорого), обычный **OV-сертификат**
  (дешевле, но репутация копится), либо **Azure Trusted Signing** (~$10/мес, нужна верифицированная
  организация/личность).
- В Tauri NSIS прописать `signCommand` (signtool / Azure) — подписывать `.exe`/`.msi`.

### Линки

- Tauri code signing: https://v2.tauri.app/distribute/sign/
- Apple notarization: https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution
- Azure Trusted Signing: https://learn.microsoft.com/azure/trusted-signing/
